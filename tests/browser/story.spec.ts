import { type Page, expect, test } from '@playwright/test';
import { BROWNOUT } from '../../src/sim/brownout';
import { SERVER_SLOTS } from '../../src/sim/tick';
import type { TestState } from '../../src/testHook';

// The story layer: scene player, cold open, rescue, rewinds, debrief and Night Book. Some tests open
// a scene directly through the test-only `window.__neonStory` handle; others let the sim trigger it,
// with `?test&autopilot` playing GAME.md's best-play build (src/game/autopilot.ts).

type Story = NonNullable<TestState['story']>;

const C = BROWNOUT.challenges;

const state = (page: Page) => page.evaluate(() => window.__neonTest!.state);
const story = async (page: Page): Promise<Story> => (await state(page)).story!;

/** Slow text so a test can click a line while it is still typing. */
async function slowText(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((s) => {
    window.localStorage.setItem('neon-war.settings', JSON.stringify({ textSpeed: 'slow', ...s }));
  }, extra);
}

async function boot(page: Page, url: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(url);
  await expect.poll(async () => (await state(page)).ready, { timeout: 15_000 }).toBe(true);
  expect(errors).toEqual([]);
}

/** Go to the board and click the HUD's job card away if it is up. */
async function toBoard(page: Page, speed = 1, extra = ''): Promise<void> {
  await boot(page, `/?test&scene=board&speed=${speed}${extra}`);
  const hud = (await state(page)) as { hud?: { jobCard: { open: boolean; x: number; y: number } } };
  if (hud.hud?.jobCard.open) await page.mouse.click(hud.hud.jobCard.x, hud.hud.jobCard.y);
}

/** Click the story's text box and wait until the scene has handled the click. */
async function clickStory(page: Page): Promise<Story> {
  const s = await story(page);
  await page.mouse.click(s.click!.x, s.click!.y);
  await expect.poll(async () => (await story(page)).clicks).toBeGreaterThan(s.clicks);
  return story(page);
}

/** Click on to the next line (finishing the typing one first if needed); returns the new state. */
async function nextLine(page: Page): Promise<Story> {
  const before = await story(page);
  const moved = (s: Story) =>
    s.lineId !== before.lineId || s.debrief?.step !== before.debrief?.step || !s.active;
  if (!moved(await clickStory(page))) await clickStory(page);
  await expect.poll(async () => moved(await story(page)), { timeout: 10_000 }).toBe(true);
  return story(page);
}

