import { Bus } from '../src/game/bus';
import {
  Mixer,
  type SoundPort,
  residentGroups,
  voiceGroupOf,
  voicePath as mixerVoicePath,
} from '../src/game/mixer';
import { DEFAULT_SETTINGS, VOICE_SETTINGS, parseSettings } from '../src/game/settings';
import {
  DEFAULT_VOICES,
  DEFAULT_VOICE_VOLUME,
  groupOf,
  isTriage,
  isVoiced,
  requestKey,
  voiceHookFields,
  voiceLangFor,
  voicePath,
  voicedLines,
} from '../src/game/voice';
import { BROWNOUT } from '../src/sim/brownout';
import { LINES, type LineId } from '../src/strings';

// comms-5: src/game/voice.ts (which lines are voiced, their files, language and group) and the
// voices / voiceVolume settings. Playback is the mixer's (tests/mixer.test.ts); the last block
// checks the mixer only ever asks the port for ids the manifest lists.

const ids = Object.keys(LINES) as LineId[];

describe('voicedLines', () => {
  it('is every scene and bark line except the stage direction C8.book.open, in script order', () => {
    const expected = ids.filter(
      (id) => (LINES[id].kind === 'scene' || LINES[id].kind === 'bark') && id !== 'C8.book.open',
    );
    expect(voicedLines()).toEqual(expected);
    expect(voicedLines()).not.toContain('C8.book.open');
    expect(new Set(voicedLines()).size).toBe(voicedLines().length);
  });

  it('voices no chat row, UI string or unknown id', () => {
    for (const id of ids) {
      if (LINES[id].kind !== 'scene' && LINES[id].kind !== 'bark') expect(isVoiced(id), id).toBe(false);
    }
    expect(isVoiced('C8.book.open')).toBe(false);
    expect(isVoiced('nope')).toBe(false);
    expect(isVoiced('C1.triage.02')).toBe(true);
    expect(isVoiced('C0.tv.01')).toBe(true);
  });
});

describe('voicePath, language and groups', () => {
  it('puts a clip at audio/voice/<lang>/<ID>.mp3 under public/, as the mixer loads it', () => {
    expect(voicePath('C1.triage.02', 'ja')).toBe('audio/voice/ja/C1.triage.02.mp3');
    expect(voicePath('C5.rei.05', 'en')).toBe('audio/voice/en/C5.rei.05.mp3');
    for (const id of voicedLines()) {
      expect(voicePath(id, 'ja')).toBe(mixerVoicePath(id, 'ja'));
      expect(voicePath(id, 'en')).toBe(mixerVoicePath(id, 'en'));
    }
  });

  it('defaults to Japanese at full voice volume', () => {
    expect(DEFAULT_VOICES).toBe('ja');
    expect(DEFAULT_VOICE_VOLUME).toBe(1);
    expect(DEFAULT_SETTINGS.voices).toBe('ja');
    expect(DEFAULT_SETTINGS.voiceVolume).toBe(1);
    expect(VOICE_SETTINGS).toEqual(['ja', 'en', 'off']);
  });

  it('speaks a line in the setting, TRIAGE too (her Japanese voice reads the English), nothing when off', () => {
    expect(voiceLangFor('C1.lux.01', 'ja')).toBe('ja');
    expect(voiceLangFor('C1.lux.01', 'en')).toBe('en');
    expect(voiceLangFor('C1.lux.01', 'off')).toBeNull();
    expect(isTriage('C1.triage.02')).toBe(true);
    expect(isTriage('C1.lux.01')).toBe(false);
    expect(voiceLangFor('C1.triage.02', 'en')).toBe('en');
    expect(voiceLangFor('C1.triage.02', 'ja')).toBe('ja');
    expect(voiceLangFor('C1.triage.02', 'off')).toBeNull();
    expect(voiceLangFor('C8.book.open', 'en')).toBeNull();
    for (const id of voicedLines()) {
      expect(voiceLangFor(id, 'en'), id).toBe('en');
      expect(voiceLangFor(id, 'ja'), id).toBe('ja');
    }
    expect(requestKey('C1.triage.02', 'ja')).toBe('ja:C1.triage.02');
  });

  it('groups a line by the challenge in its id, as the mixer does', () => {
    expect(groupOf('C0.tv.01')).toBe(0);
    expect(groupOf('C4.triage.02')).toBe(4);
    expect(groupOf('C8.rei.end')).toBe(8);
    expect(groupOf('fill.stream.placed.01')).toBeNull();
    for (const id of voicedLines()) {
      const g = groupOf(id);
      expect(g, id).not.toBeNull();
      expect(g, id).toBe(voiceGroupOf(id));
    }
  });

  it('keeps the previous, current and next group resident, never every line', () => {
    const c = BROWNOUT.challenges;
    expect(residentGroups(c.c4 + 1)).toEqual([3, 4, 5]);
    const resident = residentGroups(c.c4 + 1);
    const loaded = voicedLines().filter((id) => resident.includes(groupOf(id)!));
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.length).toBeLessThan(voicedLines().length);
  });
});

