// Lux's cam (LUX_CAM, ZONES.cam): which face she shows, as a second encoding of the room-left bar.
// The only mood selector on the Live screen (docs/LIVE.md, contract hud.luxCam). Green on the bar is
// calm or focused, amber is tense, red is panicking; cheer only on a held midnight. The thresholds
// are the bar's own (thresholds.ts), so the face never contradicts the bar, and every entry holds
// 0.5 s so the gauge moves first.
//
// No-information rule: the cam only confirms what the screen already says. Its mood is a pure
// function of facts the hook already carries (Frame fields, the occurrences died and dip, the
// surge and dip warnings, timeScale, the drag, the midnight, the band line's speaker), so it never
// changes without one of those changing first. It prints no number and no mood word: the moods
// below are code ids.
//
// Pure: no Phaser, no clock. Time comes in as `clock` (the HUD clock, which stops while paused) and
// `now` (sim seconds). camStep returns the identical state object when nothing changes, so a view
// can compare by identity and allocate nothing on a quiet frame.

import { requestFile } from '../../game/artManifest';
import { BROWNOUT } from '../../sim/brownout';
import type { Frame } from '../../game/frame';
import type { Occurrence } from '../../game/occurrences';
import { HEADROOM_AMBER_FROM, HEADROOM_EXIT } from './thresholds';

/** The nine faces, as code ids (never drawn as words). */
export type CamMood =
  'calm' | 'focused' | 'leaning' | 'tense' | 'panicking' | 'relieved' | 'cheer' | 'exhausted' | 'gogglesUp';

export const CAM_MOODS: readonly CamMood[] = [
  'calm',
  'focused',
  'leaning',
  'tense',
  'panicking',
  'relieved',
  'cheer',
  'exhausted',
  'gogglesUp',
];

// ---- the numbers (docs/LIVE.md, 05-comms "Lux cam") ----

/** Every ladder entry waits this long, and the ladder never changes mood faster than this. */
export const CAM_ENTRY_HOLD = 0.5;
/** Minimum seconds between two ladder changes. */
export const CAM_MIN_GAP = 0.5;
/** Load from which the face focuses (under the amber line). */
export const CAM_FOCUS_FROM = 0.5;
/** A drop to calm waits this long after the last reason to focus. */
export const CAM_CALM_DROP = 1.5;
/** An action on the board keeps her focused this long. */
export const CAM_ACTION_FOCUS = 2.5;
/** Leaning (a drag or Regroup) stays at least this long once entered. */
export const CAM_LEAN_DWELL = 0.8;
/** Tense leaves only once no tense reason has held for this long and load is under HEADROOM_EXIT. */
export const CAM_TENSE_EXIT = 2;
/** Error share from which she panics (held CAM_ENTRY_HOLD). */
export const CAM_PANIC_FROM = 0.5;
/** Panic leaves only once error share has stayed under this for CAM_PANIC_EXIT. */
export const CAM_PANIC_CALM_UNDER = 0.25;
export const CAM_PANIC_EXIT = 2;
/** A server dying or a power dip starting shocks her into panic for this long. */
export const CAM_SHOCK = 2;
/** The beats, in seconds on the HUD clock. */
export const CAM_EXHAUSTED = 3;
export const CAM_RESCUE_RELIEF = 3;
export const CAM_STRESS_RELIEF = 3;
export const CAM_BIN_RELIEF = 2;
export const CAM_CHEER = 6;
/** Stress lasting this long earns a relieved beat when it ends. */
export const CAM_RELIEF_AFTER = 6;
/** Sim second from which the goggles go up and stay up: 3 s before the debrief (537). */
export const CAM_GOGGLES_AT = BROWNOUT.challenges.c8 - 3;

/** Float slack for holds stepped in whole frames. */
const EPS = 1e-9;

/**
 * What the cam reads on one step: the facts already in the hook, flattened to primitives so a view
 * can keep one object and refill it. `clock` is the HUD clock (seconds), `now` the sim clock.
 */