test('the cold open waits for a click on every line, then hands over to the board', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?test&scene=story');
  await expect.poll(async () => (await story(page))?.scriptId, { timeout: 15_000 }).toBe('C0');
  let s = await story(page);
  expect(s.lineId).toBe('C0.tv.01');
  expect(s.backdrop).toBe('art/bg/bedroom-dark.webp');
  expect(s.runHeld).toBe(true);
  expect(s.chat).toEqual([]);

  // Nothing moves on its own: five seconds later (the old timers had moved on by 4 s) it is still the
  // first line, no click has landed, and the run is held.
  await page.waitForTimeout(5000);
  s = await story(page);
  expect(s.lineId).toBe('C0.tv.01');
  expect(s.clicks).toBe(0);
  expect(s.active).toBe(true);
  expect(s.runHeld).toBe(true);

  // The chat blows up before anyone in the room says so (Rolando, 31 Oct 2026): one block message
  // lands with each click from the TV's second line, before TRIAGE is even awake.
  s = await nextLine(page);
  expect(s.lineId).toBe('C0.tv.02');
  expect(s.chat).toEqual(["kenji: lux the net's doing the thing again"]);
  expect(s.onStage).toEqual([]);
  s = await nextLine(page);
  expect(s.lineId).toBe('C0.grandma.01');
  expect(s.chat).toHaveLength(2);
  s = await nextLine(page);
  expect(s.lineId).toBe('C0.lux.01');
  expect(s.nameplate).toBe('Lux');
  expect(s.portrait).toBe('portrait:lux/vn/photo');
  expect(s.chat).toHaveLength(3);
  expect(s.onStage).toEqual(['Lux']);

  // The fourth message wakes TRIAGE, who checks on her first...
  s = await nextLine(page);
  expect(s.lineId).toBe('C0.triage.01');
  expect(s.chat).toHaveLength(4);
  expect(s.chat[3]).toBe('kenji: lux pls');
  s = await nextLine(page);
  expect(s.lineId).toBe('C0.lux.03');

  // ...and only then reads out the chat that has been blowing up all scene.
  s = await nextLine(page);
  expect(s.lineId).toBe('C0.triage.02');
  expect(s.chat).toHaveLength(4);
  await page.screenshot({ path: 'test-results/screens/cold-open.png' });

  // The block needs her again (Rolando, 31 Oct 2026): the power-app line, her dry streamer voice back.
  s = await nextLine(page);
  expect(s.lineId).toBe('C0.lux.04');
  expect(s.portrait).toBe('portrait:lux/vn/relieved');

  s = await nextLine(page);
  expect(s.lineId).toBe('C0.lux.02');
  expect(s.sfx).toContain('goggles-on');
  // Her last line plays over the jack-in CG (Rolando's pick, sequence C, 30 Oct 2026).
  expect(s.cg).toBe('art/story/jackin-tap.webp');
  expect(s.jackin).toBe('tap');
  expect((await state(page)).scene).toBe('story');

  // The last click brings the goggles down and hands over to the board at 23:54:40. Even a
  // double-click there leaves the job card up to be read.
  // Wait for the short line to finish typing on its own: a click to finish it can land just after
  // it finished and end the scene before the double-click.
  await expect.poll(async () => (await story(page)).typingDone).toBe(true);
  s = await story(page);
  expect(s.lineId).toBe('C0.lux.02');
  await page.mouse.dblclick(s.click!.x, s.click!.y);
  // The click plays the jack-in: the room dissolves into the grid, then the flash cuts to the board.
  await expect
    .poll(async () => (await story(page)).cg, { timeout: 5_000 })
    .toBe('art/story/jackin-dissolve.webp');
  await page.screenshot({ path: 'test-results/screens/cold-open-jackin.png' });
  await expect.poll(async () => (await state(page)).scene, { timeout: 15_000 }).toBe('board');
  s = await story(page);
  expect(s.active).toBe(false);
  expect(s.finished).toEqual(['C0']);
  expect(s.chat).toHaveLength(4);
  expect(s.sfx).toEqual(expect.arrayContaining(['rain-loop', 'goggles-on']));
  expect(s.runNow).toBeGreaterThanOrEqual(15);
  // The board's HUD shows the job card when it arrives (HUD stream; absent until merged).
  type Card = { open: boolean; x: number; y: number };
  const card = async () => ((await state(page)) as { hud?: { jobCard: Card } }).hud?.jobCard;
  const hud = await card();
  if (hud) {
    expect(hud.open).toBe(true);
    // A moment later (the card ignores clicks for 400 ms after the cold open) a click on OK closes it.
    await page.waitForTimeout(500);
    expect((await card())?.open).toBe(true);
    await page.mouse.click(hud.x, hud.y);
    await expect.poll(async () => (await card())?.open).toBe(false);
  }
});

type CrewHud = {
  scene?: string;
  hud: {
    crew: { call: string | null; hijackDone: boolean; said: string[]; boardFrozen: boolean };
    comms: { line: { id: string } | null; signal: { kind: string | null; noise: number; title: string } };
    chat: { feed: { who: string; text: string }[] };
  };
};
const crewHud = async (page: Page) => (await state(page)) as unknown as CrewHud;

/** Muted, fast text: the call runs on its own, no clicks. */
async function muted(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('neon-war.settings', JSON.stringify({ volume: 0, textSpeed: 'fast' }));
  });
}

