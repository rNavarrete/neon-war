// The shared motion kit (art3d-3): every animation on the Live screen as a named spec, as data, each
// with a calm variant that plays instead while settings().reduceFlicker is on. Eight specs:
//
//   board (slowed with the packets while Regroup runs): placeDrop, dieCollapse, dipBlackout,
//     cardLift, crewTint
//   hud (HUD clock, never slowed): speakRing, needleEase, heldFlare
//
// A spec is a duration, a repeat (0 plays once, -1 loops) and tracks of keyframes over 0..1 of the
// duration. sampleSpec reads a spec at a time; MotionPlayer is the small adapter a view steps each
// frame with its dt and the Frame's timeScale, filling one reused MotionSample (no allocation). A
// one-shot spec ends on its rest values; a loop ends where it starts and the view sets `rest` when it
// stops. Calm variants never blink: alpha and light change direction at most once a second, and the
// calm dip only ever darkens.
//
// The hook rule: a view reports what it plotted (the target, the state the motion settles on), never
// a sampled or eased in-between value. MotionPlayer.hookValue and readoutHook give that value.
//
// Pure: no Phaser, no DOM, no clock. Time comes in as a parameter (ms or s, as named). Wiring the
// specs into BoardScene and the views is board-9's ticket; no view adopts this module yet.

/** The properties a spec can move. Neutral values are in NEUTRAL. */
export type MotionProp = 'alpha' | 'scale' | 'y' | 'light' | 'ring' | 'mix' | 'glow' | 'value';

export const MOTION_PROPS: readonly MotionProp[] = Object.freeze([
  'alpha',
  'scale',
  'y',
  'light',
  'ring',
  'mix',
  'glow',
  'value',
] as MotionProp[]);

/**
 * What each property means, at rest, when no track moves it: alpha 1 (opaque), scale 1, y 0 px
 * (offset from the sprite's place), light 1 (fully lit; 0 is black), ring 0 (the speaker ring's
 * alpha), mix 0 (no crew tint; 1 is full crew colour), glow 0, value 0 (progress from the old reading
 * to the new, 0..1).
 */
export const NEUTRAL: Readonly<Record<MotionProp, number>> = Object.freeze({
  alpha: 1,
  scale: 1,
  y: 0,
  light: 1,
  ring: 0,
  mix: 0,
  glow: 0,
  value: 0,
});

/** The easing curves a keyframe segment can use, by name. All map 0 to 0 and 1 to 1. */
export type EaseName =
  'linear' | 'quadIn' | 'quadOut' | 'cubicOut' | 'sineInOut' | 'backOut' | 'hold' | 'exp5';

const EXP5_NORM = 1 - Math.exp(-5);

/** An ease by name, on progress p in 0..1. 'hold' keeps the segment's start until its end. */
export function ease(name: EaseName, p: number): number {
  const t = p <= 0 ? 0 : p >= 1 ? 1 : p;
  switch (name) {
    case 'linear':
      return t;
    case 'quadIn':
      return t * t;
    case 'quadOut':
      return 1 - (1 - t) * (1 - t);
    case 'cubicOut':
      return 1 - (1 - t) ** 3;
    case 'sineInOut':
      return 0.5 - 0.5 * Math.cos(Math.PI * t);
    case 'backOut': {
      const c = 1.70158;
      return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
    }
    case 'hold':
      return t >= 1 ? 1 : 0;
    case 'exp5':
      // An exponential follow over five time constants, normalised to land exactly on 1.
      return (1 - Math.exp(-5 * t)) / EXP5_NORM;
  }
}

/** One keyframe: the value at `at` (0..1 of the duration); `ease` shapes the way in from the previous key. */
export interface Keyframe {
  readonly at: number;
  readonly value: number;
  readonly ease?: EaseName;
}

export interface Track {
  readonly prop: MotionProp;
  /** Sorted by `at`, first at 0 and last at 1. */
  readonly keys: readonly Keyframe[];
}

