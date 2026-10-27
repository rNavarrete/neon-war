import { type Page, expect, test } from '@playwright/test';

// The shell: title, pause, settings, sound and the phone note. Every test drives the mouse at
// positions the test hook reports (state.shell.buttons) and asserts on window.__neonTest.state.

type State = NonNullable<Window['__neonTest']>['state'];
type JobCard = { open: boolean; x: number; y: number };

const state = (page: Page): Promise<State> => page.evaluate(() => window.__neonTest!.state);

/** Fail on any request that leaves the served origin (data: and blob: URLs stay in the page). */
let offOrigin: string[] = [];
test.beforeEach(({ page, baseURL }) => {
  offOrigin = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.origin !== origin) offOrigin.push(req.url());
  });
});
test.afterEach(() => {
  expect(offOrigin).toEqual([]);
});

async function waitForScene(page: Page, scene: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(() => window.__neonTest?.state);
        return s && s.ready && s.shell ? s.scene : null;
      },
      { timeout: 15_000 },
    )
    .toBe(scene);
}

/** Click a shell button by id, once the hook says it can be pressed. */
async function press(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await state(page)).shell?.buttons[id] ?? null, { timeout: 15_000 })
    .not.toBeNull();
  const { x, y } = (await state(page)).shell!.buttons[id];
  await page.mouse.click(x, y);
}

/** Dismiss the HUD's job card if it is open (the HUD stream's contract). */
async function dismissJobCard(page: Page): Promise<void> {
  const card = async () => ((await state(page)) as { hud?: { jobCard?: JobCard } }).hud?.jobCard;
  const open = await card();
  if (!open?.open) return;
  await page.mouse.click(open.x, open.y);
  await expect.poll(async () => (await card())?.open ?? false).toBe(false);
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/?test&scene=board');
  await waitForScene(page, 'board');
  await dismissJobCard(page);
  // The overlay's pause button shows once Esc and the button are live.
  await expect
    .poll(async () => (await state(page)).shell!.buttons.pause ?? null, { timeout: 15_000 })
    .not.toBeNull();
}

test('the title shows the logo over the skyline with Start, Settings and Credits; Start begins Session 0', async ({
  page,
}) => {
  await page.goto('/?test');
  await waitForScene(page, 'title');
  const buttons = (await state(page)).shell!.buttons;
  expect(Object.keys(buttons)).toEqual(expect.arrayContaining(['start', 'settings', 'credits']));
  expect(buttons.pause).toBeUndefined();
  expect((await state(page)).shell!.musicPlaying).toBe(false);
  await page.screenshot({ path: 'test-results/screens/title.png' });

  await press(page, 'credits');
  await expect.poll(async () => (await state(page)).shell!.creditsOpen).toBe(true);
  expect((await state(page)).shell!.buttons.start).toBeUndefined();
  await page.screenshot({ path: 'test-results/screens/title-credits.png' });
  await press(page, 'creditsClose');
  await expect.poll(async () => (await state(page)).shell!.creditsOpen).toBe(false);

  await press(page, 'start');
  // Session 0 opens with the cold open (story) and then the board.
  await expect.poll(async () => (await state(page)).scene, { timeout: 15_000 }).toMatch(/^(story|board)$/);
  expect((await state(page)).shell!.lastSfx).toBe('ui-click');
});

test('Esc and the pause button open Pause; the sim clock holds still while paused', async ({ page }) => {
  await openBoard(page);
  await page.screenshot({ path: 'test-results/screens/board-pause-button.png' });

  await page.keyboard.press('Escape');
  await waitForScene(page, 'pause');
  expect((await state(page)).shell!.paused).toBe(true);
  const before = (await state(page)).shell!.simNow;
  await page.waitForTimeout(2000);
  expect((await state(page)).shell!.simNow).toBe(before);
  expect(Object.keys((await state(page)).shell!.buttons)).toEqual(
    expect.arrayContaining(['resume', 'restart', 'pauseSettings', 'quit']),
  );
  await page.screenshot({ path: 'test-results/screens/pause.png' });

  await press(page, 'resume');
  await waitForScene(page, 'board');
  expect((await state(page)).shell!.paused).toBe(false);

  await press(page, 'pause');
  await waitForScene(page, 'pause');
  const held = (await state(page)).shell!.simNow;
  await page.waitForTimeout(2000);
  expect((await state(page)).shell!.simNow).toBe(held);

  await press(page, 'restart');
  await expect.poll(async () => (await state(page)).scene, { timeout: 15_000 }).toMatch(/^(story|board)$/);
  expect((await state(page)).shell!.paused).toBe(false);
});

