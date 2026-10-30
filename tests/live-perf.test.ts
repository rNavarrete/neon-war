import live from '../docs/LIVE.md?raw';
import {
  COUNTED_FILTERS,
  type CountedObject,
  PERF_SAMPLE_MS,
  PerfMeter,
  countDisplayList,
  countFilters,
  overBudget,
  registerPool,
} from '../src/scenes/live/hook';
import type { ZoneId } from '../src/scenes/live/layout';
import { createViews } from '../src/scenes/live/registry';
import { PlaceholderView } from '../src/scenes/live/view';

// The perf meter (tech-7): display-list walks into containers, per-zone counts against each view's
// declared budget, pools, filters, the frame rate and frame time, once a second.

const text = (visible = true): CountedObject => ({ type: 'Text', visible });
const image = (visible = true): CountedObject => ({ type: 'Image', visible });
const container = (list: CountedObject[], visible = true): CountedObject => ({
  type: 'Container',
  list,
  visible,
});
const glow = { active: true, renderNode: 'FilterGlow' };
const blur = { active: true, renderNode: 'FilterBlur' };

describe('display-list walks', () => {
  it('counts container children as objects too', () => {
    const list = [image(), container([text(), text(), { type: 'Graphics' }]), text()];
    expect(countDisplayList(list)).toEqual({ objects: 6, texts: 3, graphics: 1 });
  });

  it('counts only live Glow and GradientMap filters', () => {
    expect(COUNTED_FILTERS).toEqual(['FilterGlow', 'FilterGradientMap']);
    const o = {
      filters: {
        internal: { list: [glow, blur, { active: false, renderNode: 'FilterGlow' }] },
        external: { list: [{ active: true, renderNode: 'FilterGradientMap' }] },
      },
    };
    expect(countFilters(o)).toBe(2);
    expect(countFilters({})).toBe(0);
    expect(countFilters({ filters: null })).toBe(0);
  });
});

describe('PerfMeter', () => {
  const views = [
    { zone: 'comms' as ZoneId, budget: { objects: 3, texts: 2 } },
    { zone: 'map' as ZoneId, budget: { objects: 1, texts: 0 } },
  ];

  it('samples once a second of real time and reports the frame rate and frame time', () => {
    const m = new PerfMeter(true);
    let due = false;
    for (let i = 0; i < 59; i++) due = m.frame(16);
    expect(due).toBe(false);
    expect(m.frame(100)).toBe(true);
    expect(PERF_SAMPLE_MS).toBe(1000);
    const s = m.sample({ now: 0, board: [], hud: [], cameras: [], views: [], ownerOf: () => undefined });
    // 60 frames in 1044 ms.
    expect(s.fps.avg).toBe(57.5);
    expect(s.frameMs).toBe(17.4);
    expect(s.samples).toBe(1);
    expect(s.lite).toBe(true);
    expect(m.frame(16)).toBe(false);
  });

  it('attributes each HUD object to the view that made it, children with their container', () => {
    const band = container([text(), text(false), image()]);
    const pin = image();
    const hostCard = container([text(false), text(false)], false);
    const owners = new Map<CountedObject, ZoneId>([
      [band, 'comms'],
      [pin, 'map'],
    ]);
    const m = new PerfMeter(false);
    const s = m.sample({
      now: 310,
      board: [image(), text(), container([text(false)])],
      hud: [band, pin, hostCard],
      cameras: [],
      views,
      ownerOf: (o) => owners.get(o),
    });
    expect(s.objects).toEqual({ board: 4, hud: 8 });
    expect(s.textsBy).toEqual({ board: 2, hud: 4 });
    expect(s.texts).toBe(6);
    // Hidden objects, and everything inside a hidden container, are not drawn.
    expect(s.drawn).toEqual({ objects: 3 + 4, texts: 1 + 1 });
    expect(s.zones.comms).toEqual({ budget: { objects: 3, texts: 2 }, actual: { objects: 4, texts: 2 } });
    expect(s.zones.map).toEqual({ budget: { objects: 1, texts: 0 }, actual: { objects: 1, texts: 0 } });
    expect(s.host).toEqual({ objects: 3, texts: 2 });
    expect(overBudget(s)).toEqual(['comms']);
    // The sample says when in the night it was taken.
    expect(s.at).toBe(310);
  });

  it('a child a view made inside the host container counts as the view', () => {
    const own = text();
    const owners = new Map<CountedObject, ZoneId>([[own, 'comms']]);
    const s = new PerfMeter(false).sample({
      now: 0,
      board: [],
      hud: [container([own, text()])],
      cameras: [],
      views,
      ownerOf: (o) => owners.get(o),
    });
    expect(s.zones.comms!.actual).toEqual({ objects: 1, texts: 1 });
    expect(s.host).toEqual({ objects: 2, texts: 1 });
    expect(overBudget(s)).toEqual([]);
  });

  it('counts filters on objects and cameras, and reads every registered pool', () => {
    let packets = 12;
    const off = registerPool('packets', () => packets);
    const m = new PerfMeter(false);
    const input = {
      now: 0,
      board: [{ type: 'Image', filters: { internal: { list: [glow] }, external: { list: [] } } }],
      hud: [],
      cameras: [{ filters: { internal: { list: [] }, external: { list: [glow, blur] } } }],
      views: [],
      ownerOf: () => undefined,
    };
    let s = m.sample(input);
    expect(s.filters).toBe(2);
    expect(s.pools.packets).toBe(12);
    packets = 40;
    s = m.sample(input);
    expect(s.pools.packets).toBe(40);
    expect(s.samples).toBe(2);
    off();
    s = m.sample(input);
    expect(s.pools).toEqual({});
  });

  it('reuses one section object across samples', () => {
    const m = new PerfMeter(false);
    const input = { now: 0, board: [], hud: [], cameras: [], views, ownerOf: () => undefined };
    const a = m.sample(input);
    const zones = a.zones.comms;
    const b = m.sample(input);
    expect(b).toBe(a);
    expect(b.zones.comms).toBe(zones);
  });
});

