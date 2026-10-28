import { Bus } from '../src/game/bus';
import { readFrame } from '../src/game/frame';
import { newRun, run } from '../src/game/run';
import { DeckView } from '../src/scenes/hud/DeckView';
import {
  type DeckInput,
  KEY_NAMES,
  PULSE_RATE,
  bannerOpen,
  cutDoneWord,
  cutKey,
  deckState,
  keyAlpha,
  keyLit,
  keyRects,
  keyWords,
  pressActs,
  pulseAt,
  regroupKey,
  tooltipAt,
} from '../src/scenes/hud/deck';
import { dismissJobCard } from '../src/scenes/hud/jobCard';
import { LABELS } from '../src/scenes/hud/labels';
import { headroomLayout } from '../src/scenes/hud/headroom';
import { ZONES, inside } from '../src/scenes/live/layout';
import { BROWNOUT } from '../src/sim/brownout';
import { type HudTestState, hudSection } from '../src/scenes/hud/hook';

// gauges-8: the deck's keys 1 REGROUP, 2 CUT 3F, 3 SET (src/scenes/hud/deck.ts, DeckView.ts). What
// each key shows, when a press (a click or its digit) acts, and the guards in front of them.

// The hook's sections as the views provide them, read back here without a window.
const sections = vi.hoisted(() => new Map<string, () => unknown>());
vi.mock('../src/testHook', async (actual) => ({
  ...(await actual<typeof import('../src/testHook')>()),
  provideTestState: (key: string, read: () => unknown) => {
    sections.set(key, read);
  },
}));

const C = BROWNOUT.challenges;

/** A running board in C1 with the card away and no answer yet: the dial question is open. */
function input(over: Partial<DeckInput> = {}): DeckInput {
  return {
    now: C.c1 + 5,
    paused: false,
    regroup: { charges: 0, handedOver: false, left: 0 },
    laundryCut: null,
    laundryCutAvailable: false,
    banner: null,
    notes: { estimate: null, sizing: null },
    cardOpen: false,
    ...over,
  };
}

describe('what each key shows', () => {
  it('Regroup: hidden until handed over, ready, active while its slow time drains, then spent', () => {
    expect(regroupKey({ charges: 0, handedOver: false, left: 0 })).toBe('hidden');
    expect(regroupKey({ charges: 1, handedOver: true, left: 0 })).toBe('ready');
    expect(regroupKey({ charges: 0, handedOver: true, left: 6 })).toBe('active');
    expect(regroupKey({ charges: 0, handedOver: true, left: 0 })).toBe('spent');
    const s = deckState(input({ regroup: { charges: 0, handedOver: true, left: 5 } }), 0, true);
    expect(s.ring).toBeCloseTo(5 / BROWNOUT.regroup.seconds);
    expect(deckState(input({ regroup: { charges: 1, handedOver: true, left: 0 } }), 0, true).ring).toBe(0);
  });

  it('CUT 3F: ready in the surge window, done once cut until the crew, hidden otherwise', () => {
    expect(cutKey(C.c4 - 5, false, null)).toBe('hidden');
    expect(cutKey(C.c4 + 1, true, null)).toBe('ready');
    expect(cutKey(C.c4 + 3, false, { at: C.c4 + 1 })).toBe('done');
    expect(cutKey(C.c5 + 1, false, { at: C.c4 + 1 })).toBe('hidden');
    expect(cutDoneWord()).toBe(`CUT · -${BROWNOUT.demand.laundryCut}/s`);
  });

  it('SET: ready only while a dial question is open (C1 until the estimate, C6 until the sizing)', () => {
    expect(deckState(input(), 0, true).set).toBe('ready');
    expect(deckState(input({ notes: { estimate: 30, sizing: null } }), 0, true).set).toBe('dim');
    expect(deckState(input({ now: C.c3, notes: { estimate: 30, sizing: null } }), 0, true).set).toBe('dim');
    expect(deckState(input({ now: C.c6 - 5, notes: { estimate: 30, sizing: null } }), 0, true).set).toBe(
      'ready',
    );
    expect(deckState(input({ now: C.c6 - 5, notes: { estimate: 30, sizing: 4 } }), 0, true).set).toBe('dim');
    // The job card closes the question until it is clicked away.
    expect(deckState(input({ cardOpen: true, paused: true }), 0, true).set).toBe('dim');
  });

  it('reads its words from labels.ts', () => {
    expect(keyWords('one')).toEqual({ digit: '1', word: 'REGROUP' });
    expect(keyWords('two')).toEqual({ digit: '2', word: 'CUT 3F' });
    expect(keyWords('three')).toEqual({ digit: '3', word: 'SET' });
    for (const k of KEY_NAMES) expect(LABELS.deck.keys[k]).toBe(`${keyWords(k).digit} ${keyWords(k).word}`);
  });

  it('dims what is not lit, halves what is done or spent', () => {
    const ready = deckState(
      input({ regroup: { charges: 1, handedOver: true, left: 0 }, laundryCutAvailable: true }),
      0,
      true,
    );
    expect(keyAlpha(ready, 'one')).toBe(1);
    expect(keyAlpha(ready, 'two')).toBe(1);
    expect(keyAlpha(ready, 'three')).toBe(1);
    const later = deckState(
      input({
        now: C.c4 + 3,
        regroup: { charges: 0, handedOver: true, left: 0 },
        laundryCut: { at: C.c4 + 1 },
        notes: { estimate: 30, sizing: null },
      }),
      0,
      true,
    );
    expect(keyAlpha(later, 'one')).toBe(0.45);
    expect(keyAlpha(later, 'two')).toBe(0.45);
    expect(keyAlpha(later, 'three')).toBe(0.3);
  });
});

