use axum::{
    extract::{Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    AppState,
};

#[derive(Deserialize)]
pub struct PullQuery {
    pub since: Option<DateTime<Utc>>,
    pub workspace_id: Option<uuid::Uuid>,
}

#[derive(Deserialize)]
pub struct PushBody {
    workspace_id: uuid::Uuid,
    entities: Vec<SyncEntity>,
}

fn default_ts() -> DateTime<Utc> { Utc::now() }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncEntity {
    pub table: String,
    pub id: String,                     // accept any string; parse to UUID per-function
    pub data: Value,
    #[serde(default = "default_ts")]    // tolerate missing field from old client builds
    pub updated_at: DateTime<Utc>,
    #[serde(default)]                   // tolerate missing field (same as null)
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct PullResponse {
    pub entities: Vec<SyncEntity>,
    pub server_time: DateTime<Utc>,
}

// ─── Push ─────────────────────────────────────────────────────────────────────

pub async fn push(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<PushBody>,
) -> Result<Json<Value>> {
    require_sync_entitlement(&state, auth.id).await?;

    let mut accepted = 0usize;

    // Pass 1: workspaces first — bootstraps membership so pass 2 access check works
    for entity in body.entities.iter().filter(|e| e.table == "workspace") {
        push_workspace(&state, auth.id, entity).await?;
        accepted += 1;
    }

    // User settings (timer prefs, active timer) — scoped to user, not workspace
    for entity in body.entities.iter().filter(|e| e.table == "user_setting") {
        if push_user_setting(&state, auth.id, entity).await.is_ok() {
            accepted += 1;
        }
    }

    // Pass 2: other entities — require the workspace to exist and belong to this user
    require_workspace_access(&state, auth.id, body.workspace_id).await?;

    for entity in body.entities.iter().filter(|e| !matches!(e.table.as_str(), "workspace" | "user_setting")) {
        let ok = match entity.table.as_str() {
            "project"   => push_project(&state, body.workspace_id, entity).await.is_ok(),
            "task"      => push_task(&state, body.workspace_id, entity).await.is_ok(),
            "habit"     => push_habit(&state, body.workspace_id, entity).await.is_ok(),
            "habit_log" => push_habit_log(&state, body.workspace_id, entity).await.is_ok(),
            _ => false,
        };
        if ok { accepted += 1; }
    }

    Ok(Json(serde_json::json!({ "accepted": accepted })))
}

fn parse_entity_id(e: &SyncEntity) -> Option<uuid::Uuid> {
    uuid::Uuid::parse_str(&e.id).ok()
}

async fn push_workspace(state: &AppState, user_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let id    = match parse_entity_id(e) { Some(v) => v, None => return Ok(()) };
    let name  = e.data["name"].as_str().unwrap_or("Workspace").to_owned();
    let color = e.data["color"].as_str().unwrap_or("#6366f1").to_owned();

    sqlx::query!(
        r#"
        INSERT INTO workspace (id, owner_id, name, color, updated_at, deleted_at, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name       = EXCLUDED.name,
          color      = EXCLUDED.color,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at,
          synced_at  = NOW()
        WHERE EXCLUDED.updated_at > workspace.updated_at
        "#,
        id, user_id, name, color, e.updated_at, e.deleted_at,
    )
    .execute(&state.pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO workspace_member (workspace_id, user_id, role)
        VALUES ($1, $2, 'owner')
        ON CONFLICT (workspace_id, user_id) DO NOTHING
        "#,
        id, user_id,
    )
    .execute(&state.pool)
    .await?;

    Ok(())
}

async fn push_project(state: &AppState, workspace_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let id    = match parse_entity_id(e) { Some(v) => v, None => return Ok(()) };
    let name  = e.data["name"].as_str().unwrap_or("").to_owned();
    let color = e.data["color"].as_str().unwrap_or("#6366f1").to_owned();

    sqlx::query!(
        r#"
        INSERT INTO project (id, workspace_id, name, color, updated_at, deleted_at, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name       = EXCLUDED.name,
          color      = EXCLUDED.color,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at,
          synced_at  = NOW()
        WHERE EXCLUDED.updated_at > project.updated_at
        "#,
        id, workspace_id, name, color, e.updated_at, e.deleted_at,
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn push_task(state: &AppState, workspace_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let id         = match parse_entity_id(e) { Some(v) => v, None => return Ok(()) };
    let title      = e.data["title"].as_str().unwrap_or("").to_owned();
    let status     = e.data["status"].as_str().unwrap_or("todo").to_owned();
    let notes      = e.data["notes"].as_str().unwrap_or("").to_owned();
    let project_id = parse_uuid_field(&e.data, "project_id");
    let parent_id  = parse_uuid_field(&e.data, "parent_id");
    let ticket_id  = parse_uuid_field(&e.data, "ticket_id");

    sqlx::query!(
        r#"
        INSERT INTO task (
          id, workspace_id, title, status, notes,
          project_id, parent_id, ticket_id,
          updated_at, deleted_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        ON CONFLICT (id) DO UPDATE SET
          title      = EXCLUDED.title,
          status     = EXCLUDED.status,
          notes      = EXCLUDED.notes,
          project_id = EXCLUDED.project_id,
          parent_id  = EXCLUDED.parent_id,
          ticket_id  = EXCLUDED.ticket_id,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at,
          synced_at  = NOW()
        WHERE EXCLUDED.updated_at > task.updated_at
        "#,
        id, workspace_id, title, status, notes,
        project_id, parent_id, ticket_id,
        e.updated_at, e.deleted_at,
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn push_habit(state: &AppState, workspace_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let id           = match parse_entity_id(e) { Some(v) => v, None => return Ok(()) };
    let name         = e.data["name"].as_str().unwrap_or("").to_owned();
    let icon         = e.data["icon"].as_str().unwrap_or("✓").to_owned();
    let kind         = e.data["kind"].as_str().unwrap_or("boolean").to_owned();
    let target_count = e.data["target_count"].as_i64().map(|v| v as i32);
    let frequency    = e.data["frequency"].as_str().unwrap_or("daily").to_owned();
    let freq_days    = e.data["frequency_days"].as_str().map(|s| s.to_owned());

    sqlx::query!(
        r#"
        INSERT INTO habit (
          id, workspace_id, name, icon, kind, target_count,
          frequency, frequency_days, updated_at, deleted_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        ON CONFLICT (id) DO UPDATE SET
          name           = EXCLUDED.name,
          icon           = EXCLUDED.icon,
          kind           = EXCLUDED.kind,
          target_count   = EXCLUDED.target_count,
          frequency      = EXCLUDED.frequency,
          frequency_days = EXCLUDED.frequency_days,
          updated_at     = EXCLUDED.updated_at,
          deleted_at     = EXCLUDED.deleted_at,
          synced_at      = NOW()
        WHERE EXCLUDED.updated_at > habit.updated_at
        "#,
        id, workspace_id, name, icon, kind, target_count,
        frequency, freq_days, e.updated_at, e.deleted_at,
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn push_habit_log(state: &AppState, workspace_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let id       = match parse_entity_id(e) { Some(v) => v, None => return Ok(()) };
    let habit_id = match parse_uuid_field(&e.data, "habit_id") {
        Some(id) => id,
        None => return Ok(()),
    };
    let date_str = match e.data["date"].as_str() {
        Some(d) => d.to_owned(),
        None => return Ok(()),
    };
    let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest(format!("invalid date: {date_str}")))?;
    let value        = e.data["value"].as_i64().unwrap_or(0) as i32;
    let completed_at = parse_ts_field(&e.data, "completed_at");

    sqlx::query!(
        r#"
        INSERT INTO habit_log (
          id, habit_id, workspace_id, date, value, completed_at, updated_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (habit_id, date) DO UPDATE SET
          value        = EXCLUDED.value,
          completed_at = EXCLUDED.completed_at,
          updated_at   = EXCLUDED.updated_at,
          synced_at    = NOW()
        WHERE EXCLUDED.updated_at > habit_log.updated_at
        "#,
        id, habit_id, workspace_id, date, value, completed_at, e.updated_at,
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn push_user_setting(state: &AppState, user_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let key = e.data["key"].as_str().unwrap_or("").to_owned();
    if key.is_empty() { return Ok(()); }

    sqlx::query!(
        r#"
        INSERT INTO user_setting (user_id, key, value, updated_at, deleted_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, key) DO UPDATE SET
          value      = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at
        WHERE EXCLUDED.updated_at > user_setting.updated_at
        "#,
        user_id, key, e.data["value"], e.updated_at, e.deleted_at,
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

pub async fn pull(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<PullQuery>,
) -> Result<Json<PullResponse>> {
    require_sync_entitlement(&state, auth.id).await?;

    let mut entities: Vec<SyncEntity> = Vec::new();
    let server_time = Utc::now();

    // Always return user's workspaces (needed for bootstrap on first sync)
    let workspaces = sqlx::query!(
        r#"
        SELECT w.id, w.name, w.color, w.updated_at, w.deleted_at
        FROM workspace w
        JOIN workspace_member m ON m.workspace_id = w.id
        WHERE m.user_id = $1
          AND ($2::timestamptz IS NULL OR w.updated_at > $2)
        "#,
        auth.id,
        q.since,
    )
    .fetch_all(&state.pool)
    .await?;

    for row in workspaces {
        entities.push(SyncEntity {
            table: "workspace".into(),
            id: row.id.to_string(),
            data: serde_json::json!({ "name": row.name, "color": row.color }),
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        });
    }

    // User settings (timer prefs, active timer beacon)
    for row in sqlx::query!(
        r#"SELECT key, value, updated_at, deleted_at FROM user_setting
           WHERE user_id = $1 AND ($2::timestamptz IS NULL OR updated_at > $2)"#,
        auth.id, q.since,
    )
    .fetch_all(&state.pool)
    .await?
    {
        let fake_id = uuid::Uuid::new_v5(
            &uuid::Uuid::NAMESPACE_OID,
            format!("{}:{}", auth.id, row.key).as_bytes(),
        );
        entities.push(SyncEntity {
            table: "user_setting".into(),
            id: fake_id.to_string(),
            data: serde_json::json!({ "key": row.key, "value": row.value }),
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        });
    }

    if let Some(workspace_id) = q.workspace_id {
        require_workspace_access(&state, auth.id, workspace_id).await?;

        // Projects
        for row in sqlx::query!(
            "SELECT id, name, color, updated_at, deleted_at FROM project
             WHERE workspace_id = $1 AND ($2::timestamptz IS NULL OR updated_at > $2)",
            workspace_id, q.since,
        )
        .fetch_all(&state.pool)
        .await?
        {
            entities.push(SyncEntity {
                table: "project".into(),
                id: row.id.to_string(),
                data: serde_json::json!({
                    "name": row.name, "color": row.color,
                    "workspace_id": workspace_id,
                }),
                updated_at: row.updated_at,
                deleted_at: row.deleted_at,
            });
        }

        // Tasks
        for row in sqlx::query!(
            r#"SELECT id, title, status, notes, project_id, parent_id, ticket_id, updated_at, deleted_at
               FROM task
               WHERE workspace_id = $1 AND ($2::timestamptz IS NULL OR updated_at > $2)"#,
            workspace_id, q.since,
        )
        .fetch_all(&state.pool)
        .await?
        {
            entities.push(SyncEntity {
                table: "task".into(),
                id: row.id.to_string(),
                data: serde_json::json!({
                    "title": row.title, "status": row.status, "notes": row.notes,
                    "workspace_id": workspace_id,
                    "project_id": row.project_id, "parent_id": row.parent_id,
                    "ticket_id": row.ticket_id,
                }),
                updated_at: row.updated_at,
                deleted_at: row.deleted_at,
            });
        }

        // Habits
        for row in sqlx::query!(
            r#"SELECT id, name, icon, kind, target_count, frequency, frequency_days, updated_at, deleted_at
               FROM habit
               WHERE workspace_id = $1 AND ($2::timestamptz IS NULL OR updated_at > $2)"#,
            workspace_id, q.since,
        )
        .fetch_all(&state.pool)
        .await?
        {
            entities.push(SyncEntity {
                table: "habit".into(),
                id: row.id.to_string(),
                data: serde_json::json!({
                    "name": row.name, "icon": row.icon, "kind": row.kind,
                    "target_count": row.target_count,
                    "frequency": row.frequency, "frequency_days": row.frequency_days,
                    "workspace_id": workspace_id,
                }),
                updated_at: row.updated_at,
                deleted_at: row.deleted_at,
            });
        }

        // Habit logs
        for row in sqlx::query!(
            r#"SELECT id, habit_id, date::text as "date!", value, completed_at, updated_at
               FROM habit_log
               WHERE workspace_id = $1 AND ($2::timestamptz IS NULL OR updated_at > $2)"#,
            workspace_id, q.since,
        )
        .fetch_all(&state.pool)
        .await?
        {
            entities.push(SyncEntity {
                table: "habit_log".into(),
                id: row.id.to_string(),
                data: serde_json::json!({
                    "habit_id": row.habit_id, "date": row.date,
                    "value": row.value, "completed_at": row.completed_at,
                    "workspace_id": workspace_id,
                }),
                updated_at: row.updated_at,
                deleted_at: None,
            });
        }
    }

    Ok(Json(PullResponse { entities, server_time }))
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn parse_uuid_field(data: &Value, key: &str) -> Option<uuid::Uuid> {
    data[key]
        .as_str()
        .and_then(|s| uuid::Uuid::parse_str(s).ok())
}

fn parse_ts_field(data: &Value, key: &str) -> Option<DateTime<Utc>> {
    data[key]
        .as_str()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
}
