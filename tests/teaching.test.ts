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
import { bestPlay } from '../src/game/autopilot';
import { bus } from '../src/game/bus';
import { type Frame, frame, resetFrame } from '../src/game/frame';
import { type Occurrence, detectOccurrences } from '../src/game/occurrences';
import { type Run, newRun, run } from '../src/game/run';
import { type CueHost, NEW_DIRECTOR, cueViewOf, direct, emptyCueView } from '../src/scenes/hud/cues';
import { applyEstimate, applySizing } from '../src/scenes/hud/dial';
import { type HudTestState, hudSection } from '../src/scenes/hud/hook';
import { sizingPromptOpen } from '../src/scenes/hud/jobCard';
import {
  EMPTY_TRACE,
  MOMENT_KINDS,
  MOMENT_TEACHES,
  type TaughtTrace,
  emptyMeasure,
  measureNotes,
  momentOfAction,
  momentOfOccurrence,
  seeLine,
  seeMoment,
  taughtMeasure,
  taughtTrace,
  termsSeen,
} from '../src/scenes/hud/taught';
import { BROWNOUT } from '../src/sim/brownout';
import { SERVER_SLOTS } from '../src/sim/tick';
import { MOMENT_WORDS, TERM_NAMES, seenLines, seenText } from '../src/story/debrief';
import { storyWiring } from '../src/story/wiring';

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

// ---- learning-4: hud.measure, the taught trace and the debrief's "you saw it at" lines ----

const C = BROWNOUT.challenges;

/** The hud section as the hook publishes it, over an empty base (only provided sections). */
function hudHook(): HudTestState {
  return hudSection({} as HudTestState);
}

/** Tell the bus what the HUD would on one frame: its occurrences and the cue table's fired ids. */
function emitFrame(occ: readonly Occurrence[], fired: readonly LineId[], clock: number): void {
  for (const o of occ) bus.emit('occurrence', o);
  for (const id of fired) {
    const kind = LINES[id].kind === 'bark' ? 'bark' : 'chat';
    bus.emit('cue', { id, kind, at: clock });
    // The band shows the bark (lessons and WARNINGs are never dropped stale).
    const m = metaOf(id);
    if (kind === 'bark' && m) {
      bus.emit('line', { id, speaker: LINES[id].speaker, tag: m.tag, lesson: m.lesson, since: clock });
    }
  }
}

interface Played {
  r: Run;
  /** The trace as it stood on the last frame before the debrief (00:01:00). */
  beforeDebrief: TaughtTrace;
}

/**
 * Best play through the night on the run() singleton, with the HUD's bus traffic replayed: the C1
 * estimate set to 30 at once, the C6 sizing set to 4 ten HUD seconds after the prompt opens
 * (TRIAGE's division lands at 8 s), and optionally the laundry cut as soon as it is offered.
 */
function playNight(opts: { laundry: boolean }): Played {
  resetFrame();
  const r = newRun(1, bestPlay);
  r.now = C.c1;
  let prev: Frame | null = null;
  const occ: Occurrence[] = [];
  const v = emptyCueView();
  let s = NEW_DIRECTOR;
  let clock = 0;
  let promptAt: number | null = null;
  let beforeDebrief: TaughtTrace = EMPTY_TRACE;
  for (let n = 0; n < 20_000 && r.now < C.c8 && !r.play.failure; n++) {
    if (r.notes.estimate === null) applyEstimate(r, 30);
    if (opts.laundry && frame(r).laundryCutAvailable && !r.play.laundryCut) r.cutLaundry();
    const sizingOpen = sizingPromptOpen({
      now: r.now,
      cardOpen: false,
      estimate: r.notes.estimate,
      sizing: r.notes.sizing,
    });
    if (sizingOpen) promptAt ??= clock;
    if (sizingOpen && promptAt !== null && clock - promptAt >= 10) {
      applySizing(r, BROWNOUT.finalSizing.holds);
    }
    r.tick(0.1);
    clock += 0.1;
    const f = frame(r);
    detectOccurrences(prev, f, occ);
    prev = f;
    const host: CueHost = {
      cardClosed: true,
      dialTouched: true,
      sizingOpen,
      bannerShown: f.now >= C.c2,
      decommissionsAfterMidnight: 0,
    };
    cueViewOf(v, f, occ, clock, host, v);
    const out = direct(s, v);
    s = out.state;
    emitFrame(occ, out.fired, clock);
    if (f.now < C.c8) beforeDebrief = taughtTrace();
  }
  return { r, beforeDebrief };
}