export interface CamView {
  readonly clock: number;
  readonly now: number;
  /** The board holds still: the cam freezes. */
  readonly paused: boolean;
  readonly demand: number;
  readonly wiredCapacity: number;
  readonly errorShare: number;
  /** A surge warning is on screen (Frame.surge). */
  readonly surgeWarning: boolean;
  /** A power-dip flicker is on screen (Frame.dip). */
  readonly dipWarning: boolean;
  /** Some server is over 100% and overheating (Frame.overheating, play.heat.overload). */
  readonly overheating: boolean;
  /** Frame.timeScale: under 1 while Regroup runs. */
  readonly timeScale: number;
  /** Frame.failure is set: the board froze on a failure. */
  readonly failure: boolean;
  /** Frame.rewinds.length. */
  readonly rewinds: number;
  readonly rescued: boolean;
  /** Frame.midnight?.held. */
  readonly midnightHeld: boolean;
  /** Frame.banner?.choice === 'bin'. */
  readonly bannerBinned: boolean;
  /** Bus drag with a kind (a card or a wire in hand). */
  readonly dragging: boolean;
  /** The band line on now is Lux's (bus line.speaker === 'Lux', until lineEnd). */
  readonly luxSpeaking: boolean;
  /** HUD clock of the last bus action, or null. */
  readonly actionAt: number | null;
  /** HUD clock of the last died or dip occurrence, or null. */
  readonly shockAt: number | null;
}

/** Facts of a step that are not in the Frame: the bus and the occurrence stream. */
export interface CamExtras {
  readonly dragging: boolean;
  readonly luxSpeaking: boolean;
  readonly actionAt: number | null;
  /** The previous view's shockAt, carried forward. */
  readonly shockAt: number | null;
}

export const NO_CAM_EXTRAS: CamExtras = Object.freeze({
  dragging: false,
  luxSpeaking: false,
  actionAt: null,
  shockAt: null,
});

/** The view for one step, from the Frame, this frame's occurrences and the bus facts. Pure. */
export function camViewOf(
  f: Frame,
  occurrences: readonly Occurrence[],
  extras: CamExtras,
  clock: number,
): CamView {
  let shockAt = extras.shockAt;
  for (const o of occurrences) if (o.kind === 'died' || o.kind === 'dip') shockAt = clock;
  return {
    clock,
    now: f.now,
    paused: f.paused,
    demand: f.demand,
    wiredCapacity: f.wiredCapacity,
    errorShare: f.errorShare,
    surgeWarning: f.surge !== null,
    dipWarning: f.dip !== null,
    overheating: f.overheating.length > 0,
    timeScale: f.timeScale,
    failure: f.failure !== null,
    rewinds: f.rewinds.length,
    rescued: f.rescued,
    midnightHeld: f.midnight?.held === true,
    bannerBinned: f.banner?.choice === 'bin',
    dragging: extras.dragging,
    luxSpeaking: extras.luxSpeaking,
    actionAt: extras.actionAt,
    shockAt,
  };
}

/** Load as the bar reads it: demand over wired capacity; anything coming with no wired box is over. */
export function camLoad(demand: number, wired: number): number {
  if (wired > 0) return demand / wired;
  return demand > 0 ? Infinity : 0;
}

/** A timed mood that pre-empts the ladder: exhausted, relieved, cheer. */
export interface CamBeat {
  readonly mood: CamMood;
  readonly until: number;
}

export interface CamState {
  readonly mood: CamMood;
  /** HUD clock the mood started. */
  readonly since: number;
  /** HUD clock the current stress (tense or panicking) began, or null when not stressed. */
  readonly stressSince: number | null;
  readonly beat: CamBeat | null;
  // Edge memory: the HUD clock each condition last became true (null while false).
  readonly errSince: number | null;
  readonly heavySince: number | null;
  readonly lowErrSince: number | null;
  readonly loadHighSince: number | null;
  readonly loadMidSince: number | null;
  readonly surgeSince: number | null;
  readonly dipSince: number | null;
  readonly hotSince: number | null;
  /** No tense reason and load under HEADROOM_EXIT, since. */
  readonly tenseQuietSince: number | null;
  /** No reason to focus or lean, since. */
  readonly focusOffSince: number | null;
  // Last seen facts, for the beats' edges.
  readonly rewinds: number;
  readonly rescued: boolean;
  readonly binned: boolean;
  readonly cheered: boolean;
  readonly goggles: boolean;
}

