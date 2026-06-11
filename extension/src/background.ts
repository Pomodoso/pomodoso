import type {
  ExtensionMessage,
  ExtensionResponse,
  TimerState,
  TimerStartPayload,
  TimerAttachPayload,
  TimerSettings,
  TicketRef,
} from '@pomodoso/types';
import { IDLE_TIMER_STATE, DEFAULT_TIMER_SETTINGS } from '@pomodoso/types';
import { db, getTimerSettingsFromDb, getTimezoneFromDb } from './db';
import { connectCalendar, syncTodayMeetings } from './calendarSync';
import { performBackgroundSync } from './syncEngine';
import { providerRuleAllows } from './ticketRules';

chrome.alarms.onAlarm.addListener(handleAlarm);
chrome.runtime.onMessage.addListener(handleMessage);

// ─── Background sync ──────────────────────────────────────────────────────────
// The popup's debounced sync dies the moment the popup closes (click-away), so
// the service worker owns the durable copy: popup mutations send 'sync.request'
// and a periodic alarm pulls remote changes so other devices' edits land even
// with the popup closed (Dexie liveQuery propagates them to an open UI).

chrome.alarms.create('periodic-sync', { periodInMinutes: 1 });

let syncDebounce: ReturnType<typeof setTimeout> | null = null;

function scheduleBackgroundSync(delayMs = 2500): void {
  if (syncDebounce) clearTimeout(syncDebounce);
  syncDebounce = setTimeout(() => {
    syncDebounce = null;
    void performBackgroundSync().catch((err: unknown) => console.warn('[bg-sync]', err));
  }, delayMs);
}

// ─── Tab messaging ───────────────────────────────────────────────────────────

async function sendToActiveTab(message: unknown): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, message);
  } catch { /* content script may not be present on chrome:// pages */ }
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function todayLocalDate(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local timezone
}

async function getTimerState(): Promise<TimerState> {
  const result = await chrome.storage.local.get('timerState');
  const stored = result['timerState'] as TimerState | undefined;
  // Validate against new schema — fall back to idle if stored state is stale
  if (!stored || !('pomodoroStartedAt' in stored)) {
    return { ...IDLE_TIMER_STATE };
  }
  // Reset daily counter if the date has changed (null means unknown date, not a past date)
  if (stored.pomosDate !== null && stored.pomosDate !== todayLocalDate()) {
    return { ...stored, pomosCompletedToday: 0, pomosDate: null };
  }
  return stored;
}

async function setTimerState(state: TimerState): Promise<void> {
  await chrome.storage.local.set({ timerState: state });
  updateBadge(state);
}

async function getTimerSettings(): Promise<TimerSettings> {
  try {
    return await getTimerSettingsFromDb();
  } catch {
    // Dexie unavailable (e.g. before migration) — fall back to chrome.storage.local
    const result = await chrome.storage.local.get('pom_timer_settings');
    return (result['pom_timer_settings'] as TimerSettings | undefined) ?? { ...DEFAULT_TIMER_SETTINGS };
  }
}

async function getDetectedTicket(): Promise<TicketRef | null> {
  const result = await chrome.storage.local.get('detectedTicket');
  return (result['detectedTicket'] as TicketRef | undefined) ?? null;
}

// ─── Badge ───────────────────────────────────────────────────────────────────

