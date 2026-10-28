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
import { ZONES } from '../src/scenes/live/layout';
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
    const l = commsLayout(ZONES.comms);
    expect(l.slots.map((s) => ({ name: s.name, x: s.x, y: s.y, r: s.r }))).toEqual(BOTTOM.slots);
    expect(l.divider.x).toBe(975);
    expect(l.text.x).toBe(1000);
    expect(l.text.w).toBe(760);
    expect(l.log.map((r) => r.y)).toEqual([664, 704, 744]);
    const z = ZONES.comms;
    for (const s of l.slots) {
      expect(s.x - s.r).toBeGreaterThanOrEqual(z.x);
      expect(s.y - s.r).toBeGreaterThanOrEqual(z.y);
      expect(s.y + s.r).toBeLessThanOrEqual(z.y + z.h);
    }
    expect(l.text.x + l.text.w).toBeLessThanOrEqual(l.replay.x);
    expect(l.replay.x + l.replay.w).toBeLessThanOrEqual(z.x + z.w);
    expect(l.replay.y + l.replay.h).toBeLessThanOrEqual(z.y + z.h);
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
    // A 60-character line.
    const id = (Object.keys(LINES) as LineId[]).find(
      (k) => LINES[k].kind === 'bark' && LINES[k].text.length === 60,
    );
    expect(id).toBeDefined();
    expect(dwellFor(id!, CPS)).toBeCloseTo(Math.max(4, 1 + 60 / CPS + 1.5), 9);
    expect(dwellFor(id!, TEXT_CPS.slow)).toBeCloseTo(1 + 60 / TEXT_CPS.slow + 1.5, 9);
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
    expect(staleAfter('C1.triage.03')).toBe(STALE_SECONDS);
    let s = say(NO_COMMS, 'C1.triage.01', 0);
    s = { ...s, current: { ...s.current!, until: 30 } };
    s = enqueueComms(s, 'C1.triage.03', 1);
    s = stepComms(s, 30, CPS);
    expect(s.current).toBeNull();
    expect(s.history).not.toContain('C1.triage.03');
    expect(s.dropped).toEqual(['C1.triage.03']);
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
    expect(logLines(['C1.triage.01'], { id: 'C1.triage.02', since: 0, until: 4, voiced: false }, 3)).toEqual([
      'C1.triage.01',
      'C1.triage.02',
    ]);
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

  it("lists TRIAGE's six moods, the same set docs/SCRIPT.md brackets her lines with", () => {
    const used = new Set(
      (Object.keys(LINES) as LineId[]).map(triageMood).filter((m): m is string => m !== null),
    );
    expect([...used].sort()).toEqual([...TRIAGE_MOODS].sort());
    expect(TRIAGE_MOODS).toHaveLength(6);
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
    expect(new Set(looks).size).toBe(6);
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
    expect(plateReq.display).toEqual({ w: ZONES.comms.w, h: ZONES.comms.h });
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
    expect(locateNames('zone:dialCard')).toEqual(['dialCard', 'dial']);
    expect(locateNames('zone:title')).toEqual(['title', 'credits']);
    expect(locateNames('key:two')).toEqual(['key:two']);
    expect(locateNames('zone:alert')).toEqual(['alert']);
    const f = board(1);
    const offDial = register('dial', () => ({ x: 1775, y: 245 }));
    const offAlert = register('alert', () => {
      throw new Error('mid-shutdown');
    });
    const offKey = register('key:two', () => null);
    try {
      expect(resolveLeader('C1.triage.01', f)).toEqual({
        subject: 'zone:dialCard',
        target: 'dial',
        to: { x: 1775, y: 245 },
      });
      expect(resolveLeader('C4.triage.01', f)).toBeNull();
      expect(resolveLeader('C4.lux.01', f)).toBeNull();
      // A newer registration replaces an older one; the older one's off leaves it alone.
      const again = register('dial', () => ({ x: 10, y: 20 }));
      offDial();
      expect(locate('dial')).toEqual({ x: 10, y: 20 });
      again();
    } finally {
      offDial();
      offAlert();
      offKey();
    }
    expect(registeredNames()).toEqual([]);
  });

  it('draws a right-angled path from the band edge nearest the target', () => {
    const band = ZONES.comms;
    // Above the band (the feed): straight up from the top edge, then across.
    const up = leaderPath(band, { x: 700, y: 300 });
    expect(up).toEqual([
      { x: 700, y: band.y },
      { x: 700, y: 300 },
      { x: 700, y: 300 },
    ]);
    // Left of the band and above it (the map): up from the band's left end, then left.
    const left = leaderPath(band, { x: 200, y: 400 });
    expect(left[0]).toEqual({ x: band.x + 12, y: band.y });
    expect(left[1]).toEqual({ x: band.x + 12, y: 400 });
    expect(left[2]).toEqual({ x: 200, y: 400 });
    // Below it (the inventory, the keys): down from the bottom edge.
    expect(leaderPath(band, { x: 900, y: 900 })[0]).toEqual({ x: 900, y: band.y + band.h });
    // Level with it (the gauge): straight across from its side.
    expect(leaderPath(band, { x: 236, y: 700 })).toEqual([
      { x: band.x, y: 700 },
      { x: band.x, y: 700 },
      { x: 236, y: 700 },
    ]);
    for (const p of [up, left]) {
      expect(p[0].x === p[1].x || p[0].y === p[1].y).toBe(true);
      expect(p[1].x === p[2].x || p[1].y === p[2].y).toBe(true);
    }
  });
});
