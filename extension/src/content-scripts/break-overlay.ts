// Self-contained: no imports so this compiles to a plain IIFE script.
// Plays sounds via Web Audio API and reacts to messages from the background SW.

// ── Sound (inlined from sounds.ts + @pomodoso/types) ─────────────────────────

type SoundEvent = 'pomo-done' | 'break-start' | 'break-done' | 'focus-start' | 'task-done';

interface SoundSettings {
  enabled: boolean;
  volume: number;
  events: {
    pomoDone: boolean;
    breakStart: boolean;
    breakDone: boolean;
    focusStart: boolean;
    taskDone: boolean;
  };
}

const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.6,
  events: { pomoDone: true, breakStart: true, breakDone: true, focusStart: false, taskDone: true },
};

const NOTE = {
  G4: 392.00, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.50,
} as const;

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}

function tone(ac: AudioContext, freq: number, startTime: number, duration: number, volume: number): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(volume * 0.4, startTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

const EVENT_KEY: Record<SoundEvent, keyof SoundSettings['events']> = {
  'pomo-done': 'pomoDone', 'break-start': 'breakStart',
  'break-done': 'breakDone', 'focus-start': 'focusStart', 'task-done': 'taskDone',
};

function playSound(event: SoundEvent, settings: SoundSettings): void {
  if (!settings.enabled || !settings.events[EVENT_KEY[event]]) return;
  const ac = getAudioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const v = Math.max(0, Math.min(1, settings.volume));
  switch (event) {
    case 'pomo-done':   tone(ac, NOTE.G5, now, 0.5, v); tone(ac, NOTE.E5, now+0.22, 0.5, v); tone(ac, NOTE.C5, now+0.44, 0.7, v); break;
    case 'break-start': tone(ac, NOTE.C5, now, 0.45, v); tone(ac, NOTE.G4, now+0.20, 0.6, v); break;
    case 'break-done':  tone(ac, NOTE.C5, now, 0.3, v); tone(ac, NOTE.G5, now+0.18, 0.4, v); break;
    case 'focus-start': tone(ac, NOTE.C6, now, 0.25, v); break;
    case 'task-done':   tone(ac, NOTE.E5, now, 0.25, v); tone(ac, NOTE.G5, now+0.14, 0.35, v); break;
  }
}

// ── Overlay ───────────────────────────────────────────────────────────────────

type Phase = 'pomo-done' | 'break' | 'break-done';

let overlayEl: HTMLDivElement | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let currentEndsAt = 0;
let currentPhase: Phase | null = null;

function fmt(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function tick() {
  const rem = Math.max(0, Math.floor((currentEndsAt - Date.now()) / 1000));
  const el = document.getElementById('pom-overlay-countdown');
  if (el) el.textContent = fmt(rem);
}

function getColors() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    bg:     dark ? '#1e1e1e' : '#ffffff',
    border: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
    text:   dark ? '#e8e6e3' : '#1a1a1a',
    muted:  dark ? '#888' : '#999',
    btnBg:  dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
  };
}

function startTick(endsAt: number) {
  currentEndsAt = endsAt;
  if (tickInterval !== null) clearInterval(tickInterval);
  tick();
  tickInterval = setInterval(tick, 1000);
}

function hide() {
  overlayEl?.remove();
  overlayEl = null;
  currentPhase = null;
  if (tickInterval !== null) { clearInterval(tickInterval); tickInterval = null; }
}

