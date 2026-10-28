import { type Page, expect, test } from '@playwright/test';
import type { HudTestState } from '../../src/scenes/hud/hook';
import { type ChatTraceTestState, chatArtOf } from '../../src/scenes/hud/ChatFeedView';
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

// ---- chat-5: the reaction to a placed server, and the district surge read as history ----
//
// hud.chat.feed keeps the newest 40 rows, so a sampler merges it read after read (rows keyed by id
// and HUD clock) beside hud.chatTrace, the error spells and retry climbs the chat stepped on, on the
// same clock. Two page loads at speed 20: the autopilot night to the rescue (about 40 s), and the
// surge entered with Lux still alone long enough for Mrs Okafor to leave (about 15 s).

type FeedRow = ChatTestState['feed'][number];

interface Sample {
  clock: number;
  now: number;
  servers: number;
}

class ChatLog {
  readonly rows: FeedRow[] = [];
  readonly samples: Sample[] = [];
  trace: ChatTraceTestState = { errors: [], retries: [] };
  private readonly keys = new Set<string>();

  async read(page: Page): Promise<void> {
    const s = await page.evaluate(() => {
      const st = window.__neonTest!.state;
      const h = st.hud;
      const parts = (st as unknown as { board?: { parts: { kind: string }[] } }).board?.parts ?? [];
      const chat = (h as unknown as { chat?: ChatTestState } | undefined)?.chat;
      if (!h || !chat || !Array.isArray(chat.feed)) return null;
      return {
        feed: chat.feed,
        trace: h.chatTrace ?? null,
        sample: { clock: chat.clock, now: h.now, servers: parts.filter((p) => p.kind === 'server').length },
      };
    });
    if (!s) return;
    this.samples.push(s.sample);
    if (s.trace) this.trace = s.trace;
    for (const r of s.feed) {
      const key = `${r.id}@${r.at}`;
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      this.rows.push(r);
    }
  }

  /** Sample every 100 ms while `work` runs. */
  async during<T>(page: Page, work: Promise<T>): Promise<T> {
    let running = true;
    const sampler = (async () => {
      while (running) {
        await this.read(page).catch(() => undefined);
        await page.waitForTimeout(100);
      }
    })();
    try {
      return await work;
    } finally {
      running = false;
      await sampler;
    }
  }

  /** Read every 50 ms until `done`, or fail naming `what`. */
  async until(page: Page, what: string, done: () => boolean, timeout = 15_000): Promise<void> {
    const deadline = Date.now() + timeout;
    for (;;) {
      await this.read(page);
      if (done()) return;
      if (Date.now() > deadline)
        throw new Error(`waited ${timeout / 1000} s for ${what}; rows: ${this.ids()}`);
      await page.waitForTimeout(50);
    }
  }

  ids(): string {
    return this.rows.map((r) => `${r.id}@${r.at.toFixed(2)}`).join(', ');
  }

  /** The most rows posted in any `seconds` of chat clock, counting rows from `from` on. */
  maxInWindow(seconds: number, from: number): number {
    const at = this.rows
      .filter((r) => r.at >= from)
      .map((r) => r.at)
      .sort((a, b) => a - b);
    let most = 0;
    for (let i = 0, j = 0; i < at.length; i++) {
      while (at[i] - at[j] >= seconds) j++;
      most = Math.max(most, i - j + 1);
    }
    return most;
  }
}

/** The error spell running at HUD clock `t`, if any. */
const spellAt = (trace: ChatTraceTestState, t: number) =>
  trace.errors.find((e) => e.from <= t && (e.to === null || t < e.to)) ?? null;

