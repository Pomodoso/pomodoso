use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    Extension, Json,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::Value;
use sha2::Sha256;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    AppState,
};

#[derive(Deserialize)]
pub struct CheckoutBody {
    /// "annual" | "monthly" | "lifetime"
    pub price: String,
    pub success_url: String,
    pub cancel_url: String,
}

fn require_stripe(state: &AppState) -> Result<&str> {
    state
        .config
        .stripe_secret_key
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("billing not configured".into()))
}

pub async fn create_checkout(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CheckoutBody>,
) -> Result<Json<Value>> {
    require_stripe(&state)?;

    let price_id = match body.price.as_str() {
        "annual" => state
            .config
            .stripe_pro_annual_price_id
            .clone()
            .ok_or_else(|| AppError::BadRequest("annual price not configured".into()))?,
        "monthly" => state
            .config
            .stripe_pro_monthly_price_id
            .clone()
            .ok_or_else(|| AppError::BadRequest("monthly price not configured".into()))?,
        "lifetime" => state
            .config
            .stripe_founder_lifetime_price_id
            .clone()
            .ok_or_else(|| AppError::BadRequest("lifetime plan not available".into()))?,
        _ => return Err(AppError::BadRequest("invalid price".into())),
    };

    let stripe_customer_id = get_or_create_stripe_customer(&state, auth.id, &auth.email).await?;

    let mode = if body.price == "lifetime" {
        "payment"
    } else {
        "subscription"
    };

    let url = stripe_create_checkout_session(
        &state,
        &stripe_customer_id,
        &price_id,
        mode,
        &body.success_url,
        &body.cancel_url,
    )
    .await?;

    Ok(Json(serde_json::json!({ "url": url })))
}

pub async fn create_portal(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let return_url = body
        .get("return_url")
        .and_then(|v| v.as_str())
        .unwrap_or(&state.config.frontend_url)
        .to_string();

    let stripe_customer_id = sqlx::query_scalar!(
        "SELECT stripe_customer_id FROM subscription WHERE user_id = $1",
        auth.id
    )
    .fetch_optional(&state.pool)
    .await?
    .flatten()
    .ok_or_else(|| AppError::BadRequest("no billing account found".into()))?;

    let url = stripe_create_portal_session(&state, &stripe_customer_id, &return_url).await?;

    Ok(Json(serde_json::json!({ "url": url })))
}

/// Stripe webhook handler — verifies signature then routes events.
pub async fn stripe_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode> {
    let sig = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            tracing::warn!("stripe webhook: missing stripe-signature header");
            AppError::Unauthorized
        })?;

    let webhook_secret = state
        .config
        .stripe_webhook_secret
        .as_deref()
        .ok_or_else(|| {
            tracing::warn!("stripe webhook: no webhook secret configured");
            AppError::Unauthorized
        })?;

    let event = verify_stripe_signature(webhook_secret, sig, &body).map_err(|e| {
        tracing::warn!("stripe webhook: signature verification failed: {e}");
        AppError::Unauthorized
    })?;

    match event["type"].as_str().unwrap_or("") {
        "checkout.session.completed" => handle_checkout_completed(&state, &event).await?,
        "customer.subscription.updated" => handle_subscription_updated(&state, &event).await?,
        "customer.subscription.deleted" => handle_subscription_deleted(&state, &event).await?,
        "invoice.payment_failed" => handle_payment_failed(&state, &event).await?,
        _ => {}
    }

    Ok(StatusCode::OK)
}

// ─── Stripe API ───────────────────────────────────────────────────────────────

async fn get_or_create_stripe_customer(
    state: &AppState,
    user_id: uuid::Uuid,
    email: &str,
) -> Result<String> {
    let existing = sqlx::query_scalar!(
        "SELECT stripe_customer_id FROM subscription WHERE user_id = $1",
        user_id
    )
    .fetch_optional(&state.pool)
    .await?
    .flatten();

    if let Some(id) = existing {
        return Ok(id);
    }

    let user_id_str = user_id.to_string();
    let params = [
        ("email", email),
        ("metadata[user_id]", user_id_str.as_str()),
    ];

    let stripe_key = require_stripe(state)?;
    let resp: Value = state
        .http
        .post("https://api.stripe.com/v1/customers")
        .bearer_auth(stripe_key)
        .form(&params)
        .send()
        .await
        .map_err(|e| AppError::Internal(e.into()))?
        .json()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    let customer_id = resp["id"]
        .as_str()
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("stripe customer creation failed")))?
        .to_string();

    sqlx::query!(
        "UPDATE subscription SET stripe_customer_id = $1 WHERE user_id = $2",
        customer_id,
        user_id
    )
    .execute(&state.pool)
    .await?;

    Ok(customer_id)
}