describe('the Regroup pulse', () => {
  const ready = input({ regroup: { charges: 1, handedOver: true, left: 0 } });

  it('pulses between 0.5 and 1 in play while ready', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 2; t += 0.05) {
      const p = deckState(ready, t, false).pulse;
      expect(p).toBeGreaterThanOrEqual(0.5);
      expect(p).toBeLessThanOrEqual(1);
      seen.add(Math.round(p * 100));
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(pulseAt(Math.PI / 2 / PULSE_RATE, false)).toBeCloseTo(1);
  });

  it('is steady at 1 under reduce flicker (the view flag)', () => {
    for (let t = 0; t < 3; t += 0.05) {
      expect(deckState(ready, t, true).pulse).toBe(1);
      expect(keyAlpha(deckState(ready, t, true), 'one')).toBe(1);
    }
  });

  it('does not pulse a key that is not ready', () => {
    for (let t = 0; t < 1; t += 0.1) expect(deckState(input(), t, false).pulse).toBe(1);
  });
});

describe('the guards: when a press acts', () => {
  const allReady = (over: Partial<DeckInput> = {}): DeckInput =>
    input({ regroup: { charges: 1, handedOver: true, left: 0 }, laundryCutAvailable: true, ...over });

  it('acts on a lit key with nothing in the way', () => {
    const s = deckState(allReady(), 0, true);
    for (const k of KEY_NAMES) expect(pressActs(s, k), k).toBe(true);
  });

  it('ignores every key while paused (the pause menu, a story scene, a failure)', () => {
    const s = deckState(allReady({ paused: true }), 0, true);
    expect(s.blocked).toBe(true);
    for (const k of KEY_NAMES) expect(pressActs(s, k), k).toBe(false);
  });

  it('ignores every key while the job card is open', () => {
    const s = deckState(allReady({ cardOpen: true, paused: true }), 0, true);
    for (const k of KEY_NAMES) expect(pressActs(s, k), k).toBe(false);
    // Even on a frame the card shows without the hold yet.
    expect(deckState(allReady({ cardOpen: true }), 0, true).blocked).toBe(true);
  });

  it('ignores every key while the Solace banner is up, and not once it is answered', () => {
    expect(bannerOpen(C.c2 + 1, null, false)).toBe(true);
    expect(bannerOpen(C.c2 + 1, { choice: 'pay', at: C.c2 + 2 }, false)).toBe(false);
    expect(bannerOpen(C.c2 + 1, null, true)).toBe(false);
    expect(bannerOpen(C.c3, null, false)).toBe(false);
    const up = deckState(allReady({ now: C.c2 + 1 }), 0, true);
    expect(up.bannerOpen).toBe(true);
    for (const k of KEY_NAMES) expect(pressActs(up, k), k).toBe(false);
  });

  it('never lets the dial card or the sizing prompt block a key: key 3 is how they are SET', () => {
    const c1 = deckState(allReady(), 0, true);
    expect(c1.dialOpen).toBe(true);
    expect(c1.blocked).toBe(false);
    expect(pressActs(c1, 'three')).toBe(true);
    const c6 = deckState(allReady({ now: C.c6 - 5, notes: { estimate: 30, sizing: null } }), 0, true);
    expect(c6.dialOpen).toBe(true);
    expect(c6.blocked).toBe(false);
    expect(pressActs(c6, 'three')).toBe(true);
  });

  it('SET does nothing unless a dial question is open and unlocked (answered)', () => {
    expect(pressActs(deckState(input({ notes: { estimate: 30, sizing: null } }), 0, true), 'three')).toBe(
      false,
    );
    expect(
      pressActs(deckState(input({ now: C.c3 + 5, notes: { estimate: 30, sizing: null } }), 0, true), 'three'),
    ).toBe(false);
    expect(keyLit(deckState(input(), 0, true), 'three')).toBe(true);
  });

  it('Regroup and the cut act only while ready', () => {
    const s = deckState(input({ regroup: { charges: 0, handedOver: true, left: 4 } }), 0, true);
    expect(pressActs(s, 'one')).toBe(false);
    expect(pressActs(s, 'two')).toBe(false);
  });
});

