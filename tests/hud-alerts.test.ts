import { BROWNOUT } from '../src/sim/brownout';
import {
  ALERT_PRIORITY,
  type AlertInput,
  type AlertKind,
  HELD_SECONDS,
  REFRESH_FROM,
  SLIDE_SECONDS,
  STRIPE_PERIOD,
  alertAt,
  alertKindOf,
  alertLayout,
  alertMotion,
  alertSound,
  emptyAlert,
  round5,
  slideOffset,
  stepAlert,
  stripeScroll,
} from '../src/scenes/hud/alerts';
import { LABELS } from '../src/scenes/hud/labels';
import { DIP_FLASH_HZ, fallForecastAt, surgeWarningAt } from '../src/scenes/hud/warnings';
import { ZONES, inside } from '../src/scenes/live/layout';
import { LINES, type LineId } from '../src/strings';

// gauges-3: the alert band's pure rules (src/scenes/hud/alerts.ts). One alert at a time, by priority
// dark > held > flicker > refresh > raid > forecast > fall > none; the number leads the headline and
// the cause is the sub-line; RAID only as the tag; nothing moves under reduce flicker.

const C = BROWNOUT.challenges;
const MIDNIGHT = BROWNOUT.clock.midnight;

/** A quiet frame at `now`, with the forecasts the real warnings give at that time. */
function at(now: number, over: Partial<AlertInput> = {}): AlertInput {
  return {
    now,
    demand: 30,
    dropped: 0,
    retry: 0,
    rescued: false,
    surge: surgeWarningAt(now),
    fall: fallForecastAt(now),
    dip: null,
    failure: null,
    midnight: null,
    notes: { sizing: null },
    ...over,
  };
}

const NEW_ALERT_IDS: LineId[] = [
  'C3.alert.title',
  'C3.alert.down',
  'C4.alert.title',
  'C4.alert.refresh',
  'C6.alert.title',
  'C6.alert.dip',
  'C6.alert.held',
  'C6.alert.dark',
  'C7.alert.title',
];

