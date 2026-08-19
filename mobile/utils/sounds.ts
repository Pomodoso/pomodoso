import type { SoundEvent, SoundSettings } from '@pomodoso/types';
import { createAudioPlayer } from 'expo-audio';

// WAV files under assets/sounds/ are pre-rendered from the exact same
// frequency/duration/envelope math as extension's sounds.ts (Web Audio
// OscillatorNode + exponential gain ramp) — there's no Web Audio API on
// React Native, so live synthesis isn't an option; baking the same tones
// to short static files reproduces the extension's sound design exactly
// without pulling in a synthesis library.
const SOUND_ASSETS: Record<SoundEvent, number> = {
  'pomo-done': require('../assets/sounds/pomo-done.wav'),
  'break-start': require('../assets/sounds/break-start.wav'),
  'break-done': require('../assets/sounds/break-done.wav'),
  'focus-start': require('../assets/sounds/focus-start.wav'),
  'task-done': require('../assets/sounds/task-done.wav'),
};

const EVENT_KEY: Record<SoundEvent, keyof SoundSettings['events']> = {
  'pomo-done': 'pomoDone',
  'break-start': 'breakStart',
  'break-done': 'breakDone',
  'focus-start': 'focusStart',
  'task-done': 'taskDone',
};

// Longest clip (pomo-done) is ~1.2s — 2s comfortably covers playback before
// releasing the player. createAudioPlayer instances aren't auto-released
// the way useAudioPlayer's hook-managed ones are; each call here creates a
// fresh short-lived player, matching the extension's fire-and-forget model.
const RELEASE_DELAY_MS = 2000;

export function playSound(event: SoundEvent, settings: SoundSettings): void {
  if (!settings.enabled) return;
  if (!settings.events[EVENT_KEY[event]]) return;

  const player = createAudioPlayer(SOUND_ASSETS[event]);
  player.volume = Math.max(0, Math.min(1, settings.volume));
  player.play();
  setTimeout(() => {
    try {
      player.remove();
    } catch {
      // Already released (e.g. component unmounted) — nothing to do.
    }
  }, RELEASE_DELAY_MS);
}