/** One way to play a spec: the full one or its calm variant. */
export interface MotionVariant {
  /** Ms of one play (one cycle for a loop), at timeScale 1. */
  readonly durationMs: number;
  /** 0 plays once; -1 loops until the view stops it. */
  readonly repeat: 0 | -1;
  readonly tracks: readonly Track[];
}

export type MotionName =
  | 'placeDrop'
  | 'dieCollapse'
  | 'dipBlackout'
  | 'speakRing'
  | 'needleEase'
  | 'cardLift'
  | 'heldFlare'
  | 'crewTint';

/** Board specs run on board time (slowed by Regroup with the packets); hud specs on the HUD clock. */
export type MotionScope = 'board' | 'hud';

export interface MotionSpec extends MotionVariant {
  readonly name: MotionName;
  readonly scope: MotionScope;
  /** What it animates and when. */
  readonly what: string;
  /** Played instead while reduce flicker is on. */
  readonly calm: MotionVariant;
  /** The values the view holds once the spec ends or is stopped: what the hook reports. */
  readonly rest: Readonly<Partial<Record<MotionProp, number>>>;
}

const k = (at: number, value: number, e?: EaseName): Keyframe => (e ? { at, value, ease: e } : { at, value });
const tr = (prop: MotionProp, ...keys: Keyframe[]): Track => ({ prop, keys });

function spec(s: MotionSpec): MotionSpec {
  return Object.freeze(s);
}

/** The speaker ring's pulse, Hz (docs: amber at 1.2 Hz, steady under reduce flicker). */
export const SPEAK_RING_HZ = 1.2;

/** The gauge needle's time constant, s (hud/gauge.ts NEEDLE_EASE_SECONDS; asserted equal in tests). */
export const NEEDLE_TAU_SECONDS = 0.18;

/** The crew cable's lowering, ms: 1.2 s inside the crew-build wait, no hold. */
export const CREW_TINT_MS = 1200;

/** The balancer padlock's lift pulse, ms. */
export const CARD_LIFT_MS = 600;

