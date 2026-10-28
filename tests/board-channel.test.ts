import boardSource from '../src/scenes/BoardScene.ts?raw';
import { readFrame, resetFrame, wiredCapacity } from '../src/game/frame';
import { Run } from '../src/game/run';
import type { Part, Wire } from '../src/sim/board';
import { BROWNOUT } from '../src/sim/brownout';
import {
  BANK_MARKS,
  CHANNEL_MAX,
  bankMarkPoints,
  capacityLevel,
  channelLevel,
  channelState,
  emptyChannel,
  channelInto,
  fillInboundRates,
  forecastLevel,
  inboundLaneRates,
  lanePps,
  levelY,
  retryShare,
} from '../src/scenes/board/channel';
import { CHANNEL } from '../src/scenes/board/layout';
import { PacketPool, fillPacketRates, packetsPerSecond } from '../src/scenes/board/packets';
import { DEMAND_SCALE_MAX } from '../src/scenes/hud/thresholds';
import { surgeWarningAt } from '../src/scenes/hud/warnings';

const C = BROWNOUT.challenges;

describe('channel levels (board-4)', () => {
  it('runs on the shared 0..400 scale, so 375 reads the same on the gauge and the channel', () => {
    expect(CHANNEL_MAX).toBe(DEMAND_SCALE_MAX);
    expect(CHANNEL_MAX).toBe(400);
    expect(channelLevel(375)).toBeCloseTo(375 / 400);
    expect(channelLevel(250)).toBeCloseTo(250 / 400);
  });

  it('fills to min(1, demand / max)', () => {
    for (const d of [0, 30, 90, 120, 250, 375, 400, 600])
      expect(channelLevel(d)).toBeCloseTo(Math.min(1, d / 400));
    expect(channelLevel(-5)).toBe(0);
    expect(channelLevel(Number.NaN)).toBe(0);
  });

  it('puts the ROOM tick at wired capacity / max', () => {
    expect(capacityLevel(0)).toBe(0);
    expect(capacityLevel(60)).toBeCloseTo(0.15);
    expect(capacityLevel(240)).toBeCloseTo(0.6);
  });

  it('shows the forecast level while a surge warning is up and before it lands', () => {
    expect(forecastLevel(null)).toBeNull();
    const before = surgeWarningAt(C.c4 - 5)!;
    expect(forecastLevel(before)).toBeCloseTo(BROWNOUT.demand.surge / 400);
    const landed = surgeWarningAt(C.c4 + 1)!;
    expect(landed).not.toBeNull();
    expect(forecastLevel(landed)).toBeNull();
    expect(forecastLevel(surgeWarningAt(C.c2))).toBeNull();
  });

  it('tops the fill with a red retry band at retry / (1 + retry)', () => {
    expect(retryShare(0)).toBe(0);
    expect(retryShare(0.5)).toBeCloseTo(1 / 3);
    expect(retryShare(0.25)).toBeCloseTo(0.2);
  });

  it('reports {demand, max, level, capacityLevel, forecast, retryShare} from one frame, in place', () => {
    const input = { demand: 300, wiredCapacity: 180, retry: 0.2, surge: surgeWarningAt(C.c6 - 3) };
    const c = channelState(input);
    expect(c).toMatchObject({
      demand: 300,
      max: 400,
      level: 0.75,
      capacityLevel: 0.45,
      retryShare: 0.2 / 1.2,
    });
    expect(c.forecast).toBeCloseTo(BROWNOUT.demand.final / 400);
    const out = emptyChannel();
    expect(channelInto(out, input)).toBe(out);
    expect(out).toEqual(c);
  });
});

describe('bank marks (board-4)', () => {
  it('reads 0, 1/4, 1/2, 3/4, MAX from bottom to top at the mouth', () => {
    expect(BANK_MARKS.map((m) => m.label)).toEqual(['0', '1/4', '1/2', '3/4', 'MAX']);
    expect(BANK_MARKS.map((m) => m.value)).toEqual([0, 100, 200, 300, 400]);
    const pts = bankMarkPoints();
    expect(pts.map((p) => p.label)).toEqual(['0', '1/4', '1/2', '3/4', 'MAX']);
    // Bottom to top: y falls as the value climbs, from the mouth's floor to its top bank.
    for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeLessThan(pts[i - 1].y);
    expect(pts[0].y).toBeCloseTo(CHANNEL.mouth.bottom);
    expect(pts[4].y).toBeCloseTo(CHANNEL.mouth.top);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(CHANNEL.mouth.x);
      expect(p.x).toBeLessThan(CHANNEL.port.x);
    }
  });

  it('draws a level higher in the walls as it climbs, and clamps past the top', () => {
    expect(levelY(0, CHANNEL.port.x)).toBeCloseTo(CHANNEL.port.bottom);
    expect(levelY(1, CHANNEL.port.x)).toBeCloseTo(CHANNEL.port.top);
    expect(levelY(2, CHANNEL.mouth.x)).toBeCloseTo(CHANNEL.mouth.top);
  });
});