function updateBadge(state: TimerState): void {
  if (state.status === 'idle') {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  let text = '';
  let color = '#6B6960';

  if (state.status === 'active') {
    if (state.mode === 'pomodoro' && state.pomodoroStartedAt !== null && state.plannedDurationSeconds !== null) {
      const elapsed = Math.floor((Date.now() - state.pomodoroStartedAt) / 1000);
      const remaining = Math.max(0, state.plannedDurationSeconds - elapsed);
      text = String(Math.ceil(remaining / 60));
      color = '#4A6FA5';
    } else if (state.mode === 'stopwatch' && state.taskSegmentStartedAt !== null) {
      const elapsed = Math.floor((Date.now() - state.taskSegmentStartedAt) / 1000);
      text = String(Math.floor(elapsed / 60)) + 'm';
      color = '#4A7C4A';
    }
  } else if (state.status === 'paused') {
    text = '⏸';
    color = '#B07A1F';
  } else if (state.status === 'break') {
    text = '☕';
    color = '#4A7C4A';
  } else if (state.status === 'pomo-done') {
    if (state.breakPromptEndsAt) {
      const mins = Math.ceil(Math.max(0, state.breakPromptEndsAt - Date.now()) / 60000);
      text = mins > 0 ? `${mins}m` : '0';
    } else {
      text = '🍅';
    }
    color = '#B07A1F';
  } else if (state.status === 'break-done') {
    text = '!';
    color = '#4A7C4A';
  }

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ─── Mini window helpers ──────────────────────────────────────────────────────

async function openMiniWindow(): Promise<void> {
  // Close any existing mini window first
  await closeMiniWindow();
  try {
    const browserWin = await chrome.windows.getCurrent();
    const left = Math.round((browserWin.left ?? 0) + (browserWin.width ?? 1280) - 340);
    const top = Math.round((browserWin.top ?? 0) + 60);
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('popup/mini.html'),
      type: 'popup',
      width: 320,
      height: 130,
      left,
      top,
      focused: false,
    });
    await chrome.storage.local.set({ miniWindowId: win.id ?? null });
  } catch { /* window creation failed (e.g. no browser window visible) */ }
}

async function closeMiniWindow(): Promise<void> {
  const result = await chrome.storage.local.get('miniWindowId');
  const id = result['miniWindowId'] as number | null | undefined;
  if (id != null) {
    try { await chrome.windows.remove(id); } catch { /* already closed */ }
    await chrome.storage.local.remove('miniWindowId');
  }
}

// ─── Alarm handler ────────────────────────────────────────────────────────────

