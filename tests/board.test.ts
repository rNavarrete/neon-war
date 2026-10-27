import {
  type Board,
  type BoardRules,
  type Part,
  connect,
  capacityOf,
  loseUpgrade,
  upgrade,
  createBoard,
  decommission,
  disconnect,
  errorShare,
  partById,
  place,
  route,
  updateTrust,
} from '../src/sim/board';

// Test numbers only; session numbers live with the session's rules.
const RULES: BoardRules = {
  cost: { server: 80, balancer: 0 },
  refund: 0.5,
  capacity: { server: 60, database: 500 },
  wiring: { gateway: ['balancer', 'server'], balancer: ['server'], server: ['database'], database: [] },
  maxOut: { gateway: 1 },
  healthCheck: ['balancer'],
  upgrade: { kinds: ['server'], cost: 60, factor: 2 },
};

const fixed: Part[] = [
  { id: 'gateway', kind: 'gateway', slot: null },
  { id: 'server-1', kind: 'server', slot: null },
  { id: 'database', kind: 'database', slot: null },
];

function start(): Board {
  return createBoard({
    credits: 400,
    slots: ['slot-1', 'slot-2', 'slot-3'],
    parts: fixed,
    wires: [
      { from: 'gateway', to: 'server-1' },
      { from: 'server-1', to: 'database' },
    ],
  });
}

function ok(result: ReturnType<typeof place>): Board {
  if (!result.ok) throw new Error(result.reason);
  return result.board;
}

describe('place', () => {
  it('spends the price and puts a new part in the slot', () => {
    const b = ok(place(start(), RULES, 'slot-1', 'server'));
    expect(b.credits).toBe(320);
    expect(b.parts.at(-1)).toEqual({ id: 'server-p1', kind: 'server', slot: 'slot-1' });
    expect(ok(place(b, RULES, 'slot-2', 'server')).parts.at(-1)!.id).toBe('server-p2');
  });

  it('refuses a taken slot, an unknown slot, an unplaceable kind and an empty wallet', () => {
    const b = ok(place(start(), RULES, 'slot-1', 'server'));
    expect(place(b, RULES, 'slot-1', 'server')).toEqual({ ok: false, reason: 'that slot is taken' });
    expect(place(b, RULES, 'slot-9', 'server')).toEqual({ ok: false, reason: 'no slot slot-9' });
    expect(place(b, RULES, 'slot-2', 'database')).toEqual({
      ok: false,
      reason: "a database can't be placed",
    });
    const broke = { ...b, credits: 79 };
    expect(place(broke, RULES, 'slot-2', 'server')).toEqual({ ok: false, reason: 'not enough credits' });
  });

  it('never changes the board it was given', () => {
    const b = start();
    const copy = structuredClone(b);
    place(b, RULES, 'slot-1', 'server');
    expect(b).toEqual(copy);
  });
});

describe('decommission', () => {
  it('removes a placed part and its wires and refunds half the price', () => {
    let b = ok(place(start(), RULES, 'slot-1', 'server'));
    b = ok(connect(b, RULES, 'server-p1', 'database'));
    b = ok(decommission(b, RULES, 'server-p1'));
    expect(b.credits).toBe(360);
    expect(b.parts.some((p) => p.id === 'server-p1')).toBe(false);
    expect(b.wires.some((w) => w.from === 'server-p1')).toBe(false);
  });

  it('refuses parts the session started with', () => {
    expect(decommission(start(), RULES, 'server-1')).toEqual({
      ok: false,
      reason: 'only placed parts can be decommissioned',
    });
  });
});

describe('connect and disconnect', () => {
  it('follows the wiring table', () => {
    expect(connect(start(), RULES, 'gateway', 'database')).toEqual({
      ok: false,
      reason: "a gateway can't send traffic to a database",
    });
    expect(connect(start(), RULES, 'server-1', 'database')).toEqual({
      ok: false,
      reason: 'already connected',
    });
  });

  it('lets the gateway feed one part only', () => {
    const b = ok(place(start(), RULES, 'slot-1', 'server'));
    expect(connect(b, RULES, 'gateway', 'server-p1')).toEqual({
      ok: false,
      reason: 'a gateway feeds one part only',
    });
  });

  it('cuts a wire', () => {
    const b = ok(disconnect(start(), 'server-1', 'database'));
    expect(b.wires).toEqual([{ from: 'gateway', to: 'server-1' }]);
    expect(disconnect(b, 'server-1', 'database')).toEqual({ ok: false, reason: 'not connected' });
  });
});

