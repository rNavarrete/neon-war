import {
  AudioDirector,
  MUSIC_LEVEL,
  EVENT_SFX,
  SFX_KEYS,
  isSfxKey,
  musicWanted,
  sfxForAction,
  TITLE_MUSIC_FILES,
  TITLE_MUSIC_KEY,
  sfxPath,
  titleMusicWanted,
} from '../src/game/audio';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, parseSettings } from '../src/game/settings';
import { Bus } from '../src/game/bus';

describe('sound keys', () => {
  it('lists the 21 effects of docs/AUDIO.md, each at its file under public/', () => {
    expect(SFX_KEYS).toHaveLength(21);
    expect(new Set(SFX_KEYS).size).toBe(21);
    expect(sfxPath('place-part')).toBe('audio/sfx/place-part.mp3');
  });

  it('maps every board action to its effect from docs/AUDIO.md', () => {
    expect(sfxForAction({ type: 'place', id: 's1' })).toBe('place-part');
    expect(sfxForAction({ type: 'wire', from: 'gateway', to: 's1' })).toBe('wire-connect');
    expect(sfxForAction({ type: 'cut', from: 'gateway', to: 's1' })).toBe('wire-cut');
    expect(sfxForAction({ type: 'decommission', id: 's1', refund: 40 })).toBe('credits');
    expect(sfxForAction({ type: 'overclock', id: 's1' })).toBe('credits');
    expect(sfxForAction({ type: 'banner', choice: 'pay' })).toBe('credits');
    expect(sfxForAction({ type: 'banner', choice: 'bin' })).toBe('ui-click');
  });

  it('maps overheat, server death, power dip and rescue to real effects', () => {
    expect(EVENT_SFX).toEqual({
      overheat: 'server-hot',
      serverDied: 'server-die',
      powerDip: 'power-dip',
      rescue: 'rescue-cable',
    });
    for (const key of Object.values(EVENT_SFX)) expect(isSfxKey(key)).toBe(true);
  });

  it('wants the music on the board only, not in scenes', () => {
    expect(musicWanted({ boardOpen: true, sceneOpen: false })).toBe(true);
    expect(musicWanted({ boardOpen: true, sceneOpen: true })).toBe(false);
    expect(musicWanted({ boardOpen: false, sceneOpen: false })).toBe(false);
  });

  it('plays "Euphoric Menace" on the title only, and never while the music is muted', () => {
    expect(TITLE_MUSIC_KEY).not.toBe('music');
    expect(TITLE_MUSIC_FILES).toEqual(['audio/music/euphoric-menace.ogg', 'audio/music/euphoric-menace.mp3']);
    expect(titleMusicWanted({ titleOpen: true, muted: false })).toBe(true);
    expect(titleMusicWanted({ titleOpen: true, muted: true })).toBe(false);
    expect(titleMusicWanted({ titleOpen: false, muted: false })).toBe(false);
  });

  it('remembers the speaker icon’s mute in settings, unmuted by default', () => {
    expect(DEFAULT_SETTINGS.musicMuted).toBe(false);
    expect(parseSettings(JSON.stringify({ musicMuted: true })).musicMuted).toBe(true);
    expect(parseSettings(JSON.stringify({ musicMuted: 'yes' })).musicMuted).toBe(false);
    expect(parseSettings(null).musicMuted).toBe(false);
  });
});

describe('AudioDirector', () => {
  it('records and plays the effect for each bus event', () => {
    const bus = new Bus();
    const director = new AudioDirector(bus);
    const played: string[] = [];
    director.attach({ play: (k) => played.push(k) });

    bus.emit('action', { type: 'place', id: 's1' });
    expect(director.lastSfx).toBe('place-part');
    bus.emit('action', { type: 'wire', from: 'gateway', to: 's1' });
    bus.emit('sfx', { key: 'banner-pop' });
    bus.emit('overheat', { id: 's1' });
    bus.emit('powerDip', { id: 's1' });
    bus.emit('rescue', {});
    expect(played).toEqual([
      'place-part',
      'wire-connect',
      'banner-pop',
      'server-hot',
      'power-dip',
      'rescue-cable',
    ]);
    expect(director.lastSfx).toBe('rescue-cable');
  });

  it('records the key with no player attached and never throws when playback fails', () => {
    const bus = new Bus();
    const director = new AudioDirector(bus);
    bus.emit('action', { type: 'cut', from: 'a', to: 'b' });
    expect(director.lastSfx).toBe('wire-cut');
    director.attach({
      play: () => {
        throw new Error('audio locked');
      },
    });
    expect(() => bus.emit('sfx', { key: 'ui-click' })).not.toThrow();
    expect(director.lastSfx).toBe('ui-click');
  });
});

describe('the default volume (Rolando, 30 Oct 2026: "kind of high")', () => {
  it('starts at half volume, with the music under the voices and effects', () => {
    expect(DEFAULT_SETTINGS.volume).toBe(0.5);
    expect(MUSIC_LEVEL).toBeGreaterThan(0);
    expect(MUSIC_LEVEL).toBeLessThan(1);
  });

  it('gives settings saved with the old 0.8 default the new one, once', () => {
    expect(parseSettings(JSON.stringify({ volume: 0.8 })).volume).toBe(0.5);
    // A level the player chose, or one saved after the change, is kept.
    expect(parseSettings(JSON.stringify({ volume: 0.6 })).volume).toBe(0.6);
    expect(parseSettings(JSON.stringify({ volume: 0.8, version: SETTINGS_VERSION })).volume).toBe(0.8);
  });
});