test('the crew break into the comms over the HUD: static, "who are you", a frozen board until the load balancer', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await muted(page);
  await toBoard(page, 4);
  // The HUD scene starts a moment after the board: wait for its comms band before calling in.
  await expect.poll(async () => ((await crewHud(page)).hud?.comms?.signal ? 'up' : 'none')).toBe('up');
  await page.evaluate(() => window.__neonStory!.crewCall('hijack'));
  await expect
    .poll(async () => (await crewHud(page)).hud?.comms?.line?.id ?? null, { timeout: 15_000 })
    .toBe('C5.triage.01');

  // No scene: the board stays on screen, held still, and TRIAGE notices an unknown signal on the tile.
  let h = await crewHud(page);
  expect((await story(page)).active).toBe(false);
  expect(h.hud.crew.call).toBe('hijack');
  expect(h.hud.crew.boardFrozen).toBe(true);
  expect(h.hud.comms.signal.kind).toBe('static');
  expect(h.hud.comms.signal.title).toBe('COMMS · UNKNOWN SIGNAL');
  // Rolando's pick for the hijack (2 Nov 2026): the digital-glitch static.
  const shell = (await state(page)) as unknown as { shell: { recentSfx: string[] } };
  expect(shell.shell.recentSfx).toContain('comms-static');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/screens/crew-hijack-static.png' });

  // Rei's face comes through the static.
  await expect
    .poll(async () => (await crewHud(page)).hud?.comms?.line?.id ?? null, {
      timeout: 30_000,
      intervals: [50],
    })
    .toBe('C5.rei.01');
  expect((await crewHud(page)).hud.comms.signal.kind).toBe('resolve');
  await page.screenshot({ path: 'test-results/screens/crew-hijack-rei.png' });

  await expect.poll(async () => (await crewHud(page)).hud.crew.hijackDone, { timeout: 90_000 }).toBe(true);
  h = await crewHud(page);
  expect(h.hud.crew.boardFrozen).toBe(false);
  expect(h.hud.crew.call).toBe(null);
  expect(h.hud.crew.said.filter((id) => !id.includes('.chat.'))).toEqual([
    'C5.triage.01',
    'C5.lux.who',
    'C5.triage.who',
    'C5.rei.01',
    'C5.lux.01',
    'C5.rei.build',
    'C5.lux.fine',
    'C5.mika.collapse',
    'C5.rei.02',
    'C5.rei.03',
    'C5.rei.health',
    'C5.ozzie.01',
    'C5.mika.02',
    'C5.rei.04',
  ]);
  // The stream chat reacted all the way through.
  const feed = h.hud.chat.feed.map((m) => m.text);
  expect(feed).toContain('did someone just hack the stream??');
  expect(feed).toContain("lux don't trust them");
  expect(feed).toContain("load balancer? what's that??");
  await expect.poll(async () => (await crewHud(page)).hud.comms.signal.kind, { timeout: 5_000 }).toBe(null);
});

/** Click through whatever story scene is up until it ends (Skip when it shows). */
async function playThrough(page: Page): Promise<void> {
  for (let guard = 0; guard < 200; guard++) {
    const s = await story(page);
    if (!s.active) return;
    const p = s.skip.visible ? s.skip : s.click;
    if (p) await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(80);
  }
  throw new Error('the scene never ended');
}

type Board = { tray: { id: string; locked: boolean }[]; parts: { id: string; kind: string }[] };
const board = async (page: Page) => (await state(page)).board as unknown as Board;

test('the sim triggers the rescue and the board returns with the load balancer unlocked', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await muted(page);
  await toBoard(page, 20, '&autopilot');
  expect((await board(page)).tray.find((t) => t.id === 'balancer')?.locked).toBe(true);
  // Nothing starts the call but the sim: the surge drains trust under 30 and the crew break in.
  await expect
    .poll(async () => (await crewHud(page)).hud.crew.call, { timeout: 90_000, intervals: [50] })
    .toBe('hijack');
  const now = (await state(page)).hud as unknown as { now: number };
  expect(now.now).toBeGreaterThan(C.c4);
  expect(now.now).toBeLessThan(C.c4 + BROWNOUT.rescue.surgeSeconds + 0.1);
  expect((await story(page)).active).toBe(false);
  await page.screenshot({ path: 'test-results/screens/rescue-live.png' });
  await expect.poll(async () => (await crewHud(page)).hud.crew.hijackDone, { timeout: 90_000 }).toBe(true);
  expect((await state(page)).scene).toBe('board');
  const b = await board(page);
  expect(b.tray.find((t) => t.id === 'balancer')?.locked).toBe(false);
  expect(b.parts.some((p) => p.kind === 'balancer')).toBe(true);
});

