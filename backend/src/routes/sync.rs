use std::collections::HashSet;

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
    // Legacy — sync is user-global now; old clients still send it.
    #[allow(dead_code)]
    pub workspace_id: Option<uuid::Uuid>,
}

#[derive(Deserialize)]
pub struct PushBody {
    // Legacy fallback for entities that don't carry data.workspace_id.
    workspace_id: Option<uuid::Uuid>,
    entities: Vec<SyncEntity>,
}

fn default_ts() -> DateTime<Utc> {
    Utc::now()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncEntity {
    pub table: String,
    pub id: String, // accept any string; parse to UUID per-function
    pub data: Value,
    #[serde(default = "default_ts")] // tolerate missing field from old client builds
    pub updated_at: DateTime<Utc>,
    #[serde(default)] // tolerate missing field (same as null)
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

    // Pass 1: workspaces first — bootstraps membership so later access checks work
    for entity in body.entities.iter().filter(|e| e.table == "workspace") {
        push_workspace(&state, auth.id, entity).await?;
        accepted += 1;
    }

    // User-scoped entities (settings, devices) — not tied to a workspace
    for entity in body.entities.iter().filter(|e| e.table == "user_setting") {
        if push_user_setting(&state, auth.id, entity).await.is_ok() {
            accepted += 1;
        }
    }
    for entity in body.entities.iter().filter(|e| e.table == "device") {
        if push_device(&state, auth.id, entity).await.is_ok() {
            accepted += 1;
        }
    }

    // Pass 2: workspace-scoped entities. Each entity syncs into the workspace it
    // carries in data.workspace_id (falling back to the legacy body field); the
    // user must be a member of that workspace.
    let allowed = user_workspace_ids(&state, auth.id).await?;

    for entity in body
        .entities
        .iter()
        .filter(|e| !matches!(e.table.as_str(), "workspace" | "user_setting" | "device"))
    {
        let ws = entity_workspace_id(entity, body.workspace_id);
        let ws = match ws {
            Some(ws) if allowed.contains(&ws) => ws,
            _ => continue, // unknown or foreign workspace — skip entity
        };
        let ok = match entity.table.as_str() {
            "project" => push_project(&state, ws, entity).await.is_ok(),
            "task" => push_task(&state, ws, entity).await.is_ok(),
            "habit" => push_habit(&state, ws, entity).await.is_ok(),
            "habit_log" => push_habit_log(&state, ws, entity).await.is_ok(),
            "pomodoro_session" => push_pomodoro_session(&state, ws, entity).await.is_ok(),
            "task_order" => push_task_order(&state, ws, entity).await.is_ok(),
            _ => false,
        };
        if ok {
            accepted += 1;
        }
    }

    Ok(Json(serde_json::json!({ "accepted": accepted })))
}

fn parse_entity_id(e: &SyncEntity) -> Option<uuid::Uuid> {
    uuid::Uuid::parse_str(&e.id).ok()
}

fn entity_workspace_id(e: &SyncEntity, fallback: Option<uuid::Uuid>) -> Option<uuid::Uuid> {
    parse_uuid_field(&e.data, "workspace_id").or(fallback)
}

async fn user_workspace_ids(state: &AppState, user_id: uuid::Uuid) -> Result<HashSet<uuid::Uuid>> {
    let rows = sqlx::query_scalar!(
        "SELECT workspace_id FROM workspace_member WHERE user_id = $1",
        user_id,
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(rows.into_iter().collect())
}

async fn push_workspace(state: &AppState, user_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let id = match parse_entity_id(e) {
        Some(v) => v,
        None => return Ok(()),
    };
    let name = e.data["name"].as_str().unwrap_or("Workspace").to_owned();
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
        WHERE EXCLUDED.updated_at >= workspace.updated_at
        "#,
        id,
        user_id,
        name,
        color,
        e.updated_at,
        e.deleted_at,
    )
    .execute(&state.pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO workspace_member (workspace_id, user_id, role)
        VALUES ($1, $2, 'owner')
        ON CONFLICT (workspace_id, user_id) DO NOTHING
        "#,
        id,
        user_id,
    )
    .execute(&state.pool)
    .await?;

    Ok(())
}

async fn push_project(state: &AppState, workspace_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let id = match parse_entity_id(e) {
        Some(v) => v,
        None => return Ok(()),
    };
    let name = e.data["name"].as_str().unwrap_or("").to_owned();
    let color = e.data["color"].as_str().unwrap_or("#6366f1").to_owned();

    sqlx::query!(
        r#"
        INSERT INTO project (id, workspace_id, name, color, updated_at, deleted_at, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name         = EXCLUDED.name,
          color        = EXCLUDED.color,
          workspace_id = EXCLUDED.workspace_id,
          updated_at   = EXCLUDED.updated_at,
          deleted_at   = EXCLUDED.deleted_at,
          synced_at    = NOW()
        WHERE EXCLUDED.updated_at >= project.updated_at
        "#,
        id,
        workspace_id,
        name,
        color,
        e.updated_at,
        e.deleted_at,
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn push_task(state: &AppState, workspace_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let id = match parse_entity_id(e) {
        Some(v) => v,
        None => return Ok(()),
    };
    let title = e.data["title"].as_str().unwrap_or("").to_owned();
    let status = e.data["status"].as_str().unwrap_or("todo").to_owned();
    let notes = e.data["notes"].as_str().unwrap_or("").to_owned();
    let project_id = parse_uuid_field(&e.data, "project_id");
    let parent_id = parse_uuid_field(&e.data, "parent_id");
    let ticket_id = e.data["ticket_id"].as_str().map(|s| s.to_owned());
    let completed_at = parse_ts_field(&e.data, "completed_at");
    let extra = if e.data["extra"].is_object() {
        e.data["extra"].clone()
    } else {
        serde_json::json!({})
    };

    sqlx::query!(
        r#"
        INSERT INTO task (
          id, workspace_id, title, status, notes,
          project_id, parent_id, ticket_id, completed_at, extra,
          updated_at, deleted_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
        ON CONFLICT (id) DO UPDATE SET
          title        = EXCLUDED.title,
          status       = EXCLUDED.status,
          notes        = EXCLUDED.notes,
          workspace_id = EXCLUDED.workspace_id,
          project_id   = EXCLUDED.project_id,
          parent_id    = EXCLUDED.parent_id,
          ticket_id    = EXCLUDED.ticket_id,
          completed_at = EXCLUDED.completed_at,
          extra        = EXCLUDED.extra,
          updated_at   = EXCLUDED.updated_at,
          deleted_at   = EXCLUDED.deleted_at,
          synced_at    = NOW()
        WHERE EXCLUDED.updated_at >= task.updated_at
        "#,
        id,
        workspace_id,
        title,
        status,
        notes,
        project_id,
        parent_id,
        ticket_id,
        completed_at,
        extra,
        e.updated_at,
        e.deleted_at,
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn push_habit(state: &AppState, workspace_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let id = match parse_entity_id(e) {
        Some(v) => v,
        None => return Ok(()),
    };
    let name = e.data["name"].as_str().unwrap_or("").to_owned();
    let icon = e.data["icon"].as_str().unwrap_or("✓").to_owned();
    let kind = e.data["kind"].as_str().unwrap_or("boolean").to_owned();
    let target_count = e.data["target_count"].as_i64().map(|v| v as i32);
    let frequency = e.data["frequency"].as_str().unwrap_or("daily").to_owned();
    let freq_days = e.data["frequency_days"].as_str().map(|s| s.to_owned());

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
          workspace_id   = EXCLUDED.workspace_id,
          updated_at     = EXCLUDED.updated_at,
          deleted_at     = EXCLUDED.deleted_at,
          synced_at      = NOW()
        WHERE EXCLUDED.updated_at >= habit.updated_at
        "#,
        id,
        workspace_id,
        name,
        icon,
        kind,
        target_count,
        frequency,
        freq_days,
        e.updated_at,
        e.deleted_at,
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn push_habit_log(state: &AppState, workspace_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let id = match parse_entity_id(e) {
        Some(v) => v,
        None => return Ok(()),
    };
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
    let value = e.data["value"].as_i64().unwrap_or(0) as i32;
    let completed_at = parse_ts_field(&e.data, "completed_at");

    sqlx::query!(
        r#"
        INSERT INTO habit_log (
          id, habit_id, workspace_id, date, value, completed_at, updated_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (habit_id, date) DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          value        = EXCLUDED.value,
          completed_at = EXCLUDED.completed_at,
          updated_at   = EXCLUDED.updated_at,
          synced_at    = NOW()
        WHERE EXCLUDED.updated_at >= habit_log.updated_at
        "#,
        id,
        habit_id,
        workspace_id,
        date,
        value,
        completed_at,
        e.updated_at,
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn push_pomodoro_session(
    state: &AppState,
    workspace_id: uuid::Uuid,
    e: &SyncEntity,
) -> Result<()> {
    let id = match parse_entity_id(e) {
        Some(v) => v,
        None => return Ok(()),
    };
    let task_id = parse_uuid_field(&e.data, "task_id");
    let ticket_id = e.data["ticket_id"].as_str().map(|s| s.to_owned());
    let mode = e.data["mode"].as_str().unwrap_or("pomodoro").to_owned();
    let mode = if matches!(mode.as_str(), "pomodoro" | "stopwatch" | "manual") {
        mode
    } else {
        "manual".to_owned()
    };
    let started_at = match parse_ts_field(&e.data, "started_at") {
        Some(ts) => ts,
        None => return Ok(()),
    };
    let duration = e.data["duration_seconds"].as_i64().unwrap_or(0) as i32;
    let kind = e.data["kind"].as_str().unwrap_or("focus").to_owned();
    let kind = if matches!(kind.as_str(), "focus" | "break_short" | "break_long") {
        kind
    } else {
        "focus".to_owned()
    };
    let status = e.data["status"].as_str().unwrap_or("completed").to_owned();
    let status = if matches!(
        status.as_str(),
        "active" | "completed" | "interrupted" | "cancelled"
    ) {
        status
    } else {
        "completed".to_owned()
    };
    let device_id = e.data["device_id"].as_str().unwrap_or("").to_owned();
    let ended_at = parse_ts_field(&e.data, "ended_at");

    sqlx::query!(
        r#"
        INSERT INTO pomodoro_session (
          id, workspace_id, task_id, ticket_id, mode, started_at, ended_at,
          actual_duration_seconds, kind, status, device_id, updated_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
        ON CONFLICT (id) DO UPDATE SET
          workspace_id            = EXCLUDED.workspace_id,
          task_id                 = EXCLUDED.task_id,
          actual_duration_seconds = EXCLUDED.actual_duration_seconds,
          status                  = EXCLUDED.status,
          ended_at                = EXCLUDED.ended_at,
          updated_at              = EXCLUDED.updated_at,
          synced_at               = NOW()
        WHERE EXCLUDED.updated_at >= pomodoro_session.updated_at
        "#,
        id,
        workspace_id,
        task_id,
        ticket_id,
        mode,
        started_at,
        ended_at,
        duration,
        kind,
        status,
        device_id,
        e.updated_at,
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn push_task_order(state: &AppState, workspace_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let priority_ids = if e.data["priority_ids"].is_array() {
        e.data["priority_ids"].clone()
    } else {
        serde_json::json!([])
    };
    let today_ids = if e.data["today_ids"].is_array() {
        e.data["today_ids"].clone()
    } else {
        serde_json::json!([])
    };

    sqlx::query!(
        r#"
        INSERT INTO task_order (workspace_id, priority_ids, today_ids, updated_at, synced_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (workspace_id) DO UPDATE SET
          priority_ids = EXCLUDED.priority_ids,
          today_ids    = EXCLUDED.today_ids,
          updated_at   = EXCLUDED.updated_at,
          synced_at    = NOW()
        WHERE EXCLUDED.updated_at >= task_order.updated_at
        "#,
        workspace_id,
        priority_ids,
        today_ids,
        e.updated_at,
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn push_device(state: &AppState, user_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let id = match parse_entity_id(e) {
        Some(v) => v,
        None => return Ok(()),
    };
    let kind = e.data["kind"].as_str().unwrap_or("extension").to_owned();
    let kind = if matches!(kind.as_str(), "extension" | "web" | "mobile") {
        kind
    } else {
        "extension".to_owned()
    };
    let name = e.data["name"].as_str().unwrap_or("").to_owned();
    let browser = e.data["browser"].as_str().unwrap_or("").to_owned();
    let version = e.data["version"].as_str().unwrap_or("").to_owned();
    let synced = e.data["synced"].as_bool().unwrap_or(false);

    sqlx::query!(
        r#"
        INSERT INTO device (id, user_id, kind, name, browser, version, last_seen_at, last_sync_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), CASE WHEN $7 THEN NOW() ELSE NULL END)
        ON CONFLICT (id) DO UPDATE SET
          kind         = EXCLUDED.kind,
          name         = EXCLUDED.name,
          browser      = EXCLUDED.browser,
          version      = EXCLUDED.version,
          last_seen_at = NOW(),
          last_sync_at = CASE WHEN $7 THEN NOW() ELSE device.last_sync_at END
        "#,
        id,
        user_id,
        kind,
        name,
        browser,
        version,
        synced,
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn push_user_setting(state: &AppState, user_id: uuid::Uuid, e: &SyncEntity) -> Result<()> {
    let key = e.data["key"].as_str().unwrap_or("").to_owned();
    if key.is_empty() {
        return Ok(());
    }

    sqlx::query!(
        r#"
        INSERT INTO user_setting (user_id, key, value, updated_at, deleted_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, key) DO UPDATE SET
          value      = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at
        WHERE EXCLUDED.updated_at >= user_setting.updated_at
        "#,
        user_id,
        key,
        e.data["value"],
        e.updated_at,
        e.deleted_at,
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

    // Workspaces — everything the user is a member of (changed since `since`)
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
        auth.id,
        q.since,
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

    // Workspace-scoped entities across ALL of the user's workspaces
    let ws_ids: Vec<uuid::Uuid> = user_workspace_ids(&state, auth.id)
        .await?
        .into_iter()
        .collect();
    if ws_ids.is_empty() {
        return Ok(Json(PullResponse {
            entities,
            server_time,
        }));
    }

    // Projects
    for row in sqlx::query!(
        r#"SELECT id, workspace_id, name, color, updated_at, deleted_at FROM project
           WHERE workspace_id = ANY($1) AND ($2::timestamptz IS NULL OR updated_at > $2)"#,
        &ws_ids,
        q.since,
    )
    .fetch_all(&state.pool)
    .await?
    {
        entities.push(SyncEntity {
            table: "project".into(),
            id: row.id.to_string(),
            data: serde_json::json!({
                "name": row.name, "color": row.color,
                "workspace_id": row.workspace_id,
            }),
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        });
    }

    // Tasks
    for row in sqlx::query!(
        r#"SELECT id, workspace_id, title, status, notes, project_id, parent_id, ticket_id,
                  completed_at, extra, updated_at, deleted_at
           FROM task
           WHERE workspace_id = ANY($1) AND ($2::timestamptz IS NULL OR updated_at > $2)"#,
        &ws_ids,
        q.since,
    )
    .fetch_all(&state.pool)
    .await?
    {
        entities.push(SyncEntity {
            table: "task".into(),
            id: row.id.to_string(),
            data: serde_json::json!({
                "title": row.title, "status": row.status, "notes": row.notes,
                "workspace_id": row.workspace_id,
                "project_id": row.project_id, "parent_id": row.parent_id,
                "ticket_id": row.ticket_id,
                "completed_at": row.completed_at,
                "extra": row.extra,
            }),
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        });
    }

    // Habits
    for row in sqlx::query!(
        r#"SELECT id, workspace_id, name, icon, kind, target_count, frequency, frequency_days,
                  updated_at, deleted_at
           FROM habit
           WHERE workspace_id = ANY($1) AND ($2::timestamptz IS NULL OR updated_at > $2)"#,
        &ws_ids,
        q.since,
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
                "workspace_id": row.workspace_id,
            }),
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        });
    }

    // Habit logs
    for row in sqlx::query!(
        r#"SELECT id, habit_id, workspace_id, date::text as "date!", value, completed_at, updated_at
           FROM habit_log
           WHERE workspace_id = ANY($1) AND ($2::timestamptz IS NULL OR updated_at > $2)"#,
        &ws_ids,
        q.since,
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
                "workspace_id": row.workspace_id,
            }),
            updated_at: row.updated_at,
            deleted_at: None,
        });
    }

    // Pomodoro sessions
    for row in sqlx::query!(
        r#"SELECT id, workspace_id, task_id, ticket_id, mode, started_at, ended_at,
                  actual_duration_seconds, kind, status, device_id, updated_at
           FROM pomodoro_session
           WHERE workspace_id = ANY($1) AND ($2::timestamptz IS NULL OR updated_at > $2)"#,
        &ws_ids,
        q.since,
    )
    .fetch_all(&state.pool)
    .await?
    {
        entities.push(SyncEntity {
            table: "pomodoro_session".into(),
            id: row.id.to_string(),
            data: serde_json::json!({
                "workspace_id": row.workspace_id,
                "task_id": row.task_id, "ticket_id": row.ticket_id,
                "mode": row.mode, "started_at": row.started_at, "ended_at": row.ended_at,
                "duration_seconds": row.actual_duration_seconds,
                "kind": row.kind, "status": row.status, "device_id": row.device_id,
            }),
            updated_at: row.updated_at,
            deleted_at: None,
        });
    }

    // Task orders (Today/Priorities membership per workspace)
    for row in sqlx::query!(
        r#"SELECT workspace_id, priority_ids, today_ids, updated_at
           FROM task_order
           WHERE workspace_id = ANY($1) AND ($2::timestamptz IS NULL OR updated_at > $2)"#,
        &ws_ids,
        q.since,
    )
    .fetch_all(&state.pool)
    .await?
    {
        entities.push(SyncEntity {
            table: "task_order".into(),
            id: row.workspace_id.to_string(),
            data: serde_json::json!({
                "workspace_id": row.workspace_id,
                "priority_ids": row.priority_ids,
                "today_ids": row.today_ids,
            }),
            updated_at: row.updated_at,
            deleted_at: None,
        });
    }

    Ok(Json(PullResponse {
        entities,
        server_time,
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