describe('route', () => {
  it('serves demand that fits', () => {
    const f = route(start(), RULES, 30);
    expect(f.served).toBe(30);
    expect(f.dropped).toBe(0);
    expect(f.wires['gateway>server-1']).toBe(30);
    expect(f.load.database).toBe(30);
  });

  it('drops what is over a server’s capacity', () => {
    const f = route(start(), RULES, 90);
    expect(f.served).toBe(60);
    expect(f.dropped).toBe(30);
    expect(errorShare(f, 90)).toBeCloseTo(1 / 3);
  });

  it('a second server only helps once traffic reaches it through a balancer', () => {
    let b = ok(place(start(), RULES, 'slot-1', 'server'));
    b = ok(connect(b, RULES, 'server-p1', 'database'));
    expect(route(b, RULES, 90).dropped).toBe(30);

    b = ok(place(b, RULES, 'slot-2', 'balancer'));
    b = ok(disconnect(b, 'gateway', 'server-1'));
    b = ok(connect(b, RULES, 'gateway', 'balancer-p2'));
    b = ok(connect(b, RULES, 'balancer-p2', 'server-1'));
    b = ok(connect(b, RULES, 'balancer-p2', 'server-p1'));
    const f = route(b, RULES, 90);
    expect(f.dropped).toBe(0);
    expect(f.wires['balancer-p2>server-1']).toBe(45);
    expect(f.wires['balancer-p2>server-p1']).toBe(45);
  });

  it('drops traffic at an offline part and at a part wired to nothing', () => {
    expect(route(start(), RULES, 30, ['server-1']).dropped).toBe(30);
    const cut = ok(disconnect(start(), 'server-1', 'database'));
    expect(route(cut, RULES, 30).dropped).toBe(30);
  });

  it('drops everything with no gateway, and reports no errors with no demand', () => {
    const empty = createBoard({ credits: 0, slots: [] });
    expect(route(empty, RULES, 30).dropped).toBe(30);
    expect(errorShare(route(start(), RULES, 0), 0)).toBe(0);
  });
});

describe('updateTrust', () => {
  const rates = { drain: 10, recover: 1, max: 100 };

  it('drains in proportion to the error share', () => {
    expect(updateTrust(100, 1, 1, rates)).toBe(90);
    expect(updateTrust(100, 0.5, 2, rates)).toBe(90);
  });

  it('recovers only while nothing fails, and stays between 0 and max', () => {
    expect(updateTrust(50, 0, 3, rates)).toBe(53);
    expect(updateTrust(99.5, 0, 1, rates)).toBe(100);
    expect(updateTrust(5, 1, 1, rates)).toBe(0);
  });
});

describe('health checks', () => {
  function balanced(): Board {
    let b = ok(place(start(), RULES, 'slot-1', 'server'));
    b = ok(place(b, RULES, 'slot-2', 'balancer'));
    b = ok(disconnect(b, 'gateway', 'server-1'));
    b = ok(connect(b, RULES, 'gateway', 'balancer-p2'));
    b = ok(connect(b, RULES, 'balancer-p2', 'server-1'));
    b = ok(connect(b, RULES, 'balancer-p2', 'server-p1'));
    return ok(connect(b, RULES, 'server-p1', 'database'));
  }

  it('the balancer skips an offline server and sends everything to the live one', () => {
    const f = route(balanced(), RULES, 60, ['server-1']);
    expect(f.dropped).toBe(0);
    expect(f.wires['balancer-p2>server-p1']).toBe(60);
    expect(f.wires['balancer-p2>server-1']).toBeUndefined();
    expect(f.skipped).toEqual(['balancer-p2>server-1']);
  });

  it('the gateway does not health-check: feeding an offline server drops the traffic', () => {
    const f = route(start(), RULES, 30, ['server-1']);
    expect(f.dropped).toBe(30);
    expect(f.skipped).toEqual([]);
  });

  it('with every server offline the balancer has nowhere to send traffic', () => {
    expect(route(balanced(), RULES, 60, ['server-1', 'server-p1']).dropped).toBe(60);
  });
});

describe('upgrade (overclock kit)', () => {
  it('doubles one server for its price, once', () => {
    const b = ok(upgrade(start(), RULES, 'server-1'));
    expect(b.credits).toBe(340);
    expect(capacityOf(partById(b, 'server-1')!, RULES)).toBe(120);
    expect(route(b, RULES, 120).dropped).toBe(0);
    expect(upgrade(b, RULES, 'server-1')).toEqual({ ok: false, reason: 'already upgraded' });
  });

  it('refuses other kinds and an empty wallet', () => {
    expect(upgrade(start(), RULES, 'database')).toEqual({
      ok: false,
      reason: "a database can't be upgraded",
    });
    expect(upgrade({ ...start(), credits: 59 }, RULES, 'server-1')).toEqual({
      ok: false,
      reason: 'not enough credits',
    });
  });

  it('a burned-out upgrade leaves the server at normal capacity', () => {
    const b = ok(loseUpgrade(ok(upgrade(start(), RULES, 'server-1')), 'server-1'));
    expect(partById(b, 'server-1')).toEqual({ id: 'server-1', kind: 'server', slot: null });
    expect(route(b, RULES, 120).dropped).toBe(60);
    expect(loseUpgrade(b, 'server-1')).toEqual({ ok: false, reason: 'not upgraded' });
  });
});
