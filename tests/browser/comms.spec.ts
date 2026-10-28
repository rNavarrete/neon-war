import { type Page, expect, test } from '@playwright/test';
import type { CommsTestState } from '../../src/scenes/live/views/comms';
import { dismissJobCard, hud, openBoard, shot } from './live/reach';

// The comms band (comms-2, comms-3): every bark shows in ZONES.comms with its speaker, tag and typed
// line, the five slots sit inside the band, hud.bark keeps answering as before, and the band never
// draws outside its zone. Asserted on window.__neonTest.state.hud.comms.

async function comms(page: Page): Promise<CommsTestState> {
  const h = await hud(page);
  if (!h.comms) throw new Error('hud.comms is missing: is the comms view registered?');
  return h.comms;
}

type R = { x: number; y: number; w: number; h: number };
const EPS = 1;
const insideRect = (a: R, b: R): boolean =>
  a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS;

test('the band shows C1.triage.02 with its speaker and tag, five slots inside it, hud.bark unchanged', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { errors } = await openBoard(page, { speed: 4, autopilot: false });
  let c = await comms(page);
  expect(c.line).toBeNull();
  expect(c.slots.map((s) => s.name)).toEqual(['TRIAGE', 'REI', 'MIKA', 'OZZIE', 'HOUSE']);
  await dismissJobCard(page);

  // Every line the band shows gets at least 4 s; record each line's since/until as it shows.
  const spans = new Map<string, number>();
  await expect
    .poll(
      async () => {
        const n = await comms(page);
        if (n.line) spans.set(n.line.id, n.line.until - n.line.since);
        return n.line?.id ?? null;
      },
      { timeout: 40_000, intervals: [50] },
    )
    .toBe('C1.triage.02');
  const h = await hud(page);
  c = h.comms!;
  // hud.bark keeps the ids and text it always had.
  expect(h.bark.current).toBe('C1.triage.02');
  expect(h.bark.text).toBe("480 a second! I'm great at math.");
  expect(h.bark.history).toEqual(['C1.triage.01', 'C1.triage.02']);
  expect(h.paused).toBe(false);

  const line = c.line!;
  expect(line.id).toBe('C1.triage.02');
  expect(line.speaker).toBe('TRIAGE (wrong-and-proud)');
  expect(line.name).toBe('TRIAGE');
  expect(line.tag).toBe('HINT');
  expect(line.text).toBe("480 a second! I'm great at math.");
  expect(line.until - line.since).toBeGreaterThanOrEqual(4 - 1e-6);
  expect(line.typed).toBeGreaterThanOrEqual(0);
  expect(line.typed).toBeLessThanOrEqual(line.text.length);
  expect(line.voiced).toBe(false);
  for (const [id, span] of spans) expect(span, id).toBeGreaterThanOrEqual(4 - 1e-6);
  // One line at a time: the first ended before the second started.
  expect(c.history).toEqual(['C1.triage.01', 'C1.triage.02']);
  expect(c.emitted.slice(0, 3)).toEqual(['line:C1.triage.01', 'lineEnd:C1.triage.01', 'line:C1.triage.02']);
  expect(c.triage).toEqual({ mood: 'wrong-and-proud' });
  expect(c.slots.find((s) => s.name === 'TRIAGE')!.speaking).toBe(true);

  // The typing finishes on its own; a click never needed.
  await expect
    .poll(async () => (await comms(page)).line?.typingDone ?? true, { timeout: 10_000, intervals: [50] })
    .toBe(true);

  // Five slots, inside the band; the crew dark before the rescue.
  const live = await page.evaluate(
    () => (window.__neonTest!.state as unknown as { live: { zones: Record<string, R> } }).live,
  );
  const band = live.zones.comms;
  expect(c.rect).toEqual(band);
  for (const s of c.slots) {
    expect(insideRect({ x: s.x - s.r, y: s.y - s.r, w: 2 * s.r, h: 2 * s.r }, band), s.name).toBe(true);
  }
  expect(c.slots.filter((s) => !s.present).map((s) => s.name)).toEqual(['REI', 'MIKA', 'OZZIE']);

  // The band draws nothing outside x 455-1910, y 645-795, and is the only piece homed there.
  expect(insideRect(c.drawn, band)).toBe(true);
  const homed = h.bounds.filter((b) => b.home === 'comms');
  expect(homed.map((b) => b.id)).toEqual(['comms']);
  expect(insideRect(homed[0].rect, band)).toBe(true);
  expect(live.zones.comms).toBeDefined();
  const placeholders = await page.evaluate(
    () => (window.__neonTest!.state as unknown as { live: { placeholders: string[] } }).live.placeholders,
  );
  expect(placeholders).not.toContain('comms');

  await shot(page, 'comms-c1');
  await shot(page, 'live-m2-comms');
  expect(errors).toEqual([]);
});