describe('hud.measure (learning-4)', () => {
  it('after C1 SET, hud.measure.estimate equals notes.estimate and estimateAt is > 0', () => {
    resetFrame();
    const r = newRun(1, null);
    r.now = C.c1 + 4;
    bus.emit('perfSample', { at: 1, fps: 60, objects: 0, texts: 0, graphics: 0 });
    expect(hudHook().measure).toEqual(emptyMeasure());
    expect(applyEstimate(r, 30)).toBe(true);
    // The cue table answers a SET on the same frame (C1.triage.03).
    bus.emit('cue', { id: 'C1.triage.03', kind: 'bark', at: 4 });
    const m = hudHook().measure;
    expect(m?.estimate).toBe(r.notes.estimate);
    expect(m?.estimate).toBe(30);
    expect(m?.estimateAt).toBeGreaterThan(0);
    expect(m?.estimateAt).toBe(C.c1 + 4);
    expect(m?.sizing).toBeNull();
    // A later frame keeps the first stamp.
    r.now = C.c1 + 9;
    bus.emit('perfSample', { at: 9, fps: 60, objects: 0, texts: 0, graphics: 0 });
    expect(hudHook().measure?.estimateAt).toBe(C.c1 + 4);
  });

  it('counts the board wires and stamps the first one', () => {
    resetFrame();
    const r = newRun(1, null);
    r.now = C.c1;
    const before = frame(r);
    rackOne(r);
    r.now = C.c1 + 2;
    const occ: Occurrence[] = [];
    detectOccurrences(before, frame(r), occ);
    for (const o of occ) bus.emit('occurrence', o);
    const m = taughtMeasure();
    expect(m.wires).toBe(2);
    expect(m.firstWireAt).toBe(C.c1 + 2);
    expect(hudHook().measure).toEqual(m);
    expect(termsSeen(taughtTrace())).toContain('capacity');
  });

  it('stamps an answer once and returns the same object when nothing changed', () => {
    const m0 = emptyMeasure();
    const m1 = measureNotes(m0, { estimate: 30, sizing: null }, 20);
    expect(m1).not.toBe(m0);
    expect(m0.estimate).toBeNull();
    expect(m1).toMatchObject({ estimate: 30, estimateAt: 20, sizing: null, sizingAt: null });
    expect(measureNotes(m1, { estimate: 30, sizing: null }, 40)).toBe(m1);
    expect(measureNotes(m1, { estimate: 30, sizing: 4 }, 470)).toMatchObject({
      estimateAt: 20,
      sizing: 4,
      sizingAt: 470,
    });
  });
});

/** Place one server and wire it gateway to database, as the player does in C1. */
function rackOne(r: Run): void {
  const slot = SERVER_SLOTS[0];
  expect(r.placeServer(slot).ok).toBe(true);
  const id = r.session.board.parts.find((p) => p.kind === 'server')?.id ?? '';
  expect(r.connect('gateway', id).ok).toBe(true);
  expect(r.connect(id, 'database').ok).toBe(true);
}

