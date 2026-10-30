// The title cluster (ZONES.title) and the clock (ZONES.clock), as pure rules: what the LIVE dot
// says, the viewer count the chat lane last announced, when the chips turn red, how the dot pulses,
// and where every piece sits inside its zone. TitleView.ts draws what these return. No Phaser and no
// clock of its own: time comes in as a parameter, so every rule is unit-tested in node.

import { BROWNOUT } from '../../sim/brownout';
import type { Rect } from '../live/layout';
import type { Tip } from '../../sim/tips';
import { LINES, type LineId, line } from '../../strings';
import { VIEWER_HANDLES } from './chat';

// ---- the LIVE dot ----

/**
 * What the LIVE dot says: `waiting` while the clock waits for the player's build (C1's first server,
 * or the build behind the crew's balancer), `held` while anything holds the board still, otherwise
 * `live`.
 */
export type LiveDot = 'live' | 'waiting' | 'held';

/** What the dot reads from a frame of the run (src/game/frame.ts Frame has all three). */
export interface LiveInput {
  readonly paused: boolean;
  readonly waitingForFirstBuild: boolean;
  readonly waitingForCrewBuild: boolean;
}

export function liveState(f: LiveInput): LiveDot {
  if (f.waitingForFirstBuild || f.waitingForCrewBuild) return 'waiting';
  if (f.paused) return 'held';
  return 'live';
}

/** The word beside the dot, in the crew's words. */
export const LIVE_WORDS: Readonly<Record<LiveDot, string>> = {
  live: 'LIVE',
  waiting: 'waiting for your build',
  held: 'HELD',
};

/** How often the live dot pulses, per second. */
export const LIVE_PULSE_HZ = 0.6;

/**
 * The dot's alpha at HUD time `t` (seconds): a soft 0.6 Hz pulse while live, steady when `steady`
 * (reduce flicker, or the lite flag); full while waiting; dim while held.
 */
export function liveDotAlpha(dot: LiveDot, t: number, steady: boolean): number {
  if (dot === 'held') return 0.4;
  if (dot === 'waiting' || steady) return 1;
  return 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(2 * Math.PI * LIVE_PULSE_HZ * t));
}

// ---- WATCHING ----

/** The viewer count after an audience event: whole, and never under 0. */
export function watchingFrom(event: { readonly watching: number }): number {
  return Math.max(0, Math.round(event.watching));
}

/** The WATCHING words: no number before the first audience event. */
export function watchingText(watching: number | null): string {
  return watching === null ? 'WATCHING' : `WATCHING ${watching}`;
}

/** What the hook mirrors as hud.title. */
export interface TitleState {
  live: LiveDot;
  /** The last bus audience value, null before the first. */
  watching: number | null;
}

export function titleState(f: LiveInput, watching: number | null): TitleState {
  return { live: liveState(f), watching };
}

// ---- the chips and the clock ----

/** Trust as shown: whole points. */
export function shownTrust(trust: number): number {
  return Math.round(trust);
}

/** Shown trust turns red under the rescue line (30). */
export function trustRed(shown: number): boolean {
  return shown < BROWNOUT.rescue.trustBelow;
}

/** Credits as shown: whole credits, rounded down. */
export function shownCredits(credits: number): number {
  return Math.floor(credits);
}

/** Shown credits turn red when negative. */
export function creditsRed(shown: number): boolean {
  return shown < 0;
}

/** The countdown turns red from 23:59:30, thirty seconds before midnight. */
export const COUNTDOWN_RED_FROM = BROWNOUT.clock.midnight - 30;

export function countdownRed(now: number): boolean {
  return now >= COUNTDOWN_RED_FROM;
}

// ---- where the pieces sit ----

/** Nothing of the clock cluster is drawn right of this x: the pause button (1850, 52) is OverlayScene's. */
export const CLOCK_RIGHT_LIMIT = 1800;

export interface TitleLayout {
  /** The opaque plate behind the cluster: the whole zone. */
  readonly plate: Rect;
  /** Lux's face behind its amber ring: centre and radius. */
  readonly avatar: { readonly x: number; readonly y: number; readonly r: number };
  readonly name: { readonly x: number; readonly y: number };
  readonly dot: { readonly x: number; readonly y: number; readonly r: number };
  readonly liveWord: { readonly x: number; readonly y: number };
  readonly watching: { readonly x: number; readonly y: number };
  readonly trust: Rect;
  readonly credits: Rect;
}