test("a real overheat in C3 plays TRIAGE's replay and rewinds credits, parts and trust to 23:55:55", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await toBoard(page, 20);
  // One stock server and no kit: the evening climb to 90 cooks it.
  const id = await page.evaluate((cell) => window.__neonShell!.place(cell), SERVER_SLOTS[0]);
  expect(id).not.toBeNull();
  await page.evaluate((s) => window.__neonShell!.connect('gateway', s!), id);
  await page.evaluate((s) => window.__neonShell!.connect(s!, 'database'), id);
  await expect
    .poll(async () => (await story(page)).scriptId, { timeout: 90_000, intervals: [50] })
    .toBe('rewind-replay');
  const s = await story(page);
  expect(s.look).toBe('vhs');
  expect(s.lineId).toBe('C3.triage.rewind');
  await playThrough(page);
  await expect.poll(async () => (await state(page)).scene).toBe('board');
  // Speed 20 runs on as soon as the board is back, so the rewind target comes from the sim's record.
  const b = (await state(page)).board as unknown as Board & { rewinds: { at: number; to: number }[] };
  expect(b.rewinds).toHaveLength(1);
  expect(b.rewinds[0].to).toBe(C.c3);
  expect(b.rewinds[0].at).toBeGreaterThan(C.c3);
  // Back as it was at the start of C3: the one server and full trust.
  const h = (await state(page)).hud as unknown as { now: number; sim: { trust: number } };
  expect(h.now).toBeGreaterThanOrEqual(C.c3);
  expect(h.sim.trust).toBe(100);
  expect(b.parts.filter((p) => p.kind === 'server')).toHaveLength(1);
});

test('one test plays the whole session from the title to the one-screen end with best play', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await muted(page);
  await boot(page, '/?test&speed=20&autopilot');
  const shell = () =>
    page.evaluate(
      () =>
        (
          window.__neonTest!.state as unknown as {
            shell: { buttons: Record<string, { x: number; y: number }> };
          }
        ).shell,
    );
  await expect.poll(async () => (await shell()).buttons.start ?? null, { timeout: 15_000 }).not.toBeNull();
  const start = (await shell()).buttons.start;
  await page.mouse.click(start.x, start.y);

  // C0: the cold open is clicked through and hands over to the board's job card.
  await expect.poll(async () => (await story(page)).scriptId, { timeout: 15_000 }).toBe('C0');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/screens/session-cold-open.png' });
  await playThrough(page);
  type Hud = { now: number; jobCard: { open: boolean; x: number; y: number } };
  const hud = async () => (await state(page)).hud as unknown as Hud;
  await expect.poll(async () => (await hud())?.jobCard?.open ?? false, { timeout: 40_000 }).toBe(true);
  // The card ignores clicks for 400 ms after the cold open ends (the tail of a double-click).
  await page.waitForTimeout(500);
  const card = (await hud()).jobCard;
  await page.mouse.click(card.x, card.y);

  // C1 to C4 on best play, then the crew break into the comms (no scene).
  await expect
    .poll(async () => (await crewHud(page)).hud?.crew.call ?? null, { timeout: 120_000, intervals: [50] })
    .toBe('hijack');
  await page.screenshot({ path: 'test-results/screens/session-rescue.png' });
  await expect.poll(async () => (await crewHud(page)).hud.crew.hijackDone, { timeout: 90_000 }).toBe(true);

  // Midnight holds, the crew sign off over the HUD, then the one-screen end.
  await expect
    .poll(async () => (await story(page)).debrief?.step ?? null, { timeout: 120_000 })
    .toBe('scorecard');
  const s = await story(page);
  expect(s.debrief?.results.midnightHeld).toBe(true);
  expect(s.debrief?.results.serversAtMidnight).toBe(4);
  expect(s.debrief?.results.droppedRequests).toBeGreaterThan(0);
  expect(s.debrief?.results.ozzieTab).toBe(100);
  expect(s.debrief?.results.scaledDown).toBe(true);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/screens/session-debrief.png' });
  // One click ends the session.
  await page.mouse.click(s.debrief!.end.x, s.debrief!.end.y);
  await expect.poll(async () => (await state(page)).scene).toBe('title');
});

