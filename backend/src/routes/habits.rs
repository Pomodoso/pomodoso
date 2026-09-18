use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use std::collections::HashMap;

use crate::{
    error::{AppError, Result},
    habit_streak::ChallengeProgress,
    habit_streak::{
        challenge_length, challenge_progress, challenge_run, challenge_skips_left, compute_streak,
        scheduled_days, sort_order, HabitStreak,
    },
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
    /// Set when the habit runs as a fixed-length challenge; `None` otherwise.
    pub challenge_length_days: Option<i32>,
    /// Days into the current run.
    pub challenge_days_done: i32,
    /// Recorded when the run finished, so a later rest day can't revoke it.
    pub challenge_complete: bool,
    pub challenge_completed_at: Option<NaiveDate>,
    /// Non-empty means the run is stalled waiting on the user.
    pub challenge_missed_days: Vec<NaiveDate>,
    pub challenge_skips_left: i32,
    /// Consecutive scheduled days completed before today.
    pub streak: i32,
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

fn row_to_info(
    row: HabitRow,
    streak: HabitStreak,
    challenge: Option<ChallengeProgress>,
) -> HabitInfo {
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
    let challenge_length_days = challenge_length(&row.extra);
    let skips_left = challenge_run(&row.extra)
        .as_ref()
        .map_or(0, challenge_skips_left);
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
        challenge_length_days,
        challenge_days_done: challenge.as_ref().map_or(streak.days_done, |c| c.days_done),
        challenge_complete: challenge.as_ref().is_some_and(|c| c.complete),
        challenge_completed_at: challenge.as_ref().and_then(|c| c.completed_at),
        challenge_missed_days: challenge.map(|c| c.missed_days).unwrap_or_default(),
        challenge_skips_left: skips_left,
        streak: streak.past_streak,
    }
}

