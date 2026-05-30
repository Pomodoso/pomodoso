import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { TimerState } from '@pomodoso/types';
import { IDLE_TIMER_STATE } from '@pomodoso/types';
import '../assets/globals.css';

// ─── Audio ────────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function playTick(final = false) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = final ? 1046 : 880;
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (final ? 0.15 : 0.08));
    osc.start();
    osc.stop(ctx.currentTime + (final ? 0.15 : 0.08));
  } catch { /* audio not available */ }
}

// ─── Mini popup ───────────────────────────────────────────────────────────────

type Mode = 'pomo' | 'break';

function MiniApp() {
  const [timerState, setTimerState] = useState<TimerState>({ ...IDLE_TIMER_STATE });
  const [countdown, setCountdown] = useState<number>(10);
  const lastTickRef = useRef<number>(-1);
  const audioUnlockedRef = useRef(false);
  // Mode is set once on first non-idle state received and never changes for this window's lifetime
  const modeRef = useRef<Mode | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);

  // Read initial state and subscribe to storage changes
  useEffect(() => {
    chrome.storage.local.get('timerState').then((result) => {
      const stored = result['timerState'] as TimerState | undefined;
      if (stored) {
        setTimerState(stored);
        if (modeRef.current === null && stored.status !== 'idle') {
          const m: Mode = stored.status === 'break' ? 'break' : 'pomo';
          modeRef.current = m;
          setMode(m);
        }
      }
    });

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes['timerState']) {
        const next = changes['timerState'].newValue as TimerState;
        const resolved = next ?? { ...IDLE_TIMER_STATE };
        setTimerState(resolved);
        if (modeRef.current === null && resolved.status !== 'idle') {
          const m: Mode = resolved.status === 'break' ? 'break' : 'pomo';
          modeRef.current = m;
          setMode(m);
        }
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  // Auto-close based on mode
  useEffect(() => {
    const { status } = timerState;
    if (mode === 'pomo' && (status === 'break' || status === 'idle')) {
      window.close();
    }
    if (mode === 'break' && (status === 'break-done' || status === 'idle')) {
      window.close();
    }
  }, [timerState.status, mode]);

  // Pomo countdown tick
  useEffect(() => {
    if (mode !== 'pomo') return;
    if (timerState.status !== 'active' || timerState.mode !== 'pomodoro') return;
    if (timerState.pomodoroStartedAt === null || timerState.plannedDurationSeconds === null) return;

    const tick = () => {
      const elapsed = (Date.now() - timerState.pomodoroStartedAt!) / 1000;
      const remaining = Math.max(0, timerState.plannedDurationSeconds! - elapsed);
      const secs = Math.ceil(remaining);
      setCountdown(secs);

      if (secs <= 10 && secs !== lastTickRef.current && secs > 0) {
        lastTickRef.current = secs;
        playTick(secs === 1);
      }
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [mode, timerState.status, timerState.pomodoroStartedAt, timerState.plannedDurationSeconds]);

  // Break countdown tick
  useEffect(() => {
    if (mode !== 'break') return;
    if (timerState.status !== 'break') return;
    if (timerState.breakStartedAt == null || timerState.breakDurationSeconds == null) return;

    const tick = () => {
      const elapsed = (Date.now() - timerState.breakStartedAt!) / 1000;
      const remaining = Math.max(0, timerState.breakDurationSeconds! - elapsed);
      const secs = Math.ceil(remaining);
      setCountdown(secs);

      if (secs <= 10 && secs !== lastTickRef.current && secs > 0) {
        lastTickRef.current = secs;
        playTick(secs === 1);
      }
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [mode, timerState.status, timerState.breakStartedAt, timerState.breakDurationSeconds]);

  const taskLabel = timerState.ticketExternalId
    ? `${timerState.ticketExternalId} ${timerState.taskTitle ?? ''}`
    : (timerState.taskTitle ?? '');

  const baseStyle: React.CSSProperties = {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    background: '#1a1a1a',
    color: '#f0f0f0',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    padding: '0 20px',
    gap: 16,
    userSelect: 'none',
  };

  const circleStyle = (active: boolean, color: string): React.CSSProperties => ({
    width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
    background: active ? color : '#2e2e2e',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 22, fontWeight: 700, color: '#fff',
    transition: 'background 0.3s',
    border: `2px solid ${active ? color : '#444'}`,
  });

  // ── Pomo done: no buttons, break auto-starts in ~3s ──────────────────────────
  if (mode === 'pomo' && timerState.status === 'pomo-done') {
    return (
      <div style={{ ...baseStyle, flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28 }}>🍅</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Pomodoro complete!</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Break starting…</div>
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>
            {timerState.pomosCompletedToday}/{timerState.pomosGoal}
          </div>
        </div>
      </div>
    );
  }

  // ── Break countdown ──────────────────────────────────────────────────────────
  if (mode === 'break') {
    const urgent = countdown <= 3;
    return (
      <div
        onClick={() => { if (!audioUnlockedRef.current) { audioUnlockedRef.current = true; getAudioCtx(); } }}
        style={baseStyle}
      >
        <div style={circleStyle(urgent, '#4A7C4A')}>
          {countdown <= 0 ? '☕' : countdown}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#f0f0f0', marginBottom: 2 }}>
            Break ending…
          </div>
          {taskLabel ? (
            <div style={{ fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {taskLabel}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#555' }}>Next pomo starting</div>
          )}
        </div>
      </div>
    );
  }

  // ── Pomo countdown (active, last 10s) ────────────────────────────────────────
  return (
    <div
      onClick={() => { if (!audioUnlockedRef.current) { audioUnlockedRef.current = true; getAudioCtx(); } }}
      style={baseStyle}
    >
      <div style={circleStyle(countdown <= 3, '#e8543a')}>
        {countdown <= 0 ? '🍅' : countdown}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#f0f0f0', marginBottom: 2 }}>
          Pomodoro ending…
        </div>
        {taskLabel ? (
          <div style={{ fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {taskLabel}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: '#555' }}>No task attached</div>
        )}
      </div>
    </div>
  );
}

// ─── Mount ────────────────────────────────────────────────────────────────────

const el = document.getElementById('app');
if (!el) throw new Error('Missing #app');
createRoot(el).render(
  <React.StrictMode>
    <MiniApp />
  </React.StrictMode>,
);
