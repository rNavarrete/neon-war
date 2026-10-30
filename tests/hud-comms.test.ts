import { artRequest } from '../src/game/artManifest';
import { TEXT_CPS } from '../src/game/settings';
import { COMMS_AVATARS, avatarSource } from '../src/scenes/avatars';
import {
  CHIP_SIZE,
  COMMS_PLATE,
  LEGACY_PLATE,
  chipArt,
  plateArt,
  plateFile,
  BARK_SECONDS,
  COMMS_QUEUE_MAX,
  CREW_LIGHT_SECONDS,
  DARK_ALPHA,
  DARK_TINT,
  IDLE_MOOD,
  OTHER_RING_ALPHA,
  PANIC_JITTER_HZ,
  RING_HIGH,
  RING_HZ,
  RING_LOW,
  RING_STEADY,
  SWAP_TICK_SCALE,
  SWAP_TICK_SECONDS,
  TRIAGE_MOODS,
  crewLight,
  crewTint,
  irisFor,
  moodOf,
  speakRing,
  swapTick,
  COMMS_SLOTS,
  type CommsState,
  FADE_SECONDS,
  LOG_CLOSED,
  LOG_ROWS,
  NO_COMMS,
  STALE_CHAINED_SECONDS,
  STALE_SECONDS,
  bandAlpha,
  clickLog,
  callShows,
  callTarget,
  isCallerLine,
  CALL_IDLE_ALPHA,
  commsLayout,
  cutShort,
  dwellFor,
  enqueueComms,
  extendForVoice,
  logLines,
  logOpen,
  nameOf,
  onRect,
  slotOf,
  staleAfter,
  stepComms,
  stepLog,
  tag,
  triageMood,
} from '../src/scenes/hud/comms';
import { BOTTOM } from '../src/scenes/hud/layout';
import { fileTexture } from '../src/scenes/plates';
import { LEADER_FOR, LESSON_IDS } from '../src/scenes/hud/lineMeta';
import { ZONES, inside } from '../src/scenes/live/layout';
import { LINES, type LineId } from '../src/strings';
import { Run } from '../src/game/run';
import { partAnchor } from '../src/scenes/board/layout';
import {
  type LeaderFrame,
  leaderPath,
  leaderSubject,
  locateNames,
  partForRole,
  resolveLeader,
} from '../src/scenes/hud/comms';
import { locate, register, registeredNames } from '../src/scenes/hud/locate';
import { SERVER_SLOTS } from '../src/sim/tick';
import { bestPlay } from '../src/game/autopilot';
import { type Frame, frame, resetFrame } from '../src/game/frame';
import { mixerLangFor } from '../src/game/mixer';
import { type Occurrence, detectOccurrences } from '../src/game/occurrences';
import { newRun } from '../src/game/run';
import { chatOf } from '../src/scenes/hud/chat';
import { type CueHost, NEW_DIRECTOR, cueViewOf, direct, emptyCueView } from '../src/scenes/hud/cues';
import { isLesson } from '../src/scenes/hud/lineMeta';
import { BROWNOUT } from '../src/sim/brownout';

// comms-1: the comms band's pure model (src/scenes/hud/comms.ts).

const CPS = TEXT_CPS.normal;

/** Enqueue `id` at `clock` and step once at the same clock. */
const say = (s: CommsState, id: LineId, clock: number): CommsState =>
  stepComms(enqueueComms(s, id, clock), clock, CPS);

/** Step the band every `dt` from `from` to `to`, recording which line is current at each step. */
function run(s: CommsState, from: number, to: number, dt = 0.05): { s: CommsState; seen: (LineId | null)[] } {
  const seen: (LineId | null)[] = [];
  for (let t = from; t <= to + 1e-9; t += dt) {
    s = stepComms(s, t, CPS);
    seen.push(s.current?.id ?? null);
  }
  return { s, seen };
}

describe('comms tags and slots', () => {
  it('takes tags from lineMeta', () => {
    expect(tag('C1.triage.02')).toBe('HINT');
    expect(tag('C4.triage.02')).toBe('WARNING');
    expect(tag('C5.rei.05')).toBe('CREW');
    expect(tag('C4.lux.01')).toBe('LUX');
    expect(tag('C6.tv.01')).toBe('HOUSE');
  });

  it('has five slots TRIAGE, REI, MIKA, OZZIE, HOUSE; Lux has none', () => {
    expect([...COMMS_SLOTS]).toEqual(['TRIAGE', 'REI', 'MIKA', 'OZZIE', 'HOUSE']);
    expect(slotOf(LINES['C1.triage.02'].speaker)).toBe('TRIAGE');
    expect(slotOf(LINES['C4.triage.02'].speaker)).toBe('TRIAGE');
    expect(slotOf(LINES['C5.rei.05'].speaker)).toBe('REI');
    expect(slotOf(LINES['C5.mika.05'].speaker)).toBe('MIKA');
    expect(slotOf(LINES['C5.ozzie.04'].speaker)).toBe('OZZIE');
    expect(slotOf(LINES['C4.grandma.01'].speaker)).toBe('HOUSE');
    expect(slotOf(LINES['C6.tv.01'].speaker)).toBe('HOUSE');
    expect(slotOf(LINES['C4.lux.01'].speaker)).toBeNull();
    expect(nameOf('C4.lux.01')).toBe('LUX');
    expect(nameOf('C1.triage.02')).toBe('TRIAGE');
    expect(triageMood('C4.triage.02')).toBe('panicking');
    expect(triageMood('C5.rei.05')).toBeNull();
  });

  it('lays the band out inside its zone where the HUD layout puts it', () => {
    // Layout A2 (Rolando, 30 Oct 2026): the comms zone is the 344x460 caller column at the right
    // edge. The caller's cam tile on top, their name and words under it, the five slots along the
    // bottom, overlapping like a call's participant stack.
    const l = commsLayout(ZONES.comms);
    expect(l.slots.map((s) => ({ name: s.name, x: s.x, y: s.y, r: s.r }))).toEqual(BOTTOM.slots);
    // Option 2 (Rolando, 30 Oct 2026: "too much wasted space"): the column is 344x500 from y 135 and the cam
    // tile takes the extra height (250 tall), the words and slots moving down with it.
    // Rolando, 30 Oct 2026 ("I don't think we need these avatars here"): the roster of round faces
    // is not drawn in the column, so the cam takes its space too (330 tall) and the words follow.
    expect(l.roster).toBe(false);
    expect(l.tile).toEqual({ x: 1574, y: 143, w: 328, h: 330 });
    expect(l.slots.map((s) => s.x)).toEqual([1616, 1677, 1738, 1799, 1860]);
    expect(l.slots.every((s) => s.y === 571)).toBe(true);
    expect(l.name).toEqual({ x: 1582, y: 481 });
    expect(l.text).toEqual({ x: 1582, y: 509, w: 312 });
    expect(l.log.map((r) => r.y)).toEqual([481, 517, 553]);
    const z = ZONES.comms;
    expect(inside(l.tile!, z)).toBe(true);
    expect(l.name.y).toBeGreaterThanOrEqual(l.tile!.y + l.tile!.h);
    // Four 26 px lines of words end inside the panel (the slots under them are not drawn since
    // Rolando's 30 Oct 2026 call; before, three lines ended above the slots).
    expect(l.text.y + 4 * 26).toBeLessThanOrEqual(z.y + z.h);
    for (const s of l.slots) {
      expect(s.x - s.r).toBeGreaterThanOrEqual(z.x);
      expect(s.x + s.r).toBeLessThanOrEqual(z.x + z.w);
      expect(s.y - s.r).toBeGreaterThanOrEqual(z.y);
      expect(s.y + s.r).toBeLessThanOrEqual(z.y + z.h);
    }
    expect(l.slotLabelY).toBeLessThanOrEqual(z.y + z.h);
    // The 12 px label (about 15 px tall, top-anchored) ends inside the panel too.
    expect(l.slotLabelY + 16).toBeLessThanOrEqual(z.y + z.h);
    expect(l.text.x + l.text.w).toBeLessThanOrEqual(z.x + z.w);
    expect(l.replay.x + l.replay.w).toBeLessThanOrEqual(z.x + z.w);
    expect(l.replay.y + l.replay.h).toBeLessThanOrEqual(z.y + z.h);
  });

  it('keeps the layout A call panel for a wide panel rect (under the tray, before A2)', () => {
    const l = commsLayout({ x: 16, y: 815, w: 890, h: 255 });
    expect(l.tile).toEqual({ x: 30, y: 829, w: 232, h: 227 });
    expect(l.slots.map((s) => s.x)).toEqual([320, 418, 516, 614, 712]);
    expect(l.text).toEqual({ x: 278, y: 859, w: 604 });
  });

  it('keeps the old band layout for a band-shaped rect (the strip before layout A)', () => {
    const band = { x: 455, y: 645, w: 1455, h: 150 };
    const l = commsLayout(band);
    expect(l.tile).toBeNull();
    expect(l.slots.map((s) => ({ x: s.x, y: s.y }))).toEqual(
      [0, 1, 2, 3, 4].map((i) => ({ x: 517 + 98 * i, y: 720 })),
    );
    expect(l.divider.x).toBe(975);
    expect(l.text.x).toBe(1000);
    expect(l.text.w).toBe(760);
    expect(l.log.map((r) => r.y)).toEqual([664, 704, 744]);
    expect(l.text.x + l.text.w).toBeLessThanOrEqual(l.replay.x);
    expect(l.replay.x + l.replay.w).toBeLessThanOrEqual(band.x + band.w);
  });
});

