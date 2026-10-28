import type Phaser from 'phaser';
import script from '../docs/SCRIPT.md?raw';
import type { Part } from '../src/sim/board';
import { BROWNOUT } from '../src/sim/brownout';
import { InventoryView } from '../src/scenes/board/InventoryView';
import { TRAY_AREA } from '../src/scenes/board/layout';
import {
  CARD_SIZE,
  DRAWER,
  LOCKED_KINDS,
  MINI_SIZE,
  NOT_TONIGHT,
  inventoryCounts,
  lockedReason,
  priceChip,
  trayCards,
} from '../src/scenes/board/tray';
import { ZONES, rectToArea } from '../src/scenes/live/layout';

// The inventory row (board-2): three cards with prices and counts, and a padlocked drawer of the
// catalog's other parts drawn without their names.

const server = (id: string, slot: string, boost?: number): Part =>
  boost === undefined ? { id, kind: 'server', slot } : { id, kind: 'server', slot, boost };
const START: Part[] = [
  { id: 'gateway', kind: 'gateway', slot: null },
  { id: 'database', kind: 'database', slot: null },
];

type B = { x: number; y: number; w: number; h: number };
const overlap = (a: B, b: B) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

/** The system-design terms the debrief names (bold in C8.terms), which stay off the screen until then. */
const TERMS = script
  .split('\n')
  .filter((l) => l.startsWith('| C8.terms.'))
  .flatMap((l) => [...l.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].toLowerCase()));

describe('inventory row', () => {
  it('draws the inventory zone of the Live screen', () => {
    expect(TRAY_AREA).toEqual(rectToArea(ZONES.inventory));
    expect(TRAY_AREA).toEqual({ left: 455, right: 1510, top: 800, bottom: 965 });
  });

  it('lays out three 120x140 cards and a drawer of twenty 40x72 minis', () => {
    for (const unlocked of [false, true]) {
      const cards = trayCards(unlocked);
      const main = cards.filter((c) => c.main);
      expect(main.map((c) => c.id)).toEqual(['server', 'overclock', 'balancer']);
      expect(main.map((c) => [c.x, c.y])).toEqual([
        [530, 882],
        [660, 882],
        [790, 882],
      ]);
      for (const c of main) expect({ w: c.w, h: c.h }).toEqual(CARD_SIZE);
      expect(CARD_SIZE).toEqual({ w: 120, h: 140 });
      const minis = cards.filter((c) => !c.main);
      expect(minis.map((c) => c.id)).toEqual([...LOCKED_KINDS]);
      expect(minis).toHaveLength(20);
      expect(MINI_SIZE).toEqual({ w: 40, h: 72 });
      for (const c of minis) {
        expect({ w: c.w, h: c.h }).toEqual(MINI_SIZE);
        expect(c.x - c.w / 2).toBeGreaterThanOrEqual(DRAWER.left);
        expect(c.x + c.w / 2).toBeLessThanOrEqual(DRAWER.right);
      }
      expect(new Set(minis.map((c) => c.y)).size).toBe(2);
      // The drawer sits right of the cards.
      for (const c of main) expect(c.x + c.w / 2).toBeLessThan(DRAWER.left);
    }
  });

  it('keeps every card inside the inventory zone with no two overlapping', () => {
    for (const unlocked of [false, true]) {
      const cards = trayCards(unlocked);
      for (const c of cards) {
        expect(c.x - c.w / 2).toBeGreaterThanOrEqual(TRAY_AREA.left);
        expect(c.x + c.w / 2).toBeLessThanOrEqual(TRAY_AREA.right);
        expect(c.y - c.h / 2).toBeGreaterThanOrEqual(TRAY_AREA.top);
        expect(c.y + c.h / 2).toBeLessThanOrEqual(TRAY_AREA.bottom);
      }
      for (const a of cards) for (const b of cards) if (a !== b) expect(overlap(a, b)).toBe(false);
    }
  });

  it('prices the server and the kit in credits, and the balancer as a gift', () => {
    const byId = Object.fromEntries(trayCards(false).map((c) => [c.id, c]));
    expect(byId.server.price).toBe(BROWNOUT.server.cost);
    expect(byId.overclock.price).toBe(BROWNOUT.overclock.cost);
    expect(byId.balancer.price).toBe(0);
    expect(priceChip(80)).toBe('80 cr');
    expect(priceChip(60)).toBe('60 cr');
    expect(priceChip(0)).toBe('GIFT');
    for (const id of LOCKED_KINDS) expect(byId[id].price).toBeNull();
  });

  it('draws the drawer minis without their names, and a click on one says not tonight', () => {
    for (const c of trayCards(true).filter((x) => !x.main)) {
      expect(c.name).toBeNull();
      expect(c.locked).toBe(true);
      const reason = lockedReason(c.id);
      expect(reason).toBe(NOT_TONIGHT);
      expect(reason.toLowerCase()).not.toContain(c.id.replace(/-/g, ' '));
    }
    expect(NOT_TONIGHT).toMatch(/not tonight/i);
  });

  it('prints no debrief term on a card, a chip or the drawer before the debrief', () => {
    expect(TERMS).toContain('load balancer');
    expect(TERMS).toContain('headroom');
    const shown = [
      ...trayCards(true).flatMap((c) => [c.name ?? '', c.price === null ? '' : priceChip(c.price)]),
      NOT_TONIGHT,
    ].map((s) => s.toLowerCase());
    for (const s of shown) for (const term of TERMS) expect(s).not.toContain(term);
  });
});

