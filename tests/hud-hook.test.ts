import { type HudTestState, hudSection, hudSectionNames, provideHudSection } from '../src/scenes/hud/hook';

// provideHudSection (src/scenes/hud/hook.ts): a view file adds one hud.* key without editing
// HudScene.ts or src/testHook.ts, and the hook publishes `hud` as one snapshot, the scene's own keys
// with every provided key laid over them.

/** A fresh stand-in for HudScene's own snapshot (only the keys these tests read). */
const base = (): HudTestState => ({ ready: true, now: 12 }) as unknown as HudTestState;

const read = (h: HudTestState): Record<string, unknown> => h as unknown as Record<string, unknown>;

describe('provideHudSection', () => {
  it('shows two sections provided from two files together under hud, over the scene’s own keys', () => {
    // Two sections, as two view files provide them (panel.ts's provideHudPart shim is retired).
    const offTitle = provideHudSection('title', () => ({
      live: 'live',
      watching: 3,
      right: 400,
      clockRight: 1790,
    }));
    const offDial = provideHudSection('dialCard', () => ({
      dimmed: false,
      label: 'HOW MANY A SECOND?',
    }));
    const h = read(hudSection(base()));
    expect(h.ready).toBe(true);
    expect(h.now).toBe(12);
    expect(h.title).toEqual({ live: 'live', watching: 3, right: 400, clockRight: 1790 });
    expect(h.dialCard).toEqual({ dimmed: false, label: 'HOW MANY A SECOND?' });
    offTitle();
    offDial();
    expect(hudSectionNames()).toEqual([]);
  });

  it('replacing one section leaves the other, and a stale remover does not take the replacement out', () => {
    const offA = provideHudSection('title', () => ({
      live: 'held',
      watching: null,
      right: 0,
      clockRight: null,
    }));
    const offB = provideHudSection('dialCard', () => ({ dimmed: true, label: 'your guess stays free' }));
    const offA2 = provideHudSection('title', () => ({
      live: 'live',
      watching: 2,
      right: 0,
      clockRight: null,
    }));
    let h = read(hudSection(base()));
    expect((h.title as { live: string }).live).toBe('live');
    expect(h.dialCard).toEqual({ dimmed: true, label: 'your guess stays free' });
    // The first provider's remover is stale: the replacement stays.
    offA();
    h = read(hudSection(base()));
    expect((h.title as { watching: number }).watching).toBe(2);
    offA2();
    h = read(hudSection(base()));
    expect(h.title).toBeUndefined();
    expect(h.dialCard).toEqual({ dimmed: true, label: 'your guess stays free' });
    offB();
    expect(read(hudSection(base())).dialCard).toBeUndefined();
  });

  it('reads each section every time the hook is read', () => {
    let n = 0;
    const off = provideHudSection('title', () => ({
      live: 'live',
      watching: ++n,
      right: 0,
      clockRight: null,
    }));
    expect((read(hudSection(base())).title as { watching: number }).watching).toBe(1);
    expect((read(hudSection(base())).title as { watching: number }).watching).toBe(2);
    off();
  });
});
