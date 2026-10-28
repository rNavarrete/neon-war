import { type Page, expect, test } from '@playwright/test';
import type { LiveTestState, PerfTestState } from '../../src/scenes/live/hook';
import { CARDS, LAYOUT_VERSION, ZONES, ZONE_IDS, pageRect } from '../../src/scenes/live/layout';
import { dismissJobCard, openBoard, reach, shot } from './live/reach';

// The Live screen's skeleton (tech-3): the twelve zones reported on the page, the placeholders the
// registry still draws, and the perf section, asserted on window.__neonTest.state.live and .perf.

type Sections = { live: LiveTestState; perf: PerfTestState };

async function sections(page: Page): Promise<Sections> {
  return page.evaluate(() => {
    const s = window.__neonTest!.state as unknown as Partial<Sections>;
    return { live: s.live!, perf: s.perf! };
  });
}

test('the Live skeleton: zones on the page, ten placeholders, perf numbers and lite under ?test', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/?test&scene=board');
  await expect
    .poll(() => page.evaluate(() => window.__neonTest?.state.hud?.ready ?? false), { timeout: 15_000 })
    .toBe(true);
  expect(errors).toEqual([]);

  // The canvas as the page lays it out: at 1280x720 the 16:9 game fills the viewport.
  const canvas = await page.evaluate(() => {
    const r = document.querySelector('canvas')!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  expect(canvas.width).toBeGreaterThan(0);
  expect(canvas.height).toBeGreaterThan(0);

  const { live, perf } = await sections(page);
  expect(live.layoutVersion).toBe(LAYOUT_VERSION);
  expect(live.layoutVersion).toBe(1);
  expect(Object.keys(live.zones)).toEqual(ZONE_IDS);
  for (const zone of ZONE_IDS) expect(live.zones[zone], zone).toEqual(pageRect(ZONES[zone], canvas));
  // Every zone lands inside the canvas.
  for (const zone of ZONE_IDS) {
    const z = live.zones[zone];
    expect(z.x, zone).toBeGreaterThanOrEqual(canvas.left);
    expect(z.y, zone).toBeGreaterThanOrEqual(canvas.top);
    expect(z.x + z.w, zone).toBeLessThanOrEqual(canvas.left + canvas.width + 0.1);
    expect(z.y + z.h, zone).toBeLessThanOrEqual(canvas.top + canvas.height + 0.1);
  }
  expect(live.placeholders).toEqual(['cam']);

  for (const n of [perf.objects.board, perf.objects.hud, perf.texts, perf.graphics, perf.fps.avg]) {
    expect(typeof n).toBe('number');
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  }
  // Ten placeholders: a Graphics and a Text each, on the HUD's list, under the HUD's own objects.
  expect(perf.objects.hud).toBeGreaterThanOrEqual(20);
  expect(perf.texts).toBeGreaterThanOrEqual(10);
  expect(perf.graphics).toBeGreaterThanOrEqual(10);
  expect(perf.objects.board).toBeGreaterThan(0);
  expect(perf.lite).toBe(true);

  await page.screenshot({ path: 'test-results/screens/live-skeleton.png' });
  expect(errors).toEqual([]);
});

// tech-6: the reach helpers (tests/browser/live/reach.ts) get to the surge and to midnight at speed 20
// with autopilot inside their budgets. Each test records its wall-clock seconds as annotations
// ('boot' and 'reach'); docs/LIVE.md ("Browser test budget") lists the measured floors.

test('reach surge at speed 20 with autopilot: surge.startsAt 300 seen and now >= 300 within 25 s', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const t0 = Date.now();
  const { errors } = await openBoard(page, { speed: 20, autopilot: true });
  const boot = (Date.now() - t0) / 1000;
  const r = await reach(page, 'surge', { timeout: 25_000 });
  testInfo.annotations.push(
    { type: 'boot', description: `${boot.toFixed(1)} s` },
    {
      type: 'reach',
      description: `reach('surge') ${r.seconds.toFixed(1)} s (hud.now ${r.hud.now.toFixed(1)})`,
    },
  );
  expect(r.seen.surgeAt300).toBe(true);
  expect(r.seen.surgeStartsAt).toContain(300);
  expect(r.hud.now).toBeGreaterThanOrEqual(300);
  expect(r.seconds).toBeLessThan(25);
  await shot(page, 'live-reach-surge');
  expect(errors).toEqual([]);
});

