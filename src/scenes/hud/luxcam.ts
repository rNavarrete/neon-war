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

import { ART_REQUESTS, isPicked, requestFile } from '../../game/artManifest';
import { BROWNOUT } from '../../sim/brownout';
import type { Frame } from '../../game/frame';
import type { Occurrence } from '../../game/occurrences';
import { type Portrait, portraitOfFile } from '../../game/portraits';
import type { Point, Rect } from '../live/layout';
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
/**
 * Leaning (a drag or Regroup) lets go this long after the drag ends (bus drag {kind: null}) or
 * Regroup stops. It replaces luxcam-1's 0.8 s dwell from entry, so a drop always reads the same.
 */
export const CAM_LEAN_RELEASE = 0.5;
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

/** A CamView a view keeps and refills every frame (fillCamView), so a quiet frame allocates nothing. */
export type MutableCamView = { -readonly [K in keyof CamView]: CamView[K] };

/** A blank view at clock 0, for a view to keep and refill. */
export function emptyCamView(): MutableCamView {
  return {
    clock: 0,
    now: 0,
    paused: false,
    demand: 0,
    wiredCapacity: 0,
    errorShare: 0,
    surgeWarning: false,
    dipWarning: false,
    overheating: false,
    timeScale: 1,
    failure: false,
    rewinds: 0,
    rescued: false,
    midnightHeld: false,
    bannerBinned: false,
    dragging: false,
    luxSpeaking: false,
    actionAt: null,
    shockAt: null,
  };
}

/**
 * Write the view for one step into `out` (from the Frame, this frame's occurrences and the bus
 * facts) and return it. Allocates nothing: the per-frame form of camViewOf.
 */
export function fillCamView(
  out: MutableCamView,
  f: Frame,
  occurrences: readonly Occurrence[],
  extras: CamExtras,
  clock: number,
): MutableCamView {
  let shockAt = extras.shockAt;
  for (let i = 0; i < occurrences.length; i++) {
    const k = occurrences[i].kind;
    if (k === 'died' || k === 'dip') shockAt = clock;
  }
  out.clock = clock;
  out.now = f.now;
  out.paused = f.paused;
  out.demand = f.demand;
  out.wiredCapacity = f.wiredCapacity;
  out.errorShare = f.errorShare;
  out.surgeWarning = f.surge !== null;
  out.dipWarning = f.dip !== null;
  out.overheating = f.overheating.length > 0;
  out.timeScale = f.timeScale;
  out.failure = f.failure !== null;
  out.rewinds = f.rewinds.length;
  out.rescued = f.rescued;
  out.midnightHeld = f.midnight?.held === true;
  out.bannerBinned = f.banner?.choice === 'bin';
  out.dragging = extras.dragging;
  out.luxSpeaking = extras.luxSpeaking;
  out.actionAt = extras.actionAt;
  out.shockAt = shockAt;
  return out;
}

/** The view for one step, from the Frame, this frame's occurrences and the bus facts. Pure. */
export function camViewOf(
  f: Frame,
  occurrences: readonly Occurrence[],
  extras: CamExtras,
  clock: number,
): CamView {
  return fillCamView(emptyCamView(), f, occurrences, extras, clock);
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
  /** No reason to lean (no drag, no Regroup), since. */
  readonly leanOffSince: number | null;
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
    leanOffSince: clock,
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
  const leanOffSince = sinceOf(s.leanOffSince, !leanRaw, c);

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
  // Once leaning she lets go CAM_LEAN_RELEASE after the drag ends (a short drag still gets the 0.5 s
  // CAM_MIN_GAP); an action on the board (the drop that ended it) turns her focused at once instead.
  const leanStay = s.mood === 'leaning' && !acting && !held(leanOffSince, c, CAM_LEAN_RELEASE);
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
    leanOffSince === s.leanOffSince &&
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
    leanOffSince,
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
  /** Draw scale of `file` (CAM_FITS[file].scale): never over 1, so nothing upscales. */
  readonly scale: number;
  /** Seconds per breath (2 px up and down), slower when calm. */
  readonly breath: number;
}

