import { SFX_KEYS, isSfxKey } from '../src/game/audio';
import { Bus } from '../src/game/bus';
import {
  DUCK,
  LIVE_SFX_KEYS,
  Mixer,
  type SoundPort,
  type VoiceManifest,
  bundledLiveSfx,
  bundledVoiceManifest,
  challengeAt,
  duckedGain,
  residentGroups,
  stepDuck,
  voiceGroupOf,
  voiceKey,
  voicePath,
} from '../src/game/mixer';
import type { LineId } from '../src/strings';

/** A SoundPort that records every call; clips load at once and run until ended by hand. */
class FakePort implements SoundPort {
  readonly calls: string[] = [];
  readonly ready = new Set<string>();
  readonly gains: Record<'music' | 'sfx', number[]> = { music: [], sfx: [] };
  readonly enders = new Map<string, () => void>();
  seconds = 2;
  /** Whether loadVoice makes the clip ready at once. */
  instant = true;

  loadVoice(key: string, url: string): void {
    this.calls.push(`load ${key} ${url}`);
    if (this.instant) this.ready.add(key);
  }
  unloadVoice(key: string): void {
    this.calls.push(`unload ${key}`);
    this.ready.delete(key);
  }
  voiceReady(key: string): boolean {
    return this.ready.has(key);
  }
  playVoice(key: string, _volume: number, onEnd: () => void): number | null {
    this.calls.push(`play ${key}`);
    this.enders.set(key, onEnd);
    return this.seconds;
  }
  stopVoice(key: string): void {
    this.calls.push(`stop ${key}`);
  }
  setGain(channel: 'music' | 'sfx', gain: number): void {
    this.gains[channel].push(gain);
  }
  /** The clip finishes by itself. */
  end(key: string): void {
    this.enders.get(key)?.();
  }
}

const C1_02 = 'C1.triage.02' as LineId;
const C1_03 = 'C1.triage.03' as LineId;
const C4_01 = 'C4.triage.01' as LineId;

const MANIFEST: VoiceManifest = {
  ja: [
    'C1.triage.01',
    'C1.triage.02',
    'C1.triage.03',
    'C2.lux.01',
    'C3.triage.01',
    'C4.triage.01',
    'C6.rei.01',
  ],
  en: ['C1.triage.02'],
};

function setup(manifest: VoiceManifest = MANIFEST) {
  const bus = new Bus();
  const mixer = new Mixer(bus, manifest);
  const port = new FakePort();
  const events: string[] = [];
  bus.on('voiceStart', (v) => events.push(`voiceStart ${v.id} ${v.seconds}`));
  bus.on('voiceEnd', (v) => events.push(`voiceEnd ${v.id}`));
  mixer.attach(port);
  return { bus, mixer, port, events };
}

const line = (bus: Bus, id: LineId, since = 0): void =>
  bus.emit('line', { id, speaker: 'TRIAGE', tag: 'HINT', lesson: false, since });

describe('Live sound effect keys', () => {
  it('pins LIVE_SFX_KEYS beside the 21 SFX_KEYS', () => {
    expect(LIVE_SFX_KEYS).toEqual(['server-online', 'packet-drop', 'health-skip', 'headroom-red']);
    expect(SFX_KEYS).toHaveLength(21);
    for (const k of LIVE_SFX_KEYS) expect((SFX_KEYS as readonly string[]).includes(k)).toBe(false);
  });

  it('isSfxKey accepts both lists and nothing else', () => {
    for (const k of SFX_KEYS) expect(isSfxKey(k)).toBe(true);
    for (const k of LIVE_SFX_KEYS) expect(isSfxKey(k)).toBe(true);
    expect(isSfxKey('chat-pop')).toBe(false);
    expect(isSfxKey('')).toBe(false);
  });

  it('loads no Live effect until its file is listed (none has landed)', () => {
    expect(bundledLiveSfx()).toEqual([]);
  });
});

