import { type Page, expect, test } from '@playwright/test';
import { artRequest, isPicked } from '../../src/game/artManifest';
import type { CommsTestState } from '../../src/scenes/live/views/comms';
import { dismissJobCard, hud, openBoard, reach, setDial, shot } from './live/reach';

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
  // The recorded clip for the line exists now, so the mixer starts it and the band marks the line
  // voiced (it was false while no voice file existed).
  await expect
    .poll(async () => (await comms(page)).line?.voiced ?? null, { timeout: 5_000, intervals: [25] })
    .toBe(true);
  for (const [id, span] of spans) expect(span, id).toBeGreaterThanOrEqual(4 - 1e-6);
  // One line at a time: the first ended before the second started.
  expect(c.history).toEqual(['C1.triage.01', 'C1.triage.02']);
  expect(c.emitted.slice(0, 3)).toEqual(['line:C1.triage.01', 'lineEnd:C1.triage.01', 'line:C1.triage.02']);
  expect(c.triage).toEqual({ mood: 'wrong-and-proud' });
  expect(c.slots.find((s) => s.name === 'TRIAGE')!.speaking).toBe(true);
  // comms-4: her iris wears the line's mood, and her ring pulses amber (reduce flicker is off).
  expect(c.iris.mood).toBe('wrong-and-proud');
  expect(c.iris.motion).toBe('full');
  expect(c.glow).toMatchObject({ slot: 'TRIAGE', color: 'amber', motion: 'pulse', others: 0.25 });
  expect(c.crew.light).toBe(0);

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

// comms-4: through the night to the rescue at speed 20 with the autopilot and reduce flicker on.
// A sampler in the page reads hud.comms every 100 ms (at speed 20 the current line moves between
// Playwright reads): whenever TRIAGE speaks, hud.comms.triage.mood is her line's bracket, and it is
// null for everyone else; under reduce flicker the ring is steady and the panicking iris is still.
// The crew's slots are dark until the C5 rescue scene and lit after it.
interface CommsSample {
  speaker: string;
  id: string;
  triage: string | null;
  iris: { mood: string; dx: number; dy: number; motion: string };
  glow: { slot: string | null; color: string | null; motion: string };
  crewPresent: boolean[];
  rescueDone: boolean;
}