describe('the taught trace (learning-4)', () => {
  it('maps every term to at least one line (lineMeta.teaches) or moment, so each term can be seen', () => {
    const covered = new Set<string>([
      ...Object.values(TEACHES).flatMap((t) => t ?? []),
      ...Object.values(MOMENT_TEACHES).flat(),
    ]);
    for (const k of TERM_KEYS) expect(covered.has(k), k).toBe(true);
  });

  it('records the terms of a shown line once, with its clock; a line that teaches nothing leaves it alone', () => {
    let t = seeLine(EMPTY_TRACE, 'C1.triage.06', 40, '23:52:10');
    expect(t.map((e) => e.term)).toEqual(['capacity', 'headroom']);
    expect(t[0]).toMatchObject({
      line: 'C1.triage.06',
      moment: null,
      at: 40,
      clock: '23:52:10',
      group: 'sizing',
    });
    expect(seeLine(t, 'C1.triage.06', 90, '23:53:00')).toBe(t);
    expect(seeLine(t, 'C1.triage.02', 50, '23:52:20')).toBe(t);
    // The WARNINGs C4.triage.02/.03 join the trace too.
    t = seeLine(t, 'C4.triage.02', 305, '23:56:35');
    t = seeLine(t, 'C4.triage.03', 310, '23:56:40');
    expect(termsSeen(t)).toEqual(['capacity', 'headroom', 'singlePointOfFailure', 'retryStorm']);
    expect(EMPTY_TRACE).toHaveLength(0);
  });

  it('reads the moments: SET, the first SKIPPED, the dark big box, a decommission, the dip survived with 4', () => {
    const facts = (parts: unknown[], midnight: unknown = null) => ({ parts, midnight }) as unknown as Frame;
    const none = facts([]);
    const big = facts([{ id: 's1', kind: 'server', slot: 'a', boost: 1.5 }]);
    const stock = facts([{ id: 's1', kind: 'server', slot: 'a' }]);
    const held = (servers: number) => facts([], { held: true, dropped: 0, servers, waste: false });
    expect(momentOfOccurrence({ kind: 'skipped', id: 'lb>s2', at: 470 }, none)).toBe('firstSkipped');
    expect(momentOfOccurrence({ kind: 'dark', id: 's1', at: 305 }, big)).toBe('bigBoxDark');
    expect(momentOfOccurrence({ kind: 'dark', id: 's1', at: 305 }, stock)).toBeNull();
    expect(momentOfOccurrence({ kind: 'dark', at: 510 }, big)).toBeNull();
    expect(momentOfOccurrence({ kind: 'hot', id: 's2', at: 200 }, none)).toBeNull();
    expect(momentOfOccurrence({ kind: 'hot', id: 's2', at: 505 }, none)).toBe('diesInAtMidnight');
    expect(momentOfOccurrence({ kind: 'held', at: 510 }, held(4))).toBe('heldWithSpare');
    expect(momentOfOccurrence({ kind: 'held', at: 510 }, held(3))).toBeNull();
    expect(momentOfOccurrence({ kind: 'wired', id: 's1>database', at: 20 }, none)).toBe('firstLive');
    expect(momentOfOccurrence({ kind: 'wired', id: 'gateway>s1', at: 20 }, none)).toBeNull();
    expect(momentOfOccurrence({ kind: 'laundryCut', at: 330 }, none)).toBe('laundryCut');
    expect(momentOfOccurrence({ kind: 'retriesRising', at: 18 }, none)).toBeNull();
    expect(momentOfOccurrence({ kind: 'retriesRising', at: 312 }, none)).toBe('retriesRising');
    expect(TERM_NAMES.healthChecks).toBe('Health checks');
    expect(momentOfAction({ type: 'decommission', id: 's4', refund: 40 })).toBe('decommission');
    expect(momentOfAction({ type: 'overclock', id: 's1' })).toBe('kitFitted');
    expect(momentOfAction({ type: 'wire', from: 'a', to: 'b' })).toBeNull();
    const t = seeMoment(EMPTY_TRACE, 'estimateSet', 20, '23:51:50', 30);
    expect(t.map((e) => e.term)).toEqual(['requirements', 'requestsPerSecond', 'estimate']);
    expect(t[2]).toMatchObject({ moment: 'estimateSet', line: null, value: 30 });
    expect(seeMoment(t, 'estimateSet', 25, '23:51:55', 30)).toBe(t);
  });

  it('on the best-play run has at least one entry per C8 term group before the debrief', () => {
    const { r, beforeDebrief } = playNight({ laundry: false });
    expect(r.play.failure).toBeNull();
    expect(r.play.midnight?.held).toBe(true);
    const groups = new Set(beforeDebrief.map((e) => e.group));
    expect([...groups].sort()).toEqual(['failure', 'scaling', 'sizing']);
    for (const e of beforeDebrief) expect(e.at, e.term).toBeLessThan(C.c8);
    // Every term but load shedding: best play (src/game/autopilot.ts) never cuts the laundry floor.
    const seen = termsSeen(beforeDebrief);
    expect(TERM_KEYS.filter((k) => !seen.includes(k))).toEqual(['loadShedding']);
    // The moments D10 names are among the entries.
    const moments = new Set(beforeDebrief.map((e) => e.moment));
    for (const m of ['estimateSet', 'firstSkipped', 'bigBoxDark', 'decommission', 'heldWithSpare'] as const) {
      expect(moments.has(m), m).toBe(true);
    }
    // C4.triage.02/.03 count although they are WARNINGs; cascading failure points at C6.triage.02 (D2).
    const lines = new Set(beforeDebrief.map((e) => e.line));
    expect(lines.has('C4.triage.02')).toBe(true);
    expect(lines.has('C4.triage.03')).toBe(true);
    expect(beforeDebrief.find((e) => e.term === 'cascadingFailure')?.line).toBe('C6.triage.02');
    // Clocks are the in-world hh:mm:ss.
    for (const e of beforeDebrief) expect(e.clock, e.term).toMatch(/^(23:5\d|00:00):\d\d$/);
  });

  it('with the laundry cut as well, every C8 term has an entry before the debrief', () => {
    const { r, beforeDebrief } = playNight({ laundry: true });
    expect(r.play.laundryCut).not.toBeNull();
    expect(termsSeen(beforeDebrief).sort()).toEqual([...TERM_KEYS].sort());
    // The wiring hands the debrief the run's trace.
    expect(run()).toBe(r);
    expect(storyWiring.taught()).toBe(taughtTrace());
  });

  it('starts over on a fresh run', () => {
    playNight({ laundry: false });
    expect(taughtTrace().length).toBeGreaterThan(0);
    newRun(1, null);
    expect(taughtTrace()).toEqual([]);
    expect(taughtMeasure()).toEqual(emptyMeasure());
  });
});