describe('the caller cam (layout A2)', () => {
  // Rolando, 30 Oct 2026: the cams on the right are for the other characters; Lux's lines show on
  // her own cam, so they never pop the caller cam up.
  it('pops up for one of the others or an open log, never for Lux', () => {
    expect(callShows(null, false)).toBe(false);
    expect(callShows('C1.triage.02', false)).toBe(true);
    expect(callShows('C5.rei.05', false)).toBe(true);
    expect(callShows('C4.grandma.01', false)).toBe(true);
    expect(callShows('C4.lux.01', false)).toBe(false);
    expect(callShows('C4.lux.01', true)).toBe(true);
    expect(callShows(null, true)).toBe(true);
  });

  it('keeps the last caller up, dimmed, between lines (Rolando, 30 Oct 2026)', () => {
    expect(callTarget(null, false, null)).toBe(0);
    expect(callTarget('C1.triage.02', false, null)).toBe(1);
    expect(callTarget(null, false, 'C1.triage.02')).toBe(CALL_IDLE_ALPHA);
    // A Lux line keeps the caller cam on the last caller, dimmed: her words caption her own cam.
    expect(callTarget('C4.lux.01', false, 'C1.triage.02')).toBe(CALL_IDLE_ALPHA);
    expect(callTarget(null, true, 'C1.triage.02')).toBe(1);
    expect(CALL_IDLE_ALPHA).toBeGreaterThan(0);
    expect(CALL_IDLE_ALPHA).toBeLessThan(1);
    expect(isCallerLine('C4.grandma.01')).toBe(true);
    expect(isCallerLine('C4.lux.01')).toBe(false);
  });
});

describe('comms dwell', () => {
  it('gives a current line at least BARK_SECONDS', () => {
    const s = say(NO_COMMS, 'C4.lux.01', 10);
    expect(s.current?.id).toBe('C4.lux.01');
    expect(s.current!.until - s.current!.since).toBeGreaterThanOrEqual(BARK_SECONDS);
    for (const id of Object.keys(LINES) as LineId[]) {
      if (LINES[id].kind !== 'bark') continue;
      expect(dwellFor(id, CPS)).toBeGreaterThanOrEqual(BARK_SECONDS);
    }
  });

  it('dwells an unvoiced line max(4, 1 + chars/cps + 1.5) with no 8 s clamp', () => {
    // A line of about 60 characters (the first bark of 58 to 62).
    const id = (Object.keys(LINES) as LineId[]).find(
      (k) => LINES[k].kind === 'bark' && LINES[k].text.length >= 58 && LINES[k].text.length <= 62,
    );
    expect(id).toBeDefined();
    const n = LINES[id!].text.length;
    expect(dwellFor(id!, CPS)).toBeCloseTo(Math.max(4, 1 + n / CPS + 1.5), 9);
    expect(dwellFor(id!, TEXT_CPS.slow)).toBeCloseTo(1 + n / TEXT_CPS.slow + 1.5, 9);
    // Long lines at the slowest speed run past 8 s: nothing clamps them.
    const longest = (Object.keys(LINES) as LineId[])
      .filter((k) => LINES[k].kind === 'bark')
      .reduce((a, b) => (LINES[a].text.length >= LINES[b].text.length ? a : b));
    expect(dwellFor(longest, 5)).toBeGreaterThan(8);
  });

  it('dwells a line with voiceSeconds 6.7 for 7.3 s', () => {
    // A short line, so the voice decides.
    expect(dwellFor('C4.lux.01', CPS, 6.7)).toBeCloseTo(7.3, 9);
    expect(dwellFor('C4.lux.01', CPS, 8.8)).toBeCloseTo(9.4, 9);
  });

  it('extendForVoice raises until to clock + seconds + 0.6 and marks the line voiced', () => {
    let s = say(NO_COMMS, 'C4.lux.01', 10);
    expect(s.current!.voiced).toBe(false);
    s = extendForVoice(s, 'C4.lux.01', 10.2, 6.7);
    expect(s.current!.until).toBeCloseTo(10.2 + 6.7 + 0.6, 9);
    expect(s.current!.voiced).toBe(true);
    // A short clip never shortens the line.
    const before = s.current!.until;
    s = extendForVoice(s, 'C4.lux.01', 10.3, 0.5);
    expect(s.current!.until).toBe(before);
    // Another line's voice changes nothing.
    expect(extendForVoice(s, 'C1.triage.02', 11, 30)).toBe(s);
  });
});

