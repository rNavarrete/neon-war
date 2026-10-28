import labelsSource from '../src/scenes/hud/labels.ts?raw';
import { LOCKED_KINDS } from '../src/scenes/board/tray';
import { CUES } from '../src/scenes/hud/cues';
import {
  LABELS,
  allLabels,
  diesIn,
  gaugeSubLine,
  ghostPlate,
  overBy,
  roomLeftLabel,
} from '../src/scenes/hud/labels';
import {
  LEADER_FOR,
  LESSON_IDS,
  LINE_META,
  LINE_TAGS,
  PART_ROLES,
  TEACHES,
  TERM_GROUP,
  TERM_KEYS,
  WARNING_IDS,
  isLesson,
  metaOf,
  tagOf,
} from '../src/scenes/hud/lineMeta';
import { CARD_IDS, ZONE_IDS } from '../src/scenes/live/layout';
import { LINES, type LineId } from '../src/strings';

const IDS = Object.keys(LINES) as LineId[];

/** The debrief's bold terms, in order, from the three C8.terms lines. */
const BOLD_TERMS: string[] = (['C8.terms.sizing', 'C8.terms.scaling', 'C8.terms.failure'] as const).flatMap(
  (id) => [...LINES[id].text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]),
);

/**
 * What to look for on screen before the debrief: every bold term (and each half of "Redundancy,
 * N+1"), plus the words the mockup printed that name the same ideas (HEADROOM, EST. THROUGHPUT,
 * BALANCER) and the stems a reworded term would still carry.
 */
const BANNED: string[] = [
  ...BOLD_TERMS.flatMap((t) => t.split(/,\s*/)).map((t) => t.toLowerCase()),
  'headroom',
  'throughput',
  'balancer',
  'health check',
  'scaling',
  'scale up',
  'scale out',
  'scale down',
  'single point',
  'cascad',
  'retry storm',
  'shedding',
  'redundan',
];

/** Where a term may appear before the debrief: the Solace pitch and TRIAGE's echo of it. */
const ALLOWED: Readonly<Partial<Record<LineId, readonly string[]>>> = {
  'C2.banner.body': ['capacity'],
  'C2.triage.01': ['capacity'],
};

function termsIn(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED.filter((t) => lower.includes(t));
}

/** Sample outputs of every label formatter, so the numbers-in-words copy is scanned too. */
const FORMATTED: string[] = [
  gaugeSubLine(0, 0),
  gaugeSubLine(60, 0),
  gaugeSubLine(60, 30),
  overBy(250, 120) ?? '',
  roomLeftLabel(90, 120),
  roomLeftLabel(250, 120),
  roomLeftLabel(30, 0),
  ghostPlate(60, 3, 80),
  ghostPlate(0, 3, 80),
  diesIn(7.2),
];

describe('the debrief terms', () => {
  it('has one code key per bold term in C8.terms, in the debrief order, each in its group', () => {
    expect(BOLD_TERMS).toHaveLength(TERM_KEYS.length);
    const groups = { sizing: 'C8.terms.sizing', scaling: 'C8.terms.scaling', failure: 'C8.terms.failure' };
    TERM_KEYS.forEach((key, i) => {
      expect(LINES[groups[TERM_GROUP[key]] as LineId].text).toContain(`**${BOLD_TERMS[i]}**`);
    });
  });
});