test('comms-4, comms-9: TRIAGE moods, steady glow, still iris under reduce flicker, crew lit after the rescue, art through the manifest', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Voices on (the default): each voiced line holds the band for its clip (comms-6) on the HUD
  // clock, which keeps step with the sim at the reach speed, as it does for a player at speed 1.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'neon-war.settings',
      JSON.stringify({ volume: 0, textSpeed: 'fast', reduceFlicker: true }),
    );
  });
  const { errors } = await openBoard(page);
  let c = await comms(page);
  expect(c.slots.filter((s) => s.present).map((s) => s.name)).toEqual(['TRIAGE', 'HOUSE']);
  expect(c.crew.light).toBe(0);
  expect(c.iris.motion).toBe('reduced');
  expect(c.glow.motion).toBe('steady');

  await page.evaluate(() => {
    const w = window as unknown as { __commsSamples: unknown[] };
    w.__commsSamples = [];
    setInterval(() => {
      const s = window.__neonTest!.state as unknown as {
        hud?: { comms?: CommsTestState };
        story?: { finished: string[] };
      };
      const k = s.hud?.comms;
      if (!k) return;
      w.__commsSamples.push({
        speaker: k.line?.speaker ?? '',
        id: k.line?.id ?? '',
        triage: k.triage?.mood ?? null,
        iris: { mood: k.iris.mood, dx: k.iris.dx, dy: k.iris.dy, motion: k.iris.motion },
        glow: { slot: k.glow.slot, color: k.glow.color, motion: k.glow.motion },
        crewPresent: k.slots.filter((x) => ['REI', 'MIKA', 'OZZIE'].includes(x.name)).map((x) => x.present),
        rescueDone: s.story?.finished.includes('C5') ?? false,
      });
    }, 100);
  });

  const r = await reach(page, 'rescue', { timeout: 60_000 });
  expect(r.scenes).toContain('C5');
  const samples = (await page.evaluate(
    () => (window as unknown as { __commsSamples: unknown[] }).__commsSamples,
  )) as CommsSample[];
  const spoken = samples.filter((s) => s.id !== '');
  const triage = spoken.filter((s) => s.speaker.startsWith('TRIAGE'));
  const others = spoken.filter((s) => !s.speaker.startsWith('TRIAGE'));
  expect(triage.length, 'samples with TRIAGE speaking').toBeGreaterThan(0);
  expect(others.length, 'samples with someone else speaking').toBeGreaterThan(0);
  for (const s of triage) {
    const mood = /\(([^)]+)\)/.exec(s.speaker)![1];
    expect(s.triage, s.id).toBe(mood);
    expect(s.iris.mood, s.id).toBe(mood);
  }
  for (const s of others) expect(s.triage, s.id).toBeNull();
  // Reduce flicker: every glow steady, every iris reduced, and a panicking iris never moves.
  expect(samples.every((s) => s.glow.motion === 'steady' && s.iris.motion === 'reduced')).toBe(true);
  const panicking = triage.filter((s) => s.triage === 'panicking');
  expect(panicking.length, 'samples with a panicking TRIAGE line (the surge WARNINGs)').toBeGreaterThan(0);
  for (const s of panicking) {
    expect([s.iris.dx, s.iris.dy], s.id).toEqual([0, 0]);
    expect(s.glow, s.id).toMatchObject({ slot: 'TRIAGE', color: 'red' });
  }
  // The crew stay dark until the rescue scene is through.
  const before = samples.filter((s) => !s.rescueDone);
  expect(before.length).toBeGreaterThan(0);
  expect(before.every((s) => s.crewPresent.every((p) => !p))).toBe(true);

  // After it, REI, MIKA and OZZIE are in, and their faces light over 400 ms.
  await expect.poll(async () => (await comms(page)).crew.light, { timeout: 5_000, intervals: [50] }).toBe(1);
  c = await comms(page);
  expect(
    c.slots.filter((s) => ['REI', 'MIKA', 'OZZIE'].includes(s.name)).map((s) => [s.name, s.present]),
  ).toEqual([
    ['REI', true],
    ['MIKA', true],
    ['OZZIE', true],
  ]);

  // comms-9: the band's art comes through the manifest. Each piece uses its pick when the manifest
  // has one and its fallback otherwise (today: the text-box plate, the reused board faces and the
  // code HOUSE glyph), and nothing draws Phaser's missing texture.
  const pickedKey = (key: string): boolean => {
    const r = artRequest(key);
    return !!r && isPicked(r);
  };
  expect(c.art.plate.use).toBe(pickedKey('hud/comms-plate') ? 'picked' : 'reuse');
  expect(c.art.plate.texture).not.toBeNull();
  expect(c.art.faces.map((f) => [f.slot, f.key])).toEqual([
    ['TRIAGE', 'chars/comms/triage'],
    ['REI', 'chars/comms/rei'],
    ['MIKA', 'chars/comms/mika'],
    ['OZZIE', 'chars/comms/ozzie'],
  ]);
  for (const f of c.art.faces) {
    expect(f.use, f.key).toBe(pickedKey(f.key) ? 'picked' : 'reuse');
    expect(f.texture, f.key).toBe(`avatar:${f.key}@84`);
  }
  expect(c.art.house.chips).toEqual(
    ['hud/icons/door', 'hud/icons/tv'].map((key) => ({ key, use: pickedKey(key) ? 'picked' : 'code' })),
  );
  expect(c.art.house.drawn).toBe(
    c.art.house.chips[c.art.house.shown === 'door' ? 0 : 1].use === 'picked' ? 'art' : 'glyph',
  );
  const art = await page.evaluate(
    () => (window.__neonTest!.state as unknown as { art: { missing: string[] } }).art,
  );
  expect(art.missing).toEqual([]);
  // The four round avatars, the HOUSE chip and the plate sit inside the band (screenshot below).
  for (const s of c.slots) {
    expect(insideRect({ x: s.x - s.r, y: s.y - s.r, w: 2 * s.r, h: 2 * s.r }, c.rect), s.name).toBe(true);
  }
  expect(insideRect(c.drawn, c.rect)).toBe(true);

  await shot(page, 'live-m3-comms');
  expect(errors).toEqual([]);
});

