import live from '../docs/LIVE.md?raw';
import busSource from '../src/game/bus.ts?raw';
import frameSource from '../src/game/frame.ts?raw';
import { ZONES, ZONE_IDS } from '../src/scenes/live/layout';
import { BOARD_ZONES, REGISTRY } from '../src/scenes/live/registry';

// Tech follow-up 6: docs/LIVE.md is the lanes' contract, so it names what they share: the bus events with line.lesson and audience, and every hook section a view provides.

/** Every source file's text, by path. */
const SOURCES = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('docs/LIVE.md names the shared contract', () => {
  it('documents line.lesson, audience and the drag verdict', () => {
    expect(live).toMatch(/\*\*`line\.lesson`\.\*\*/);
    expect(live).toMatch(/\*\*`audience`\.\*\*/);
    expect(live).toMatch(/\*\*`drag\.state` and `drag\.legal`\.\*\*/);
  });

  it('names every bus event of the Live screen', () => {
    const live0 = busSource.indexOf('the Live screen (docs/LIVE.md)');
    const events = [...busSource.slice(live0).matchAll(/^ {2}(\w+): /gm)].map((m) => m[1]);
    expect(events.length).toBeGreaterThan(10);
    for (const e of events) expect(live, e).toContain(`\`${e}`);
  });

  it('documents every ZONES rect with its numbers', () => {
    for (const id of ZONE_IDS) {
      const r = ZONES[id];
      const row = new RegExp(
        `^\\| \`${id}\`\\s*\\|\\s*${r.x}\\s*\\|\\s*${r.y}\\s*\\|\\s*${r.w}\\s*\\|\\s*${r.h}\\s*\\|`,
        'm',
      );
      expect(live, `ZONES.${id}`).toMatch(row);
    }
  });

  it('has a row for every bus event in GameEvents, old and new', () => {
    const body = busSource.slice(busSource.indexOf('export interface GameEvents {'));
    const events = [...body.slice(0, body.indexOf('\n}\n')).matchAll(/^ {2}(\w+): /gm)].map((m) => m[1]);
    expect(events.length).toBeGreaterThan(20);
    for (const e of events) expect(live, `bus event ${e}`).toMatch(new RegExp(`^\\| \`${e}\` \\|`, 'm'));
  });

  it('has a row for every Frame field', () => {
    const body = frameSource.slice(frameSource.indexOf('export interface Frame {'));
    const fields = [...body.slice(0, body.indexOf('\n}\n')).matchAll(/^ {2}readonly (\w+)/gm)].map(
      (m) => m[1],
    );
    expect(fields.length).toBeGreaterThan(30);
    for (const f of fields) expect(live, `Frame.${f}`).toMatch(new RegExp(`^\\| \`${f}\` \\|`, 'm'));
  });

  it('lists every top-level hook section', () => {
    const names = new Set<string>();
    for (const text of Object.values(SOURCES))
      for (const m of text.matchAll(/provideTestState\('(\w+)'/g)) names.add(m[1]);
    expect(names.size).toBeGreaterThan(5);
    for (const n of names) expect(live, `section ${n}`).toMatch(new RegExp(`^\\| \`${n}\``, 'm'));
  });

  it('has the per-lane ownership table naming every lane and the zones it draws', () => {
    const at = live.indexOf('## Lanes and ownership');
    expect(at).toBeGreaterThan(0);
    const table = live.slice(at, live.indexOf('\n## ', at + 1));
    const lanes = new Set<string>(['tech', 'board', 'art3d', ...REGISTRY.map((e) => e.lane)]);
    for (const lane of lanes) expect(table, `lane ${lane}`).toMatch(new RegExp(`^\\| ${lane} \\|`, 'm'));
    for (const e of REGISTRY) {
      const row = table.split('\n').find((l) => l.startsWith(`| ${e.lane} |`))!;
      expect(row.split('|')[2], `${e.lane} draws ${e.zone}`).toContain(`\`${e.zone}\``);
    }
    for (const z of BOARD_ZONES) expect(table).toMatch(new RegExp(`^\\| board \\| .*\`${z}\``, 'm'));
  });

  it('lists every hud section a view provides', () => {
    const names = new Set<string>();
    for (const text of Object.values(SOURCES))
      for (const m of text.matchAll(/provideHud(?:Section|Part)\('(\w+)'/g)) names.add(m[1]);
    expect(names.size).toBeGreaterThan(10);
    for (const n of names) expect(live, `hud.${n}`).toContain(`hud.${n}`);
  });
});
