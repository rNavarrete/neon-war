// What the settings screen's buttons do to a value. Pure, so the steps are unit-tested.

import { type TextSpeed, VOICE_SETTINGS, type VoiceSetting } from './settings';

const SPEEDS: readonly TextSpeed[] = ['slow', 'normal', 'fast'];

/** Volume after one press of − or +, in tenths, kept between 0 and 1. */
export function stepVolume(volume: number, direction: -1 | 1): number {
  const tenths = Math.round(volume * 10) + direction;
  return Math.min(10, Math.max(0, tenths)) / 10;
}

/** The text speed after `speed`, wrapping round. */
export function nextTextSpeed(speed: TextSpeed): TextSpeed {
  return SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
}

/** The voices setting after one press of its button: JA, EN, OFF and round again. */
export function nextVoiceSetting(voices: VoiceSetting): VoiceSetting {
  const i = VOICE_SETTINGS.indexOf(voices);
  return VOICE_SETTINGS[(i + 1) % VOICE_SETTINGS.length];
}

/** The voice volume after one press of − or +: the same tenths steps as the master volume. */
export function stepVoiceVolume(voiceVolume: number, direction: -1 | 1): number {
  return stepVolume(voiceVolume, direction);
}

/** What the voices button reads: JA, EN or OFF. */
export function voiceSettingLabel(voices: VoiceSetting): string {
  return voices.toUpperCase();
}