// ---- comms-5/6/7/8: voices and the leader line ----

type HookState = Record<string, unknown> & {
  scene: string | null;
  ready: boolean;
  shell?: {
    buttons: Record<string, { x: number; y: number }>;
    settings: { volume: number; voices?: string; voiceVolume?: number };
    voice?: { lang: string; volume: number };
  };
  settingsScreen?: {
    open: boolean;
    voices: string;
    voiceVolume: number;
    labels: { voices: string; voiceVolume: string } | null;
  };
};
const hook = (page: Page): Promise<HookState> =>
  page.evaluate(() => window.__neonTest!.state as unknown as HookState);

/** Click a shell button by id once the hook lists it. */
async function press(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await hook(page)).shell?.buttons[id] ?? null, { timeout: 10_000 })
    .not.toBeNull();
  const { x, y } = (await hook(page)).shell!.buttons[id];
  await page.mouse.click(x, y);
}

async function waitScene(page: Page, scene: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(() => window.__neonTest?.state);
        return s && s.ready ? s.scene : null;
      },
      { timeout: 15_000 },
    )
    .toBe(scene);
}

// comms-7 (and comms-5's settings): the Voices and Voice volume rows sit beside the old rows, two
// presses of Voices turn them off, one press of − takes the voice volume to 90%, the old rows still
// work, and both survive a reload. About 6 s.
test('comms-7: Voices JA/EN/OFF and Voice volume rows; old rows still work; both survive a reload', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/?test');
  await waitScene(page, 'title');
  await press(page, 'settings');
  await waitScene(page, 'settings');

  let s = await hook(page);
  expect(Object.keys(s.shell!.buttons)).toEqual(
    expect.arrayContaining([
      'volumeDown',
      'volumeUp',
      'textSpeed',
      'reduceFlicker',
      'fullscreen',
      'voices',
      'voiceDown',
      'voiceUp',
      'back',
    ]),
  );
  expect(s.settingsScreen).toEqual({
    open: true,
    voices: 'ja',
    voiceVolume: 1,
    labels: { voices: 'JA', voiceVolume: '100%' },
  });

  await press(page, 'voices');
  await expect.poll(async () => (await hook(page)).settingsScreen!.voices).toBe('en');
  await press(page, 'voices');
  await expect.poll(async () => (await hook(page)).settingsScreen!.voices).toBe('off');
  await press(page, 'voiceDown');
  await expect.poll(async () => (await hook(page)).settingsScreen!.voiceVolume).toBe(0.9);
  // The old rows keep working beside the new ones.
  await press(page, 'volumeDown');
  await expect.poll(async () => (await hook(page)).shell!.settings.volume).toBe(0.7);
  s = await hook(page);
  expect(s.settingsScreen!.labels).toEqual({ voices: 'OFF', voiceVolume: '90%' });
  // The shell section mirrors both settings, and the mixer's hook reads them too.
  expect(s.shell!.settings.voices).toBe('off');
  expect(s.shell!.settings.voiceVolume).toBe(0.9);
  expect(s.shell!.voice).toMatchObject({ lang: 'off', volume: 0.9 });
  const stored = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem('neon-war.settings') ?? '{}'),
  );
  expect(stored).toMatchObject({ voices: 'off', voiceVolume: 0.9, volume: 0.7 });
  await shot(page, 'comms-settings-voices');

  await press(page, 'back');
  await waitScene(page, 'title');
  await page.reload();
  await waitScene(page, 'title');
  s = await hook(page);
  expect(s.settingsScreen).toMatchObject({ open: false, voices: 'off', voiceVolume: 0.9 });
  expect(s.shell!.settings.volume).toBe(0.7);
  expect(errors).toEqual([]);
});

type VoiceHook = {
  recentVoice: string[];
  missing: string[];
  playing: string | null;
  started: string[];
  requested: string[];
  lastVoice: string | null;
};
type StoryHook = {
  scriptId: string | null;
  lineId: string | null;
  typingDone: boolean;
  active: boolean;
  clicks: number;
  click: { x: number; y: number } | null;
  voices: string[];
  voiceStops: string[];
  finished: string[];
};
const voiceOf = (page: Page): Promise<VoiceHook> =>
  page.evaluate(() => (window.__neonTest!.state as unknown as { shell: { voice: VoiceHook } }).shell.voice);
