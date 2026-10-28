import { expect, test } from '@playwright/test';
import { ZONE_IDS } from '../../src/scenes/live/layout';
import { fullState, openBoard, reach, shot } from './live/reach';

// The Live tour (tech-8): one page load at speed 20 with autopilot, run to the C4 surge and on to
// midnight. At each stop one read of the hook checks at least one field of every zone the Live
// screen draws (title, alert, clock, map, cam, gauge, scope, comms, deck, chat), the board's channel
// and the mixer (shell.voice), and that no zone is still a placeholder. Values that move between
// frames at speed 20 are checked through histories or as ranges, never as one exact frame.

type Obj = Record<string, unknown>;

/** The fields of the hook this spec reads, narrowed from `fullState`. */
interface Tour {
  hud: {
    now: number;
    clock: string;
    title: { live: string; watching: number | null; avatar: string | null };
    alert: { history: { kind: string; number: number; at: number }[] };
    map: { raid: boolean; midnight: boolean; dots: { pool: number; active: number } };
    luxCam: { art: string | null; mood: string; history: { mood: string; at: number }[] };
    gauge: { visible: boolean; demand: number; max: number; title: string };
    chart: { demand: number; ceiling: number; plot: { w: number; h: number } };
    comms: { slots: { name: string; present: boolean }[]; history: string[] };
    deck: { regroup: string; keys: { one: Obj; two: Obj } };
    chat: { feed: { who: string; text: string }[]; block: string[]; stream: string[] };
    audience: { watching: number } | null;
  };
  board: {
    channel: {
      demand: number;
      max: number;
      level: number;
      capacityLevel: number;
      marks: { label: string; value: number }[];
    };
  };
  shell: { voice: { started: string[]; recentVoice: string[]; missing: string[] } };
  live: { zones: Record<string, { x: number; y: number; w: number; h: number }>; placeholders: string[] };
}

async function tour(page: Parameters<typeof fullState>[0]): Promise<Tour> {
  return (await fullState(page)) as unknown as Tour;
}