/**
 * How one file sits in the 388x230 lens (luxcam-5). Measured by eye on each file, in texture pixels:
 * the head from the top of the hair to the chin, and the bottom of the NIRVANA print on her shirt.
 * The scale puts the head at 140 to 160 px on screen without ever going over 1; `top` is the texture
 * row drawn at the lens's top edge, chosen so the print stays in the lens through the breath and the
 * parallax (a few pixels of hair are trimmed where both cannot fit).
 */
export interface CamFit {
  readonly scale: number;
  /** Top of the hair and the chin, in texture rows. */
  readonly headTop: number;
  readonly chin: number;
  /** The texture row at the lens's top edge. */
  readonly top: number;
  /** The bottom row of the NIRVANA print that must stay in the lens, or null when none shows. */
  readonly keep: number | null;
}

/** The picked cam set (D7), by its requests, so the files are named once (in the manifest). */
const LEAN_IN = requestFile('chars/lux/cam/lean-in');
const RELIEVED = requestFile('chars/lux/cam/relieved');

/** The fit of every file the cam can draw (the moods' files and their fallbacks). */
export const CAM_FITS: Readonly<Record<string, CamFit>> = Object.freeze({
  'art/chars/lux/faces-board/deadpan.webp': { scale: 0.64, headTop: 10, chin: 245, top: 14, keep: 360 },
  'art/chars/lux/faces-board/determined.webp': { scale: 0.65, headTop: 10, chin: 235, top: 19, keep: 360 },
  'art/chars/lux/faces-board/tense.webp': { scale: 0.65, headTop: 10, chin: 240, top: 13, keep: 354 },
  'art/chars/lux/faces-board/shocked.webp': { scale: 0.64, headTop: 10, chin: 245, top: 12, keep: 358 },
  'art/chars/lux/faces-board/smirk.webp': { scale: 0.66, headTop: 20, chin: 240, top: 21, keep: 357 },
  'art/chars/lux/faces-board/triumphant.webp': { scale: 0.7, headTop: 25, chin: 240, top: 38, keep: 355 },
  'art/chars/lux/faces-room/exhausted.webp': { scale: 0.72, headTop: 12, chin: 215, top: 12, keep: null },
  'art/chars/lux/poses/goggles-up.webp': { scale: 1, headTop: 30, chin: 172, top: 52, keep: 274 },
  [LEAN_IN]: { scale: 0.5, headTop: 35, chin: 335, top: 48, keep: 492 },
  [RELIEVED]: { scale: 0.53, headTop: 0, chin: 268, top: 60, keep: 478 },
});

const NO_FIT: CamFit = Object.freeze({ scale: 0.42, headTop: 0, chin: 0, top: 0, keep: null });

/** A file's fit; a file without one is drawn at 0.42 from its top. */
export function camFit(file: string): CamFit {
  return CAM_FITS[file] ?? NO_FIT;
}

const scaleOf = (file: string): number => camFit(file).scale;