async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name === 'periodic-sync') {
    void performBackgroundSync().catch(() => { /* offline / signed out — retry next tick */ });
    return;
  }

  if (alarm.name === 'pomo-countdown') {
    const state = await getTimerState();
    if (state.status !== 'active' || state.mode !== 'pomodoro') return;
    await openMiniWindow();
    return;
  }

  if (alarm.name === 'break-countdown') {
    const state = await getTimerState();
    if (state.status !== 'break') return;
    await openMiniWindow();
    return;
  }

  if (alarm.name === 'pomo-end') {
    const state = await getTimerState();
    if (state.status !== 'active' || state.mode !== 'pomodoro') return;

    const settings = await getTimerSettings();

    // Capture the task segment that was running when the pomo ended
    let pendingSegment = state.pendingSegment;
    if (state.taskId && state.taskSegmentStartedAt) {
      const durationSeconds = Math.floor((Date.now() - state.taskSegmentStartedAt) / 1000);
      if (durationSeconds > 0) {
        pendingSegment = {
          taskId: state.taskId,
          durationSeconds,
          startedAt: new Date(state.taskSegmentStartedAt).toISOString(),
        };
      }
    }

    const newCount = state.pomosCompletedToday + 1;
    const isLongBreak = newCount % settings.longBreakEvery === 0;
    const breakDuration = isLongBreak ? settings.longBreakSeconds : settings.shortBreakSeconds;

    const promptEndsAt = Date.now() + 3 * 1000;

    const updated: TimerState = {
      ...IDLE_TIMER_STATE,
      status: 'pomo-done',
      sessionId: state.sessionId,
      taskId: state.taskId,
      taskTitle: state.taskTitle,
      ticketExternalId: state.ticketExternalId,
      pendingBreakDurationSeconds: breakDuration,
      breakPromptEndsAt: promptEndsAt,
      pendingSegment,
      pomosCompletedToday: newCount,
      pomosDate: todayLocalDate(),
      pomosGoal: state.pomosGoal,
    };

    await setTimerState(updated);
    await chrome.alarms.clear('badge-tick');
    chrome.alarms.create('break-prompt-end', { delayInMinutes: 3 / 60 });
    chrome.alarms.create('badge-tick', { periodInMinutes: 1 / 6 }); // update badge every 10s
    await sendToActiveTab({ type: 'breakPrompt.show', endsAt: promptEndsAt, pomosCount: newCount, pomosGoal: state.pomosGoal });
    await sendToActiveTab({ type: 'sound.play', event: 'pomo-done' });
    // Mini window already open from pomo-countdown; state change to pomo-done triggers its transition

    chrome.notifications.create('pomo-complete', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'Pomodoro complete! 🍅',
      message: `${Math.round((state.plannedDurationSeconds ?? 25 * 60) / 60)} min of focus. Time for a ${isLongBreak ? 'long ' : ''}break.`,
      priority: 2,
    });
  }

  if (alarm.name === 'break-end') {
    const state = await getTimerState();
    if (state.status !== 'break') return;

    const autoStartDelay = 30; // seconds until next pomo auto-starts
    const autoStartsAt = Date.now() + autoStartDelay * 1000;

    const updated: TimerState = {
      ...IDLE_TIMER_STATE,
      status: 'break-done',
      taskId: state.taskId,
      taskTitle: state.taskTitle,
      ticketExternalId: state.ticketExternalId,
      pendingSegment: state.pendingSegment,
      pomosCompletedToday: state.pomosCompletedToday,
      pomosDate: state.pomosDate,
      pomosGoal: state.pomosGoal,
      breakPromptEndsAt: autoStartsAt,
    };

    await setTimerState(updated);
    await chrome.alarms.clear('badge-tick');
    chrome.alarms.create('pomo-autostart', { delayInMinutes: autoStartDelay / 60 });
    chrome.alarms.create('badge-tick', { periodInMinutes: 1 / 6 });

    await sendToActiveTab({
      type: 'breakPrompt.breakEnded',
      startsAt: autoStartsAt,
      pomosCount: updated.pomosCompletedToday,
      pomosGoal: updated.pomosGoal,
    });
    await sendToActiveTab({ type: 'sound.play', event: 'break-done' });

    chrome.notifications.create('break-complete', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'Break\'s over! 🏃',
      message: 'Next pomodoro starts in 30 seconds.',
      priority: 1,
    });
  }

  if (alarm.name === 'break-prompt-end') {
    const state = await getTimerState();
    if (state.status !== 'pomo-done') return;
    await startBreak();
    // overlay transitions via breakPrompt.breakStarted sent inside startBreak
  }

  if (alarm.name === 'pomo-autostart') {
    const state = await getTimerState();
    if (state.status !== 'break-done') return;
    await startNextPomo();
    await sendToActiveTab({ type: 'breakPrompt.hide' });
  }

  if (alarm.name === 'badge-tick') {
    const state = await getTimerState();
    updateBadge(state);
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

function handleMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionResponse) => void,
): boolean {
  handleMessageAsync(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  return true;
}

async function handleMessageAsync(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'timer.getState':
      return getTimerState();

    case 'timer.start':
      return startTimer(message.payload);

    case 'timer.attachTask':
      return attachTask(message.payload);

    case 'timer.detachTask':
      return detachTask();

    case 'timer.pause':
      return pausePomodoro();

    case 'timer.resume':
      return resumePomodoro();

    case 'timer.complete':
      return completePomodoro();

    case 'timer.startBreak':
      return startBreak();

    case 'timer.snooze':
      return snooze();

    case 'timer.stop':
      return stopTimer();

    case 'timer.clearPendingSegment':
      return clearPendingSegment();

    case 'timer.extendBreak':
      return extendBreak();

    case 'timer.startNextPomo':
      return startNextPomo();

    case 'ticket.detected': {
      let ticket = message.payload;
      // Respect the user's detection rules: a disabled (or pattern-edited)
      // preset rule silences its native content script.
      if (ticket) {
        try {
          const rules = await db.detectionRules.toArray();
          if (!providerRuleAllows(rules, ticket)) ticket = null;
        } catch { /* Dexie unavailable — fail open */ }
      }
      await chrome.storage.local.set({ detectedTicket: ticket });
      return null;
    }

    case 'ticket.getDetected':
      return getDetectedTicket();

    case 'sync.request':
      scheduleBackgroundSync();
      return null;

    case 'calendar.connect': {
      try {
        const result = await connectCalendar(message.wsId);
        await chrome.storage.local.remove('calendar_connect_error');
        // Signal popup to open calendar settings so the user can select calendars
        await chrome.storage.local.set({ calendar_just_connected: message.wsId });
        // Kick off an immediate sync using the configured timezone (falls back to system)
        const tz = await getTimezoneFromDb();
        void syncTodayMeetings(message.wsId, tz);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Connection failed';
        await chrome.storage.local.set({ calendar_connect_error: msg });
        throw e;
      }
    }
  }
}