/** What holds at both stops, whatever moment it is. */
function expectEveryZone(s: Tour, moment: string): void {
  const h = s.hud;
  // The Live skeleton: every zone on the page, none drawn by a placeholder.
  expect(Object.keys(s.live.zones).sort(), `${moment}: live.zones`).toEqual([...ZONE_IDS].sort());
  expect(s.live.placeholders, `${moment}: live.placeholders`).toEqual([]);
  // title
  expect(h.title.live, `${moment}: hud.title.live`).toBe('live');
  expect(h.title.avatar, `${moment}: hud.title.avatar`).toMatch(/^avatar:/);
  // clock
  expect(h.clock, `${moment}: hud.clock`).toMatch(/^\d\d:\d\d:\d\d$/);
  // alert: the C3 climb's forecast went up on the band before the surge
  expect(
    h.alert.history.some((a) => a.kind === 'forecast'),
    `${moment}: hud.alert.history has a forecast`,
  ).toBe(true);
  // map
  expect(h.map.dots.pool, `${moment}: hud.map.dots.pool`).toBeGreaterThan(0);
  expect(h.map.dots.active, `${moment}: hud.map.dots.active`).toBeGreaterThan(0);
  // cam
  expect(h.luxCam.art, `${moment}: hud.luxCam.art`).toMatch(/^portrait:lux\//);
  expect(h.luxCam.history.length, `${moment}: hud.luxCam.history`).toBeGreaterThan(1);
  // gauge
  expect(h.gauge.visible, `${moment}: hud.gauge.visible`).toBe(true);
  expect(h.gauge.max, `${moment}: hud.gauge.max`).toBe(400);
  expect(h.gauge.demand, `${moment}: hud.gauge.demand`).toBeGreaterThan(0);
  // scope
  expect(h.chart.demand, `${moment}: hud.chart.demand`).toBeGreaterThan(0);
  expect(h.chart.ceiling, `${moment}: hud.chart.ceiling`).toBeGreaterThanOrEqual(h.chart.demand);
  // comms
  expect(
    h.comms.slots.map((x) => x.name),
    `${moment}: hud.comms.slots`,
  ).toEqual(['TRIAGE', 'REI', 'MIKA', 'OZZIE', 'HOUSE']);
  expect(
    h.comms.history.some((id) => /\.triage\./.test(id)),
    `${moment}: hud.comms.history has a Triage line`,
  ).toBe(true);
  // deck
  expect(Object.keys(h.deck.keys).sort(), `${moment}: hud.deck.keys`).toEqual(['one', 'two']);
  // chat
  expect(h.chat.feed.length, `${moment}: hud.chat.feed`).toBeGreaterThan(0);
  expect(h.chat.block.length + h.chat.stream.length, `${moment}: hud.chat block + stream`).toBeGreaterThan(0);
  expect(h.audience?.watching, `${moment}: hud.audience.watching`).toBeGreaterThanOrEqual(1);
  // board.channel
  const c = s.board.channel;
  expect(c.max, `${moment}: board.channel.max`).toBe(400);
  expect(
    c.marks.map((m) => m.value),
    `${moment}: board.channel.marks`,
  ).toEqual([0, 100, 200, 300, 400]);
  expect(c.demand, `${moment}: board.channel.demand`).toBeGreaterThan(0);
  // shell.voice: the band's lines were voiced, and none was missing
  expect(s.shell.voice.started.length, `${moment}: shell.voice.started`).toBeGreaterThan(0);
  expect(s.shell.voice.missing, `${moment}: shell.voice.missing`).toEqual([]);
}

test('the Live tour: every zone, the channel and the voice, at the C4 surge and at midnight', async ({
  page,
}, testInfo) => {
  // Measured about 40 s from boot to midnight; the margin covers a slow shard.
  test.setTimeout(120_000);
  const { errors } = await openBoard(page, { speed: 20, autopilot: true });

  // ---- the C4 surge ----
  const surge = await reach(page, 'surge');
  const s = await tour(page);
  expectEveryZone(s, 'surge');
  expect(surge.seen.surgeAt300, 'the district surge warning (startsAt 300) was seen').toBe(true);
  expect(s.hud.clock, 'surge: hud.clock is before midnight').toMatch(/^23:5\d:\d\d$/);
  expect(s.hud.comms.history, 'surge: hud.comms.history').toContain('C1.triage.01');
  expect(s.hud.map.raid, 'surge: hud.map.raid').toBe(true);
  expect(s.hud.map.midnight, 'surge: hud.map.midnight').toBe(false);
  expect(s.hud.gauge.demand, 'surge: hud.gauge.demand').toBeGreaterThan(150);
  expect(s.board.channel.level, 'surge: board.channel over the wired room').toBeGreaterThan(
    s.board.channel.capacityLevel,
  );
  // Before the crew only Triage and the house are on the band.
  const before = Object.fromEntries(s.hud.comms.slots.map((x) => [x.name, x.present]));
  expect(before, 'surge: hud.comms.slots present').toMatchObject({ TRIAGE: true, REI: false, OZZIE: false });
  await shot(page, 'live-tour-surge');
  testInfo.annotations.push({
    type: 'surge',
    description: `now ${s.hud.now.toFixed(0)}, ${surge.seconds} s`,
  });

  // ---- midnight, the C5 rescue clicked through on the way ----
  const twelve = await reach(page, 'midnight', { timeout: 60_000 });
  const m = await tour(page);
  expectEveryZone(m, 'midnight');
  expect(twelve.scenes, 'the C5 rescue was clicked through').toContain('C5');
  expect(m.hud.clock, 'midnight: hud.clock').toMatch(/^00:0\d:\d\d$/);
  expect(m.hud.map.midnight, 'midnight: hud.map.midnight').toBe(true);
  // The crew came in at the rescue: every slot is lit, and the crew's lines were voiced.
  expect(
    m.hud.comms.slots.every((x) => x.present),
    'midnight: every hud.comms slot present',
  ).toBe(true);
  expect(m.hud.deck.regroup, 'midnight: hud.deck.regroup was handed over').not.toBe('hidden');
  expect(
    m.shell.voice.recentVoice.some((id) => /^C[56]\./.test(id)),
    'midnight: shell.voice.recentVoice has a C5 or C6 line',
  ).toBe(true);
  expect(m.hud.luxCam.history.length, 'midnight: hud.luxCam.history').toBeGreaterThan(1);
  await shot(page, 'live-tour-midnight');
  testInfo.annotations.push({
    type: 'midnight',
    description: `now ${m.hud.now.toFixed(0)}, ${twelve.seconds} s`,
  });

  expect(errors, 'page errors').toEqual([]);
});
