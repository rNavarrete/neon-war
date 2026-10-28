// The Live screen's mixer: three channels (music, sfx, voice), the duck under a voice, one voice
// clip at a time and the voice groups kept loaded around the night's clock. Phaser-free: it talks
// to whatever can make sound through a SoundPort (OverlayScene's adapter in the game, a fake in
// tests), and time comes in as a parameter, so every rule is unit-tested in node (docs/AUDIO.md).
//
// - A comms band `line` (or a `voice` request, the replay glyph) asks for that line's clip. Only ids
//   listed in public/audio/voice/manifest.json are ever requested; every other id is recorded in
//   `missing` and plays nothing, so the band falls back to its text dwell.
// - At most one clip plays: a new request stops the one playing (voiceEnd for it) first.
// - While a clip plays, music ducks to 0.35x and sfx to 0.7x, ramping in over 150 ms and back out
//   over 400 ms after voiceEnd, on the clock tick() is given (the HUD clock).
// - Loaded voice groups are the previous, current and next challenge of the sim's now (never the
//   whole set); a rewind moves now back and the groups follow on the next tick.
// - The voices setting picks the clip's language (src/game/voice.ts voiceLangFor; TRIAGE stays
//   Japanese). With voices off every request is still recorded, but nothing loads or plays, and the
//   band falls back to its text dwell. A clip plays at the voice gain times the voice volume.
// - A cut clip (a new line, voiceStop) fades to nothing over VOICE_CUT_FADE_MS on the port.

import type { LineId } from '../strings';
import { BROWNOUT } from '../sim/brownout';
import { type Bus, bus } from './bus';
import { type Settings, settings } from './settings';
import { voiceLangFor } from './voice';

// ---- sound effect keys added for the Live screen ----

/**
 * Effects the Live screen adds beside SFX_KEYS (src/game/audio.ts, pinned at 21). The files come
 * from the owner's pipeline and are listed in docs/AUDIO.md; until one is in
 * public/audio/sfx/manifest.json it is never loaded, and an emitter asking for it stays silent.
 */
export const LIVE_SFX_KEYS = ['server-online', 'packet-drop', 'health-skip', 'headroom-red'] as const;

export type LiveSfxKey = (typeof LIVE_SFX_KEYS)[number];

export function isLiveSfxKey(key: string): key is LiveSfxKey {
  return (LIVE_SFX_KEYS as readonly string[]).includes(key);
}

// ---- channels and the duck ----

export type Channel = 'music' | 'sfx' | 'voice';

/** Under a voice the music falls to this share of its level, the effects to this one. */
export const DUCK = { music: 0.35, sfx: 0.7, inSeconds: 0.15, outSeconds: 0.4 } as const;

export interface ChannelGains {
  music: number;
  sfx: number;
  voice: number;
}

/**
 * How far the duck has gone, 0 (none) to 1 (full), after `dt` seconds moving toward `on`: 150 ms
 * from none to full, 400 ms back.
 */
export function stepDuck(depth: number, on: boolean, dt: number): number {
  if (dt <= 0) return depth;
  if (on) return Math.min(1, depth + dt / DUCK.inSeconds);
  return Math.max(0, depth - dt / DUCK.outSeconds);
}

/** The music and sfx gains at a duck depth (voice is never ducked). */
export function duckedGain(channel: Channel, depth: number): number {
  if (channel === 'voice') return 1;
  const floor = channel === 'music' ? DUCK.music : DUCK.sfx;
  // Rounded so a finished ramp reads exactly 0.35 / 0.7 / 1.
  return Math.round((1 - depth * (1 - floor)) * 1e6) / 1e6;
}

// ---- voices: files, languages and groups ----

export type VoiceLang = 'ja' | 'en';

/** What the owner's pipeline wrote with the voice drop: the ids present in each language. */
export interface VoiceManifest {
  readonly ja?: readonly string[];
  readonly en?: readonly string[];
}

/** The voice file for a line, relative to the page (public/audio/voice/<lang>/<ID>.mp3). */
export function voicePath(id: string, lang: VoiceLang): string {
  return `audio/voice/${lang}/${id}.mp3`;
}

