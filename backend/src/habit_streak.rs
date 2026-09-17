//! Habit streaks and 21-day challenge progress.
//!
//! The extension and mobile each compute this locally from their own copy of
//! the logs (`computeHabitStreak`). The web app has no local copy — it reads
//! everything over HTTP — so the same rules have to exist here, and they have
//! to agree, or the same habit shows a different day count depending on which
//! client you open.
//!
//! Two details carry the agreement, and both are easy to get subtly wrong:
//!
//! - Unscheduled days are *skipped*, not counted as misses. A Mon/Wed/Fri
//!   habit does not lose its streak over the weekend.
//! - `past_streak` stops before today, so a day that hasn't been done yet
//!   doesn't read as a broken streak. `days_done` adds today back in once it
//!   is actually done — that is the number the challenge card shows, so it
//!   ticks up the moment you complete today rather than waiting for tomorrow.

use chrono::{Datelike, Duration, NaiveDate};
use std::collections::HashMap;

/// Ten years. A challenge longer than a year is unusual but not implausible,
/// and the loop is a handful of hash lookups either way — this exists to bound
/// it at all, not to be tight. Mirrors the clients' own 3650 cap.
const MAX_LOOKBACK_DAYS: i64 = 3650;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct HabitStreak {
    /// Consecutive scheduled days completed *before* today.
    pub past_streak: i32,
    pub done_today: bool,
    /// `past_streak`, plus today when it is already done.
    pub days_done: i32,
}

/// Weekdays a habit is scheduled on, as 0=Mon..6=Sun.
///
/// An empty result means "every day" — the canonical form the clients save a
/// full seven-day selection as, so it has to mean the same thing here.
pub fn scheduled_days(frequency: &str, frequency_days: Option<&str>) -> Vec<i64> {
    match frequency {
        "weekdays" => vec![0, 1, 2, 3, 4],
        "custom" => frequency_days
            .and_then(|d| serde_json::from_str::<Vec<i64>>(d).ok())
            // Unparseable custom days degrade to every-day rather than to
            // "never", matching habitDaysFromServer on both clients: a habit
            // that silently stops appearing is worse than one that appears too
            // often.
            .unwrap_or_default(),
        _ => Vec::new(), // daily
    }
}

fn is_scheduled(days: &[i64], date: NaiveDate) -> bool {
    days.is_empty() || days.contains(&(date.weekday().num_days_from_monday() as i64))
}

fn is_done(kind: &str, target_count: Option<i32>, value: Option<i32>) -> bool {
    let value = value.unwrap_or(0);
    match kind {
        "counter" => value >= target_count.unwrap_or(1),
        // habit_log stores booleans as a value, which is what sync writes and
        // what /today already reads them back as.
        _ => value > 0,
    }
}

/// `logs` maps a date to that day's logged value; absent means no log.
pub fn compute_streak(
    kind: &str,
    target_count: Option<i32>,
    days: &[i64],
    logs: &HashMap<NaiveDate, i32>,
    today: NaiveDate,
) -> HabitStreak {
    let done_today =
        is_scheduled(days, today) && is_done(kind, target_count, logs.get(&today).copied());

    let mut past_streak = 0;
    for i in 1..MAX_LOOKBACK_DAYS {
        let date = today - Duration::days(i);
        if !is_scheduled(days, date) {
            continue;
        }
        if is_done(kind, target_count, logs.get(&date).copied()) {
            past_streak += 1;
        } else {
            break;
        }
    }

    HabitStreak {
        past_streak,
        done_today,
        days_done: past_streak + i32::from(done_today),
    }
}

/// The manual order a habit was dragged into, from its `extra` bag.
///
/// Both clients write `extra.sortOrder`; the `habit.position` column predates
/// them and nothing has ever written it, so ordering by it alone showed the web
/// a different order than every other client.
pub fn sort_order(extra: &serde_json::Value) -> Option<i64> {
    extra.get("sortOrder").and_then(|v| v.as_i64())
}