export const MOTION: Readonly<Record<MotionName, MotionSpec>> = Object.freeze({
  placeDrop: spec({
    name: 'placeDrop',
    scope: 'board',
    what: 'a part dropped on its pad: falls 24 px with a small overshoot and fades in',
    durationMs: 320,
    repeat: 0,
    tracks: [
      tr('y', k(0, -24), k(1, 0, 'backOut')),
      tr('alpha', k(0, 0), k(0.4, 1, 'quadOut'), k(1, 1)),
      tr('scale', k(0, 1.08), k(1, 1, 'cubicOut')),
    ],
    calm: {
      durationMs: 400,
      repeat: 0,
      tracks: [tr('alpha', k(0, 0), k(1, 1, 'quadOut'))],
    },
    rest: { y: 0, alpha: 1, scale: 1 },
  }),
  dieCollapse: spec({
    name: 'dieCollapse',
    scope: 'board',
    what: 'a server dies: two fast blinks, then it sinks 10 px and settles dim',
    durationMs: 700,
    repeat: 0,
    tracks: [
      tr(
        'alpha',
        k(0, 1),
        k(0.1, 0.3, 'hold'),
        k(0.2, 1, 'hold'),
        k(0.3, 0.3, 'hold'),
        k(0.4, 1, 'hold'),
        k(1, 0.6, 'quadIn'),
      ),
      tr('scale', k(0, 1), k(0.4, 1), k(1, 0.9, 'quadIn')),
      tr('y', k(0, 0), k(0.4, 0), k(1, 10, 'quadIn')),
    ],
    calm: {
      durationMs: 700,
      repeat: 0,
      tracks: [
        tr('alpha', k(0, 1), k(1, 0.6, 'linear')),
        tr('scale', k(0, 1), k(1, 0.9, 'quadOut')),
        tr('y', k(0, 0), k(1, 10, 'quadOut')),
      ],
    },
    rest: { alpha: 0.6, scale: 0.9, y: 10 },
  }),
  dipBlackout: spec({
    name: 'dipBlackout',
    scope: 'board',
    what: 'a power dip takes a part dark: the light stutters twice and goes out',
    durationMs: 600,
    repeat: 0,
    tracks: [
      tr(
        'light',
        k(0, 1),
        k(0.15, 0.1, 'hold'),
        k(0.3, 0.8, 'hold'),
        k(0.45, 0.1, 'hold'),
        k(0.6, 0.6, 'hold'),
        k(0.75, 0, 'hold'),
        k(1, 0),
      ),
    ],
    calm: {
      durationMs: 800,
      repeat: 0,
      tracks: [tr('light', k(0, 1), k(1, 0, 'sineInOut'))],
    },
    rest: { light: 0 },
  }),
  speakRing: spec({
    name: 'speakRing',
    scope: 'hud',
    what: "the speaker's COMMS ring glows while a line plays: 1.2 Hz, steady under reduce flicker",
    durationMs: Math.round(1000 / SPEAK_RING_HZ),
    repeat: -1,
    tracks: [tr('ring', k(0, 0.35), k(0.5, 1, 'sineInOut'), k(1, 0.35, 'sineInOut'))],
    calm: {
      durationMs: 1000,
      repeat: -1,
      tracks: [tr('ring', k(0, 1), k(1, 1))],
    },
    rest: { ring: 0 },
  }),
  needleEase: spec({
    name: 'needleEase',
    scope: 'hud',
    what: 'an eased readout (the gauge needle) moving from the old reading to the new: value 0..1',
    durationMs: Math.round(5 * NEEDLE_TAU_SECONDS * 1000),
    repeat: 0,
    tracks: [tr('value', k(0, 0), k(1, 1, 'exp5'))],
    // A needle never blinks, so the calm variant is the same ease.
    calm: {
      durationMs: Math.round(5 * NEEDLE_TAU_SECONDS * 1000),
      repeat: 0,
      tracks: [tr('value', k(0, 0), k(1, 1, 'exp5'))],
    },
    rest: { value: 1 },
  }),
  cardLift: spec({
    name: 'cardLift',
    scope: 'board',
    what: 'a padlock or a decommissioned part lifts away: rises 18 px with a pulse and fades out',
    durationMs: CARD_LIFT_MS,
    repeat: 0,
    tracks: [
      tr('y', k(0, 0), k(1, -18, 'cubicOut')),
      tr('scale', k(0, 1), k(0.3, 1.12, 'quadOut'), k(1, 1, 'quadIn')),
      tr('alpha', k(0, 1), k(0.4, 1), k(1, 0, 'quadIn')),
    ],
    calm: {
      durationMs: CARD_LIFT_MS,
      repeat: 0,
      tracks: [tr('alpha', k(0, 1), k(1, 0, 'linear')), tr('y', k(0, 0), k(1, -18, 'quadOut'))],
    },
    rest: { y: -18, scale: 1, alpha: 0 },
  }),
  heldFlare: spec({
    name: 'heldFlare',
    scope: 'hud',
    what: 'midnight held: the band flares twice and settles on a warm glow',
    durationMs: 1400,
    repeat: 0,
    tracks: [
      tr(
        'glow',
        k(0, 0),
        k(0.15, 1, 'quadOut'),
        k(0.35, 0.3, 'quadIn'),
        k(0.5, 1, 'quadOut'),
        k(1, 0.4, 'sineInOut'),
      ),
      tr(
        'scale',
        k(0, 1),
        k(0.15, 1.12, 'quadOut'),
        k(0.35, 1, 'quadIn'),
        k(0.5, 1.08, 'quadOut'),
        k(1, 1, 'sineInOut'),
      ),
    ],
    calm: {
      durationMs: 1200,
      repeat: 0,
      tracks: [tr('glow', k(0, 0), k(1, 0.4, 'sineInOut'))],
    },
    rest: { glow: 0.4, scale: 1 },
  }),
  crewTint: spec({
    name: 'crewTint',
    scope: 'board',
    what: 'the crew lowers the balancer: the cable and pad wash in crew colour and back, 1.2 s',
    durationMs: CREW_TINT_MS,
    repeat: 0,
    tracks: [
      tr(
        'mix',
        k(0, 0),
        k(0.25, 1, 'quadOut'),
        k(0.5, 0.4, 'sineInOut'),
        k(0.75, 1, 'sineInOut'),
        k(1, 0, 'quadIn'),
      ),
    ],
    calm: {
      durationMs: CREW_TINT_MS,
      repeat: 0,
      tracks: [tr('mix', k(0, 0), k(0.5, 0.6, 'sineInOut'), k(1, 0, 'sineInOut'))],
    },
    rest: { mix: 0 },
  }),
});