describe('inventoryCounts', () => {
  it('counts what the credits buy, up to the free slots and the servers without a kit', () => {
    expect(inventoryCounts(400, START, false)).toEqual({ server: 5, overclock: 0, balancer: 0 });
    expect(inventoryCounts(1000, START, false).server).toBe(6);
    const two = [...START, server('a', 's1'), server('b', 's2', 2)];
    expect(inventoryCounts(400, two, false)).toEqual({ server: 4, overclock: 1, balancer: 0 });
    expect(inventoryCounts(59.9, two, false)).toEqual({ server: 0, overclock: 0, balancer: 0 });
    expect(inventoryCounts(60, two, false).overclock).toBe(1);
    const full = [...START, ...['s1', 's2', 's3', 's4', 's5', 's6'].map((s, i) => server(`p${i}`, s))];
    expect(inventoryCounts(10_000, full, false)).toEqual({ server: 0, overclock: 6, balancer: 0 });
  });

  it('never goes below zero when the credits are in debt', () => {
    expect(inventoryCounts(-150, [...START, server('a', 's1')], true)).toEqual({
      server: 0,
      overclock: 0,
      balancer: 1,
    });
  });

  it('offers the balancer once it is given, until it is racked', () => {
    expect(inventoryCounts(0, START, false).balancer).toBe(0);
    expect(inventoryCounts(0, START, true).balancer).toBe(1);
    const racked = [...START, { id: 'lb', kind: 'balancer', slot: null } as Part];
    expect(inventoryCounts(0, racked, true).balancer).toBe(0);
  });

  it('reads only the credits, the parts and whether the balancer was given', () => {
    expect(inventoryCounts.length).toBe(3);
    const read = new Set<string>();
    const watched = [...START, server('a', 's1'), server('b', 's2', 2)].map(
      (p) =>
        new Proxy(Object.freeze({ ...p }), {
          get(t, key, r) {
            read.add(String(key));
            return Reflect.get(t, key, r);
          },
        }),
    );
    const parts = Object.freeze(watched);
    const before = JSON.stringify(parts);
    read.clear();
    expect(inventoryCounts(300, parts, true)).toEqual({ server: 3, overclock: 1, balancer: 1 });
    // A part's kind and kit only; never its id, slot or anything else on the run.
    expect([...read].sort()).toEqual(['boost', 'kind']);
    expect(JSON.stringify(parts)).toBe(before);
  });
});

// ---- InventoryView against a stub scene ------------------------------------------------------

interface Drawn {
  kind: 'image' | 'text' | 'graphics';
  x: number;
  y: number;
  text: string;
  rects: B[];
  setText: (t: string) => Drawn;
}

