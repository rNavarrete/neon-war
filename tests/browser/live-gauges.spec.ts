import { type Page, expect, test } from '@playwright/test';
import type { ScopeTestState } from '../../src/scenes/hud/ChartView';
import type { KeyName } from '../../src/scenes/hud/deck';
import type { HudTestState } from '../../src/scenes/hud/hook';
import { BROWNOUT } from '../../src/sim/brownout';
import { dismissJobCard, hud, openBoard, reach, shot, snap } from './live/reach';

const C = BROWNOUT.challenges;
const MIDNIGHT = BROWNOUT.clock.midnight;

// The gauges lane's Live views (docs/LIVE.md), asserted on window.__neonTest.state.hud: the title
// cluster and the clock (gauges-1), and the clear top right of the feed now the dial card is gone.

test('the title cluster: waiting for the first build, then live; WATCHING has no number yet; clock left of x 1800', async ({
  page,
}) => {
  test.setTimeout(60_000);

  // No autopilot: the clock waits on the first build after the job card.
  const first = await openBoard(page, { speed: 20, autopilot: false });
  await dismissJobCard(page);
  await expect.poll(async () => (await hud(page)).title?.live, { timeout: 5_000 }).toBe('waiting');
  let h = await hud(page);
  expect(h.title!.watching).toBe(h.audience?.watching ?? null);
  // Nothing of the title is drawn outside its zone, and nothing of the clock past x 1800.
  expect(h.title!.right).toBeLessThanOrEqual(440);
  expect(h.title!.clockRight).not.toBeNull();
  expect(h.title!.clockRight!).toBeLessThanOrEqual(1800);
  await shot(page, 'live-m2-title');
  expect(first.errors).toEqual([]);

  // With best play the first build lands at once: the dot goes live.
  const second = await openBoard(page, { speed: 20, autopilot: true });
  await reach(page, 'c1');
  await expect.poll(async () => (await hud(page)).title?.live, { timeout: 5_000 }).toBe('live');
  h = await hud(page);
  // WATCHING mirrors the chat's audience (bus `audience`, chat-3): no number until it first emits.
  expect(h.title!.watching).toBe(h.audience?.watching ?? null);

  // The estimate step is gone: once best play has a server on the board the C1 hint goes, and
  // nothing is drawn over the top right of the feed (where the dial card was).
  await test.step('the place hint goes with the first server, and the top right of the feed stays clear', async () => {
    await expect.poll(async () => (await hud(page)).alert?.hint ?? null, { timeout: 5_000 }).toBeNull();
    h = await hud(page);
    const ids = h.bounds.map((b) => b.id);
    expect(ids).not.toContain('dial');
    expect(ids).not.toContain('sizing');
    const topRight = { x: 1560, y: 120, w: 340, h: 250 };
    const canvas = await page.evaluate(() => {
      const r = document.querySelector('canvas')!.getBoundingClientRect();
      return { left: r.left, top: r.top, sx: r.width / 1920, sy: r.height / 1080 };
    });
    const tr = {
      x: canvas.left + topRight.x * canvas.sx,
      y: canvas.top + topRight.y * canvas.sy,
      w: topRight.w * canvas.sx,
      h: topRight.h * canvas.sy,
    };
    for (const { id, home, rect: b } of h.bounds.filter((x) => x.visible)) {
      const apart = b.x + b.w <= tr.x || tr.x + tr.w <= b.x || b.y + b.h <= tr.y || tr.y + tr.h <= b.y;
      expect(apart, `${id} (${home}) over the top right of the feed`).toBe(true);
    }
    await shot(page, 'live-c1-top-right');
  });
  expect(second.errors).toEqual([]);
});