// ─── Timer actions ────────────────────────────────────────────────────────────

async function startTimer(payload: TimerStartPayload): Promise<TimerState> {
  const current = await getTimerState();
  const settings = await getTimerSettings();

  // If a pomodoro is active/paused and a stopwatch is starting (meeting), save the pomo
  let pausedPomodoro: TimerState['pausedPomodoro'] = null;
  if ((current.status === 'active' || current.status === 'paused') && current.mode === 'pomodoro' && payload.mode === 'stopwatch') {
    const elapsed = current.pomodoroStartedAt
      ? Math.floor((Date.now() - current.pomodoroStartedAt) / 1000)
      : 0;
    const planned = current.plannedDurationSeconds ?? settings.focusSeconds;
    const remaining = Math.max(0, planned - elapsed);
    pausedPomodoro = { remainingSeconds: remaining, plannedDurationSeconds: planned };
  }

  await chrome.alarms.clear('pomo-end');
  await chrome.alarms.clear('break-end');
  await chrome.alarms.clear('pomo-autostart');

  const now = Date.now();
  const plannedDuration = payload.mode === 'pomodoro' ? settings.focusSeconds : null;

  const state: TimerState = {
    ...IDLE_TIMER_STATE,
    status: 'active',
    mode: payload.mode,
    sessionId: crypto.randomUUID(),
    pomodoroStartedAt: payload.mode === 'pomodoro' ? now : null,
    plannedDurationSeconds: plannedDuration,
    taskId: payload.taskId,
    taskTitle: payload.taskTitle,
    ticketId: payload.ticketId,
    ticketExternalId: payload.ticketExternalId,
    taskSegmentStartedAt: payload.taskId ? now : null,
    pausedPomodoro,
    pomosCompletedToday: current.pomosCompletedToday,
    pomosDate: current.pomosDate,
    pomosGoal: settings.dailyGoal,
  };

  await setTimerState(state);

  if (payload.mode === 'pomodoro') {
    chrome.alarms.create('pomo-end', { delayInMinutes: settings.focusSeconds / 60 });
    if (settings.focusSeconds > 10) {
      chrome.alarms.create('pomo-countdown', { delayInMinutes: (settings.focusSeconds - 10) / 60 });
    }
  }

  chrome.alarms.create('badge-tick', { periodInMinutes: 1 });

  return state;
}

