import { BROWNOUT } from '../src/sim/brownout';
import { NO_TIPS, type TipFacts, type TipState, stepTips, tipTotal } from '../src/sim/tips';

// Viewer tips, the stream's donations (Rolando, 30 Oct 2026: earn credits like a streamer).
const T = BROWNOUT.tips;
const base: TipFacts = {
  t: 0,
  seed: 7,
  served: 0,
  errorShare: 0,
  credits: 300,
  rescued: false,
  held: false,
  beforeMidnight: true,
};

/** Step from `from` to `to` in 0.1 s ticks with facts from `at`. */
function run(s: TipState, from: number, to: number, at: (t: number) => Partial<TipFacts>): TipState {
  let st = s;
  for (let t = from + 0.1; t <= to + 1e-9; t += 0.1) st = stepTips(st, { ...base, ...at(t), t }).state;
  return st;
}

describe('viewer tips', () => {
  it('the first serve earns the first milestone tip, once', () => {
    const s = run(NO_TIPS, 0, 2, (t) => ({ served: t > 1 ? 30 : 0 }));
    expect(s.tips.map((x) => [x.kind, x.amount])).toEqual([['first', T.milestone.first]]);
    expect(tipTotal(s)).toBe(T.milestone.first);
  });

  it('trickles a small tip every 20 to 40 s while nothing fails, and none while it does', () => {
    const calm = run(NO_TIPS, 0, 200, () => ({ served: 30 }));
    const trickle = calm.tips.filter((x) => x.kind === 'trickle');
    expect(trickle.length).toBeGreaterThanOrEqual(4);
    expect(trickle.length).toBeLessThanOrEqual(10);
    for (const x of trickle) {
      expect(x.amount % T.trickle.step).toBe(0);
      expect(x.amount).toBeGreaterThanOrEqual(T.trickle.min);
      expect(x.amount).toBeLessThanOrEqual(T.trickle.max);
    }
    const gaps = trickle.slice(1).map((x, i) => x.at - trickle[i].at);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(T.trickle.minSeconds - 0.11);
    // Failing all the way (and not broke): the first serve's tip and nothing after.
    const failing = run(NO_TIPS, 0, 200, () => ({ served: 30, errorShare: 0.4 }));
    expect(failing.tips.map((x) => x.kind)).toEqual(['first']);
  });

  it('the lights back after a failing spell earn a tip, at most once per cooldown', () => {
    let s = run(NO_TIPS, 0, 2, () => ({ served: 30 }));
    s = run(s, 2, 8, () => ({ served: 30, errorShare: 0.3 }));
    s = run(s, 8, 12, () => ({ served: 30 }));
    const rec = s.tips.filter((x) => x.kind === 'recovered');
    expect(rec).toHaveLength(1);
    expect(rec[0].amount).toBe(T.milestone.recovered);
    s = run(s, 12, 18, () => ({ served: 30, errorShare: 0.3 }));
    s = run(s, 18, 22, () => ({ served: 30 }));
    expect(s.tips.filter((x) => x.kind === 'recovered')).toHaveLength(1);
  });

  it('failing and short of a server: a viewer covers the price, so there is always a move', () => {
    const s = run(NO_TIPS, 0, 10, (t) => ({ served: 30, errorShare: t > 1 ? 0.5 : 0, credits: 2 }));
    const help = s.tips.filter((x) => x.kind === 'help');
    expect(help).toHaveLength(1);
    expect(2 + help[0].amount).toBeGreaterThanOrEqual(BROWNOUT.server.cost);
    expect(help[0].at).toBeGreaterThanOrEqual(1 + T.help.afterSeconds - 0.11);
    // After midnight nobody needs bailing out.
    const late = run(NO_TIPS, 0, 10, () => ({
      served: 30,
      errorShare: 0.5,
      credits: 2,
      beforeMidnight: false,
    }));
    expect(late.tips.filter((x) => x.kind === 'help')).toEqual([]);
    // With money for a server, nobody sends help.
    const rich = run(NO_TIPS, 0, 10, () => ({ served: 30, errorShare: 0.5, credits: 200 }));
    expect(rich.tips.filter((x) => x.kind === 'help')).toEqual([]);
  });

  it('the rescue and a held midnight are milestones; the same seed gives the same tips', () => {
    const s = run(NO_TIPS, 0, 3, (t) => ({
      served: 30,
      rescued: Math.abs(t - 1) < 0.05,
      held: Math.abs(t - 2) < 0.05,
    }));
    expect(s.tips.map((x) => x.kind)).toEqual(['first', 'rescue', 'midnight']);
    const a = run(NO_TIPS, 0, 120, () => ({ served: 30 }));
    const b = run(NO_TIPS, 0, 120, () => ({ served: 30 }));
    expect(a.tips).toEqual(b.tips);
    expect(a.tips.map((x) => x.n)).toEqual(a.tips.map((_, i) => i));
  });

  it('never mutates its input', () => {
    const s = run(NO_TIPS, 0, 2, () => ({ served: 30 }));
    const copy = JSON.stringify(s);
    stepTips(s, { ...base, t: 50, served: 30, rescued: true });
    expect(JSON.stringify(s)).toBe(copy);
  });
});

describe('the help tip pays for the move that would help', () => {
  it('covers the given price (the bigger server before the load balancer), plus a little', () => {
    const s = run(NO_TIPS, 0, 10, (t) => ({
      served: 30,
      errorShare: t > 1 ? 0.5 : 0,
      credits: 53,
      helpPrice: 60,
    }));
    const help = s.tips.filter((x) => x.kind === 'help');
    expect(help).toHaveLength(1);
    expect(53 + help[0].amount).toBeGreaterThanOrEqual(60);
    expect(53 + help[0].amount).toBeLessThan(BROWNOUT.server.cost + T.help.extra);
    // With the bigger server in reach, nobody sends help.
    const fine = run(NO_TIPS, 0, 10, () => ({ served: 30, errorShare: 0.5, credits: 65, helpPrice: 60 }));
    expect(fine.tips.filter((x) => x.kind === 'help')).toEqual([]);
  });
});
