// The alert band (ZONES.alert) as pure rules: one alert at a time, picked by priority
//
//   dark > held > flicker > refresh > raid > forecast > fall > none
//
// from the Frame (the surge and fall forecasts, the dip warning, the failure, midnight, retries and
// the crew). The headline leads with the number and the words follow it ("250/s · NEIGHBOURS
// REROUTED HERE"); the cause is the sub-line, the challenge's own forecast (C<n>.warn.01) or flicker
// (C<n>.flicker.01) line, and in C6 the outage (C6.alert.dip) until the sizing is SET. RAID is only
// ever the tag in the well at the right end, never the headline. No word on the band is a debrief
// term (tests/hud-alerts.test.ts and tests/teaching.test.ts scan them).
//
// Pure: no Phaser, time comes in on the input. stepAlert refills one state in place and builds a
// string only when what it says changes, so the view allocates nothing on a quiet frame.

import { BROWNOUT } from '../../sim/brownout';
import type { FailureCause } from '../../sim/play';
import { type LineId, line } from '../../strings';
import type { Rect } from '../live/layout';
import { LABELS } from './labels';
import type { SurgeWarning } from './warnings';
import { dipWarningAt } from './warnings';

const C = BROWNOUT.challenges;
const MIDNIGHT = BROWNOUT.clock.midnight;

/** What the band shows, highest priority first. */
export type AlertKind = 'dark' | 'held' | 'flicker' | 'refresh' | 'raid' | 'forecast' | 'fall' | 'none';

/** Every kind in priority order: the first whose condition holds is shown. */
export const ALERT_PRIORITY: readonly AlertKind[] = [
  'dark',
  'held',
  'flicker',
  'refresh',
  'raid',
  'forecast',
  'fall',
  'none',
];

/** The band says the block "is refreshing" once retries have pushed demand up by this share. */
export const REFRESH_FROM = 0.05;

/** HELD stays up this long after midnight, then the fall forecast takes the band (00:00:05). */
export const HELD_SECONDS = 5;

/** The slide in, on a change of kind or of the headline's words, in seconds. */
export const SLIDE_SECONDS = 0.25;

/** How fast the hazard stripes scroll, in game px per second, and their period. */
export const STRIPE_SPEED = 20;
export const STRIPE_PERIOD = 24;

/** The part of the Frame the band reads (a Frame fits). */
export interface AlertInput {
  readonly now: number;
  readonly demand: number;
  readonly dropped: number;
  readonly retry: number;
  readonly rescued: boolean;
  readonly surge: SurgeWarning | null;
  readonly fall: { readonly demand: number } | null;
  readonly dip: { readonly partId: string; readonly at: number } | null;
  readonly failure: { readonly cause: FailureCause } | null;
  readonly midnight: { readonly held: boolean; readonly dropped: number } | null;
  readonly notes: { readonly sizing: number | null };
}

/** The band's state for one frame; also what the hook mirrors as hud.alert. */
export interface AlertState {
  kind: AlertKind;
  /** The words after the number (a C<n>.alert.* ui line), or null with nothing up. */
  title: LineId | null;
  /** The number the headline leads with. */
  number: number;
  /** What the number counts: req/s coming, or requests dropped. */
  unit: '/s' | 'dropped';
  /** "250/s · NEIGHBOURS REROUTED HERE": the number first, then the words. */
  headline: string;
  /** The sub-line's line (the cause), or null when there is none. */
  line: LineId | null;
  /** The sub-line's words. */
  sub: string;
  /** The chip at the right: "in 8s", "NOW", or empty. */
  chip: string;
  /** The tag in the well at the right end: RAID while the district surge runs, else null. */
  tag: string | null;
  /** Hazard stripes in the raid and dark states. */
  stripes: boolean;
  /** Whether the band (the flicker's sub-line) is drawn this frame: it flashes at 6 Hz, or stays steady. */
  lit: boolean;
  /** The flicker flashes (false under reduce flicker, and for every other kind). */
  flashing: boolean;
}

export function emptyAlert(): AlertState {
  return {
    kind: 'none',
    title: null,
    number: 0,
    unit: '/s',
    headline: '',
    line: null,
    sub: '',
    chip: '',
    tag: null,
    stripes: false,
    lit: true,
    flashing: false,
  };
}

/** Demand as the band prints it while it moves: to the nearest 5, so the number doesn't jitter. */
export function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

