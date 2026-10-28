// How a part looks this frame: its status (online, booting, rebooting, dark in a dip, dead, or
// offline when nothing says why), its load as a share of capacity, which art to draw, the readout
// under it, and (board-5) its load bar, its DIES IN and DARK countdowns, whether it is UNFED and
// whether it wears the warning triangle. Pure, from sim state; time comes in as `now`.

import { type Part, capacityOf } from '../../sim/board';
import { BROWNOUT, BROWNOUT_RULES } from '../../sim/brownout';
import type { PowerDip } from '../../sim/failures';
import { LABELS, diesIn as diesInLabel } from '../hud/labels';
import { type PartArtOptions, stateArt } from './art';

export type PartStatus = 'online' | 'booting' | 'rebooting' | 'offline' | 'dark' | 'dead';

/** The tags a part wears on the feed (the lead's enum, contract 'board.parts[].tags'). */
export type PartTag = 'UNFED' | 'BOOTING' | 'SKIPPED' | 'DARK' | 'DIES IN';

/** The load bar's colour: cyan with room, amber near the limit, red over it, grey when it serves nothing. */
export type BarColour = 'cyan' | 'amber' | 'red' | 'grey';

/**
 * What tells a dark part from a dead one, and how long an overloaded server has left: the Frame's
 * dead and dark lists and its dips, and the sim's overload seconds. Without it a part that is
 * offline for no boot reads 'offline', as it did before board-5.
 */
export interface PartTrouble {
  readonly dead: readonly string[];
  readonly dark: readonly string[];
  readonly dips: readonly PowerDip[];
  /** Seconds each server has been over 100% in a row (play.heat.overload). */
  readonly overload: Readonly<Record<string, number>>;
}

export interface PartLook {
  readonly status: PartStatus;
  /** Seconds until a booting or rebooting part is back, or a dark one comes back on; 0 otherwise. */
  readonly left: number;
  /** Req/s arriving at the part. */
  readonly load: number;
  /** Req/s the part can serve, or null for parts with no limit (the gateway). */
  readonly capacity: number | null;
  /** load ÷ capacity, or null when the part has no limit. */
  readonly share: number | null;
  /** Texture key to draw. */
  readonly art: string;
  /** True when the art should be darkened (the part is offline). */
  readonly dark: boolean;
  /** Seconds until an overloaded server cooks (8 less its seconds over 100%); 0 once dead; else null. */
  readonly diesIn: number | null;
  /** Seconds until a part dark in a power dip comes back on; null when it is not dark. */
  readonly darkLeft: number | null;
  /** An online server nothing reaches: no load at all. */
  readonly unfed: boolean;
  /** Wears the warning triangle: a server over 100% or dark in a dip; the database only over 200 (D2). */
  readonly warning: boolean;
  /** The load bar, 0..1: load / capacity while online, boot progress while booting, else 0. */
  readonly bar: number;
  readonly barColour: BarColour;
}

/** Load share at or past which a part shows hot. */
export const HOT_SHARE = 1;

/** A PartLook the board refills in place every frame, so drawing a part allocates nothing. */
export type MutablePartLook = { -readonly [K in keyof PartLook]: PartLook[K] };

/** A blank look to refill with partLookInto. */
export function emptyLook(): MutablePartLook {
  return {
    status: 'online',
    left: 0,
    load: 0,
    capacity: null,
    share: null,
    art: '',
    dark: false,
    diesIn: null,
    darkLeft: null,
    unfed: false,
    warning: false,
    bar: 0,
    barColour: 'grey',
  };
}

export function partLook(
  part: Part,
  load: number,
  offline: readonly string[],
  offlineUntil: Readonly<Record<string, number>>,
  now: number,
  trouble?: PartTrouble,
  art?: PartArtOptions,
): PartLook {
  return partLookInto(emptyLook(), part, load, offline, offlineUntil, now, trouble, art);
}

/**
 * partLook written into `out` and returned, so the board reuses one object per part every frame.
 * With `art` (board-12) the art is the part state's picked art (src/scenes/board/art.ts stateArt):
 * the unlit server while dark or rebooting, the boot lamp frames, the balancer's ping frames.
 * Without it the look is exactly what it was before board-12.
 */
