// Edges between two consecutive Frames: what just happened on the board, as a list the HUD emits on
// the bus ('occurrence') and hands every view each frame. Pure and deterministic: the same two
// frames always give the same list, identical frames give none. Views react to occurrences instead
// of diffing the sim themselves.

import { wireKey } from '../sim/board';
import type { Frame } from './frame';

export type OccurrenceKind =
  /** A part was placed (or a dead server replaced); id is the part. */
  | 'placed'
  /** A wire was connected; id is its key (from>to). */
  | 'wired'
  /** A wire was cut (by the player, a decommission or a rewind); id is its key. */
  | 'cut'
  /** A server went over 100% load and started to overheat; id is the server. */
  | 'hot'
  /** A server died from overheating; id is the server. */
  | 'died'
  /** A power dip's 2 s flicker warning started; id is the part it will take. */
  | 'dip'
  /** The balancer's health check skipped a wire whose target is offline; id is the wire key. */
  | 'skipped'
  /** Retries started pushing demand up from zero. */
  | 'retriesRising'
  /** The laundry floor was cut loose. */
  | 'laundryCut'
  /** The crew arrived. */
  | 'rescued'
  /** Midnight struck and the block held. */
  | 'held'
  /** With an id: that part went dark in a power dip. Without one: the block went dark at midnight. */
  | 'dark'
  /** The after-midnight fall forecast came on. */
  | 'fall';

export interface Occurrence {
  readonly kind: OccurrenceKind;
  readonly id?: string;
  /** Sim seconds (the frame's `now`) it was seen. */
  readonly at: number;
}

export const OCCURRENCE_KINDS: readonly OccurrenceKind[] = [
  'placed',
  'wired',
  'cut',
  'hot',
  'died',
  'dip',
  'skipped',
  'retriesRising',
  'laundryCut',
  'rescued',
  'held',
  'dark',
  'fall',
];

/** The shared empty list, for a frame with nothing new. */
export const NO_OCCURRENCES: readonly Occurrence[] = Object.freeze([]);

/**
 * Everything that happened between `prev` and `next`, in a fixed order (parts, wires, heat, dips,
 * routing, then the session's beats). With no previous frame there is nothing to compare, so the
 * list is empty. `out` is reused when given (the HUD passes its one array each frame); otherwise a
 * fresh array comes back.
 */
export function detectOccurrences(
  prev: Frame | null,
  next: Frame,
  out?: Occurrence[],
): readonly Occurrence[] {
  const list = out ?? [];
  list.length = 0;
  if (prev === null || prev === next) return out ? list : NO_OCCURRENCES;
  const at = next.now;

  if (prev.parts !== next.parts) {
    for (const p of next.parts) {
      if (!prev.parts.some((q) => q.id === p.id)) list.push({ kind: 'placed', id: p.id, at });
    }
  }
  if (prev.wires !== next.wires) {
    for (const w of next.wires) {
      if (!prev.wires.some((v) => v.from === w.from && v.to === w.to)) {
        list.push({ kind: 'wired', id: wireKey(w), at });
      }
    }
    for (const w of prev.wires) {
      if (!next.wires.some((v) => v.from === w.from && v.to === w.to)) {
        list.push({ kind: 'cut', id: wireKey(w), at });
      }
    }
  }
  pushAdded(list, 'hot', prev.overheating, next.overheating, at);
  pushAdded(list, 'died', prev.dead, next.dead, at);
  if (next.dip && (!prev.dip || prev.dip.partId !== next.dip.partId || prev.dip.at !== next.dip.at)) {
    list.push({ kind: 'dip', id: next.dip.partId, at });
  }
  pushAdded(list, 'skipped', prev.flow.skipped, next.flow.skipped, at);
  if (prev.retry <= 0 && next.retry > 0) list.push({ kind: 'retriesRising', at });
  if (!prev.laundryCut && next.laundryCut) list.push({ kind: 'laundryCut', at });
  if (!prev.rescued && next.rescued) list.push({ kind: 'rescued', at });
  if (!prev.midnight && next.midnight)
    list.push(next.midnight.held ? { kind: 'held', at } : { kind: 'dark', at });
  pushAdded(list, 'dark', prev.dark, next.dark, at);
  if (!prev.fall && next.fall) list.push({ kind: 'fall', at });
  return list;
}

/** One occurrence of `kind` for each id in `next` that is not in `prev`. Identical arrays are skipped at once. */
function pushAdded(
  list: Occurrence[],
  kind: OccurrenceKind,
  prev: readonly string[],
  next: readonly string[],
  at: number,
): void {
  if (prev === next) return;
  for (const id of next) if (!prev.includes(id)) list.push({ kind, id, at });
}
