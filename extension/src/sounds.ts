import type { SoundEvent, SoundSettings } from '@pomodoso/types';

// Frequencies (Hz) for musical notes
const NOTE = {
  C4: 261.63, E4: 329.63, G4: 392.00,
  C5: 523.25, E5: 659.25, G5: 783.99,
  C6: 1046.50,
} as const;

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  ac: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(volume * 0.4, startTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

const EVENT_KEY: Record<SoundEvent, keyof SoundSettings['events']> = {
  'pomo-done':  'pomoDone',
  'break-start': 'breakStart',
  'break-done':  'breakDone',
  'focus-start': 'focusStart',
  'task-done':   'taskDone',
};

export function playSound(event: SoundEvent, settings: SoundSettings): void {
  if (!settings.enabled) return;
  if (!settings.events[EVENT_KEY[event]]) return;

  const ac = getCtx();
  if (!ac) return;

  const now = ac.currentTime;
  const v = Math.max(0, Math.min(1, settings.volume));

  switch (event) {
    case 'pomo-done':
      // 3-note descending bell: G5 → E5 → C5
      tone(ac, NOTE.G5, now,        0.5, v);
      tone(ac, NOTE.E5, now + 0.22, 0.5, v);
      tone(ac, NOTE.C5, now + 0.44, 0.7, v);
      break;

    case 'break-start':
      // Soft double ding: C5 → G4
      tone(ac, NOTE.C5, now,        0.45, v);
      tone(ac, NOTE.G4, now + 0.20, 0.6,  v);
      break;

    case 'break-done':
      // Rising ping: C5 → G5
      tone(ac, NOTE.C5, now,        0.3, v);
      tone(ac, NOTE.G5, now + 0.18, 0.4, v);
      break;

    case 'focus-start':
      // Single short high ping: C6
      tone(ac, NOTE.C6, now, 0.25, v);
      break;

    case 'task-done':
      // Quick success ding: E5 → G5
      tone(ac, NOTE.E5, now,        0.25, v);
      tone(ac, NOTE.G5, now + 0.14, 0.35, v);
      break;
  }
}