test('reach midnight at speed 20 with autopilot: clock 00:00 within 50 s, the rescue clicked through', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const t0 = Date.now();
  const { errors } = await openBoard(page, { speed: 20, autopilot: true });
  const boot = (Date.now() - t0) / 1000;
  const r = await reach(page, 'midnight', { timeout: 50_000 });
  testInfo.annotations.push(
    { type: 'boot', description: `${boot.toFixed(1)} s` },
    {
      type: 'reach',
      description: `reach('midnight') ${r.seconds.toFixed(1)} s (hud.now ${r.hud.now.toFixed(1)}, scenes ${r.scenes.join(',')})`,
    },
  );
  expect(r.hud.clock).toMatch(/^00:00/);
  expect(r.seconds).toBeLessThan(50);
  // The crew's rescue holds the run on the way; the helper clicked it through itself.
  expect(r.scenes).toContain('C5');
  expect(r.snap.story?.finished).toContain('C5');
  expect(r.snap.story?.active).toBe(false);
  await shot(page, 'live-reach-midnight');
  expect(errors).toEqual([]);
});

// tech-4: the legacy HUD restaged into the zones. At C1, C4 and C6 every restaged piece that shows
// is drawn (its display bounds, from state.hud.bounds) inside its zone or card, nothing but the
// cards covers the feed, and the dial card shows exactly while a dial question is open.

type Rect = { x: number; y: number; w: number; h: number };
type Bounds = { id: string; home: string; visible: boolean; rect: Rect };
type Hud = {
  ready: boolean;
  now: number;
  jobCard: { open: boolean; x: number; y: number };
  dial: {
    visible: boolean;
    value: number;
    minus: { x: number; y: number };
    plus: { x: number; y: number };
    set: { x: number; y: number };
  };
  notes: { estimate: number | null; sizing: number | null };
  surge: { startsAt: number } | null;
  sizingPrompt: { open: boolean; x?: number; y?: number };
  bounds: Bounds[];
  title?: { right: number; clockRight: number | null };
  cues: { fired: string[]; silenced: boolean };
  bark: { history: string[] };
  chat: { block: string[]; stream: string[] };
};
type StoryState = {
  active: boolean;
  scriptId: string | null;
  click: { x: number; y: number } | null;
  skip: { visible: boolean; x: number; y: number };
};

const CARD_HOMES = ['jobCard', 'banner', 'dialCard', 'sizingPrompt', 'dipFallback'];

async function hudState(page: Page): Promise<Hud> {
  return page.evaluate(() => window.__neonTest!.state.hud as unknown as Hud);
}