const REWINDS = [
  { kind: 'replay', now: C.c3 + 20, target: C.c3, lines: ['C3.triage.rewind', 'C3.lux.rewind'], look: 'vhs' },
  { kind: 'rei-surge', now: C.c5 + 20, target: C.c4, lines: ['C5.rei.rewind'], look: 'crew' },
  { kind: 'rei-midnight', now: C.c7 - 10, target: C.c6, lines: ['C6.rei.fail'], look: 'crew' },
] as const;

for (const r of REWINDS) {
  test(`a failure shows the ${r.kind} rewind and goes back to ${r.target}`, async ({ page }) => {
    await toBoard(page);
    await page.evaluate(
      ([now, kind]) => {
        window.__neonStory!.setNow(now);
        window.__neonStory!.playRewind(kind);
      },
      [r.now, r.kind] as const,
    );
    await expect.poll(async () => (await story(page)).lineId).toBe(r.lines[0]);
    let s = await story(page);
    expect(s.look).toBe(r.look);
    expect(s.nameplate).toBe(r.kind === 'replay' ? 'TRIAGE' : 'Rei');
    expect(s.runHeld).toBe(true);
    if (r.kind === 'replay') await page.screenshot({ path: 'test-results/screens/rewind-replay.png' });

    const lines: string[] = [s.lineId!];
    for (let i = 1; i < r.lines.length; i++) lines.push((await nextLine(page)).lineId!);
    expect(lines).toEqual(r.lines);
    await nextLine(page); // the rewind plays, then the board returns
    await expect.poll(async () => (await story(page)).active, { timeout: 10_000 }).toBe(false);
    s = await story(page);
    expect(s.sfx).toContain('rewind');
    expect(s.rewind).toEqual({ kind: r.kind, target: r.target });
    expect(s.runNow).toBeGreaterThanOrEqual(r.target);
    expect(s.runNow).toBeLessThan(r.target + 10);
    expect((await state(page)).scene).toBe('board');
  });
}

test('the end is one screen: the results, one lesson and the words for it, then a click ends the session', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await toBoard(page);
  const results = {
    droppedRequests: 12,
    wastedCredits: 80,
    trustLeft: 64,
    banner: 'pay',
    ozzieTab: 230,
    scaledDown: true,
    midnightHeld: true,
    serversAtMidnight: 5,
  } as const;
  await page.evaluate((r) => window.__neonStory!.playDebrief(r), results);
  await expect.poll(async () => (await story(page)).debrief?.step ?? null).toBe('scorecard');

  // Rolando, 2 Nov 2026: no Night Book pages, no interview card; one screen and done. Nobody stands
  // in the room and nothing is said over it.
  const s = await story(page);
  expect(s.debrief).toMatchObject({
    step: 'scorecard',
    results,
    title: 'Session 0: Brownout',
    lesson: 'Count the peak before you build. Then build for it, plus one spare.',
    words: 'Load balancer · Health checks · Scaling out · Redundancy, N+1',
  });
  expect(s.lineId).toBe(null);
  expect(s.onStage).toEqual([]);
  expect(Object.keys(s.figures)).toEqual([]);
  expect(s.sfx).toContain('fireworks');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/screens/debrief.png' });

  // One click anywhere ends the session: back to the title.
  await page.mouse.click(s.debrief!.end.x, s.debrief!.end.y);
  await expect.poll(async () => (await state(page)).scene).toBe('title');
});

