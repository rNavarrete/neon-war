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

export function partLook(
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
  const art = status === 'offline' && part.kind === 'server' ? 'server-dead' : artFor(part, hot);
  return { status, left, load, capacity, share, art, dark: isOff };
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