describe('inbound cubes (board-4)', () => {
  it('runs piecewise linear through (30,3) (90,9) (150,15) (250,24) (375,36)', () => {
    expect(inboundLaneRates(0)).toBe(0);
    for (const [d, pps] of [
      [30, 3],
      [90, 9],
      [150, 15],
      [250, 24],
      [375, 36],
    ]) {
      expect(inboundLaneRates(d)).toBeCloseTo(pps);
    }
    expect(inboundLaneRates(200)).toBeCloseTo(19.5);
    expect(inboundLaneRates(400)).toBeGreaterThan(36);
  });

  it('streams visibly more cubes at 375 than at 250', () => {
    expect(inboundLaneRates(375) / inboundLaneRates(250)).toBeCloseTo(1.5);
    // Each lane too, and under the per-wire cap so the difference survives the pool.
    for (let i = 0; i < 3; i++) {
      expect(lanePps(375, i, 3)).toBeGreaterThan(lanePps(250, i, 3) * 1.4);
      expect(lanePps(400, i, 3)).toBeLessThan(16);
    }
    let sum = 0;
    for (let i = 0; i < 3; i++) sum += lanePps(375, i, 3);
    expect(sum).toBeCloseTo(36);
  });

  it('feeds the pool so it launches lanePps cubes a second on each lane, without touching the wires', () => {
    const keys = ['inbound0', 'inbound1', 'inbound2'];
    const out: Record<string, number> = {};
    fillInboundRates(fillPacketRates(out, { 'gateway>server-p1': 30 }, 375, keys), 375, keys);
    expect(out['gateway>server-p1']).toBe(30);
    for (let i = 0; i < 3; i++) expect(packetsPerSecond(out[keys[i]])).toBeCloseTo(lanePps(375, i, 3));

    // In the pool, cubes in flight on the lanes follow: about 36 x 0.5 s at 375, 24 x 0.5 s at 250.
    const inFlight = (demand: number) => {
      const pool = new PacketPool();
      const rates: Record<string, number> = {};
      for (let f = 0; f < 120; f++) {
        fillInboundRates(fillPacketRates(rates, {}, demand, keys), demand, keys);
        pool.step(1 / 60, rates, () => 0.5);
      }
      return pool.active;
    };
    expect(inFlight(375)).toBeGreaterThanOrEqual(17);
    expect(inFlight(250)).toBeLessThanOrEqual(13);
  });

  it('draws no chevrons: the channel carries cubes only', () => {
    const code = boardSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/chevronShift|drawInbound/);
    expect(code).toContain('chevrons: 0');
  });
});

/** Place a server in `slot` and return its id. */
function rack(r: Run, slot: string): string {
  expect(r.placeServer(slot).ok).toBe(true);
  return r.session.board.parts[r.session.board.parts.length - 1].id;
}

describe('the ROOM tick follows wired capacity, never what is only racked (board-4)', () => {
  beforeEach(() => resetFrame());

  it('stays put when a server is racked, moves when it is wired and online, and when it is cut', () => {
    const r = new Run();
    r.now = C.c1;
    const room = () => channelState(readFrame(r)).capacityLevel;
    expect(room()).toBe(0);
    const id = rack(r, 's1');
    // Racked: run().capacity counts it once it boots; the ROOM tick does not move.
    expect(room()).toBe(0);
    expect(r.connect('gateway', id).ok).toBe(true);
    expect(r.connect(id, 'database').ok).toBe(true);
    // Wired but booting: nothing serves yet.
    expect(room()).toBe(0);
    for (let i = 0; i < 4 * 60; i++) r.tick(1 / 60);
    expect(readFrame(r).offline).not.toContain(id);
    expect(room()).toBeCloseTo(60 / 400);

    // A second server racked and booted but fed by nothing: run().capacity doubles, the tick holds.
    const idle = rack(r, 's2');
    for (let i = 0; i < 4 * 60; i++) r.tick(1 / 60);
    expect(r.capacity).toBe(120);
    expect(readFrame(r).wiredCapacity).toBe(60);
    expect(room()).toBeCloseTo(60 / 400);
    expect(idle).toBeTruthy();

    // Cut the feed: the tick falls to 0.
    expect(r.cut('gateway', id).ok).toBe(true);
    expect(room()).toBe(0);
  });

  it('falls when a wired server goes dark or dies (both are offline)', () => {
    const parts: Part[] = [
      { id: 'gateway', kind: 'gateway', slot: null },
      { id: 'balancer', kind: 'balancer', slot: null },
      { id: 'a', kind: 'server', slot: 's1' },
      { id: 'b', kind: 'server', slot: 's2' },
      { id: 'database', kind: 'database', slot: null },
    ];
    const wires: Wire[] = [
      { from: 'gateway', to: 'balancer' },
      { from: 'balancer', to: 'a' },
      { from: 'balancer', to: 'b' },
      { from: 'a', to: 'database' },
      { from: 'b', to: 'database' },
    ];
    const level = (offline: string[]) =>
      channelState({
        demand: 120,
        wiredCapacity: wiredCapacity(parts, wires, offline),
        retry: 0,
        surge: null,
      }).capacityLevel;
    expect(level([])).toBeCloseTo(120 / 400);
    // 'a' dark in a dip, then 'b' dead too: each takes its 60 off the tick.
    expect(level(['a'])).toBeCloseTo(60 / 400);
    expect(level(['a', 'b'])).toBe(0);
  });
});