test('reduce flicker keeps the debrief fireworks without flashes', async ({ page }) => {
  await slowText(page, { reduceFlicker: true });
  await toBoard(page);
  await page.evaluate(() => window.__neonStory!.playDebrief());
  await expect.poll(async () => (await story(page)).fireworks.bursts, { timeout: 10_000 }).toBeGreaterThan(1);
  const s = await story(page);
  expect(s.fireworks.flashes).toBe(0);
  // Built from the run: no banner answer yet, a fresh run's trust.
  expect(s.debrief?.results.banner).toBeNull();
  expect(s.debrief?.results.trustLeft).toBe(100);
});

test("the rain in Lux's room falls only on the window glass, never over the room", async ({ page }) => {
  await boot(page, '/?test&scene=story');
  await expect.poll(async () => (await story(page))?.scriptId, { timeout: 15_000 }).toBe('C0');
  const boxes: { glass: { x: number; y: number; w: number; h: number }; drawn: unknown }[] = [];
  for (let i = 0; i < 10; i++) {
    const s = await story(page);
    expect(s.rain).not.toBeNull();
    boxes.push(s.rain!);
    await page.waitForTimeout(150);
  }
  for (const { glass, drawn } of boxes) {
    expect(drawn).not.toBeNull();
    const d = drawn as { x: number; y: number; w: number; h: number };
    expect(d.x).toBeGreaterThanOrEqual(glass.x - 0.5);
    expect(d.y).toBeGreaterThanOrEqual(glass.y - 0.5);
    expect(d.x + d.w).toBeLessThanOrEqual(glass.x + glass.w + 0.5);
    expect(d.y + d.h).toBeLessThanOrEqual(glass.y + glass.h + 0.5);
  }
  await page.screenshot({ path: 'test-results/screens/story-room-rain.png' });
});

test('the cold open shows the photo as an insert, then Lux holding it on the left third, sunk behind the text box', async ({
  page,
}) => {
  await boot(page, '/?test&scene=story');
  await expect.poll(async () => (await story(page))?.scriptId, { timeout: 15_000 }).toBe('C0');
  let s = await story(page);
  expect(s.lineId).toBe('C0.tv.01');
  expect(s.photo).toBe(true);
  await page.screenshot({ path: 'test-results/screens/story-photo-insert.png' });
  // The chat blows up before anyone says so (Rolando, 31 Oct 2026): the first block message comes
  // with the TV's second line, while TRIAGE is still asleep.
  while (s.lineId !== 'C0.tv.02') {
    if (!s.typingDone) await clickStory(page);
    s = await clickStory(page);
  }
  expect(s.chat).toEqual(["kenji: lux the net's doing the thing again"]);
  expect(s.onStage).toEqual([]);
  while (s.lineId !== 'C0.lux.01') {
    if (!s.typingDone) await clickStory(page);
    s = await clickStory(page);
  }
  expect(s.photo).toBe(false);
  expect(s.onStage).toEqual(['Lux']);
  expect(s.chat).toHaveLength(3);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/screens/story-lux-staged.png' });
  // TRIAGE wakes to the fourth message, checks on her, and only then reads the chat out.
  while (s.lineId !== 'C0.triage.02') {
    if (!s.typingDone) await clickStory(page);
    s = await clickStory(page);
  }
  expect(s.chat).toHaveLength(4);
  expect(s.onStage).toEqual(['Lux', 'TRIAGE']);
  // The four script messages land in order, one at a time, with filler between them once it starts.
  await expect
    .poll(async () => (await story(page)).chatShown.filter((m) => s.chat.includes(m)).length, {
      timeout: 10_000,
    })
    .toBe(4);
  expect((await story(page)).chatShown.filter((m) => s.chat.includes(m))).toEqual(s.chat);
  await page.screenshot({ path: 'test-results/screens/story-triage-chat.png' });
  // ...and the chat keeps talking while the player reads.
  await expect.poll(async () => (await story(page)).chatShown.length, { timeout: 10_000 }).toBeGreaterThan(4);
});