export const MOTION_NAMES: readonly MotionName[] = Object.freeze(Object.keys(MOTION) as MotionName[]);

/** The variant that plays: the calm one under reduce flicker. */
export function variantOf(s: MotionSpec, reduceFlicker: boolean): MotionVariant {
  return reduceFlicker ? s.calm : s;
}

/**
 * The time factor a spec runs at given the Frame's timeScale: board specs take it (0.25 while
 * Regroup runs, so they slow with the packets), hud specs ignore it. 0 or below (paused) freezes.
 */
export function specTimeScale(s: MotionSpec, frameTimeScale: number): number {
  if (s.scope !== 'board') return 1;
  return frameTimeScale > 0 ? frameTimeScale : 0;
}

/** Wall ms one play of a spec lasts at a Frame timeScale (Infinity when frozen). */
export function scaledDurationMs(s: MotionSpec, reduceFlicker: boolean, frameTimeScale: number): number {
  const ts = specTimeScale(s, frameTimeScale);
  const d = variantOf(s, reduceFlicker).durationMs;
  return ts > 0 ? d / ts : Infinity;
}

/** A track's value at progress p (0..1). */
export function sampleTrack(t: Track, p: number): number {
  const keys = t.keys;
  if (p <= keys[0].at) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (p <= b.at) {
      const a = keys[i - 1];
      const span = b.at - a.at;
      const q = span > 0 ? (p - a.at) / span : 1;
      return a.value + (b.value - a.value) * ease(b.ease ?? 'linear', q);
    }
  }
  return keys[keys.length - 1].value;
}

/** What a sample holds: every prop, neutral unless a track moves it. Reused by MotionPlayer. */
export type MotionSample = Record<MotionProp, number>;

export function neutralSample(): MotionSample {
  return { ...NEUTRAL };
}

/**
 * The spec's values `tMs` (spec time) after it started, into `out` (a new sample when omitted).
 * A one-shot clamps at its end; a loop wraps. Props no track moves stay neutral.
 */
export function sampleSpec(
  s: MotionSpec,
  tMs: number,
  reduceFlicker: boolean,
  out?: MotionSample,
): MotionSample {
  const o = out ?? neutralSample();
  for (const p of MOTION_PROPS) o[p] = NEUTRAL[p];
  const v = variantOf(s, reduceFlicker);
  let p: number;
  if (v.repeat === -1) {
    const m = tMs % v.durationMs;
    p = (m < 0 ? m + v.durationMs : m) / v.durationMs;
  } else {
    p = tMs <= 0 ? 0 : tMs >= v.durationMs ? 1 : tMs / v.durationMs;
  }
  for (const t of v.tracks) o[t.prop] = sampleTrack(t, p);
  return o;
}

/** Whether a one-shot spec has finished `tMs` (spec time) after it started. Loops never finish. */
export function specDone(s: MotionSpec, tMs: number, reduceFlicker: boolean): boolean {
  const v = variantOf(s, reduceFlicker);
  return v.repeat === 0 && tMs >= v.durationMs;
}

