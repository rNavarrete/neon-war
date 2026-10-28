import { type Page, expect, test } from '@playwright/test';
import type { HudTestState } from '../../src/scenes/hud/hook';
import type { AudienceTestState, ChatTestState } from '../../src/scenes/live/views/chat';
import { hud, openBoard, reach, shot } from './live/reach';

// LIVE CHAT (chat-3, chat-4): the merged panel in ZONES.chat, driven by the host loop. It reads
// window.__neonTest.state.hud.chat and hud.audience (test mirrors) and clicks where they say.
// chat-5 adds the surge spec to this file.

type Chat = HudTestState & { chat: ChatTestState; audience?: AudienceTestState };

const chatOf = async (page: Page): Promise<Chat> => (await hud(page)) as Chat;

test('the chat opens with the phone messages, reacts to the first serve and toggles BLOCK ONLY', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { errors } = await openBoard(page);

  // The board opens: the four phone messages, the merged tag, nobody counted yet.
  let h = await chatOf(page);
  expect(h.chat.feed.slice(0, 4).map((r) => r.id)).toEqual([
    'C0.chat.01',
    'C0.chat.02',
    'C0.chat.03',
    'C0.chat.04',
  ]);
  expect(h.chat.feed.every((r) => typeof r.cause === 'string' && typeof r.at === 'number')).toBe(true);
  expect(h.chat.block[0]).toBe("kenji: lux the net's doing the thing again");
  expect(h.chat.header).toMatchObject({ title: 'LIVE CHAT', tag: 'BLOCK + STREAM' });
  expect(h.audience?.watching ?? null).toBeNull();

  // The first box serves: the cue table's two chat lines post, and the audience goes to 3.
  await reach(page, 'c1');
  await expect
    .poll(
      async () => {
        const c = await chatOf(page);
        return c.chat.feed.map((r) => r.id).filter((id) => id === 'C1.chat.01' || id === 'C1.chat.02');
      },
      { timeout: 30_000, intervals: [50] },
    )
    .toEqual(['C1.chat.01', 'C1.chat.02']);
  await expect.poll(async () => (await chatOf(page)).audience?.watching, { timeout: 30_000 }).toBe(3);

  h = await chatOf(page);
  const c = h.chat;
  expect(c.stream).toContain('viewer: first try lol');
  // Four or five rows, bottom-up inside the body (y 840-1060), none over the header.
  expect(c.shown).toBe(c.rows.length);
  expect(c.rows.length).toBeGreaterThanOrEqual(4);
  expect(c.rows.length).toBeLessThanOrEqual(5);
  const last = c.rows[c.rows.length - 1];
  expect(last.y + last.h).toBe(1060);
  for (const r of c.rows) {
    expect(r.y, r.id).toBeGreaterThanOrEqual(840);
    if (r.chat === 'stream') expect(r).toMatchObject({ ring: 'cyan', nameColor: 'cyan' });
    else if (!r.rule) expect(r.nameColor, r.id).toBe('amber');
  }
  // The panel sits in its zone (hud.bounds, page pixels) and the zone is no placeholder any more.
  const panel = h.bounds.find((b) => b.id === 'chat');
  expect(panel?.visible).toBe(true);
  const live = await page.evaluate(
    () => (window.__neonTest!.state as unknown as { live: { placeholders: string[] } }).live,
  );
  expect(live.placeholders).not.toContain('chat');

  // The header click is the only one: BLOCK ONLY, then back.
  await page.mouse.click(c.header.x, c.header.y);
  await expect.poll(async () => (await chatOf(page)).chat.filter).toBe('block');
  h = await chatOf(page);
  expect(h.chat.header.tag).toBe('BLOCK ONLY');
  expect(h.chat.rows.every((r) => r.chat === 'block')).toBe(true);
  expect(h.chat.shown).toBe(h.chat.rows.length);
  await shot(page, 'live-m3-chat');
  await page.mouse.click(c.header.x, c.header.y);
  await expect.poll(async () => (await chatOf(page)).chat.filter).toBe('all');
  expect(errors).toEqual([]);
});
