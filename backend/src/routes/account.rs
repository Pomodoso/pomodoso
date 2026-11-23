//! Account deletion (App Store guideline 5.1.1(v), and GDPR erasure).
//!
//! A hard delete, on purpose: the soft-delete rule exists so sync can carry
//! tombstones between a user's devices, and once the account is gone there is
//! nobody left to sync to. Every user-owned table cascades from "user"; the
//! plugin directory keeps the author's listings, taken down and ownerless, so
//! their slugs stay reserved (migration 021). The id goes into
//! `deleted_account` so a still-valid access token cannot provision the
//! account again through /me.

use axum::{extract::State, http::StatusCode, Extension};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    routes::me::get_or_create_subscription,
    AppState,
};

pub async fn delete_account(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<StatusCode> {
    // A second request (a retry, another device) finds nothing left to do.
    if is_deleted(&state, auth.id).await? {
        return Ok(StatusCode::NO_CONTENT);
    }

    // Checked before anything is touched: without it the data would go and the
    // login would stay, and signing back in would provision a fresh account.
    let service_key = state
        .config
        .supabase_service_role_key
        .as_deref()
        .ok_or_else(|| {
            AppError::Internal(anyhow::anyhow!(
                "SUPABASE_SERVICE_ROLE_KEY not set — cannot delete accounts"
            ))
        })?;

    // A Stripe subscription would keep billing a person who no longer has an
    // account, so it is cancelled first, and a failure stops the deletion. App
    // Store subscriptions cannot be cancelled by a server — only by the person,
    // from their Apple ID settings — which the app says before confirming.
    //
    // Keyed on the stored id alone. Neither `payment_provider` (Stripe checkout
    // does not set it) nor `cancelled_at` (cancel-at-period-end still bills
    // until then) is reliable enough to skip a live subscription on.
    let (sub, _) = get_or_create_subscription(&state, auth.id).await?;
    if let Some(sub_id) = sub
        .stripe_subscription_id
        .as_deref()
        .filter(|id| id.starts_with("sub_"))
    {
        cancel_stripe_subscription(&state, sub_id).await?;
    }

    // The database delete commits only once Supabase has removed the login, so
    // a Supabase failure leaves the account whole rather than half gone.
    let mut tx = state.pool.begin().await?;

    // Locked first: a publish inserting a listing takes a key-share lock on
    // this row, so it either finishes before the take-down below sees it, or
    // waits and then fails on the deleted owner. Without the lock a listing
    // committed in between would end up ownerless and still public.
    sqlx::query!(r#"SELECT id FROM "user" WHERE id = $1 FOR UPDATE"#, auth.id)
        .fetch_optional(&mut *tx)
        .await?;

    sqlx::query!(
        "UPDATE plugin_listing SET deleted_at = COALESCE(deleted_at, NOW()) WHERE owner_user_id = $1",
        auth.id,
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query!(r#"DELETE FROM "user" WHERE id = $1"#, auth.id)
        .execute(&mut *tx)
        .await?;

    sqlx::query!(
        "INSERT INTO deleted_account (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
        auth.id,
    )
    .execute(&mut *tx)
    .await?;

    delete_supabase_user(&state, service_key, auth.id).await?;

    tx.commit().await?;

    tracing::info!("account {} deleted", auth.id);
    Ok(StatusCode::NO_CONTENT)
}

/// Whether this id belonged to an account that has been deleted. Checked
/// before /me provisions a user, since a deleted login's access tokens stay
/// valid until they expire.
pub async fn is_deleted(state: &AppState, user_id: Uuid) -> Result<bool> {
    let deleted = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM deleted_account WHERE user_id = $1) AS "deleted!""#,
        user_id,
    )
    .fetch_one(&state.pool)
    .await?;
    Ok(deleted)
}

async fn delete_supabase_user(state: &AppState, key: &str, user_id: Uuid) -> Result<()> {
    let url = format!(
        "{}/auth/v1/admin/users/{user_id}",
        state.config.supabase_url.trim_end_matches('/')
    );
    let mut req = state.http.delete(url).header("apikey", key);
    // Legacy service_role keys are JWTs and go in Authorization too. The new
    // `sb_secret_…` keys are not JWTs and are refused there.
    if !key.starts_with("sb_secret_") {
        req = req.bearer_auth(key);
    }
    let resp = req.send().await.map_err(|e| AppError::Internal(e.into()))?;

    // Already gone counts as done: a retry after a commit that failed must
    // still be able to finish.
    if resp.status().is_success() || resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(());
    }
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    Err(AppError::Internal(anyhow::anyhow!(
        "supabase admin delete failed ({status}): {body}"
    )))
}

async fn cancel_stripe_subscription(state: &AppState, sub_id: &str) -> Result<()> {
    let Some(secret) = state.config.stripe_secret_key.as_deref() else {
        return Err(AppError::Internal(anyhow::anyhow!(
            "stripe subscription {sub_id} cannot be cancelled: STRIPE_SECRET_KEY not set"
        )));
    };
    let resp = state
        .http
        .delete(format!("https://api.stripe.com/v1/subscriptions/{sub_id}"))
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    if resp.status().is_success() {
        return Ok(());
    }
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    // Cancelling an already-cancelled subscription is an error on Stripe's
    // side. Ask what state it is in before treating the failure as real.
    let current: serde_json::Value = state
        .http
        .get(format!("https://api.stripe.com/v1/subscriptions/{sub_id}"))
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|e| AppError::Internal(e.into()))?
        .json()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    if matches!(
        current["status"].as_str(),
        Some("canceled" | "incomplete_expired")
    ) {
        return Ok(());
    }
    Err(AppError::Internal(anyhow::anyhow!(
        "stripe cancel of {sub_id} failed ({status}): {body}"
    )))
}