/** A fresh cam at HUD clock `clock`: calm, nothing remembered. */
export function initialCam(clock = 0, rewinds = 0): CamState {
  return {
    mood: 'calm',
    since: clock,
    stressSince: null,
    beat: null,
    errSince: null,
    heavySince: null,
    lowErrSince: clock,
    loadHighSince: null,
    loadMidSince: null,
    surgeSince: null,
    dipSince: null,
    hotSince: null,
    tenseQuietSince: clock,
    focusOffSince: clock,
    rewinds,
    rescued: false,
    binned: false,
    cheered: false,
    goggles: false,
  };
}

const sinceOf = (prev: number | null, on: boolean, clock: number): number | null =>
  on ? (prev ?? clock) : null;
const held = (since: number | null, clock: number, d: number): boolean =>
  since !== null && clock - since >= d - EPS;

const STRESS = (m: CamMood): boolean => m === 'tense' || m === 'panicking';

/**
 * One step of the cam. Returns `s` itself when no field would change; never mutates `s` or `v`.
 *
 * Order: gogglesUp (sticky from 537) > failure (panicking, cuts any beat) > a beat (exhausted 3 s
 * after a rewind, relieved 3 s on the rescue or after 6 s of stress, 2 s on binning the banner,
 * cheer 6 s once at a held midnight; a warning does not cut a beat) > the ladder: panicking, tense,
 * leaning, focused, calm, with the holds and hysteresis above.
 */
