use axum::{
    extract::{Query, State},
    Extension, Json,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
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
    /// Omitted (or unparseable, e.g. "all") → aggregate across every workspace.
    pub workspace_id: Option<Uuid>,
    pub date: NaiveDate,
    /// IANA timezone for day boundaries (e.g. America/Argentina/Buenos_Aires).
    pub tz: Option<String>,
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
    pub workspace_id: Uuid,
    pub workspace_name: String,
    pub workspace_color: String,
    pub ticket_id: Option<String>,
    pub position: i32,
    /// Task repeats on a schedule (has extra.recurrence).
    pub recurring: bool,
    /// Recurring task already completed for this date (extra.completedDates).
    pub done_today: bool,
}

#[derive(Serialize)]
pub struct WorkLogTask {
    pub task_id: Option<Uuid>,
    pub task_title: String,
    pub ticket_id: Option<String>,
    pub pomos: i64,
    pub duration_seconds: i64,
    pub is_active: bool,
    pub task_status: Option<String>,
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
    pub unit: Option<String>,
    pub unit_amount: Option<i32>,
    pub time_unit: bool,
    pub log: Option<HabitLog>,
}

#[derive(Serialize)]
pub struct ActiveSession {
    pub id: Uuid,
    pub task_id: Option<Uuid>,
    pub task_title: Option<String>,
    pub project_name: Option<String>,
    pub ticket_id: Option<String>,
    pub mode: String,
    pub started_at: DateTime<Utc>,
    pub planned_duration_seconds: Option<i32>,
    pub actual_duration_seconds: i32,
    pub pomo_index: i64,
}

#[derive(Serialize)]
pub struct TodayMeeting {
    pub id: Uuid,
    pub title: String,
    pub time: DateTime<Utc>,
    pub duration_minutes: i32,
    pub logged_minutes: Option<i32>,
    pub logged: bool,
    pub track_mode: String,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub calendar_name: Option<String>,
    pub calendar_color: Option<String>,
}

#[derive(Serialize)]
pub struct TodayStats {
    pub pomos_today: i64,
    pub seconds_today: i64,
    pub pomos_this_week: i64,
    pub tickets_this_week: i64,
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
    pub meetings: Vec<TodayMeeting>,
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
        .map(|r| WorkspaceInfo {
            id: r.id,
            name: r.name,
            color: r.color,
        })
        .collect();

    Ok(Json(workspaces))
}

