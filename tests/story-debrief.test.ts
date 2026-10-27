import { BROWNOUT } from '../src/sim/brownout';
import { brownoutSession } from '../src/sim/tick';
import {
  type DebriefResults,
  ESTIMATE_CLOSE_RANGE,
  debriefLines,
  debriefResults,
  estimateClose,
  resultRows,
} from '../src/story/debrief';

const BEST: DebriefResults = {
  droppedRequests: 0,
  wastedCredits: 0,
  trustLeft: 100,
  banner: 'ignore',
  ozzieTab: BROWNOUT.ozzie.front,
  scaledDown: true,
  estimate: 30,
  midnightHeld: true,
  serversAtMidnight: 4,
};

describe('debrief lines', () => {
  it('opens and closes with Rei, and praises a close estimate that held at midnight', () => {
    const lines = debriefLines(BEST);
    expect(lines[0]).toBe('C8.rei.open');
    expect(lines.at(-1)).toBe('C8.rei.close');
    expect(lines).toEqual([
      'C8.rei.open',
      'C8.rei.sizing.good',
      'C8.rei.banner.skip',
      'C8.rei.down',
      'C8.rei.close',
    ]);
  });

  it('calls sizing bad when the estimate was far off or midnight failed', () => {
    expect(debriefLines({ ...BEST, estimate: 480 })).toContain('C8.rei.sizing.bad');
    expect(debriefLines({ ...BEST, estimate: null })).toContain('C8.rei.sizing.bad');
    expect(debriefLines({ ...BEST, midnightHeld: false })).toContain('C8.rei.sizing.bad');
    expect(debriefLines({ ...BEST, midnightHeld: false })).not.toContain('C8.rei.sizing.good');
  });

  it('calls out a paid banner, and praises ignoring or binning it', () => {
    expect(debriefLines({ ...BEST, banner: 'pay' })).toContain('C8.rei.banner.pay');
    expect(debriefLines({ ...BEST, banner: 'bin' })).toContain('C8.rei.banner.skip');
    expect(debriefLines({ ...BEST, banner: null })).toContain('C8.rei.banner.skip');
  });

  it("names Ozzie's debt only when his tab is above his 100 front, with his reply after", () => {
    expect(debriefLines(BEST)).not.toContain('C8.rei.debt');
    const lines = debriefLines({ ...BEST, ozzieTab: 230 });
    expect(lines.indexOf('C8.ozzie.debt')).toBe(lines.indexOf('C8.rei.debt') + 1);
  });

  it('calls waste at 5 or more boxes at midnight and notes scaling down', () => {
    expect(debriefLines({ ...BEST, serversAtMidnight: 4 })).not.toContain('C8.rei.waste');
    expect(debriefLines({ ...BEST, serversAtMidnight: 5 })).toContain('C8.rei.waste');
    expect(debriefLines({ ...BEST, scaledDown: false })).not.toContain('C8.rei.down');
  });

  it('treats the C1 dial band as a close estimate (placeholder threshold)', () => {
    expect(ESTIMATE_CLOSE_RANGE).toEqual({ min: 25, max: 35 });
    expect(estimateClose(25)).toBe(true);
    expect(estimateClose(35)).toBe(true);
    expect(estimateClose(36)).toBe(false);
    expect(estimateClose(null)).toBe(false);
  });

  it('does not mutate the results it grades', () => {
    const r = { ...BEST };
    debriefLines(r);
    expect(r).toEqual(BEST);
  });
});

describe('debrief results', () => {
  it("builds banner, trust, Ozzie's tab and the estimate from the run", () => {
    const base = brownoutSession();
    const session = {
      ...base,
      trust: 72,
      banner: { choice: 'pay' as const, at: 100 },
      ozzie: { fronted: true, debt: 130 },
    };
    const pending = {
      droppedRequests: 12,
      wastedCredits: 40,
      scaledDown: false,
      midnightHeld: true,
      serversAtMidnight: 4,
    };
    const r = debriefResults(session, { estimate: 30, sizing: 4 }, pending);
    expect(r).toEqual({ ...pending, trustLeft: 72, banner: 'pay', ozzieTab: 230, estimate: 30 });
  });

  it('shows one raw row per category, no letter grades', () => {
    const rows = resultRows({ ...BEST, banner: 'pay', droppedRequests: 12.4 });
    expect(rows.map((r) => r.label)).toEqual([
      'Dropped requests',
      'Wasted credits',
      'Trust left',
      'Solace banner',
      "Ozzie's tab",
      'Scaled down after midnight',
    ]);
    expect(rows.map((r) => r.value)).toEqual(['12', '0', '100', 'Paid', '100', 'Yes']);
  });
});
