use axum::{
    extract::{Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    AppState,
};

// ─── Request types ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct TodayQuery {
    pub workspace_id: Uuid,
    pub date: NaiveDate,
}

// ─── Response types ───────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct WorkspaceInfo {
    pub id: Uuid,
    pub name: String,
    pub color: String,
}

#[derive(Serialize)]
pub struct TodayTask {
    pub id: Uuid,
    pub title: String,
    pub status: String,
    pub is_priority: bool,
    pub completed_at: Option<DateTime<Utc>>,
    pub project_id: Option<Uuid>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub position: i32,
}

#[derive(Serialize)]
pub struct WorkLogTask {
    pub task_id: Option<Uuid>,
    pub task_title: String,
    pub pomos: i64,
    pub duration_seconds: i64,
    pub is_active: bool,
}

#[derive(Serialize)]
pub struct WorkLogProject {
    pub project_id: Option<Uuid>,
    pub project_name: String,
    pub project_color: String,
    pub total_seconds: i64,
    pub tasks: Vec<WorkLogTask>,
}

#[derive(Serialize)]
pub struct HabitLog {
    pub value: i32,
    pub done: bool,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct TodayHabit {
    pub id: Uuid,
    pub name: String,
    pub icon: String,
    pub kind: String,
    pub target_count: Option<i32>,
    pub log: Option<HabitLog>,
}

#[derive(Serialize)]
pub struct ActiveSession {
    pub id: Uuid,
    pub task_id: Option<Uuid>,
    pub task_title: Option<String>,
    pub project_name: Option<String>,
    pub started_at: DateTime<Utc>,
    pub planned_duration_seconds: Option<i32>,
    pub actual_duration_seconds: i32,
    pub pomo_index: i64,
}

#[derive(Serialize)]
pub struct TodayStats {
    pub pomos_today: i64,
    pub seconds_today: i64,
    pub pomos_this_week: i64,
    pub tasks_done_today: i64,
}

#[derive(Serialize)]
pub struct TodayResponse {
    pub workspace: WorkspaceInfo,
    pub date: NaiveDate,
    pub active_session: Option<ActiveSession>,
    pub priorities: Vec<TodayTask>,
    pub tasks: Vec<TodayTask>,
    pub work_log: Vec<WorkLogProject>,
    pub habits: Vec<TodayHabit>,
    pub stats: TodayStats,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

pub async fn get_workspaces(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Vec<WorkspaceInfo>>> {
    let rows = sqlx::query!(
        r#"
        SELECT w.id, w.name, w.color
        FROM workspace w
        JOIN workspace_member m ON m.workspace_id = w.id
        WHERE m.user_id = $1 AND w.deleted_at IS NULL
        ORDER BY GREATEST(
          w.updated_at,
          COALESCE(
            (SELECT MAX(t.synced_at) FROM task t WHERE t.workspace_id = w.id),
            w.updated_at
          )
        ) DESC
        "#,
        auth.id,
    )
    .fetch_all(&state.pool)
    .await?;

    let workspaces = rows
        .into_iter()
        .map(|r| WorkspaceInfo { id: r.id, name: r.name, color: r.color })
        .collect();

    Ok(Json(workspaces))
}

pub async fn get_today(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<TodayQuery>,
) -> Result<Json<TodayResponse>> {
    require_workspace_access(&state, auth.id, q.workspace_id).await?;

    let ws = sqlx::query!(
        "SELECT id, name, color FROM workspace WHERE id = $1",
        q.workspace_id,
    )
    .fetch_one(&state.pool)
    .await?;
    let workspace = WorkspaceInfo { id: ws.id, name: ws.name, color: ws.color };

    // ── Tasks ───────────────────────────────────────────────────────────────────
    // Show tasks that are active OR were completed/scheduled today.
    // Use "?" alias suffix so sqlx treats LEFT JOIN columns as nullable.
    let task_rows = sqlx::query!(
        r#"
        SELECT t.id, t.title, t.status, t.is_priority, t.completed_at, t.position,
               t.project_id,
               p.name  as "project_name?",
               p.color as "project_color?"
        FROM task t
        LEFT JOIN project p ON p.id = t.project_id
        WHERE t.workspace_id = $1
          AND t.deleted_at IS NULL
          AND (
            t.status IN ('todo', 'in_progress')
            OR t.scheduled_for = $2
            OR (t.completed_at IS NOT NULL AND DATE(t.completed_at AT TIME ZONE 'UTC') = $2)
          )
        ORDER BY t.is_priority DESC, t.position, t.created_at
        "#,
        q.workspace_id,
        q.date,
    )
    .fetch_all(&state.pool)
    .await?;

    // ── Pomodoro sessions for today ─────────────────────────────────────────────
    let session_rows = sqlx::query!(
        r#"
        SELECT s.id, s.task_id, s.status, s.actual_duration_seconds,
               s.planned_duration_seconds, s.started_at,
               t.title        as "task_title?",
               t.project_id   as "session_project_id?",
               p.name         as "project_name?",
               p.color        as "project_color?"
        FROM pomodoro_session s
        LEFT JOIN task t ON t.id = s.task_id
        LEFT JOIN project p ON p.id = t.project_id
        WHERE s.workspace_id = $1
          AND s.kind = 'focus'
          AND s.status IN ('completed', 'active', 'interrupted')
          AND DATE(s.started_at AT TIME ZONE 'UTC') = $2
        ORDER BY s.started_at
        "#,
        q.workspace_id,
        q.date,
    )
    .fetch_all(&state.pool)
    .await?;

    // ── Active session ──────────────────────────────────────────────────────────
    let active_session = session_rows.iter().find(|s| s.status == "active").map(|s| {
        let pomo_index = session_rows.iter().filter(|x| x.status == "completed").count() as i64 + 1;
        ActiveSession {
            id: s.id,
            task_id: s.task_id,
            task_title: s.task_title.clone(),
            project_name: s.project_name.clone(),
            started_at: s.started_at,
            planned_duration_seconds: s.planned_duration_seconds,
            actual_duration_seconds: s.actual_duration_seconds,
            pomo_index,
        }
    });

    // ── Work log: aggregate sessions by project → task ─────────────────────────
    let mut project_map: HashMap<String, WorkLogProject> = HashMap::new();
    let mut task_agg: HashMap<(String, String), WorkLogTask> = HashMap::new();

    for s in &session_rows {
        let project_key = s
            .session_project_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "none".into());
        let task_key = s.task_id.map(|id| id.to_string()).unwrap_or_else(|| "none".into());

        let task_entry = task_agg.entry((project_key.clone(), task_key)).or_insert(WorkLogTask {
            task_id: s.task_id,
            task_title: s.task_title.clone().unwrap_or_else(|| "No task".into()),
            pomos: 0,
            duration_seconds: 0,
            is_active: false,
        });
        task_entry.pomos += 1;
        task_entry.duration_seconds += s.actual_duration_seconds as i64;
        if s.status == "active" {
            task_entry.is_active = true;
        }

        let proj_entry = project_map.entry(project_key.clone()).or_insert(WorkLogProject {
            project_id: s.session_project_id,
            project_name: s.project_name.clone().unwrap_or_else(|| "No project".into()),
            project_color: s.project_color.clone().unwrap_or_else(|| "#6366f1".into()),
            total_seconds: 0,
            tasks: Vec::new(),
        });
        proj_entry.total_seconds += s.actual_duration_seconds as i64;
    }

    for ((project_key, _), task) in task_agg {
        if let Some(proj) = project_map.get_mut(&project_key) {
            proj.tasks.push(task);
        }
    }

    let mut work_log: Vec<WorkLogProject> = project_map.into_values().collect();
    work_log.sort_by(|a, b| b.total_seconds.cmp(&a.total_seconds));
    for p in &mut work_log {
        p.tasks.sort_by(|a, b| b.duration_seconds.cmp(&a.duration_seconds));
    }

    // ── Split tasks into priorities and regular ────────────────────────────────
    let (mut priorities, mut tasks): (Vec<TodayTask>, Vec<TodayTask>) = task_rows
        .into_iter()
        .map(|row| TodayTask {
            id: row.id,
            title: row.title,
            status: row.status,
            is_priority: row.is_priority,
            completed_at: row.completed_at,
            project_id: row.project_id,
            project_name: row.project_name,
            project_color: row.project_color,
            position: row.position,
        })
        .partition(|t| t.is_priority);

    // Sort completed tasks to the bottom
    priorities.sort_by_key(|t| t.status == "done");
    tasks.sort_by_key(|t| t.status == "done");

    // ── Habits ─────────────────────────────────────────────────────────────────
    let habit_rows = sqlx::query!(
        r#"
        SELECT h.id, h.name, h.icon, h.kind, h.target_count,
               hl.value        as "log_value?",
               hl.completed_at as "log_completed_at?"
        FROM habit h
        LEFT JOIN habit_log hl ON hl.habit_id = h.id AND hl.date = $2
        WHERE h.workspace_id = $1
          AND h.deleted_at IS NULL
        ORDER BY h.position, h.created_at
        "#,
        q.workspace_id,
        q.date,
    )
    .fetch_all(&state.pool)
    .await?;

    let habits: Vec<TodayHabit> = habit_rows
        .into_iter()
        .map(|r| {
            let log = r.log_value.map(|v| HabitLog {
                value: v,
                done: v > 0,
                completed_at: r.log_completed_at,
            });
            TodayHabit {
                id: r.id,
                name: r.name,
                icon: r.icon,
                kind: r.kind,
                target_count: r.target_count,
                log,
            }
        })
        .collect();

    // ── Stats ──────────────────────────────────────────────────────────────────
    let stats_today = sqlx::query!(
        r#"
        SELECT
          COUNT(*)::bigint                                             as "count!",
          COALESCE(SUM(actual_duration_seconds), 0)::bigint           as "seconds!"
        FROM pomodoro_session
        WHERE workspace_id = $1
          AND kind = 'focus'
          AND status IN ('completed', 'interrupted')
          AND DATE(started_at AT TIME ZONE 'UTC') = $2
        "#,
        q.workspace_id,
        q.date,
    )
    .fetch_one(&state.pool)
    .await?;

    let pomos_this_week = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*)::bigint as "count!"
        FROM pomodoro_session
        WHERE workspace_id = $1
          AND kind = 'focus'
          AND status IN ('completed', 'interrupted')
          AND started_at >= date_trunc('week', $2::date::timestamptz)
        "#,
        q.workspace_id,
        q.date,
    )
    .fetch_one(&state.pool)
    .await?;

    let tasks_done_today = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*)::bigint as "count!"
        FROM task
        WHERE workspace_id = $1
          AND status = 'done'
          AND completed_at IS NOT NULL
          AND DATE(completed_at AT TIME ZONE 'UTC') = $2
        "#,
        q.workspace_id,
        q.date,
    )
    .fetch_one(&state.pool)
    .await?;

    let stats = TodayStats {
        pomos_today: stats_today.count,
        seconds_today: stats_today.seconds,
        pomos_this_week,
        tasks_done_today,
    };

    Ok(Json(TodayResponse {
        workspace,
        date: q.date,
        active_session,
        priorities,
        tasks,
        work_log,
        habits,
        stats,
    }))
}

// ─── Guards ───────────────────────────────────────────────────────────────────

async fn require_workspace_access(state: &AppState, user_id: Uuid, workspace_id: Uuid) -> Result<()> {
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
