import { Bus } from '../src/game/bus';
import { readFrame } from '../src/game/frame';
import { Run, newRun, run } from '../src/game/run';
import { dismissJobCard } from '../src/scenes/hud/jobCard';
import { AlertView } from '../src/scenes/hud/AlertView';
import { DeckView } from '../src/scenes/hud/DeckView';
import { ZONES } from '../src/scenes/live/layout';
import { surgeWarningAt } from '../src/scenes/hud/warnings';
import { BROWNOUT } from '../src/sim/brownout';
import hudSource from '../src/scenes/HudScene.ts?raw';
import deckSource from '../src/scenes/hud/DeckView.ts?raw';

// M2 follow-up (tech): the HUD scene's legacy alert band and deck keys are gone. AlertView is the
// one band and plays the forecast's surge-warning itself; DeckView owns the keys and the digits, and
// the scene reads hud.laundry, hud.regroup and the deck's bounds from it.

const C = BROWNOUT.challenges;

/** A scene stub whose every call returns another stub (enough for the views' create and update). */
function stubScene(): unknown {
  // Callable and indexable at once: scene.textures.exists(...), add.text(...).setOrigin(...), and so on.
  const chain = (extra: Record<string, unknown> = {}): unknown => {
    const target = Object.assign(() => o, extra);
    const o: unknown = new Proxy(target, {
      get(_t, prop) {
        if (prop in extra) return extra[prop as string];
        if (prop === 'then') return undefined;
        if (prop === Symbol.toPrimitive) return () => 0;
        return o;
      },
      apply: () => o,
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
  return chain({ add: chain({ text }), game: { loop: { time: 0 } } });
}

describe('the HUD scene draws no legacy alert band or deck', () => {
  it('builds neither, sets no key and listens for no digit', () => {
    for (const gone of [
      'buildAlert',
      'buildDeck',
      'setKey',
      'pressRegroup',
      'pressCut',
      'updateLaundry',
      'updateRegroup',
      'keydown-ONE',
      'keydown-TWO',
      'keydown-THREE',
      "'surge-warning'",
      'TOP.',
    ]) {
      expect(hudSource.includes(gone), gone).toBe(false);
    }
  });
});

describe('AlertView plays the forecast sound on its own', () => {
  it('emits surge-warning once when the surge forecast goes up', () => {
    const r = new Run();
    r.now = C.c4 - 12;
    expect(surgeWarningAt(r.now)).not.toBeNull();
    const bus = new Bus();
    const sounds: string[] = [];
    bus.on('sfx', (e) => sounds.push(e.key));
    const view = new AlertView();
    view.create(stubScene() as never, {
      scene: null as never,
      bus,
      rect: ZONES.alert,
      flags: { lite: true },
    });
    const f = readFrame(r);
    view.update(f, { now: 1, dt: 0.016 });
    expect(view.state.kind).toBe('forecast');
    expect(sounds).toEqual(['surge-warning']);
    view.update(f, { now: 1.02, dt: 0.016 });
    expect(sounds).toEqual(['surge-warning']);
    expect(view.container).not.toBeNull();
    view.shutdown();
    expect(view.container).toBeNull();
  });
});

describe('DeckView feeds hud.laundry, hud.regroup and the deck bounds', () => {
  it('reports the hidden keys before the surge and the crew', () => {
    const r = new Run();
    r.now = C.c1;
    const view = new DeckView();
    view.create(stubScene() as never, {
      scene: null as never,
      bus: new Bus(),
      rect: ZONES.deck,
      flags: { lite: true },
    });
    view.update(readFrame(r), { now: 1, dt: 0.016 });
    expect(view.laundryHook()).toMatchObject({ available: false, cut: false });
    expect(view.regroupHook()).toMatchObject({ visible: false, active: false, spent: false });
    // One hit area per key, in 1, 2, 3 order.
    expect(view.keyHits()).toHaveLength(3);
    view.shutdown();
    expect(view.keyHits()).toEqual([]);
  });
});

describe('the deck presses SET through the host', () => {
  it('calls LiveHost.pressSet, and does nothing on a host without one', () => {
    newRun(1);
    dismissJobCard(run());
    let sets = 0;
    const view = new DeckView();
    view.create(stubScene() as never, {
      scene: null as never,
      bus: new Bus(),
      rect: ZONES.deck,
      flags: { lite: true },
      pressSet: () => (sets++, true),
    });
    view.update(readFrame(run()), { now: 1, dt: 0.016 });
    view.press('three', 'click');
    expect(sets).toBe(1);
    expect(view.snapshot().presses.at(-1)).toMatchObject({ key: 'three', acted: true });
    view.shutdown();

    const bare = new DeckView();
    bare.create(stubScene() as never, {
      scene: null as never,
      bus: new Bus(),
      rect: ZONES.deck,
      flags: { lite: true },
    });
    bare.update(readFrame(run()), { now: 1, dt: 0.016 });
    bare.press('three', 'click');
    expect(bare.snapshot().presses.at(-1)).toMatchObject({ key: 'three', acted: false });
    bare.shutdown();
  });

  it('reaches no private dial on the scene', () => {
    expect(deckSource).not.toMatch(/DialHolder|\.dial\?\./);
  });
});