/**
 * The adapter a view steps each frame: play a spec, step it by the HUD dt and the Frame's timeScale,
 * read the reused sample. One per animated object, made once; nothing allocates per step.
 */
export class MotionPlayer {
  /** The spec playing, or null while idle. */
  spec: MotionSpec | null = null;
  /** Spec ms since play (already scaled by timeScale). */
  elapsedMs = 0;
  /** The values to draw this frame. */
  readonly sample: MotionSample = neutralSample();

  /** Start `s` from its beginning (restarts it if it is already playing). */
  play(s: MotionSpec): void {
    this.spec = s;
    this.elapsedMs = 0;
  }

  /** Stop and hold the spec's rest values (idle afterwards). */
  stop(): void {
    const s = this.spec;
    for (const p of MOTION_PROPS) this.sample[p] = NEUTRAL[p];
    if (s) for (const p of MOTION_PROPS) if (s.rest[p] !== undefined) this.sample[p] = s.rest[p] as number;
    this.spec = null;
    this.elapsedMs = 0;
  }

  /**
   * Advance by `dtSeconds` of HUD time at the Frame's `timeScale` and fill `sample`. A one-shot that
   * reaches its end stops on its rest values. Returns the sample.
   */
  step(dtSeconds: number, frameTimeScale: number, reduceFlicker: boolean): MotionSample {
    const s = this.spec;
    if (!s) return this.sample;
    if (dtSeconds > 0) this.elapsedMs += dtSeconds * 1000 * specTimeScale(s, frameTimeScale);
    if (specDone(s, this.elapsedMs, reduceFlicker)) {
      this.stop();
      return this.sample;
    }
    sampleSpec(s, this.elapsedMs, reduceFlicker, this.sample);
    return this.sample;
  }

  /** The hook's motion field: the spec name while one plays, 'idle' otherwise. */
  get motion(): MotionName | 'idle' {
    return this.spec ? this.spec.name : 'idle';
  }

  /**
   * What the hook reports for `prop`: the value the motion settles on (the spec's rest), never the
   * in-between value drawn this frame. Neutral while idle and the spec does not set it.
   */
  hookValue(prop: MotionProp): number {
    const s = this.spec;
    if (s && s.rest[prop] !== undefined) return s.rest[prop] as number;
    return this.spec ? NEUTRAL[prop] : this.sample[prop];
  }
}

/** An eased readout: the value plotted (the sim's number) and the value drawn while it eases there. */
export interface EasedReadout {
  /** The number the sim gave this frame: the hook reports this. */
  plotted: number;
  /** The drawn, eased value (a needle's angle input); never reported. */
  shown: number;
}

/**
 * One step of an eased readout toward its plotted value over `dt` seconds: an exponential follow with
 * needleEase's time constant, exact once within `snap`. dt 0 leaves it; a non-finite shown jumps.
 * Mutates and returns `r` (one per readout, made once).
 */
export function followReadout(r: EasedReadout, plotted: number, dt: number, snap = 0.01): EasedReadout {
  r.plotted = plotted;
  if (!Number.isFinite(r.shown)) {
    r.shown = plotted;
    return r;
  }
  if (dt <= 0) return r;
  const next = r.shown + (plotted - r.shown) * (1 - Math.exp(-dt / NEEDLE_TAU_SECONDS));
  r.shown = Math.abs(plotted - next) < snap ? plotted : next;
  return r;
}

/** What the hook reports for an eased readout: the plotted value, never the eased one. */
export function readoutHook(r: EasedReadout): number {
  return r.plotted;
}

// ---- the glow probe (art3d-6) ----
//
// A red Glow filter on at most three over-capacity parts (the hottest first) and one transient
// GradientMap on the board's camera when the crew's rescue lands. Which parts glow and how strongly
// are pure functions below; GlowProbe is the adapter BoardScene steps once a frame. It talks to
// Phaser through the small structural types here (no Phaser import), keeps its Glow controllers
// while the same parts stay hot, and adds or removes one only when the hot set changes: a steady
// frame allocates nothing. Under reduce flicker the glow is steady and the GradientMap never shows
// (a whole-board recolour is a flash).