describe('the duck', () => {
  it('ramps in over 150 ms and out over 400 ms', () => {
    expect(stepDuck(0, true, 0.075)).toBeCloseTo(0.5);
    expect(stepDuck(0, true, 0.15)).toBe(1);
    expect(stepDuck(1, false, 0.2)).toBeCloseTo(0.5);
    expect(stepDuck(1, false, 0.4)).toBe(0);
    expect(stepDuck(0.3, true, 0)).toBe(0.3);
  });

  it('sets music to 0.35x and sfx to 0.7x at full depth, voice never', () => {
    expect(DUCK).toEqual({ music: 0.35, sfx: 0.7, inSeconds: 0.15, outSeconds: 0.4 });
    expect(duckedGain('music', 1)).toBe(0.35);
    expect(duckedGain('sfx', 1)).toBe(0.7);
    expect(duckedGain('voice', 1)).toBe(1);
    expect(duckedGain('music', 0)).toBe(1);
  });

  it('lowers music to 0.35x and sfx to 0.7x while a clip plays and restores both after voiceEnd', () => {
    const { bus, mixer, port, events } = setup();
    mixer.tick(10, 20);
    expect(mixer.gain('music')).toBe(1);
    line(bus, C1_02, 10);
    expect(events).toEqual(['voiceStart C1.triage.02 2']);
    // Halfway through the 150 ms ramp, then full.
    mixer.tick(10.075, 20);
    expect(mixer.gain('music')).toBeCloseTo(0.675);
    mixer.tick(10.15, 20);
    expect(mixer.gain('music')).toBe(0.35);
    expect(mixer.gain('sfx')).toBe(0.7);
    expect(port.gains.music.at(-1)).toBe(0.35);
    expect(port.gains.sfx.at(-1)).toBe(0.7);
    mixer.tick(11, 20);
    expect(mixer.gain('music')).toBe(0.35);

    port.end(voiceKey(C1_02, 'ja'));
    expect(events).toEqual(['voiceStart C1.triage.02 2', 'voiceEnd C1.triage.02']);
    expect(mixer.snapshot().playing).toBeNull();
    mixer.tick(11.2, 20);
    expect(mixer.gain('music')).toBeCloseTo(0.675);
    mixer.tick(11.4, 20);
    expect(mixer.gain('music')).toBe(1);
    expect(mixer.gain('sfx')).toBe(1);
    expect(port.gains.music.at(-1)).toBe(1);
    expect(port.gains.sfx.at(-1)).toBe(1);
  });

  it('ends a clip on the clock when its length has run out', () => {
    const { bus, mixer, events } = setup();
    mixer.tick(0, 20);
    line(bus, C1_02);
    mixer.tick(1.9, 20);
    expect(mixer.snapshot().playing).toBe(C1_02);
    mixer.tick(2, 20);
    expect(events.at(-1)).toBe('voiceEnd C1.triage.02');
  });
});

describe('one voice at a time', () => {
  it('a new line stops the previous clip before the next starts', () => {
    const { bus, mixer, port, events } = setup();
    mixer.tick(0, 20);
    line(bus, C1_02);
    line(bus, C1_03);
    expect(port.calls.filter((c) => !c.startsWith('load'))).toEqual([
      `play ${voiceKey(C1_02, 'ja')}`,
      `stop ${voiceKey(C1_02, 'ja')}`,
      `play ${voiceKey(C1_03, 'ja')}`,
    ]);
    expect(events).toEqual([
      'voiceStart C1.triage.02 2',
      'voiceEnd C1.triage.02',
      'voiceStart C1.triage.03 2',
    ]);
    expect(mixer.snapshot().playing).toBe(C1_03);
    // The stopped clip's own end coming late changes nothing.
    port.end(voiceKey(C1_02, 'ja'));
    expect(mixer.snapshot().playing).toBe(C1_03);
  });

  it('a line with no listed clip still stops the one playing and plays nothing', () => {
    const { bus, mixer, port, events } = setup();
    mixer.tick(0, 20);
    line(bus, C1_02);
    line(bus, 'C1.lux.01' as LineId);
    expect(events.at(-1)).toBe('voiceEnd C1.triage.02');
    expect(port.calls.at(-1)).toBe(`stop ${voiceKey(C1_02, 'ja')}`);
    expect(mixer.snapshot().playing).toBeNull();
  });

  it('voiceStop stops the clip; the replay request (bus voice) plays it again', () => {
    const { bus, mixer, events } = setup();
    mixer.tick(0, 20);
    bus.emit('voice', { id: C1_02 });
    bus.emit('voiceStop', { id: C1_02 });
    expect(events).toEqual(['voiceStart C1.triage.02 2', 'voiceEnd C1.triage.02']);
    expect(mixer.snapshot().recentVoice).toEqual([C1_02]);
  });
});