/** Every mood's art. leaning and relieved draw the picked cam set (D7), board faces as fallbacks. */
export const CAM_ART: Readonly<Record<CamMood, CamArt>> = Object.freeze({
  calm: {
    file: 'art/chars/lux/faces-board/deadpan.webp',
    fallback: null,
    scale: scaleOf('art/chars/lux/faces-board/deadpan.webp'),
    breath: 4,
  },
  focused: {
    file: 'art/chars/lux/faces-board/determined.webp',
    fallback: null,
    scale: scaleOf('art/chars/lux/faces-board/determined.webp'),
    breath: 3.2,
  },
  leaning: {
    file: LEAN_IN,
    fallback: 'art/chars/lux/faces-board/determined.webp',
    scale: scaleOf(LEAN_IN),
    breath: 3,
  },
  tense: {
    file: 'art/chars/lux/faces-board/tense.webp',
    fallback: null,
    scale: scaleOf('art/chars/lux/faces-board/tense.webp'),
    breath: 2.2,
  },
  panicking: {
    file: 'art/chars/lux/faces-board/shocked.webp',
    fallback: null,
    scale: scaleOf('art/chars/lux/faces-board/shocked.webp'),
    breath: 1.2,
  },
  relieved: {
    file: RELIEVED,
    fallback: 'art/chars/lux/faces-board/smirk.webp',
    scale: scaleOf(RELIEVED),
    breath: 4.5,
  },
  cheer: {
    file: 'art/chars/lux/faces-board/triumphant.webp',
    fallback: null,
    scale: scaleOf('art/chars/lux/faces-board/triumphant.webp'),
    breath: 1.8,
  },
  exhausted: {
    file: 'art/chars/lux/faces-room/exhausted.webp',
    fallback: null,
    scale: scaleOf('art/chars/lux/faces-room/exhausted.webp'),
    breath: 5,
  },
  gogglesUp: {
    file: 'art/chars/lux/poses/goggles-up.webp',
    fallback: null,
    scale: scaleOf('art/chars/lux/poses/goggles-up.webp'),
    breath: 4,
  },
});

/** The file a mood draws today: its own when `has` says it landed, else its fallback. */
export function camArtFile(mood: CamMood, has: (file: string) => boolean): string {
  const a = CAM_ART[mood];
  return a.fallback !== null && !has(a.file) ? a.fallback : a.file;
}

/**
 * Whether a cam file has landed, from the manifest alone (never a request that could 404): a file
 * the art pipeline was asked for counts once its request is picked; any other file is picked art.
 */
export function camFileLanded(file: string): boolean {
  for (const r of ART_REQUESTS) if (requestFile(r.key) === file) return isPicked(r);
  return true;
}

/** The texture key a mood draws today (the portrait key of its file, fallbacks applied). */
export function camTextureOf(mood: CamMood): string {
  return portraitOfFile(camArtFile(mood, camFileLanded)).key;
}

/** Every file the cam loads, once each, with the fallbacks applied: the nine moods' portraits. */
export function camPortraits(): Portrait[] {
  const out: Portrait[] = [];
  for (const mood of CAM_MOODS) {
    const p = portraitOfFile(camArtFile(mood, camFileLanded));
    if (!out.some((q) => q.key === p.key)) out.push(p);
  }
  return out;
}

/** The fit each mood draws today (its file, fallbacks applied), resolved once so a frame only looks it up. */
export const CAM_FIT: Readonly<Record<CamMood, CamFit>> = Object.freeze(
  Object.fromEntries(CAM_MOODS.map((m) => [m, camFit(camArtFile(m, camFileLanded))])) as Record<
    CamMood,
    CamFit
  >,
);

/** The REC badge (docs/ART-REQUESTS.md hud/live/rec-badge), drawn no bigger than its 72x24 display box. */
export const REC_BADGE_KEY = 'hud/live/rec-badge';
export const REC_BADGE_BOX = { w: 72, h: 24 } as const;
/** Where the badge's own lamp sits in it, as a share of its width and height: the REC dot goes there. */
export const REC_BADGE_LAMP = { x: 0.215, y: 0.5 } as const;

/** The largest scale that fits a tw x th texture in `box`, never over 1 (no upscaling). */
export function fitScale(tw: number, th: number, box: { readonly w: number; readonly h: number }): number {
  if (tw <= 0 || th <= 0) return 1;
  return Math.min(1, box.w / tw, box.h / th);
}

/** The backdrop the art pipeline will drop (docs/ART-REQUESTS.md); the dark bedroom until then. */
export const CAM_BACKDROP_KEY = 'hud/cam-backdrop';

// ---- the cam's geometry (inside ZONES.cam; pure) ----

/** The lens: the only place the face and the backdrop show. */
export const CAM_LENS = { w: 388, h: 230 } as const;
/** The strip above the lens that carries LUX_CAM, the REC dot and the talk bars. */
export const CAM_HEADER = 30;
/** How far the backdrop may slide with the pointer; it is drawn this much bigger on every side. */
export const CAM_PARALLAX = { x: 10, y: 8 } as const;
/** The face slides the other way, less. */
export const CAM_FACE_PARALLAX = { x: 3, y: 2 } as const;