/// Every habit log for a user, keyed by habit, within the window the streak
/// walk can reach. Bounded to the clients' own 3650-day lookback so a very
/// old account doesn't pull its entire history to render one card.
pub(crate) async fn habit_logs_by_habit(
    state: &AppState,
    user_id: Uuid,
    through: NaiveDate,
) -> Result<HashMap<Uuid, HashMap<NaiveDate, i32>>> {
    let since = through - chrono::Duration::days(3650);
    let rows = sqlx::query!(
        r#"
        SELECT hl.habit_id, hl.date, hl.value
        FROM habit_log hl
        JOIN habit h ON h.id = hl.habit_id
        WHERE h.user_id = $1 AND h.deleted_at IS NULL
          AND hl.date > $2 AND hl.date <= $3
        "#,
        user_id,
        since,
        through,
    )
    .fetch_all(&state.pool)
    .await?;

    let mut by_habit: HashMap<Uuid, HashMap<NaiveDate, i32>> = HashMap::new();
    for r in rows {
        by_habit
            .entry(r.habit_id)
            .or_default()
            .insert(r.date, r.value);
    }
    Ok(by_habit)
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

    let logs = habit_logs_by_habit(&state, auth.id, date).await?;
    let empty = HashMap::new();

    let mut habits: Vec<(Option<i64>, HabitInfo)> = rows
        .into_iter()
        .map(|r| {
            let streak = compute_streak(
                &r.kind,
                r.target_count,
                &scheduled_days(&r.frequency, r.frequency_days.as_deref()),
                logs.get(&r.id).unwrap_or(&empty),
                date,
            );
            let run = challenge_run(&r.extra);
            let challenge = run.as_ref().map(|run| {
                challenge_progress(
                    run,
                    &r.kind,
                    r.target_count,
                    &scheduled_days(&r.frequency, r.frequency_days.as_deref()),
                    logs.get(&r.id).unwrap_or(&empty),
                    date,
                )
            });
            let order = sort_order(&r.extra);
            let info = row_to_info(
                HabitRow {
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
                },
                streak,
                challenge,
            );
            (order, info)
        })
        .collect();

    // The manual order the clients write lives in `extra.sortOrder`, not in the
    // `position` column the SQL above orders by — nothing has ever written that
    // column, so on its own it showed the web a different order than every
    // other client. Sorting here rather than in SQL keeps the ORDER BY as the
    // stable tie-break for habits that have never been dragged.
    habits.sort_by_key(|(order, _)| order.unwrap_or(i64::MAX));

    Ok(Json(
        habits.into_iter().map(|(_, info)| info).collect::<Vec<_>>(),
    ))
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
        // The web's habit form doesn't offer challenges — they're set from the
        // extension or mobile — so a habit created here never starts as one,
        // and has no history to have a streak from either.
        challenge_length_days: None,
        challenge_days_done: 0,
        challenge_complete: false,
        challenge_completed_at: None,
        challenge_missed_days: Vec::new(),
        challenge_skips_left: 0,
        streak: 0,
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

    // The streak is left at zero rather than recomputed: this response only
    // feeds the edited row back into the form, and the list refetches after.
    Ok(Json(row_to_info(
        HabitRow {
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
        },
        HabitStreak::default(),
        None,
    )))
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
// One combined grid across every habit — not per-habit — so a day's color
// reflects overall habit consistency ("how many of your habits did you hit
// that day"), not any single habit's identity.

#[derive(Deserialize)]
pub struct HabitsHistoryQuery {
    pub year: i32,
}

#[derive(Serialize)]
pub struct HabitsHistoryDay {
    pub date: NaiveDate,
    /// Sum of each habit's fractional progress that day (each capped at 1.0),
    /// not a count of fully-completed habits — a day where you logged partial
    /// progress on a counter habit should still show *some* color, not none.
    pub habits_done: f64,
}

#[derive(Serialize)]
pub struct HabitsHistoryResponse {
    pub year: i32,
    pub habits_total: i32,
    pub days: Vec<HabitsHistoryDay>,
}

pub async fn get_habits_history(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<HabitsHistoryQuery>,
) -> Result<Json<HabitsHistoryResponse>> {
    let from =
        NaiveDate::from_ymd_opt(q.year, 1, 1).ok_or(AppError::BadRequest("invalid year".into()))?;
    let to = NaiveDate::from_ymd_opt(q.year, 12, 31)
        .ok_or(AppError::BadRequest("invalid year".into()))?;

    let habits = sqlx::query!(
        r#"SELECT id, kind, target_count FROM habit WHERE user_id = $1 AND deleted_at IS NULL"#,
        auth.id,
    )
    .fetch_all(&state.pool)
    .await?;
    let habits_total = habits.len() as i32;
    let habit_meta: std::collections::HashMap<Uuid, (String, Option<i32>)> = habits
        .into_iter()
        .map(|h| (h.id, (h.kind, h.target_count)))
        .collect();

    let rows = sqlx::query!(
        r#"
        SELECT hl.habit_id, hl.date, hl.value
        FROM habit_log hl
        JOIN habit h ON h.id = hl.habit_id
        WHERE h.user_id = $1 AND h.deleted_at IS NULL AND hl.date BETWEEN $2 AND $3
        "#,
        auth.id,
        from,
        to,
    )
    .fetch_all(&state.pool)
    .await?;

    // completed_at is an unreliable "done" signal for both habit kinds — it
    // can be NULL even when value already met/exceeded target for counters,
    // and NULL on plainly-logged boolean rows too (confirmed against real
    // data: every boolean log in the sample had completed_at NULL despite
    // value=1 meaning "done"). value is always set by every client that logs
    // a habit, so it's the one signal to trust for both kinds.
    //
    // Counter habits without a target_count fall back to the year's own max
    // logged value for that habit, so a goalless counter still shows some
    // intensity instead of never having a denominator to compare against.
    let mut max_by_habit: std::collections::HashMap<Uuid, i32> = std::collections::HashMap::new();
    for row in &rows {
        if let Some((kind, target)) = habit_meta.get(&row.habit_id) {
            if kind == "counter" && !target.is_some_and(|t| t > 0) {
                let entry = max_by_habit.entry(row.habit_id).or_insert(0);
                if row.value > *entry {
                    *entry = row.value;
                }
            }
        }
    }

    let mut score_by_day: std::collections::HashMap<NaiveDate, f64> =
        std::collections::HashMap::new();
    for row in rows {
        let Some((kind, target)) = habit_meta.get(&row.habit_id) else {
            continue;
        };
        let ratio: f64 = match kind.as_str() {
            "counter" => {
                let denom = target
                    .filter(|t| *t > 0)
                    .map(f64::from)
                    .unwrap_or_else(|| f64::from(*max_by_habit.get(&row.habit_id).unwrap_or(&0)));
                if denom > 0.0 {
                    (f64::from(row.value) / denom).min(1.0)
                } else {
                    0.0
                }
            }
            _ => f64::from(i32::from(row.value > 0)),
        };
        *score_by_day.entry(row.date).or_insert(0.0) += ratio;
    }

    let mut days = Vec::new();
    let mut cursor = from;
    while cursor <= to {
        days.push(HabitsHistoryDay {
            date: cursor,
            habits_done: score_by_day.get(&cursor).copied().unwrap_or(0.0),
        });
        cursor = cursor
            .succ_opt()
            .unwrap_or(cursor + chrono::Duration::days(1));
    }

    Ok(Json(HabitsHistoryResponse {
        year: q.year,
        habits_total,
        days,
    }))
}