describe('the debrief "you saw it at" lines (learning-4, D10)', () => {
  it('names each term key by its bold debrief name', () => {
    expect(TERM_NAMES.headroom).toBe('Headroom');
    expect(TERM_NAMES.loadBalancer).toBe('Load balancer');
    expect(TERM_NAMES.redundancy).toBe('Redundancy, N+1');
    expect(new Set(Object.values(TERM_NAMES)).size).toBe(TERM_KEYS.length);
  });

  it('prints one grey line per term with an entry (its first sighting) in the debrief order, none for the rest', () => {
    let t = seeLine(EMPTY_TRACE, 'C4.triage.03', 310, '23:56:40');
    t = seeMoment(t, 'estimateSet', 20, '23:51:50', 30);
    t = seeMoment(t, 'retriesRising', 312, '23:56:42');
    const lines = seenLines(t);
    expect(lines.map((l) => l.term)).toEqual(['requirements', 'requestsPerSecond', 'estimate', 'retryStorm']);
    expect(lines[0]).toEqual({
      term: 'requirements',
      group: 'sizing',
      name: 'Requirements',
      text: 'you saw it at 23:51:50: you set the dial to 30 a second',
    });
    expect(lines[3].text).toBe(`you saw it at 23:56:40: “${LINES['C4.triage.03'].text}”`);
    expect(seenLines(EMPTY_TRACE)).toEqual([]);
  });

  it('gives every moment draft words, free of the debrief terms themselves', () => {
    for (const m of MOMENT_KINDS) {
      const words = MOMENT_WORDS[m](4);
      expect(words.length, m).toBeGreaterThan(0);
      expect(termsIn(words), m).toEqual([]);
      const e = { term: MOMENT_TEACHES[m][0], group: 'sizing', line: null, moment: m, value: 4, at: 1 };
      expect(seenText({ ...e, group: 'sizing', clock: '23:51:31' })).toBe(`you saw it at 23:51:31: ${words}`);
    }
  });

  it('on best play gives the debrief a grey line in every column', () => {
    const { beforeDebrief } = playNight({ laundry: false });
    const lines = seenLines(beforeDebrief);
    expect(lines).toHaveLength(TERM_KEYS.length - 1);
    expect(new Set(lines.map((l) => l.group))).toEqual(new Set(['sizing', 'scaling', 'failure']));
    for (const l of lines) expect(l.text, l.term).toMatch(/^you saw it at \d\d:\d\d:\d\d: .+/);
  });
});