/** The probe is on. Set false to drop it (no filter is ever made) if the frame budget fails. */
export const GLOW_PROBE_ON = true;
/** At most this many parts glow at once. */
export const GLOW_MAX = 3;
/** Red: only over capacity. */
export const GLOW_COLOUR = 0xff2a3a;
/** Glow sampling quality and distance (fixed at creation; low to keep each pass cheap). */
export const GLOW_QUALITY = 6;
export const GLOW_DISTANCE = 8;
/** The pulse rate when not calm, Hz. */
export const GLOW_PULSE_HZ = 1.5;
/** How long the rescue's GradientMap stays on, board-clock seconds. */
export const RESCUE_MAP_SECONDS = 1.5;
/** The rescue GradientMap's ramp: navy shadows to lamp cyan. */
export const RESCUE_MAP_RAMP = Object.freeze({ colorStart: 0x061226, colorEnd: 0x7fe9ff });

/**
 * The parts to glow: the ids of up to `max` parts over capacity (share > 1, finite, not dark), the
 * hottest first, ties by id. `ids`, `shares` and `dark` are parallel; `n` of them are read. Fills
 * `out` (cleared first) and `outShares` alongside and returns `out`: insertion into a top-k of at
 * most `max`, so nothing allocates once `out` has grown to `max`.
 */
export function pickGlowsInto(
  out: string[],
  outShares: number[],
  ids: readonly string[],
  shares: readonly (number | null)[],
  dark: readonly boolean[],
  n: number,
  max = GLOW_MAX,
): string[] {
  out.length = 0;
  outShares.length = 0;
  if (max <= 0) return out;
  for (let i = 0; i < n; i++) {
    const s = shares[i];
    if (s === null || s === undefined || !Number.isFinite(s) || s <= 1 || dark[i]) continue;
    const id = ids[i];
    // Its place: before the first entry it beats (a higher share, or the same share and a lower id).
    let at = out.length;
    for (let k = 0; k < out.length; k++) {
      if (s > outShares[k] || (s === outShares[k] && id < out[k])) {
        at = k;
        break;
      }
    }
    if (at >= max) continue;
    if (out.length < max) {
      out.push('');
      outShares.push(0);
    }
    for (let k = out.length - 1; k > at; k--) {
      out[k] = out[k - 1];
      outShares[k] = outShares[k - 1];
    }
    out[at] = id;
    outShares[at] = s;
  }
  return out;
}

/** A part offered to the picker. */
export interface GlowCandidate {
  readonly id: string;
  readonly share: number | null;
  readonly dark?: boolean;
}

/** pickGlowsInto on a list, as a new array (for tests and one-off reads). Never mutates `parts`. */
export function pickGlows(parts: readonly GlowCandidate[], max = GLOW_MAX): string[] {
  return pickGlowsInto(
    [],
    [],
    parts.map((p) => p.id),
    parts.map((p) => p.share),
    parts.map((p) => p.dark === true),
    parts.length,
    max,
  );
}

/**
 * The Glow's outer strength for a part at `share` (> 1) at board-clock second `t`: hotter glows
 * more (2 just over 100%, up to 5 at 200% and over). Calm: steady at that level. Otherwise it
 * breathes at GLOW_PULSE_HZ between 70% and 100% of it.
 */
export function glowStrength(share: number, t: number, calm: boolean): number {
  const over = Math.min(Math.max(share - 1, 0), 1);
  const level = 2 + 3 * over;
  if (calm) return level;
  return level * (0.85 + 0.15 * Math.sin(2 * Math.PI * GLOW_PULSE_HZ * t));
}