/** The priority table: each case, the kind it must show, and the lines it must use. */
const CASES: {
  name: string;
  input: AlertInput;
  kind: AlertKind;
  title: LineId | null;
  line: LineId | null;
  number?: number;
}[] = [
  { name: 'a quiet C1 board', input: at(40), kind: 'none', title: null, line: null },
  {
    name: 'the C3 climb, 10 s out',
    input: at(C.c3 - 10),
    kind: 'forecast',
    title: 'C3.alert.title',
    line: 'C3.warn.01',
    number: 90,
  },
  {
    name: 'the C3 climb lingering after it lands',
    input: at(C.c3 + 2, { demand: 90 }),
    kind: 'forecast',
    title: 'C3.alert.title',
    line: 'C3.warn.01',
    number: 90,
  },
  {
    name: 'the district surge forecast, 12 s out',
    input: at(C.c4 - 12),
    kind: 'forecast',
    title: 'C4.alert.title',
    line: 'C4.warn.01',
    number: 250,
  },
  {
    name: 'the district surge lands: raid beats its own forecast',
    input: at(C.c4 + 1, { demand: 250 }),
    kind: 'raid',
    title: 'C4.alert.title',
    line: 'C4.warn.01',
    number: 250,
  },
  {
    name: 'retries push it up: refresh beats raid',
    input: at(C.c4 + 6, { demand: 250 * (1 + 0.2), retry: 0.2 }),
    kind: 'refresh',
    title: 'C4.alert.title',
    line: 'C4.alert.refresh',
    number: 300,
  },
  {
    name: 'a dip warning in the raid: flicker beats refresh',
    input: at(C.c4 + 4, { demand: 260, retry: 0.1, dip: { partId: 'server-1', at: C.c4 + 5 } }),
    kind: 'flicker',
    title: 'C4.alert.title',
    line: 'C4.flicker.01',
    number: 260,
  },
  {
    name: 'the box dies in the raid: dark beats flicker',
    input: at(C.c4 + 4, {
      demand: 260,
      dropped: 140,
      retry: 0.1,
      dip: { partId: 'server-1', at: C.c4 + 5 },
      failure: { cause: 'server-died' },
    }),
    kind: 'dark',
    title: 'C3.alert.down',
    line: null,
    number: 140,
  },
  {
    name: 'the crew arrived: the raid ends and the lingering forecast shows',
    input: at(C.c4 + 3, { demand: 250, retry: 0.1, rescued: true }),
    kind: 'forecast',
    title: 'C4.alert.title',
    line: 'C4.warn.01',
    number: 250,
  },
  {
    name: 'the crew arrived, the forecast gone: nothing',
    input: at(C.c4 + 20, { demand: 250, retry: 0.1, rescued: true }),
    kind: 'none',
    title: null,
    line: null,
  },
  {
    name: 'the midnight forecast before SET names the outage',
    input: at(C.c6 - 10),
    kind: 'forecast',
    title: 'C6.alert.title',
    line: 'C6.alert.dip',
    number: 150,
  },
  {
    name: 'the midnight forecast after SET is the forecast line',
    input: at(C.c6 - 10, { notes: { sizing: 4 } }),
    kind: 'forecast',
    title: 'C6.alert.title',
    line: 'C6.warn.01',
    number: 150,
  },
  {
    name: 'the midnight dip warning',
    input: at(MIDNIGHT - 11, { demand: 150, dip: { partId: 'server-3', at: MIDNIGHT - 10 } }),
    kind: 'flicker',
    title: 'C6.alert.title',
    line: 'C6.flicker.01',
    number: 150,
  },
  {
    name: 'midnight held: held, the dropped count first',
    input: at(MIDNIGHT + 1, { midnight: { held: true, dropped: 3 } }),
    kind: 'held',
    title: 'C6.alert.held',
    line: 'C1.card.bar',
    number: 3,
  },
  {
    name: 'held gives way to the fall forecast at 00:00:05',
    input: at(MIDNIGHT + HELD_SECONDS + 1, { midnight: { held: true, dropped: 3 } }),
    kind: 'fall',
    title: 'C7.alert.title',
    line: 'C7.warn.01',
    number: BROWNOUT.demand.afterMidnight,
  },
  {
    name: 'midnight dark: dark beats held and fall',
    input: at(MIDNIGHT + 6, {
      midnight: { held: false, dropped: 812 },
      failure: { cause: 'dark-at-midnight' },
    }),
    kind: 'dark',
    title: 'C6.alert.dark',
    line: 'C6.warn.01',
    number: 812,
  },
  {
    name: 'a failure before the crew (trust) is the block going down',
    input: at(C.c4 + 8, { failure: { cause: 'trust' }, dropped: 90 }),
    kind: 'dark',
    title: 'C3.alert.down',
    line: null,
    number: 90,
  },
  {
    name: 'the fall forecast alone',
    input: at(MIDNIGHT + 10),
    kind: 'fall',
    title: 'C7.alert.title',
    line: 'C7.warn.01',
    number: 40,
  },
  {
    name: 'after the fall forecast: nothing',
    input: at(MIDNIGHT + 20),
    kind: 'none',
    title: null,
    line: null,
  },
];