const storyOf = (page: Page): Promise<StoryHook | null> =>
  page.evaluate(
    () => (window.__neonTest?.state as unknown as { story?: StoryHook } | undefined)?.story ?? null,
  );

// comms-6, scenes: every line the cold open shows in the text box asks for its voice once, through
// playVoice, in the order shown; a click past a line cuts its voice (story.voiceStops), and the
// scene ending cuts the last. With the recorded voices on disk each line's clip plays while it
// shows (shell.voice.started names it), is fetched once and is never missing; once the scene ends
// nothing plays. (Before the files landed this asserted nothing played and nothing was fetched.)
// About 9 s.
test('comms-6: scene lines ask for their voice in order; a click past a line cuts it', async ({ page }) => {
  test.setTimeout(40_000);
  const errors: string[] = [];
  const fetched: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('request', (req) => {
    if (req.url().includes('/audio/voice/')) fetched.push(req.url());
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('neon-war.settings', JSON.stringify({ textSpeed: 'fast' }));
  });
  await page.goto('/?test&scene=story');
  await expect.poll(async () => (await storyOf(page))?.scriptId ?? null, { timeout: 15_000 }).toBe('C0');

  const shown: string[] = [];
  for (let guard = 0; guard < 20; guard++) {
    const s = (await storyOf(page))!;
    if (!s.active || s.scriptId !== 'C0') break;
    if (s.lineId && shown.at(-1) !== s.lineId) {
      shown.push(s.lineId);
      // The line asked for its voice as it showed, and the one before it was cut.
      expect(s.voices.at(-1), s.lineId).toBe(s.lineId);
      expect((await voiceOf(page)).recentVoice.at(-1), s.lineId).toBe(s.lineId);
      if (shown.length > 1) expect(s.voiceStops.at(-1)).toBe(shown.at(-2));
      // Its clip starts while the line shows: the mixer reports voiceStart for it.
      await expect
        .poll(async () => (await voiceOf(page)).started, { timeout: 5_000, intervals: [25] })
        .toContain(s.lineId);
    }
    await expect.poll(async () => (await storyOf(page))!.typingDone, { timeout: 5_000 }).toBe(true);
    const before = (await storyOf(page))!;
    await page.mouse.click(before.click!.x, before.click!.y);
    await expect
      .poll(
        async () => {
          const n = (await storyOf(page))!;
          return n.clicks > before.clicks && (n.lineId !== before.lineId || !n.active);
        },
        { timeout: 5_000 },
      )
      .toBe(true);
  }
  await expect.poll(async () => (await storyOf(page))!.finished, { timeout: 10_000 }).toContain('C0');

  const s = (await storyOf(page))!;
  expect(shown.length).toBeGreaterThanOrEqual(5);
  expect(shown[0]).toBe('C0.tv.01');
  expect(s.voices).toEqual(shown);
  // Every line was cut on its way out: the clicks past each, then the scene ending after the last.
  expect(s.voiceStops).toEqual(shown);
  const v = await voiceOf(page);
  expect(v.recentVoice).toEqual(shown);
  // Each request is on record in the language the (default, Japanese) voices setting gave it.
  expect(v.requested).toEqual(shown.map((id) => `ja:${id}`));
  for (const r of v.requested) expect(r).toMatch(/^ja:C0\./);
  expect(v.lastVoice).toBe(shown.at(-1));
  // The files exist now: no shown id is missing, each clip started once, in the order shown, and
  // was fetched once in Japanese. The scene ending cut the last one, so nothing plays.
  for (const id of shown) expect(v.missing).not.toContain(id);
  expect(v.playing).toBeNull();
  expect(v.started).toEqual(shown);
  for (const id of shown)
    expect(
      fetched.filter((u) => u.endsWith(`/audio/voice/ja/${id}.mp3`)),
      id,
    ).toHaveLength(1);
  expect(new Set(fetched).size).toBe(fetched.length);
  expect(errors).toEqual([]);
});