/**
 * The rescue's GradientMap shows: the rescue landed at board-clock second `rescuedAt` (null
 * before) and `t` is less than RESCUE_MAP_SECONDS after it. Never when calm.
 */
export function rescueMapOn(t: number, rescuedAt: number | null, calm: boolean): boolean {
  if (calm || rescuedAt === null) return false;
  const since = t - rescuedAt;
  return since >= 0 && since < RESCUE_MAP_SECONDS;
}

// The structural Phaser types the probe touches (Phaser.Filters.Glow, FilterList, an Image).

/** A filter controller: Phaser.Filters.Controller. */
export interface FilterCtl {
  active: boolean;
}
/** Phaser.Filters.Glow, the field the probe moves. */
export interface GlowCtl extends FilterCtl {
  outerStrength: number;
}
/** A FilterList's internal half: the calls the probe makes. */
export interface FilterListLike {
  addGlow(
    color?: number,
    outerStrength?: number,
    innerStrength?: number,
    scale?: number,
    knockout?: boolean,
    quality?: number,
    distance?: number,
  ): GlowCtl;
  addGradientMap(config?: { ramp?: { colorStart: number; colorEnd: number } }): FilterCtl;
  remove(filter: FilterCtl, forceDestroy?: boolean): unknown;
}
/** A game object that can carry filters once enableFilters() has run. */
export interface GlowHost {
  enableFilters(): unknown;
  readonly filters: { readonly internal: FilterListLike } | null;
}
/** What the probe reads of one part's view: its sprite and its look. */
export interface GlowView {
  readonly img: GlowHost;
  readonly look: { readonly share: number | null; readonly dark: boolean };
}
/** A camera: its filters exist already. */
export interface MapHost {
  readonly filters: { readonly internal: FilterListLike };
}

/** The probe's hook section (`board.glow`). */
export interface GlowState {
  /** Live Glow filters now (at most GLOW_MAX). */
  glows: number;
  /** Live GradientMap filters now (at most 1). */
  gradientMaps: number;
  /** The parts glowing now, hottest first. */
  parts: string[];
}

interface GlowSlot {
  id: string | null;
  host: GlowHost | null;
  glow: GlowCtl | null;
}

/**
 * The adapter: `step` once a frame with the part views (after removed parts are swept), the board
 * clock in seconds, reduce flicker, the board camera, the rescue flag and whether the run is held.
 * Made once per scene.
 *
 * The rescue's GradientMap runs on the running board's time: the rescue's edge holds the run for
 * the crew's story scene (and pauses this scene, whose last drawn frame stays on screen under it),
 * so the window starts on the first frame the board runs with the rescue in, and the map is never
 * on while the run is held.
 */
export class GlowProbe {
  readonly state: GlowState = { glows: 0, gradientMaps: 0, parts: [] };
  private readonly ids: string[] = [];
  private readonly shares: (number | null)[] = [];
  private readonly dark: boolean[] = [];
  private n = 0;
  private readonly picks: string[] = [];
  private readonly pickShares: number[] = [];
  private readonly slots: GlowSlot[] = [];
  private views: ReadonlyMap<string, GlowView> | null = null;
  private map: FilterCtl | null = null;
  private mapHost: MapHost | null = null;
  /** The rescue has been seen on a running board (its GradientMap window started). */
  private rescueSeen = false;
  private rescuedAt: number | null = null;
  /** Running-board seconds: the board clock less the time the run was held (story scenes). */
  private up = 0;
  private lastT: number | null = null;

  constructor(readonly enabled: boolean = GLOW_PROBE_ON) {
    for (let i = 0; i < GLOW_MAX; i++) this.slots.push({ id: null, host: null, glow: null });
  }

  /** Bound once: gathers one view into the parallel arrays (Map.forEach, no iterator). */
  private readonly gather = (v: GlowView, id: string): void => {
    const i = this.n++;
    this.ids[i] = id;
    this.shares[i] = v.look.share;
    this.dark[i] = v.look.dark;
  };