describe('where the keys sit', () => {
  it('puts the three 80x64 keys at (1272, 1022), (1360, 1022), (1448, 1022) inside ZONES.deck', () => {
    const r = keyRects();
    const centres = KEY_NAMES.map((k) => ({ x: r[k].x + r[k].w / 2, y: r[k].y + r[k].h / 2 }));
    expect(centres).toEqual([
      { x: 1272, y: 1022 },
      { x: 1360, y: 1022 },
      { x: 1448, y: 1022 },
    ]);
    for (const k of KEY_NAMES) {
      expect(r[k].w).toBe(80);
      expect(r[k].h).toBe(64);
      expect(inside(r[k], ZONES.deck), k).toBe(true);
    }
    // Right of the room-left bar.
    const bar = headroomLayout(ZONES.deck).plate;
    expect(r.one.x).toBeGreaterThanOrEqual(bar.x + bar.w);
    // The CUT tooltip's corner is in the deck's strip above the keys.
    const tip = tooltipAt(ZONES.deck);
    expect(tip.y).toBeGreaterThanOrEqual(ZONES.deck.y);
    expect(tip.x).toBeLessThanOrEqual(ZONES.deck.x + ZONES.deck.w);
  });
});

// ---- the view against a stub scene: a press by click or by digit goes through one handler ----

function stubScene() {
  const chain = (extra: Record<string, unknown> = {}): unknown => {
    const o: unknown = new Proxy(extra, {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        return () => o;
      },
    });
    return o;
  };
  const text = () => {
    let value = '';
    const t: Record<string, unknown> = {};
    t.setText = (s: string) => ((value = s), proxy);
    Object.defineProperty(t, 'text', { get: () => value });
    const proxy = chain(t);
    return proxy;
  };
  return { add: { graphics: () => chain(), text } };
}

describe('DeckView presses', () => {
  it('acts on SET through the dial only while the question is open and nothing blocks it', () => {
    newRun(1);
    const r = run();
    let sets = 0;
    const scene = stubScene();
    const view = new DeckView();
    // SET goes through the host (LiveHost.pressSet), never through the scene's private dial.
    view.create(scene as never, {
      scene: null as never,
      bus: new Bus(),
      rect: ZONES.deck,
      flags: { lite: true },
      pressSet: () => (sets++, true),
    });

    // The job card is up at the start: key 3 is ignored.
    view.update(readFrame(r), { now: 0, dt: 0 });
    view.press('three', 'key');
    expect(sets).toBe(0);

    // Card away, the C1 question open: the digit and the click both SET.
    dismissJobCard(r);
    view.update(readFrame(r), { now: 1, dt: 0.016 });
    expect(view.deck.set).toBe('ready');
    view.press('three', 'key');
    view.press('three', 'click');
    expect(sets).toBe(2);

    // Held by the pause menu: ignored.
    r.hold('pause');
    view.update(readFrame(r), { now: 2, dt: 0 });
    view.press('three', 'key');
    expect(sets).toBe(2);
    r.release('pause');

    // Answered: the question closes and key 3 does nothing.
    r.notes = { ...r.notes, estimate: 30 };
    view.update(readFrame(r), { now: 3, dt: 0.016 });
    view.press('three', 'key');
    expect(sets).toBe(2);

    const hud = hudSection({} as HudTestState) as unknown as {
      deck: { presses: { key: string; via: string; acted: boolean }[]; set: string; go: string };
    };
    expect(hud.deck.presses.map((p) => [p.via, p.acted])).toEqual([
      ['key', false],
      ['key', true],
      ['click', true],
      ['key', false],
      ['key', false],
    ]);
    expect(hud.deck.go).toBe(hud.deck.set);
    view.shutdown();
  });

  it('ignores Regroup until it is handed over, and mirrors hud.regroup and hud.laundry', () => {
    newRun(1);
    const r = run();
    dismissJobCard(r);
    const view = new DeckView();
    view.create(stubScene() as never, {
      scene: null as never,
      bus: new Bus(),
      rect: ZONES.deck,
      flags: { lite: true },
    });
    view.update(readFrame(r), { now: 1, dt: 0.016 });
    view.press('one', 'key');
    view.press('two', 'key');
    expect(r.play.regroup.left).toBe(0);
    expect(r.play.laundryCut).toBeNull();
    const hud = hudSection({} as HudTestState) as unknown as {
      regroup: { visible: boolean; active: boolean; spent: boolean };
      laundry: { available: boolean; cut: boolean };
    };
    expect(hud.regroup).toMatchObject({ visible: false, active: false, spent: false });
    expect(hud.laundry).toMatchObject({ available: false, cut: false });
    view.shutdown();
  });
});
