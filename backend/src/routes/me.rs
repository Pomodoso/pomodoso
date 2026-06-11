use axum::{extract::State, Extension, Json};
use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    error::Result,
    middleware::auth::AuthUser,
    models::{Entitlements, Subscription, User},
    AppState,
};

#[derive(Serialize)]
pub struct MeResponse {
    pub user: User,
    pub entitlements: Entitlements,
}

/// Returns the authenticated user + entitlements.
/// On first call for a new Supabase user, provisions user + default workspace + free subscription.
pub async fn get_me(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<MeResponse>> {
    let user = upsert_user(&state, &auth).await?;
    let (sub, is_new) = get_or_create_subscription(&state, user.id).await?;
    if is_new {
        crate::email::send_welcome(&state, &user.email, &user.name);
    }
    let entitlements = Entitlements::from_subscription(&sub);

    Ok(Json(MeResponse { user, entitlements }))
}

pub async fn get_entitlements(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Entitlements>> {
    let (sub, _) = get_or_create_subscription(&state, auth.id).await?;
    Ok(Json(Entitlements::from_subscription(&sub)))
}

#[derive(Serialize)]
pub struct DeviceInfo {
    pub id: Uuid,
    pub kind: String,
    pub name: String,
    pub browser: String,
    pub version: String,
    pub last_seen_at: DateTime<Utc>,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// Devices that have registered against this account (extension installs, web sessions).
pub async fn get_devices(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Vec<DeviceInfo>>> {
    let rows = sqlx::query_as!(
        DeviceInfo,
        r#"
        SELECT id, kind, name, browser, version, last_seen_at, last_sync_at, created_at
        FROM device
        WHERE user_id = $1
        ORDER BY last_seen_at DESC
        "#,
        auth.id,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async fn upsert_user(state: &AppState, auth: &AuthUser) -> Result<User> {
    let user = sqlx::query_as!(
        User,
        r#"
        INSERT INTO "user" (id, email, name, avatar_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE
          SET email      = EXCLUDED.email,
              name       = EXCLUDED.name,
              avatar_url = COALESCE(EXCLUDED.avatar_url, "user".avatar_url),
              updated_at = NOW()
        RETURNING id, email, name, avatar_url, created_at, updated_at
        "#,
        auth.id,
        auth.email,
        auth.name,
        auth.avatar_url,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(user)
}

/// Returns the user's subscription and whether it was just created on this call
/// (used to fire the welcome email exactly once).
async fn get_or_create_subscription(
    state: &AppState,
    user_id: Uuid,
) -> Result<(Subscription, bool)> {
    // Try to get existing subscription
    let existing = sqlx::query_as!(
        Subscription,
        r#"
        SELECT id, user_id, plan, status,
               stripe_customer_id, stripe_subscription_id,
               current_period_end, trial_ends_at, cancelled_at,
               feature_overrides, created_at, updated_at
        FROM subscription
        WHERE user_id = $1
        "#,
        user_id,
    )
    .fetch_optional(&state.pool)
    .await?;

    if let Some(sub) = existing {
        return Ok((sub, false));
    }

    // First login: provision free subscription. No server-side workspace —
    // workspaces are client-owned and arrive via sync push (creating one here
    // produced a duplicate "Personal" alongside the extension's local one).
    provision_new_user(state, user_id).await
}

async fn provision_new_user(state: &AppState, user_id: Uuid) -> Result<(Subscription, bool)> {
    // ON CONFLICT DO NOTHING guards against race conditions when two requests
    // arrive simultaneously for a new user. rows_affected() tells us whether
    // THIS call created the row (→ send welcome) vs. lost the race.
    let created = sqlx::query!(
        "INSERT INTO subscription (id, user_id, plan, status)
         VALUES (gen_random_uuid(), $1, 'free', 'active')
         ON CONFLICT (user_id) DO NOTHING",
        user_id,
    )
    .execute(&state.pool)
    .await?
    .rows_affected()
        > 0;

    let sub = sqlx::query_as!(
        Subscription,
        r#"
        SELECT id, user_id, plan, status,
               stripe_customer_id, stripe_subscription_id,
               current_period_end, trial_ends_at, cancelled_at,
               feature_overrides, created_at, updated_at
        FROM subscription WHERE user_id = $1
        "#,
        user_id,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok((sub, created))
}
