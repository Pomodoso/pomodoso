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

// ─── Challenge runs ───────────────────────────────────────────────────────────

/// A challenge run, as the clients store it in `habit.extra`.
///
/// A challenge used to be a pure view of the current streak, so a missed day
/// silently reset it to zero and a completed run un-completed itself the first
/// time the streak broke afterwards. These fields record the run itself; see
/// @pomodoso/types' ChallengeState, which the clients share.
pub struct ChallengeRun {
    pub length_days: i32,
    pub started_at: Option<NaiveDate>,
    pub completed_at: Option<NaiveDate>,
    pub skipped_days: Vec<NaiveDate>,
}

/// Skips left on a run, matching challengeSkipAllowance in @pomodoso/types:
/// roughly one per week, never zero.
pub fn challenge_skips_left(run: &ChallengeRun) -> i32 {
    let allowance = std::cmp::max(1, run.length_days / 7);
    std::cmp::max(0, allowance - run.skipped_days.len() as i32)
}

pub struct ChallengeProgress {
    pub days_done: i32,
    pub complete: bool,
    pub completed_at: Option<NaiveDate>,
    /// Past scheduled days missed and not forgiven. Non-empty means the run is
    /// waiting on the user to keep going or start over.
    pub missed_days: Vec<NaiveDate>,
}

fn parse_dates(extra: &serde_json::Value, key: &str) -> Vec<NaiveDate> {
    extra
        .get(key)
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .filter_map(|s| s.parse().ok())
                .collect()
        })
        .unwrap_or_default()
}

fn parse_date(extra: &serde_json::Value, key: &str) -> Option<NaiveDate> {
    extra.get(key)?.as_str()?.parse().ok()
}

/// Reads a run out of a habit's `extra` bag. `None` when the habit isn't a
/// challenge at all.
pub fn challenge_run(extra: &serde_json::Value) -> Option<ChallengeRun> {
    let length_days = challenge_length(extra)?;
    Some(ChallengeRun {
        length_days,
        started_at: parse_date(extra, "challengeStartedAt"),
        completed_at: parse_date(extra, "challengeCompletedAt"),
        skipped_days: parse_dates(extra, "challengeSkippedDays"),
    })
}

