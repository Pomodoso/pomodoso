//! In-app purchase billing (App Store / Play Store) via RevenueCat webhooks.
//!
//! Mirrors `billing.rs` for the store-purchased side of the same subscription
//! row. RevenueCat is identified with our own `user.id` as its `app_user_id`,
//! so events map straight onto `subscription.user_id` with no lookup table.
//!
//! The parsing and event-mapping below are pure functions so they can be tested
//! without a database or a live RevenueCat account.

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    AppState,
};

// ─── Event model ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    InitialPurchase,
    Renewal,
    ProductChange,
    Uncancellation,
    Cancellation,
    Expiration,
    BillingIssue,
    /// A one-off, non-subscription purchase — the lifetime tier. It never
    /// renews and never expires, so it is the only event that grants access
    /// with no period end and can never be followed by an EXPIRATION.
    NonRenewingPurchase,
}

impl EventKind {
    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "INITIAL_PURCHASE" => Self::InitialPurchase,
            "RENEWAL" => Self::Renewal,
            "PRODUCT_CHANGE" => Self::ProductChange,
            "UNCANCELLATION" => Self::Uncancellation,
            "CANCELLATION" => Self::Cancellation,
            "EXPIRATION" => Self::Expiration,
            "BILLING_ISSUE" => Self::BillingIssue,
            "NON_RENEWING_PURCHASE" => Self::NonRenewingPurchase,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Store {
    Apple,
    Google,
}

impl Store {
    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "APP_STORE" | "MAC_APP_STORE" => Self::Apple,
            "PLAY_STORE" => Self::Google,
            _ => return None,
        })
    }

    fn provider(self) -> &'static str {
        match self {
            Self::Apple => "apple",
            Self::Google => "google",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct IapEvent {
    pub kind: EventKind,
    pub user_id: Uuid,
    pub store: Store,
    pub product_id: Option<String>,
    pub transaction_id: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Outcome of reading a webhook body. Anything we can't act on is an explicit
/// `Ignore` with a reason rather than an error — RevenueCat retries on non-2xx,
/// and a payload we structurally don't handle will never succeed on retry.
#[derive(Debug, PartialEq)]
pub enum Parsed {
    Handle(Box<IapEvent>),
    Ignore(&'static str),
}

pub fn parse_event(payload: &Value) -> Parsed {
    let event = &payload["event"];

    let Some(kind) = event["type"].as_str().and_then(EventKind::parse) else {
        return Parsed::Ignore("unhandled event type");
    };

    let Some(store) = event["store"].as_str().and_then(Store::parse) else {
        return Parsed::Ignore("unknown store");
    };

    // A purchase made before the user logged in carries RevenueCat's anonymous
    // id ("$RCAnonymousID:..."), which belongs to no account of ours. The app
    // calls logIn() after auth, which triggers a TRANSFER and re-fires the
    // subscriber's events under the real id.
    let Some(user_id) = event["app_user_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
    else {
        return Parsed::Ignore("app_user_id is not one of our user ids");
    };

    Parsed::Handle(Box::new(IapEvent {
        kind,
        user_id,
        store,
        product_id: event["product_id"].as_str().map(str::to_string),
        transaction_id: event["original_transaction_id"]
            .as_str()
            .or_else(|| event["transaction_id"].as_str())
            .map(str::to_string),
        expires_at: event["expiration_at_ms"]
            .as_i64()
            .and_then(DateTime::from_timestamp_millis),
    }))
}

// ─── Event → subscription state ───────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelledAt {
    Set,
    Clear,
    Leave,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SubscriptionUpdate {
    /// `None` leaves the current plan untouched.
    pub plan: Option<&'static str>,
    pub status: &'static str,
    pub cancelled_at: CancelledAt,
    pub period_end: Option<DateTime<Utc>>,
}

pub fn resolve(event: &IapEvent) -> SubscriptionUpdate {
    match event.kind {
        // Access granted or restored.
        EventKind::InitialPurchase
        | EventKind::Renewal
        | EventKind::ProductChange
        | EventKind::Uncancellation => SubscriptionUpdate {
            plan: Some("pro"),
            status: "active",
            cancelled_at: CancelledAt::Clear,
            period_end: event.expires_at,
        },

        // Auto-renew turned off. On the stores this means "will not renew", not
        // "access revoked" — the user keeps Pro until EXPIRATION lands at the
        // end of the paid period. Same split as Stripe's subscription.updated
        // vs subscription.deleted.
        EventKind::Cancellation => SubscriptionUpdate {
            plan: None,
            status: "active",
            cancelled_at: CancelledAt::Set,
            period_end: event.expires_at,
        },

        // Lifetime. Distinct from the subscription branch above in two ways
        // that both matter: the plan is founder_lifetime rather than pro (it
        // is what models.rs resolves and what the welcome email keys off),
        // and period_end stays None — a lifetime purchase has no end, and
        // writing one would make it look like a subscription about to lapse.
        EventKind::NonRenewingPurchase => SubscriptionUpdate {
            plan: Some("founder_lifetime"),
            status: "active",
            cancelled_at: CancelledAt::Clear,
            period_end: None,
        },

        EventKind::Expiration => SubscriptionUpdate {
            plan: Some("free"),
            status: "cancelled",
            cancelled_at: CancelledAt::Set,
            period_end: event.expires_at,
        },

        EventKind::BillingIssue => SubscriptionUpdate {
            plan: None,
            status: "past_due",
            cancelled_at: CancelledAt::Leave,
            period_end: event.expires_at,
        },
    }
}

fn grants_access(update: &SubscriptionUpdate) -> bool {
    update.plan == Some("pro")
}

/// Guards the case where a user pays on the web and also has an old store
/// subscription attached to the same account. A stale EXPIRATION from that
/// store subscription must not revoke a live Stripe one. Grants still apply, so
/// a genuine move from Stripe to IAP works.
pub fn should_apply(stored_provider: Option<&str>, update: &SubscriptionUpdate) -> bool {
    if stored_provider == Some("stripe") && !grants_access(update) {
        return false;
    }
    true
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

/// Compares the shared secret without leaking its content through timing.
///
/// An empty `expected` never matches. `REVENUECAT_WEBHOOK_SECRET=` (present but
/// blank, which is how .env.example ships it) reaches here as `Some("")`, and
/// without this guard it would equal the empty string an unauthenticated caller
/// sends by omitting the header entirely — opening the endpoint to anyone.
fn secret_matches(expected: &str, provided: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    let (a, b) = (expected.as_bytes(), provided.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// RevenueCat webhook handler. RevenueCat sends the configured value verbatim
/// in the Authorization header — there is no payload signature to verify.
pub async fn revenuecat_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode> {
    let secret = state
        .config
        .revenuecat_webhook_secret
        .as_deref()
        .ok_or_else(|| {
            tracing::warn!("revenuecat webhook: no webhook secret configured");
            AppError::Unauthorized
        })?;

    let provided = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();

    if !secret_matches(secret, provided) {
        tracing::warn!("revenuecat webhook: authorization mismatch");
        return Err(AppError::Unauthorized);
    }

    let payload: Value =
        serde_json::from_slice(&body).map_err(|e| AppError::BadRequest(e.to_string()))?;

    let event = match parse_event(&payload) {
        Parsed::Handle(e) => *e,
        Parsed::Ignore(reason) => {
            tracing::info!("revenuecat webhook: ignored ({reason})");
            return Ok(StatusCode::OK);
        }
    };

    let update = resolve(&event);

    let stored_provider = sqlx::query_scalar!(
        "SELECT payment_provider FROM subscription WHERE user_id = $1",
        event.user_id
    )
    .fetch_optional(&state.pool)
    .await?
    .flatten();

    if !should_apply(stored_provider.as_deref(), &update) {
        tracing::warn!(
            "revenuecat webhook: skipped {:?} for user {} — row is owned by stripe",
            event.kind,
            event.user_id
        );
        return Ok(StatusCode::OK);
    }

    apply_update(&state, &event, &update).await?;

    Ok(StatusCode::OK)
}

async fn apply_update(
    state: &AppState,
    event: &IapEvent,
    update: &SubscriptionUpdate,
) -> Result<()> {
    let set_cancelled = update.cancelled_at == CancelledAt::Set;
    let clear_cancelled = update.cancelled_at == CancelledAt::Clear;

    let result = sqlx::query!(
        r#"
        UPDATE subscription
        SET plan = COALESCE($1, plan),
            status = $2,
            cancelled_at = CASE
                WHEN $3 THEN NOW()
                WHEN $4 THEN NULL
                ELSE cancelled_at
            END,
            current_period_end = COALESCE($5, current_period_end),
            payment_provider = $6,
            store_transaction_id = COALESCE($7, store_transaction_id),
            store_product_id = COALESCE($8, store_product_id),
            updated_at = NOW()
        WHERE user_id = $9
        "#,
        update.plan,
        update.status,
        set_cancelled,
        clear_cancelled,
        update.period_end,
        event.store.provider(),
        event.transaction_id,
        event.product_id,
        event.user_id,
    )
    .execute(&state.pool)
    .await?;

    // No row means the account was never provisioned (the subscription row is
    // created on first /me). Silently dropping a real purchase here would be
    // invisible until the user complained, so make it loud.
    if result.rows_affected() == 0 {
        tracing::error!(
            "revenuecat webhook: no subscription row for user {} — {:?} dropped",
            event.user_id,
            event.kind
        );
    }

    Ok(())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const USER: &str = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

    fn payload(event_type: &str) -> Value {
        json!({
            "api_version": "1.0",
            "event": {
                "type": event_type,
                "id": "evt_1",
                "app_user_id": USER,
                "product_id": "pomodoso_pro_monthly",
                "store": "APP_STORE",
                "environment": "PRODUCTION",
                "transaction_id": "txn_1",
                "original_transaction_id": "orig_txn_1",
                "purchased_at_ms": 1_755_000_000_000i64,
                "expiration_at_ms": 1_757_678_400_000i64,
                "entitlement_ids": ["pro"],
            }
        })
    }

    fn handled(event_type: &str) -> IapEvent {
        match parse_event(&payload(event_type)) {
            Parsed::Handle(e) => *e,
            Parsed::Ignore(r) => panic!("expected {event_type} to be handled, ignored: {r}"),
        }
    }

    // ─── Parsing ──────────────────────────────────────────────────────────────

    #[test]
    fn parses_a_full_initial_purchase() {
        let event = handled("INITIAL_PURCHASE");

        assert_eq!(event.kind, EventKind::InitialPurchase);
        assert_eq!(event.user_id, Uuid::parse_str(USER).unwrap());
        assert_eq!(event.store, Store::Apple);
        assert_eq!(event.product_id.as_deref(), Some("pomodoso_pro_monthly"));
        assert_eq!(
            event.expires_at,
            DateTime::from_timestamp_millis(1_757_678_400_000)
        );
    }

    #[test]
    fn prefers_the_original_transaction_id_over_the_renewal_one() {
        // Each renewal mints a fresh transaction_id; only the original is stable
        // across the life of the subscription, so that is what we key on.
        assert_eq!(
            handled("RENEWAL").transaction_id.as_deref(),
            Some("orig_txn_1")
        );
    }

    #[test]
    fn falls_back_to_transaction_id_when_there_is_no_original() {
        let mut p = payload("INITIAL_PURCHASE");
        p["event"]["original_transaction_id"] = Value::Null;

        match parse_event(&p) {
            Parsed::Handle(e) => assert_eq!(e.transaction_id.as_deref(), Some("txn_1")),
            Parsed::Ignore(r) => panic!("should have been handled: {r}"),
        }
    }

    #[test]
    fn maps_play_store_and_mac_app_store() {
        for (raw, expected) in [
            ("PLAY_STORE", Store::Google),
            ("MAC_APP_STORE", Store::Apple),
        ] {
            let mut p = payload("INITIAL_PURCHASE");
            p["event"]["store"] = json!(raw);
            match parse_event(&p) {
                Parsed::Handle(e) => assert_eq!(e.store, expected, "for store {raw}"),
                Parsed::Ignore(r) => panic!("{raw} should have been handled: {r}"),
            }
        }
    }

    #[test]
    fn ignores_anonymous_purchases_made_before_login() {
        let mut p = payload("INITIAL_PURCHASE");
        p["event"]["app_user_id"] = json!("$RCAnonymousID:8c9f2b1a");

        assert_eq!(
            parse_event(&p),
            Parsed::Ignore("app_user_id is not one of our user ids")
        );
    }

    #[test]
    fn ignores_event_types_we_do_not_act_on() {
        for kind in ["TEST", "TRANSFER", "SUBSCRIBER_ALIAS"] {
            assert_eq!(
                parse_event(&payload(kind)),
                Parsed::Ignore("unhandled event type"),
                "for event {kind}"
            );
        }
    }

    #[test]
    fn ignores_stores_we_do_not_sell_through() {
        // Stripe purchases also flow through RevenueCat for some setups; ours
        // are handled by billing.rs and must not be double-processed here.
        let mut p = payload("INITIAL_PURCHASE");
        p["event"]["store"] = json!("STRIPE");

        assert_eq!(parse_event(&p), Parsed::Ignore("unknown store"));
    }

    #[test]
    fn ignores_a_structurally_empty_body() {
        assert_eq!(
            parse_event(&json!({})),
            Parsed::Ignore("unhandled event type")
        );
    }

    #[test]
    fn tolerates_a_missing_expiration() {
        // Lifetime / non-expiring grants arrive without expiration_at_ms.
        let mut p = payload("INITIAL_PURCHASE");
        p["event"]["expiration_at_ms"] = Value::Null;

        match parse_event(&p) {
            Parsed::Handle(e) => assert_eq!(e.expires_at, None),
            Parsed::Ignore(r) => panic!("should have been handled: {r}"),
        }
    }

    // ─── Event → state ────────────────────────────────────────────────────────

    #[test]
    fn purchase_and_renewal_grant_pro() {
        for kind in [
            "INITIAL_PURCHASE",
            "RENEWAL",
            "PRODUCT_CHANGE",
            "UNCANCELLATION",
        ] {
            let update = resolve(&handled(kind));

            assert_eq!(update.plan, Some("pro"), "for event {kind}");
            assert_eq!(update.status, "active", "for event {kind}");
            assert_eq!(update.cancelled_at, CancelledAt::Clear, "for event {kind}");
        }
    }

    #[test]
    fn lifetime_grants_founder_lifetime_with_no_end_date() {
        // The lifetime tier arrives as NON_RENEWING_PURCHASE, which this used
        // to ignore outright — someone paying for it got nothing back. Two
        // things separate it from a subscription: the plan is
        // founder_lifetime, not pro, and there is no period end. Writing an
        // expiry would make a permanent purchase look like a lapsing one.
        let update = resolve(&handled("NON_RENEWING_PURCHASE"));

        assert_eq!(update.plan, Some("founder_lifetime"));
        assert_eq!(update.status, "active");
        assert_eq!(update.cancelled_at, CancelledAt::Clear);
        assert_eq!(update.period_end, None, "a lifetime purchase does not end");
    }

    #[test]
    fn cancellation_keeps_access_until_the_period_ends() {
        // The trap: on the stores CANCELLATION means auto-renew off, not access
        // revoked. Dropping the user to free here would cut off someone who has
        // already paid for the rest of the month.
        let update = resolve(&handled("CANCELLATION"));

        assert_eq!(update.plan, None);
        assert_eq!(update.status, "active");
        assert_eq!(update.cancelled_at, CancelledAt::Set);
        assert_eq!(
            update.period_end,
            DateTime::from_timestamp_millis(1_757_678_400_000)
        );
    }

    #[test]
    fn expiration_is_what_actually_drops_the_user_to_free() {
        let update = resolve(&handled("EXPIRATION"));

        assert_eq!(update.plan, Some("free"));
        assert_eq!(update.status, "cancelled");
        assert_eq!(update.cancelled_at, CancelledAt::Set);
    }

    #[test]
    fn billing_issue_marks_past_due_without_revoking_the_plan() {
        let update = resolve(&handled("BILLING_ISSUE"));

        assert_eq!(update.plan, None);
        assert_eq!(update.status, "past_due");
        assert_eq!(update.cancelled_at, CancelledAt::Leave);
    }

    // ─── Stripe guard ─────────────────────────────────────────────────────────

    #[test]
    fn a_stale_store_expiration_cannot_revoke_a_stripe_subscription() {
        let expiration = resolve(&handled("EXPIRATION"));

        assert!(!should_apply(Some("stripe"), &expiration));
        assert!(!should_apply(
            Some("stripe"),
            &resolve(&handled("BILLING_ISSUE"))
        ));
        assert!(!should_apply(
            Some("stripe"),
            &resolve(&handled("CANCELLATION"))
        ));
    }

    #[test]
    fn a_stripe_user_can_still_move_to_a_store_subscription() {
        let purchase = resolve(&handled("INITIAL_PURCHASE"));

        assert!(should_apply(Some("stripe"), &purchase));
    }

    #[test]
    fn store_owned_and_brand_new_rows_apply_every_event() {
        for provider in [None, Some("apple"), Some("google")] {
            for kind in [
                "INITIAL_PURCHASE",
                "CANCELLATION",
                "EXPIRATION",
                "BILLING_ISSUE",
            ] {
                assert!(
                    should_apply(provider, &resolve(&handled(kind))),
                    "provider {provider:?} should apply {kind}"
                );
            }
        }
    }

    // ─── Auth ─────────────────────────────────────────────────────────────────

    #[test]
    fn secret_comparison_accepts_only_an_exact_match() {
        assert!(secret_matches("s3cret", "s3cret"));
        assert!(!secret_matches("s3cret", "s3creT"));
        assert!(!secret_matches("s3cret", "s3cret "));
        assert!(!secret_matches("s3cret", ""));
        assert!(!secret_matches("", "s3cret"));
    }

    #[test]
    fn a_blank_configured_secret_does_not_authorize_a_blank_header() {
        // Both sides empty is the dangerous case: REVENUECAT_WEBHOOK_SECRET=
        // set but blank, against a caller that just omits the header.
        assert!(!secret_matches("", ""));
    }
}
