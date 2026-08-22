use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::NaiveDate;
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
pub struct ProjectsQuery {
    pub workspace_id: Uuid,
}

#[derive(Serialize)]
pub struct ProjectInfo {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    pub color: String,
    pub end_date: Option<NaiveDate>,
}

#[derive(Deserialize)]
pub struct CreateProjectBody {
    pub workspace_id: Uuid,
    pub name: String,
    pub color: String,
}

#[derive(Deserialize)]
pub struct UpdateProjectBody {
    pub name: Option<String>,
    pub color: Option<String>,
}

// Resolves a project's workspace_id and checks the caller has access to it —
// unlike /today, a project id alone doesn't tell us which workspace to check
// against, so this looks the row up first. Returns NotFound rather than
// Forbidden for a project that doesn't exist at all, so a client can't use
// the error to distinguish "wrong workspace" from "no such project" against
// someone else's data.
async fn require_project_access(state: &AppState, user_id: Uuid, project_id: Uuid) -> Result<Uuid> {
    let workspace_id = sqlx::query_scalar!(
        "SELECT workspace_id FROM project WHERE id = $1 AND deleted_at IS NULL",
        project_id,
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    require_workspace_access(state, user_id, workspace_id).await?;
    Ok(workspace_id)
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_projects(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<ProjectsQuery>,
) -> Result<Json<Vec<ProjectInfo>>> {
    require_workspace_access(&state, auth.id, q.workspace_id).await?;

    let rows = sqlx::query!(
        r#"SELECT id, workspace_id, name, color, end_date FROM project
           WHERE workspace_id = $1 AND deleted_at IS NULL
           ORDER BY end_date IS NOT NULL, name"#,
        q.workspace_id,
    )
    .fetch_all(&state.pool)
    .await?;

    let projects = rows
        .into_iter()
        .map(|r| ProjectInfo {
            id: r.id,
            workspace_id: r.workspace_id,
            name: r.name,
            color: r.color,
            end_date: r.end_date,
        })
        .collect();

    Ok(Json(projects))
}

pub async fn create_project(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateProjectBody>,
) -> Result<Json<ProjectInfo>> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    require_workspace_access(&state, auth.id, body.workspace_id).await?;

    let id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO project (id, workspace_id, name, color, updated_at, synced_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())"#,
        id,
        body.workspace_id,
        name,
        body.color,
    )
    .execute(&state.pool)
    .await?;

    Ok(Json(ProjectInfo {
        id,
        workspace_id: body.workspace_id,
        name: name.to_owned(),
        color: body.color,
        end_date: None,
    }))
}

pub async fn update_project(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateProjectBody>,
) -> Result<Json<ProjectInfo>> {
    require_project_access(&state, auth.id, id).await?;

    if let Some(name) = &body.name {
        if name.trim().is_empty() {
            return Err(AppError::BadRequest("name cannot be empty".into()));
        }
    }

    let row = sqlx::query!(
        r#"UPDATE project SET
             name = COALESCE($2, name),
             color = COALESCE($3, color),
             updated_at = NOW()
           WHERE id = $1
           RETURNING id, workspace_id, name, color, end_date"#,
        id,
        body.name.as_deref().map(str::trim),
        body.color,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(ProjectInfo {
        id: row.id,
        workspace_id: row.workspace_id,
        name: row.name,
        color: row.color,
        end_date: row.end_date,
    }))
}

pub async fn archive_project(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<ProjectInfo>> {
    require_project_access(&state, auth.id, id).await?;

    let row = sqlx::query!(
        r#"UPDATE project SET end_date = CURRENT_DATE, updated_at = NOW()
           WHERE id = $1
           RETURNING id, workspace_id, name, color, end_date"#,
        id,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(ProjectInfo {
        id: row.id,
        workspace_id: row.workspace_id,
        name: row.name,
        color: row.color,
        end_date: row.end_date,
    }))
}

pub async fn unarchive_project(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<ProjectInfo>> {
    require_project_access(&state, auth.id, id).await?;

    let row = sqlx::query!(
        r#"UPDATE project SET end_date = NULL, updated_at = NOW()
           WHERE id = $1
           RETURNING id, workspace_id, name, color, end_date"#,
        id,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(ProjectInfo {
        id: row.id,
        workspace_id: row.workspace_id,
        name: row.name,
        color: row.color,
        end_date: row.end_date,
    }))
}

pub async fn delete_project(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    require_project_access(&state, auth.id, id).await?;

    sqlx::query!(
        "UPDATE project SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
        id,
    )
    .execute(&state.pool)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}
