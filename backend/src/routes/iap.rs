//! In-app purchase billing, straight from the App Store.
//!
//! Mirrors `billing.rs` for the store-purchased side of the same subscription
//! row. There is no billing intermediary: Apple signs everything it sends,
//! `apple::jws` verifies the signature against Apple's pinned root, and what
//! comes out is trusted for exactly as far as the signature reaches.
//!
//! Two paths write the same row, deliberately:
//!
//! - `POST /webhooks/app-store` — App Store Server Notifications V2. The
//!   authority on the subscription lifecycle: renewals, cancellations, billing
//!   failures and refunds only ever arrive here, long after the app last ran.
//! - `POST /iap/verify` — the app posting the transaction it just received.
//!   Makes a purchase apply immediately instead of whenever the notification
//!   lands, and it is the *only* reliable path for the lifetime tier, which
//!   Apple does not consistently send notifications for.
//!
//! Both funnel into one `resolve` → `apply_update`, so the two can't drift.
//!
//! The parsing and mapping below are pure functions, testable without a
//! database, a network, or an Apple account.

use axum::{body::Bytes, extract::State, http::StatusCode, Extension, Json};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    apple::{self, Environment, Transaction},
    error::{AppError, Result},
    middleware::auth::AuthUser,
    AppState,
};

// ─── Products ─────────────────────────────────────────────────────────────────

/// What each App Store product grants.
///
/// Mapped by product ID and nothing else. The previous implementation inferred
/// the plan from the *event type*, which happened to work only because the
/// lifetime tier was the one non-renewing product; adding any second one-off
/// product would have silently granted the wrong plan.
fn plan_for(product_id: &str) -> Option<&'static str> {
    Some(match product_id {
        "com.pomodoso.app.pro.monthly" | "com.pomodoso.app.pro.annual" => "pro",
        "com.pomodoso.app.founder.lifetime" => "founder_lifetime",
        _ => return None,
    })
}

// ─── Event model ──────────────────────────────────────────────────────────────

/// Apple's notification vocabulary, reduced to the six outcomes that change
/// what a user may do. Everything else Apple sends is real but inert to us.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    /// Bought, renewed, resubscribed, or switched between our two plans.
    Grant,
    /// Auto-renew turned off. On the App Store this means "will not renew",
    /// *not* "access revoked" — the user keeps Pro until EXPIRED lands at the
    /// end of the period they already paid for.
    AutoRenewOff,
    AutoRenewOn,
    /// Payment failed; Apple is retrying, possibly inside a grace period.
    BillingIssue,
    Expired,
    /// Refunded, or revoked (family sharing withdrawn). Access ends now.
    Revoked,
}