describe('comms order and pre-emption', () => {
  it('shows two queued lines one at a time: the first for >= 4 s, then the second, never both', () => {
    let s = enqueueComms(NO_COMMS, 'C1.triage.01', 0);
    s = enqueueComms(s, 'C1.triage.02', 0);
    const { seen } = run(s, 0, 12);
    const first = seen.filter((x) => x === 'C1.triage.01').length * 0.05;
    expect(seen[0]).toBe('C1.triage.01');
    expect(first).toBeGreaterThanOrEqual(4 - 0.05);
    const firstEnd = seen.lastIndexOf('C1.triage.01');
    expect(seen.indexOf('C1.triage.02')).toBe(firstEnd + 1);
    expect(seen.slice(firstEnd + 1).includes('C1.triage.01')).toBe(false);
  });

  it('ignores a line already showing or waiting', () => {
    let s = say(NO_COMMS, 'C1.triage.01', 0);
    expect(enqueueComms(s, 'C1.triage.01', 1)).toBe(s);
    s = enqueueComms(s, 'C1.triage.02', 1);
    expect(enqueueComms(s, 'C1.triage.02', 1.5)).toBe(s);
  });

  it('lets a WARNING arriving 2 s into a HINT end it at that clock and play on the next step', () => {
    let s = say(NO_COMMS, 'C3.triage.02', 0);
    expect(tag('C3.triage.02')).toBe('HINT');
    s = enqueueComms(s, 'C3.triage.04', 2);
    expect(s.current!.until).toBe(2);
    expect(s.queue[0].id).toBe('C3.triage.04');
    s = stepComms(s, 2, CPS);
    expect(s.current!.id).toBe('C3.triage.04');
    expect(s.history).toEqual(['C3.triage.02', 'C3.triage.04']);
  });

  it('makes a WARNING arriving 1 s into a HINT wait at the front', () => {
    let s = say(NO_COMMS, 'C3.triage.02', 0);
    s = enqueueComms(s, 'C1.triage.05', 0.5);
    const until = s.current!.until;
    s = enqueueComms(s, 'C3.triage.04', 1);
    expect(s.current!.until).toBe(until);
    expect(s.queue.map((q) => q.id)).toEqual(['C3.triage.04', 'C1.triage.05']);
    s = stepComms(s, until, CPS);
    expect(s.current!.id).toBe('C3.triage.04');
  });

  it('never cuts a lesson line, a CREW line or another WARNING', () => {
    expect(LESSON_IDS).toContain('C3.triage.01');
    for (const first of ['C3.triage.01', 'C5.rei.05', 'C4.triage.01'] as LineId[]) {
      let s = say(NO_COMMS, first, 0);
      const until = s.current!.until;
      s = enqueueComms(s, 'C4.triage.02', 3);
      expect(s.current!.until, first).toBe(until);
    }
  });

  it('keeps at most five waiting, dropping the oldest droppable line', () => {
    let s = say(NO_COMMS, 'C1.triage.01', 0);
    const ids: LineId[] = [
      'C1.triage.02',
      'C1.triage.03',
      'C1.triage.04',
      'C1.triage.05',
      'C2.triage.01',
      'C2.triage.pay',
    ];
    for (const id of ids) s = enqueueComms(s, id, 1);
    expect(s.queue.length).toBe(COMMS_QUEUE_MAX);
    expect(s.queue.map((q) => q.id)).toEqual(ids.slice(1));
  });
});

describe('comms stale drop', () => {
  it('drops a queued HINT older than 12 s unshown; it never enters history', () => {
    expect(staleAfter('C2.triage.01')).toBe(STALE_SECONDS);
    let s = say(NO_COMMS, 'C1.triage.01', 0);
    s = { ...s, current: { ...s.current!, until: 30 } };
    s = enqueueComms(s, 'C2.triage.01', 1);
    s = stepComms(s, 30, CPS);
    expect(s.current).toBeNull();
    expect(s.history).not.toContain('C2.triage.01');
    expect(s.dropped).toEqual(['C2.triage.01']);
  });

  it('gives delay-chained lines 20 s', () => {
    expect(staleAfter('C1.triage.02')).toBe(STALE_CHAINED_SECONDS);
    let s = say(NO_COMMS, 'C1.triage.01', 0);
    s = { ...s, current: { ...s.current!, until: 15 } };
    s = enqueueComms(s, 'C1.triage.02', 1);
    s = stepComms(s, 15, CPS);
    expect(s.current!.id).toBe('C1.triage.02');
  });

  it('never stale-drops LUX, WARNING or lesson lines', () => {
    for (const id of [
      'C1.lux.01',
      'C4.lux.cut',
      'C4.triage.02',
      'C3.triage.01',
      'C4.triage.cut',
    ] as LineId[]) {
      expect(staleAfter(id), id).toBeNull();
      let s = say(NO_COMMS, 'C5.rei.05', 0);
      s = { ...s, current: { ...s.current!, until: 100 } };
      s = enqueueComms(s, id, 1);
      s = stepComms(s, 100, CPS);
      expect(s.current?.id, id).toBe(id);
      expect(s.history, id).toContain(id);
    }
  });

  it('replays the C4 trace at speed-5 cadence and C4.lux.cut lands in history', () => {
    // HUD seconds after the warning at c4 - 12 (speed 5: 12 HUD seconds are 2.4 real seconds),
    // with the HUD stepping every 1/60 s of real time (1/12 HUD seconds).
    const trace: [number, LineId][] = [
      [0, 'C3.triage.02'],
      [0.5, 'C4.triage.01'],
      [12, 'C4.lux.01'],
      [13, 'C4.lux.cut'],
      [14, 'C4.triage.02'],
      [15, 'C4.triage.03'],
      [16, 'C4.triage.cut'],
    ];
    let s = NO_COMMS;
    let i = 0;
    for (let t = 0; t <= 60; t += 1 / 12) {
      while (i < trace.length && trace[i][0] <= t) s = enqueueComms(s, trace[i++][1], t);
      s = stepComms(s, t, CPS);
    }
    expect(s.history).toEqual(expect.arrayContaining(['C4.lux.01', 'C4.lux.cut', 'C4.triage.cut']));
    expect(s.history).toContain('C4.triage.02');
    expect(s.dropped).not.toContain('C4.lux.cut');
  });
});