/// Progress for a run, walking its scheduled days from the start date.
///
/// Mirrors `challengeProgress` in @pomodoso/types. The two have to agree, or
/// the dashboard reports a different day count than the app that recorded it.
///
/// A run with no start date falls back to the streak, which is what every
/// challenge looked like before the clients began recording runs — that keeps
/// a device that hasn't upgraded yet from reading as "Day 0".
pub fn challenge_progress(
    run: &ChallengeRun,
    kind: &str,
    target_count: Option<i32>,
    days: &[i64],
    logs: &HashMap<NaiveDate, i32>,
    today: NaiveDate,
) -> ChallengeProgress {
    let Some(started_at) = run.started_at else {
        let streak = compute_streak(kind, target_count, days, logs, today);
        return ChallengeProgress {
            days_done: streak.days_done,
            complete: run.completed_at.is_some() || streak.days_done >= run.length_days,
            completed_at: run.completed_at,
            missed_days: Vec::new(),
        };
    };

    // A start date arrives from the client and is never validated there, so an
    // account can carry one arbitrarily far in the past — walking from it
    // literally would let a single synced habit cost the server hundreds of
    // thousands of iterations per request, on every /today and /habits call.
    // Clamped to the same 3650-day window the clients bound their own walk to.
    let mut days_done = 0;
    let mut missed_days = Vec::new();
    let earliest = today - Duration::days(MAX_LOOKBACK_DAYS);
    let mut date = std::cmp::max(started_at, earliest);
    while date <= today {
        if is_scheduled(days, date) {
            if is_done(kind, target_count, logs.get(&date).copied()) {
                days_done += 1;
            } else if date < today && !run.skipped_days.contains(&date) {
                missed_days.push(date);
            }
        }
        date += Duration::days(1);
    }

    ChallengeProgress {
        // Once recorded, completion stands — a later rest day cannot take it
        // back. An unresolved miss blocks completion even at full count, so a
        // run that broke and kept being logged can't sail past its length and
        // skip the decision. Mirrors challengeProgress in @pomodoso/types.
        complete: run.completed_at.is_some()
            || (days_done >= run.length_days && missed_days.is_empty()),
        days_done,
        completed_at: run.completed_at,
        missed_days,
    }
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

    fn run(
        length: i32,
        started: Option<&str>,
        completed: Option<&str>,
        skipped: &[&str],
    ) -> ChallengeRun {
        ChallengeRun {
            length_days: length,
            started_at: started.map(date),
            completed_at: completed.map(date),
            skipped_days: skipped.iter().map(|s| date(s)).collect(),
        }
    }

    #[test]
    fn challenge_progress_counts_done_days_and_reports_misses() {
        let l = logs(&[("2026-09-01", 1), ("2026-09-02", 1), ("2026-09-04", 1)]);
        let p = challenge_progress(
            &run(21, Some("2026-09-01"), None, &[]),
            "boolean",
            None,
            &[],
            &l,
            date("2026-09-05"),
        );
        assert_eq!(p.days_done, 3);
        assert_eq!(p.missed_days, vec![date("2026-09-03")]);
        assert!(!p.complete);
    }

    #[test]
    fn a_forgiven_day_stops_being_a_miss_without_becoming_a_done_day() {
        let l = logs(&[("2026-09-01", 1), ("2026-09-02", 1), ("2026-09-04", 1)]);
        let p = challenge_progress(
            &run(21, Some("2026-09-01"), None, &["2026-09-03"]),
            "boolean",
            None,
            &[],
            &l,
            date("2026-09-05"),
        );
        assert!(p.missed_days.is_empty());
        assert_eq!(p.days_done, 3);
    }

    #[test]
    fn today_is_never_a_miss() {
        let l = logs(&[("2026-09-01", 1)]);
        let p = challenge_progress(
            &run(21, Some("2026-09-01"), None, &[]),
            "boolean",
            None,
            &[],
            &l,
            date("2026-09-02"),
        );
        assert!(p.missed_days.is_empty());
    }

    #[test]
    fn completion_is_permanent_once_recorded() {
        // The bug the whole run model exists to prevent: a finished challenge
        // whose streak has since collapsed still reads as complete.
        let p = challenge_progress(
            &run(21, Some("2026-09-01"), Some("2026-09-21"), &[]),
            "boolean",
            None,
            &[],
            &HashMap::new(),
            date("2026-10-15"),
        );
        assert!(p.complete);
        assert_eq!(p.completed_at, Some(date("2026-09-21")));
    }

    #[test]
    fn unscheduled_days_are_not_misses_inside_a_run() {
        // Mon/Wed/Fri. Tue and Thu are simply not part of the challenge.
        let days = [0, 2, 4];
        let l = logs(&[("2026-09-02", 1), ("2026-09-04", 1)]); // Wed, Fri
        let p = challenge_progress(
            &run(21, Some("2026-09-02"), None, &[]),
            "boolean",
            None,
            &days,
            &l,
            date("2026-09-05"),
        );
        assert_eq!(p.days_done, 2);
        assert!(p.missed_days.is_empty());
    }

    #[test]
    fn a_run_with_no_start_date_falls_back_to_the_streak() {
        // A device that hasn't upgraded yet still reports a sensible number
        // instead of reading as "Day 0".
        let l = logs(&[("2026-09-16", 1), ("2026-09-15", 1)]);
        let p = challenge_progress(
            &run(21, None, None, &[]),
            "boolean",
            None,
            &[],
            &l,
            date(TODAY),
        );
        assert_eq!(p.days_done, 2);
    }

    #[test]
    fn an_unresolved_miss_blocks_completion_even_at_full_count() {
        // Matches challengeProgress in @pomodoso/types: the decision has to be
        // answered before a run can finish, or a broken run earns a clean badge.
        let mut l = HashMap::new();
        for i in 0..30 {
            if i == 10 {
                continue; // one unforgiven miss
            }
            l.insert(date("2026-09-01") + Duration::days(i), 1);
        }
        let p = challenge_progress(
            &run(21, Some("2026-09-01"), None, &[]),
            "boolean",
            None,
            &[],
            &l,
            date("2026-09-30"),
        );
        assert_eq!(p.days_done, 29);
        assert_eq!(p.missed_days.len(), 1);
        assert!(!p.complete);
    }

    #[test]
    fn a_wildly_old_start_date_does_not_walk_forever() {
        // The start date comes from a client and is never validated there, so
        // this bounds what a synced habit can cost the server.
        let p = challenge_progress(
            &run(21, Some("0001-01-01"), None, &[]),
            "boolean",
            None,
            &[],
            &HashMap::new(),
            date(TODAY),
        );
        assert!(p.missed_days.len() as i64 <= MAX_LOOKBACK_DAYS + 1);
    }

    #[test]
    fn skips_left_is_about_one_per_week_and_never_negative() {
        assert_eq!(challenge_skips_left(&run(21, None, None, &[])), 3);
        assert_eq!(
            challenge_skips_left(&run(21, None, None, &["2026-09-03"])),
            2
        );
        assert_eq!(challenge_skips_left(&run(7, None, None, &[])), 1);
        assert_eq!(challenge_skips_left(&run(3, None, None, &[])), 1);
        assert_eq!(
            challenge_skips_left(&run(7, None, None, &["2026-09-03", "2026-09-04"])),
            0
        );
    }

    #[test]
    fn challenge_run_is_none_for_a_plain_habit() {
        assert!(challenge_run(&serde_json::json!({})).is_none());
        assert!(challenge_run(&serde_json::json!({ "challengeLengthDays": 21 })).is_some());
    }

    #[test]
    fn sort_order_reads_zero_as_a_real_position() {
        assert_eq!(sort_order(&serde_json::json!({ "sortOrder": 0 })), Some(0));
        assert_eq!(sort_order(&serde_json::json!({ "sortOrder": 4 })), Some(4));
        assert_eq!(sort_order(&serde_json::json!({})), None);
    }
}
