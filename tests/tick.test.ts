import { BROWNOUT } from '../src/sim/brownout';
import { placeServer } from '../src/sim/economy';
import { brownoutSession, liveCapacity, stepCalm } from '../src/sim/tick';
import { connect } from '../src/sim/board';
import { BROWNOUT_RULES } from '../src/sim/brownout';

describe('calm-weather step', () => {
  it('starts with the gateway and database and no servers', () => {
    const s = brownoutSession();
    expect(s.board.parts.map((p) => p.id)).toEqual(['gateway', 'database']);
    expect(s.board.credits).toBe(BROWNOUT.credits.starting);
  });

  it('serves the block once a booted server is wired, and charges upkeep', () => {
    let s = brownoutSession();
    const r = placeServer(s, 's1', 0);
    if (!r.ok) throw new Error(r.reason);
    s = r.session;
    const id = s.board.parts[2].id;
    for (const [a, b] of [
      ['gateway', id],
      [id, 'database'],
    ]) {
      const c = connect(s.board, BROWNOUT_RULES, a, b);
      if (!c.ok) throw new Error(c.reason);
      s = { ...s, board: c.board };
    }
    expect(liveCapacity(s, 1)).toBe(0);
    expect(liveCapacity(s, 4)).toBe(60);
    const before = structuredClone(s);
    const m = stepCalm(s, 20, 60);
    expect(s).toEqual(before);
    expect(m.now).toBe(80);
    expect(m.flow.dropped).toBe(0);
    expect(m.session.board.credits).toBeCloseTo(320 - 5);
  });

  it('drains trust while nothing is wired', () => {
    const m = stepCalm(brownoutSession(), 20, 1);
    expect(m.flow.dropped).toBe(30);
    expect(m.session.trust).toBe(90);
  });
});