describe('comms log and fade', () => {
  it('logLines returns at most 3 entries, newest last, including the current line', () => {
    let s = NO_COMMS;
    let t = 0;
    for (const id of ['C1.triage.01', 'C1.triage.02', 'C1.lux.01', 'C1.triage.03'] as LineId[]) {
      s = say(s, id, t);
      t = s.current!.until;
    }
    expect(logLines(s.history, s.current, 3)).toEqual(['C1.triage.02', 'C1.lux.01', 'C1.triage.03']);
    expect(logLines(['C1.triage.01'], null, 3)).toEqual(['C1.triage.01']);
    expect(
      logLines(['C1.triage.01'], { id: 'C1.triage.02', since: 0, until: 4, readUntil: 4, voiced: false }, 3),
    ).toEqual(['C1.triage.01', 'C1.triage.02']);
    expect(logLines([], null, 3)).toEqual([]);
  });

  it('fades the line over 250 ms once the queue runs dry', () => {
    let s = say(NO_COMMS, 'C4.lux.01', 0);
    expect(bandAlpha(NO_COMMS, 0)).toBe(0);
    expect(bandAlpha(s, 1)).toBe(1);
    const end = s.current!.until;
    s = stepComms(s, end + 0.01, CPS);
    expect(s.current).toBeNull();
    expect(s.idleSince).toBe(end);
    expect(bandAlpha(s, end + FADE_SECONDS / 2)).toBeCloseTo(0.5, 6);
    expect(bandAlpha(s, end + FADE_SECONDS)).toBe(0);
  });

  it('returns the same state when nothing changed', () => {
    const s = say(NO_COMMS, 'C4.lux.01', 0);
    expect(stepComms(s, 1, CPS)).toBe(s);
    const idle = stepComms(s, 10, CPS);
    expect(stepComms(idle, 11, CPS)).toBe(idle);
  });
});

// comms-3: the reread log.
describe('comms reread log', () => {
  it('opens after a 400 ms hover and closes on leaving', () => {
    let s = LOG_CLOSED;
    s = stepLog(s, true, false, 10);
    expect(logOpen(s, 10.2)).toBe(false);
    expect(stepLog(s, true, false, 10.2)).toBe(s);
    expect(logOpen(s, 10.4)).toBe(true);
    s = stepLog(s, false, false, 11);
    expect(logOpen(s, 11)).toBe(false);
  });

  it('ignores hover while something is dragged across the band', () => {
    let s = LOG_CLOSED;
    for (let t = 0; t < 2; t += 0.05) {
      s = stepLog(s, true, true, t);
      expect(logOpen(s, t)).toBe(false);
    }
    // A hover that was open closes when a drag comes over it.
    s = stepLog(LOG_CLOSED, true, false, 0);
    expect(logOpen(s, 1)).toBe(true);
    s = stepLog(s, true, true, 1);
    expect(logOpen(s, 1.5)).toBe(false);
  });

  it('pins on a click on the band until the next click on it, across leaving and other clicks', () => {
    let s = clickLog(LOG_CLOSED, true);
    expect(s.pinned).toBe(true);
    s = stepLog(s, false, false, 5);
    expect(logOpen(s, 5)).toBe(true);
    // A click on the board or the dial leaves it pinned.
    expect(clickLog(s, false)).toBe(s);
    s = clickLog(s, true);
    expect(s.pinned).toBe(false);
    expect(logOpen(s, 6)).toBe(false);
    // A click off the band never pins.
    expect(clickLog(LOG_CLOSED, false)).toBe(LOG_CLOSED);
  });

  it('keeps the last 3 shown ids with their speakers across a new line', () => {
    let s = NO_COMMS;
    let t = 0;
    for (const id of ['C1.triage.01', 'C1.triage.02', 'C1.lux.01'] as LineId[]) {
      s = say(s, id, t);
      t = s.current!.until;
    }
    expect(logLines(s.history, s.current, LOG_ROWS).map(nameOf)).toEqual(['TRIAGE', 'TRIAGE', 'LUX']);
    s = say(s, 'C1.triage.03', t);
    expect(logLines(s.history, s.current, LOG_ROWS)).toEqual(['C1.triage.02', 'C1.lux.01', 'C1.triage.03']);
  });

  it('finds points on a rect', () => {
    const z = ZONES.comms;
    expect(onRect(z, z.x, z.y)).toBe(true);
    expect(onRect(z, z.x + z.w / 2, z.y + z.h / 2)).toBe(true);
    expect(onRect(z, z.x + z.w / 2, z.y - 1)).toBe(false);
  });
});