/** Every zone's and card's page rect, in the same tenth-of-a-pixel form as live.zones. */
async function homeRects(page: Page): Promise<Record<string, Rect>> {
  const canvas = await page.evaluate(() => {
    const r = document.querySelector('canvas')!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const out: Record<string, Rect> = {};
  for (const [id, r] of Object.entries({ ...ZONES, ...CARDS })) out[id] = pageRect(r, canvas);
  return out;
}

/** Every piece that shows lies inside its home (to a pixel of rounding), and off the feed unless a card. */
async function expectRestaged(page: Page, moment: string, read?: Hud): Promise<Bounds[]> {
  const homes = await homeRects(page);
  const { bounds } = read ?? (await hudState(page));
  // 15 legacy pieces until the HUD stopped drawing its own title cluster and clock (TitleView and
  // ClockView draw them now): the alert, the scope, the dial, the sizing prompt, the chat, the comms
  // band, the three deck keys, the job card and the banner are left.
  expect(bounds.length, moment).toBeGreaterThanOrEqual(11);
  const eps = 1;
  const shown = bounds.filter((b) => b.visible);
  for (const b of shown) {
    const h = homes[b.home];
    const where = `${moment}: ${b.id} in ${b.home}`;
    expect(h, where).toBeDefined();
    expect(b.rect.x, where).toBeGreaterThanOrEqual(h.x - eps);
    expect(b.rect.y, where).toBeGreaterThanOrEqual(h.y - eps);
    expect(b.rect.x + b.rect.w, where).toBeLessThanOrEqual(h.x + h.w + eps);
    expect(b.rect.y + b.rect.h, where).toBeLessThanOrEqual(h.y + h.h + eps);
    if (!CARD_HOMES.includes(b.home)) {
      const f = homes.feed;
      const apart =
        b.rect.x + b.rect.w <= f.x + eps ||
        f.x + f.w <= b.rect.x + eps ||
        b.rect.y + b.rect.h <= f.y + eps ||
        f.y + f.h <= b.rect.y + eps;
      expect(apart, `${moment}: ${b.id} stays off the feed`).toBe(true);
    }
  }
  return shown;
}

async function turnDialTo(page: Page, value: number): Promise<void> {
  let h = await hudState(page);
  for (let guard = 0; h.dial.value !== value && guard < 200; guard++) {
    const p = h.dial.value < value ? h.dial.plus : h.dial.minus;
    await page.mouse.click(p.x, p.y);
    h = await hudState(page);
  }
  expect(h.dial.value).toBe(value);
  await page.mouse.click(h.dial.set.x, h.dial.set.y);
}

async function clickThroughScene(page: Page, scriptId: string): Promise<void> {
  const story = () => page.evaluate(() => window.__neonTest!.state.story as unknown as StoryState);
  await expect
    .poll(async () => (await story()).scriptId, { timeout: 90_000, intervals: [50] })
    .toBe(scriptId);
  for (let guard = 0; guard < 200; guard++) {
    const s = await story();
    if (!s.active) return;
    const p = s.skip.visible ? s.skip : s.click;
    if (p) await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(80);
  }
  throw new Error(`the ${scriptId} scene never ended`);
}

test('the restaged HUD: every legacy piece inside its zone at C1, C4 and C6', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/?test&scene=board&speed=20&autopilot');
  await expect
    .poll(() => page.evaluate(() => window.__neonTest?.state.hud?.ready ?? false), { timeout: 15_000 })
    .toBe(true);

  await test.step('the job card is up: no dial yet', async () => {
    const h = await hudState(page);
    expect(h.jobCard.open).toBe(true);
    expect(h.dial.visible).toBe(false);
    const ids = (await expectRestaged(page, 'job card')).map((b) => b.id);
    expect(ids).toContain('jobCard');
    expect(ids).not.toContain('dial');
    await page.mouse.click(h.jobCard.x, h.jobCard.y);
    await expect.poll(async () => (await hudState(page)).jobCard.open).toBe(false);
  });

  await test.step('C1: the dial card is up until SET', async () => {
    const h = await hudState(page);
    expect(h.dial.visible).toBe(true);
    const ids = (await expectRestaged(page, 'C1')).map((b) => b.id);
    for (const id of ['scope', 'dial', 'chat', 'comms']) {
      expect(ids, id).toContain(id);
    }
    // The legacy title cluster and clock are gone; the gauges views draw them in their zones.
    const all = h.bounds.map((b) => b.id);
    for (const id of ['title', 'clock.text', 'clock.countdown', 'clock.panel'])
      expect(all, id).not.toContain(id);
    expect(h.title!.right).toBeLessThanOrEqual(440);
    expect(h.title!.clockRight!).toBeLessThanOrEqual(1800);
    for (const id of ['deck.1', 'deck.2', 'deck.3']) expect(ids, id).toContain(id);
    expect(ids).not.toContain('jobCard');
    await page.screenshot({ path: 'test-results/screens/live-restage-c1.png' });
    await turnDialTo(page, 30);
    await expect.poll(async () => (await hudState(page)).notes.estimate).toBe(30);
    await expect.poll(async () => (await hudState(page)).dial.visible).toBe(false);
  });

  await test.step('C1: the host loop fires the trigger table through cueViewOf and sends each id as a cue', async () => {
    await expect
      .poll(async () => (await hudState(page)).bark.history, { timeout: 30_000 })
      .toEqual(expect.arrayContaining(['C1.triage.01', 'C1.triage.02']));
    const h = await hudState(page);
    // C1.triage.01 fires the frame the job card closes; C1.triage.02 two HUD seconds later.
    expect(h.cues.fired.indexOf('C1.triage.01')).toBeGreaterThanOrEqual(0);
    expect(h.cues.fired.indexOf('C1.triage.02')).toBeGreaterThan(h.cues.fired.indexOf('C1.triage.01'));
    // Every bark shown was fired once by the table, and no id fires twice in a run without a rewind.
    for (const id of h.bark.history) expect(h.cues.fired, id).toContain(id);
    expect(new Set(h.cues.fired).size).toBe(h.cues.fired.length);
    expect(h.cues.silenced).toBe(false);
    // The scripted chat lines that fired are posted as rows.
    expect(h.cues.fired).toContain('C1.chat.01');
  });

  await test.step('C4: the surge warning fills the alert band', async () => {
    // At speed 20 the warning is up for under a real second: keep the read that shows it, and shoot at once.
    let h: Hud | null = null;
    await expect
      .poll(
        async () => {
          const n = await hudState(page);
          const shown = n.surge?.startsAt === 300 && n.bounds.some((b) => b.id === 'alert' && b.visible);
          if (shown) h = n;
          return shown;
        },
        { timeout: 120_000, intervals: [25] },
      )
      .toBe(true);
    await page.screenshot({ path: 'test-results/screens/live-restage-c4.png' });
    const read = h as unknown as Hud;
    expect(read.dial.visible).toBe(false);
    const ids = (await expectRestaged(page, 'C4', read)).map((b) => b.id);
    expect(ids).toContain('alert');
    expect(ids).not.toContain('dial');
  });

  await clickThroughScene(page, 'C5');

  await test.step('C6: the sizing prompt beside the dial card, both gone after SET', async () => {
    await expect
      .poll(async () => (await hudState(page)).sizingPrompt.open, { timeout: 120_000, intervals: [25] })
      .toBe(true);
    const h = await hudState(page);
    expect(h.dial.visible).toBe(true);
    const ids = (await expectRestaged(page, 'C6')).map((b) => b.id);
    expect(ids).toContain('sizing');
    expect(ids).toContain('dial');
    // hud.sizingPrompt reports the prompt's centre: CARDS.sizingPrompt's, beside the dial card.
    const homes = await homeRects(page);
    const sp = homes.sizingPrompt;
    expect(Math.abs(h.sizingPrompt.x! - (sp.x + sp.w / 2))).toBeLessThanOrEqual(0.2);
    expect(Math.abs(h.sizingPrompt.y! - (sp.y + sp.h / 2))).toBeLessThanOrEqual(0.2);
    expect(sp.x + sp.w).toBeLessThanOrEqual(homes.dialCard.x);
    await page.screenshot({ path: 'test-results/screens/live-restage-c6.png' });
    await turnDialTo(page, 4);
    await expect.poll(async () => (await hudState(page)).notes.sizing).toBe(4);
    const after = await hudState(page);
    expect(after.sizingPrompt.open).toBe(false);
    expect(after.dial.visible).toBe(false);
  });

  expect(errors).toEqual([]);
});

// Tech follow-up (gauges-2's dip mark): the power-dip mark sits on the part the dip takes, at the
// point the board's hook reports for it, within 2 page px.

type DipRead = {
  now: number;
  dip: { partId: string } | null;
  dipMark: { x: number; y: number } | null;
  parts: { id: string; x: number; y: number }[];
};

test('the power-dip mark sits on its part: |hud.dipMark - board.parts[id]| <= 2 page px', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { errors } = await openBoard(page, { speed: 20, autopilot: true });
  await dismissJobCard(page);
  // No dip showing: no mark.
  const before = (await page.evaluate(() => window.__neonTest!.state.hud)) as unknown as DipRead;
  expect(before.dip).toBeNull();
  expect(before.dipMark).toBeNull();
  await expect
    .poll(async () => (await hudState(page)).now, { timeout: 60_000, intervals: [100] })
    .toBeGreaterThanOrEqual(290);
  // The warning is up for 2 sim seconds: watch for it from inside the page, every frame.
  const read = await page.evaluate(
    () =>
      new Promise<DipRead | null>((resolve) => {
        const end = performance.now() + 60_000;
        const look = (): void => {
          const s = window.__neonTest!.state as unknown as {
            hud: { now: number; dip: { partId: string } | null; dipMark: { x: number; y: number } | null };
            board: { parts: { id: string; x: number; y: number }[] };
          };
          if (s.hud.dip) {
            resolve({ now: s.hud.now, dip: s.hud.dip, dipMark: s.hud.dipMark, parts: s.board.parts });
            return;
          }
          if (performance.now() > end) resolve(null);
          else requestAnimationFrame(look);
        };
        look();
      }),
  );
  expect(read, 'a dip warning showed').not.toBeNull();
  const r = read!;
  expect(r.dip!.partId).toMatch(/^server-/);
  const part = r.parts.find((p) => p.id === r.dip!.partId);
  expect(part, `board.parts has ${r.dip!.partId}`).toBeDefined();
  expect(r.dipMark).not.toBeNull();
  expect(Math.abs(r.dipMark!.x - part!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(r.dipMark!.y - part!.y)).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});
