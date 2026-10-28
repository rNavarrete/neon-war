// Which lines have a voice clip, where each clip lives, which language it is spoken in and which
// challenge group it loads with (decision D6, contract 'voice.ts'). Playback, the duck, one voice at
// a time and the groups kept loaded are the mixer's (src/game/mixer.ts); this file only answers
// questions about ids and the voices setting. Pure: no Phaser, no clock, no storage.
//
// - Every spoken line of docs/SCRIPT.md is voiced: the scene lines and the barks (85 today), never a
//   stage direction (C8.book.open), a chat row or a UI string.
// - Files are public/audio/voice/<lang>/<LINE_ID>.mp3 (the folder is `voice`, not `voices`), served
//   at audio/voice/<lang>/<LINE_ID>.mp3, and only the ids in public/audio/voice/manifest.json exist.
// - The setting picks Japanese (default), English or off. TRIAGE has no English cast: her Japanese
//   voice reads her English lines (Rolando's casting), so English plays the en take for every line.
//   Off voices nothing; the line's text always shows.
// - A line's group is the challenge in its id (C4.triage.02 is 4); the mixer keeps the previous,
//   current and next group loaded.

import type { VoiceTestState } from './mixer';
import { speakerName } from './portraits';
import type { Settings, VoiceSetting } from './settings';
import { LINES, type LineId } from '../strings';

/** A language a clip is recorded in. */
export type VoiceLang = 'ja' | 'en';

/** The voices setting's default (decision D6) and the voice volume's. */
export const DEFAULT_VOICES: VoiceSetting = 'ja';
export const DEFAULT_VOICE_VOLUME = 1;

/** Whether a line is spoken aloud: a scene line or a bark, and not a stage direction. */
export function isVoiced(id: string): id is LineId {
  const line = (LINES as Readonly<Record<string, { kind: string; speaker: string }>>)[id];
  if (!line) return false;
  if (line.kind !== 'scene' && line.kind !== 'bark') return false;
  // Stage directions are written with the speaker in brackets: "(stage direction, no text)".
  return !line.speaker.startsWith('(');
}

/** Every voiced line id, in script order (the count follows LINES; 85 today). */
export function voicedLines(): LineId[] {
  return (Object.keys(LINES) as LineId[]).filter((id) => isVoiced(id));
}

/** The clip's path under the page (the file is public/audio/voice/<lang>/<id>.mp3). */
export function voicePath(id: string, lang: VoiceLang): string {
  return `audio/voice/${lang}/${id}.mp3`;
}

/** Whether TRIAGE says the line. */
export function isTriage(id: LineId): boolean {
  return speakerName(LINES[id].speaker) === 'TRIAGE';
}

/**
 * The language a line is voiced in under the setting, or null when it is not voiced at all: off,
 * or not a spoken line.
 */
export function voiceLangFor(id: string, setting: VoiceSetting): VoiceLang | null {
  if (setting === 'off' || !isVoiced(id)) return null;
  return setting;
}

/** The challenge group a line loads with (the number after C in its id), or null for other ids. */
export function groupOf(id: string): number | null {
  const m = /^C(\d+)\./.exec(id);
  return m ? Number(m[1]) : null;
}

/** How a request is written in the hook's `requested` list: 'ja:C1.triage.02'. */
export function requestKey(id: string, lang: VoiceLang): string {
  return `${lang}:${id}`;
}

/** The `shell.voice` fields this ticket asks the mixer's hook for (contract 'voice.ts'). */
export interface VoiceHookFields {
  /** The voices setting now. */
  lang: VoiceSetting;
  /** The voice volume setting now. */
  volume: number;
  /** The last 20 requests as 'lang:id' (TRIAGE too). */
  requested: string[];
  /** The clip playing, or null. */
  playing: string | null;
  /** The last id asked for, or null. */
  lastVoice: string | null;
  /** Ids asked for that the manifest does not list, each once. */
  missing: string[];
  /** The music or the sfx channel is below its level (a voice ducks them). */
  ducked: boolean;
}

/**
 * The hook fields from the mixer's snapshot and the settings, for the shell section to merge into
 * shell.voice. Pure. `requested` writes each id in the language the setting gives it now; an id the setting does not voice keeps the setting's own word ('off:C1.lux.01').
 */
export function voiceHookFields(
  v: Pick<VoiceTestState, 'recentVoice' | 'missing' | 'playing' | 'gains'>,
  s: Pick<Settings, 'voices' | 'voiceVolume'>,
): VoiceHookFields {
  return {
    lang: s.voices,
    volume: s.voiceVolume,
    requested: v.recentVoice.map((id) => `${voiceLangFor(id, s.voices) ?? s.voices}:${id}`),
    playing: v.playing,
    lastVoice: v.recentVoice.length > 0 ? v.recentVoice[v.recentVoice.length - 1] : null,
    missing: [...v.missing],
    ducked: v.gains.music < 1 || v.gains.sfx < 1,
  };
}