export function partLookInto(
  out: MutablePartLook,
  part: Part,
  load: number,
  offline: readonly string[],
  offlineUntil: Readonly<Record<string, number>>,
  now: number,
  trouble?: PartTrouble,
  art?: PartArtOptions,
): PartLook {
  const cap = capacityOf(part, BROWNOUT_RULES);
  const capacity = Number.isFinite(cap) ? cap : null;
  const share = capacity ? load / capacity : null;
  const isOff = offline.includes(part.id);
  const until = offlineUntil[part.id];
  let status: PartStatus = 'online';
  let left = 0;
  if (isOff) {
    if (until !== undefined && until > now) {
      status = part.boost !== undefined ? 'rebooting' : 'booting';
      left = until - now;
    } else if (trouble && trouble.dead.includes(part.id)) {
      status = 'dead';
    } else if (trouble && trouble.dark.includes(part.id)) {
      status = 'dark';
      left = darkSecondsLeft(trouble.dips, part.id, now);
    } else {
      status = 'offline';
    }
  }
  const hot = !isOff && share !== null && share > HOT_SHARE;
  // Booting, rebooting and dark servers keep their art, darkened; with `art` they show the picked
  // unlit and boot-lamp art (board-12). A dead server, or one offline for no reason the board
  // knows, shows the dead server.
  out.status = status;
  out.left = left;
  out.load = load;
  out.capacity = capacity;
  out.share = share;
  out.art =
    (status === 'offline' || status === 'dead') && part.kind === 'server' ? 'server-dead' : artFor(part, hot);
  if (art) out.art = stateArt(part, status, out.art, art);
  out.dark = isOff;
  const over = trouble?.overload[part.id];
  out.diesIn =
    status === 'dead'
      ? 0
      : status === 'online' && over !== undefined
        ? Math.max(0, BROWNOUT.overheat.overloadSeconds - over)
        : null;
  out.darkLeft = status === 'dark' ? left : null;
  out.unfed = part.kind === 'server' && status === 'online' && !(load > 0);
  out.warning =
    (part.kind === 'server' && (status === 'dark' || hot)) ||
    (part.kind === 'database' && load > BROWNOUT.database.capacity);
  if (status === 'booting' || status === 'rebooting') {
    const total = status === 'booting' ? BROWNOUT.server.bootSeconds : BROWNOUT.overclock.rebootSeconds;
    out.bar = Math.max(0, Math.min(1, 1 - left / total));
    out.barColour = 'cyan';
  } else if (status === 'online' && share !== null) {
    out.bar = Math.max(0, Math.min(1, share));
    out.barColour = share < 0.8 ? 'cyan' : share <= HOT_SHARE ? 'amber' : 'red';
  } else {
    out.bar = 0;
    out.barColour = 'grey';
  }
  return out;
}

/** Seconds until the dip that has `id` dark ends, from the dips; 0 when none does. */
function darkSecondsLeft(dips: readonly PowerDip[], id: string, now: number): number {
  for (let i = 0; i < dips.length; i++) {
    const d = dips[i];
    if (d.part === id && d.darkAt <= now && now < d.endsAt) return d.endsAt - now;
  }
  return 0;
}

/**
 * The tags a part wears this frame, in the order the chip shows them (the first is drawn): DIES IN,
 * DARK, SKIPPED (scene-side, sticky 1 s: `skipped`), UNFED, BOOTING.
 */
export function partTags(look: PartLook, skipped: boolean): PartTag[] {
  const tags: PartTag[] = [];
  if (look.diesIn !== null && look.status === 'online') tags.push('DIES IN');
  if (look.status === 'dark') tags.push('DARK');
  if (skipped) tags.push('SKIPPED');
  if (look.unfed) tags.push('UNFED');
  if (look.status === 'booting' || look.status === 'rebooting') tags.push('BOOTING');
  return tags;
}

/**
 * The chip drawn on a part: DIES IN with its seconds, or UNFED; null otherwise. The readout above
 * the part already counts BOOTING and DARK down, and SKIPPED sits on the pad.
 */
export function tagChip(look: PartLook): string | null {
  if (look.diesIn !== null && look.status === 'online') return diesInLabel(look.diesIn);
  if (look.unfed) return LABELS.partTags.unfed;
  return null;
}