function stubScene(): { scene: Phaser.Scene; drawn: Drawn[]; setTextCalls: () => number } {
  const drawn: Drawn[] = [];
  let setTextCalls = 0;
  const make = (kind: Drawn['kind'], x = 0, y = 0, text = ''): Drawn => {
    const o: Record<string, unknown> & Drawn = {
      kind,
      x,
      y,
      text,
      rects: [],
      width: 100,
      height: 100,
      setText(t: string) {
        setTextCalls++;
        o.text = t;
        return o;
      },
    } as never;
    const chain = (name: string, fn?: (...a: number[]) => void) => {
      o[name] = (...a: number[]) => {
        fn?.(...a);
        return o;
      };
    };
    for (const n of ['setDepth', 'setDisplaySize', 'setScale', 'setOrigin', 'setTint', 'clearTint']) chain(n);
    for (const n of ['setAlpha', 'setVisible', 'setColor', 'destroy', 'fillStyle', 'lineStyle']) chain(n);
    chain('setPosition', (px, py) => {
      o.x = px;
      o.y = py;
    });
    chain('fillRoundedRect', (rx, ry, rw, rh) =>
      o.rects.push({ x: rx + rw / 2, y: ry + rh / 2, w: rw, h: rh }),
    );
    chain('strokeRoundedRect', (rx, ry, rw, rh) =>
      o.rects.push({ x: rx + rw / 2, y: ry + rh / 2, w: rw, h: rh }),
    );
    drawn.push(o);
    return o;
  };
  const scene = {
    add: {
      graphics: () => make('graphics'),
      image: (x: number, y: number) => make('image', x, y),
      text: (x: number, y: number, t: string) => make('text', x, y, t),
    },
  } as unknown as Phaser.Scene;
  return { scene, drawn, setTextCalls: () => setTextCalls };
}

describe('InventoryView', () => {
  it('draws only inside the inventory zone, with no kind name on the screen', () => {
    const { scene, drawn } = stubScene();
    const view = new InventoryView(scene);
    view.create(trayCards(false));
    const inZone = (x: number, y: number) =>
      x >= TRAY_AREA.left && x <= TRAY_AREA.right && y >= TRAY_AREA.top && y <= TRAY_AREA.bottom;
    for (const o of drawn) {
      if (o.kind !== 'graphics') expect(inZone(o.x, o.y)).toBe(true);
      for (const r of o.rects) {
        expect(inZone(r.x - r.w / 2, r.y - r.h / 2)).toBe(true);
        expect(inZone(r.x + r.w / 2, r.y + r.h / 2)).toBe(true);
      }
    }
    const texts = drawn.filter((o) => o.kind === 'text').map((o) => o.text.toLowerCase());
    for (const kind of LOCKED_KINDS) for (const t of texts) expect(t).not.toContain(kind.replace(/-/g, ' '));
    expect(texts).toEqual(
      expect.arrayContaining(['server', 'overclock', 'balancer', '80 cr', '60 cr', 'gift']),
    );
  });

  it('finds the card under a point and re-sets a count only when it changes', () => {
    const { scene, drawn, setTextCalls } = stubScene();
    const view = new InventoryView(scene);
    const cards = trayCards(false);
    view.create(cards);
    expect(view.cardAt(530, 882)?.id).toBe('server');
    expect(view.cardAt(790, 882)?.locked).toBe(true);
    expect(view.cardAt(cards[3].x, cards[3].y)?.id).toBe(LOCKED_KINDS[0]);
    expect(view.cardAt(470, 810)).toBeNull();

    const first = setTextCalls();
    view.setCounts({ server: 5, overclock: 0, balancer: 0 });
    expect(view.countOf('server')).toBe(5);
    expect(view.countOf('overclock')).toBe(0);
    expect(view.countOf('cache')).toBe(0);
    const set = setTextCalls();
    expect(set).toBeGreaterThan(first);
    view.setCounts({ server: 5, overclock: 0, balancer: 0 });
    expect(setTextCalls()).toBe(set);
    view.setCounts({ server: 4, overclock: 0, balancer: 0 });
    expect(setTextCalls()).toBe(set + 1);
    expect(drawn.some((o) => o.kind === 'text' && o.text === '4')).toBe(true);

    view.setLocks(trayCards(true));
    expect(view.cardAt(790, 882)?.locked).toBe(false);
  });
});