// comms-6, band: every bark the band shows asks the mixer for its voice exactly once (bus `line`
// is the request), in the order shown; a voiceStart for the current line marks it voiced and holds
// it until at least seconds + 0.6 after it started. `window.__neonComms.voiceStart` reports a 3 s
// clip so the hold is known; the mixer's own voiceStart for the real clip may follow, and the band
// keeps the longer hold. About 8 s.
test('comms-6: each band line asks for its voice once, in order; voiceStart holds the line', async ({
  page,
}) => {
  test.setTimeout(40_000);
  // Speed 4: the HUD clock keeps step with the sim, so at speed 20 a 5 s line is a quarter of a real
  // second, one or two frames of a slow headless browser, too short for the sampler to send the
  // voiceStart and then read the line back. At speed 4 it shows for over a real second.
  const { errors } = await openBoard(page, { speed: 4, autopilot: true });
  // In the page: the first time C1.triage.02 is current, report a 3 s clip for it, then record what
  // the band reports for that line.
  await page.evaluate(() => {
    const w = window as unknown as { __voiced: unknown[]; __sent: boolean };
    w.__voiced = [];
    w.__sent = false;
    setInterval(() => {
      const c = (window.__neonTest!.state as unknown as { hud?: { comms?: CommsTestState } }).hud?.comms;
      const line = c?.line;
      if (!line || line.id !== 'C1.triage.02') return;
      if (!w.__sent) {
        w.__sent = true;
        window.__neonComms!.voiceStart('C1.triage.02', 3);
        return;
      }
      w.__voiced.push({ voiced: line.voiced, since: line.since, until: line.until });
    }, 20);
  });
  await dismissJobCard(page);
  type Voiced = { voiced: boolean; since: number; until: number };
  const readVoiced = (): Promise<Voiced[]> =>
    page.evaluate(() => (window as unknown as { __voiced: Voiced[] }).__voiced);
  await expect
    .poll(async () => (await readVoiced()).filter((x) => x.voiced).length, {
      timeout: 15_000,
      intervals: [50],
    })
    .toBeGreaterThan(0);
  for (const r of (await readVoiced()).filter((x) => x.voiced)) {
    expect(r.until - r.since).toBeGreaterThanOrEqual(3 + 0.6 - 1e-6);
  }

  // Let a few more lines through, then compare the band's history with the mixer's requests.
  await expect
    .poll(async () => (await comms(page)).history.length, { timeout: 15_000, intervals: [50] })
    .toBeGreaterThanOrEqual(3);
  const { c, v } = await page.evaluate(() => {
    const s = window.__neonTest!.state as unknown as {
      hud: { comms: CommsTestState };
      shell: { voice: VoiceHook };
    };
    return { c: s.hud.comms, v: s.shell.voice };
  });
  expect(c.log.replayed).toEqual([]);
  const n = Math.min(c.history.length, v.recentVoice.length);
  expect(v.recentVoice.slice(-n)).toEqual(c.history.slice(-n));
  for (const id of c.history)
    expect(
      v.recentVoice.filter((x) => x === id),
      id,
    ).toHaveLength(1);
  // The band sends no `voice` of its own for a line (only the replay glyph does).
  expect(c.emitted.filter((e) => e.startsWith('voice:'))).toEqual([]);
  expect(errors).toEqual([]);
});

// comms-8: the leader line. Through C1 to C3 at speed 20 with the autopilot, a sampler in the page
// records hud.comms.line and hud.comms.leader every 20 ms (a line lasts a fraction of a second at
// this speed). A second box racked in C3 fires C3.triage.02, whose leader names that box and ends
// within 2 page px of its anchor (board.parts[] reports partAnchor). A line with no LEADER_FOR entry
// (C1.triage.02) reports null; a zone line reports null while its zone is unregistered and ends
// within 8 page px of the registered point once a lane registers it. About 16 s.
interface LeaderSample {
  id: string;
  leader: { subject: string; target: string; from: Pt; corner: Pt; to: Pt } | null;
  located: Record<string, Pt | null>;
}
type Pt = { x: number; y: number };