async function attachTask(payload: TimerAttachPayload): Promise<TimerState> {
  const state = await getTimerState();
  if (state.status !== 'active') return state;

  // Capture the segment for the outgoing task
  let pendingSegment = state.pendingSegment;
  if (state.taskId && state.taskSegmentStartedAt) {
    const durationSeconds = Math.floor((Date.now() - state.taskSegmentStartedAt) / 1000);
    if (durationSeconds > 0) {
      pendingSegment = {
        taskId: state.taskId,
        durationSeconds,
        startedAt: new Date(state.taskSegmentStartedAt).toISOString(),
      };
    }
  }

  const updated: TimerState = {
    ...state,
    taskId: payload.taskId,
    taskTitle: payload.taskTitle,
    ticketId: payload.ticketId,
    ticketExternalId: payload.ticketExternalId,
    taskSegmentStartedAt: Date.now(),
    pendingSegment,
  };

  await setTimerState(updated);
  return updated;
}

async function detachTask(): Promise<TimerState> {
  const state = await getTimerState();
  if (state.status !== 'active') return state;

  // Capture the segment for the detaching task
  let pendingSegment = state.pendingSegment;
  if (state.taskId && state.taskSegmentStartedAt) {
    const durationSeconds = Math.floor((Date.now() - state.taskSegmentStartedAt) / 1000);
    if (durationSeconds > 0) {
      pendingSegment = {
        taskId: state.taskId,
        durationSeconds,
        startedAt: new Date(state.taskSegmentStartedAt).toISOString(),
      };
    }
  }

  const updated: TimerState = {
    ...state,
    taskId: null,
    taskTitle: null,
    ticketId: null,
    ticketExternalId: null,
    taskSegmentStartedAt: null,
    pendingSegment,
  };

  await setTimerState(updated);
  return updated;
}

async function pausePomodoro(): Promise<TimerState> {
  const state = await getTimerState();
  if (state.status !== 'active' || state.mode !== 'pomodoro') return state;

  await chrome.alarms.clear('pomo-end');
  await chrome.alarms.clear('pomo-countdown');
  await chrome.alarms.clear('badge-tick');

  const updated: TimerState = { ...state, status: 'paused', pomoPausedAt: Date.now() };
  await setTimerState(updated);
  return updated;
}

async function resumePomodoro(): Promise<TimerState> {
  const state = await getTimerState();
  if (state.status !== 'paused' || state.mode !== 'pomodoro') return state;
  if (state.pomodoroStartedAt === null || state.pomoPausedAt === null || state.plannedDurationSeconds === null) return state;

  const pausedElapsed = Math.floor((state.pomoPausedAt - state.pomodoroStartedAt) / 1000);
  const remaining = Math.max(0, state.plannedDurationSeconds - pausedElapsed);

  if (remaining <= 0) {
    return completePomodoro();
  }

  // Shift pomodoroStartedAt forward by the pause duration so remaining is correct
  const pauseDuration = Date.now() - state.pomoPausedAt;
  const updated: TimerState = {
    ...state,
    status: 'active',
    pomodoroStartedAt: state.pomodoroStartedAt + pauseDuration,
    pomoPausedAt: null,
  };

  await setTimerState(updated);
  chrome.alarms.create('pomo-end', { delayInMinutes: remaining / 60 });
  if (remaining > 10) {
    chrome.alarms.create('pomo-countdown', { delayInMinutes: (remaining - 10) / 60 });
  }
  chrome.alarms.create('badge-tick', { periodInMinutes: 1 });

  return updated;
}

