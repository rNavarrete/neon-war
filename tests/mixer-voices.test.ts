import overlaySource from '../src/scenes/OverlayScene.ts?raw';
import { Bus } from '../src/game/bus';
import {
  Mixer,
  type SoundPort,
  VOICE_CUT_FADE_MS,
  type VoiceManifest,
  type VoiceSettings,
  mixerLangFor,
} from '../src/game/mixer';
import type { LineId } from '../src/strings';

// Cross-lane swap 3: the mixer honours the voices setting (JA / EN / OFF, TRIAGE always Japanese)
// and the voice volume, records every request as 'lang:id', and a cut clip fades over 120 ms.

class FakePort implements SoundPort {
  readonly calls: string[] = [];
  readonly volumes: number[] = [];
  readonly ready = new Set<string>();
  loadVoice(key: string, url: string): void {
    this.calls.push(`load ${key} ${url}`);
    this.ready.add(key);
  }
  unloadVoice(key: string): void {
    this.calls.push(`unload ${key}`);
    this.ready.delete(key);
  }
  voiceReady(key: string): boolean {
    return this.ready.has(key);
  }
  playVoice(key: string, volume: number): number | null {
    this.calls.push(`play ${key}`);
    this.volumes.push(volume);
    return 2;
  }
  stopVoice(key: string): void {
    this.calls.push(`stop ${key}`);
  }
  setGain(): void {}
}

const TRIAGE = 'C1.triage.02' as LineId;
const LUX = 'C1.lux.01' as LineId;
const MANIFEST: VoiceManifest = {
  ja: ['C1.triage.01', 'C1.triage.02', 'C1.lux.01'],
  en: ['C1.triage.01', 'C1.triage.02', 'C1.lux.01'],
};

function setup(initial: VoiceSettings) {
  const s: VoiceSettings = { ...initial };
  const bus = new Bus();
  const mixer = new Mixer(bus, MANIFEST, () => s);
  const port = new FakePort();
  const started: string[] = [];
  bus.on('voiceStart', (v) => started.push(v.id));
  mixer.attach(port);
  // The C0..C2 groups load (the fake loads at once), so a C1 line plays on request.
  mixer.tick(0, 20);
  const line = (id: LineId): void =>
    bus.emit('line', { id, speaker: '', tag: 'HINT', lesson: false, since: 0 });
  return { s, bus, mixer, port, started, line };
}

describe('mixerLangFor', () => {
  it('is voiceLangFor: off is null, every line takes the setting, TRIAGE too', () => {
    expect(mixerLangFor(TRIAGE, 'off')).toBeNull();
    expect(mixerLangFor(LUX, 'off')).toBeNull();
    expect(mixerLangFor(TRIAGE, 'en')).toBe('en');
    expect(mixerLangFor(LUX, 'en')).toBe('en');
    expect(mixerLangFor(LUX, 'ja')).toBe('ja');
  });
});

describe('the mixer honours the voices setting', () => {
  it('Japanese: records ja:id and plays the Japanese clip', () => {
    const { mixer, port, started, line } = setup({ voices: 'ja', voiceVolume: 1 });
    line(LUX);
    expect(port.calls).toContain('play voice:ja:C1.lux.01');
    expect(started).toEqual([LUX]);
    expect(mixer.snapshot().requested).toEqual(['ja:C1.lux.01']);
  });

  it('English: Lux and TRIAGE both play their English takes', () => {
    const { mixer, port, line } = setup({ voices: 'en', voiceVolume: 1 });
    line(LUX);
    line(TRIAGE);
    expect(port.calls).toContain('play voice:en:C1.lux.01');
    expect(port.calls).toContain('play voice:en:C1.triage.02');
    expect(mixer.snapshot().requested).toEqual(['en:C1.lux.01', 'en:C1.triage.02']);
  });

  it('off: records the request but neither loads nor plays, and lists nothing as missing', () => {
    const { mixer, port, started, line } = setup({ voices: 'off', voiceVolume: 1 });
    line(LUX);
    line(TRIAGE);
    expect(port.calls).toEqual([]);
    expect(started).toEqual([]);
    const snap = mixer.snapshot();
    expect(snap.recentVoice).toEqual([LUX, TRIAGE]);
    expect(snap.requested).toEqual(['off:C1.lux.01', 'off:C1.triage.02']);
    expect(snap.missing).toEqual([]);
    expect(snap.playing).toBeNull();
    expect(snap.loaded).toBe(0);
  });

  it('turning voices off mid-challenge unloads the group on the next tick; on loads it back', () => {
    const { s, mixer, port } = setup({ voices: 'ja', voiceVolume: 1 });
    expect(mixer.snapshot().loaded).toBe(3);
    port.calls.length = 0;
    s.voices = 'off';
    mixer.tick(0.1, 20);
    expect(port.calls).toEqual([
      'unload voice:ja:C1.triage.01',
      'unload voice:ja:C1.triage.02',
      'unload voice:ja:C1.lux.01',
    ]);
    expect(mixer.snapshot().loaded).toBe(0);
    port.calls.length = 0;
    s.voices = 'en';
    mixer.tick(0.2, 20);
    expect(port.calls).toEqual([
      'load voice:en:C1.triage.01 audio/voice/en/C1.triage.01.mp3',
      'load voice:en:C1.triage.02 audio/voice/en/C1.triage.02.mp3',
      'load voice:en:C1.lux.01 audio/voice/en/C1.lux.01.mp3',
    ]);
  });

  it('plays at the voice gain times the voice volume', () => {
    const { s, port, line } = setup({ voices: 'ja', voiceVolume: 0.9 });
    line(LUX);
    s.voiceVolume = 0.5;
    line(TRIAGE);
    expect(port.volumes).toEqual([0.9, 0.5]);
  });

  it('keeps the last 20 requests', () => {
    const { mixer, line } = setup({ voices: 'ja', voiceVolume: 1 });
    for (let i = 0; i < 25; i++) line(i % 2 === 0 ? LUX : TRIAGE);
    const r = mixer.snapshot().requested;
    expect(r).toHaveLength(20);
    expect(r.at(-1)).toBe('ja:C1.lux.01');
    expect(r[0]).toBe('ja:C1.triage.02');
  });
});

describe('a cut voice fades out', () => {
  it('fades over 120 ms', () => {
    expect(VOICE_CUT_FADE_MS).toBe(120);
  });

  it("OverlayScene's stopVoice fades the clip to 0 over VOICE_CUT_FADE_MS instead of destroying it", () => {
    const stop = /stopVoice: \(\) => \{([\s\S]*?)\n {6}\},/.exec(overlaySource);
    expect(stop).not.toBeNull();
    expect(stop![1]).toMatch(/this\.fadeOutVoice\(/);
    expect(stop![1]).not.toMatch(/destroy\(\)/);
    const fade = /private fadeOutVoice\([\s\S]*?\n {2}\}\n/.exec(overlaySource);
    expect(fade).not.toBeNull();
    expect(fade![0]).toMatch(/volume: 0, duration: VOICE_CUT_FADE_MS/);
  });
});