/** The loader and cache key of a voice clip. */
export function voiceKey(id: string, lang: VoiceLang): string {
  return `voice:${lang}:${id}`;
}

/** A cut clip (a new line or voiceStop) fades to nothing over this long instead of stopping dead. */
export const VOICE_CUT_FADE_MS = 120;

/** The settings the mixer reads: the voices setting and the voice volume. */
export type VoiceSettings = Pick<Settings, 'voices' | 'voiceVolume'>;

/**
 * The language the mixer asks for a line's clip in under the voices setting, or null when voices
 * are off: voiceLangFor (TRIAGE in Japanese). An id the script does not voice (not a line, or a
 * stage direction) keeps the setting's language, so the manifest alone decides it; Pure.
 */
export function mixerLangFor(id: string, voices: VoiceSettings['voices']): VoiceLang | null {
  if (voices === 'off') return null;
  return voiceLangFor(id, voices) ?? voices;
}

/** A line's voice group: the challenge in its id (`C4.triage.02` is 4); null for fill and other ids. */
export function voiceGroupOf(id: string): number | null {
  const m = /^C(\d)\./.exec(id);
  return m ? Number(m[1]) : null;
}

const CHALLENGE_STARTS: readonly number[] = Object.values(BROWNOUT.challenges);
/** The last challenge with lines (c8 is the debrief). */
export const LAST_GROUP = CHALLENGE_STARTS.length - 1;

/** The challenge the sim's clock is in: the last whose start is at or before `now` (0 before C1). */
export function challengeAt(now: number): number {
  let k = 0;
  for (let i = 0; i < CHALLENGE_STARTS.length; i++) if (CHALLENGE_STARTS[i] <= now) k = i;
  return k;
}

/** The voice groups to keep loaded at `now`: the previous, current and next challenge, in order. */
export function residentGroups(now: number): number[] {
  const k = challengeAt(now);
  const out: number[] = [];
  for (let g = k - 1; g <= k + 1; g++) if (g >= 0 && g <= LAST_GROUP) out.push(g);
  return out;
}

/** Whether the manifest lists a line's clip in that language. */
export function inManifest(manifest: VoiceManifest, id: string, lang: VoiceLang): boolean {
  return manifest[lang]?.includes(id) ?? false;
}

/** The manifest's ids in `lang` whose group is one of `groups`, in manifest order. */
export function idsInGroups(manifest: VoiceManifest, lang: VoiceLang, groups: readonly number[]): string[] {
  return (manifest[lang] ?? []).filter((id) => {
    const g = voiceGroupOf(id);
    return g !== null && groups.includes(g);
  });
}

// ---- the port ----

/** What makes noise: OverlayScene's adapter over Phaser's sound manager, or a fake in tests. Must never throw. */
export interface SoundPort {
  /** Queue a voice clip's file for loading. */
  loadVoice(key: string, url: string): void;
  /** Drop a loaded clip (its group left the window). */
  unloadVoice(key: string): void;
  /** Whether the clip is loaded and can play now. */
  voiceReady(key: string): boolean;
  /**
   * Start the clip at `volume`; `onEnd` runs when it finishes by itself. Returns its length in
   * seconds (0 when the browser cannot tell), or null when it could not start.
   */
  playVoice(key: string, volume: number, onEnd: () => void): number | null;
  stopVoice(key: string): void;
  /** The music or sfx channel's gain changed (1 is the level settings ask for). */
  setGain(channel: 'music' | 'sfx', gain: number): void;
}

// ---- the mixer ----

/** The mixer's part of the shell test section: `shell.voice`. */
export interface VoiceTestState {
  /** Ids a clip was asked for (by a band line or the replay glyph), oldest first, the last 20. */
  recentVoice: string[];
  /**
   * The same requests as 'lang:id', in the language the voices setting gave each when it was asked
   * for ('off:id' while voices are off), oldest first, the last 20.
   */
  requested: string[];
  /** Ids asked for that the manifest does not list in their language, each once, in order. */
  missing: string[];
  /** The clip playing now, or null. */
  playing: string | null;
  /** Ids that started playing (voiceStart), oldest first, the last 20. */
  started: string[];
  /** The voice groups kept loaded, and how many clips of them are loaded or loading. */
  groups: number[];
  loaded: number;
  /** The channel gains now (1 = the settings level). */
  gains: ChannelGains;
}