export function camStep(s: CamState, v: CamView): CamState {
  if (v.paused) return s;
  const c = v.clock;
  const load = camLoad(v.demand, v.wiredCapacity);

  // Edges.
  const errSince = sinceOf(s.errSince, v.errorShare > 0, c);
  const heavySince = sinceOf(s.heavySince, v.errorShare >= CAM_PANIC_FROM, c);
  const lowErrSince = sinceOf(s.lowErrSince, v.errorShare < CAM_PANIC_CALM_UNDER, c);
  const loadHighSince = sinceOf(s.loadHighSince, load >= HEADROOM_AMBER_FROM, c);
  const loadMidSince = sinceOf(s.loadMidSince, load >= CAM_FOCUS_FROM && load < HEADROOM_AMBER_FROM, c);
  const surgeSince = sinceOf(s.surgeSince, v.surgeWarning, c);
  const dipSince = sinceOf(s.dipSince, v.dipWarning, c);
  const hotSince = sinceOf(s.hotSince, v.overheating, c);
  const tenseRaw =
    v.errorShare > 0 || v.surgeWarning || v.dipWarning || v.overheating || load >= HEADROOM_EXIT;
  const tenseQuietSince = sinceOf(s.tenseQuietSince, !tenseRaw, c);
  const acting = v.actionAt !== null && c - v.actionAt < CAM_ACTION_FOCUS - EPS;
  const leanRaw = v.dragging || v.timeScale < 1;
  const focusRaw = leanRaw || acting || v.luxSpeaking || loadMidSince !== null;
  const focusOffSince = sinceOf(s.focusOffSince, !focusRaw, c);

  // Beats.
  let beat = s.beat;
  if (beat && c >= beat.until - EPS) beat = null;
  let cheered = s.cheered;
  if (v.rewinds > s.rewinds) beat = { mood: 'exhausted', until: c + CAM_EXHAUSTED };
  if (v.rescued && !s.rescued) beat = { mood: 'relieved', until: c + CAM_RESCUE_RELIEF };
  if (v.bannerBinned && !s.binned && !beat) beat = { mood: 'relieved', until: c + CAM_BIN_RELIEF };
  if (v.midnightHeld && !cheered) {
    beat = { mood: 'cheer', until: c + CAM_CHEER };
    cheered = true;
  }
  if (v.failure) beat = null;
  const goggles = s.goggles || v.now >= CAM_GOGGLES_AT - EPS;
  if (goggles) beat = null;

  // The ladder (what the bar says), with hysteresis against the current mood.
  const shocked = v.shockAt !== null && c - v.shockAt < CAM_SHOCK - EPS;
  const panicIn = v.failure || shocked || held(heavySince, c, CAM_ENTRY_HOLD);
  const wasPanic = s.mood === 'panicking';
  const panic = panicIn || (wasPanic && !held(lowErrSince, c, CAM_PANIC_EXIT));
  const tenseIn =
    held(errSince, c, CAM_ENTRY_HOLD) ||
    held(surgeSince, c, CAM_ENTRY_HOLD) ||
    held(dipSince, c, CAM_ENTRY_HOLD) ||
    held(hotSince, c, CAM_ENTRY_HOLD) ||
    held(loadHighSince, c, CAM_ENTRY_HOLD);
  const wasStressed = STRESS(s.mood);
  const tense = tenseIn || (wasStressed && !held(tenseQuietSince, c, CAM_TENSE_EXIT));
  const leanIn = leanRaw;
  const leanStay = s.mood === 'leaning' && c - s.since < CAM_LEAN_DWELL - EPS;
  const focusIn = acting || v.luxSpeaking || held(loadMidSince, c, CAM_ENTRY_HOLD);
  let ladder: CamMood;
  if (panic) ladder = 'panicking';
  else if (tense) ladder = 'tense';
  else if (leanIn || leanStay) ladder = 'leaning';
  else if (focusIn || !held(focusOffSince, c, CAM_CALM_DROP))
    ladder = s.mood === 'calm' && !focusIn ? 'calm' : 'focused';
  else ladder = 'calm';

  // Leaving 6 s or more of stress for the ladder's quiet side earns a relieved beat.
  if (!beat && !goggles && !v.failure && wasStressed && !STRESS(ladder) && s.stressSince !== null) {
    if (c - s.stressSince >= CAM_RELIEF_AFTER - EPS)
      beat = { mood: 'relieved', until: c + CAM_STRESS_RELIEF };
  }

  let mood: CamMood;
  if (goggles) mood = 'gogglesUp';
  else if (v.failure) mood = 'panicking';
  else if (beat) mood = beat.mood;
  else if (
    ladder !== s.mood &&
    s.beat === null &&
    c - s.since < CAM_MIN_GAP - EPS &&
    ladder !== 'panicking'
  ) {
    // Too soon after the last change: wait (a panic never waits).
    mood = s.mood;
  } else mood = ladder;

  const since = mood === s.mood ? s.since : c;
  const stressSince = STRESS(mood) ? (STRESS(s.mood) ? s.stressSince : c) : null;

  if (
    mood === s.mood &&
    since === s.since &&
    stressSince === s.stressSince &&
    beat === s.beat &&
    errSince === s.errSince &&
    heavySince === s.heavySince &&
    lowErrSince === s.lowErrSince &&
    loadHighSince === s.loadHighSince &&
    loadMidSince === s.loadMidSince &&
    surgeSince === s.surgeSince &&
    dipSince === s.dipSince &&
    hotSince === s.hotSince &&
    tenseQuietSince === s.tenseQuietSince &&
    focusOffSince === s.focusOffSince &&
    v.rewinds === s.rewinds &&
    v.rescued === s.rescued &&
    v.bannerBinned === s.binned &&
    cheered === s.cheered &&
    goggles === s.goggles
  ) {
    return s;
  }
  return {
    mood,
    since,
    stressSince,
    beat,
    errSince,
    heavySince,
    lowErrSince,
    loadHighSince,
    loadMidSince,
    surgeSince,
    dipSince,
    hotSince,
    tenseQuietSince,
    focusOffSince,
    rewinds: v.rewinds,
    rescued: v.rescued,
    binned: v.bannerBinned,
    cheered,
    goggles,
  };
}