export interface CamLayout {
  /** The zone itself: the plate. */
  readonly plate: Rect;
  readonly lens: Rect;
  /** Top-left of the LUX_CAM label, the REC dot's centre (the REC badge's lamp), top-left of the REC word. */
  readonly label: Point;
  readonly recDot: Point;
  readonly recText: Point;
  /** The three talk bars' bottom-centre points, and their full height and width. */
  readonly bars: readonly Point[];
  readonly barHeight: number;
  readonly barWidth: number;
}

/** The cam's pieces inside a zone: the lens centred across, under the header strip. */
export function camLayout(zone: Rect): CamLayout {
  const lens = {
    x: zone.x + Math.round((zone.w - CAM_LENS.w) / 2),
    y: zone.y + CAM_HEADER,
    w: CAM_LENS.w,
    h: CAM_LENS.h,
  };
  const mid = zone.y + CAM_HEADER / 2;
  const right = lens.x + lens.w;
  return {
    plate: zone,
    lens,
    label: { x: lens.x + 4, y: mid - 9 },
    recDot: { x: lens.x + 100, y: mid },
    // The REC word sits right of the badge (whose lamp is the REC dot), clear of its grille.
    recText: { x: lens.x + 156, y: mid - 9 },
    bars: [
      { x: right - 30, y: mid + 8 },
      { x: right - 20, y: mid + 8 },
      { x: right - 10, y: mid + 8 },
    ],
    barHeight: 16,
    barWidth: 5,
  };
}

/** A crop of a texture and the part of the screen it covers. Refilled in place by lensCrop. */
export interface LensCrop {
  /** The crop in texture pixels (what Image.setCrop takes). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The rect it shows on screen, in game pixels: always inside the lens; zero size when none. */
  readonly visible: { x: number; y: number; w: number; h: number };
}

export function emptyCrop(): LensCrop {
  return { x: 0, y: 0, w: 0, h: 0, visible: { x: 0, y: 0, w: 0, h: 0 } };
}

/**
 * Crop an image drawn top-left at (ix, iy), tw x th texture pixels at `scale`, to the lens: the crop
 * in texture pixels and the screen rect it covers. Writes `out` and returns it; allocates nothing.
 */
export function lensCrop(
  lens: Rect,
  ix: number,
  iy: number,
  tw: number,
  th: number,
  scale: number,
  out: LensCrop,
): LensCrop {
  const left = Math.max(lens.x, ix);
  const top = Math.max(lens.y, iy);
  const right = Math.min(lens.x + lens.w, ix + tw * scale);
  const bottom = Math.min(lens.y + lens.h, iy + th * scale);
  const v = out.visible;
  if (right <= left || bottom <= top || scale <= 0) {
    out.x = 0;
    out.y = 0;
    out.w = 0;
    out.h = 0;
    v.x = lens.x;
    v.y = lens.y;
    v.w = 0;
    v.h = 0;
    return out;
  }
  out.x = (left - ix) / scale;
  out.y = (top - iy) / scale;
  out.w = (right - left) / scale;
  out.h = (bottom - top) / scale;
  v.x = left;
  v.y = top;
  v.w = right - left;
  v.h = bottom - top;
  return out;
}

/** The scale at which a tw x th backdrop covers the lens plus the parallax margin on every side. */
export function backdropScale(tw: number, th: number): number {
  return Math.max((CAM_LENS.w + 2 * CAM_PARALLAX.x) / tw, (CAM_LENS.h + 2 * CAM_PARALLAX.y) / th);
}

/**
 * Where a face's top-left goes (written into `out`): centred across the lens, with the fit's `top`
 * row on the lens's top edge, so the head sits near the top and the print stays in. `dx`, `dy` are
 * the breath, shake and parallax offsets.
 */