function buildRoot(): HTMLDivElement {
  hide();
  const { bg, border, text } = getColors();
  const root = document.createElement('div');
  root.id = 'pom-break-overlay';
  root.style.cssText = [
    'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483647',
    `background:${bg}`, `border:1px solid ${border}`, 'border-radius:14px',
    'padding:18px 20px 16px', 'min-width:256px',
    'box-shadow:0 12px 40px rgba(0,0,0,0.22)',
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif`,
    `color:${text}`, 'box-sizing:border-box', 'transition:opacity 0.2s',
  ].join(';');
  return root;
}

function headerHtml(title: string, muted: string): string {
  return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
    <span style="font-size:14px;font-weight:700">${title}</span>
    <button id="pom-overlay-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:${muted};padding:0;line-height:1;display:flex;align-items:center">×</button>
  </div>`;
}

function showPomoDone(data: { endsAt: number; pomosCount: number; pomosGoal: number }) {
  currentPhase = 'pomo-done';
  const { muted } = getColors();
  const root = buildRoot();
  root.innerHTML = `
    ${headerHtml('🍅 Pomodoro done!', muted)}
    <div style="font-size:13px;color:${muted};margin-bottom:10px">Break starting…</div>
    <div style="font-size:10px;color:${muted};text-align:center">🍅 ${data.pomosCount}/${data.pomosGoal} today · × to dismiss</div>`;
  document.body.appendChild(root);
  overlayEl = root;
  document.getElementById('pom-overlay-close')?.addEventListener('click', hide);
  setTimeout(hide, 4000);
}

function showBreak(data: { endsAt: number; pomosCount: number; pomosGoal: number }) {
  currentPhase = 'break';
  const { muted, border, btnBg, text } = getColors();
  const root = buildRoot();
  root.innerHTML = `
    ${headerHtml('☕ Break time!', muted)}
    <div style="font-size:11px;color:${muted};margin-bottom:3px;letter-spacing:0.05em;text-transform:uppercase;font-weight:600">Remaining</div>
    <div id="pom-overlay-countdown" style="font-size:36px;font-weight:700;letter-spacing:-1.5px;color:#4A7C4A;margin-bottom:14px;line-height:1;font-variant-numeric:tabular-nums">
      ${fmt(Math.max(0, Math.floor((data.endsAt - Date.now()) / 1000)))}
    </div>
    <div style="display:flex;gap:7px;margin-bottom:10px">
      <button id="pom-overlay-start-now" style="flex:1;padding:9px 0;border-radius:9px;border:none;background:#4A6FA5;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">▶ Start now</button>
      <button id="pom-overlay-extend" style="padding:9px 14px;border-radius:9px;border:1px solid ${border};background:${btnBg};color:${text};font-size:12px;font-weight:500;cursor:pointer;font-family:inherit">+5m</button>
    </div>
    <div style="font-size:10px;color:${muted};text-align:center">🍅 ${data.pomosCount}/${data.pomosGoal} today · × to dismiss</div>`;
  document.body.appendChild(root);
  overlayEl = root;
  document.getElementById('pom-overlay-close')?.addEventListener('click', hide);
  document.getElementById('pom-overlay-start-now')?.addEventListener('click', () => { void chrome.runtime.sendMessage({ type: 'timer.startNextPomo' }); hide(); });
  document.getElementById('pom-overlay-extend')?.addEventListener('click', () => { void chrome.runtime.sendMessage({ type: 'timer.extendBreak' }); });
  startTick(data.endsAt);
}

function showBreakDone(data: { startsAt: number; pomosCount: number; pomosGoal: number }) {
  currentPhase = 'break-done';
  const { muted, border, btnBg, text } = getColors();
  const root = buildRoot();
  root.innerHTML = `
    ${headerHtml('🏃 Break\'s over!', muted)}
    <div style="font-size:11px;color:${muted};margin-bottom:3px;letter-spacing:0.05em;text-transform:uppercase;font-weight:600">Next pomodoro in</div>
    <div id="pom-overlay-countdown" style="font-size:36px;font-weight:700;letter-spacing:-1.5px;color:#4A6FA5;margin-bottom:14px;line-height:1;font-variant-numeric:tabular-nums">
      ${fmt(Math.max(0, Math.floor((data.startsAt - Date.now()) / 1000)))}
    </div>
    <div style="display:flex;gap:7px;margin-bottom:10px">
      <button id="pom-overlay-start-now" style="flex:1;padding:9px 0;border-radius:9px;border:none;background:#4A6FA5;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">▶ Start now</button>
      <button id="pom-overlay-snooze" style="padding:9px 14px;border-radius:9px;border:1px solid ${border};background:${btnBg};color:${text};font-size:12px;font-weight:500;cursor:pointer;font-family:inherit">+5m</button>
    </div>
    <div style="font-size:10px;color:${muted};text-align:center">🍅 ${data.pomosCount}/${data.pomosGoal} today · × to dismiss</div>`;
  document.body.appendChild(root);
  overlayEl = root;
  document.getElementById('pom-overlay-close')?.addEventListener('click', hide);
  document.getElementById('pom-overlay-start-now')?.addEventListener('click', () => { void chrome.runtime.sendMessage({ type: 'timer.startNextPomo' }); hide(); });
  document.getElementById('pom-overlay-snooze')?.addEventListener('click', () => { void chrome.runtime.sendMessage({ type: 'timer.snooze' }); });
  startTick(data.startsAt);
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: {
  type: string; endsAt?: number; startsAt?: number; pomosCount?: number; pomosGoal?: number; event?: string;
}) => {
  if (msg.type === 'breakPrompt.show' && msg.endsAt != null && msg.pomosCount != null && msg.pomosGoal != null) {
    showPomoDone({ endsAt: msg.endsAt, pomosCount: msg.pomosCount, pomosGoal: msg.pomosGoal });
  } else if (msg.type === 'breakPrompt.breakStarted' && msg.endsAt != null && msg.pomosCount != null && msg.pomosGoal != null) {
    showBreak({ endsAt: msg.endsAt, pomosCount: msg.pomosCount, pomosGoal: msg.pomosGoal });
  } else if (msg.type === 'breakPrompt.breakEnded' && msg.startsAt != null && msg.pomosCount != null && msg.pomosGoal != null) {
    showBreakDone({ startsAt: msg.startsAt, pomosCount: msg.pomosCount, pomosGoal: msg.pomosGoal });
  } else if (msg.type === 'breakPrompt.hide') {
    hide();
  } else if (msg.type === 'breakPrompt.updateEndsAt' && msg.endsAt != null) {
    currentEndsAt = msg.endsAt;
    if (tickInterval !== null) clearInterval(tickInterval);
    tick();
    tickInterval = setInterval(tick, 1000);
  } else if (msg.type === 'sound.play' && msg.event) {
    void chrome.storage.local.get('pom_sound_settings').then((result) => {
      const settings = (result['pom_sound_settings'] as SoundSettings | undefined) ?? DEFAULT_SOUND_SETTINGS;
      playSound(msg.event as SoundEvent, settings);
    });
  }
});
