use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    AppState,
};

// ─── Types ────────────────────────────────────────────────────────────────────
// Habits are user-global, not workspace-scoped (CLAUDE.md rule 6) — every
// query here is filtered by user_id alone, same as today.rs's habit read.

#[derive(Deserialize)]
pub struct HabitsQuery {
    /// Which day's log to merge in — defaults to today (server TZ; a
    /// per-user IANA tz param isn't worth the complexity here, unlike
    /// /today, since this is a management list, not a "what's due right
    /// now" view).
    pub date: Option<NaiveDate>,
}

#[derive(Serialize)]
pub struct HabitInfo {
    pub id: Uuid,
    pub name: String,
    pub icon: String,
    pub kind: String,
    pub target_count: Option<i32>,
    pub frequency: String,
    pub frequency_days: Option<String>,
    pub unit: Option<String>,
    pub unit_amount: Option<i32>,
    pub log_value: i32,
    pub log_done: bool,
    pub log_completed_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
pub struct HabitBody {
    pub name: String,
    pub icon: String,
    pub kind: String,
    pub target_count: Option<i32>,
    pub frequency: String,
    pub frequency_days: Option<String>,
    pub unit: Option<String>,
    pub unit_amount: Option<i32>,
}

#[derive(Deserialize)]
pub struct LogBody {
    pub date: NaiveDate,
    pub value: i32,
    pub done: bool,
}

fn validate(body: &HabitBody) -> Result<()> {
    if body.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    if body.kind != "boolean" && body.kind != "counter" {
        return Err(AppError::BadRequest(
            "kind must be boolean or counter".into(),
        ));
    }
    if body.frequency != "daily" && body.frequency != "weekdays" && body.frequency != "custom" {
        return Err(AppError::BadRequest(
            "frequency must be daily, weekdays, or custom".into(),
        ));
    }
    Ok(())
}

async fn require_habit_owner(state: &AppState, user_id: Uuid, habit_id: Uuid) -> Result<()> {
    let owner = sqlx::query_scalar!(
        "SELECT user_id FROM habit WHERE id = $1 AND deleted_at IS NULL",
        habit_id,
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    if owner != Some(user_id) {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

struct HabitRow {
    id: Uuid,
    name: String,
    icon: String,
    kind: String,
    target_count: Option<i32>,
    frequency: String,
    frequency_days: Option<String>,
    extra: Value,
    log_value: Option<i32>,
    log_completed_at: Option<DateTime<Utc>>,
}

fn row_to_info(row: HabitRow) -> HabitInfo {
    let unit = row
        .extra
        .get("unit")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    let unit_amount = row
        .extra
        .get("unitAmount")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let value = row.log_value.unwrap_or(0);
    let done = match row.kind.as_str() {
        "counter" => row.target_count.is_some_and(|t| value >= t),
        _ => row.log_completed_at.is_some(),
    };
    HabitInfo {
        id: row.id,
        name: row.name,
        icon: row.icon,
        kind: row.kind,
        target_count: row.target_count,
        frequency: row.frequency,
        frequency_days: row.frequency_days,
        unit,
        unit_amount,
        log_value: value,
        log_done: done,
        log_completed_at: row.log_completed_at,
    }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_habits(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<HabitsQuery>,
) -> Result<Json<Vec<HabitInfo>>> {
    let date = q.date.unwrap_or_else(|| Utc::now().date_naive());

    let rows = sqlx::query!(
        r#"
        SELECT h.id, h.name, h.icon, h.kind, h.target_count, h.frequency, h.frequency_days, h.extra,
               hl.value        as "log_value?",
               hl.completed_at as "log_completed_at?"
        FROM habit h
        LEFT JOIN habit_log hl ON hl.habit_id = h.id AND hl.date = $2
        WHERE h.user_id = $1 AND h.deleted_at IS NULL
        ORDER BY h.position, h.created_at
        "#,
        auth.id,
        date,
    )
    .fetch_all(&state.pool)
    .await?;

    let habits = rows
        .into_iter()
        .map(|r| {
            row_to_info(HabitRow {
                id: r.id,
                name: r.name,
                icon: r.icon,
                kind: r.kind,
                target_count: r.target_count,
                frequency: r.frequency,
                frequency_days: r.frequency_days,
                extra: r.extra,
                log_value: r.log_value,
                log_completed_at: r.log_completed_at,
            })
        })
        .collect();

    Ok(Json(habits))
}

pub async fn create_habit(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<HabitBody>,
) -> Result<Json<HabitInfo>> {
    validate(&body)?;
    let extra = serde_json::json!({ "unit": body.unit, "unitAmount": body.unit_amount });

    let id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO habit (id, user_id, name, icon, kind, target_count, frequency, frequency_days, extra, updated_at, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        "#,
        id,
        auth.id,
        body.name.trim(),
        body.icon,
        body.kind,
        body.target_count,
        body.frequency,
        body.frequency_days,
        extra,
    )
    .execute(&state.pool)
    .await?;

    Ok(Json(HabitInfo {
        id,
        name: body.name.trim().to_owned(),
        icon: body.icon,
        kind: body.kind,
        target_count: body.target_count,
        frequency: body.frequency,
        frequency_days: body.frequency_days,
        unit: body.unit,
        unit_amount: body.unit_amount,
        log_value: 0,
        log_done: false,
        log_completed_at: None,
    }))
}

pub async fn update_habit(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<HabitBody>,
) -> Result<Json<HabitInfo>> {
    validate(&body)?;
    require_habit_owner(&state, auth.id, id).await?;

    // Shallow-merges unit/unitAmount into whatever's already in `extra`
    // (endDate, challengeLengthDays, timeUnit — managed by the
    // extension/mobile, not this page) rather than overwriting the column,
    // so editing a habit here doesn't silently drop fields this page
    // doesn't know about.
    let row = sqlx::query!(
        r#"
        UPDATE habit SET
          name = $2, icon = $3, kind = $4, target_count = $5,
          frequency = $6, frequency_days = $7,
          extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('unit', $8::text, 'unitAmount', $9::int),
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, icon, kind, target_count, frequency, frequency_days, extra
        "#,
        id,
        body.name.trim(),
        body.icon,
        body.kind,
        body.target_count,
        body.frequency,
        body.frequency_days,
        body.unit,
        body.unit_amount,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(row_to_info(HabitRow {
        id: row.id,
        name: row.name,
        icon: row.icon,
        kind: row.kind,
        target_count: row.target_count,
        frequency: row.frequency,
        frequency_days: row.frequency_days,
        extra: row.extra,
        log_value: None,
        log_completed_at: None,
    })))
}

pub async fn delete_habit(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    require_habit_owner(&state, auth.id, id).await?;

    sqlx::query!(
        "UPDATE habit SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
        id,
    )
    .execute(&state.pool)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn log_habit(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<LogBody>,
) -> Result<StatusCode> {
    require_habit_owner(&state, auth.id, id).await?;

    let completed_at = body.done.then(Utc::now);

    sqlx::query!(
        r#"
        INSERT INTO habit_log (id, habit_id, user_id, date, value, completed_at, updated_at, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT (habit_id, date) DO UPDATE SET
          value        = EXCLUDED.value,
          completed_at = EXCLUDED.completed_at,
          updated_at   = NOW(),
          synced_at    = NOW()
        "#,
        Uuid::new_v4(),
        id,
        auth.id,
        body.date,
        body.value,
        completed_at,
    )
    .execute(&state.pool)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ─── Yearly history (GitHub-contributions-style heatmap) ──────────────────────

#[derive(Deserialize)]
pub struct HabitHistoryQuery {
    pub year: i32,
}

#[derive(Serialize)]
pub struct HabitHistoryDay {
    pub date: NaiveDate,
    pub value: i32,
    pub done: bool,
}

#[derive(Serialize)]
pub struct HabitHistoryResponse {
    pub year: i32,
    pub days: Vec<HabitHistoryDay>,
}

pub async fn get_habit_history(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<HabitHistoryQuery>,
) -> Result<Json<HabitHistoryResponse>> {
    require_habit_owner(&state, auth.id, id).await?;

    let from =
        NaiveDate::from_ymd_opt(q.year, 1, 1).ok_or(AppError::BadRequest("invalid year".into()))?;
    let to = NaiveDate::from_ymd_opt(q.year, 12, 31)
        .ok_or(AppError::BadRequest("invalid year".into()))?;

    let rows = sqlx::query!(
        r#"
        SELECT date, value, completed_at
        FROM habit_log
        WHERE habit_id = $1 AND date BETWEEN $2 AND $3
        ORDER BY date
        "#,
        id,
        from,
        to,
    )
    .fetch_all(&state.pool)
    .await?;

    let days = rows
        .into_iter()
        .map(|r| HabitHistoryDay {
            date: r.date,
            value: r.value,
            done: r.completed_at.is_some(),
        })
        .collect();

    Ok(Json(HabitHistoryResponse { year: q.year, days }))
}
