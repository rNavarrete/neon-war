import labelsSource from '../src/scenes/hud/labels.ts?raw';
import { placeBalancer } from '../src/scenes/board/crew';
import { LOCKED_KINDS, lockedReason, trayCards } from '../src/scenes/board/tray';
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
import { bestPlay, bestPlayUntil, idleAt, idleFrom } from '../src/game/autopilot';
import { bus } from '../src/game/bus';
import { type Frame, frame, resetFrame } from '../src/game/frame';
import { type Occurrence, detectOccurrences } from '../src/game/occurrences';
import { type Run, newRun, run } from '../src/game/run';
import {
  AWAITING_ENG503,
  type CueHost,
  type CueView,
  NEW_DIRECTOR,
  cueViewOf,
  direct,
  emptyCueView,
} from '../src/scenes/hud/cues';
import { ghostCapacity } from '../src/scenes/board/ghost';
import {
  CHAT_PACE,
  chatSetFor,
  emptyChatInputs,
  fillerAllowed,
  initialChat,
  stepChat,
} from '../src/scenes/hud/chatEngine';
import { FILLER_MAX_SECONDS, FILLER_MIN_SECONDS, fillerDelay } from '../src/scenes/hud/chat';
import {
  NO_COMMS,
  READ_LEAD,
  READ_TAIL,
  STALE_CHAINED_SECONDS,
  STALE_SECONDS,
  VOICE_TAIL,
  WARNING_PREEMPT_AFTER,
  COMMS_QUEUE_MAX,
  dwellFor,
  enqueueComms,
  staleAfter,
  stepComms,
} from '../src/scenes/hud/comms';
import { BARK_SECONDS } from '../src/scenes/hud/barks';
import { GAUGE_MAX, gaugeAngle } from '../src/scenes/hud/gauge';
import {
  headroomColour,
  headroomLabel,
  headroomLoad,
  headroomPct,
  litSegments,
} from '../src/scenes/hud/headroom';
import { camStep, emptyCamView, initialCam } from '../src/scenes/hud/luxcam';
import { type HudTestState, hudSection } from '../src/scenes/hud/hook';
import {
  EMPTY_TRACE,
  MOMENT_KINDS,
  MOMENT_TEACHES,
  type TaughtTrace,
  emptyMeasure,
  momentOfAction,
  momentOfOccurrence,
  seeLine,
  seeMoment,
  taughtMeasure,
  taughtTrace,
  termsSeen,
} from '../src/scenes/hud/taught';
import { BROWNOUT, BROWNOUT_RULES } from '../src/sim/brownout';
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
      else expect(kind === 'key' && ['one', 'two'].includes(name), id).toBe(true);
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

  it('prints the crew words: COMING /s, ROOM, ROOM LEFT, SPLITTER (crew gift)', () => {
    const labels = allLabels();
    for (const w of ['COMING /s', 'ROOM', 'ROOM LEFT', 'SPLITTER (crew gift)']) {
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

// ---- learning-3: the wording pass over every lane's anchor and labels.ts ----

describe('the wording pass (learning-3)', () => {
  it('prints the crew word on the tray card and in the refusals, never the debrief name', () => {
    const balancer = trayCards(false).find((c) => c.id === 'balancer');
    expect(balancer?.name).toBe('SPLITTER');
    expect(balancer?.name).toBe(LABELS.plates.names.balancer);
    expect(lockedReason('balancer')).toBe(LABELS.inventory.splitterLocked);
    const before = { rescued: false, session: { board: { parts: [] } } } as unknown as Run;
    const after = { rescued: true, session: { board: { parts: [] } } } as unknown as Run;
    const reason = (r: Run): string => {
      const res = placeBalancer(r);
      return res.ok ? '' : res.reason;
    };
    expect(reason(before)).toBe(LABELS.inventory.splitterLocked);
    expect(reason(after)).toBe('the splitter is already racked');
    const shown = [
      ...trayCards(true).map((c) => c.name ?? ''),
      lockedReason('balancer'),
      reason(before),
      reason(after),
    ];
    for (const t of shown) expect(termsIn(t), t).toEqual([]);
  });

  it('uses one verb for a dark box the splitter passes: skips, as Rei and the SKIPPED tag say', () => {
    expect(LINES['C5.rei.03'].text).toContain('skips');
    expect(LABELS.plates.splitter).toContain('skips a dark one');
    expect(LABELS.plates.state.skipped).toBe('the splitter skips it');
  });

  it('keeps the reworded lines short and in the words the rest of the night uses', () => {
    // The refresh sub-line names who, as TRIAGE does in C4.triage.03.
    expect(LINES['C4.alert.refresh'].text).toMatch(/^Everyone's hitting refresh/);
    expect(LINES['C4.triage.03'].text).toContain('hitting refresh');
    // The midnight outage is one box, the word the plates and the crew use, not a rack.
    expect(LINES['C6.alert.dip'].text).toContain('One box loses power');
    expect(LINES['C6.alert.dip'].text.length).toBeLessThan(80);
    // The surge reaction is the neighbours coming in, not viewers flooding the stream (D8: RAID).
    expect(LINES['fill.stream.surge.02'].text).toContain('neighbours');
    expect(LINES['fill.stream.surge.02'].text).not.toMatch(/chat|viewer/);
    // The stream notices the crew's gift instead of repeating fill.stream.rescue.01.
    expect(LINES['C5.chat.lb'].text).not.toMatch(/who are these people/i);
    expect(termsIn(LINES['C5.chat.lb'].text)).toEqual([]);
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
 * Best play through the night on the run() singleton, with the HUD's bus traffic replayed, and
 * optionally the laundry cut as soon as it is offered.
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
  let beforeDebrief: TaughtTrace = EMPTY_TRACE;
  for (let n = 0; n < 20_000 && r.now < C.c8 && !r.play.failure; n++) {
    if (opts.laundry && frame(r).laundryCutAvailable && !r.play.laundryCut) r.cutLaundry();
    r.tick(0.1);
    clock += 0.1;
    const f = frame(r);
    detectOccurrences(prev, f, occ);
    prev = f;
    const host: CueHost = {
      cardClosed: true,
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

  it('reads the moments: the first SKIPPED, the dark big box, a decommission, the dip survived with 4', () => {
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
    // The first three sizing terms are TRIAGE's 30 now (no estimate step): a line, not a moment.
    const t = seeLine(EMPTY_TRACE, 'C1.triage.03', 20, '23:51:50');
    expect(t.map((e) => e.term)).toEqual(['requirements', 'requestsPerSecond', 'estimate']);
    expect(t[2]).toMatchObject({ moment: null, line: 'C1.triage.03', value: null });
    expect(seeLine(t, 'C1.triage.03', 25, '23:51:55')).toBe(t);
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
    for (const m of ['firstSkipped', 'bigBoxDark', 'decommission', 'heldWithSpare'] as const) {
      expect(moments.has(m), m).toBe(true);
    }
    // C4.triage.02/.03 count although they are WARNINGs; cascading failure points at C6.triage.02 (D2).
    const lines = new Set(beforeDebrief.map((e) => e.line));
    expect(lines.has('C1.triage.03')).toBe(true);
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
    t = seeLine(t, 'C1.triage.03', 20, '23:51:50');
    t = seeMoment(t, 'retriesRising', 312, '23:56:42');
    const lines = seenLines(t);
    expect(lines.map((l) => l.term)).toEqual(['requirements', 'requestsPerSecond', 'estimate', 'retryStorm']);
    expect(lines[0]).toEqual({
      term: 'requirements',
      group: 'sizing',
      name: 'Requirements',
      text: `you saw it at 11:51:50 PM: “${LINES['C1.triage.03'].text}”`,
    });
    expect(lines[3].text).toBe(`you saw it at 11:56:40 PM: “${LINES['C4.triage.03'].text}”`);
    expect(seenLines(EMPTY_TRACE)).toEqual([]);
  });

  it('gives every moment draft words, free of the debrief terms themselves', () => {
    for (const m of MOMENT_KINDS) {
      const words = MOMENT_WORDS[m](4);
      expect(words.length, m).toBeGreaterThan(0);
      expect(termsIn(words), m).toEqual([]);
      const e = { term: MOMENT_TEACHES[m][0], group: 'sizing', line: null, moment: m, value: 4, at: 1 };
      expect(seenText({ ...e, group: 'sizing', clock: '23:51:31' })).toBe(
        `you saw it at 11:51:31 PM: ${words}`,
      );
    }
  });

  it('on best play gives the debrief a grey line in every column', () => {
    const { beforeDebrief } = playNight({ laundry: false });
    const lines = seenLines(beforeDebrief);
    expect(lines).toHaveLength(TERM_KEYS.length - 1);
    expect(new Set(lines.map((l) => l.group))).toEqual(new Set(['sizing', 'scaling', 'failure']));
    for (const l of lines) expect(l.text, l.term).toMatch(/^you saw it at \d{1,2}:\d\d:\d\d [AP]M: .+/);
  });
});

// ---- learning-5: the teaching criteria a to j (06-teaching.md, LRN-10 test plan) ----

/** A CueView over the blank one: C1 with the job card still up, nothing built (learning-2's base). */
function cueView(over: Partial<CueView> = {}): CueView {
  return { ...emptyCueView(), now: C.c1, demand: 30, dropped: 30, ...over };
}

/** learning-2's five frozen CueViews (tests/hud-barks.test.ts), as T2 names them. */
const FROZEN: readonly (readonly [string, CueView])[] = [
  ['job card open', cueView({ now: C.c1 })],
  [
    'C1 built at 30 against 60',
    cueView({ cardClosed: true, capacity: 60, demand: 30, dropped: 0, servers: 1 }),
  ],
  [
    'C3 with an idle box',
    cueView({
      now: C.c3 + 10,
      cardClosed: true,
      capacity: 120,
      demand: 70,
      dropped: 0,
      servers: 2,
      idleServer: true,
    }),
  ],
  [
    'the surge dip',
    cueView({
      now: C.c4 + 5,
      cardClosed: true,
      capacity: 0,
      demand: 280,
      dropped: 280,
      servers: 1,
      overclocked: true,
      overclockedId: 'server-p3',
      darkPart: 'server-p3',
      retry: 0.12,
    }),
  ],
  [
    'the crew wait with 2 live',
    cueView({
      now: C.c5 + 1,
      cardClosed: true,
      rescued: true,
      rescueClock: 0,
      servers: 3,
      serversAfterRescue: 3,
      liveBehindLb: 2,
      bootingBehindLb: 1,
      capacity: 120,
      demand: 120,
      dropped: 0,
    }),
  ],
];

/** Run the director over one frozen view with only the HUD clock moving, 0..600 in quarter seconds. */
function runFrozen(base: CueView): { first: LineId[]; later: { id: LineId; clock: number }[] } {
  let s = NEW_DIRECTOR;
  const r0 = direct(s, { ...base, clock: 0 });
  s = r0.state;
  const later: { id: LineId; clock: number }[] = [];
  for (let t = 0.25; t <= 600; t += 0.25) {
    const r = direct(s, { ...base, clock: t });
    s = r.state;
    for (const id of r.fired) later.push({ id, clock: t });
  }
  return { first: [...r0.fired], later };
}

describe('teaching (a): hints fire on sim triggers only (learning-5)', () => {
  it('with the sim frozen and the job card up, 600 s of HUD clock fire nothing', () => {
    // From a real run's Frame: the card up at C1, nothing built, the sim clock standing still.
    resetFrame();
    const r = newRun(1, null);
    r.now = C.c1;
    const f = frame(r);
    const host: CueHost = {
      cardClosed: false,
      bannerShown: false,
      decommissionsAfterMidnight: 0,
    };
    let s = NEW_DIRECTOR;
    const v = emptyCueView();
    const fired: LineId[] = [];
    for (let clock = 0; clock <= 600; clock += 0.25) {
      cueViewOf(v, f, [], clock, host, v);
      const out = direct(s, v);
      s = out.state;
      fired.push(...out.fired);
    }
    expect(fired).toEqual([]);
    const job = runFrozen(FROZEN[0][1]);
    expect(job.first).toEqual([]);
    expect(job.later).toEqual([]);
  });

  for (const [name, base] of FROZEN) {
    it(`${name}: after clock 0 only the declared after() and holdFor chains of fired ids fire`, () => {
      const { first, later } = runFrozen(base);
      const fired = new Set<LineId>(first);
      for (const { id, clock } of later) {
        const cue = CUES.find((c) => c.id === id)!;
        const held = cue.holdFor !== undefined && clock >= cue.holdFor;
        const chained = (cue.follows ?? []).some((f) => fired.has(f));
        expect(held || chained, `${name}: ${id} at HUD clock ${clock}`).toBe(true);
        fired.add(id);
      }
      expect(new Set(later.map((l) => l.id)).size).toBe(later.length);
    });
  }

  it('the job card open holds every line back: the same view with the card closed fires C1.triage.01', () => {
    const open = FROZEN[0][1];
    expect(direct(NEW_DIRECTOR, { ...open, clock: 0 }).fired).toEqual([]);
    expect(direct(NEW_DIRECTOR, { ...open, cardClosed: true, clock: 0 }).fired).toContain('C1.triage.01');
  });
});

describe('teaching (b): every cue has its line row (learning-5)', () => {
  it('gives every CUES id a lineMeta row once, and the AWAITING lines no cue', () => {
    for (const c of CUES) expect(metaOf(c.id), c.id).not.toBeNull();
    const cued = new Set(CUES.map((c) => c.id));
    for (const id of AWAITING_ENG503) expect(cued.has(id), id).toBe(false);
    expect(cued.size).toBe(CUES.length);
  });
});

describe('teaching (c): the readouts print the crew words, never a debrief term (learning-5)', () => {
  it('the ROOM LEFT words over a sweep of demand and room hold no C8 term', () => {
    for (const wired of [0, 30, 60, 120, 180, 240]) {
      for (const demand of [0, 30, 90, 150, 250, 375]) {
        const label = headroomLabel(demand, wired);
        expect(termsIn(label), label).toEqual([]);
        expect(label).toMatch(/^ROOM LEFT/);
      }
    }
  });
});

describe('teaching (d): TRIAGE never answers (learning-5)', () => {
  const TRIAGE_C1: LineId[] = [
    'C1.triage.01',
    'C1.triage.02',
    'C1.triage.03',
    'C1.triage.04',
    'C1.triage.05',
  ];

  it('before the first wire, no fired C1 TRIAGE line says 30', () => {
    const fired: LineId[] = [];
    let s = NEW_DIRECTOR;
    for (let clock = 0; clock <= 120; clock += 0.5) {
      const v = cueView({ cardClosed: true, now: C.c1, capacity: 0, clock });
      const out = direct(s, v);
      s = out.state;
      fired.push(...out.fired);
    }
    const triage = fired.filter((id) => TRIAGE_C1.includes(id));
    expect(triage).toContain('C1.triage.01');
    for (const id of triage) expect(LINES[id].text, id).not.toMatch(/\b30\b/);
  });

  it('at the midnight forecast, no fired C6 TRIAGE line names three or four boxes', () => {
    let s = NEW_DIRECTOR;
    const fired: LineId[] = [];
    for (let clock = 0; clock <= 120; clock += 0.5) {
      const v = cueView({
        now: C.c6 + Math.min(clock, 50),
        cardClosed: true,
        rescued: true,
        rescueClock: 0,
        servers: 3,
        capacity: 180,
        demand: 120,
        dropped: 0,
        clock,
      });
      const out = direct(s, v);
      s = out.state;
      fired.push(...out.fired);
    }
    const triage = fired.filter((id) => id.startsWith('C6.triage.'));
    expect(triage).toContain('C6.triage.01');
    for (const id of triage) expect(LINES[id].text, id).not.toMatch(/\b(3|4|three|four)\b.*box/i);
  });
});

describe('teaching (e): the comms band rules (learning-5)', () => {
  const HINT: LineId = 'C1.triage.01';
  const LESSON = LESSON_IDS.find((id) => tagOf(id) === 'HINT') ?? LESSON_IDS[0];
  const WARNING = WARNING_IDS[0];

  it('dwells max(4, 1 + chars/cps + 1.5, voice + 0.6), with no upper clamp', () => {
    const rows: [LineId, number, number][] = [
      [HINT, 30, 0],
      [HINT, 5, 0],
      [HINT, 30, 9],
      ['C1.triage.02', 1000, 0],
    ];
    for (const [id, cps, voice] of rows) {
      const read = READ_LEAD + LINES[id].text.length / cps + READ_TAIL;
      expect(dwellFor(id, cps, voice), `${id} at ${cps} cps, voice ${voice}`).toBeCloseTo(
        Math.max(BARK_SECONDS, read, voice > 0 ? voice + VOICE_TAIL : 0),
      );
    }
    expect(dwellFor('C1.triage.02', 1000)).toBe(BARK_SECONDS);
    expect(dwellFor(HINT, 30, 9)).toBeGreaterThan(8);
  });

  it('a WARNING cuts a HINT that has shown 1.5 s, waits behind a younger one, and never cuts a lesson', () => {
    const shown = stepComms(enqueueComms(NO_COMMS, HINT, 0), 0, 30);
    expect(shown.current?.id).toBe(HINT);
    const early = enqueueComms(shown, WARNING, WARNING_PREEMPT_AFTER - 0.5);
    expect(early.current?.until).toBe(shown.current!.until);
    expect(early.queue[0].id).toBe(WARNING);
    const late = enqueueComms(shown, WARNING, WARNING_PREEMPT_AFTER);
    expect(late.current?.until).toBe(WARNING_PREEMPT_AFTER);
    const lesson = stepComms(enqueueComms(NO_COMMS, LESSON, 0), 0, 30);
    expect(isLesson(lesson.current!.id)).toBe(true);
    const kept = enqueueComms(lesson, WARNING, 3);
    expect(kept.current?.until).toBe(lesson.current!.until);
  });

  it('drops a stale HINT unshown, keeps LUX, WARNING and lesson lines however long they wait', () => {
    expect(staleAfter(HINT)).toBe(STALE_SECONDS);
    expect(staleAfter('C1.triage.02')).toBe(STALE_CHAINED_SECONDS);
    expect(staleAfter(WARNING)).toBeNull();
    expect(staleAfter(LESSON)).toBeNull();
    expect(staleAfter('C1.lux.01')).toBeNull();
    // A long lesson line ahead; the HINT waits past its stale time and is dropped, the WARNING is not.
    let s = stepComms(enqueueComms(NO_COMMS, LESSON, 0), 0, 30);
    s = enqueueComms(s, HINT, 0.1);
    s = enqueueComms(s, WARNING, 0.2);
    s = { ...s, current: { ...s.current!, until: STALE_SECONDS + 5, readUntil: STALE_SECONDS + 5 } };
    s = stepComms(s, STALE_SECONDS + 5, 30);
    expect(s.dropped).toContain(HINT);
    expect(s.current?.id).toBe(WARNING);
    expect(s.history).not.toContain(HINT);
  });

  it('keeps at most five waiting, dropping the oldest unprotected line', () => {
    let s = NO_COMMS;
    const hints = IDS.filter(
      (id) => LINES[id].kind === 'bark' && metaOf(id) !== null && tagOf(id) === 'HINT' && !isLesson(id),
    );
    for (let i = 0; i < COMMS_QUEUE_MAX + 2; i++) s = enqueueComms(s, hints[i], i * 0.1);
    expect(s.queue.length).toBe(COMMS_QUEUE_MAX);
    expect(s.queue.map((q) => q.id)).toEqual(hints.slice(2, COMMS_QUEUE_MAX + 2));
  });

  it('a lesson line mutes chat filler and reactions for 2 s from when it shows', () => {
    const rand = (): number => 0.5;
    const c0 = initialChat(0, rand);
    const inp = emptyChatInputs();
    inp.clock = 10;
    const after = stepChat(c0, inp, [{ kind: 'line', id: LESSON, lesson: true }], rand).state;
    expect(CHAT_PACE.lessonQuiet).toBe(2);
    expect(after.quietUntil).toBeCloseTo(10 + CHAT_PACE.lessonQuiet);
    expect(fillerAllowed({ ...after, nextFillerAt: 0 }, 11.9)).toBe(false);
    expect(fillerAllowed({ ...after, nextFillerAt: 0 }, 12)).toBe(true);
    // Another band line does not quiet it.
    const hint = stepChat(c0, inp, [{ kind: 'line', id: HINT, lesson: false }], rand).state;
    expect(hint.quietUntil).toBe(c0.quietUntil);
  });
});

describe('teaching (f): the room and gauge formulas (learning-5)', () => {
  it('headroomPct, load, segments and colour from demand and wired room', () => {
    const rows: [number, number, number | null, number, string][] = [
      // demand, wired, pct, lit, colour
      [30, 60, 50, 15, 'green'],
      [90, 120, 25, 8, 'amber'],
      [120, 120, 0, 0, 'amber'],
      [250, 120, -108, 0, 'red'],
      [0, 0, null, 0, 'green'],
    ];
    for (const [demand, wired, pct, lit, colour] of rows) {
      expect(headroomPct(demand, wired), `${demand} of ${wired}`).toBe(pct);
      expect(litSegments(demand, wired)).toBe(lit);
      expect(headroomColour(headroomLoad(demand, wired))).toBe(colour);
    }
    expect(headroomLoad(30, 0)).toBe(Infinity);
    expect(headroomLabel(90, 120)).toBe('ROOM LEFT 25% · 90 of 120');
  });

  it('the needle angle is linear over 0..400 and clamped to the arc', () => {
    expect(gaugeAngle(0)).toBeCloseTo(Math.PI);
    expect(gaugeAngle(GAUGE_MAX / 2)).toBeCloseTo(1.5 * Math.PI);
    expect(gaugeAngle(GAUGE_MAX)).toBeCloseTo(2 * Math.PI);
    expect(gaugeAngle(-50)).toBeCloseTo(Math.PI);
    expect(gaugeAngle(1000)).toBeCloseTo(2 * Math.PI);
    expect(gaugeAngle(100) - gaugeAngle(0)).toBeCloseTo(gaugeAngle(300) - gaugeAngle(200));
  });
});

describe('teaching (g): the chat picks its words from what the block feels (learning-5)', () => {
  it('chatSetFor: ok with nothing dropped, slow under half, down from half', () => {
    const rows: [number, string][] = [
      [0, 'ok'],
      [0.01, 'slow'],
      [0.49, 'slow'],
      [0.5, 'down'],
      [1, 'down'],
    ];
    for (const [share, set] of rows) expect(chatSetFor(share), String(share)).toBe(set);
  });

  it('filler waits 6 to 10 s between posts, from the seeded random alone', () => {
    expect(fillerDelay(() => 0)).toBe(FILLER_MIN_SECONDS);
    expect(fillerDelay(() => 0.999999)).toBeCloseTo(FILLER_MAX_SECONDS, 3);
    expect(fillerDelay(() => 0.5)).toBe(fillerDelay(() => 0.5));
  });
});

describe("teaching (h): Lux's face is a function of what she reads (learning-5)", () => {
  /** Step the cam over `seconds` of HUD clock with the same facts. */
  function hold(load: { demand: number; wired: number; errorShare?: number }, seconds: number) {
    let s = initialCam(0);
    const v = emptyCamView();
    v.demand = load.demand;
    v.wiredCapacity = load.wired;
    v.errorShare = load.errorShare ?? 0;
    v.now = 100;
    for (let c = 0; c <= seconds; c += 0.1) {
      v.clock = c;
      s = camStep(s, v);
    }
    return s;
  }

  it('calm with room to spare, tense near full, panicking when half is dropping', () => {
    expect(hold({ demand: 30, wired: 120 }, 5).mood).toBe('calm');
    expect(hold({ demand: 110, wired: 120 }, 5).mood).toBe('tense');
    expect(hold({ demand: 250, wired: 120, errorShare: 0.5 }, 5).mood).toBe('panicking');
  });

  it('is pure: the same state and view give the same step, and neither is changed', () => {
    const s = initialCam(0);
    const v = emptyCamView();
    v.clock = 3;
    v.demand = 110;
    v.wiredCapacity = 120;
    const sCopy = structuredClone(s);
    const vCopy = structuredClone(v);
    expect(camStep(s, v)).toEqual(camStep(s, v));
    expect(s).toEqual(sCopy);
    expect(v).toEqual(vCopy);
    // Held still, she holds still.
    expect(camStep(s, { ...v, paused: true })).toBe(s);
  });
});

describe('teaching (i): the what-if ghost shows the room a drop would add (learning-5)', () => {
  it('+60 for a box the gateway can feed, +0 with no free feed, x2 for the kit', () => {
    resetFrame();
    const r = newRun(1, null);
    r.now = C.c1;
    expect(ghostCapacity(r.session.board, BROWNOUT_RULES, [], 'server', SERVER_SLOTS[0])).toBe(
      BROWNOUT.server.capacity,
    );
    rackOne(r);
    const racked = r.session.board;
    const box = racked.parts.find((p) => p.kind === 'server')!;
    // The gateway feeds one part: a second box has nothing to wire it from.
    expect(ghostCapacity(racked, BROWNOUT_RULES, [], 'server', SERVER_SLOTS[1])).toBe(
      BROWNOUT.server.capacity,
    );
    expect(box.slot).not.toBeNull();
    expect(ghostCapacity(racked, BROWNOUT_RULES, [], 'overclock', box.slot!)).toBe(
      BROWNOUT.server.capacity * BROWNOUT.overclock.factor,
    );
  });
});

describe('teaching (j): the taught trace points each term back at a moment (learning-5)', () => {
  it('every lesson line that teaches maps its terms, once per line, at the clock it showed', () => {
    let trace: TaughtTrace = EMPTY_TRACE;
    let at = 0;
    for (const id of LESSON_IDS) {
      at += 10;
      trace = seeLine(trace, id, at, `23:${String(at).padStart(2, '0')}`);
    }
    const terms = termsSeen(trace);
    expect(terms.length).toBeGreaterThan(0);
    for (const term of terms) expect(TERM_KEYS).toContain(term);
    // Each line enters each term it teaches once, with the clock it showed at.
    expect(new Set(trace.map((e) => `${e.line} ${e.term}`)).size).toBe(trace.length);
    for (const e of trace) {
      expect(e.line).not.toBeNull();
      expect(TEACHES[e.line!] ?? metaOf(e.line!)?.teaches).toContain(e.term);
      expect(e.at).toBe((LESSON_IDS.indexOf(e.line!) + 1) * 10);
    }
    // Seeing a line again adds nothing.
    expect(seeLine(trace, LESSON_IDS[0], at + 100, '23:59')).toBe(trace);
  });
});

describe('the ?idle flag (learning-5)', () => {
  it('reads ?test&idle=<t> as the sim time the autopilot stops at, and nothing without ?test', () => {
    expect(idleFrom('?test&autopilot&idle=60')).toBe(60);
    expect(idleFrom('?test&idle')).toBe(0);
    expect(idleFrom('?test&idle=nope')).toBe(0);
    expect(idleFrom('?test&autopilot')).toBeNull();
    expect(idleFrom('?idle=60')).toBeNull();
    expect(idleAt(59.9, 60)).toBe(false);
    expect(idleAt(60, 60)).toBe(true);
    expect(idleAt(1e6, null)).toBe(false);
  });

  it('best play acts until the idle time and never after: the board stays as it was', () => {
    resetFrame();
    const r = newRun(1, null);
    r.now = C.c1;
    bestPlayUntil(r, C.c1 + 30);
    expect(r.session.board.parts.some((p) => p.kind === 'server')).toBe(true);
    // Past the idle time with the climb due (overclock before C3): nothing is done.
    r.now = C.c3 - 10;
    const before = r.session;
    bestPlayUntil(r, C.c1 + 30);
    expect(r.session).toBe(before);
    // Without the flag the same moment overclocks, as best play does; in node bestPlay is just that.
    bestPlay(r);
    expect(r.session.board.parts.some((p) => p.boost !== undefined)).toBe(true);
  });
});