// comms-4: TRIAGE's iris, the speaker's glow, the swap tick and the crew light-up.
describe('comms-4: iris, glow and crew light-up', () => {
  const T = Array.from({ length: 241 }, (_, i) => i * 0.0371);

  // Seven since the worried face for the cold open's "you okay, Lux?" (Rolando's pick, 30 Oct 2026).
  it("lists TRIAGE's seven moods, the same set docs/SCRIPT.md brackets her lines with", () => {
    const used = new Set(
      (Object.keys(LINES) as LineId[]).map(triageMood).filter((m): m is string => m !== null),
    );
    expect([...used].sort()).toEqual([...TRIAGE_MOODS].sort());
    expect(TRIAGE_MOODS).toHaveLength(7);
  });

  it("irisFor('panicking', t, true) is still (dx = dy = 0) at every t and the widest of the six", () => {
    for (const t of T) {
      const i = irisFor('panicking', t, true);
      expect(i.dx, `t ${t}`).toBe(0);
      expect(i.dy, `t ${t}`).toBe(0);
      expect(i.open, `t ${t}`).toBe(1);
    }
    const r = irisFor('panicking', 0, true).r;
    for (const m of TRIAGE_MOODS) {
      if (m === 'panicking') continue;
      for (const t of T) {
        expect(irisFor(m, t, true).r, m).toBeLessThan(r);
        expect(irisFor(m, t, false).r, m).toBeLessThan(r);
      }
    }
    // The radius is the mood's alone, with or without reduce flicker.
    for (const t of T) expect(irisFor('panicking', t, false).r).toBe(r);
  });

  it('panicking jitters at 12 Hz without reduce flicker, and never blinks', () => {
    const xs = T.map((t) => irisFor('panicking', t, false));
    expect(Math.max(...xs.map((i) => Math.abs(i.dx)))).toBeGreaterThan(1);
    expect(Math.max(...xs.map((i) => Math.abs(i.dy)))).toBeGreaterThan(1);
    expect(xs.every((i) => i.open === 1)).toBe(true);
    // One full jitter period later the iris is back where it was.
    const a = irisFor('panicking', 0.3, false);
    const b = irisFor('panicking', 0.3 + 1 / PANIC_JITTER_HZ, false);
    expect(b.dx).toBeCloseTo(a.dx, 6);
  });

  it('gives each mood its own look and blinks only without reduce flicker', () => {
    const looks = TRIAGE_MOODS.map((m) => {
      const i = irisFor(m, 0.5, true);
      return `${i.dx},${i.dy},${i.r}`;
    });
    // Seven with worried (Rolando's pick, 30 Oct 2026).
    expect(new Set(looks).size).toBe(7);
    for (const m of TRIAGE_MOODS) {
      const reduced = T.map((t) => irisFor(m, t, true));
      // Under reduce flicker nothing moves and the lid stays open.
      expect(new Set(reduced.map((i) => `${i.dx},${i.dy},${i.open}`)).size, m).toBe(1);
      expect(reduced[0].open, m).toBe(1);
    }
    // Eager blinks at t = 0 and is open just after.
    expect(irisFor('eager', 0.05, false).open).toBeLessThan(1);
    expect(irisFor('eager', 0.5, false).open).toBe(1);
    // An unknown bracket reads as her resting mood.
    expect(moodOf('grumpy')).toBe(IDLE_MOOD);
    expect(moodOf(null)).toBe(IDLE_MOOD);
    expect(irisFor('grumpy', 1, true)).toEqual(irisFor(IDLE_MOOD, 1, true));
  });

  it('the speaker ring glows at 1.2 Hz and holds steady under reduce flicker', () => {
    expect(speakRing(0, false)).toBeCloseTo(RING_HIGH, 6);
    expect(speakRing(0.5 / RING_HZ, false)).toBeCloseTo(RING_LOW, 6);
    expect(speakRing(1 / RING_HZ, false)).toBeCloseTo(RING_HIGH, 6);
    for (const t of T) {
      const a = speakRing(t, false);
      expect(a).toBeGreaterThanOrEqual(RING_LOW - 1e-9);
      expect(a).toBeLessThanOrEqual(RING_HIGH + 1e-9);
      expect(speakRing(t, true)).toBe(RING_STEADY);
    }
    expect(OTHER_RING_ALPHA).toBe(0.25);
  });

  it('ticks a new speaker up for 180 ms and back', () => {
    expect(swapTick(0)).toBe(1);
    expect(swapTick(SWAP_TICK_SECONDS / 2)).toBeCloseTo(SWAP_TICK_SCALE, 6);
    expect(swapTick(SWAP_TICK_SECONDS)).toBe(1);
    expect(swapTick(-1)).toBe(1);
    expect(swapTick(5)).toBe(1);
  });

  it('lights the crew from the dark silhouette over 400 ms once they are in', () => {
    expect(crewLight(null, 100)).toBe(0);
    expect(crewLight(10, 10)).toBe(0);
    expect(crewLight(10, 10 + CREW_LIGHT_SECONDS / 2)).toBeCloseTo(0.5, 6);
    expect(crewLight(10, 10 + CREW_LIGHT_SECONDS)).toBe(1);
    expect(crewLight(-Infinity, 0)).toBe(1);
    expect(crewTint(0)).toEqual({ tint: DARK_TINT, alpha: DARK_ALPHA });
    expect(crewTint(0)).toEqual({ tint: 0x55556a, alpha: 0.3 });
    expect(crewTint(1)).toEqual({ tint: 0xffffff, alpha: 1 });
    const mid = crewTint(0.5);
    expect(mid.alpha).toBeCloseTo(0.65, 6);
    expect((mid.tint >> 16) & 0xff).toBeGreaterThan(0x55);
    expect((mid.tint >> 16) & 0xff).toBeLessThan(0xff);
  });

  it("hud.comms.triage's mood is the current TRIAGE line's bracket, and null for anyone else", () => {
    for (const id of Object.keys(LINES) as LineId[]) {
      if (LINES[id].kind !== 'bark') continue;
      const speaker = LINES[id].speaker;
      const m = triageMood(id);
      if (speaker.startsWith('TRIAGE')) {
        expect(m, id).toBe(/\(([^)]+)\)/.exec(speaker)![1]);
        expect(TRIAGE_MOODS as readonly string[], id).toContain(m);
      } else {
        expect(m, id).toBeNull();
      }
    }
  });
});