async fn stripe_create_checkout_session(
    state: &AppState,
    customer_id: &str,
    price_id: &str,
    mode: &str,
    success_url: &str,
    cancel_url: &str,
) -> Result<String> {
    let params = [
        ("customer", customer_id),
        ("mode", mode),
        ("line_items[0][price]", price_id),
        ("line_items[0][quantity]", "1"),
        ("success_url", success_url),
        ("cancel_url", cancel_url),
        ("allow_promotion_codes", "true"),
    ];

    let resp: Value = state
        .http
        .post("https://api.stripe.com/v1/checkout/sessions")
        .bearer_auth(require_stripe(state)?)
        .form(&params)
        .send()
        .await
        .map_err(|e| AppError::Internal(e.into()))?
        .json()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    resp["url"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("stripe checkout session failed")))
}

async fn stripe_create_portal_session(
    state: &AppState,
    customer_id: &str,
    return_url: &str,
) -> Result<String> {
    let params = [("customer", customer_id), ("return_url", return_url)];

    let resp: Value = state
        .http
        .post("https://api.stripe.com/v1/billing_portal/sessions")
        .bearer_auth(require_stripe(state)?)
        .form(&params)
        .send()
        .await
        .map_err(|e| AppError::Internal(e.into()))?
        .json()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    resp["url"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("stripe portal session failed")))
}

fn verify_stripe_signature(secret: &str, sig_header: &str, body: &[u8]) -> anyhow::Result<Value> {
    let mut timestamp = "";
    let mut signatures: Vec<&str> = vec![];

    for part in sig_header.split(',') {
        if let Some(ts) = part.strip_prefix("t=") {
            timestamp = ts;
        } else if let Some(s) = part.strip_prefix("v1=") {
            signatures.push(s);
        }
    }

    anyhow::ensure!(
        !timestamp.is_empty() && !signatures.is_empty(),
        "invalid signature header"
    );

    let signed_payload = format!("{}.{}", timestamp, String::from_utf8_lossy(body));

    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|_| anyhow::anyhow!("invalid hmac key"))?;
    mac.update(signed_payload.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());

    anyhow::ensure!(
        signatures.iter().any(|s| *s == expected),
        "signature mismatch"
    );

    Ok(serde_json::from_slice(body)?)
}

// ─── Webhook handlers ─────────────────────────────────────────────────────────

async fn handle_checkout_completed(state: &AppState, event: &Value) -> Result<()> {
    let session = &event["data"]["object"];
    let customer_id = session["customer"].as_str().unwrap_or("");
    let subscription_id = session["subscription"].as_str();
    let payment_intent = session["payment_intent"].as_str();

    if customer_id.is_empty() {
        return Ok(());
    }

    let plan = if subscription_id.is_some() {
        "pro"
    } else {
        "founder_lifetime"
    };
    let stripe_sub_id = subscription_id.or(payment_intent);

    sqlx::query!(
        r#"
        UPDATE subscription
        SET plan = $1, status = 'active',
            stripe_subscription_id = COALESCE($2, stripe_subscription_id),
            updated_at = NOW()
        WHERE stripe_customer_id = $3
        "#,
        plan,
        stripe_sub_id,
        customer_id,
    )
    .execute(&state.pool)
    .await?;

    // Confirmation email — best effort, fire and forget.
    if let Some(u) = sqlx::query!(
        r#"SELECT u.email, u.name FROM "user" u
           JOIN subscription s ON s.user_id = u.id
           WHERE s.stripe_customer_id = $1"#,
        customer_id,
    )
    .fetch_optional(&state.pool)
    .await?
    {
        crate::email::send_payment_confirmation(state, &u.email, &u.name, plan);
    }

    Ok(())
}

async fn handle_subscription_updated(state: &AppState, event: &Value) -> Result<()> {
    let sub = &event["data"]["object"];
    let subscription_id = sub["id"].as_str().unwrap_or("");

    let db_status = match sub["status"].as_str().unwrap_or("active") {
        "active" => "active",
        "trialing" => "trialing",
        "past_due" => "past_due",
        _ => "cancelled",
    };

    let current_period_end = sub["current_period_end"]
        .as_i64()
        .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0));

    sqlx::query!(
        r#"
        UPDATE subscription
        SET status = $1, current_period_end = $2, updated_at = NOW()
        WHERE stripe_subscription_id = $3
        "#,
        db_status,
        current_period_end,
        subscription_id,
    )
    .execute(&state.pool)
    .await?;

    Ok(())
}

async fn handle_subscription_deleted(state: &AppState, event: &Value) -> Result<()> {
    let sub = &event["data"]["object"];
    let subscription_id = sub["id"].as_str().unwrap_or("");

    sqlx::query!(
        r#"
        UPDATE subscription
        SET plan = 'free', status = 'cancelled',
            cancelled_at = NOW(), updated_at = NOW()
        WHERE stripe_subscription_id = $1
        "#,
        subscription_id,
    )
    .execute(&state.pool)
    .await?;

    Ok(())
}

async fn handle_payment_failed(state: &AppState, event: &Value) -> Result<()> {
    let invoice = &event["data"]["object"];
    let subscription_id = invoice["subscription"].as_str().unwrap_or("");

    sqlx::query!(
        "UPDATE subscription SET status = 'past_due', updated_at = NOW() WHERE stripe_subscription_id = $1",
        subscription_id,
    )
    .execute(&state.pool)
    .await?;

    Ok(())
}
