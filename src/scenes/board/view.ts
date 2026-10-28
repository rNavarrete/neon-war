// How a part looks this frame: its status (online, booting, rebooting, offline), its load as a
// share of capacity, which art to draw and the readout under it. Pure, from sim state.

import { type Part, capacityOf } from '../../sim/board';
import { BROWNOUT_RULES } from '../../sim/brownout';

export type PartStatus = 'online' | 'booting' | 'rebooting' | 'offline';

export interface PartLook {
  readonly status: PartStatus;
  /** Seconds until a booting or rebooting part is back; 0 otherwise. */
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
}

/** Load share at or past which a part shows hot. */
export const HOT_SHARE = 1;

/** A PartLook the board refills in place every frame, so drawing a part allocates nothing. */
export type MutablePartLook = { -readonly [K in keyof PartLook]: PartLook[K] };

/** A blank look to refill with partLookInto. */
export function emptyLook(): MutablePartLook {
  return { status: 'online', left: 0, load: 0, capacity: null, share: null, art: '', dark: false };
}

export function partLook(
  part: Part,
  load: number,
  offline: readonly string[],
  offlineUntil: Readonly<Record<string, number>>,
  now: number,
): PartLook {
  return partLookInto(emptyLook(), part, load, offline, offlineUntil, now);
}

/** partLook written into `out` and returned, so the board reuses one object per part every frame. */
export function partLookInto(
  out: MutablePartLook,
  part: Part,
  load: number,
  offline: readonly string[],
  offlineUntil: Readonly<Record<string, number>>,
  now: number,
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
    } else {
      status = 'offline';
    }
  }
  const hot = !isOff && share !== null && share > HOT_SHARE;
  // Booting and rebooting servers keep their art, darkened; a server dark for any other reason
  // (dead, or in a power dip once ENG-503 lands) shows the dead server.
  out.status = status;
  out.left = left;
  out.load = load;
  out.capacity = capacity;
  out.share = share;
  out.art = status === 'offline' && part.kind === 'server' ? 'server-dead' : artFor(part, hot);
  out.dark = isOff;
  return out;
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