/** The title cluster's pieces inside its zone's rect (ZONES.title, 440 x 100). */
export function titleLayout(z: Rect): TitleLayout {
  return {
    plate: { x: z.x, y: z.y, w: z.w, h: z.h },
    avatar: { x: z.x + 56, y: z.y + 50, r: 36 },
    name: { x: z.x + 106, y: z.y + 10 },
    dot: { x: z.x + 220, y: z.y + 24, r: 6 },
    liveWord: { x: z.x + 232, y: z.y + 24 },
    watching: { x: z.x + 106, y: z.y + 70 },
    trust: { x: z.x + 214, y: z.y + 52, w: 104, h: 36 },
    credits: { x: z.x + 326, y: z.y + 52, w: z.w - 334, h: 36 },
  };
}

export interface ClockLayout {
  /** The opaque plate behind the clock: the zone, cut at CLOCK_RIGHT_LIMIT. */
  readonly plate: Rect;
  readonly clock: { readonly x: number; readonly y: number };
  readonly countdown: { readonly x: number; readonly y: number };
  /** The clock icon, centre and size. */
  readonly icon: { readonly x: number; readonly y: number; readonly size: number };
}

/** The clock and the countdown inside their zone's rect (ZONES.clock), never past x 1800. */
export function clockLayout(z: Rect): ClockLayout {
  const right = Math.min(z.x + z.w, CLOCK_RIGHT_LIMIT);
  return {
    plate: { x: z.x, y: z.y, w: right - z.x, h: z.h },
    clock: { x: z.x + 16, y: z.y + 12 },
    countdown: { x: z.x + 18, y: z.y + 64 },
    icon: { x: right - 36, y: z.y + 36, size: 40 },
  };
}

// ---- viewer tips (src/sim/tips.ts): the Twitch-style alert and the credits pop ----

/** The tip alert, top-centre over the board's sky, clear of the alert band and the table. */
export const TIP_ALERT = {
  x: 980,
  y: 150,
  w: 560,
  h: 84,
  /** Seconds it slides in, holds and fades out. */
  inSeconds: 0.25,
  holdSeconds: 3,
  outSeconds: 0.35,
} as const;

/** The pop over the credits chip: changes at least this big in one frame (a tip, a buy, a refund). */
export const CREDIT_POP_MIN = 5;
/** Seconds the pop rises and fades. */
export const CREDIT_POP_SECONDS = 1.2;

const TIP_MESSAGES: readonly LineId[] = (Object.keys(LINES) as LineId[]).filter((id) =>
  id.startsWith('C1.tip.'),
);
/** The message a viewer bailing Lux out sends. */
const HELP_MESSAGE: LineId = 'C1.tip.07';

/** Who sent tip `n` and what it says: a stream regular, a message, the line the alert shows. */
export function tipAlertOf(tip: Pick<Tip, 'n' | 'amount' | 'kind'>): {
  who: string;
  line: string;
  message: string;
} {
  const who = VIEWER_HANDLES[(tip.n * 7 + 3) % VIEWER_HANDLES.length];
  const id = tip.kind === 'help' ? HELP_MESSAGE : TIP_MESSAGES[(tip.n * 5 + 1) % TIP_MESSAGES.length];
  return { who, line: `${who} tipped 💰 ${tip.amount}!`, message: line(id) };
}

/** The credits pop's words for a change of `delta` in one frame, or null for a drip of upkeep. */
export function creditPop(delta: number): string | null {
  const d = Math.round(delta);
  if (Math.abs(d) < CREDIT_POP_MIN) return null;
  return d > 0 ? `+${d}` : `${d}`;
}

/** The tip alert's alpha and y offset `age` seconds after it starts, or null once it has gone. */
export function tipAlertAt(age: number): { alpha: number; dy: number } | null {
  const { inSeconds, holdSeconds, outSeconds } = TIP_ALERT;
  if (age < 0 || age >= inSeconds + holdSeconds + outSeconds) return null;
  if (age < inSeconds) {
    const k = age / inSeconds;
    return { alpha: k, dy: -24 * (1 - k) };
  }
  if (age < inSeconds + holdSeconds) return { alpha: 1, dy: 0 };
  return { alpha: 1 - (age - inSeconds - holdSeconds) / outSeconds, dy: 0 };
}