describe('the alert priority table', () => {
  it('orders the kinds dark > held > flicker > refresh > raid > forecast > fall > none', () => {
    expect(ALERT_PRIORITY).toEqual([
      'dark',
      'held',
      'flicker',
      'refresh',
      'raid',
      'forecast',
      'fall',
      'none',
    ]);
  });

  for (const c of CASES) {
    it(`${c.name}: ${c.kind}`, () => {
      const a = alertAt(c.input, false);
      expect(a.kind).toBe(c.kind);
      expect(alertKindOf(c.input)).toBe(c.kind);
      expect(a.title).toBe(c.title);
      expect(a.line).toBe(c.line);
      if (c.number !== undefined) expect(a.number).toBe(c.number);
      expect(a.sub).toBe(c.line ? LINES[c.line].text : '');
    });
  }

  it('covers every kind at least once', () => {
    const kinds = new Set(CASES.map((c) => c.kind));
    for (const k of ALERT_PRIORITY) expect(kinds.has(k), k).toBe(true);
  });

  it('picks the higher kind whenever two conditions hold at once', () => {
    // Pairwise: lay each lower kind's condition under each higher one's, and the higher one shows.
    const conditions: Record<Exclude<AlertKind, 'none'>, Partial<AlertInput>> = {
      dark: { failure: { cause: 'server-died' } },
      held: { midnight: { held: true, dropped: 0 }, now: MIDNIGHT + 1 },
      flicker: { dip: { partId: 'server-1', at: C.c4 + 5 } },
      refresh: { retry: 0.2, rescued: false },
      raid: { rescued: false },
      // The crew ending the raid leaves the district forecast lingering on its own.
      forecast: { rescued: true },
      fall: { fall: { demand: 40 } },
    };
    const ranked = ALERT_PRIORITY.filter((k) => k !== 'none') as Exclude<AlertKind, 'none'>[];
    for (let i = 0; i < ranked.length; i++) {
      for (let j = i + 1; j < ranked.length; j++) {
        const hi = ranked[i];
        const lo = ranked[j];
        // Inside the raid window with the district forecast lingering, so raid and forecast can hold.
        const base = at(C.c4 + 3, { demand: 250 });
        const input = { ...base, ...conditions[lo], ...conditions[hi] };
        if (hi === 'held') {
          // Held is a midnight state: the raid and forecast windows are long gone by then.
          if (lo === 'refresh' || lo === 'raid' || lo === 'forecast') continue;
        }
        expect(alertKindOf(input), `${hi} over ${lo}`).toBe(hi);
      }
    }
  });
});

describe('the headline: the number first, the cause in the sub-line', () => {
  const shown = CASES.map((c) => alertAt(c.input, false)).filter((a) => a.kind !== 'none');

  it('leads every headline with its number and follows it with the title words', () => {
    for (const a of shown) {
      expect(a.headline, a.kind).toMatch(/^\d+(\/s| DROPPED) · /);
      expect(a.headline.startsWith(String(a.number)), a.headline).toBe(true);
      expect(a.headline.endsWith(LINES[a.title!].text), a.headline).toBe(true);
    }
    expect(alertAt(at(C.c4 + 1, { demand: 250 }), false).headline).toBe('250/s · NEIGHBOURS REROUTED HERE');
    expect(alertAt(at(C.c3 - 10), false).headline).toBe('90/s · EVERYONE FILMING');
    expect(alertAt(at(C.c6 - 10), false).headline).toBe('150/s · MIDNIGHT');
  });

  it('keeps RAID out of every headline and sub-line; it is only the tag, in the raid window', () => {
    for (const a of shown) {
      expect(a.headline.toUpperCase(), a.headline).not.toContain('RAID');
      expect(a.sub.toUpperCase(), a.sub).not.toContain('RAID');
    }
    expect(alertAt(at(C.c4 + 1, { demand: 250 }), false).tag).toBe(LABELS.alert.raidTag);
    expect(alertAt(at(C.c4 + 6, { demand: 300, retry: 0.2 }), false).tag).toBe('RAID');
    expect(alertAt(at(C.c4 - 5), false).tag).toBeNull();
    expect(alertAt(at(C.c6 - 5), false).tag).toBeNull();
  });

  it('draws the hazard stripes in the raid and dark states only', () => {
    expect(alertAt(at(C.c4 + 1, { demand: 250 }), false).stripes).toBe(true);
    expect(alertAt(at(C.c4 + 6, { demand: 300, retry: 0.2 }), false).stripes).toBe(true);
    expect(alertAt(at(C.c4 + 8, { failure: { cause: 'trust' } }), false).stripes).toBe(true);
    expect(alertAt(at(C.c4 - 5), false).stripes).toBe(false);
    expect(alertAt(at(MIDNIGHT + 10), false).stripes).toBe(false);
  });

  it('counts the forecast chip down to NOW', () => {
    expect(alertAt(at(C.c4 - 8), false).chip).toBe('in 8s');
    expect(alertAt(at(C.c4 - 0.5), false).chip).toBe('in 1s');
    expect(alertAt(at(C.c3 + 1, { demand: 90 }), false).chip).toBe('NOW');
    expect(alertAt(at(C.c4 + 1, { demand: 250 }), false).chip).toBe('');
  });

  it('says the block is refreshing once retries reach 5%', () => {
    expect(alertAt(at(C.c4 + 4, { demand: 250, retry: REFRESH_FROM - 0.001 }), false).kind).toBe('raid');
    expect(alertAt(at(C.c4 + 4, { demand: 260, retry: REFRESH_FROM }), false).kind).toBe('refresh');
  });
});