describe('voice groups', () => {
  it('names a line group by its challenge and keeps the previous, current and next loaded', () => {
    expect(voiceGroupOf('C4.triage.02')).toBe(4);
    expect(voiceGroupOf('fill.block.01')).toBeNull();
    expect(challengeAt(0)).toBe(0);
    expect(challengeAt(15)).toBe(1);
    expect(challengeAt(164.9)).toBe(3);
    expect(challengeAt(165)).toBe(4);
    expect(challengeAt(600)).toBe(8);
    expect(residentGroups(0)).toEqual([0, 1]);
    expect(residentGroups(100)).toEqual([2, 3, 4]);
    expect(residentGroups(600)).toEqual([7, 8]);
    expect(voicePath('C1.triage.02', 'ja')).toBe('audio/voice/ja/C1.triage.02.mp3');
  });

  it('loads exactly the clips of the resident groups, never the whole set', () => {
    const { mixer, port } = setup();
    mixer.tick(0, 20);
    expect(mixer.snapshot().groups).toEqual([0, 1, 2]);
    expect(port.calls).toEqual([
      'load voice:ja:C1.triage.01 audio/voice/ja/C1.triage.01.mp3',
      'load voice:ja:C1.triage.02 audio/voice/ja/C1.triage.02.mp3',
      'load voice:ja:C1.triage.03 audio/voice/ja/C1.triage.03.mp3',
      'load voice:ja:C2.lux.01 audio/voice/ja/C2.lux.01.mp3',
    ]);
    expect(mixer.snapshot().loaded).toBe(4);

    port.calls.length = 0;
    mixer.tick(1, 170);
    expect(mixer.snapshot().groups).toEqual([3, 4, 5]);
    expect(port.calls).toEqual([
      'unload voice:ja:C1.triage.01',
      'unload voice:ja:C1.triage.02',
      'unload voice:ja:C1.triage.03',
      'unload voice:ja:C2.lux.01',
      'load voice:ja:C3.triage.01 audio/voice/ja/C3.triage.01.mp3',
      'load voice:ja:C4.triage.01 audio/voice/ja/C4.triage.01.mp3',
    ]);

    // Ticks inside the same challenge touch nothing.
    port.calls.length = 0;
    mixer.tick(2, 190);
    expect(port.calls).toEqual([]);
  });

  it('re-resolves the groups after a rewind moves now back', () => {
    const { mixer, port } = setup();
    mixer.tick(0, 290);
    expect(mixer.snapshot().groups).toEqual([5, 6, 7]);
    port.calls.length = 0;
    mixer.tick(1, 170); // the rewind to C4
    expect(mixer.snapshot().groups).toEqual([3, 4, 5]);
    expect(port.calls).toEqual([
      'unload voice:ja:C6.rei.01',
      'load voice:ja:C3.triage.01 audio/voice/ja/C3.triage.01.mp3',
      'load voice:ja:C4.triage.01 audio/voice/ja/C4.triage.01.mp3',
    ]);
  });

  it('a listed clip outside the groups loads on request and plays once ready', () => {
    const { bus, mixer, port, events } = setup();
    port.instant = false;
    mixer.tick(0, 470);
    line(bus, C4_01);
    expect(events).toEqual([]);
    expect(port.calls.at(-1)).toBe('load voice:ja:C4.triage.01 audio/voice/ja/C4.triage.01.mp3');
    port.ready.add(voiceKey(C4_01, 'ja'));
    mixer.tick(0.1, 470);
    expect(events).toEqual(['voiceStart C4.triage.01 2']);
  });
});

describe('missing voices', () => {
  it('requests nothing without a manifest and lists every id asked for once', () => {
    const { bus, mixer, port, events } = setup({});
    mixer.tick(0, 20);
    line(bus, C1_02);
    line(bus, C1_03);
    line(bus, C1_02);
    expect(port.calls).toEqual([]);
    expect(events).toEqual([]);
    const s = mixer.snapshot();
    expect(s.recentVoice).toEqual([C1_02, C1_03, C1_02]);
    expect(s.missing).toEqual([C1_02, C1_03]);
    expect(s.playing).toBeNull();
    expect(s.gains).toEqual({ music: 1, sfx: 1, voice: 1 });
  });

  it('requests no id the manifest lacks', () => {
    const { bus, mixer, port } = setup({ ja: ['C1.triage.02'] });
    mixer.tick(0, 20);
    line(bus, C1_03);
    expect(port.calls.some((c) => c.includes('C1.triage.03'))).toBe(false);
    expect(mixer.snapshot().missing).toEqual([C1_03]);
  });

  // Was "ships no voice manifest yet" (toEqual({})): the recorded voices have landed, so the build
  // now bundles their manifest. tests/voice-files.test.ts checks it against the files on disk.
  it('bundles the voice manifest of the recorded lines, both languages', () => {
    const m = bundledVoiceManifest();
    expect(m.ja).toContain('C1.triage.02');
    expect(m.en).toContain('C1.lux.01');
    expect(m.ja).toHaveLength(85);
    expect(m.en).toHaveLength(85);
  });

  it('keeps the last 20 requests', () => {
    const { bus, mixer } = setup({});
    for (let i = 0; i < 25; i++) line(bus, i % 2 ? C1_02 : C1_03);
    expect(mixer.snapshot().recentVoice).toHaveLength(20);
  });

  it('never throws when the port does', () => {
    const bus = new Bus();
    const mixer = new Mixer(bus, MANIFEST);
    const boom = (): never => {
      throw new Error('locked');
    };
    mixer.attach({
      loadVoice: boom,
      unloadVoice: boom,
      voiceReady: () => true,
      playVoice: boom,
      stopVoice: boom,
      setGain: boom,
    });
    expect(() => {
      mixer.tick(0, 20);
      line(bus, C1_02);
      mixer.tick(1, 300);
    }).not.toThrow();
    expect(mixer.snapshot().playing).toBeNull();
  });
});
