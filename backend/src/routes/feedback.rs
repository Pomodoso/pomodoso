// The anonymous "why did you remove it?" form: the web's /goodbye page, which
// Chrome opens right after the extension is uninstalled. Public, because there
// is no extension left to sign in with. An answer carries nothing that
// identifies the user: the reason, an optional comment, the extension version
// and how many days it was installed.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;

use crate::{
    error::{AppError, Result},
    AppState,
};

/// The answers the form offers. Anything else is refused, so the column only
/// ever holds values someone can group by.
pub const REASONS: &[&str] = &[
    "not_using",
    "missing_feature",
    "too_complex",
    "broken",
    "other_app",
    "privacy",
    "just_trying",
    "other",
];
const MAX_COMMENT_CHARS: usize = 2000;
const MAX_VERSION_CHARS: usize = 20;
/// Ten years: anything above it isn't a real install age.
const MAX_DAYS_INSTALLED: i32 = 3650;
/// For everyone together. The route is anonymous and keeps no IP, so there is
/// nothing to limit per caller; a global cap bounds the writes it can cost.
const ANSWERS_PER_MINUTE: u32 = 30;

#[derive(Deserialize)]
pub struct UninstallBody {
    reason: String,
    #[serde(default)]
    comment: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    days_installed: Option<i32>,
}

/// Trimmed, empty as None, cut to `max` characters.
fn clean(value: Option<String>, max: usize) -> Option<String> {
    let trimmed = value?.trim().to_owned();
    (!trimmed.is_empty()).then(|| trimmed.chars().take(max).collect())
}

/// A version is digits and dots ("1.4.2"); anything else is dropped rather
/// than stored.
fn clean_version(value: Option<String>) -> Option<String> {
    clean(value, MAX_VERSION_CHARS).filter(|v| v.chars().all(|c| c.is_ascii_digit() || c == '.'))
}

pub async fn uninstall(
    State(state): State<AppState>,
    Json(body): Json<UninstallBody>,
) -> Result<StatusCode> {
    static WINDOW: Mutex<Option<(Instant, u32)>> = Mutex::new(None);
    let allowed = {
        let mut window = WINDOW.lock().unwrap_or_else(|e| e.into_inner());
        answer_allowed(&mut window, Instant::now())
    };
    if !allowed {
        return Err(AppError::TooManyRequests(
            "too many answers; try again later".into(),
        ));
    }
    if !REASONS.contains(&body.reason.as_str()) {
        return Err(AppError::BadRequest("unknown reason".into()));
    }
    let comment = clean(body.comment, MAX_COMMENT_CHARS);
    let version = clean_version(body.version);
    let days_installed = body
        .days_installed
        .filter(|d| (0..=MAX_DAYS_INSTALLED).contains(d));
    sqlx::query!(
        r#"INSERT INTO uninstall_feedback (reason, comment, version, days_installed)
           VALUES ($1, $2, $3, $4)"#,
        body.reason,
        comment,
        version,
        days_installed,
    )
    .execute(&state.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A fixed one-minute window: when it started and how many answers it took.
fn answer_allowed(window: &mut Option<(Instant, u32)>, now: Instant) -> bool {
    match window {
        Some((started, count)) if now.duration_since(*started) < Duration::from_secs(60) => {
            if *count >= ANSWERS_PER_MINUTE {
                return false;
            }
            *count += 1;
            true
        }
        _ => {
            *window = Some((now, 1));
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_trimmed_capped_and_empty_dropped() {
        assert_eq!(clean(Some("  hi  ".into()), 10).as_deref(), Some("hi"));
        assert_eq!(clean(Some("   ".into()), 10), None);
        assert_eq!(clean(None, 10), None);
        assert_eq!(clean(Some("x".repeat(50)), 10).map(|s| s.len()), Some(10));
    }

    #[test]
    fn only_a_dotted_version_is_kept() {
        assert_eq!(
            clean_version(Some("1.4.2".into())).as_deref(),
            Some("1.4.2")
        );
        assert_eq!(clean_version(Some("<b>".into())), None);
        assert_eq!(clean_version(Some("1.4.2-beta".into())), None);
    }

    #[test]
    fn the_window_caps_answers_per_minute() {
        let mut window = None;
        let start = Instant::now();
        for _ in 0..ANSWERS_PER_MINUTE {
            assert!(answer_allowed(&mut window, start));
        }
        assert!(!answer_allowed(&mut window, start));
        assert!(answer_allowed(&mut window, start + Duration::from_secs(61)));
    }
}