/// Challenge length in days, from the habit's `extra` bag. `None` means the
/// habit is not running as a challenge.
pub fn challenge_length(extra: &serde_json::Value) -> Option<i32> {
    extra
        .get("challengeLengthDays")
        .and_then(|v| v.as_i64())
        .filter(|v| *v > 0)
        .map(|v| v as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }

    fn logs(entries: &[(&str, i32)]) -> HashMap<NaiveDate, i32> {
        entries.iter().map(|(d, v)| (date(d), *v)).collect()
    }

    // 2026-09-17 is a Thursday.
    const TODAY: &str = "2026-09-17";

    #[test]
    fn counts_consecutive_days_before_today() {
        let l = logs(&[("2026-09-16", 1), ("2026-09-15", 1), ("2026-09-14", 1)]);
        let s = compute_streak("boolean", None, &[], &l, date(TODAY));
        assert_eq!(s.past_streak, 3);
        assert!(!s.done_today);
        assert_eq!(s.days_done, 3);
    }

    #[test]
    fn today_not_yet_done_does_not_break_the_streak() {
        // The whole reason past_streak stops before today.
        let l = logs(&[("2026-09-16", 1)]);
        let s = compute_streak("boolean", None, &[], &l, date(TODAY));
        assert_eq!(s.past_streak, 1);
        assert_eq!(s.days_done, 1);
    }

    #[test]
    fn completing_today_ticks_the_challenge_counter_immediately() {
        let l = logs(&[(TODAY, 1), ("2026-09-16", 1)]);
        let s = compute_streak("boolean", None, &[], &l, date(TODAY));
        assert_eq!(s.past_streak, 1);
        assert!(s.done_today);
        assert_eq!(s.days_done, 2);
    }

    #[test]
    fn a_gap_ends_the_streak() {
        let l = logs(&[("2026-09-16", 1), ("2026-09-14", 1)]);
        let s = compute_streak("boolean", None, &[], &l, date(TODAY));
        assert_eq!(s.past_streak, 1);
    }

    #[test]
    fn unscheduled_days_are_skipped_not_counted_as_misses() {
        // Mon/Wed/Fri. Walking back from Thursday: Wed done, Tue skipped,
        // Mon done, Sun/Sat skipped, Fri done.
        let days = [0, 2, 4];
        let l = logs(&[
            ("2026-09-16", 1), // Wed
            ("2026-09-14", 1), // Mon
            ("2026-09-11", 1), // Fri
        ]);
        let s = compute_streak("boolean", None, &days, &l, date(TODAY));
        assert_eq!(s.past_streak, 3);
        // Thursday isn't scheduled, so there is nothing to do today.
        assert!(!s.done_today);
    }

    #[test]
    fn a_counter_habit_needs_to_reach_its_target() {
        let l = logs(&[("2026-09-16", 8), ("2026-09-15", 3)]);
        let s = compute_streak("counter", Some(8), &[], &l, date(TODAY));
        assert_eq!(s.past_streak, 1);
    }

    #[test]
    fn a_counter_with_no_target_needs_one() {
        let l = logs(&[("2026-09-16", 1), ("2026-09-15", 0)]);
        let s = compute_streak("counter", None, &[], &l, date(TODAY));
        assert_eq!(s.past_streak, 1);
    }

    #[test]
    fn no_logs_is_no_streak() {
        let s = compute_streak("boolean", None, &[], &HashMap::new(), date(TODAY));
        assert_eq!(s, HabitStreak::default());
    }

    #[test]
    fn scheduled_days_maps_every_frequency() {
        assert_eq!(scheduled_days("daily", None), Vec::<i64>::new());
        assert_eq!(scheduled_days("weekdays", None), vec![0, 1, 2, 3, 4]);
        assert_eq!(scheduled_days("custom", Some("[1,3]")), vec![1, 3]);
        // Degrades to every-day rather than never.
        assert_eq!(
            scheduled_days("custom", Some("not json")),
            Vec::<i64>::new()
        );
        assert_eq!(scheduled_days("custom", None), Vec::<i64>::new());
    }

    #[test]
    fn challenge_length_only_reads_a_positive_number() {
        assert_eq!(
            challenge_length(&serde_json::json!({ "challengeLengthDays": 21 })),
            Some(21)
        );
        assert_eq!(
            challenge_length(&serde_json::json!({ "challengeLengthDays": 0 })),
            None
        );
        assert_eq!(
            challenge_length(&serde_json::json!({ "challengeLengthDays": null })),
            None
        );
        assert_eq!(challenge_length(&serde_json::json!({})), None);
    }

    #[test]
    fn sort_order_reads_zero_as_a_real_position() {
        assert_eq!(sort_order(&serde_json::json!({ "sortOrder": 0 })), Some(0));
        assert_eq!(sort_order(&serde_json::json!({ "sortOrder": 4 })), Some(4));
        assert_eq!(sort_order(&serde_json::json!({})), None);
    }
}
