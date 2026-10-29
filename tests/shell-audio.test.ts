import {
  AudioDirector,
  EVENT_SFX,
  SFX_KEYS,
  isSfxKey,
  musicWanted,
  sfxForAction,
  sfxPath,
} from '../src/game/audio';
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