describe('the raid number climbs with retries', () => {
  it('reads 250 with no retries and climbs above 250 once retry > 0', () => {
    expect(alertAt(at(C.c4 + 1, { demand: 250, retry: 0 }), false).number).toBe(250);
    for (const retry of [0.02, 0.05, 0.2, 0.5]) {
      const a = alertAt(at(C.c4 + 5, { demand: 250 * (1 + retry), retry }), false);
      expect(a.number, String(retry)).toBeGreaterThan(250);
      expect(a.number).toBe(round5(250 * (1 + retry)));
    }
    expect(alertAt(at(C.c4 + 5, { demand: 375, retry: 0.5 }), false).headline).toBe(
      '375/s · NEIGHBOURS REROUTED HERE',
    );
  });

  it('rounds to the nearest 5 so the number does not jitter', () => {
    expect(round5(252.4)).toBe(250);
    expect(round5(252.6)).toBe(255);
    expect(round5(373)).toBe(375);
  });
});

describe('reduce flicker: no flash, slide or scrolling stripes', () => {
  const dip = { partId: 'server-1', at: C.c4 + 5 };

  it('flashes the flicker at 6 Hz in play, steady and lit under reduce flicker', () => {
    const lit = new Set<boolean>();
    for (let k = 0; k < 24; k++) {
      const now = C.c4 + 3 + k / (DIP_FLASH_HZ * 4);
      const a = alertAt(at(now, { demand: 250, dip }), false);
      expect(a.kind).toBe('flicker');
      expect(a.flashing).toBe(true);
      lit.add(a.lit);
      const steady = alertAt(at(now, { demand: 250, dip }), true);
      expect(steady.flashing).toBe(false);
      expect(steady.lit).toBe(true);
    }
    expect([...lit].sort()).toEqual([false, true]);
  });

  it('never flashes another kind', () => {
    for (const c of CASES) {
      const a = alertAt(c.input, false);
      if (a.kind !== 'flicker') {
        expect(a.flashing, c.name).toBe(false);
        expect(a.lit, c.name).toBe(true);
      }
    }
  });

  it('turns off the slide, the stripes and the flash in the view flag', () => {
    expect(alertMotion(true)).toEqual({ slide: false, stripes: false, flash: false });
    expect(alertMotion(false)).toEqual({ slide: true, stripes: true, flash: true });
    const z = ZONES.alert;
    for (const t of [0, 0.05, 0.1, 0.2, 1]) expect(slideOffset(t, z, alertMotion(true))).toBe(0);
    for (const t of [0, 1.3, 7.9, 100]) expect(stripeScroll(t, alertMotion(true))).toBe(0);
  });

  it('slides from y -84 to 8 over 250 ms in play, and scrolls the stripes 20 px/s', () => {
    const z = ZONES.alert;
    const moving = alertMotion(false);
    expect(z.y + slideOffset(0, z, moving)).toBe(-z.h);
    const mid = z.y + slideOffset(SLIDE_SECONDS / 2, z, moving);
    expect(mid).toBeGreaterThan(-z.h);
    expect(mid).toBeLessThan(z.y);
    expect(slideOffset(SLIDE_SECONDS, z, moving)).toBe(0);
    expect(slideOffset(5, z, moving)).toBe(0);
    expect(stripeScroll(0.5, moving)).toBeCloseTo(10);
    expect(stripeScroll(1.5, moving)).toBeCloseTo(30 % STRIPE_PERIOD);
  });
});