/** The district surge runs from c4 until the crew arrive (or c5). */
export function raidWindow(f: Pick<AlertInput, 'now' | 'rescued'>): boolean {
  return f.now >= C.c4 && f.now < C.c5 && !f.rescued;
}

/** Which kind the band shows for this input, by priority. */
export function alertKindOf(f: AlertInput): AlertKind {
  if (f.failure || (f.midnight && !f.midnight.held)) return 'dark';
  if (f.midnight?.held && f.now < MIDNIGHT + HELD_SECONDS) return 'held';
  if (f.dip && f.dip.at > f.now) return 'flicker';
  if (raidWindow(f)) return f.retry >= REFRESH_FROM ? 'refresh' : 'raid';
  if (f.surge) return 'forecast';
  if (f.fall) return 'fall';
  return 'none';
}

const FORECAST_TITLES: Readonly<Record<number, LineId>> = {
  [C.c3]: 'C3.alert.title',
  [C.c4]: 'C4.alert.title',
  [C.c6]: 'C6.alert.title',
};

/** The headline: the number first, then the words. */
export function headlineOf(number: number, unit: AlertState['unit'], title: LineId | null): string {
  if (title === null) return '';
  const n = unit === '/s' ? `${number}/s` : `${number} ${unit.toUpperCase()}`;
  return `${n} · ${line(title)}`;
}

/** The chip for seconds until something lands: "in 8s", or "NOW" once it has. */
export function chipFor(seconds: number): string {
  return seconds > 0 ? `in ${seconds}s` : 'NOW';
}

/**
 * Bring `out` in line with this frame, in place. Returns true when the kind, the headline's words or
 * the sub-line changed (the view slides the band in again and the bus hears of it); a new number
 * alone only rewrites the headline. Strings are rebuilt only when what they say changes.
 */
export function stepAlert(out: AlertState, f: AlertInput, reduceFlicker: boolean): boolean {
  const kind = alertKindOf(f);
  let title: LineId | null = null;
  let number = 0;
  let unit: AlertState['unit'] = '/s';
  let sub: LineId | null = null;
  let chipSeconds = -1;
  let lit = true;
  let flashing = false;
  const raid = raidWindow(f);

  switch (kind) {
    case 'dark': {
      const atMidnight = (f.midnight && !f.midnight.held) || f.failure?.cause === 'dark-at-midnight';
      title = atMidnight ? 'C6.alert.dark' : 'C3.alert.down';
      sub = atMidnight ? 'C6.warn.01' : null;
      if (f.midnight && !f.midnight.held) {
        number = Math.round(f.midnight.dropped);
        unit = 'dropped';
      } else {
        number = Math.round(f.dropped);
      }
      break;
    }
    case 'held':
      title = 'C6.alert.held';
      number = Math.round(f.midnight?.dropped ?? 0);
      unit = 'dropped';
      // The job card's bar, met: nobody went dark.
      sub = 'C1.card.bar';
      break;
    case 'flicker': {
      const early = f.now < C.c5;
      title = early ? 'C4.alert.title' : 'C6.alert.title';
      number = round5(f.demand);
      sub = early ? 'C4.flicker.01' : 'C6.flicker.01';
      chipSeconds = Math.max(0, Math.ceil((f.dip?.at ?? f.now) - f.now));
      const w = dipWarningAt(f.dip, f.now, reduceFlicker);
      lit = w?.lit ?? true;
      flashing = w?.flashing ?? false;
      break;
    }
    case 'refresh':
    case 'raid':
      title = 'C4.alert.title';
      number = round5(f.demand);
      sub = kind === 'refresh' ? 'C4.alert.refresh' : 'C4.warn.01';
      break;
    case 'forecast': {
      const s = f.surge;
      if (!s) break;
      title = FORECAST_TITLES[s.surge.startsAt] ?? 'C3.alert.title';
      number = s.surge.demand;
      // GAME.md's own C6 forecast names the outage: the sub-line says so until the sizing is SET.
      sub = s.surge.startsAt === C.c6 && f.notes.sizing === null ? 'C6.alert.dip' : s.line;
      chipSeconds = s.inSeconds;
      break;
    }
    case 'fall':
      title = 'C7.alert.title';
      number = f.fall?.demand ?? 0;
      sub = 'C7.warn.01';
      break;
    case 'none':
      break;
  }

  const changed = kind !== out.kind || title !== out.title || sub !== out.line;
  if (changed || number !== out.number || unit !== out.unit) {
    out.headline = headlineOf(number, unit, title);
  }
  if (sub !== out.line) out.sub = sub === null ? '' : line(sub);
  const chip = chipSeconds < 0 ? '' : chipFor(chipSeconds);
  if (chip !== out.chip) out.chip = chip;
  out.kind = kind;
  out.title = title;
  out.number = number;
  out.unit = unit;
  out.line = sub;
  out.tag = raid && kind !== 'none' && kind !== 'dark' ? LABELS.alert.raidTag : null;
  out.stripes = kind === 'dark' || ((kind === 'raid' || kind === 'refresh' || kind === 'flicker') && raid);
  out.lit = lit;
  out.flashing = flashing;
  return changed;
}