  private slotOf(id: string): GlowSlot | null {
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].id === id) return this.slots[i];
    return null;
  }

  private freeSlot(): GlowSlot | null {
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].id === null) return this.slots[i];
    return null;
  }

  step(
    views: ReadonlyMap<string, GlowView>,
    t: number,
    calm: boolean,
    camera: MapHost,
    rescued: boolean,
    held = false,
  ): GlowState {
    if (!this.enabled) return this.state;
    const dt = this.lastT === null ? 0 : Math.min(Math.max(t - this.lastT, 0), 0.25);
    this.lastT = t;
    if (!held) this.up += dt;
    this.views = views;
    this.n = 0;
    views.forEach(this.gather);
    const picks = pickGlowsInto(this.picks, this.pickShares, this.ids, this.shares, this.dark, this.n);

    // Drop a slot whose sprite is gone (destroyed with its filters) or whose part cooled off.
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.id === null) continue;
      const v = views.get(s.id);
      if (!v || v.img !== s.host) this.clearSlot(s, false);
      else if (!picks.includes(s.id)) this.clearSlot(s, true);
    }
    // Give each new pick a free slot; every live slot takes its strength.
    for (let k = 0; k < picks.length; k++) {
      const id = picks[k];
      let slot = this.slotOf(id);
      if (slot === null) {
        slot = this.freeSlot();
        const v = views.get(id);
        if (slot === null || !v) continue;
        const host = v.img;
        if (!host.filters) host.enableFilters();
        if (!host.filters) continue; // no WebGL: no filters
        slot.id = id;
        slot.host = host;
        slot.glow = host.filters.internal.addGlow(GLOW_COLOUR, 2, 0, 1, false, GLOW_QUALITY, GLOW_DISTANCE);
      }
      slot.glow!.outerStrength = glowStrength(this.pickShares[k], t, calm);
    }

    // The rescue's GradientMap: from the first running frame with the rescue in, for
    // RESCUE_MAP_SECONDS of running board; never while held, never calm.
    if (!rescued) {
      this.rescueSeen = false;
      this.rescuedAt = null;
    } else if (!this.rescueSeen && !held) {
      this.rescueSeen = true;
      this.rescuedAt = this.up;
    }
    const mapOn = !held && rescueMapOn(this.up, this.rescuedAt, calm);
    if (mapOn && this.map === null) {
      this.mapHost = camera;
      this.map = camera.filters.internal.addGradientMap({ ramp: { ...RESCUE_MAP_RAMP } });
    } else if (!mapOn && this.map !== null) {
      this.mapHost?.filters.internal.remove(this.map);
      this.map = null;
      this.mapHost = null;
    }
    this.publish();
    return this.state;
  }

  /** Remove every filter the probe made (scene shutdown, while the sprites still stand). */
  clear(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.id !== null) this.clearSlot(s, this.views?.get(s.id)?.img === s.host);
    }
    if (this.map !== null) this.mapHost?.filters.internal.remove(this.map);
    this.map = null;
    this.mapHost = null;
    this.rescueSeen = false;
    this.rescuedAt = null;
    this.lastT = null;
    this.picks.length = 0;
    this.publish();
  }

  private clearSlot(s: GlowSlot, remove: boolean): void {
    if (remove && s.glow && s.host?.filters) s.host.filters.internal.remove(s.glow);
    s.id = null;
    s.host = null;
    s.glow = null;
  }

  /** Refill the hook state in place (the glowing parts hottest first, the live filter counts). */
  private publish(): void {
    const st = this.state;
    let n = 0;
    for (let k = 0; k < this.picks.length; k++) {
      const id = this.picks[k];
      if (this.slotOf(id) !== null) st.parts[n++] = id;
    }
    st.parts.length = n;
    let glows = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].glow !== null) glows++;
    st.glows = glows;
    st.gradientMaps = this.map !== null ? 1 : 0;
  }
}
