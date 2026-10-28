import { DEFAULT_SETTINGS, VOICE_SETTINGS } from '../src/game/settings';
import {
  nextTextSpeed,
  nextVoiceSetting,
  stepVoiceVolume,
  stepVolume,
  voiceSettingLabel,
} from '../src/game/settingsControls';

// comms-7: what the settings screen's voice rows do. The Voices button cycles JA, EN, OFF; the voice
// volume's − and + step in tenths like the master volume. tests/shell-audio.test.ts stays untouched;
// the buttons on screen are checked in tests/browser/comms.spec.ts.

describe('the Voices row', () => {
  it('cycles JA, EN, OFF and round again', () => {
    expect(nextVoiceSetting('ja')).toBe('en');
    expect(nextVoiceSetting('en')).toBe('off');
    expect(nextVoiceSetting('off')).toBe('ja');
    for (const v of VOICE_SETTINGS) {
      expect(nextVoiceSetting(nextVoiceSetting(nextVoiceSetting(v)))).toBe(v);
    }
  });

  it('turns the voices off with two presses from the default', () => {
    expect(nextVoiceSetting(nextVoiceSetting(DEFAULT_SETTINGS.voices))).toBe('off');
  });

  it('reads JA, EN or OFF on its button', () => {
    expect(VOICE_SETTINGS.map(voiceSettingLabel)).toEqual(['JA', 'EN', 'OFF']);
  });
});

describe('the Voice volume row', () => {
  it('steps in tenths between 0 and 1, from 1 to 0.9 on one press of −', () => {
    expect(stepVoiceVolume(DEFAULT_SETTINGS.voiceVolume, -1)).toBe(0.9);
    expect(stepVoiceVolume(0.9, 1)).toBe(1);
    expect(stepVoiceVolume(1, 1)).toBe(1);
    expect(stepVoiceVolume(0, -1)).toBe(0);
    expect(stepVoiceVolume(0.3, -1)).toBe(0.2);
    let v = 1;
    for (let i = 0; i < 12; i++) v = stepVoiceVolume(v, -1);
    expect(v).toBe(0);
  });
});

describe('the rows that were there before', () => {
  it('keep their steps', () => {
    expect(stepVolume(0.8, -1)).toBe(0.7);
    expect(stepVolume(1, 1)).toBe(1);
    expect(nextTextSpeed('normal')).toBe('fast');
    expect(nextTextSpeed('fast')).toBe('slow');
  });
});
