import {
  FILLER_MAX_SECONDS,
  FILLER_MIN_SECONDS,
  avatarFor,
  chatEntry,
  chatOf,
  fillerDelay,
  fillerPool,
  pickFiller,
  pushChat,
  seededRandom,
} from '../src/scenes/hud/chat';
import {
  REGROUP_UNUSED,
  regroupActive,
  regroupSpent,
  regroupTimeScale,
  startRegroup,
} from '../src/scenes/hud/regroup';
import { dipWarningAt, surgeWarningAt } from '../src/scenes/hud/warnings';
import { BROWNOUT } from '../src/sim/brownout';

describe('chat', () => {
  it('routes scripted lines to the block or stream chat', () => {
    expect(chatOf('C1.chat.01')).toBe('block');
    expect(chatOf('C1.chat.02')).toBe('stream');
    expect(chatOf('fill.stream.ok.01')).toBe('stream');
    expect(chatOf('C1.triage.01')).toBeNull();
  });

  it('names the writer and finds their avatar', () => {
    expect(chatEntry('C1.chat.01')).toMatchObject({ who: 'mrs okafor', text: "It's back! Bless you Lux" });
    expect(chatEntry('fill.block.ok.01')).toMatchObject({
      who: 'old man noodles',
      text: 'is the noodle cam on?',
    });
    expect(chatEntry('C4.chat.03').who).toBe('system');
    expect(avatarFor('mrs okafor')).toBe('mrs-okafor');
    expect(avatarFor('viewer')).toBeNull();
  });

  it('keeps the newest messages without changing the old log', () => {
    const log = [chatEntry('C1.chat.01')];
    const next = pushChat(log, chatEntry('fill.block.ok.01'), 1);
    expect(next.map((e) => e.id)).toEqual(['fill.block.ok.01']);
    expect(log.map((e) => e.id)).toEqual(['C1.chat.01']);
  });

  it('picks filler from the pool for the error state', () => {
    expect(fillerPool('block', 'ok')).toHaveLength(4);
    expect(fillerPool('block', 'slow')).toHaveLength(3);
    expect(fillerPool('stream', 'down')).toEqual(['fill.stream.down.01', 'fill.stream.down.02']);
    const rand = seededRandom(1);
    for (let i = 0; i < 20; i++) expect(pickFiller('block', 'down', rand)).toMatch(/^fill\.block\.down\./);
    expect(pickFiller('stream', 'down', () => 0, 'fill.stream.down.01')).toBe('fill.stream.down.02');
  });

  it('waits 6 to 10 s between filler lines, deterministically for a seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 50; i++) {
      const d = fillerDelay(a);
      expect(d).toBeGreaterThanOrEqual(FILLER_MIN_SECONDS);
      expect(d).toBeLessThan(FILLER_MAX_SECONDS);
      expect(fillerDelay(b)).toBe(d);
    }
  });
});

describe('warnings', () => {
  const C = BROWNOUT.challenges;

  it('shows the C4 and C6 surges with their numbers at least 10 s ahead', () => {
    expect(surgeWarningAt(C.c4 - 10)).toMatchObject({
      surge: { demand: 250 },
      inSeconds: 10,
      line: 'C4.warn.01',
    });
    expect(surgeWarningAt(C.c6 - 10)).toMatchObject({ surge: { demand: 150 }, line: 'C6.warn.01' });
    expect(surgeWarningAt(C.c4 - 10.5)?.surge.startsAt).toBe(C.c4);
    expect(surgeWarningAt(C.c4 - 11.5)?.surge.startsAt).toBe(C.c4);
    expect(surgeWarningAt(C.c4 - 13)).toBeNull();
    expect(surgeWarningAt(C.c4 + 1)?.inSeconds).toBe(0);
    expect(surgeWarningAt(C.c4 + 30)).toBeNull();
  });

  it('flickers on the part 2 s before a dip, steady with reduce flicker', () => {
    const dip = { partId: 's1', at: 100 };
    expect(dipWarningAt(dip, 97.5, false)).toBeNull();
    expect(dipWarningAt(null, 99, false)).toBeNull();
    const lit = [98.05, 98.15, 98.25, 98.35].map((t) => dipWarningAt(dip, t, false)?.lit);
    expect(new Set(lit).size).toBe(2);
    for (const t of [98.05, 98.15, 98.25, 98.35]) {
      expect(dipWarningAt(dip, t, true)).toEqual({ partId: 's1', lit: true, flashing: false });
    }
    expect(dipWarningAt(dip, 100, false)).toBeNull();
  });
});

describe('Regroup', () => {
  it('runs quarter speed for 10 s once, then is spent', () => {
    expect(regroupTimeScale(REGROUP_UNUSED, 5)).toBe(1);
    const s = startRegroup(REGROUP_UNUSED, 5);
    expect(regroupActive(s, 5)).toBe(true);
    expect(regroupTimeScale(s, 14.9)).toBe(0.25);
    expect(regroupSpent(s, 14.9)).toBe(false);
    expect(regroupTimeScale(s, 15)).toBe(1);
    expect(regroupSpent(s, 15)).toBe(true);
    expect(startRegroup(s, 20)).toBe(s);
  });
});