describe('the per-zone budget table in docs/LIVE.md', () => {
  /** The rows of the table under "### Budgets": first cell and the Texts column. */
  function rows(): { name: string; texts: number }[] {
    const lines = live.split('\n');
    const at = lines.findIndex((l) => l.startsWith('### Budgets'));
    expect(at).toBeGreaterThan(0);
    const head = lines.findIndex((l, i) => i > at && l.startsWith('| Zone'));
    const out: { name: string; texts: number }[] = [];
    for (let i = head + 2; i < lines.length && lines[i].startsWith('|'); i++) {
      const cells = lines[i].split('|').map((c) => c.trim());
      out.push({ name: cells[1], texts: Number(cells[2].replace(/\*/g, '')) });
    }
    return out;
  }

  // 144 since layout A2's sixteen-row chat and Lux's cam caption (Rolando, 30 Oct 2026: a chat about half the screen); 110 before.
  it('gives every zone a text budget, and they sum to the global 144', () => {
    const r = rows();
    const total = r.find((x) => x.name.includes('Total'))!;
    const zones = r.filter((x) => x !== total);
    expect(total.texts).toBe(144);
    expect(zones.reduce((n, x) => n + x.texts, 0)).toBe(144);
    for (const z of [
      'title',
      'alert',
      'clock',
      'map',
      'cam',
      'gauge',
      // No 'scope': the LAST 60 s chart is gone (30 Oct 2026); its 5 texts went to the tip alert.
      'comms',
      'deck',
      'chat',
      'feed',
    ]) {
      expect(
        zones.some((x) => x.name.includes(`\`${z}\``)),
        z,
      ).toBe(true);
    }
  });

  it("matches each built view's declared text budget", () => {
    const r = rows();
    for (const v of createViews()) {
      if (v instanceof PlaceholderView) continue;
      const row = r.find((x) => x.name.startsWith(`\`${v.zone}\``));
      expect(row?.texts, v.zone).toBe(v.budget.texts);
    }
  });
});