/** A fresh state for one input (tests; the view refills one state in place). */
export function alertAt(f: AlertInput, reduceFlicker: boolean): AlertState {
  const out = emptyAlert();
  stepAlert(out, f, reduceFlicker);
  return out;
}

// ---- motion: the slide, the stripes and the flash, all steady under reduce flicker ----

export interface AlertMotion {
  /** Slide in from above on a change. */
  readonly slide: boolean;
  /** Scroll the hazard stripes. */
  readonly stripes: boolean;
  /** Flash the flicker at 6 Hz. */
  readonly flash: boolean;
}

const MOVING: AlertMotion = Object.freeze({ slide: true, stripes: true, flash: true });
const STEADY: AlertMotion = Object.freeze({ slide: false, stripes: false, flash: false });

/** What moves on the band: nothing under reduce flicker (or the ?test lite flag). */
export function alertMotion(steady: boolean): AlertMotion {
  return steady ? STEADY : MOVING;
}

/**
 * How far above its place the band sits `elapsed` seconds into a slide: from a full plate height
 * (y -84 for the 84 px band at y 8) to 0 over 250 ms, easing out. Always 0 without the slide.
 */
export function slideOffset(elapsed: number, rect: Rect, motion: AlertMotion): number {
  if (!motion.slide || elapsed >= SLIDE_SECONDS) return 0;
  const t = Math.max(0, elapsed) / SLIDE_SECONDS;
  const ease = 1 - (1 - t) * (1 - t);
  return -(rect.y + rect.h) * (1 - ease);
}

/** The stripes' scroll at HUD time `t`: 20 px/s, wrapped to one period; 0 when they don't move. */
export function stripeScroll(t: number, motion: AlertMotion): number {
  if (!motion.stripes) return 0;
  const x = (t * STRIPE_SPEED) % STRIPE_PERIOD;
  return x < 0 ? x + STRIPE_PERIOD : x;
}

// ---- the bus and the sound ----

/** The sound on entering a kind: the surge warning for a new forecast or the raid, nothing else. */
export function alertSound(prev: AlertKind, next: AlertKind): 'surge-warning' | null {
  if (next === prev) return null;
  if (next === 'raid' && prev !== 'refresh' && prev !== 'flicker') return 'surge-warning';
  if (next === 'forecast') return 'surge-warning';
  return null;
}

// ---- where things sit on the band ----

export interface AlertLayout {
  readonly plate: Rect;
  /** The warning icon's centre and size. */
  readonly icon: { readonly x: number; readonly y: number; readonly size: number };
  readonly headline: { readonly x: number; readonly y: number; readonly w: number };
  readonly sub: { readonly x: number; readonly y: number; readonly w: number };
  /** The chip, right-aligned to `right`, centred on `y`. */
  readonly chip: { readonly right: number; readonly y: number };
  /** The hazard end cap, which is also the tag well. */
  readonly well: Rect;
}

/** The band inside ZONES.alert: headline from (540, 16), the chip left of the 120 px end cap. */
export function alertLayout(z: Rect): AlertLayout {
  const well = { x: z.x + z.w - 120, y: z.y, w: 120, h: z.h };
  return {
    plate: z,
    // Right of the plate's painted hazard end (hud/live/alert-plate), left of the headline.
    icon: { x: z.x + 64, y: z.y + z.h / 2, size: 26 },
    headline: { x: z.x + 80, y: z.y + 8, w: well.x - 16 - (z.x + 80) - 150 },
    sub: { x: z.x + 80, y: z.y + 48, w: well.x - 16 - (z.x + 80) },
    chip: { right: well.x - 14, y: z.y + 26 },
    well,
  };
}