describe('lineMeta', () => {
  it('gives every id in CUES a row with a tag in HINT, WARNING, CREW, LUX, HOUSE', () => {
    expect(LINE_TAGS).toEqual(['HINT', 'WARNING', 'CREW', 'LUX', 'HOUSE']);
    for (const c of CUES) {
      const m = metaOf(c.id);
      expect(m, c.id).not.toBeNull();
      expect(LINE_TAGS, c.id).toContain(m?.tag);
    }
  });

  it('has a row for every bark and chat line and none for scene or ui lines', () => {
    for (const id of IDS) {
      const kind = LINES[id].kind;
      expect(metaOf(id) !== null, id).toBe(['bark', 'chat', 'block', 'stream'].includes(kind));
    }
  });

  it('tags by speaker: panicking TRIAGE is WARNING, other TRIAGE HINT, the crew CREW, Lux LUX, the house HOUSE', () => {
    expect(tagOf('C1.triage.02')).toBe('HINT');
    expect(tagOf('C4.triage.02')).toBe('WARNING');
    expect(tagOf('C5.rei.05')).toBe('CREW');
    expect(tagOf('C5.mika.05')).toBe('CREW');
    expect(tagOf('C7.ozzie.01')).toBe('CREW');
    expect(tagOf('C4.lux.01')).toBe('LUX');
    expect(tagOf('C4.grandma.01')).toBe('HOUSE');
    expect(tagOf('C6.tv.01')).toBe('HOUSE');
    expect(tagOf('C4.chat.dark')).toBe('HOUSE');
  });

  it('tags exactly the five panicking TRIAGE barks WARNING', () => {
    const warnings = IDS.filter((id) => LINE_META[id]?.tag === 'WARNING');
    expect([...warnings].sort()).toEqual([...WARNING_IDS].sort());
    expect(WARNING_IDS).toHaveLength(5);
    for (const id of WARNING_IDS) expect(LINES[id].speaker).toBe('TRIAGE (panicking)');
  });

  it('flags the 11 lesson ids from the design as lessons and no other line', () => {
    const lessons: LineId[] = [
      'C1.triage.06',
      'C2.triage.after',
      'C3.triage.01',
      'C3.lux.01',
      'C4.triage.03',
      'C4.triage.cut',
      'C5.triage.03',
      'C5.mika.05',
      'C6.triage.01',
      'C7.ozzie.01',
      'C7.triage.01',
    ];
    expect([...LESSON_IDS].sort()).toEqual([...lessons].sort());
    for (const id of IDS) expect(isLesson(id), id).toBe(lessons.includes(id));
    for (const id of lessons) expect(LINES[id].kind, id).toBe('bark');
  });

  it('gives each row a subject of part:<id>, zone:<name>, key:<n> or null; C4.lux.01 points at key two', () => {
    const zones = new Set<string>([...ZONE_IDS, ...CARD_IDS]);
    const parts = new Set<string>([...PART_ROLES, 'gateway', 'database']);
    for (const id of IDS) {
      const s = LINE_META[id]?.subject;
      if (s === undefined || s === null) continue;
      const [kind, name] = s.split(':');
      if (kind === 'part') expect(parts.has(name), id).toBe(true);
      else if (kind === 'zone') expect(zones.has(name), id).toBe(true);
      else expect(kind === 'key' && ['one', 'two', 'three'].includes(name), id).toBe(true);
    }
    expect(metaOf('C4.lux.01')?.subject).toBe('key:two');
    expect(metaOf('C3.lux.01')?.subject).toBe('part:gateway');
    expect(metaOf('C6.rei.01')?.subject).toBe('zone:alert');
    for (const id of Object.keys(LEADER_FOR) as LineId[])
      expect(metaOf(id)?.subject, id).toBe(LEADER_FOR[id]);
  });

  it('lists what each line teaches as C8 term keys; every lesson line teaches something', () => {
    for (const id of IDS) {
      const t = LINE_META[id]?.teaches ?? [];
      for (const key of t) expect(TERM_KEYS, id).toContain(key);
    }
    for (const id of LESSON_IDS) expect(metaOf(id)?.teaches.length, id).toBeGreaterThan(0);
    for (const id of Object.keys(TEACHES) as LineId[]) expect(metaOf(id), id).not.toBeNull();
    expect(metaOf('C4.triage.03')?.teaches).toContain('retryStorm');
    expect(metaOf('C4.triage.cut')?.teaches).toContain('loadShedding');
  });
});

