// Bark scheduling: barks queue and each one shows for about 4 s, one at a time. Pure: the state is
// plain data and every step returns a new state (or the same one when nothing changed). Time is
// the HUD's bark clock in seconds, passed in.

import type { LineId } from '../../strings';

export const BARK_SECONDS = 4;
/** Barks waiting past this many are stale by the time they'd show: the oldest waiting one drops. */
export const BARK_QUEUE_MAX = 5;
/** How many shown barks the test hook remembers. */
export const BARK_HISTORY = 12;

export interface BarkState {
  readonly current: { readonly id: LineId; readonly until: number } | null;
  readonly queue: readonly LineId[];
  /** Barks shown so far, oldest first, at most BARK_HISTORY. */
  readonly history: readonly LineId[];
}

export const NO_BARKS: BarkState = { current: null, queue: [], history: [] };

export function enqueueBark(s: BarkState, id: LineId): BarkState {
  const queue = [...s.queue, id];
  return { ...s, queue: queue.length > BARK_QUEUE_MAX ? queue.slice(queue.length - BARK_QUEUE_MAX) : queue };
}

/** The bark state at `clock`: ends the current bark when its time is up and starts the next. */
export function stepBarks(s: BarkState, clock: number): BarkState {
  if (s.current && clock < s.current.until) return s;
  if (s.queue.length === 0) return s.current ? { ...s, current: null } : s;
  const [id, ...rest] = s.queue;
  const history = [...s.history, id];
  return {
    current: { id, until: clock + BARK_SECONDS },
    queue: rest,
    history: history.length > BARK_HISTORY ? history.slice(history.length - BARK_HISTORY) : history,
  };
}