test('the chat reacts to the placed server, then the surge: complaint, calling, thanks after the errors, at most 10 posts per 30 s', async ({
  page,
}) => {
  test.setTimeout(75_000);
  // chat-6: the chat draws what the manifest says has landed (today nothing, so the code fallbacks),
  // with no texture warning in the console all night.
  const warnings: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'warning' || m.type() === 'error') && /texture/i.test(m.text()))
      warnings.push(m.text());
  });
  const { errors } = await openBoard(page);
  const log = new ChatLog();
  const art = await page.evaluate(() => window.__neonTest!.state.hud?.chatArt ?? null);
  expect(art).toEqual(chatArtOf());

  // C1: the autopilot places the first server; a stream reaction to it posts within 6 s, and the
  // first served packets post C1.chat.01 and C1.chat.02.
  await log.during(page, reach(page, 'c1'));
  await log.until(page, 'a stream row with cause placed', () =>
    log.rows.some((r) => r.chat === 'stream' && r.cause === 'placed'),
  );
  const firstPlaced = log.samples.find((s) => s.servers > 0);
  expect(firstPlaced, 'a server on the board').toBeDefined();
  const lastEmpty = log.samples.filter((s) => s.clock <= firstPlaced!.clock && s.servers === 0).pop();
  const placed = log.rows.find((r) => r.chat === 'stream' && r.cause === 'placed')!;
  expect(placed.id).toMatch(/^fill\.stream\.placed\./);
  expect(placed.at).toBeGreaterThanOrEqual(lastEmpty?.clock ?? 0);
  expect(placed.at - (lastEmpty?.clock ?? 0), log.ids()).toBeLessThanOrEqual(6);
  const ids = log.rows.map((r) => r.id);
  expect(ids).toContain('C1.chat.01');
  expect(ids).toContain('C1.chat.02');
  expect(ids.indexOf('C1.chat.01')).toBeLessThan(ids.indexOf('C1.chat.02'));

  // The district surge, through the rescue, then on until a thanks row has posted after it.
  await log.during(page, reach(page, 'surge'));
  const surgeClock = log.samples[log.samples.length - 1].clock;
  await log.during(page, reach(page, 'rescue'));
  const complaintOf = () => log.rows.find((r) => r.complaint && r.at >= surgeClock - 5) ?? null;
  await log.until(page, 'a thanks row after the surge complaint', () => {
    const c = complaintOf();
    return c !== null && log.rows.some((r) => r.thanks && r.at > c.at);
  });
  await shot(page, 'chat-surge');

  const trace = log.trace;
  const complaint = complaintOf()!;
  // The complaint posts while an error spell runs, after it started.
  const spell = spellAt(trace, complaint.at);
  expect(
    spell,
    `no error spell at ${complaint.id} @ ${complaint.at}: ${JSON.stringify(trace)}`,
  ).not.toBeNull();
  expect(complaint.at).toBeGreaterThanOrEqual(spell!.from);
  expect(complaint.chat).toBe('block');

  // 'calling... calling... calling...' (C4.chat.02) posts as the retries climb: inside the spell,
  // after the chat marked the retries climbing to 0.2 or more.
  const calling = log.rows.find((r) => r.id === 'C4.chat.02');
  expect(calling, log.ids()).toBeDefined();
  expect(calling!.text).toBe('calling... calling... calling...');
  expect(calling!.at).toBeGreaterThanOrEqual(spell!.from);
  const climbs = trace.retries.filter((m) => m.at >= spell!.from && m.at <= calling!.at);
  expect(climbs.length, JSON.stringify(trace.retries)).toBeGreaterThan(0);
  expect(Math.max(...climbs.map((m) => m.retry))).toBeGreaterThanOrEqual(0.2);

  // The thanks comes later than the complaint, and only once the errors have stopped.
  const thanks = log.rows.find((r) => r.thanks && r.at > complaint.at)!;
  expect(thanks.chat).toBe('block');
  expect(spellAt(trace, thanks.at), `errors still running at the thanks @ ${thanks.at}`).toBeNull();
  expect(spell!.to, 'the surge spell ended').not.toBeNull();
  expect(spell!.to!).toBeLessThanOrEqual(thanks.at);

  test.info().annotations.push({ type: 'rows', description: log.ids() });
  expect(warnings).toEqual([]);
  expect(errors).toEqual([]);
  // Across the surge the chat never posts more than 10 rows (one of tolerance) in any 30 s of chat
  // clock, scripted rows included. Last, so every check above has run when it fails.
  expect(log.maxInWindow(30, surgeClock - 30), log.ids()).toBeLessThanOrEqual(11);
});

test('Mrs Okafor leaves in the surge and posts nothing until the chat recovers', async ({ page }) => {
  test.setTimeout(40_000);
  const { errors } = await openBoard(page);
  await reach(page, 'c1');
  // Enter the district surge 18 s in with trust still full, so Lux is alone (no rescue yet) when the
  // surge-window lines play from 320. The leave needs the crew to be late, which the autopilot's
  // night never lets happen (its rescue comes at about 309).
  await page.evaluate(() => window.__neonStory!.setNow(318));
  const log = new ChatLog();
  const leave = () => log.rows.find((r) => r.id === 'C4.chat.03') ?? null;
  const recovery = () => {
    const l = leave();
    if (!l) return null;
    return log.rows.find((r) => r.at > l.at && (r.thanks || r.id === 'fill.block.rejoin.01')) ?? null;
  };
  await log.until(page, "'Mrs Okafor left the chat' (C4.chat.03)", () => leave() !== null);
  expect(leave()!.text).toBe('Mrs Okafor left the chat');
  // The crew break in (C5): reach clicks the scene through, then the chat recovers.
  await log.during(page, reach(page, 'rescue'));
  await log.until(
    page,
    'the recovery after the leave (a thanks row or her rejoin)',
    () => recovery() !== null,
    20_000,
  );
  const from = leave()!.at;
  const to = recovery()!.at;
  const hers = log.rows.filter((r) => r.who.toLowerCase() === 'mrs okafor' && r.at > from && r.at < to);
  expect(hers, log.ids()).toEqual([]);
  test.info().annotations.push({ type: 'rows', description: log.ids() });
  expect(errors).toEqual([]);
});