describe('stepAlert in place', () => {
  it('reports a change only on a new kind, title or sub-line, and reuses the strings otherwise', () => {
    const out = emptyAlert();
    expect(stepAlert(out, at(C.c4 + 1, { demand: 250 }), false)).toBe(true);
    const headline = out.headline;
    const sub = out.sub;
    expect(stepAlert(out, at(C.c4 + 1.1, { demand: 250 }), false)).toBe(false);
    expect(out.headline).toBe(headline);
    expect(out.sub).toBe(sub);
    // A new number rewrites the headline but is not a new alert.
    expect(stepAlert(out, at(C.c4 + 2, { demand: 255, retry: 0.02 }), false)).toBe(false);
    expect(out.headline).toBe('255/s · NEIGHBOURS REROUTED HERE');
    // Refresh changes the sub-line: a new alert.
    expect(stepAlert(out, at(C.c4 + 3, { demand: 275, retry: 0.1 }), false)).toBe(true);
    expect(out.kind).toBe('refresh');
  });
});

describe('the surge sound', () => {
  it('plays on entering a forecast or the raid, not on its own refresh or flicker', () => {
    expect(alertSound('none', 'forecast')).toBe('surge-warning');
    expect(alertSound('forecast', 'raid')).toBe('surge-warning');
    expect(alertSound('raid', 'raid')).toBeNull();
    expect(alertSound('raid', 'refresh')).toBeNull();
    expect(alertSound('refresh', 'raid')).toBeNull();
    expect(alertSound('flicker', 'raid')).toBeNull();
    expect(alertSound('forecast', 'none')).toBeNull();
    expect(alertSound('none', 'dark')).toBeNull();
  });
});

describe('the band layout', () => {
  it('keeps every piece inside ZONES.alert, the headline from x 540 and the well at the right end', () => {
    const z = ZONES.alert;
    const L = alertLayout(z);
    expect(L.plate).toEqual(z);
    expect(inside(L.well, z)).toBe(true);
    expect(L.well.x + L.well.w).toBe(z.x + z.w);
    expect(L.headline.x).toBe(540);
    expect(L.headline.x + L.headline.w).toBeLessThan(L.chip.right);
    expect(L.chip.right).toBeLessThan(L.well.x);
    expect(L.sub.x + L.sub.w).toBeLessThanOrEqual(L.well.x);
    expect(L.sub.y).toBeLessThan(z.y + z.h);
  });
});

describe('the nine alert lines', () => {
  /** The debrief's bold terms, plus the mockup's words for the same ideas. */
  const bold = (['C8.terms.sizing', 'C8.terms.scaling', 'C8.terms.failure'] as const).flatMap((id) =>
    [...LINES[id].text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]),
  );
  const banned = [
    ...bold.flatMap((t) => t.split(/,\s*/)).map((t) => t.toLowerCase()),
    'headroom',
    'throughput',
    'balancer',
    'scaling',
    'cascad',
    'retry storm',
    'shedding',
  ];

  it('are ui lines in LINES (and so in docs/SCRIPT.md, tests/strings.test.ts)', () => {
    for (const id of NEW_ALERT_IDS) {
      expect(LINES[id], id).toBeDefined();
      expect(LINES[id].kind, id).toBe('ui');
    }
  });

  it('hold no debrief term, and neither does any headline or sub-line the band builds', () => {
    expect(banned).toEqual(expect.arrayContaining(['headroom', 'load balancer', 'n+1', 'capacity']));
    const texts = [
      ...NEW_ALERT_IDS.map((id) => LINES[id].text),
      ...CASES.map((c) => alertAt(c.input, false)).flatMap((a) => [a.headline, a.sub, a.chip, a.tag ?? '']),
    ];
    for (const t of texts) {
      const lower = t.toLowerCase();
      expect(
        banned.filter((b) => lower.includes(b)),
        t,
      ).toEqual([]);
    }
  });

  it('names the outage in the C6 sub-line until SET', () => {
    expect(LINES['C6.alert.dip'].text.toLowerCase()).toContain('loses power');
  });
});