// gauges-4: the room-left bar in the deck goes red within one sim second of the district surge.
test('the room-left bar: red within one sim second of the district surge at speed 5, in crew words', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const { errors } = await openBoard(page, { speed: 5, autopilot: true });
  await reach(page, 'c1');
  await expect
    .poll(async () => (await hud(page)).headroom?.wiredCapacity ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);
  let h = await hud(page);
  expect(h.headroom!.label).toMatch(/^ROOM LEFT -?\d+% · \d+ of \d+$|^ROOM LEFT · (OVER \+\d+\/s|NO BOX)$/);

  await reach(page, 'surge', { timeout: 110_000 });
  const surgeAt = C.c4;
  await expect
    .poll(async () => (await hud(page)).now, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(surgeAt + 1);
  h = await hud(page);
  const room = h.headroom!;
  expect(room.state).toBe('red');
  expect(room.redSince).not.toBeNull();
  expect(room.redSince!).toBeLessThanOrEqual(surgeAt + 1);
  expect(room.wiredCapacity).toBeGreaterThan(0);
  expect(room.pct).toBe(Math.round((1 - room.demand / room.wiredCapacity) * 100));
  expect(room.lit).toBe(0);
  expect(room.label).toMatch(/^ROOM LEFT · OVER \+\d+\/s$/);
  expect(room.label).not.toMatch(/head\s*room/i);
  expect(room.capacity).toBeCloseTo(h.sim.capacity, 0);
  expect(room.right).toBeLessThanOrEqual(1232);
  await shot(page, 'live-m2-deck');
  expect(errors).toEqual([]);
});

// gauges-9: the gauges lane's spec. One page load at speed 20 with the autopilot, through
// reach(page, moment): every hook field the lane adds (hud.title, hud.gauge,
// hud.chart's scope fields, hud.alert, hud.map, hud.headroom, hud.deck) is asserted at the
// challenge where it matters, and four screenshots are saved as test-results/screens/live-gauges-*.png.
// The laundry cut is clicked at speed 20 too, on the first frame the deck offers it while
// reach('surge') runs, and the surge frames are kept by a recorder in the page (see that step), so
// the spec needs no second page at speed 5.

/** Words the player must not see before the debrief (docs/SCRIPT.md C8.terms). */
const NOT_BEFORE_DEBRIEF = /head\s*room|throughput|capacity|load\s*balanc|requests per second/i;

type LaneHud = HudTestState &
  Required<Pick<HudTestState, 'title' | 'gauge' | 'alert' | 'map' | 'headroom' | 'deck'>> & {
    chart: ScopeTestState;
  };

/** Read hud with every gauges-lane section present. */
async function lane(page: Page): Promise<LaneHud> {
  const h = await hud(page);
  for (const k of ['title', 'gauge', 'alert', 'map', 'headroom', 'deck'] as const)
    expect(h[k], `hud.${k} is missing`).toBeTruthy();
  return h as LaneHud;
}

/** Click a deck key at the centre hud.deck.keys reports; the caller asserts the effect. */
async function clickKey(page: Page, key: KeyName): Promise<void> {
  const h = await lane(page);
  await page.mouse.click(h.deck.keys[key].x, h.deck.keys[key].y);
}

function expectCrewWordsOnly(words: readonly (string | null)[]): void {
  for (const w of words) expect(w ?? '', w ?? '').not.toMatch(NOT_BEFORE_DEBRIEF);
}

