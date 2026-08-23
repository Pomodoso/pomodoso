use axum::{
    extract::{Query, State},
    Extension, Json,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{error::Result, middleware::auth::AuthUser, AppState};

use super::today::require_workspace_access;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct HistoryQuery {
    pub workspace_id: Option<Uuid>,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub tz: Option<String>,
}

#[derive(Serialize)]
pub struct HistoryTask {
    pub id: Uuid,
    pub title: String,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
}

#[derive(Serialize)]
pub struct HistoryDay {
    pub date: NaiveDate,
    pub pomos: i64,
    pub seconds: i64,
    pub tasks_done: Vec<HistoryTask>,
}

#[derive(Serialize)]
pub struct HistoryResponse {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub days: Vec<HistoryDay>,
}

// ─── Handler ──────────────────────────────────────────────────────────────────

pub async fn get_history(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<HistoryResponse>> {
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

    let tz =
        q.tz.as_deref()
            .filter(|t| {
                !t.is_empty()
                    && t.chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '+' | '-'))
            })
            .unwrap_or("UTC")
            .to_owned();

    let mut days: HashMap<NaiveDate, HistoryDay> = HashMap::new();
    let mut cursor = q.from;
    while cursor <= q.to {
        days.insert(
            cursor,
            HistoryDay {
                date: cursor,
                pomos: 0,
                seconds: 0,
                tasks_done: Vec::new(),
            },
        );
        cursor = cursor
            .succ_opt()
            .unwrap_or(cursor + chrono::Duration::days(1));
    }

    // ── Pomos + tracked seconds per day (day boundary in the caller's tz) ─────
    let session_rows = sqlx::query!(
        r#"
        SELECT DATE(started_at AT TIME ZONE $4) as "day!", mode, actual_duration_seconds
        FROM pomodoro_session
        WHERE workspace_id = ANY($1)
          AND status = 'completed'
          AND DATE(started_at AT TIME ZONE $4) BETWEEN $2 AND $3
        "#,
        &ws_ids,
        q.from,
        q.to,
        tz,
    )
    .fetch_all(&state.pool)
    .await?;

    for row in session_rows {
        if let Some(day) = days.get_mut(&row.day) {
            day.seconds += row.actual_duration_seconds as i64;
            if row.mode == "pomodoro" {
                day.pomos += 1;
            }
        }
    }

    // ── Completed tasks per day ─────────────────────────────────────────────
    // One-off tasks: status done/cancelled, bucketed by completed_at if some
    // client set it, else updated_at. completed_at alone isn't a reliable
    // signal — the extension's local Task model has no such field, so it
    // never gets sent on sync push and stays NULL for virtually every real
    // task; the extension's own "when did this happen" view (Tasks > History)
    // falls back to updated_at for this exact reason. Recurring occurrences
    // still come from extra.completedDates (already local YYYY-MM-DD strings,
    // no tz conversion needed for those) and are fanned out separately below,
    // independent of status, to avoid double-counting against the
    // updated_at bucket.
    let task_rows = sqlx::query!(
        r#"
        SELECT t.id, t.title, t.status, t.extra,
               DATE(COALESCE(t.completed_at, t.updated_at) AT TIME ZONE $4) as "effective_day!",
               p.name  as "project_name?",
               p.color as "project_color?"
        FROM task t
        LEFT JOIN project p ON p.id = t.project_id
        WHERE t.workspace_id = ANY($1)
          AND t.deleted_at IS NULL
          AND (
            (t.status IN ('done', 'cancelled')
             AND DATE(COALESCE(t.completed_at, t.updated_at) AT TIME ZONE $4) BETWEEN $2 AND $3)
            OR t.extra ? 'completedDates'
          )
        "#,
        &ws_ids,
        q.from,
        q.to,
        tz,
    )
    .fetch_all(&state.pool)
    .await?;

    for row in task_rows {
        let has_completed_dates = row
            .extra
            .get("completedDates")
            .and_then(|v| v.as_array())
            .is_some_and(|a| !a.is_empty());

        if !has_completed_dates && matches!(row.status.as_str(), "done" | "cancelled") {
            if let Some(bucket) = days.get_mut(&row.effective_day) {
                bucket.tasks_done.push(HistoryTask {
                    id: row.id,
                    title: row.title.clone(),
                    project_name: row.project_name.clone(),
                    project_color: row.project_color.clone(),
                });
            }
        }

        // Recurring occurrences: extra.completedDates is a JSON array of
        // "YYYY-MM-DD" strings already anchored to the local date they were
        // completed on (see extension/mobile's Task.completedDates) — parse
        // once and fan the same task out to every date in range it covers.
        if let Some(dates) = row.extra.get("completedDates").and_then(|v| v.as_array()) {
            for d in dates.iter().filter_map(|v| v.as_str()) {
                if let Ok(date) = NaiveDate::parse_from_str(d, "%Y-%m-%d") {
                    if let Some(bucket) = days.get_mut(&date) {
                        bucket.tasks_done.push(HistoryTask {
                            id: row.id,
                            title: row.title.clone(),
                            project_name: row.project_name.clone(),
                            project_color: row.project_color.clone(),
                        });
                    }
                }
            }
        }
    }

    let mut days: Vec<HistoryDay> = days.into_values().collect();
    days.sort_by_key(|d| d.date);

    Ok(Json(HistoryResponse {
        from: q.from,
        to: q.to,
        days,
    }))
}