const RECENT_MAX = 20;

interface Playing {
  id: LineId;
  key: string;
  /** Clock it started and its length (0 when unknown). */
  since: number;
  seconds: number;
}

export class Mixer {
  private port: SoundPort | null = null;
  private clock = 0;
  private depth = 0;
  private readonly gains: ChannelGains = { music: 1, sfx: 1, voice: 1 };
  private playing: Playing | null = null;
  /** A listed clip asked for before it had loaded: it plays once ready, unless another line comes first. */
  private pending: LineId | null = null;
  /** The pending clip's key (its language is the one the setting gave at the request). */
  private pendingKey = '';
  /** The voices setting the resident groups were loaded for. */
  private voicesAt: VoiceSettings['voices'] | null = null;
  private challenge = -1;
  private groups: number[] = [];
  /** Voice keys loaded (or loading) for the resident groups. */
  private readonly loaded = new Set<string>();
  private readonly recent: string[] = [];
  private readonly requested: string[] = [];
  private readonly started: string[] = [];
  private readonly missing: string[] = [];

  constructor(
    private readonly bus: Bus,
    private readonly manifest: VoiceManifest,
    /** The voices setting and voice volume now (src/game/settings.ts; a stand-in in tests). */
    private readonly readSettings: () => VoiceSettings = settings,
  ) {
    bus.on('line', ({ id }) => this.request(id));
    bus.on('voice', ({ id }) => this.request(id));
    bus.on('voiceStop', ({ id }) => {
      if (this.playing?.id === id) this.stopPlaying();
    });
  }

  /** Attach the port (null detaches it, on scene shutdown). The current gains go out at once. */
  attach(port: SoundPort | null): void {
    this.port = port;
    this.loaded.clear();
    this.challenge = -1;
    this.voicesAt = null;
    if (port) {
      this.safely(() => port.setGain('music', this.gains.music));
      this.safely(() => port.setGain('sfx', this.gains.sfx));
    }
  }

  /** The channel gains now. */
  gain(channel: Channel): number {
    return this.gains[channel];
  }

  /**
   * One frame: `clock` is the HUD clock (seconds), `simNow` the sim's now (frame().now). Moves the
   * duck, ends a clip whose length has run out, plays a pending clip that has loaded and keeps the
   * resident groups. Allocates nothing unless the challenge changed.
   */
  tick(clock: number, simNow: number): void {
    const dt = clock - this.clock;
    this.clock = clock;

    const p = this.playing;
    if (p && p.seconds > 0 && clock >= p.since + p.seconds) this.finish();
    if (this.pending !== null && this.port) {
      const id = this.pending;
      const key = this.pendingKey;
      if (this.port.voiceReady(key)) {
        this.pending = null;
        this.start(id, key);
      }
    }

    const depth = stepDuck(this.depth, this.playing !== null, dt);
    if (depth !== this.depth) {
      this.depth = depth;
      this.setGain('music', duckedGain('music', depth));
      this.setGain('sfx', duckedGain('sfx', depth));
    }

    const k = challengeAt(simNow);
    const voices = this.readSettings().voices;
    if (k !== this.challenge || voices !== this.voicesAt) {
      this.challenge = k;
      this.voicesAt = voices;
      this.resolveGroups(simNow);
    }
  }

  /** A clip is asked for: stop the one playing, then play this one if the manifest lists it. */
  request(id: LineId): void {
    this.recent.push(id);
    if (this.recent.length > RECENT_MAX) this.recent.shift();
    if (this.playing) this.stopPlaying();
    this.pending = null;
    const voices = this.readSettings().voices;
    const lang = mixerLangFor(id, voices);
    this.requested.push(`${lang ?? voices}:${id}`);
    if (this.requested.length > RECENT_MAX) this.requested.shift();
    // Voices off: the request is on record, and nothing loads or plays.
    if (lang === null) return;
    if (!inManifest(this.manifest, id, lang)) {
      if (!this.missing.includes(id)) this.missing.push(id);
      return;
    }
    const key = voiceKey(id, lang);
    const port = this.port;
    if (!port) return;
    if (port.voiceReady(key)) {
      this.start(id, key);
      return;
    }
    // Listed but outside the loaded groups (or still loading): fetch it and play once it is in.
    if (!this.loaded.has(key)) {
      this.loaded.add(key);
      this.safely(() => port.loadVoice(key, voicePath(id, lang)));
    }
    this.pending = id;
    this.pendingKey = key;
  }

