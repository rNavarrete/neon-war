// Player settings, kept in localStorage so volume and reduce flicker survive a reload. Storage can
// be missing or throw (private windows), so every read and write falls back to the defaults.

export type TextSpeed = 'slow' | 'normal' | 'fast';

export interface Settings {
  /** Master volume, 0 to 1. */
  volume: number;
  textSpeed: TextSpeed;
  /** Replace power-dip flicker and firework flashes with a steady warning. */
  reduceFlicker: boolean;
}

export const DEFAULT_SETTINGS: Settings = { volume: 0.8, textSpeed: 'normal', reduceFlicker: false };

/** Characters per second the typewriter text box reveals at each text speed. */
export const TEXT_CPS: Record<TextSpeed, number> = { slow: 25, normal: 50, fast: 120 };

const KEY = 'neon-war.settings';

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      volume:
        typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1 ? v.volume : DEFAULT_SETTINGS.volume,
      textSpeed: v.textSpeed === 'slow' || v.textSpeed === 'fast' ? v.textSpeed : 'normal',
      reduceFlicker: v.reduceFlicker === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings | null = null;
const listeners = new Set<(s: Settings) => void>();

export function settings(): Readonly<Settings> {
  return (current ??= load());
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...settings(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable: the change still applies for this visit.
  }
  for (const fn of listeners) fn(current);
  return current;
}

export function onSettingsChange(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