pub async fn get_today(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<TodayQuery>,
) -> Result<Json<TodayResponse>> {
    // Resolve the workspace scope: one workspace, or all of the user's ("All" view).
    let ws_ids: Vec<Uuid> = match q.workspace_id {
        Some(id) => {
            require_workspace_access(&state, auth.id, id).await?;
            vec![id]
        }
        None => {
            sqlx::query_scalar!(
                r#"SELECT w.id FROM workspace w
                   JOIN workspace_member m ON m.workspace_id = w.id
                   WHERE m.user_id = $1 AND w.deleted_at IS NULL"#,
                auth.id,
            )
            .fetch_all(&state.pool)
            .await?
        }
    };

    // Sanitize tz: IANA names only contain alphanumerics, '/', '_', '+', '-'.
    let tz =
        q.tz.as_deref()
            .filter(|t| {
                !t.is_empty()
                    && t.chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '+' | '-'))
            })
            .unwrap_or("UTC")
            .to_owned();

    let workspace = match q.workspace_id {
        Some(id) => {
            let ws = sqlx::query!("SELECT id, name, color FROM workspace WHERE id = $1", id)
                .fetch_one(&state.pool)
                .await?;
            WorkspaceInfo {
                id: ws.id,
                name: ws.name,
                color: ws.color,
            }
        }
        None => WorkspaceInfo {
            id: Uuid::nil(),
            name: "All".to_owned(),
            color: "#C8553D".to_owned(),
        },
    };

    // ── All in-scope tasks (small per-user dataset; membership logic in Rust) ──
    let task_rows = sqlx::query!(
        r#"
        SELECT t.id, t.title, t.status, t.completed_at, t.ticket_id, t.extra,
               t.project_id, t.workspace_id,
               p.name  as "project_name?",
               p.color as "project_color?",
               w.name  as "workspace_name!",
               w.color as "workspace_color!"
        FROM task t
        LEFT JOIN project p ON p.id = t.project_id
        JOIN workspace w ON w.id = t.workspace_id
        WHERE t.workspace_id = ANY($1)
          AND t.deleted_at IS NULL
        "#,
        &ws_ids,
    )
    .fetch_all(&state.pool)
    .await?;

    // ── Today/Priorities membership comes from the synced task_order rows ──────
    let orders = sqlx::query!(
        "SELECT priority_ids, today_ids FROM task_order WHERE workspace_id = ANY($1)",
        &ws_ids,
    )
    .fetch_all(&state.pool)
    .await?;

    let mut priority_ids: Vec<Uuid> = Vec::new();
    let mut today_ids: Vec<Uuid> = Vec::new();
    for o in orders {
        for id in json_uuid_list(&o.priority_ids) {
            if !priority_ids.contains(&id) {
                priority_ids.push(id);
            }
        }
        for id in json_uuid_list(&o.today_ids) {
            if !today_ids.contains(&id) {
                today_ids.push(id);
            }
        }
    }

    struct TaskInfo {
        title: String,
        status: String,
        completed_at: Option<DateTime<Utc>>,
        ticket_id: Option<String>,
        project_id: Option<Uuid>,
        project_name: Option<String>,
        project_color: Option<String>,
        workspace_id: Uuid,
        workspace_name: String,
        workspace_color: String,
        completed_dates: Vec<String>,
        recurring: bool,
    }

    let mut task_map: HashMap<Uuid, TaskInfo> = HashMap::new();
    for row in task_rows {
        let completed_dates = row
            .extra
            .get("completedDates")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|d| d.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        let recurring = row.extra.get("recurrence").is_some_and(|v| !v.is_null());
        task_map.insert(
            row.id,
            TaskInfo {
                title: row.title,
                status: row.status,
                completed_at: row.completed_at,
                ticket_id: row.ticket_id,
                project_id: row.project_id,
                project_name: row.project_name,
                project_color: row.project_color,
                workspace_id: row.workspace_id,
                workspace_name: row.workspace_name,
                workspace_color: row.workspace_color,
                completed_dates,
                recurring,
            },
        );
    }

    let today_str = q.date.to_string();

    let build_list = |ids: &[Uuid], is_priority: bool| -> Vec<TodayTask> {
        ids.iter()
            .enumerate()
            .filter_map(|(i, id)| {
                task_map.get(id).map(|t| TodayTask {
                    id: *id,
                    title: t.title.clone(),
                    status: t.status.clone(),
                    is_priority,
                    completed_at: t.completed_at,
                    project_id: t.project_id,
                    project_name: t.project_name.clone(),
                    project_color: t.project_color.clone(),
                    workspace_id: t.workspace_id,
                    workspace_name: t.workspace_name.clone(),
                    workspace_color: t.workspace_color.clone(),
                    ticket_id: t.ticket_id.clone(),
                    position: i as i32,
                    recurring: t.recurring,
                    done_today: t.completed_dates.contains(&today_str),
                })
            })
            .collect()
    };

    let mut priorities = build_list(&priority_ids, true);
    let mut tasks = build_list(&today_ids, false);

    // Recurring tasks track completion via extra.completedDates and are removed
    // from the Today order when done, so they'd otherwise vanish from the web.
    // Surface the ones completed today (that aren't already listed) so the user
    // still sees what they finished — the UI groups them at the end.
    let listed_ids: std::collections::HashSet<Uuid> = priorities
        .iter()
        .chain(tasks.iter())
        .map(|t| t.id)
        .collect();
    let mut recurring_done: Vec<TodayTask> = task_map
        .iter()
        .filter(|(id, t)| {
            t.recurring && t.completed_dates.contains(&today_str) && !listed_ids.contains(id)
        })
        .map(|(id, t)| TodayTask {
            id: *id,
            title: t.title.clone(),
            status: "done".to_owned(),
            is_priority: false,
            completed_at: t.completed_at,
            project_id: t.project_id,
            project_name: t.project_name.clone(),
            project_color: t.project_color.clone(),
            workspace_id: t.workspace_id,
            workspace_name: t.workspace_name.clone(),
            workspace_color: t.workspace_color.clone(),
            ticket_id: t.ticket_id.clone(),
            position: 0,
            recurring: true,
            done_today: true,
        })
        .collect();
    recurring_done.sort_by(|a, b| a.title.cmp(&b.title));
    tasks.extend(recurring_done);

    // Completed tasks sink to the bottom, preserving relative order
    priorities.sort_by_key(|t| t.status == "done");
    tasks.sort_by_key(|t| t.status == "done");

    // ── Pomodoro sessions for today (day boundary in the user's timezone) ──────
    let session_rows = sqlx::query!(
        r#"
        SELECT s.id, s.task_id, s.status, s.mode, s.actual_duration_seconds,
               s.planned_duration_seconds, s.started_at, s.ticket_id,
               t.title        as "task_title?",
               t.status       as "task_status?",
               t.project_id   as "session_project_id?",
               p.name         as "project_name?",
               p.color        as "project_color?"
        FROM pomodoro_session s
        LEFT JOIN task t ON t.id = s.task_id
        LEFT JOIN project p ON p.id = t.project_id
        WHERE s.workspace_id = ANY($1)
          AND s.kind = 'focus'
          AND s.status IN ('completed', 'active', 'interrupted')
          AND DATE(s.started_at AT TIME ZONE $3) = $2
        ORDER BY s.started_at
        "#,
        &ws_ids,
        q.date,
        tz,
    )
    .fetch_all(&state.pool)
    .await?;

    // ── Active session from the user_setting beacon ────────────────────────────
    // Only actual pomodoros count as "pomos" — stopwatch / manual sessions log
    // time but aren't pomodoros.
    let pomos_completed_today = session_rows
        .iter()
        .filter(|s| s.mode == "pomodoro" && s.status == "completed")
        .count() as i64;
    let active_session = active_session_from_beacon(&state, auth.id, pomos_completed_today).await?;

    // ── Work log: aggregate sessions by project → task ─────────────────────────
    let active_task_id = active_session.as_ref().and_then(|s| s.task_id);

    let mut project_map: HashMap<String, WorkLogProject> = HashMap::new();
    let mut task_agg: HashMap<(String, String), WorkLogTask> = HashMap::new();

    for s in &session_rows {
        let project_key = s
            .session_project_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "none".into());
        let task_key = s
            .task_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "none".into());

        let task_entry = task_agg
            .entry((project_key.clone(), task_key))
            .or_insert(WorkLogTask {
                task_id: s.task_id,
                task_title: s.task_title.clone().unwrap_or_else(|| "No task".into()),
                ticket_id: s.ticket_id.clone(),
                pomos: 0,
                duration_seconds: 0,
                is_active: false,
                task_status: s.task_status.clone(),
            });
        if s.mode == "pomodoro" {
            task_entry.pomos += 1;
        }
        task_entry.duration_seconds += s.actual_duration_seconds as i64;
        if s.status == "active" || (s.task_id.is_some() && s.task_id == active_task_id) {
            task_entry.is_active = true;
        }

        let proj_entry = project_map
            .entry(project_key.clone())
            .or_insert(WorkLogProject {
                project_id: s.session_project_id,
                project_name: s
                    .project_name
                    .clone()
                    .unwrap_or_else(|| "No project".into()),
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
    work_log.sort_by_key(|p| std::cmp::Reverse(p.total_seconds));
    for p in &mut work_log {
        p.tasks
            .sort_by_key(|t| std::cmp::Reverse(t.duration_seconds));
    }

    // ── Habits scheduled for this date (0=Mon…6=Sun, extension convention) ─────
    let dow = q.date.weekday().num_days_from_monday() as i64;

    // Habits are user-global — not filtered by the selected workspace.
    let habit_rows = sqlx::query!(
        r#"
        SELECT h.id, h.name, h.icon, h.kind, h.target_count, h.frequency, h.frequency_days,
               h.extra,
               hl.value        as "log_value?",
               hl.completed_at as "log_completed_at?"
        FROM habit h
        LEFT JOIN habit_log hl ON hl.habit_id = h.id AND hl.date = $2
        WHERE h.user_id = $1
          AND h.deleted_at IS NULL
        ORDER BY h.position, h.created_at
        "#,
        auth.id,
        q.date,
    )
    .fetch_all(&state.pool)
    .await?;

    let date_str = q.date.to_string();
    let habits: Vec<TodayHabit> = habit_rows
        .into_iter()
        // Hide habits whose end date has passed (still kept in history).
        .filter(|r| {
            r.extra
                .get("endDate")
                .and_then(|v| v.as_str())
                .filter(|e| !e.is_empty())
                .map(|e| e >= date_str.as_str())
                .unwrap_or(true)
        })
        .filter(|r| match r.frequency.as_str() {
            "weekdays" => dow <= 4,
            "custom" => r
                .frequency_days
                .as_deref()
                .and_then(|d| serde_json::from_str::<Vec<i64>>(d).ok())
                .map(|days| days.contains(&dow))
                .unwrap_or(true),
            _ => true, // daily
        })
        .map(|r| {
            let log = r.log_value.map(|v| HabitLog {
                value: v,
                done: v > 0,
                completed_at: r.log_completed_at,
            });
            // unit / unitAmount / timeUnit ride along in habit.extra (mirrors task.extra).
            let unit = r
                .extra
                .get("unit")
                .and_then(|v| v.as_str())
                .map(String::from);
            let unit_amount = r
                .extra
                .get("unitAmount")
                .and_then(|v| v.as_i64())
                .map(|v| v as i32);
            let time_unit = r
                .extra
                .get("timeUnit")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            TodayHabit {
                id: r.id,
                name: r.name,
                icon: r.icon,
                kind: r.kind,
                target_count: r.target_count,
                unit,
                unit_amount,
                time_unit,
                log,
            }
        })
        .collect();

    // ── Meetings for this date (day boundary in the user's timezone) ───────────
    let meetings: Vec<TodayMeeting> = sqlx::query!(
        r#"
        SELECT m.id, m.title, m.time, m.duration_minutes, m.logged_minutes, m.logged,
               m.track_mode, m.extra,
               p.name  as "project_name?",
               p.color as "project_color?"
        FROM meeting m
        LEFT JOIN project p ON p.id = m.project_id
        WHERE m.workspace_id = ANY($1)
          AND m.deleted_at IS NULL
          AND DATE(m.time AT TIME ZONE $3) = $2
        ORDER BY m.time
        "#,
        &ws_ids,
        q.date,
        tz,
    )
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(|m| TodayMeeting {
        id: m.id,
        title: m.title,
        time: m.time,
        duration_minutes: m.duration_minutes,
        logged_minutes: m.logged_minutes,
        logged: m.logged,
        track_mode: m.track_mode,
        project_name: m.project_name,
        project_color: m.project_color,
        calendar_name: m
            .extra
            .get("calendarName")
            .and_then(|v| v.as_str())
            .map(String::from),
        calendar_color: m
            .extra
            .get("calendarColor")
            .and_then(|v| v.as_str())
            .map(String::from),
    })
    .collect();

    // ── Stats ──────────────────────────────────────────────────────────────────
    let seconds_today: i64 = session_rows
        .iter()
        .filter(|s| s.status == "completed" || s.status == "interrupted")
        .map(|s| s.actual_duration_seconds as i64)
        .sum();

    let week_stats = sqlx::query!(
        r#"
        SELECT COUNT(*) FILTER (WHERE mode = 'pomodoro')::bigint as "pomos!",
               COUNT(DISTINCT COALESCE(ticket_id, task_id::text))
                 FILTER (WHERE ticket_id IS NOT NULL OR task_id IS NOT NULL)::bigint as "tickets!"
        FROM pomodoro_session
        WHERE workspace_id = ANY($1)
          AND kind = 'focus'
          AND status IN ('completed', 'interrupted')
          AND DATE(started_at AT TIME ZONE $3) >= date_trunc('week', $2::date)::date
          AND DATE(started_at AT TIME ZONE $3) <= $2
        "#,
        &ws_ids,
        q.date,
        tz,
    )
    .fetch_one(&state.pool)
    .await?;

    // Tasks done today: done tasks still in the Today lists + recurring tasks
    // completed today (they track completion via extra.completedDates).
    let date_str = q.date.to_string();
    let listed: std::collections::HashSet<Uuid> = priority_ids
        .iter()
        .chain(today_ids.iter())
        .copied()
        .collect();
    let done_in_lists = listed
        .iter()
        .filter(|id| {
            task_map
                .get(id)
                .map(|t| t.status == "done")
                .unwrap_or(false)
        })
        .count() as i64;
    let recurring_done = task_map
        .values()
        .filter(|t| t.completed_dates.contains(&date_str))
        .count() as i64;

    let stats = TodayStats {
        pomos_today: pomos_completed_today,
        seconds_today,
        pomos_this_week: week_stats.pomos,
        tickets_this_week: week_stats.tickets,
        tasks_done_today: done_in_lists + recurring_done,
    };

    Ok(Json(TodayResponse {
        workspace,
        date: q.date,
        active_session,
        priorities,
        tasks,
        work_log,
        habits,
        meetings,
        stats,
    }))
}

// ─── Tasks list (read-only): backlog + recurring, done on demand ──────────────

#[derive(Deserialize)]
pub struct TasksQuery {
    /// Omitted (or unparseable) → aggregate across every workspace.
    pub workspace_id: Option<Uuid>,
    /// When true, also return completed/cancelled tasks (fetched on demand).
    #[serde(default)]
    pub done: bool,
}

#[derive(Serialize)]
pub struct TaskListItem {
    pub id: Uuid,
    pub title: String,
    pub status: String,
    pub ticket_id: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub workspace_id: Uuid,
    pub workspace_name: String,
    pub workspace_color: String,
    /// The recurrence rule (extra.recurrence) for recurring tasks; null otherwise.
    pub recurrence: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct TasksResponse {
    pub backlog: Vec<TaskListItem>,
    pub recurring: Vec<TaskListItem>,
    /// Empty unless `?done=true` was requested.
    pub done: Vec<TaskListItem>,
}

pub async fn get_tasks(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<TasksQuery>,
) -> Result<Json<TasksResponse>> {
    let ws_ids: Vec<Uuid> = match q.workspace_id {
        Some(id) => {
            require_workspace_access(&state, auth.id, id).await?;
            vec![id]
        }
        None => {
            sqlx::query_scalar!(
                r#"SELECT w.id FROM workspace w
                   JOIN workspace_member m ON m.workspace_id = w.id
                   WHERE m.user_id = $1 AND w.deleted_at IS NULL"#,
                auth.id,
            )
            .fetch_all(&state.pool)
            .await?
        }
    };

    let task_rows = sqlx::query!(
        r#"
        SELECT t.id, t.title, t.status, t.completed_at, t.ticket_id, t.extra,
               t.project_id, t.workspace_id,
               p.name  as "project_name?",
               p.color as "project_color?",
               w.name  as "workspace_name!",
               w.color as "workspace_color!"
        FROM task t
        LEFT JOIN project p ON p.id = t.project_id
        JOIN workspace w ON w.id = t.workspace_id
        WHERE t.workspace_id = ANY($1)
          AND t.deleted_at IS NULL
        "#,
        &ws_ids,
    )
    .fetch_all(&state.pool)
    .await?;

    let orders = sqlx::query!(
        "SELECT priority_ids, today_ids FROM task_order WHERE workspace_id = ANY($1)",
        &ws_ids,
    )
    .fetch_all(&state.pool)
    .await?;

    // Tasks already shown in Today/Priorities aren't backlog.
    let mut in_today: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    for o in orders {
        for id in json_uuid_list(&o.priority_ids) {
            in_today.insert(id);
        }
        for id in json_uuid_list(&o.today_ids) {
            in_today.insert(id);
        }
    }

    let mut backlog: Vec<TaskListItem> = Vec::new();
    let mut recurring: Vec<TaskListItem> = Vec::new();
    let mut done: Vec<TaskListItem> = Vec::new();

    for row in task_rows {
        let recurrence = row
            .extra
            .get("recurrence")
            .filter(|v| !v.is_null())
            .cloned();
        let item = TaskListItem {
            id: row.id,
            title: row.title,
            status: row.status.clone(),
            ticket_id: row.ticket_id,
            completed_at: row.completed_at,
            project_name: row.project_name,
            project_color: row.project_color,
            workspace_id: row.workspace_id,
            workspace_name: row.workspace_name,
            workspace_color: row.workspace_color,
            recurrence: recurrence.clone(),
        };
        let is_done = row.status == "done" || row.status == "cancelled";
        if recurrence.is_some() {
            recurring.push(item);
        } else if is_done {
            if q.done {
                done.push(item);
            }
        } else if !in_today.contains(&row.id) {
            backlog.push(item);
        }
    }

    backlog.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    recurring.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    // Most recently completed first.
    done.sort_by(|a, b| b.completed_at.cmp(&a.completed_at));

    Ok(Json(TasksResponse {
        backlog,
        recurring,
        done,
    }))
}

// ─── Active timer beacon ──────────────────────────────────────────────────────

async fn active_session_from_beacon(
    state: &AppState,
    user_id: Uuid,
    pomos_completed_today: i64,
) -> Result<Option<ActiveSession>> {
    let row = sqlx::query!(
        r#"SELECT value, updated_at FROM user_setting
           WHERE user_id = $1 AND key = 'active_timer' AND deleted_at IS NULL"#,
        user_id,
    )
    .fetch_optional(&state.pool)
    .await?;

    let Some(row) = row else { return Ok(None) };
    let v = row.value;
    if v.is_null() {
        return Ok(None);
    }

    let started_at = match v
        .get("started_at")
        .and_then(|s| s.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
    {
        Some(ts) => ts.with_timezone(&Utc),
        None => return Ok(None),
    };

    // Stale beacon guard: ignore timers that started more than 12h ago
    // (the extension clears the beacon on stop, but it can miss e.g. on crash).
    if Utc::now().signed_duration_since(started_at).num_hours() >= 12 {
        return Ok(None);
    }

    let mode = v
        .get("mode")
        .and_then(|m| m.as_str())
        .unwrap_or("pomodoro")
        .to_owned();
    let planned = v
        .get("duration_seconds")
        .and_then(|d| d.as_i64())
        .map(|d| d as i32);

    // A session that ran past its planned duration (+ grace) finished without the
    // extension clearing the beacon (popup closed) — don't show it as active. Only
    // a stopwatch can legitimately run long; any other mode (pomodoro, or an
    // old/partial beacon with no duration) is bounded to a standard focus block so
    // a ghost still expires instead of lingering up to the 12h hard limit.
    let stale_planned = planned.or((mode != "stopwatch").then_some(25 * 60));
    if let Some(p) = stale_planned {
        let elapsed = Utc::now().signed_duration_since(started_at).num_seconds();
        if elapsed > i64::from(p) + 300 {
            return Ok(None);
        }
    }
    let task_id = v
        .get("task_id")
        .and_then(|t| t.as_str())
        .and_then(|t| Uuid::parse_str(t).ok());

    let mut task_title = None;
    let mut project_name = None;
    let mut ticket_id = None;
    if let Some(tid) = task_id {
        let task = sqlx::query!(
            r#"SELECT t.title, t.ticket_id, p.name as "project_name?"
               FROM task t
               LEFT JOIN project p ON p.id = t.project_id
               JOIN workspace_member m ON m.workspace_id = t.workspace_id AND m.user_id = $2
               WHERE t.id = $1"#,
            tid,
            user_id,
        )
        .fetch_optional(&state.pool)
        .await?;
        if let Some(t) = task {
            task_title = Some(t.title);
            project_name = t.project_name;
            ticket_id = t.ticket_id;
        }
    }

    let elapsed = Utc::now()
        .signed_duration_since(started_at)
        .num_seconds()
        .max(0) as i32;

    Ok(Some(ActiveSession {
        id: Uuid::new_v5(
            &Uuid::NAMESPACE_OID,
            format!("{user_id}:active_timer").as_bytes(),
        ),
        task_id,
        task_title,
        project_name,
        ticket_id,
        mode,
        started_at,
        planned_duration_seconds: planned,
        actual_duration_seconds: elapsed,
        pomo_index: pomos_completed_today + 1,
    }))
}

// ─── Guards ───────────────────────────────────────────────────────────────────

fn json_uuid_list(v: &serde_json::Value) -> Vec<Uuid> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().and_then(|s| Uuid::parse_str(s).ok()))
                .collect()
        })
        .unwrap_or_default()
}

async fn require_workspace_access(
    state: &AppState,
    user_id: Uuid,
    workspace_id: Uuid,
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