test('gauges lane at speed 20: every hook field at its challenge, four live-gauges screenshots', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const { errors } = await openBoard(page, { speed: 20, autopilot: true });

  await test.step('C1: the gauge and the scope read the real line, the room bar fills', async () => {
    await reach(page, 'c1');
    await expect.poll(async () => (await lane(page)).title.live, { timeout: 5_000 }).toBe('live');
    let h = await lane(page);
    expect(h.title.watching).toBe(h.audience?.watching ?? null);
    expect(h.title.right).toBeLessThanOrEqual(440);
    expect(h.title.clockRight).not.toBeNull();
    expect(h.title.clockRight!).toBeLessThanOrEqual(1800);

    // The room band, the needle and the bar settle on one frame.
    await expect
      .poll(
        async () => {
          const g = (await lane(page)).gauge;
          return g.capacity > 0 && Math.abs(g.needle - g.demand) <= 1;
        },
        { timeout: 10_000, intervals: [25] },
      )
      .toBe(true);
    h = await lane(page);
    expect(Object.keys(h.deck.keys).sort()).toEqual(['one', 'two']);
    for (const k of ['one', 'two'] as const) {
      expect(h.deck.keys[k].interactive, k).toBe(true);
      expect(h.deck.keys[k].alpha, k).toBeGreaterThan(0);
    }
    expect(h.deck.regroup).toBe('hidden');
    expect(h.deck.cut).toBe('hidden');
    expect(h.deck.ring).toBe(0);
    expect(h.deck.pulse).toBe(1);
    expect(h.deck.tooltip).toBe(false);

    const g = h.gauge;
    expect(g.visible).toBe(true);
    expect(g.title).toBe('COMING /s');
    expect(g.max).toBe(400);
    expect(g.ticks).toEqual(['0', '100', '200', '300', '400']);
    expect(g.readout).toBe(`${Math.round(g.demand)}/s`);
    expect(g.sub).toBe(`room ${Math.round(g.capacity)}/s`);
    expect(g.strip).toBeNull();
    expect(g.dropped).toBe(0);
    expect(g.served).toBeGreaterThan(0);
    expect(g.served).toBeLessThanOrEqual(g.demand + 1);
    expect(g.booting).toBeGreaterThanOrEqual(0);
    expect(Math.abs(g.capacity - h.headroom.wiredCapacity)).toBeLessThanOrEqual(1);

    const room = h.headroom;
    expect(room.wiredCapacity).toBeGreaterThan(0);
    expect(room.capacity).toBeGreaterThanOrEqual(room.wiredCapacity);
    expect(room.load).not.toBeNull();
    expect(room.load!).toBeCloseTo(room.demand / room.wiredCapacity, 2);
    expect(room.pct).toBe(Math.round((1 - room.demand / room.wiredCapacity) * 100));
    expect(room.state).not.toBe('red');
    expect(room.redSince).toBeNull();
    expect(room.lit).toBeGreaterThan(0);
    expect(room.lit).toBeLessThanOrEqual(30);
    expect(room.label).toMatch(/^ROOM LEFT -?\d+% · \d+ of \d+$/);
    expect(room.right).toBeLessThanOrEqual(1232);

    expect(h.chart.wiredCapacity).toBeGreaterThan(0);
    expect(h.chart.racked).toBe(false);
    expect(h.chart.plot).toEqual({ w: 354, h: 145 });
    expect(h.chart.title).toBe('LAST 60 s');

    expect(h.map.raid).toBe(false);
    expect(h.map.neighboursCut).toBe(false);
    expect(h.map.laundryDark).toBe(false);
    expect(h.map.midnight).toBe(false);
    expect(h.map.litFloors).toBeGreaterThan(0);
    expectCrewWordsOnly([g.title, g.readout, g.sub, g.strip, room.label, h.chart.title, h.chart.legend]);
    await shot(page, 'live-gauges-c1');

    // M4 frame kit: each panel is one baked texture of picked pieces, none drawn above its file's size.
    const kit = (await lane(page)) as LaneHud;
    const panels = {
      title: kit.title.panel,
      gauge: kit.gauge.panel,
      scope: kit.chart.panel,
      map: kit.map.panel,
      headroom: kit.headroom.panel,
    };
    for (const [name, p] of Object.entries(panels)) {
      expect(p, `${name}.panel`).toBeTruthy();
      expect(p!.texture, name).toBe(`live-kit:${name}`);
      expect(p!.pieces, name).toContain('hud/live/panel-frame');
      expect(p!.pieces, name).toContain('hud/live/corner-marks');
      expect(p!.missing, name).toEqual([]);
      expect(p!.maxScale, name).toBeGreaterThan(0);
      expect(p!.maxScale, name).toBeLessThanOrEqual(1);
    }
    for (const name of ['gauge', 'scope', 'map'] as const)
      expect(panels[name]!.pieces, name).toContain('hud/live/label-tab');
    for (const name of ['gauge', 'headroom'] as const)
      expect(panels[name]!.pieces, name).toContain('hud/live/divider');
    expect(kit.map.base).toBe('hud/city-grid');
    // The LIVE pill shows exactly while the dot reads live.
    expect(kit.title.pill).toBe(kit.title.live === 'live');
    await shot(page, 'm4-kit-c1');
  });

  await test.step('C2: the Solace banner blocks the deck', async () => {
    await expect
      .poll(async () => (await lane(page)).deck.bannerOpen, { timeout: 15_000, intervals: [25] })
      .toBe(true);
    const h = await lane(page);
    expect(h.deck.blocked).toBe(true);
    expect(h.banner.open).toBe(true);
    // A key pressed under the banner is counted and does nothing.
    const before = h.deck.pressed;
    await page.keyboard.press('2');
    await expect
      .poll(async () => (await lane(page)).deck.pressed, { timeout: 3_000, intervals: [10] })
      .toBeGreaterThan(before);
    const last = (await lane(page)).deck.presses.at(-1)!;
    expect(last).toMatchObject({ key: 'two', via: 'key', acted: false });
    expect(last.at).toBeGreaterThanOrEqual(C.c2);
  });

  await test.step('C3: the climb is forecast number first, the map walks its pooled dots', async () => {
    const r = await reach(page, 'c3');
    expect(r.hud.now).toBeGreaterThanOrEqual(C.c3);
    const h = await lane(page);
    expect(h.deck.bannerOpen).toBe(false);
    expect(h.alert.history.some((e) => e.kind === 'forecast' && e.number === 90)).toBe(true);
    expect(h.map.dots.pool).toBeGreaterThan(0);
    expect(h.map.dots.active).toBeGreaterThanOrEqual(0);
    expect(h.map.dots.active).toBeLessThanOrEqual(h.map.dots.pool);
  });

  await test.step('the district surge: RAID in the tag, the cut clicked, OVER BY and a red room bar', async () => {
    // At speed 20 the surge runs only about 6 sim s (0.3 s of wall clock) before trust falls under 30
    // and the C5 scene takes the screen. So a recorder in the page reads the hook every frame from
    // here on (window.__liveGauges9, a test-only global the game never reads), the key is clicked on
    // the first frame the deck offers the cut, and the asserts run on the frames it kept.
    const key = (await lane(page)).deck.keys.two;
    await page.evaluate((c4) => {
      type H = {
        now: number;
        paused: boolean;
        laundry: { cut: boolean };
        alert?: { kind: string };
        gauge?: { strip: string | null; dropped: number };
        headroom?: { state: string };
        deck?: { cut: string };
        map?: { laundryDark: boolean };
      };
      const rec = {
        ready: null as H | null,
        raid: null as H | null,
        over: null as H | null,
        cut: null as H | null,
        scene: false,
        trail: [] as string[],
      };
      (window as unknown as { __liveGauges9: typeof rec }).__liveGauges9 = rec;
      const end = performance.now() + 60_000;
      const look = (): void => {
        const st = window.__neonTest!.state as unknown as { hud: H; story?: { active: boolean } };
        const h = st.hud;
        if (h.now >= c4 - 5 && rec.trail.length < 400)
          rec.trail.push(
            `${h.now.toFixed(1)} ${h.paused ? 'held' : 'run'} ${h.alert?.kind} ${h.gauge?.strip} ` +
              `${Math.round(h.gauge?.dropped ?? 0)} ${h.headroom?.state} ${h.deck?.cut}`,
          );
        if (!rec.ready && h.deck?.cut === 'ready') rec.ready = h;
        if (!rec.raid && !h.paused && ['raid', 'refresh', 'flicker'].includes(h.alert?.kind ?? ''))
          rec.raid = h;
        if (
          !rec.over &&
          !h.paused &&
          (h.gauge?.strip ?? '').startsWith('OVER BY') &&
          (h.gauge?.dropped ?? 0) > 0 &&
          h.headroom?.state === 'red'
        )
          rec.over = h;
        if (!rec.cut && h.laundry.cut && h.deck?.cut === 'done' && h.map?.laundryDark) rec.cut = h;
        if (h.now >= c4 && st.story?.active) rec.scene = true;
        if (!rec.scene && performance.now() < end) requestAnimationFrame(look);
      };
      look();
    }, C.c4);
    // reach runs the night on to the surge moment alongside; the click does not wait for its polling.
    const reaching = reach(page, 'surge');
    // The first frame the deck offers the cut: click it at once.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const end = performance.now() + 30_000;
          const look = (): void => {
            const rec = (window as unknown as { __liveGauges9: { ready: unknown; scene: boolean } })
              .__liveGauges9;
            if (rec.ready || rec.scene || performance.now() > end) resolve();
            else requestAnimationFrame(look);
          };
          look();
        }),
    );
    await page.mouse.click(key.x, key.y);
    await shot(page, 'live-gauges-surge');
    const reached = await reaching;
    expect(reached.hud.now).toBeGreaterThanOrEqual(C.c4);
    type Rec = {
      ready: unknown;
      raid: unknown;
      over: unknown;
      cut: unknown;
      scene: boolean;
      trail: string[];
    };
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const r = (window as unknown as { __liveGauges9: Rec }).__liveGauges9;
            return r.scene || (r.raid !== null && r.over !== null && r.cut !== null);
          }),
        { timeout: 10_000, intervals: [25] },
      )
      .toBe(true);
    const seen = await page.evaluate(() => (window as unknown as { __liveGauges9: Rec }).__liveGauges9);
    expect(seen.ready, `a frame with the cut on offer (${seen.trail.join(' | ')})`).not.toBeNull();
    const ready = seen.ready as LaneHud;
    expect(ready.deck.cut).toBe('ready');
    expect(ready.deck.keys.two.lit).toBe(true);
    expect(ready.laundry.available).toBe(true);
    const brief = (x: unknown): string => {
      const v = x as LaneHud | null;
      return v
        ? JSON.stringify({
            now: v.now,
            paused: v.paused,
            alert: v.alert?.kind,
            strip: v.gauge?.strip,
            cut: v.deck?.cut,
          })
        : 'none';
    };
    const seenText =
      `raid ${brief(seen.raid)}, over ${brief(seen.over)}, cut ${brief(seen.cut)}, scene ${seen.scene}; ` +
      `frames: ${seen.trail.join(' | ')}`;
    expect(seen.raid, `a running frame with the RAID alert (${seenText})`).not.toBeNull();
    expect(
      seen.over,
      `a running frame with OVER BY, calls dropping and a red bar (${seenText})`,
    ).not.toBeNull();
    expect(seen.cut, `a frame with the laundry cut done and its floor dark (${seenText})`).not.toBeNull();
    const cut = seen.cut as LaneHud;
    expect(cut.laundry.cut).toBe(true);
    expect(cut.deck.cut).toBe('done');
    expect(cut.map.laundryDark).toBe(true);
    expect(cut.map.raid).toBe(true);
    const h = seen.raid as LaneHud;
    const a = h.alert;
    // The surge reads (the gauge, the bar) come from the first frame that showed them.
    const o = seen.over as LaneHud;
    expect(a.tag).toBe('RAID');
    expect(a.stripes).toBe(true);
    expect(a.visible).toBe(true);
    expect(a.unit).toBe('/s');
    expect(a.title).toBe('C4.alert.title');
    expect(a.headline).toMatch(/^\d+\/s · NEIGHBOURS REROUTED HERE$/);
    expect(a.headline).not.toContain('RAID');
    expect(a.shownAt).not.toBeNull();
    expect(a.shownAt!).toBeGreaterThanOrEqual(C.c4 - 10);
    expect(a.retry).toBeGreaterThanOrEqual(0);
    expect(a.offset).toBeLessThanOrEqual(0);
    // ?test runs the lite flag: the band holds still, as under reduce flicker.
    expect(a.motion).toEqual({ slide: false, stripes: false, flash: false });
    expect(typeof a.lit).toBe('boolean');
    if (a.kind !== 'flicker') expect(a.flashing).toBe(false);
    expect(typeof a.chip).toBe('string');
    expect(typeof a.sub).toBe('string');

    expect(h.map.raid).toBe(true);
    expect(h.map.neighboursCut).toBe(true);

    const g = o.gauge;
    expect(g.demand).toBeGreaterThan(g.capacity);
    expect(g.strip).toBe(`OVER BY ${Math.round(g.demand - g.capacity)}/s`);
    expect(g.served).toBeLessThan(g.demand);

    const room = o.headroom;
    expect(room.redSince).not.toBeNull();
    expect(room.redSince!).toBeLessThanOrEqual(o.now);
    expect(room.lit).toBe(0);
    expect(room.label).toMatch(/^ROOM LEFT · OVER \+\d+\/s$/);
    expect(room.load!).toBeGreaterThan(1);
    expectCrewWordsOnly([a.headline, a.sub, a.chip, g.strip, g.sub, room.label]);
  });

  await test.step('after the rescue: Regroup is ready, a click slows the night to a quarter, then it is spent', async () => {
    // The C5 scene holds the board.
    await expect
      .poll(async () => (await snap(page)).story?.scriptId ?? null, { timeout: 15_000, intervals: [25] })
      .toBe('C5');
    expect((await lane(page)).paused).toBe(true);
    await reach(page, 'rescue');
    await expect
      .poll(async () => (await lane(page)).deck.regroup, { timeout: 10_000, intervals: [25] })
      .toBe('ready');
    let h = await lane(page);
    expect(h.deck.keys.one.lit).toBe(true);
    expect(h.deck.pulse).toBeGreaterThanOrEqual(0.75);
    expect(h.deck.pulse).toBeLessThanOrEqual(1);
    await clickKey(page, 'one');
    // Regroup lasts about half a wall second at speed 20, so assert on the very snapshot that first
    // shows it active rather than reading the hook a second time.
    await expect
      .poll(
        async () => {
          h = await lane(page);
          return h.deck.regroup;
        },
        { timeout: 3_000, intervals: [10] },
      )
      .toBe('active');
    expect(h.deck.presses.at(-1)).toMatchObject({ key: 'one', via: 'click', acted: true });
    expect(h.timeScale).toBe(0.25);
    expect(h.deck.ring).toBeGreaterThan(0);
    expect(h.deck.ring).toBeLessThanOrEqual(1);
    expect(h.deck.keys.one.lit).toBe(false);
    await shot(page, 'live-gauges-regroup');
    await expect
      .poll(async () => (await lane(page)).deck.regroup, { timeout: 15_000, intervals: [50] })
      .toBe('spent');
    h = await lane(page);
    expect(h.timeScale).toBe(1);
    expect(h.deck.ring).toBe(0);
  });

  await test.step('C6: the midnight forecast asks nothing; Rei and TRIAGE come on the forecast', async () => {
    await expect
      .poll(async () => (await lane(page)).cues.fired, { timeout: 20_000, intervals: [25] })
      .toEqual(expect.arrayContaining(['C6.rei.01', 'C6.triage.01']));
    const h = await lane(page);
    expect(h.now).toBeLessThan(MIDNIGHT);
    const ids = h.bounds.map((b) => b.id);
    expect(ids).not.toContain('dial');
    expect(ids).not.toContain('sizing');
  });

  await test.step('midnight: the map goes warm, HELD went up, and still no viewer number', async () => {
    await reach(page, 'midnight');
    await expect
      .poll(async () => (await lane(page)).map.midnight, { timeout: 5_000, intervals: [25] })
      .toBe(true);
    const h = await lane(page);
    expect(h.alert.history.some((e) => e.kind === 'held' && e.at >= MIDNIGHT)).toBe(true);
    expect(h.alert.history.some((e) => e.kind === 'dark')).toBe(false);
    expect(h.title.watching).toBe(h.audience?.watching ?? null);
    expect(h.deck.regroup).toBe('spent');
    await shot(page, 'live-gauges-midnight');
  });

  expect(errors).toEqual([]);
});
