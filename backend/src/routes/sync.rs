use axum::{
    extract::{Query, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    AppState,
};

#[derive(Deserialize)]
pub struct PullQuery {
    #[allow(dead_code)]
    pub since: Option<DateTime<Utc>>,
    pub workspace_id: uuid::Uuid,
}

#[derive(Deserialize)]
pub struct PushBody {
    workspace_id: uuid::Uuid,
    entities: Vec<SyncEntity>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncEntity {
    pub table: String,
    pub id: uuid::Uuid,
    pub data: Value,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct PullResponse {
    pub entities: Vec<SyncEntity>,
    pub server_time: DateTime<Utc>,
}

pub async fn push(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<PushBody>,
) -> Result<Json<Value>> {
    require_sync_entitlement(&state, auth.id).await?;
    require_workspace_access(&state, auth.id, body.workspace_id).await?;

    // TODO: implement LWW push for each entity table
    // For now, return accepted count
    let accepted = body.entities.len();

    Ok(Json(serde_json::json!({ "accepted": accepted })))
}

pub async fn pull(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<PullQuery>,
) -> Result<Json<PullResponse>> {
    require_sync_entitlement(&state, auth.id).await?;
    require_workspace_access(&state, auth.id, q.workspace_id).await?;

    // TODO: implement pull for each entity table
    Ok(Json(PullResponse {
        entities: vec![],
        server_time: Utc::now(),
    }))
}

// ─── Guards ───────────────────────────────────────────────────────────────────

async fn require_sync_entitlement(state: &AppState, user_id: uuid::Uuid) -> Result<()> {
    let sub = sqlx::query!(
        "SELECT plan, feature_overrides FROM subscription WHERE user_id = $1",
        user_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Forbidden)?;

    let is_paid = matches!(sub.plan.as_str(), "pro" | "founder_lifetime");
    let override_sync = sub
        .feature_overrides
        .as_ref()
        .and_then(|v| v.get("sync"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if !is_paid && !override_sync {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

async fn require_workspace_access(
    state: &AppState,
    user_id: uuid::Uuid,
    workspace_id: uuid::Uuid,
) -> Result<()> {
    let exists = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2)",
        workspace_id,
        user_id,
    )
    .fetch_one(&state.pool)
    .await?
    .unwrap_or(false);

    if !exists {
        return Err(AppError::Forbidden);
    }
    Ok(())
}