test('comms-8: the leader points at the idle box for C3.triage.02; null without an entry or a registered zone', async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Voices on (the default): C3.triage.02 waits behind the voiced C3 lines on the HUD clock, which
  // keeps step with the sim at speed 20.
  const { errors } = await openBoard(page, { speed: 20, autopilot: true });
  await page.evaluate(() => {
    const w = window as unknown as { __leader: unknown[] };
    w.__leader = [];
    setInterval(() => {
      const c = (window.__neonTest!.state as unknown as { hud?: { comms?: CommsTestState } }).hud?.comms as
        (CommsTestState & { leader: unknown; located: unknown }) | undefined;
      if (!c?.line) return;
      w.__leader.push({ id: c.line.id, leader: c.leader, located: c.located });
    }, 20);
  });
  const samples = (): Promise<LeaderSample[]> =>
    page.evaluate(() => (window as unknown as { __leader: LeaderSample[] }).__leader);

  await dismissJobCard(page);
  await reach(page, 'c3', { timeout: 30_000 });
  await expect
    .poll(async () => (await comms(page)).history, { timeout: 10_000, intervals: [50] })
    .toContain('C3.triage.01');
  // Rack a second box in a free pad: TRIAGE asks why it does nothing.
  const pad = await page.evaluate(
    () =>
      (
        window.__neonTest!.state as unknown as {
          board: { slots: { id: string; part: string | null; locked: boolean }[] };
        }
      ).board.slots.find((s) => s.part === null && !s.locked)!.id,
  );
  const idle = await page.evaluate((slot) => window.__neonShell!.place(slot), pad);
  expect(idle).not.toBeNull();
  await expect
    .poll(async () => (await samples()).some((s) => s.id === 'C3.triage.02' && s.leader !== null), {
      timeout: 15_000,
      intervals: [50],
    })
    .toBe(true);

  const all = await samples();
  const parts = await page.evaluate(
    () =>
      (window.__neonTest!.state as unknown as { board: { parts: { id: string; x: number; y: number }[] } })
        .board.parts,
  );
  const part = parts.find((p) => p.id === idle)!;
  const near = (a: Pt, b: Pt, px: number): boolean => Math.abs(a.x - b.x) <= px && Math.abs(a.y - b.y) <= px;
  const triage02 = all.filter((s) => s.id === 'C3.triage.02' && s.leader);
  expect(triage02.length).toBeGreaterThan(0);
  for (const s of triage02) {
    expect(s.leader!.subject).toBe('part:idle');
    expect(s.leader!.target).toBe(idle);
    expect(near(s.leader!.to, part, 2), JSON.stringify([s.leader!.to, part])).toBe(true);
    // Right angles only.
    const [a, b, c] = [s.leader!.from, s.leader!.corner, s.leader!.to];
    expect(Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5).toBe(true);
    expect(Math.abs(b.x - c.x) < 0.5 || Math.abs(b.y - c.y) < 0.5).toBe(true);
  }

  // No LEADER_FOR entry: null.
  const plain = all.filter((s) => s.id === 'C1.triage.02');
  expect(plain.length).toBeGreaterThan(0);
  expect(plain.every((s) => s.leader === null)).toBe(true);
  // Zone lines: null while nobody registered the zone, at the registered point once someone has.
  const zoneNames: Record<string, string[]> = {
    'C1.triage.01': ['dialCard', 'dial'],
    'C3.triage.01': ['inventory', 'inventory:server'],
  };
  for (const [id, names] of Object.entries(zoneNames)) {
    const seen = all.filter((s) => s.id === id);
    expect(seen.length, id).toBeGreaterThan(0);
    for (const s of seen) {
      const registered = names.filter((n) => s.located[n]);
      if (registered.length === 0) expect(s.leader, id).toBeNull();
      else if (s.leader) expect(near(s.leader.to, s.located[s.leader.target]!, 8), id).toBe(true);
    }
  }

  // The leader is one more object for the band, inside its declared budget.
  const perf = await page.evaluate(
    () =>
      (
        window.__neonTest!.state as unknown as {
          perf?: { zones: Record<string, { budget: { objects: number }; actual: { objects: number } }> };
        }
      ).perf?.zones.comms ?? null,
  );
  if (perf) expect(perf.actual.objects).toBeLessThanOrEqual(perf.budget.objects);
  expect(errors).toEqual([]);
});