test('Quit to title leaves the board, and the board music stops', async ({ page }) => {
  await openBoard(page);
  await expect.poll(async () => (await state(page)).shell!.musicPlaying).toBe(true);

  await page.keyboard.press('Escape');
  await waitForScene(page, 'pause');
  await press(page, 'quit');
  await waitForScene(page, 'title');
  expect((await state(page)).shell!.paused).toBe(false);
  await expect.poll(async () => (await state(page)).shell!.musicPlaying).toBe(false);
});

test('settings change volume, text speed and reduce flicker; volume and reduce flicker survive a reload', async ({
  page,
}) => {
  await page.goto('/?test');
  await waitForScene(page, 'title');
  expect((await state(page)).shell!.settings).toMatchObject({ volume: 0.8, reduceFlicker: false });

  await press(page, 'settings');
  await waitForScene(page, 'settings');
  expect(Object.keys((await state(page)).shell!.buttons)).toEqual(
    expect.arrayContaining(['volumeDown', 'volumeUp', 'textSpeed', 'reduceFlicker', 'fullscreen', 'back']),
  );
  await press(page, 'volumeDown');
  await press(page, 'volumeDown');
  await press(page, 'reduceFlicker');
  await press(page, 'textSpeed');
  await expect
    .poll(async () => (await state(page)).shell!.settings)
    .toMatchObject({ volume: 0.6, reduceFlicker: true, textSpeed: 'fast' });
  await page.screenshot({ path: 'test-results/screens/settings-reduce-flicker.png' });

  await press(page, 'back');
  await waitForScene(page, 'title');

  await page.reload();
  await waitForScene(page, 'title');
  expect((await state(page)).shell!.settings).toMatchObject({ volume: 0.6, reduceFlicker: true });
});

test('settings opened from pause return to pause', async ({ page }) => {
  await openBoard(page);
  await page.keyboard.press('Escape');
  await waitForScene(page, 'pause');
  await press(page, 'pauseSettings');
  await waitForScene(page, 'settings');
  await press(page, 'back');
  await waitForScene(page, 'pause');
  expect((await state(page)).shell!.paused).toBe(true);
});

test('placing a part and making a wire play their effects', async ({ page }) => {
  await openBoard(page);
  await page.waitForFunction(() => window.__neonShell !== undefined);

  const id = await page.evaluate(() => window.__neonShell!.place('s1'));
  expect(id).not.toBeNull();
  expect((await state(page)).shell!.lastSfx).toBe('place-part');

  expect(await page.evaluate((server) => window.__neonShell!.connect(server, 'database'), id!)).toBe(true);
  expect((await state(page)).shell!.lastSfx).toBe('wire-connect');

  await page.evaluate(() => window.__neonShell!.emit('overheat'));
  expect((await state(page)).shell!.lastSfx).toBe('server-hot');
  await page.evaluate(() => window.__neonShell!.emit('powerDip'));
  expect((await state(page)).shell!.lastSfx).toBe('power-dip');
  await page.evaluate(() => window.__neonShell!.emit('rescue'));
  expect((await state(page)).shell!.lastSfx).toBe('rescue-cable');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('shows a "play on a computer" note instead of the game', async ({ page }) => {
    await page.goto('/?test');
    const note = page.locator('#play-on-computer');
    await expect(note).toBeVisible();
    await expect(note).toContainText('computer');
    expect(await page.locator('canvas').count()).toBe(0);
    expect(await page.evaluate(() => '__neonTest' in window)).toBe(false);
    await page.screenshot({ path: 'test-results/screens/phone-note.png' });
  });
});

test.describe('in a narrow window', () => {
  test.use({ viewport: { width: 800, height: 600 } });

  test('shows the note too', async ({ page }) => {
    await page.goto('/?test');
    await expect(page.locator('#play-on-computer')).toBeVisible();
    expect(await page.locator('canvas').count()).toBe(0);
  });
});
