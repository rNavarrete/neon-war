import { Run } from '../src/game/run';
import type { Part } from '../src/sim/board';
import { BROWNOUT } from '../src/sim/brownout';
import { artFor, loadColour, loadLabel, partLook } from '../src/scenes/board/view';

const server: Part = { id: 'server-p1', kind: 'server', slot: 's1' };
const boosted: Part = { ...server, boost: 2 };
const gateway: Part = { id: 'gateway', kind: 'gateway', slot: null };
const database: Part = { id: 'database', kind: 'database', slot: null };

describe('part look', () => {
  it('shows load as a share of capacity', () => {
    const look = partLook(server, 30, [], {}, 10);
    expect(look.status).toBe('online');
    expect(look.capacity).toBe(BROWNOUT.server.capacity);
    expect(look.share).toBeCloseTo(0.5);
    expect(loadLabel(look)).toBe('30/60 · 50%');
    expect(partLook(database, 30, [], {}, 10).share).toBeCloseTo(30 / BROWNOUT.database.capacity);
  });

  it('gives the gateway no limit', () => {
    const look = partLook(gateway, 30, [], {}, 10);
    expect(look.capacity).toBeNull();
    expect(look.share).toBeNull();
    expect(loadLabel(look)).toBe('30 req/s');
  });

  it('counts an overclocked server at 120 req/s and draws the kit', () => {
    const look = partLook(boosted, 90, [], {}, 10);
    expect(look.capacity).toBe(120);
    expect(look.art).toBe('server-overclocked');
  });

  it('shows a booting server dark with its seconds left, then a rebooting one after the kit', () => {
    const boot = partLook(server, 30, [server.id], { [server.id]: 13 }, 10.5);
    expect(boot.status).toBe('booting');
    expect(boot.left).toBeCloseTo(2.5);
    expect(boot.dark).toBe(true);
    expect(loadLabel(boot)).toBe('BOOTING 2.5s');
    const reboot = partLook(boosted, 30, [server.id], { [server.id]: 13 }, 11);
    expect(reboot.status).toBe('rebooting');
    expect(loadLabel(reboot)).toBe('REBOOTING 2.0s');
  });

  it('shows a server that is offline for another reason as dead and dark', () => {
    const look = partLook(server, 30, [server.id], {}, 10);
    expect(look.status).toBe('offline');
    expect(look.art).toBe('server-dead');
    expect(look.dark).toBe(true);
    expect(loadLabel(look)).toBe('OFFLINE');
  });

  it('runs hot past 100%', () => {
    expect(partLook(server, 90, [], {}, 10).art).toBe('server-hot');
    expect(partLook(boosted, 150, [], {}, 10).art).toBe('server-overclocked-hot');
    expect(partLook(database, 375, [], {}, 10).art).toBe('database-hot');
    expect(artFor(server, false)).toBe('server');
    expect(loadColour(partLook(server, 30, [], {}, 10))).toBe('#2de2e6');
    expect(loadColour(partLook(server, 55, [], {}, 10))).toBe('#ffb02e');
    expect(loadColour(partLook(server, 90, [], {}, 10))).toBe('#ff4d5e');
  });
});

describe('test speed', () => {
  it('runs the sim N times faster under ?test&speed=N', () => {
    const fast = new Run(20);
    const normal = new Run(1);
    for (let i = 0; i < 60; i++) {
      fast.tick(1 / 60);
      normal.tick(1 / 60);
    }
    expect(normal.now).toBeCloseTo(1);
    expect(fast.now).toBeCloseTo(20);
  });

  it('reaches C3 in under 30 s of real time at speed 20', () => {
    const r = new Run(20);
    // A server wired gateway -> server -> database keeps the block up, so nothing fails and rewinds.
    expect(r.placeServer('s1').ok).toBe(true);
    const id = r.session.board.parts[r.session.board.parts.length - 1].id;
    expect(r.connect('gateway', id).ok).toBe(true);
    expect(r.connect(id, 'database').ok).toBe(true);
    let real = 0;
    while (r.now < BROWNOUT.challenges.c3 && real < 60) {
      r.tick(1 / 60);
      real += 1 / 60;
    }
    expect(r.play.failure).toBeNull();
    expect(r.now).toBeGreaterThanOrEqual(BROWNOUT.challenges.c3);
    expect(real).toBeLessThan(30);
  });
});
