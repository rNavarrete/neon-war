import live from '../docs/LIVE.md?raw';
import busSource from '../src/game/bus.ts?raw';

// Tech follow-up 6: docs/LIVE.md is the lanes' contract, so it names what they share: the host's
// pressSet, the bus events with line.lesson and audience, and every hook section a view provides.

/** Every source file's text, by path. */
const SOURCES = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('docs/LIVE.md names the shared contract', () => {
  it('documents LiveHost.pressSet', () => {
    expect(live).toMatch(/### LiveHost\.pressSet/);
    expect(live).toMatch(/`pressSet\(\)`/);
  });

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

  it('lists every hud section a view provides', () => {
    const names = new Set<string>();
    for (const text of Object.values(SOURCES))
      for (const m of text.matchAll(/provideHud(?:Section|Part)\('(\w+)'/g)) names.add(m[1]);
    expect(names.size).toBeGreaterThan(10);
    for (const n of names) expect(live, `hud.${n}`).toContain(`hud.${n}`);
  });
});