/// Maps `notificationType` + `subtype` onto an outcome.
///
/// Returning `None` is the normal fate of most notification types — price
/// consent requests, renewal extensions, consumption requests and Apple's own
/// TEST ping are all things we acknowledge and ignore.
fn kind_for(notification_type: &str, subtype: Option<&str>) -> Option<EventKind> {
    Some(match (notification_type, subtype) {
        ("SUBSCRIBED", _)
        | ("DID_RENEW", _)
        | ("DID_CHANGE_RENEWAL_PREF", _)
        | ("OFFER_REDEEMED", _)
        | ("ONE_TIME_CHARGE", _) => EventKind::Grant,

        ("DID_CHANGE_RENEWAL_STATUS", Some("AUTO_RENEW_DISABLED")) => EventKind::AutoRenewOff,
        ("DID_CHANGE_RENEWAL_STATUS", Some("AUTO_RENEW_ENABLED")) => EventKind::AutoRenewOn,

        ("DID_FAIL_TO_RENEW", _) | ("GRACE_PERIOD_EXPIRED", _) => EventKind::BillingIssue,

        ("EXPIRED", _) => EventKind::Expired,
        ("REFUND", _) | ("REVOKE", _) => EventKind::Revoked,

        _ => return None,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct IapEvent {
    pub kind: EventKind,
    pub user_id: Uuid,
    /// Resolved from the product ID when the event was built, so `resolve`
    /// cannot be reached with a product we don't sell.
    pub plan: &'static str,
    pub product_id: String,
    pub transaction_id: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub environment: Environment,
}

/// Outcome of reading a payload. Anything we can't act on is an explicit
/// `Ignore` with a reason rather than an error: Apple retries on non-2xx, and
/// a payload we structurally don't handle will never succeed on retry.
#[derive(Debug, PartialEq)]
pub enum Parsed {
    Handle(Box<IapEvent>),
    Ignore(&'static str),
}

/// Turns a verified transaction into an event.
///
/// Every check here is on a payload Apple has already signed. The signature
/// proves the App Store issued it; these decide whether it is *ours* and
/// whether it means anything.
pub fn event_from(kind: EventKind, tx: &Transaction) -> Parsed {
    // A signature from Apple says "the App Store issued this", not "for your
    // app". Without this, a transaction from any other developer's app carries
    // a perfectly valid chain.
    if tx.bundle_id.as_deref() != Some(apple::BUNDLE_ID) {
        return Parsed::Ignore("transaction belongs to another app");
    }

    let Some(environment) = Environment::parse(tx.environment.as_deref()) else {
        return Parsed::Ignore("unknown environment");
    };

    // The app sets this at purchase time; without it a transaction belongs to
    // an Apple ID and to no account of ours.
    let Some(user_id) = tx
        .app_account_token
        .as_deref()
        .and_then(|s| Uuid::parse_str(s).ok())
    else {
        return Parsed::Ignore("no appAccountToken tying this to one of our users");
    };

    let Some(plan) = plan_for(&tx.product_id) else {
        return Parsed::Ignore("product we do not sell");
    };

    // A refunded purchase revokes access no matter which notification carried
    // it. Apple stamps revocationDate on the transaction itself, and trusting
    // the notification type alone would let a REFUND arriving as some other
    // event keep the plan alive.
    let kind = if tx.is_revoked() {
        EventKind::Revoked
    } else {
        kind
    };

    Parsed::Handle(Box::new(IapEvent {
        kind,
        user_id,
        plan,
        product_id: tx.product_id.clone(),
        transaction_id: tx.stable_id(),
        expires_at: tx.expires_at(),
        environment,
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
        // The plan comes from the product. For the lifetime tier that is
        // `founder_lifetime` with `period_end` left None — Apple sends no
        // expiry for a non-consumable, and inventing one would make a
        // permanent purchase look like a subscription about to lapse.
        EventKind::Grant => SubscriptionUpdate {
            plan: Some(event.plan),
            status: "active",
            cancelled_at: CancelledAt::Clear,
            period_end: event.expires_at,
        },

        // Auto-renew off. Same split as Stripe's subscription.updated vs
        // subscription.deleted: flag it, keep access, wait for EXPIRED.
        EventKind::AutoRenewOff => SubscriptionUpdate {
            plan: None,
            status: "active",
            cancelled_at: CancelledAt::Set,
            period_end: event.expires_at,
        },

        EventKind::AutoRenewOn => SubscriptionUpdate {
            plan: None,
            status: "active",
            cancelled_at: CancelledAt::Clear,
            period_end: event.expires_at,
        },

        EventKind::BillingIssue => SubscriptionUpdate {
            plan: None,
            status: "past_due",
            cancelled_at: CancelledAt::Leave,
            period_end: event.expires_at,
        },

        EventKind::Expired | EventKind::Revoked => SubscriptionUpdate {
            plan: Some("free"),
            status: "cancelled",
            cancelled_at: CancelledAt::Set,
            period_end: event.expires_at,
        },
    }
}

fn grants_access(update: &SubscriptionUpdate) -> bool {
    matches!(update.plan, Some(plan) if plan != "free")
}

/// Guards the case where a user pays on the web and also has an old store
/// subscription attached to the same account. A stale EXPIRED from that store
/// subscription must not revoke a live Stripe one. Grants still apply, so a
/// genuine move from Stripe to IAP works.
pub fn should_apply(stored_provider: Option<&str>, update: &SubscriptionUpdate) -> bool {
    if stored_provider == Some("stripe") && !grants_access(update) {
        return false;
    }
    true
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SignedPayload {
    #[serde(rename = "signedPayload")]
    signed_payload: String,
}

/// App Store Server Notifications V2.
///
/// Unauthenticated by design and safe that way: the request body *is* the
/// credential. A caller who cannot produce a payload signed by Apple's chain
/// gets nothing through, which is a stronger guarantee than the shared header
/// secret this endpoint used to compare — that secret sat in two dashboards
/// and leaked to whoever could read either.
pub async fn app_store_webhook(State(state): State<AppState>, body: Bytes) -> Result<StatusCode> {
    let envelope: SignedPayload =
        serde_json::from_slice(&body).map_err(|e| AppError::BadRequest(e.to_string()))?;

    let notification: apple::Notification =
        apple::jws::verify(&envelope.signed_payload).map_err(|e| {
            tracing::warn!("app store webhook: signature rejected — {e}");
            AppError::Unauthorized
        })?;

    // Apple's own id for this delivery. Worth carrying into every log line:
    // it is the only handle that ties what we saw to what Apple believes it
    // sent, and retries repeat it.
    let uuid = notification.notification_uuid.as_deref().unwrap_or("-");

    let Some(kind) = kind_for(
        &notification.notification_type,
        notification.subtype.as_deref(),
    ) else {
        tracing::info!(
            "app store webhook [{uuid}]: ignoring {} {:?}",
            notification.notification_type,
            notification.subtype
        );
        return Ok(StatusCode::OK);
    };

    // The transaction is a JWS of its own, and the outer signature says
    // nothing about it. Verifying only the envelope would leave the part that
    // decides who gets what unchecked.
    let Some(signed_tx) = notification
        .data
        .as_ref()
        .and_then(|d| d.signed_transaction_info.as_deref())
    else {
        tracing::info!(
            "app store webhook [{uuid}]: {} carried no transaction",
            notification.notification_type
        );
        return Ok(StatusCode::OK);
    };

    let tx: Transaction = apple::jws::verify(signed_tx).map_err(|e| {
        tracing::warn!("app store webhook [{uuid}]: transaction signature rejected — {e}");
        AppError::Unauthorized
    })?;

    handle(&state, kind, &tx, &format!("app store webhook [{uuid}]")).await?;

    Ok(StatusCode::OK)
}

// ─── Client-side verification ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct VerifyRequest {
    /// The `JWSTransaction` StoreKit handed the app.
    pub signed_transaction: String,
}

/// The app reporting a purchase or a restore.
///
/// Being signed in is not what makes this trustworthy — the JWS is. The
/// authenticated user is used for one thing: refusing to credit a transaction
/// whose `appAccountToken` names somebody else. Without that check, signing
/// into a second account on a device that has already bought Pro would let it
/// claim the first account's purchase.
pub async fn verify_transaction(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<serde_json::Value>> {
    let tx: Transaction = apple::jws::verify(&req.signed_transaction).map_err(|e| {
        tracing::warn!("iap verify: signature rejected for user {} — {e}", auth.id);
        AppError::BadRequest("transaction signature is not valid".into())
    })?;

    let event = match event_from(EventKind::Grant, &tx) {
        Parsed::Handle(e) => e,
        Parsed::Ignore(reason) => {
            tracing::info!("iap verify: ignored for user {} ({reason})", auth.id);
            return Ok(Json(serde_json::json!({ "ok": true })));
        }
    };

    if event.user_id != auth.id {
        tracing::warn!(
            "iap verify: user {} posted a transaction belonging to {}",
            auth.id,
            event.user_id
        );
        return Err(AppError::Unauthorized);
    }

    apply(&state, &event, "iap verify").await?;

    // A body rather than a bare 204: the app's HTTP client parses every
    // response as JSON, and an empty one would throw on success.
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Shared application ───────────────────────────────────────────────────────

/// Builds the event from a verified transaction and writes it. Shared so the
/// webhook and the client path can never disagree about what a purchase means.
async fn handle(state: &AppState, kind: EventKind, tx: &Transaction, origin: &str) -> Result<()> {
    match event_from(kind, tx) {
        Parsed::Handle(event) => apply(state, &event, origin).await,
        Parsed::Ignore(reason) => {
            tracing::info!("{origin}: ignored ({reason})");
            Ok(())
        }
    }
}

async fn apply(state: &AppState, event: &IapEvent, origin: &str) -> Result<()> {
    // Sandbox purchases cost nothing. Accepting one in production is giving
    // Pro away to anyone who can run the app against a sandbox Apple ID, so
    // this is off unless deliberately switched on for store testing.
    if event.environment == Environment::Sandbox && !state.config.apple_accept_sandbox {
        tracing::warn!(
            "{origin}: refused a sandbox transaction for user {} — set APPLE_ACCEPT_SANDBOX=true to allow",
            event.user_id
        );
        return Ok(());
    }

    let update = resolve(event);

    let stored_provider = sqlx::query_scalar!(
        "SELECT payment_provider FROM subscription WHERE user_id = $1",
        event.user_id
    )
    .fetch_optional(&state.pool)
    .await?
    .flatten();

    if !should_apply(stored_provider.as_deref(), &update) {
        tracing::warn!(
            "{origin}: skipped {:?} for user {} — row is owned by stripe",
            event.kind,
            event.user_id
        );
        return Ok(());
    }

    apply_update(state, event, &update).await
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
            payment_provider = 'apple',
            store_transaction_id = COALESCE($6, store_transaction_id),
            store_product_id = COALESCE($7, store_product_id),
            updated_at = NOW()
        WHERE user_id = $8
        "#,
        update.plan,
        update.status,
        set_cancelled,
        clear_cancelled,
        update.period_end,
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
            "iap: no subscription row for user {} — {:?} dropped",
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
    const MONTHLY: &str = "com.pomodoso.app.pro.monthly";
    const ANNUAL: &str = "com.pomodoso.app.pro.annual";
    const LIFETIME: &str = "com.pomodoso.app.founder.lifetime";
    const EXPIRES_MS: i64 = 1_757_678_400_000;

    fn tx_json() -> serde_json::Value {
        json!({
            "transactionId": "txn_1",
            "originalTransactionId": "orig_txn_1",
            "bundleId": apple::BUNDLE_ID,
            "productId": MONTHLY,
            "purchaseDate": 1_755_000_000_000i64,
            "expiresDate": EXPIRES_MS,
            "type": "Auto-Renewable Subscription",
            "appAccountToken": USER,
            "inAppOwnershipType": "PURCHASED",
            "environment": "Production",
        })
    }

    fn tx_from(v: serde_json::Value) -> Transaction {
        serde_json::from_value(v).expect("test transaction should deserialise")
    }

    fn tx() -> Transaction {
        tx_from(tx_json())
    }

    fn handled(kind: EventKind, tx: &Transaction) -> IapEvent {
        match event_from(kind, tx) {
            Parsed::Handle(e) => *e,
            Parsed::Ignore(r) => panic!("expected {kind:?} to be handled, ignored: {r}"),
        }
    }

    // ─── Products ─────────────────────────────────────────────────────────────

    #[test]
    fn every_product_we_sell_maps_to_a_plan() {
        // These strings are the contract with App Store Connect. A typo here
        // is a paying customer who gets nothing, and nothing else would fail.
        assert_eq!(plan_for(MONTHLY), Some("pro"));
        assert_eq!(plan_for(ANNUAL), Some("pro"));
        assert_eq!(plan_for(LIFETIME), Some("founder_lifetime"));
    }

    #[test]
    fn an_unknown_product_grants_nothing() {
        assert_eq!(plan_for("com.pomodoso.app.something.else"), None);

        let mut v = tx_json();
        v["productId"] = json!("com.someone.else.pro");
        assert_eq!(
            event_from(EventKind::Grant, &tx_from(v)),
            Parsed::Ignore("product we do not sell")
        );
    }

    // ─── Notification vocabulary ──────────────────────────────────────────────

    #[test]
    fn purchase_shaped_notifications_grant() {
        for (t, sub) in [
            ("SUBSCRIBED", Some("INITIAL_BUY")),
            ("SUBSCRIBED", Some("RESUBSCRIBE")),
            ("DID_RENEW", None),
            ("DID_RENEW", Some("BILLING_RECOVERY")),
            ("DID_CHANGE_RENEWAL_PREF", Some("UPGRADE")),
            ("ONE_TIME_CHARGE", None),
        ] {
            assert_eq!(kind_for(t, sub), Some(EventKind::Grant), "for {t} {sub:?}");
        }
    }

    #[test]
    fn renewal_status_splits_on_subtype() {
        // Both arrive as DID_CHANGE_RENEWAL_STATUS. Reading the type alone
        // would treat re-enabling auto-renew as cancelling it.
        assert_eq!(
            kind_for("DID_CHANGE_RENEWAL_STATUS", Some("AUTO_RENEW_DISABLED")),
            Some(EventKind::AutoRenewOff)
        );
        assert_eq!(
            kind_for("DID_CHANGE_RENEWAL_STATUS", Some("AUTO_RENEW_ENABLED")),
            Some(EventKind::AutoRenewOn)
        );
        assert_eq!(kind_for("DID_CHANGE_RENEWAL_STATUS", None), None);
    }

    #[test]
    fn failure_and_ending_notifications_map_as_expected() {
        assert_eq!(
            kind_for("DID_FAIL_TO_RENEW", Some("GRACE_PERIOD")),
            Some(EventKind::BillingIssue)
        );
        assert_eq!(
            kind_for("DID_FAIL_TO_RENEW", None),
            Some(EventKind::BillingIssue)
        );
        assert_eq!(
            kind_for("EXPIRED", Some("VOLUNTARY")),
            Some(EventKind::Expired)
        );
        assert_eq!(kind_for("REFUND", None), Some(EventKind::Revoked));
        assert_eq!(kind_for("REVOKE", None), Some(EventKind::Revoked));
    }

    #[test]
    fn notifications_we_do_not_act_on_are_ignored() {
        for t in [
            "TEST",
            "CONSUMPTION_REQUEST",
            "PRICE_INCREASE",
            "RENEWAL_EXTENDED",
            "SUBSCRIPTION_PRICE_CONSENT_REQUEST",
        ] {
            assert_eq!(kind_for(t, None), None, "for {t}");
        }
    }

    // ─── Building an event ────────────────────────────────────────────────────

    #[test]
    fn reads_a_full_subscription_transaction() {
        let event = handled(EventKind::Grant, &tx());

        assert_eq!(event.user_id, Uuid::parse_str(USER).unwrap());
        assert_eq!(event.plan, "pro");
        assert_eq!(event.product_id, MONTHLY);
        assert_eq!(event.environment, Environment::Production);
        assert_eq!(
            event.expires_at,
            DateTime::from_timestamp_millis(EXPIRES_MS)
        );
    }

    #[test]
    fn prefers_the_original_transaction_id_over_the_renewal_one() {
        // Each renewal mints a fresh transactionId; only the original is
        // stable across the life of the subscription, so that is what we key on.
        assert_eq!(
            handled(EventKind::Grant, &tx()).transaction_id.as_deref(),
            Some("orig_txn_1")
        );
    }

    #[test]
    fn falls_back_to_the_transaction_id_when_there_is_no_original() {
        let mut v = tx_json();
        v["originalTransactionId"] = json!(null);

        assert_eq!(
            handled(EventKind::Grant, &tx_from(v))
                .transaction_id
                .as_deref(),
            Some("txn_1")
        );
    }

    #[test]
    fn a_transaction_from_another_app_is_refused() {
        // Apple's signature proves the App Store issued the transaction, not
        // that it was issued for us. Any other developer could otherwise
        // present a genuinely signed purchase from their own app.
        let mut v = tx_json();
        v["bundleId"] = json!("com.someone.else.app");

        assert_eq!(
            event_from(EventKind::Grant, &tx_from(v)),
            Parsed::Ignore("transaction belongs to another app")
        );
    }

    #[test]
    fn a_purchase_with_no_account_token_belongs_to_nobody() {
        let mut v = tx_json();
        v["appAccountToken"] = json!(null);

        assert_eq!(
            event_from(EventKind::Grant, &tx_from(v)),
            Parsed::Ignore("no appAccountToken tying this to one of our users")
        );
    }

    #[test]
    fn an_account_token_that_is_not_a_uuid_is_refused() {
        let mut v = tx_json();
        v["appAccountToken"] = json!("not-a-uuid");

        assert_eq!(
            event_from(EventKind::Grant, &tx_from(v)),
            Parsed::Ignore("no appAccountToken tying this to one of our users")
        );
    }

    #[test]
    fn sandbox_is_recognised_rather_than_silently_treated_as_production() {
        let mut v = tx_json();
        v["environment"] = json!("Sandbox");

        assert_eq!(
            handled(EventKind::Grant, &tx_from(v)).environment,
            Environment::Sandbox
        );
    }

    #[test]
    fn a_refunded_transaction_revokes_whatever_the_notification_claimed() {
        // The trap: a REFUND can reach us carrying a transaction that still
        // looks like a healthy purchase. revocationDate on the transaction is
        // the authority, so even a Grant flips.
        let mut v = tx_json();
        v["revocationDate"] = json!(1_756_000_000_000i64);

        let event = handled(EventKind::Grant, &tx_from(v));

        assert_eq!(event.kind, EventKind::Revoked);
        assert_eq!(resolve(&event).plan, Some("free"));
    }

    // ─── Event → state ────────────────────────────────────────────────────────

    #[test]
    fn a_subscription_grant_activates_pro_until_the_period_end() {
        let update = resolve(&handled(EventKind::Grant, &tx()));

        assert_eq!(update.plan, Some("pro"));
        assert_eq!(update.status, "active");
        assert_eq!(update.cancelled_at, CancelledAt::Clear);
        assert_eq!(
            update.period_end,
            DateTime::from_timestamp_millis(EXPIRES_MS)
        );
    }

    #[test]
    fn lifetime_grants_founder_lifetime_with_no_end_date() {
        // Apple sends no expiresDate for a non-consumable. Writing one would
        // make a permanent purchase look like a subscription about to lapse.
        let mut v = tx_json();
        v["productId"] = json!(LIFETIME);
        v["expiresDate"] = json!(null);
        v["type"] = json!("Non-Consumable");

        let update = resolve(&handled(EventKind::Grant, &tx_from(v)));

        assert_eq!(update.plan, Some("founder_lifetime"));
        assert_eq!(update.status, "active");
        assert_eq!(update.period_end, None, "a lifetime purchase does not end");
    }

    #[test]
    fn cancellation_keeps_access_until_the_period_ends() {
        // On the App Store, auto-renew off means "will not renew", not "access
        // revoked". Dropping the user to free here would cut off someone who
        // has already paid for the rest of the month.
        let update = resolve(&handled(EventKind::AutoRenewOff, &tx()));

        assert_eq!(update.plan, None);
        assert_eq!(update.status, "active");
        assert_eq!(update.cancelled_at, CancelledAt::Set);
        assert_eq!(
            update.period_end,
            DateTime::from_timestamp_millis(EXPIRES_MS)
        );
    }

    #[test]
    fn re_enabling_auto_renew_clears_the_cancellation() {
        let update = resolve(&handled(EventKind::AutoRenewOn, &tx()));

        assert_eq!(update.plan, None);
        assert_eq!(update.status, "active");
        assert_eq!(update.cancelled_at, CancelledAt::Clear);
    }

    #[test]
    fn expiry_and_refund_are_what_actually_drop_the_user_to_free() {
        for kind in [EventKind::Expired, EventKind::Revoked] {
            let update = resolve(&handled(kind, &tx()));

            assert_eq!(update.plan, Some("free"), "for {kind:?}");
            assert_eq!(update.status, "cancelled", "for {kind:?}");
            assert_eq!(update.cancelled_at, CancelledAt::Set, "for {kind:?}");
        }
    }

    #[test]
    fn a_billing_issue_marks_past_due_without_revoking_the_plan() {
        let update = resolve(&handled(EventKind::BillingIssue, &tx()));

        assert_eq!(update.plan, None);
        assert_eq!(update.status, "past_due");
        assert_eq!(update.cancelled_at, CancelledAt::Leave);
    }

    // ─── Stripe guard ─────────────────────────────────────────────────────────

    #[test]
    fn a_stale_store_expiry_cannot_revoke_a_stripe_subscription() {
        for kind in [
            EventKind::Expired,
            EventKind::Revoked,
            EventKind::BillingIssue,
            EventKind::AutoRenewOff,
        ] {
            assert!(
                !should_apply(Some("stripe"), &resolve(&handled(kind, &tx()))),
                "{kind:?} should not touch a stripe-owned row"
            );
        }
    }

    #[test]
    fn a_stripe_user_can_still_move_to_a_store_subscription() {
        assert!(should_apply(
            Some("stripe"),
            &resolve(&handled(EventKind::Grant, &tx()))
        ));
    }

    #[test]
    fn lifetime_counts_as_a_grant_for_the_stripe_guard() {
        // grants_access used to compare against "pro" literally, which made a
        // lifetime purchase look like a revocation and left Stripe owning the
        // row of someone who had just paid 99 dollars.
        let mut v = tx_json();
        v["productId"] = json!(LIFETIME);

        assert!(should_apply(
            Some("stripe"),
            &resolve(&handled(EventKind::Grant, &tx_from(v)))
        ));
    }

    #[test]
    fn store_owned_and_brand_new_rows_apply_every_event() {
        for provider in [None, Some("apple")] {
            for kind in [
                EventKind::Grant,
                EventKind::AutoRenewOff,
                EventKind::Expired,
                EventKind::BillingIssue,
                EventKind::Revoked,
            ] {
                assert!(
                    should_apply(provider, &resolve(&handled(kind, &tx()))),
                    "provider {provider:?} should apply {kind:?}"
                );
            }
        }
    }
}
