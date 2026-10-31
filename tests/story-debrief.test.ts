import { BROWNOUT } from '../src/sim/brownout';
import { brownoutSession } from '../src/sim/tick';
import {
  BOOK_PAGES,
  type DebriefResults,
  debriefLines,
  debriefResults,
  nextBookPage,
  resultRows,
} from '../src/story/debrief';

const BEST: DebriefResults = {
  droppedRequests: 0,
  wastedCredits: 0,
  trustLeft: 100,
  banner: 'ignore',
  ozzieTab: BROWNOUT.ozzie.front,
  scaledDown: true,
  midnightHeld: true,
  serversAtMidnight: 4,
};

describe('debrief lines', () => {
  // Rolando, 31 Oct 2026: the tail after midnight is short. Rei acknowledges the night and grades
  // the build; the terms and the interview answer live in the Night Book.
  it('acknowledges the night, then praises a build that held midnight without waste, and stops', () => {
    expect(debriefLines(BEST)).toEqual(['C8.rei.ack', 'C8.rei.sizing.good']);
  });

  it('calls sizing bad when midnight failed or ran on boxes that only cost', () => {
    expect(debriefLines({ ...BEST, serversAtMidnight: 5 })).toContain('C8.rei.sizing.bad');
    expect(debriefLines({ ...BEST, serversAtMidnight: 3 })).toContain('C8.rei.sizing.good');
    expect(debriefLines({ ...BEST, midnightHeld: false })).toContain('C8.rei.sizing.bad');
    expect(debriefLines({ ...BEST, midnightHeld: false })).not.toContain('C8.rei.sizing.good');
  });

  it('calls out a paid banner, and says nothing about one ignored or binned', () => {
    expect(debriefLines({ ...BEST, banner: 'pay' })).toEqual([
      'C8.rei.ack',
      'C8.rei.sizing.good',
      'C8.rei.banner.pay',
    ]);
    expect(debriefLines({ ...BEST, banner: 'bin' })).toEqual(['C8.rei.ack', 'C8.rei.sizing.good']);
    expect(debriefLines({ ...BEST, banner: null })).toEqual(['C8.rei.ack', 'C8.rei.sizing.good']);
  });

  it("names Ozzie's debt only when his tab is above his 100 front, with his reply after", () => {
    expect(debriefLines(BEST)).not.toContain('C8.rei.debt');
    const lines = debriefLines({ ...BEST, ozzieTab: 230 });
    expect(lines.indexOf('C8.ozzie.debt')).toBe(lines.indexOf('C8.rei.debt') + 1);
  });

  it('grades 5 or more boxes at midnight as built first, counted later, in one line', () => {
    expect(debriefLines({ ...BEST, serversAtMidnight: 5 })).toEqual(['C8.rei.ack', 'C8.rei.sizing.bad']);
    expect(debriefLines({ ...BEST, scaledDown: false })).toEqual(['C8.rei.ack', 'C8.rei.sizing.good']);
  });

  it('keeps the worst night to four lines: the ack, the grade, the Solace money and the tab', () => {
    expect(
      debriefLines({ ...BEST, banner: 'pay', ozzieTab: 230, serversAtMidnight: 6, scaledDown: false }),
    ).toEqual(['C8.rei.ack', 'C8.rei.sizing.bad', 'C8.rei.banner.pay', 'C8.rei.debt', 'C8.ozzie.debt']);
  });

  it('turns the Night Book from page 1 to the words to the interview answer, then closes', () => {
    expect(BOOK_PAGES).toEqual(['lesson', 'terms', 'interview']);
    expect(nextBookPage('lesson')).toBe('terms');
    expect(nextBookPage('terms')).toBe('interview');
    expect(nextBookPage('interview')).toBe(null);
  });

  it('does not mutate the results it grades', () => {
    const r = { ...BEST };
    debriefLines(r);
    expect(r).toEqual(BEST);
  });
});

describe('debrief results', () => {
  it("builds banner, trust and Ozzie's tab from the run", () => {
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
    const r = debriefResults(session, pending);
    expect(r).toEqual({ ...pending, trustLeft: 72, banner: 'pay', ozzieTab: 230 });
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
