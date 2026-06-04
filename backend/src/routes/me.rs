use axum::{extract::State, Extension, Json};
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
    let sub = get_or_create_subscription(&state, user.id).await?;
    let entitlements = Entitlements::from_subscription(&sub);

    Ok(Json(MeResponse { user, entitlements }))
}

pub async fn get_entitlements(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Entitlements>> {
    let sub = get_or_create_subscription(&state, auth.id).await?;
    Ok(Json(Entitlements::from_subscription(&sub)))
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

async fn get_or_create_subscription(state: &AppState, user_id: Uuid) -> Result<Subscription> {
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
        return Ok(sub);
    }

    // First login: provision default workspace + free subscription
    provision_new_user(state, user_id).await
}

async fn provision_new_user(state: &AppState, user_id: Uuid) -> Result<Subscription> {
    let mut tx = state.pool.begin().await?;

    // Insert subscription first — ON CONFLICT DO NOTHING guards against race conditions
    // when two requests arrive simultaneously for a new user.
    let inserted = sqlx::query!(
        "INSERT INTO subscription (id, user_id, plan, status)
         VALUES (gen_random_uuid(), $1, 'free', 'active')
         ON CONFLICT (user_id) DO NOTHING",
        user_id,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();

    // Only provision workspace when this request actually created the subscription.
    if inserted > 0 {
        let ws_id = Uuid::new_v4();
        sqlx::query!(
            "INSERT INTO workspace (id, owner_id, name, color)
             VALUES ($1, $2, 'Personal', '#6366f1')",
            ws_id,
            user_id,
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "INSERT INTO workspace_member (workspace_id, user_id, role)
             VALUES ($1, $2, 'owner')",
            ws_id,
            user_id,
        )
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

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

    Ok(sub)
}