describe('voices and voiceVolume settings', () => {
  it('read back what was stored', () => {
    const s = parseSettings(JSON.stringify({ voices: 'off', voiceVolume: 0.9, volume: 0.6 }));
    expect(s).toEqual({ ...DEFAULT_SETTINGS, voices: 'off', voiceVolume: 0.9, volume: 0.6 });
    expect(parseSettings(JSON.stringify({ voices: 'en' })).voices).toBe('en');
  });

  it('validate bad values back to their defaults, field by field', () => {
    for (const voices of ['fr', 'JA', '', 3, null, true, ['ja']]) {
      const s = parseSettings(JSON.stringify({ voices, voiceVolume: 0.5 }));
      expect(s.voices, String(voices)).toBe('ja');
      expect(s.voiceVolume).toBe(0.5);
    }
    for (const voiceVolume of [-0.1, 1.5, '0.5', null, Number.NaN, 'loud']) {
      const s = parseSettings(JSON.stringify({ voices: 'en', voiceVolume }));
      expect(s.voiceVolume, String(voiceVolume)).toBe(1);
      expect(s.voices).toBe('en');
    }
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
    // Settings stored before the voices existed keep their values and gain the defaults.
    expect(parseSettings(JSON.stringify({ volume: 0, textSpeed: 'fast', reduceFlicker: true }))).toEqual({
      volume: 0,
      textSpeed: 'fast',
      reduceFlicker: true,
      voices: 'ja',
      voiceVolume: 1,
    });
  });

  it('survive a reload through localStorage', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    try {
      vi.resetModules();
      const first = await import('../src/game/settings');
      expect(first.settings().voices).toBe('ja');
      first.updateSettings({ voices: 'off', voiceVolume: 0.9 });
      vi.resetModules();
      const reloaded = await import('../src/game/settings');
      expect(reloaded.settings()).toMatchObject({ voices: 'off', voiceVolume: 0.9 });
      // A hand-edited bad value reads as its default after the next reload.
      store.set('neon-war.settings', JSON.stringify({ voices: 'klingon', voiceVolume: 7 }));
      vi.resetModules();
      const edited = await import('../src/game/settings');
      expect(edited.settings()).toMatchObject({ voices: 'ja', voiceVolume: 1 });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe('the shell.voice fields', () => {
  it('reports lang, volume, requested as lang:id, playing, lastVoice, missing and ducked', () => {
    const v = {
      recentVoice: ['C1.triage.02', 'C1.lux.01'],
      missing: ['C1.triage.02', 'C1.lux.01'],
      playing: null,
      gains: { music: 1, sfx: 1, voice: 1 },
    };
    expect(voiceHookFields(v, { voices: 'en', voiceVolume: 0.9 })).toEqual({
      lang: 'en',
      volume: 0.9,
      requested: ['en:C1.triage.02', 'en:C1.lux.01'],
      playing: null,
      lastVoice: 'C1.lux.01',
      missing: ['C1.triage.02', 'C1.lux.01'],
      ducked: false,
    });
    const quiet = voiceHookFields(
      { ...v, recentVoice: [], gains: { music: 0.35, sfx: 0.7, voice: 1 } },
      DEFAULT_SETTINGS,
    );
    expect(quiet.lastVoice).toBeNull();
    expect(quiet.ducked).toBe(true);
    expect(voiceHookFields(v, { voices: 'off', voiceVolume: 1 }).requested).toEqual([
      'off:C1.triage.02',
      'off:C1.lux.01',
    ]);
  });
});

describe('the mixer asks only for listed ids', () => {
  it('records every request, loads and plays only the manifest ids', () => {
    const calls: string[] = [];
    const port: SoundPort = {
      loadVoice: (key, url) => void calls.push(`load ${key} ${url}`),
      unloadVoice: (key) => void calls.push(`unload ${key}`),
      voiceReady: () => true,
      playVoice: (key) => {
        calls.push(`play ${key}`);
        return 2;
      },
      stopVoice: () => {},
      setGain: () => {},
    };
    const bus = new Bus();
    const mixer = new Mixer(bus, { ja: ['C1.triage.02'] });
    mixer.attach(port);
    bus.emit('voice', { id: 'C1.triage.01' });
    bus.emit('voice', { id: 'C1.triage.02' });
    const snap = mixer.snapshot();
    expect(snap.recentVoice).toEqual(['C1.triage.01', 'C1.triage.02']);
    expect(snap.missing).toEqual(['C1.triage.01']);
    expect(calls.filter((c) => c.includes('C1.triage.01'))).toEqual([]);
    expect(calls).toContain('play voice:ja:C1.triage.02');
  });
});

describe('playVoice: the story side of the voices (comms-6)', () => {
  it('asks once for each spoken line, cuts the one before, and cuts the last on null', async () => {
    // Imported together so the story layer and this listener share one bus.
    const { bus } = await import('../src/game/bus');
    const { playVoice, storyState } = await import('../src/story/state');
    const seen: string[] = [];
    const offs = [
      bus.on('voice', ({ id }) => void seen.push(`voice ${id}`)),
      bus.on('voiceStop', ({ id }) => void seen.push(`stop ${id}`)),
    ];
    try {
      const voices = storyState.voices.length;
      const stops = storyState.voiceStops.length;
      playVoice('C0.tv.01');
      playVoice('C0.tv.01');
      playVoice('C0.tv.02');
      // A stage direction asks for nothing, but still cuts the line before it.
      playVoice('C8.book.open');
      playVoice('C8.rei.end');
      playVoice(null);
      playVoice(null);
      expect(seen).toEqual([
        'voice C0.tv.01',
        'stop C0.tv.01',
        'voice C0.tv.02',
        'stop C0.tv.02',
        'voice C8.rei.end',
        'stop C8.rei.end',
      ]);
      expect(storyState.voices.slice(voices)).toEqual(['C0.tv.01', 'C0.tv.02', 'C8.rei.end']);
      expect(storyState.voiceStops.slice(stops)).toEqual(['C0.tv.01', 'C0.tv.02', 'C8.rei.end']);
    } finally {
      for (const off of offs) off();
    }
  });

  it('is the only export src/story/state.ts gained', async () => {
    const mod = await import('../src/story/state');
    expect(Object.keys(mod).sort()).toEqual(
      ['playSfx', 'playVoice', 'setLiveView', 'stopSfx', 'storyEnd', 'storyState'].sort(),
    );
  });
});