  /** The `shell.voice` hook section. */
  snapshot(): VoiceTestState {
    return {
      recentVoice: [...this.recent],
      requested: [...this.requested],
      missing: [...this.missing],
      playing: this.playing?.id ?? null,
      started: [...this.started],
      groups: [...this.groups],
      loaded: this.loaded.size,
      gains: { ...this.gains },
    };
  }

  private start(id: LineId, key: string): void {
    const port = this.port;
    if (!port) return;
    let seconds: number | null = null;
    this.safely(() => {
      seconds = port.playVoice(key, this.gains.voice * this.readSettings().voiceVolume, () => {
        if (this.playing?.key === key) this.finish();
      });
    });
    if (seconds === null) return;
    const s = Math.max(0, seconds as number);
    this.playing = { id, key, since: this.clock, seconds: s };
    this.started.push(id);
    if (this.started.length > RECENT_MAX) this.started.shift();
    this.bus.emit('voiceStart', { id, seconds: s });
  }

  /** Stop the playing clip early (a new line, or voiceStop). */
  private stopPlaying(): void {
    const p = this.playing;
    if (!p) return;
    const port = this.port;
    if (port) this.safely(() => port.stopVoice(p.key));
    this.finish();
  }

  /** The playing clip is over: the duck starts back out from this tick. */
  private finish(): void {
    const p = this.playing;
    if (!p) return;
    this.playing = null;
    this.bus.emit('voiceEnd', { id: p.id });
  }

  private setGain(channel: 'music' | 'sfx', g: number): void {
    if (this.gains[channel] === g) return;
    this.gains[channel] = g;
    const port = this.port;
    if (port) this.safely(() => port.setGain(channel, g));
  }

  /** Load the clips of the resident groups and drop the rest (only manifest ids, never the whole set). */
  private resolveGroups(simNow: number): void {
    this.groups = residentGroups(simNow);
    const port = this.port;
    if (!port) return;
    const voices = this.voicesAt ?? this.readSettings().voices;
    const want = new Set<string>();
    for (const lang of ['ja', 'en'] as const) {
      for (const id of idsInGroups(this.manifest, lang, this.groups)) {
        if (mixerLangFor(id, voices) === lang) want.add(voiceKey(id, lang));
      }
    }
    for (const key of [...this.loaded]) {
      if (want.has(key) || key === this.playing?.key) continue;
      this.loaded.delete(key);
      this.safely(() => port.unloadVoice(key));
    }
    for (const key of want) {
      if (this.loaded.has(key)) continue;
      this.loaded.add(key);
      const [, lang, id] = key.split(':') as [string, VoiceLang, string];
      this.safely(() => port.loadVoice(key, voicePath(id, lang)));
    }
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch {
      // Locked or missing audio never stops the game.
    }
  }
}

// ---- the files the build ships ----

/**
 * The voice manifest bundled at build time from public/audio/voice/manifest.json; empty when the
 * drop has not landed, so no voice file and no manifest is ever requested at runtime.
 */
export function bundledVoiceManifest(): VoiceManifest {
  const found = import.meta.glob<VoiceManifest>('../../public/audio/voice/manifest.json', {
    eager: true,
    import: 'default',
  });
  return Object.values(found)[0] ?? {};
}

/** The Live effects whose files have landed, from public/audio/sfx/manifest.json (an array of keys). */
export function bundledLiveSfx(): LiveSfxKey[] {
  const found = import.meta.glob<readonly string[]>('../../public/audio/sfx/manifest.json', {
    eager: true,
    import: 'default',
  });
  const listed = Object.values(found)[0] ?? [];
  return LIVE_SFX_KEYS.filter((k) => listed.includes(k));
}

/** The game's one mixer, listening to the shared bus from the first import; OverlayScene attaches its port. */
export const mixer = new Mixer(bus, bundledVoiceManifest());
