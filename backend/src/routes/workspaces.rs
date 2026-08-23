use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    AppState,
};

use super::today::require_workspace_access;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ListWorkspacesQuery {
    /// The workspace switcher only ever wants active workspaces, so archived
    /// ones are excluded by default — only the workspace settings page (which
    /// needs to show/unarchive them) passes this.
    #[serde(default)]
    pub include_archived: bool,
}

#[derive(Serialize)]
pub struct WorkspaceInfo {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub archived_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
pub struct UpdateWorkspaceBody {
    pub name: Option<String>,
    pub color: Option<String>,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_workspaces(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<ListWorkspacesQuery>,
) -> Result<Json<Vec<WorkspaceInfo>>> {
    let rows = sqlx::query!(
        r#"
        SELECT w.id, w.name, w.color, w.archived_at
        FROM workspace w
        JOIN workspace_member m ON m.workspace_id = w.id
        WHERE m.user_id = $1 AND w.deleted_at IS NULL
          AND ($2 OR w.archived_at IS NULL)
        ORDER BY w.archived_at IS NOT NULL, GREATEST(
          w.updated_at,
          COALESCE(
            (SELECT MAX(t.synced_at) FROM task t WHERE t.workspace_id = w.id),
            w.updated_at
          )
        ) DESC
        "#,
        auth.id,
        q.include_archived,
    )
    .fetch_all(&state.pool)
    .await?;

    let workspaces = rows
        .into_iter()
        .map(|r| WorkspaceInfo {
            id: r.id,
            name: r.name,
            color: r.color,
            archived_at: r.archived_at,
        })
        .collect();

    Ok(Json(workspaces))
}

pub async fn update_workspace(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateWorkspaceBody>,
) -> Result<Json<WorkspaceInfo>> {
    require_workspace_access(&state, auth.id, id).await?;

    if let Some(name) = &body.name {
        if name.trim().is_empty() {
            return Err(AppError::BadRequest("name cannot be empty".into()));
        }
    }

    let row = sqlx::query!(
        r#"UPDATE workspace SET
             name = COALESCE($2, name),
             color = COALESCE($3, color),
             updated_at = NOW()
           WHERE id = $1
           RETURNING id, name, color, archived_at"#,
        id,
        body.name.as_deref().map(str::trim),
        body.color,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(WorkspaceInfo {
        id: row.id,
        name: row.name,
        color: row.color,
        archived_at: row.archived_at,
    }))
}

pub async fn archive_workspace(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkspaceInfo>> {
    require_workspace_access(&state, auth.id, id).await?;

    let row = sqlx::query!(
        r#"UPDATE workspace SET archived_at = NOW(), updated_at = NOW()
           WHERE id = $1
           RETURNING id, name, color, archived_at"#,
        id,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(WorkspaceInfo {
        id: row.id,
        name: row.name,
        color: row.color,
        archived_at: row.archived_at,
    }))
}

pub async fn unarchive_workspace(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkspaceInfo>> {
    require_workspace_access(&state, auth.id, id).await?;

    let row = sqlx::query!(
        r#"UPDATE workspace SET archived_at = NULL, updated_at = NOW()
           WHERE id = $1
           RETURNING id, name, color, archived_at"#,
        id,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(WorkspaceInfo {
        id: row.id,
        name: row.name,
        color: row.color,
        archived_at: row.archived_at,
    }))
}

pub async fn delete_workspace(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    require_workspace_access(&state, auth.id, id).await?;

    // Soft delete only (CLAUDE.md rule 4) — the workspace disappears from every
    // list (they all filter on w.deleted_at IS NULL), but its tasks/projects/
    // sessions are left alone rather than cascading, since nothing else in the
    // product hard-deletes a user's tracked history when they remove a
    // workspace.
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) FROM workspace_member m
        JOIN workspace w ON w.id = m.workspace_id
        WHERE m.user_id = $1 AND w.deleted_at IS NULL
        "#,
        auth.id,
    )
    .fetch_one(&state.pool)
    .await?
    .unwrap_or(0);

    if count <= 1 {
        return Err(AppError::BadRequest(
            "cannot delete your only workspace".into(),
        ));
    }

    sqlx::query!(
        "UPDATE workspace SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
        id,
    )
    .execute(&state.pool)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}