describe('no term before the debrief', () => {
  it('finds the bold list and the mockup words to scan for', () => {
    expect(BOLD_TERMS).toContain('Headroom');
    expect(BOLD_TERMS).toContain('Load balancer');
    expect(BANNED).toEqual(expect.arrayContaining(['headroom', 'throughput', 'balancer', 'n+1']));
  });

  it('keeps every line outside C8.* free of the terms (Solace and TRIAGE may say capacity)', () => {
    for (const id of IDS) {
      if (id.startsWith('C8.')) continue;
      const found = termsIn(LINES[id].text).filter((t) => !(ALLOWED[id] ?? []).includes(t));
      expect(found, `${id}: ${LINES[id].text}`).toEqual([]);
    }
  });

  it('keeps every label in labels.ts free of the terms, the formatted ones included', () => {
    const labels = [...allLabels(), ...FORMATTED];
    expect(labels.length).toBeGreaterThan(30);
    for (const l of labels) expect(termsIn(l), l).toEqual([]);
  });

  it('scans the labels file itself, so a label added outside LABELS is caught too', () => {
    // String literals only (code inside a template's ${...} is an identifier, not copy).
    const literals = [...labelsSource.matchAll(/'([^'\n]*)'|`([^`\n]*)`|"([^"\n]*)"/g)].map((m) =>
      (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ''),
    );
    expect(literals.length).toBeGreaterThan(30);
    for (const l of literals) expect(termsIn(l), l).toEqual([]);
  });

  it('prints the crew words: COMING /s, ROOM, ROOM LEFT, SPLITTER (crew gift), your guess stays free', () => {
    const labels = allLabels();
    for (const w of ['COMING /s', 'ROOM', 'ROOM LEFT', 'SPLITTER (crew gift)', 'your guess stays free']) {
      expect(labels, w).toContain(w);
    }
    expect(roomLeftLabel(90, 120)).toBe('ROOM LEFT 25% · 90 of 120');
    expect(roomLeftLabel(250, 120)).toBe('OVER +130/s');
    expect(roomLeftLabel(30, 0)).toBe('NO BOX');
    expect(ghostPlate(0, 3, 80)).toBe('+0 room · nothing feeds it');
    expect(ghostPlate(60, 3, 80)).toBe('+60 room · boots 3 s · -80 cr');
    expect(overBy(250, 120)).toBe('OVER BY 130/s');
    expect(overBy(30, 60)).toBeNull();
    expect(gaugeSubLine(0, 0)).toBe('no box yet');
  });

  it('never prints HEADROOM, EST. THROUGHPUT, BALANCER or a locked mini kind name in a label', () => {
    // The gateway and the database are the board's own parts, named in C1.triage.05 and C3.lux.01.
    const kinds = LOCKED_KINDS.filter((k) => k !== 'gateway' && k !== 'database').map((k) =>
      k.replace(/-/g, ' '),
    );
    for (const l of [...allLabels(), ...FORMATTED]) {
      const lower = l.toLowerCase();
      expect(lower, l).not.toMatch(/headroom|throughput|balancer/);
      for (const k of kinds) expect(lower.includes(k), `${l} names ${k}`).toBe(false);
    }
    expect(LABELS.inventory.splitter).toBe('SPLITTER (crew gift)');
  });

  it('keeps the new learning lines short and free of digits in filler', () => {
    const fresh: LineId[] = [
      'C4.chat.dark',
      'C5.chat.lb',
      'C6.chat.dark',
      'C7.chat.01',
      'fill.block.dark.01',
      'fill.block.dark.02',
    ];
    for (const id of fresh) {
      expect(LINES[id].text.length, id).toBeLessThan(70);
      expect(metaOf(id)?.tag, id).toBe('HOUSE');
    }
    for (const id of IDS.filter((i) => i.startsWith('fill.'))) expect(LINES[id].text, id).not.toMatch(/\d/);
  });
});