async function completePomodoro(): Promise<TimerState> {
  const state = await getTimerState();
  if (state.status === 'break' || state.status === 'pomo-done') return state;

  const settings = await getTimerSettings();

  // Log any in-progress task segment as a pending segment
  let pendingSegment = state.pendingSegment;
  if (state.taskId && state.taskSegmentStartedAt) {
    const durationSeconds = Math.floor((Date.now() - state.taskSegmentStartedAt) / 1000);
    if (durationSeconds > 0) {
      pendingSegment = {
        taskId: state.taskId,
        durationSeconds,
        startedAt: new Date(state.taskSegmentStartedAt).toISOString(),
      };
    }
  }

  await chrome.alarms.clear('pomo-end');
  await chrome.alarms.clear('pomo-countdown');
  await chrome.alarms.clear('badge-tick');

  const newCount = state.pomosCompletedToday + 1;
  const isLongBreak = newCount % settings.longBreakEvery === 0;
  const breakDuration = isLongBreak ? settings.longBreakSeconds : settings.shortBreakSeconds;

  const promptEndsAt = Date.now() + 3 * 1000;

  const updated: TimerState = {
    ...IDLE_TIMER_STATE,
    status: 'pomo-done',
    sessionId: state.sessionId,
    taskId: state.taskId,
    taskTitle: state.taskTitle,
    ticketExternalId: state.ticketExternalId,
    pendingBreakDurationSeconds: breakDuration,
    breakPromptEndsAt: promptEndsAt,
    pendingSegment,
    pomosCompletedToday: newCount,
    pomosDate: todayLocalDate(),
    pomosGoal: state.pomosGoal,
  };

  await setTimerState(updated);
  chrome.alarms.create('break-prompt-end', { delayInMinutes: 3 / 60 });
  chrome.alarms.create('badge-tick', { periodInMinutes: 1 / 6 });
  await sendToActiveTab({ type: 'breakPrompt.show', endsAt: promptEndsAt, pomosCount: newCount, pomosGoal: updated.pomosGoal });
  await sendToActiveTab({ type: 'sound.play', event: 'pomo-done' });
  return updated;
}

async function startBreak(): Promise<TimerState> {
  const state = await getTimerState();
  if (state.status !== 'pomo-done') return state;

  const breakDuration = state.pendingBreakDurationSeconds ?? (await getTimerSettings()).shortBreakSeconds;

  await chrome.alarms.clear('break-prompt-end');
  await chrome.alarms.clear('badge-tick');

  const updated: TimerState = {
    ...IDLE_TIMER_STATE,
    status: 'break',
    sessionId: state.sessionId,
    taskId: state.taskId,
    taskTitle: state.taskTitle,
    ticketExternalId: state.ticketExternalId,
    breakStartedAt: Date.now(),
    breakDurationSeconds: breakDuration,
    pendingSegment: state.pendingSegment,
    pomosCompletedToday: state.pomosCompletedToday,
    pomosDate: state.pomosDate,
    pomosGoal: state.pomosGoal,
  };

  await setTimerState(updated);
  chrome.alarms.create('break-end', { delayInMinutes: breakDuration / 60 });
  if (breakDuration > 10) {
    chrome.alarms.create('break-countdown', { delayInMinutes: (breakDuration - 10) / 60 });
  }
  chrome.alarms.create('badge-tick', { periodInMinutes: 1 });
  await sendToActiveTab({
    type: 'breakPrompt.breakStarted',
    endsAt: (updated.breakStartedAt ?? Date.now()) + breakDuration * 1000,
    pomosCount: updated.pomosCompletedToday,
    pomosGoal: updated.pomosGoal,
  });
  await sendToActiveTab({ type: 'sound.play', event: 'break-start' });

  return updated;
}

async function snooze(): Promise<TimerState> {
  const state = await getTimerState();

  if (state.status === 'pomo-done') {
    const newEndsAt = (state.breakPromptEndsAt ?? Date.now()) + 5 * 60 * 1000;
    const updated: TimerState = { ...state, breakPromptEndsAt: newEndsAt };
    await chrome.alarms.clear('break-prompt-end');
    chrome.alarms.create('break-prompt-end', { delayInMinutes: 5 });
    await setTimerState(updated);
    await sendToActiveTab({ type: 'breakPrompt.updateEndsAt', endsAt: newEndsAt });
    return updated;
  }

  if (state.status === 'break-done') {
    const newStartsAt = (state.breakPromptEndsAt ?? Date.now()) + 5 * 60 * 1000;
    const updated: TimerState = { ...state, breakPromptEndsAt: newStartsAt };
    await chrome.alarms.clear('pomo-autostart');
    chrome.alarms.create('pomo-autostart', { delayInMinutes: 5 });
    await setTimerState(updated);
    await sendToActiveTab({ type: 'breakPrompt.updateEndsAt', endsAt: newStartsAt });
    return updated;
  }

  return state;
}