export function placeFace(
  lens: Rect,
  tw: number,
  fit: CamFit,
  dx: number,
  dy: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  out.x = lens.x + (lens.w - tw * fit.scale) / 2 + dx;
  out.y = lens.y - fit.top * fit.scale + dy;
  return out;
}

// ---- the cam's motion (HUD clock; pure) ----

/** The REC dot blinks with this period (on for the first half) unless motion is reduced. */
export const REC_PERIOD = 1.2;
/** A mood change crossfades over this long. */
export const CAM_FADE = 0.22;
/** Entering panic shakes the face this long. */
export const CAM_SHAKE_TIME = 0.6;

/** Whether the REC dot shows at HUD clock `clock`: always under reduced motion, else 0.6 s on, 0.6 s off. */
export function recOn(clock: number, reduced: boolean): boolean {
  if (reduced) return true;
  const t = clock - Math.floor(clock / REC_PERIOD) * REC_PERIOD;
  return t < REC_PERIOD / 2 - EPS;
}

/** The incoming face's alpha `t` seconds into a crossfade (0 to 1). */
export function fadeAlpha(t: number): number {
  return t <= 0 ? 0 : t >= CAM_FADE ? 1 : t / CAM_FADE;
}

/** The face's vertical breath, 2 px up and down over the mood's breath period; still when reduced. */
export function breathY(clock: number, period: number, reduced: boolean): number {
  return reduced ? 0 : 2 * Math.sin((2 * Math.PI * clock) / period);
}

/** The panic shake's sideways offset `t` seconds after panic began; nothing when reduced or done. */
export function shakeX(t: number, reduced: boolean): number {
  if (reduced || t < 0 || t >= CAM_SHAKE_TIME) return 0;
  return 4 * Math.sin(t * 2 * Math.PI * 14) * (1 - t / CAM_SHAKE_TIME);
}

const STILL_TALK: readonly number[] = [0.7, 1, 0.8];

/** Talk bar `i`'s height (0 to 1) at `clock`: low and still when quiet, bouncing while she talks. */
export function talkLevel(i: number, clock: number, speaking: boolean, reduced: boolean): number {
  if (!speaking) return 0.25;
  if (reduced) return STILL_TALK[i] ?? 1;
  const v = 0.55 + 0.45 * Math.sin(clock * (9 + i * 3.7) + i * 1.9);
  return Math.max(0.2, Math.min(1, v));
}

// ---- the hook (hud.luxCam) ----

/** One mood change, as the hook keeps it: the mood and the HUD clock it began. */
export interface CamHistoryEntry {
  mood: CamMood;
  at: number;
}

/** How many mood changes the hook keeps. */
export const CAM_HISTORY = 12;

/** What the hook mirrors as hud.luxCam (rects in page CSS pixels). */
export interface LuxCamTestState {
  mood: CamMood;
  /** The texture key on the front face image (a portrait: key). */
  art: string;
  /** HUD clock the mood began. */
  since: number;
  /** Seconds of the current stress (tense or panicking), 0 when not stressed. */
  stressedFor: number;
  /** The REC dot is showing now. */
  rec: boolean;
  /** The lens frame's colour: red while panicking. */
  frame: 'amber' | 'red';
  /** A crossfade between two faces is running. */
  fading: boolean;
  /** Lux's line is on the band now (bus line.speaker, until its lineEnd). */
  speaking: boolean;
  /** A card or wire is in hand (bus drag). */
  dragging: boolean;
  /** 'reduced' with reduce flicker on: no blink, shake, breath, roll or parallax. */
  motion: 'full' | 'reduced';
  /** The last CAM_HISTORY mood changes, oldest first (the first entry is the cam's start). */
  history: CamHistoryEntry[];
  /** ZONES.cam, the lens, and what the face and the backdrop cover now (inside the lens), in page px. */
  zone: Rect;
  lens: Rect;
  face: Rect;
  backdrop: Rect;
}

declare module './hook' {
  interface HudTestState {
    /** Lux's cam (luxcam-2). */
    luxCam?: LuxCamTestState;
  }
}
