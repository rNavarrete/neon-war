// Player settings, kept in localStorage so volume, reduce flicker and the voices survive a reload.
// Storage can be missing or throw (private windows), so every read and write falls back to the
// defaults, and a stored value that is out of range or of the wrong kind reads as its default.

export type TextSpeed = 'slow' | 'normal' | 'fast';

/**
 * The language the crew speak in (decision D6): Japanese, English, or no voices at all. The line's
 * English text is always on screen, so it is the subtitle in every setting. TRIAGE has only a
 * Japanese clip and keeps it in English too (src/game/voice.ts).
 */
export type VoiceSetting = 'ja' | 'en' | 'off';

/** The voices setting's values, in the order the settings screen cycles through them. */
export const VOICE_SETTINGS: readonly VoiceSetting[] = ['ja', 'en', 'off'];

export interface Settings {
  /** Master volume, 0 to 1. */
  volume: number;
  textSpeed: TextSpeed;
  /** Replace power-dip flicker and firework flashes with a steady warning. */
  reduceFlicker: boolean;
  /** Voices in Japanese (the default), English, or off. */
  voices: VoiceSetting;
  /** The voice channel's level under the master volume, 0 to 1. */
  voiceVolume: number;
  /** The speaker icon on the title: true silences the music (title and board), effects and voices play on. */
  musicMuted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  textSpeed: 'normal',
  reduceFlicker: false,
  voices: 'ja',
  voiceVolume: 1,
  musicMuted: false,
};

/** Characters per second the typewriter text box reveals at each text speed. */
export const TEXT_CPS: Record<TextSpeed, number> = { slow: 25, normal: 50, fast: 120 };

const KEY = 'neon-war.settings';

const unit = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;

/**
 * Settings from what localStorage holds (null when nothing is stored). Every field is checked on
 * its own: a bad value falls back to its default and leaves the others as stored. Pure.
 */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let v: Partial<Record<keyof Settings, unknown>>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };
    v = parsed as Partial<Record<keyof Settings, unknown>>;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    volume: unit(v.volume, DEFAULT_SETTINGS.volume),
    textSpeed: v.textSpeed === 'slow' || v.textSpeed === 'fast' ? v.textSpeed : 'normal',
    reduceFlicker: v.reduceFlicker === true,
    voices: (VOICE_SETTINGS as readonly unknown[]).includes(v.voices)
      ? (v.voices as VoiceSetting)
      : DEFAULT_SETTINGS.voices,
    voiceVolume: unit(v.voiceVolume, DEFAULT_SETTINGS.voiceVolume),
    musicMuted: v.musicMuted === true,
  };
}

function load(): Settings {
  try {
    return parseSettings(window.localStorage.getItem(KEY));
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
