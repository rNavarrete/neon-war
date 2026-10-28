import { EMPTY_TRACE, TRACE_KEEP, traceStep } from '../src/scenes/hud/ChatFeedView';

// chat-5: hud.chatTrace, the error spells and retry climbs the chat stepped on, as edges.

describe('traceStep', () => {
  it('returns the same trace on a quiet frame', () => {
    expect(traceStep(EMPTY_TRACE, 1, 0, 0)).toBe(EMPTY_TRACE);
    const t = traceStep(EMPTY_TRACE, 1, 0.3, 0);
    expect(traceStep(t, 2, 0.4, 0)).toBe(t);
  });

  it('opens a spell when errors start and closes it when they stop, without mutating its input', () => {
    const a = traceStep(EMPTY_TRACE, 2, 0.2, 0);
    expect(a.errors).toEqual([{ from: 2, to: null }]);
    const b = traceStep(a, 5.5, 0, 0);
    expect(b.errors).toEqual([{ from: 2, to: 5.5 }]);
    expect(a.errors).toEqual([{ from: 2, to: null }]);
    const c = traceStep(b, 7, 0.9, 0);
    expect(c.errors).toEqual([
      { from: 2, to: 5.5 },
      { from: 7, to: null },
    ]);
  });

  it('marks each retry step once while retries climb, and again after they settle to 0', () => {
    let t = traceStep(EMPTY_TRACE, 1, 0.5, 0.05);
    expect(t.retries).toEqual([]);
    t = traceStep(t, 2, 0.5, 0.12);
    t = traceStep(t, 3, 0.5, 0.15);
    t = traceStep(t, 4, 0.5, 0.21);
    expect(t.retries).toEqual([
      { at: 2, retry: 0.12 },
      { at: 4, retry: 0.21 },
    ]);
    t = traceStep(t, 5, 0.5, 0.1);
    expect(t.retries).toHaveLength(2);
    t = traceStep(t, 6, 0, 0);
    t = traceStep(t, 7, 0.5, 0.11);
    expect(t.retries[t.retries.length - 1]).toEqual({ at: 7, retry: 0.11 });
  });

  it('keeps the last TRACE_KEEP spells', () => {
    let t = EMPTY_TRACE;
    for (let i = 0; i < TRACE_KEEP + 5; i++) {
      t = traceStep(t, i * 2, 0.5, 0);
      t = traceStep(t, i * 2 + 1, 0, 0);
    }
    expect(t.errors).toHaveLength(TRACE_KEEP);
    expect(t.errors[TRACE_KEEP - 1]).toEqual({ from: (TRACE_KEEP + 4) * 2, to: (TRACE_KEEP + 4) * 2 + 1 });
  });
});