async function stopTimer(): Promise<TimerState> {
  await chrome.alarms.clear('pomo-end');
  await chrome.alarms.clear('pomo-countdown');
  await chrome.alarms.clear('break-end');
  await chrome.alarms.clear('break-countdown');
  await chrome.alarms.clear('break-prompt-end');
  await chrome.alarms.clear('pomo-autostart');
  await chrome.alarms.clear('badge-tick');
  await closeMiniWindow();
  await sendToActiveTab({ type: 'breakPrompt.hide' });

  const current = await getTimerState();

  // Auto-resume a pomodoro that was paused when a meeting (stopwatch) started
  if (current.pausedPomodoro && current.mode === 'stopwatch') {
    const { remainingSeconds, plannedDurationSeconds } = current.pausedPomodoro;
    if (remainingSeconds > 0) {
      const now = Date.now();
      // Reconstruct pomodoroStartedAt so remaining time is correct
      const pomodoroStartedAt = now - (plannedDurationSeconds - remainingSeconds) * 1000;
      const resumed: TimerState = {
        ...IDLE_TIMER_STATE,
        status: 'active',
        mode: 'pomodoro',
        sessionId: current.sessionId,
        pomodoroStartedAt,
        plannedDurationSeconds,
        pomosCompletedToday: current.pomosCompletedToday,
        pomosDate: current.pomosDate,
        pomosGoal: current.pomosGoal,
      };
      await setTimerState(resumed);
      chrome.alarms.create('pomo-end', { delayInMinutes: remainingSeconds / 60 });
      chrome.alarms.create('badge-tick', { periodInMinutes: 1 });
      return resumed;
    }
  }

  const reset: TimerState = {
    ...IDLE_TIMER_STATE,
    pomosCompletedToday: current.pomosCompletedToday,
    pomosDate: current.pomosDate,
    pomosGoal: current.pomosGoal,
  };

  await setTimerState(reset);
  return reset;
}

async function extendBreak(): Promise<TimerState> {
  const state = await getTimerState();
  if (state.status !== 'break' || !state.breakStartedAt || !state.breakDurationSeconds) return state;

  const newDuration = state.breakDurationSeconds + 5 * 60;
  const elapsed = Math.floor((Date.now() - state.breakStartedAt) / 1000);
  const remaining = Math.max(0, newDuration - elapsed);

  await chrome.alarms.clear('break-end');
  chrome.alarms.create('break-end', { delayInMinutes: remaining / 60 });

  const newEndsAt = state.breakStartedAt + newDuration * 1000;
  const updated: TimerState = { ...state, breakDurationSeconds: newDuration };
  await setTimerState(updated);
  await sendToActiveTab({ type: 'breakPrompt.updateEndsAt', endsAt: newEndsAt });
  return updated;
}

async function startNextPomo(): Promise<TimerState> {
  const state = await getTimerState();
  if (state.status !== 'break' && state.status !== 'break-done') return state;

  await chrome.alarms.clear('break-end');
  await chrome.alarms.clear('pomo-autostart');
  await sendToActiveTab({ type: 'breakPrompt.hide' });

  return startTimer({
    mode: 'pomodoro',
    taskId: state.taskId,
    taskTitle: state.taskTitle,
    ticketId: null,
    ticketExternalId: state.ticketExternalId,
  });
}

async function clearPendingSegment(): Promise<TimerState> {
  const state = await getTimerState();
  const updated: TimerState = { ...state, pendingSegment: null };
  await setTimerState(updated);
  return updated;
}