// comms-9: the band's art through the manifest, with its fallbacks.
describe('comms-9: plate, round avatars and HOUSE chips through the art manifest', () => {
  const plateReq = artRequest(COMMS_PLATE)!;
  /** The manifest entry as it will read once the owner's pick lands (its cut size set). */
  const picked = <T extends { target: { w: number; h: number } }>(r: T): T => ({ ...r, cut: r.target });
  /** The manifest entry as it read before the owner's pick landed (no cut): the fallback draws. */
  const unpicked = <T extends { cut: unknown }>(r: T): T => ({ ...r, cut: null });
  const all = (): boolean => true;
  const none = (): boolean => false;

  it('asks for the plate at the band size and never upscales it', () => {
    expect(plateReq.lane).toBe('comms');
    expect(plateReq.zone).toBe('comms');
    // Asked for at the band size (the 1455x150 strip before layout A, Rolando 30 Oct 2026; the call
    // panel draws a code plate); the picked file is 1455x149, so it is shown at that size.
    const BAND = { w: 1455, h: 150 };
    expect(plateReq.target).toEqual(BAND);
    expect(plateReq.display).toEqual(plateReq.cut);
    expect(plateReq.display.w).toBeLessThanOrEqual(BAND.w);
    expect(plateReq.display.h).toBeLessThanOrEqual(BAND.h);
    expect(plateReq.target.w).toBeGreaterThanOrEqual(plateReq.display.w);
    expect(plateReq.target.h).toBeGreaterThanOrEqual(plateReq.display.h);
    for (const key of [COMMS_AVATARS.TRIAGE, COMMS_AVATARS.REI, COMMS_AVATARS.MIKA, COMMS_AVATARS.OZZIE]) {
      const r = artRequest(key)!;
      expect(r.lane, key).toBe('comms');
      expect(r.target.w, key).toBeGreaterThanOrEqual(84);
    }
    for (const key of COMMS_AVATARS.HOUSE) {
      const r = artRequest(key)!;
      expect(r.display, key).toEqual({ w: CHIP_SIZE, h: CHIP_SIZE });
      expect(r.target.w, key).toBeGreaterThanOrEqual(CHIP_SIZE);
    }
  });

  it('uses the picked plate once it has landed and loaded, drawn as cut', () => {
    const p = plateArt(all, picked(plateReq));
    expect(p).toEqual({
      use: 'picked',
      texture: fileTexture('art/hud/comms-plate.webp'),
      nine: false,
      tint: 0xffffff,
      alpha: 1,
    });
    expect(plateFile(picked(plateReq))).toBe('art/hud/comms-plate.webp');
  });

  it('falls back to the text-box plate, then to code, while the pick is missing', () => {
    // M4: Rolando's comms-plate has landed, so the manifest names its file; without its cut the
    // fallbacks below still hold.
    expect(plateFile()).toBe('art/hud/comms-plate.webp');
    expect(plateArt(all)).toMatchObject({ use: 'picked', texture: fileTexture('art/hud/comms-plate.webp') });
    expect(plateFile(unpicked(plateReq))).toBeNull();
    const reuse = plateReq.fallback.kind === 'reuse' ? plateReq.fallback : null;
    expect(reuse?.file).toBe('art/hud/textbox.webp');
    // Not picked: the reused file, nine-sliced, at the manifest's tint and alpha.
    expect(plateArt(all, unpicked(plateReq))).toMatchObject({
      use: 'reuse',
      texture: fileTexture(reuse!.file),
      nine: true,
    });
    expect(plateArt(all, unpicked(plateReq)).alpha).toBe(reuse!.alpha);
    // The reused file not loaded: the HUD's own text box.
    expect(plateArt((t) => t === LEGACY_PLATE)).toMatchObject({
      use: 'reuse',
      texture: LEGACY_PLATE,
      nine: true,
    });
    // Picked in the manifest but the file did not load: still the fallback, never a missing texture.
    expect(plateArt((t) => t === LEGACY_PLATE, picked(plateReq)).texture).toBe(LEGACY_PLATE);
    // Nothing loaded: the code plate.
    expect(plateArt(none)).toMatchObject({ use: 'code', texture: null });
    expect(plateArt(none, unpicked(plateReq))).toMatchObject({ use: 'code', texture: null });
    expect(plateArt(none, undefined).use).toBe('code');
  });

  it('draws a picked HOUSE chip and the code glyph until then', () => {
    for (const key of COMMS_AVATARS.HOUSE) {
      const r = artRequest(key)!;
      // M4: the door and TV chips have landed, so they draw; without their cut, the code glyph.
      expect(chipArt(key, all)).toEqual({ key, use: 'picked', texture: fileTexture(`art/${key}.webp`) });
      expect(chipArt(key, all, unpicked(r))).toEqual({ key, use: 'code', texture: null });
      expect(chipArt(key, all, picked(r))).toEqual({
        key,
        use: 'picked',
        texture: fileTexture(`art/${key}.webp`),
      });
      expect(chipArt(key, none, picked(r)).use).toBe('code');
    }
  });

  it('resolves the four round avatars through the manifest: the pick when it lands, the reused face until', () => {
    for (const key of [COMMS_AVATARS.TRIAGE, COMMS_AVATARS.REI, COMMS_AVATARS.MIKA, COMMS_AVATARS.OZZIE]) {
      const r = artRequest(key)!;
      // M4: the four badges have landed, so each draws its own file; without its cut, the reused face.
      expect(avatarSource(key), key).toMatchObject({ fallback: false, file: `art/${key}.webp` });
      const now = avatarSource(key, unpicked(r));
      expect(now.fallback, key).toBe(true);
      expect(now.file, key).toBe(r.fallback.kind === 'reuse' ? r.fallback.file : null);
      const later = avatarSource(key, picked(r));
      expect(later, key).toMatchObject({ fallback: false, file: `art/${key}.webp` });
    }
  });
});

describe('comms-6: a WARNING cutting a HINT short cuts its voice', () => {
  it('names the HINT a WARNING ended, and nothing for a change that kept its time', () => {
    const s = say(NO_COMMS, 'C3.triage.02', 0);
    expect(cutShort(s, enqueueComms(s, 'C3.triage.04', 2))).toBe('C3.triage.02');
    // Too early to pre-empt: the WARNING waits, nothing is cut.
    expect(cutShort(s, enqueueComms(s, 'C3.triage.04', 1))).toBeNull();
    // A voice lengthening the line, another line starting, or nothing showing cut nothing.
    expect(cutShort(s, extendForVoice(s, 'C3.triage.02', 0.1, 6))).toBeNull();
    expect(cutShort(s, say(NO_COMMS, 'C1.triage.01', 5))).toBeNull();
    expect(cutShort(NO_COMMS, s)).toBeNull();
  });
});

