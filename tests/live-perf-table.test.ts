import live from '../docs/LIVE.md?raw';
import { createViews } from '../src/scenes/live/registry';
import { PlaceholderView } from '../src/scenes/live/view';

// Cross-lane swap 7: the per-zone table under "### Budgets" in docs/LIVE.md states each built
// view's declared budget, objects as well as texts (CommsView's 31 with the leader line and the caller cam's tile, 29 before layout A2, the cam's
// 15), and its texts still sum to the global 144 (110 until layout A2's sixteen-row chat and Lux's caption, Rolando 30
// Oct 2026).

interface Row {
  name: string;
  texts: number;
  objects: number | null;
}

function rows(): Row[] {
  const lines = live.split('\n');
  const at = lines.findIndex((l) => l.startsWith('### Budgets'));
  expect(at).toBeGreaterThan(0);
  const head = lines.findIndex((l, i) => i > at && l.startsWith('| Zone'));
  const out: Row[] = [];
  for (let i = head + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = lines[i].split('|').map((c) => c.trim());
    const objects = cells[3].replace(/\*/g, '');
    out.push({
      name: cells[1],
      texts: Number(cells[2].replace(/\*/g, '')),
      objects: objects === '-' || objects === '' ? null : Number(objects),
    });
  }
  return out;
}

describe('docs/LIVE.md budget table matches the built views', () => {
  it("states each built view's declared objects and texts", () => {
    const r = rows();
    let checked = 0;
    for (const v of createViews()) {
      if (v instanceof PlaceholderView) continue;
      const row = r.find((x) => x.name.startsWith(`\`${v.zone}\``));
      expect(row, v.zone).toBeDefined();
      expect(row!.objects, `${v.zone} objects`).toBe(v.budget.objects);
      expect(row!.texts, `${v.zone} texts`).toBe(v.budget.texts);
      checked++;
    }
    expect(checked).toBeGreaterThan(8);
  });

  it('names CommsView at 31 objects', () => {
    const comms = rows().find((x) => x.name.startsWith('`comms`'));
    // 29 until layout A2's caller cam (Rolando, 30 Oct 2026) added its tile and face.
    expect(comms?.objects).toBe(31);
  });

  it('keeps the texts total at the global 144', () => {
    const r = rows();
    const total = r.find((x) => x.name.includes('Total'))!;
    expect(total.texts).toBe(144);
    expect(r.filter((x) => x !== total).reduce((n, x) => n + x.texts, 0)).toBe(144);
  });
});