/** A number that changes exactly when tagChip's text would: the chip's kind and its whole seconds. */
export function tagChipKey(look: PartLook): number {
  if (look.diesIn !== null && look.status === 'online') return 1000 + Math.max(0, Math.ceil(look.diesIn));
  if (look.unfed) return 1;
  return 0;
}

/** How long the SKIPPED tag stays on a pad after the skip clears, in seconds. */
export const SKIP_TAG_HOLD = 1;

/**
 * The SKIPPED tag's sticky end on a pad: while the balancer skips the box on it the end keeps
 * moving to now + SKIP_TAG_HOLD; once the skip clears it stays where it was, so the tag lingers at
 * least SKIP_TAG_HOLD seconds. View-only (rule_changes): the sim's skip is not sticky.
 */
export function skipTagUntil(prevUntil: number, skippedNow: boolean, now: number): number {
  return skippedNow ? now + SKIP_TAG_HOLD : prevUntil;
}

/** The power-flicker blink: 6 Hz, lit on even half-periods; always lit under reduce flicker. */
export const FLICKER_HZ = 6;

export function flickerLit(flickering: boolean, t: number, reduceFlicker: boolean): boolean {
  if (!flickering || reduceFlicker) return true;
  return Math.floor(t * FLICKER_HZ * 2) % 2 === 0;
}

/** Texture key for a part: the overclocked server when boosted, the hot art when over capacity. */
export function artFor(part: Pick<Part, 'kind' | 'boost'>, hot: boolean): string {
  switch (part.kind) {
    case 'server':
      if (part.boost !== undefined) return hot ? 'server-overclocked-hot' : 'server-overclocked';
      return hot ? 'server-hot' : 'server';
    case 'database':
      return hot ? 'database-hot' : 'database';
    default:
      return part.kind;
  }
}

/** The readout drawn under a part. */
export function loadLabel(look: PartLook): string {
  if (look.status === 'booting') return `BOOTING ${look.left.toFixed(1)}s`;
  if (look.status === 'rebooting') return `REBOOTING ${look.left.toFixed(1)}s`;
  if (look.status === 'dark') return `${LABELS.partTags.dark} ${Math.max(0, Math.ceil(look.left))} s`;
  if (look.status === 'dead') return LABELS.partTags.dead;
  if (look.status === 'offline') return 'OFFLINE';
  const load = Math.round(look.load);
  if (look.capacity === null || look.share === null) return `${load} req/s`;
  return `${load}/${look.capacity} · ${Math.round(look.share * 100)}%`;
}

/** Colour of the readout: cyan with headroom, amber near the limit, red over it, grey when offline. */
export function loadColour(look: PartLook): string {
  if (look.status !== 'online') return '#8a93a6';
  if (look.share === null || look.share < 0.8) return '#2de2e6';
  return look.share <= HOT_SHARE ? '#ffb02e' : '#ff4d5e';
}

/** Which colour band loadColour puts an online part's share in: 0 cyan, 1 amber, 2 red. */
function colourBand(share: number | null): number {
  if (share === null || share < 0.8) return 0;
  return share <= HOT_SHARE ? 1 : 2;
}

/**
 * A part's readout text and colour, rebuilt only when something they show changes: the status, the
 * tenth of a second left, the whole req/s, the capacity, the whole percent or the colour band.
 * Steady frames build no strings.
 */
export class LabelCache {
  text = '';
  colour = '';
  private status: PartStatus | '' = '';
  private tenths = NaN;
  private load = NaN;
  private capacity: number | null | undefined = undefined;
  private percent = NaN;
  private band = -1;

  /** Bring text and colour in line with `look`; true when either changed. */
  update(look: PartLook): boolean {
    const tenths = Math.round(look.left * 10);
    const load = Math.round(look.load);
    const percent = look.share === null ? -1 : Math.round(look.share * 100);
    const band = colourBand(look.share);
    if (
      look.status === this.status &&
      tenths === this.tenths &&
      load === this.load &&
      look.capacity === this.capacity &&
      percent === this.percent &&
      band === this.band
    ) {
      return false;
    }
    this.status = look.status;
    this.tenths = tenths;
    this.load = load;
    this.capacity = look.capacity;
    this.percent = percent;
    this.band = band;
    const text = loadLabel(look);
    const colour = loadColour(look);
    const changed = text !== this.text || colour !== this.colour;
    this.text = text;
    this.colour = colour;
    return changed;
  }
}