describe('comms-8: the leader line', () => {
  /** A real board with `n` servers racked; s1 wired and serving `load`, the rest as given. */
  function board(n: number, opts: Partial<Omit<LeaderFrame, 'parts'>> = {}): LeaderFrame {
    const r = new Run();
    for (const slot of SERVER_SLOTS.slice(0, n)) expect(r.placeServer(slot).ok).toBe(true);
    const parts = r.session.board.parts;
    const first = parts.find((p) => p.kind === 'server')!;
    return {
      parts,
      offline: [],
      dead: [],
      dark: [],
      overheating: [],
      flow: { load: { gateway: 30, [first.id]: 30, database: 30 } },
      ...opts,
    };
  }
  const servers = (f: LeaderFrame) => f.parts.filter((p) => p.kind === 'server').map((p) => p.id);

  it('points C3.triage.02 at the idle box, exactly at its partAnchor', () => {
    expect(leaderSubject('C3.triage.02')).toBe('part:idle');
    // The second box just racked and still booting: the one doing nothing.
    const f = board(2);
    const [busy, fresh] = servers(f);
    const booting = { ...f, offline: [fresh] };
    const t = resolveLeader('C3.triage.02', booting, undefined, () => null)!;
    expect(t.target).toBe(fresh);
    expect(t.to).toEqual(partAnchor(booting, fresh));
    expect(t.target).not.toBe(busy);
    // Once on and still unfed, the same box.
    expect(resolveLeader('C3.triage.02', f)!.target).toBe(fresh);
  });

  it('picks an idle box that is on over one still booting, and never a dead or dark one', () => {
    const f = board(3);
    const [, b, c] = servers(f);
    expect(partForRole('idle', { ...f, offline: [c] })).toBe(b);
    expect(partForRole('idle', { ...f, offline: [b, c] })).toBe(c);
    expect(partForRole('idle', { ...f, dead: [b, c] })).toBeNull();
    expect(partForRole('idle', { ...f, dark: [c], offline: [c] })).toBe(b);
  });

  it('resolves the other roles from the frame, or null when no part plays them', () => {
    const f = board(2);
    const [a, b] = servers(f);
    expect(partForRole('hot', f)).toBeNull();
    expect(partForRole('hot', { ...f, overheating: [b] })).toBe(b);
    expect(partForRole('dark', { ...f, dark: [a] })).toBe(a);
    expect(partForRole('overclocked', f)).toBeNull();
    const kitted = { ...f, parts: f.parts.map((p) => (p.id === b ? { ...p, boost: 2 } : p)) };
    expect(partForRole('overclocked', kitted)).toBe(b);
    expect(partForRole('balancer', f)).toBeNull();
    expect(partForRole('gateway', f)).toBe('gateway');
    expect(partForRole('database', f)).toBe('database');
    expect(resolveLeader('C3.lux.01', f)!.to).toEqual(partAnchor(f, 'gateway'));
    expect(resolveLeader('C3.triage.04', f)).toBeNull();
  });

  it('reports null for a line without a LEADER_FOR entry', () => {
    expect(LEADER_FOR['C1.triage.02']).toBeUndefined();
    expect(leaderSubject('C1.triage.02')).toBeNull();
    const everywhere = () => ({ x: 1, y: 1 });
    expect(resolveLeader('C1.triage.02', board(2), everywhere, everywhere)).toBeNull();
    for (const id of Object.keys(LINES) as LineId[]) {
      if (LEADER_FOR[id] === undefined)
        expect(resolveLeader(id, board(1), everywhere, everywhere), id).toBeNull();
    }
  });

  it('finds a zone through locate.ts: null until a lane registers it, its centre once one has', () => {
    expect(leaderSubject('C1.triage.06')).toBe('zone:gauge');
    const f = board(1);
    expect(registeredNames()).not.toContain('gauge');
    expect(resolveLeader('C1.triage.06', f)).toBeNull();
    const centre = { x: 236, y: 795 };
    const off = register('gauge', () => centre);
    try {
      const t = resolveLeader('C1.triage.06', f)!;
      expect(t).toEqual({ subject: 'zone:gauge', target: 'gauge', to: centre });
    } finally {
      off();
    }
    expect(locate('gauge')).toBeNull();
    expect(resolveLeader('C1.triage.06', f)).toBeNull();
  });

  it('tries each zone’s lane name too, and survives a locator that throws or reads off screen', () => {
    expect(locateNames('zone:title')).toEqual(['title', 'credits']);
    expect(locateNames('key:two')).toEqual(['key:two']);
    expect(locateNames('zone:alert')).toEqual(['alert']);
    const f = board(1);
    const offCredits = register('credits', () => ({ x: 1775, y: 245 }));
    const offAlert = register('alert', () => {
      throw new Error('mid-shutdown');
    });
    const offKey = register('key:two', () => null);
    try {
      expect(resolveLeader('C7.ozzie.01', f)).toEqual({
        subject: 'zone:title',
        target: 'credits',
        to: { x: 1775, y: 245 },
      });
      expect(resolveLeader('C4.triage.01', f)).toBeNull();
      expect(resolveLeader('C4.lux.01', f)).toBeNull();
      // A newer registration replaces an older one; the older one's off leaves it alone.
      const again = register('credits', () => ({ x: 10, y: 20 }));
      offCredits();
      expect(locate('credits')).toEqual({ x: 10, y: 20 });
      again();
    } finally {
      offCredits();
      offAlert();
      offKey();
    }
    expect(registeredNames()).toEqual([]);
  });

  it('draws a right-angled path from the band edge nearest the target', () => {
    // The caller column sits top right since layout A2 (Rolando, 30 Oct 2026): x 1566-1910, y 110-570.
    const band = ZONES.comms;
    // Level with it (the board, to its left): straight across from its left side.
    const left = leaderPath(band, { x: 900, y: 400 });
    expect(left).toEqual([
      { x: band.x, y: 400 },
      { x: band.x, y: 400 },
      { x: 900, y: 400 },
    ]);
    // Below it and left (the tray): down from the band's left end, then left.
    const down = leaderPath(band, { x: 600, y: 900 });
    expect(down[0]).toEqual({ x: band.x + 12, y: band.y + band.h });
    expect(down[1]).toEqual({ x: band.x + 12, y: 900 });
    expect(down[2]).toEqual({ x: 600, y: 900 });
    // Below it (the gauge): straight down from the bottom edge.
    expect(leaderPath(band, { x: 1738, y: 720 })[0]).toEqual({ x: 1738, y: band.y + band.h });
    // Above it (the clock): up from the top edge.
    expect(leaderPath(band, { x: 1700, y: 50 })[0]).toEqual({ x: 1700, y: band.y });
    for (const p of [left, down]) {
      expect(p[0].x === p[1].x || p[0].y === p[1].y).toBe(true);
      expect(p[1].x === p[2].x || p[1].y === p[2].y).toBe(true);
    }
  });
});

// comms-6 with the recorded voices: a voiced line holds the band for its clip + 0.6 s, measured on
// the HUD clock. At speed 1 that clock is the player's, so the node replay below is the product: the
// cue table's firing times from best play, the band stepped at 60 fps, and each line's real clip
// length (read from its MP3's frame headers) reported as voiceStart the moment the line starts.

/** The bits of node:fs the replay reads with; the repo has no @types/node, so typed here. */
interface Fs {
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
}
const fs = (
  globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }
).process.getBuiltinModule('node:fs') as Fs;
const VOICE_DIR = new URL('../public/audio/voice/', import.meta.url).pathname;

/** An MPEG-1/2 layer III file's length in seconds: its frames (ID3 tag skipped) times 1152 samples. */
function mp3Seconds(b: Uint8Array): number {
  const KBPS = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33)
    i = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  let frames = 0;
  let rate = 44100;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const mpeg1 = ((b[i + 1] >> 3) & 3) === 3;
    rate = (mpeg1 ? [44100, 48000, 32000] : [22050, 24000, 16000])[(b[i + 2] >> 2) & 3];
    const kbps = KBPS[((b[i + 2] >> 4) & 15) - 1];
    i += Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / rate) + ((b[i + 2] >> 1) & 1);
    frames++;
  }
  return (frames * 1152) / rate;
}

/** A line's clip length under a voices setting, or 0 when nothing plays (voices off, no file). */
function clipSeconds(id: LineId, voices: 'ja' | 'en' | 'off'): number {
  const lang = mixerLangFor(id, voices);
  const path = lang ? `${VOICE_DIR}${lang}/${id}.mp3` : '';
  return lang && fs.existsSync(path) ? mp3Seconds(fs.readFileSync(path)) : 0;
}

interface Fired {
  readonly id: LineId;
  readonly at: number;
}

/** The band lines the cue table fires through best play, on the HUD clock from c1, at speed 1. */
function nightCues(): Fired[] {
  const C = BROWNOUT.challenges;
  resetFrame();
  const r = newRun(1, bestPlay);
  r.now = C.c1;
  let prev: Frame | null = null;
  const occ: Occurrence[] = [];
  const v = emptyCueView();
  let s = NEW_DIRECTOR;
  let clock = 0;
  const out: Fired[] = [];
  for (let n = 0; n < 20_000 && r.now < C.c8 && !r.play.failure; n++) {
    r.tick(0.1);
    clock = Math.round((clock + 0.1) * 1e6) / 1e6;
    const f = frame(r);
    detectOccurrences(prev, f, occ);
    prev = f;
    const host: CueHost = {
      cardClosed: true,
      bannerShown: f.now >= C.c2,
      decommissionsAfterMidnight: 0,
    };
    cueViewOf(v, f, occ, clock, host, v);
    const o = direct(s, v);
    s = o.state;
    for (const id of o.fired) if (!chatOf(id) && LINES[id].kind === 'bark') out.push({ id, at: clock });
  }
  return out;
}