/**
 * The discrete facts the mood may depend on, as one comparable string (test and hook use: it
 * allocates). Two views with the same key and the same clock give the same step.
 */
export function camFacts(v: CamView): string {
  const load = camLoad(v.demand, v.wiredCapacity);
  const band = load >= HEADROOM_AMBER_FROM ? 3 : load >= HEADROOM_EXIT ? 2 : load >= CAM_FOCUS_FROM ? 1 : 0;
  const err =
    v.errorShare >= CAM_PANIC_FROM ? 3 : v.errorShare >= CAM_PANIC_CALM_UNDER ? 2 : v.errorShare > 0 ? 1 : 0;
  return [
    band,
    err,
    v.surgeWarning,
    v.dipWarning,
    v.overheating,
    v.timeScale < 1,
    v.failure,
    v.rewinds,
    v.rescued,
    v.midnightHeld,
    v.bannerBinned,
    v.dragging,
    v.luxSpeaking,
    v.actionAt,
    v.shockAt,
    v.now >= CAM_GOGGLES_AT,
    v.paused,
  ].join('|');
}

// ---- the art table ----

/** One mood's art: the file it wants, the picked file standing in until it lands, and the draw. */
export interface CamArt {
  /** Path under public/, as the loader takes it. */
  readonly file: string;
  /** A picked file to draw while `file` has not landed (the cam set of batch 3), or null. */
  readonly fallback: string | null;
  /** Draw scale (the lens is 388x230; faces at about 0.42). */
  readonly scale: number;
  /** Which part of a tall image the lens shows: a face is centred, a full pose is cropped to its top. */
  readonly crop: 'centre' | 'top';
  /** Seconds per breath (2 px up and down), slower when calm. */
  readonly breath: number;
}

const FACE = 0.42;

/** Every mood's art. leaning and relieved ask for the cam set (D7) and fall back to board faces. */
export const CAM_ART: Readonly<Record<CamMood, CamArt>> = Object.freeze({
  calm: {
    file: 'art/chars/lux/faces-board/deadpan.webp',
    fallback: null,
    scale: FACE,
    crop: 'centre',
    breath: 4,
  },
  focused: {
    file: 'art/chars/lux/faces-board/determined.webp',
    fallback: null,
    scale: FACE,
    crop: 'centre',
    breath: 3.2,
  },
  leaning: {
    file: requestFile('chars/lux/cam/lean-in'),
    fallback: 'art/chars/lux/faces-board/determined.webp',
    scale: FACE,
    crop: 'centre',
    breath: 3,
  },
  tense: {
    file: 'art/chars/lux/faces-board/tense.webp',
    fallback: null,
    scale: FACE,
    crop: 'centre',
    breath: 2.2,
  },
  panicking: {
    file: 'art/chars/lux/faces-board/shocked.webp',
    fallback: null,
    scale: FACE,
    crop: 'centre',
    breath: 1.2,
  },
  relieved: {
    file: requestFile('chars/lux/cam/relieved'),
    fallback: 'art/chars/lux/faces-board/smirk.webp',
    scale: FACE,
    crop: 'centre',
    breath: 4.5,
  },
  cheer: {
    file: 'art/chars/lux/faces-board/triumphant.webp',
    fallback: null,
    scale: FACE,
    crop: 'centre',
    breath: 1.8,
  },
  exhausted: {
    file: 'art/chars/lux/faces-room/exhausted.webp',
    fallback: null,
    scale: FACE,
    crop: 'centre',
    breath: 5,
  },
  gogglesUp: {
    file: 'art/chars/lux/poses/goggles-up.webp',
    fallback: null,
    scale: FACE,
    crop: 'top',
    breath: 4,
  },
});

/** The file a mood draws today: its own when `has` says it landed, else its fallback. */
export function camArtFile(mood: CamMood, has: (file: string) => boolean): string {
  const a = CAM_ART[mood];
  return a.fallback !== null && !has(a.file) ? a.fallback : a.file;
}
