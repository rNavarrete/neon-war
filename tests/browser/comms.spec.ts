import { type Page, expect, test } from '@playwright/test';
import type { CommsTestState } from '../../src/scenes/live/views/comms';
import { dismissJobCard, hud, openBoard, setDial, shot } from './live/reach';

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

// comms-3: the reread log. A click on the band pins it (it stays open across a new line and clicks
// elsewhere), the replay glyph re-requests the newest line's voice, a 400 ms hover opens it with
// exactly the last three shown lines, leaving closes it, and a tray card dragged across the band
// never opens it.
test('the reread log: pin, a new line under it, replay, hover, leave, and no log during a drag', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { errors } = await openBoard(page, { speed: 4, autopilot: false });
  await dismissJobCard(page);
  await expect
    .poll(async () => (await comms(page)).history, { timeout: 40_000, intervals: [50] })
    .toEqual(['C1.triage.01', 'C1.triage.02']);
  let c = await comms(page);
  expect(c.log.open).toBe(false);
  expect(c.log.pinned).toBe(false);

  await test.step('a click on the band pins the log; it stays open off the band and across a new line', async () => {
    await page.mouse.click(c.log.band.x, c.log.band.y);
    await expect.poll(async () => (await comms(page)).log.pinned).toBe(true);
    await page.mouse.move(c.log.outside.x, c.log.outside.y);
    await page.waitForTimeout(600);
    c = await comms(page);
    expect(c.log.open).toBe(true);
    expect(c.log.lines.map((l) => l.id)).toEqual(['C1.triage.01', 'C1.triage.02']);
    expect(c.log.lines.map((l) => l.name)).toEqual(['TRIAGE', 'TRIAGE']);
    // Set the dial (clicks off the band): Lux and TRIAGE answer while the log stays pinned.
    await setDial(page, 30);
    await expect
      .poll(async () => (await comms(page)).history, { timeout: 30_000, intervals: [50] })
      .toContain('C1.lux.01');
    c = await comms(page);
    expect(c.log.pinned).toBe(true);
    expect(c.log.open).toBe(true);
    expect(c.log.lines.map((l) => l.id)).toEqual(c.history.slice(-3));
    expect(c.log.lines).toContainEqual({ id: 'C1.lux.01', name: 'LUX', text: 'You multiplied. Divide.' });
    await shot(page, 'comms-log');
  });

  await test.step('the replay glyph re-requests the newest line', async () => {
    // Let the SET answers play out (nothing more comes until a box is built), so the newest holds.
    await expect
      .poll(
        async () => {
          const n = await comms(page);
          return n.queue.length === 0 && n.history.includes('C1.triage.05');
        },
        { timeout: 30_000, intervals: [50] },
      )
      .toBe(true);
    c = await comms(page);
    const newest = c.log.lines.at(-1)!.id;
    expect(newest).toBe(c.history.at(-1));
    await page.mouse.click(c.log.replay.x, c.log.replay.y);
    await expect.poll(async () => (await comms(page)).log.replayed).toEqual([newest]);
    c = await comms(page);
    expect(c.emitted).toContain(`voice:${newest}`);
    // The glyph is not the band: the log stays pinned.
    expect(c.log.pinned).toBe(true);
  });

  await test.step('the next click on the band unpins it, and leaving closes it', async () => {
    await page.mouse.click(c.log.band.x, c.log.band.y);
    await expect.poll(async () => (await comms(page)).log.pinned).toBe(false);
    await page.mouse.move(c.log.outside.x, c.log.outside.y);
    await expect.poll(async () => (await comms(page)).log.open).toBe(false);
  });

  await test.step('a 400 ms hover opens exactly the last three shown lines, newest last', async () => {
    await expect
      .poll(async () => (await comms(page)).history.length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);
    await page.mouse.move(c.log.band.x, c.log.band.y);
    await expect.poll(async () => (await comms(page)).log.open, { intervals: [25] }).toBe(true);
    c = await comms(page);
    expect(c.log.pinned).toBe(false);
    const shown = [...c.history, ...(c.line && c.history.at(-1) !== c.line.id ? [c.line.id] : [])];
    expect(c.log.lines.map((l) => l.id)).toEqual(shown.slice(-3));
    expect(c.log.lines).toHaveLength(3);
    await page.mouse.move(c.log.outside.x, c.log.outside.y);
    await expect.poll(async () => (await comms(page)).log.open).toBe(false);
  });

  await test.step('dragging a tray card across the band does not open the log', async () => {
    const board = await page.evaluate(
      () =>
        (
          window.__neonTest!.state as unknown as {
            board: {
              tray: { id: string; x: number; y: number }[];
              slots: { id: string; x: number; y: number }[];
            };
          }
        ).board,
    );
    const card = board.tray.find((t) => t.id === 'server')!;
    const slot = board.slots.find((s) => s.id === 's1')!;
    await page.mouse.move(card.x, card.y);
    await page.mouse.down();
    await page.mouse.move(c.log.band.x, c.log.band.y, { steps: 4 });
    // Linger over the band well past the 400 ms hover.
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(100);
      expect((await comms(page)).log.open, `drag over the band, ${(i + 1) * 100} ms`).toBe(false);
    }
    await page.mouse.move(slot.x, slot.y, { steps: 4 });
    await page.mouse.up();
    // It was a real drag: the server landed in the slot.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window.__neonTest!.state as unknown as {
                board: { slots: { id: string; part: string | null }[] };
              }
            ).board.slots.find((s) => s.id === 's1')?.part ?? null,
        ),
      )
      .not.toBeNull();
    c = await comms(page);
    expect(c.log.open).toBe(false);
    expect(c.log.pinned).toBe(false);
  });

  expect(errors).toEqual([]);
});