/** The band over `cues` at 60 fps, each line voiced as it starts; what showed, when, and what was cut. */
function replayBand(cues: readonly Fired[], voices: 'ja' | 'en' | 'off') {
  let s = NO_COMMS;
  const shown: { id: LineId; since: number; fired: number }[] = [];
  const cut: LineId[] = [];
  let k = 0;
  const end = cues[cues.length - 1].at + 120;
  for (let f = 0; f / 60 < end; f++) {
    const clock = f / 60;
    while (k < cues.length && cues[k].at <= clock) {
      const prev = s;
      s = enqueueComms(s, cues[k++].id, clock);
      const c = cutShort(prev, s);
      if (c) cut.push(c);
    }
    const prev = s;
    s = stepComms(s, clock, CPS);
    if (s.current && s.current.since !== prev.current?.since) {
      const id = s.current.id;
      s = extendForVoice(s, id, clock, clipSeconds(id, voices));
      shown.push({ id, since: clock, fired: cues.find((q) => q.id === id)!.at });
    }
  }
  const dropped = cues.filter((q) => !shown.some((x) => x.id === q.id)).map((q) => q.id);
  return { shown, cut, dropped, state: s };
}

describe('comms-6: voiced lines and the queue at speed 1', () => {
  it('does not age the waiting lines while a voice holds a line past its text dwell', () => {
    let s = say(NO_COMMS, 'C1.triage.01', 0);
    const read = s.current!.readUntil;
    expect(read).toBe(s.current!.until);
    s = enqueueComms(s, 'C5.rei.05', 0.5);
    expect(staleAfter('C5.rei.05')).toBe(STALE_SECONDS);
    // A 15 s clip: the band holds the line to 15.6, well past the CREW line's 12 s.
    const voiced = extendForVoice(s, 'C1.triage.01', 0, 15);
    expect(voiced.current!.until).toBeCloseTo(15.6, 9);
    expect(voiced.current!.readUntil).toBe(read);
    const after = stepComms(voiced, 15.6, CPS);
    expect(after.current?.id).toBe('C5.rei.05');
    expect(after.dropped).toEqual([]);
    // The text dwell still ages it: the same wait on a line held 15.6 s without a voice drops it.
    const unvoiced = stepComms({ ...s, current: { ...s.current!, until: 15.6 } }, 15.6, CPS);
    expect(unvoiced.dropped).toEqual(['C5.rei.05']);
  });

  it('ages a line from the text dwell on: only the hold it waited through is left out', () => {
    let s = say(NO_COMMS, 'C1.triage.01', 0);
    const read = s.current!.readUntil;
    s = extendForVoice(s, 'C1.triage.01', 0, 30);
    // Enqueued 2 s into the voice hold: 28.6 - (read + 2) of hold is left out of its age.
    s = enqueueComms(s, 'C2.triage.01', read + 2);
    s = stepComms(s, 30.6, CPS);
    expect(s.current?.id).toBe('C2.triage.01');
    // A line waiting 12 s of text dwell after a voiced one still goes stale.
    let t = say(NO_COMMS, 'C1.triage.01', 0);
    t = extendForVoice(t, 'C1.triage.01', 0, 6);
    t = enqueueComms(t, 'C5.rei.05', 0.5);
    t = stepComms(t, t.current!.until, CPS);
    expect(t.current?.id).toBe('C5.rei.05');
    t = { ...t, current: { ...t.current!, until: t.current!.since + 30 } };
    t = enqueueComms(t, 'C2.triage.01', t.current!.since + 1);
    t = stepComms(t, t.current!.until, CPS);
    expect(t.dropped).toEqual(['C2.triage.01']);
  });

  it('still lets a WARNING cut a voiced HINT 1.5 s in, ending its hold there', () => {
    let s = say(NO_COMMS, 'C3.triage.02', 0);
    s = extendForVoice(s, 'C3.triage.02', 0, 8);
    expect(s.current!.voiced).toBe(true);
    const warned = enqueueComms(s, 'C3.triage.04', 2);
    expect(cutShort(s, warned)).toBe('C3.triage.02');
    expect(warned.current!.until).toBe(2);
    const next = stepComms(warned, 2, CPS);
    expect(next.current?.id).toBe('C3.triage.04');
    // Too early: it waits at the front for the whole voiced hold.
    const early = enqueueComms(s, 'C3.triage.04', 1);
    expect(cutShort(s, early)).toBeNull();
    expect(early.queue[0].id).toBe('C3.triage.04');
  });

  it('drops no LUX, crew or HOUSE line through the night with the recorded voices on', () => {
    const cues = nightCues();
    expect(cues.length).toBeGreaterThan(20);
    for (const t of ['CREW', 'HOUSE', 'LUX', 'WARNING'])
      expect(
        cues.some((c) => tag(c.id) === t),
        t,
      ).toBe(true);
    const off = replayBand(cues, 'off');
    const kept = (id: LineId): boolean =>
      ['LUX', 'CREW', 'HOUSE', 'WARNING'].includes(tag(id)) || isLesson(id);
    for (const voices of ['ja', 'en'] as const) {
      const on = replayBand(cues, voices);
      // The clips are real: most lines hold longer than their text.
      const voiced = on.state.history.filter((id) => clipSeconds(id, voices) > 0);
      expect(voiced.length, voices).toBeGreaterThan(0);
      // Only HINT filler may go stale (best play's instant SET fires four C1 lines at once, and the
      // last of them, C1.triage.05, is on the 12 s edge with or without voices).
      for (const id of [...on.dropped, ...off.dropped]) {
        expect(kept(id), `${voices} dropped ${id}`).toBe(false);
        expect(tag(id), id).toBe('HINT');
      }
      // Every crew and HOUSE line the night fires shows.
      for (const q of cues.filter((c) => ['CREW', 'HOUSE', 'LUX'].includes(tag(c.id))))
        expect(on.state.history.includes(q.id) || on.shown.some((x) => x.id === q.id), q.id).toBe(true);
      // Every WARNING shows, and pre-empts exactly as it does without voices.
      for (const q of cues.filter((c) => tag(c.id) === 'WARNING'))
        expect(
          on.shown.some((x) => x.id === q.id),
          q.id,
        ).toBe(true);
      expect(on.cut, voices).toEqual(off.cut);
    }
  });
});
