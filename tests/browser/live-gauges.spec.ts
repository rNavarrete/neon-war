import { expect, test } from '@playwright/test';
import { dismissJobCard, hud, openBoard, reach, shot } from './live/reach';

// The gauges lane's Live views (docs/LIVE.md), asserted on window.__neonTest.state.hud: the title
// cluster and the clock (gauges-1).

test('the title cluster: waiting for the first build, then live; WATCHING has no number yet; clock left of x 1800', async ({
  page,
}) => {
  test.setTimeout(60_000);

  // No autopilot: the clock waits on the first build after the job card.
  const first = await openBoard(page, { speed: 20, autopilot: false });
  await dismissJobCard(page);
  await expect.poll(async () => (await hud(page)).title?.live, { timeout: 5_000 }).toBe('waiting');
  let h = await hud(page);
  expect(h.title!.watching).toBeNull();
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
  // No audience event before the chat lane emits one (chat-3): still no number.
  expect(h.title!.watching).toBeNull();
  expect(second.errors).toEqual([]);
});
