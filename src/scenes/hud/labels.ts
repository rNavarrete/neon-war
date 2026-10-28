// The Live screen's micro-copy: titles, tags, key caps, card names and plates, in the crew's plain
// words. These are not lines (nobody says them), so they stay out of LINES and docs/SCRIPT.md; every
// lane that prints a label takes it from here. The real names (the debrief's C8 terms) wait for the
// debrief: tests/teaching.test.ts scans every label below for them. Pure: strings and formatters.
//
// Wording is a draft waiting on the owner's ear (decision D8).

import { BROWNOUT } from '../../sim/brownout';

/** Fixed labels, by the zone that prints them. */
export const LABELS = {
  title: {
    /** The stream's live dot, and its two quiet states. */
    live: 'LIVE',
    waiting: 'WAITING',
    held: 'HELD',
    /** Beside the small viewer number (hud.audience.watching). */
    watching: 'WATCHING',
    trust: 'TRUST',
    credits: 'CREDITS',
  },
  alert: {
    /** The district surge's tag well; the headline is the number and the cause. */
    raidTag: 'RAID',
  },
  gauge: {
    /** The gauge's title: how many calls a second are coming in. */
    title: 'COMING /s',
    /** The cyan band: what the wired boxes can take. */
    room: 'ROOM',
    noRoom: 'NO ROOM YET',
    overBy: 'OVER BY',
    noBox: 'no box yet',
  },
  scope: {
    title: 'LAST 60 s',
    coming: 'coming',
    room: 'room',
    racked: 'racked, not fed',
    guess: 'your guess',
    boxes: 'your boxes',
    ahead: 'ahead',
  },
  deck: {
    /** The bar of room left over the wired boxes. */
    title: 'ROOM LEFT',
    noBox: 'NO BOX',
    keys: { one: '1 REGROUP', two: '2 CUT 3F', three: '3 SET' },
  },
  dial: {
    /** Under the dial card once the first box is wired: the guess was never graded. */
    free: 'your guess stays free',
    set: 'SET',
  },
  inventory: {
    server: 'SERVER',
    overclock: 'OVERCLOCK',
    /** The crew's gift: the card keeps its code id, the screen says what it does. */
    splitter: 'SPLITTER (crew gift)',
    gift: 'GIFT',
    /** The padlocked drawer of later nights' parts, drawn without their names. */
    drawer: 'LOCKED · 20 PARTS',
    splitterLocked: "the crew hasn't given you one of those",
  },
  map: {
    /** The city map's title, Lux's building and the cut-off neighbours' tag. */
    title: 'CITY GRID',
    lux: 'LUX',
    cutOff: 'CUT OFF',
  },
  comms: {
    /** The comms band's title, and the glyph that asks for a line's voice again. */
    title: 'COMMS',
    replay: '\u21bb',
  },
  /** The tags a part wears on the feed. */
  partTags: {
    unfed: 'UNFED',
    booting: 'BOOTING',
    skipped: 'SKIPPED',
    dark: 'DARK',
    diesIn: 'DIES IN',
    /** A server that burned out and waits to be replaced. */
    dead: 'DEAD',
  },
  /** The plain-words plate shown when hovering a part. */
  plates: {
    gateway: 'GATEWAY · every call from the block comes in here · feeds one part',
    database: `DATABASE · where every call ends up · takes ${BROWNOUT.database.capacity} a second`,
    server: `SERVER · answers ${BROWNOUT.server.capacity} a second · ${BROWNOUT.server.cost} cr · boots ${BROWNOUT.server.bootSeconds} s`,
    overclock: `OVERCLOCK · makes one box answer ${BROWNOUT.overclock.factor} times as many · ${BROWNOUT.overclock.cost} cr · reboots ${BROWNOUT.overclock.rebootSeconds} s`,
    splitter: 'SPLITTER · shares the calls across every box wired behind it, and passes over a dark one',
    nothingFeeds: 'nothing feeds it',
    /** Each part's name on the first line of its plate, by part kind (the balancer is the splitter). */
    names: { gateway: 'GATEWAY', balancer: 'SPLITTER', server: 'SERVER', database: 'DATABASE' },
    /** The plate's words for how a part is doing, beside the tags it wears. */
    state: {
      online: 'running',
      over: 'more coming in than it answers',
      unfed: 'nothing feeds it',
      skipped: 'the splitter passes it over',
      darkBack: 'power back in',
      dead: 'drop a SERVER card on it or press REPLACE',
      offline: 'off',
    },
    /** The button on a dead box's pinned plate. */
    replace: 'REPLACE',
  },
  /** LIVE CHAT's header: its title and the tag a click on it toggles. */
  chat: {
    title: 'LIVE CHAT',
    both: 'BLOCK + STREAM',
    blockOnly: 'BLOCK ONLY',
  },
} as const;

/** The gauge's sub-line under the big number: the room wired in, or what is dropping. */
export function gaugeSubLine(room: number, dropping: number): string {
  if (room <= 0) return LABELS.gauge.noBox;
  if (dropping > 0.5) return `dropping ${Math.round(dropping)}/s`;
  return `room ${Math.round(room)}/s`;
}

/** The gauge's over-the-room line, or null while the room covers what is coming. */
export function overBy(coming: number, room: number): string | null {
  const over = Math.round(coming - room);
  return over > 0 ? `${LABELS.gauge.overBy} ${over}/s` : null;
}

/**
 * The deck bar's label with the absolute numbers, so the fill and the words agree:
 * "ROOM LEFT 25% · 90 of 120", "OVER +130/s" once past full, "NO BOX" with nothing wired.
 */
export function roomLeftLabel(coming: number, room: number): string {
  if (room <= 0) return LABELS.deck.noBox;
  const over = Math.round(coming - room);
  if (over > 0) return `OVER +${over}/s`;
  const pct = Math.round(Math.max(0, 1 - coming / room) * 100);
  return `${LABELS.deck.title} ${pct}% · ${Math.round(coming)} of ${Math.round(room)}`;
}

/** The what-if plate while a box is dragged over a pad: what it would add, or why it adds nothing. */
export function ghostPlate(addsRoom: number, bootSeconds: number, cost: number): string {
  if (addsRoom <= 0) return `+0 room · ${LABELS.plates.nothingFeeds}`;
  return `+${Math.round(addsRoom)} room · boots ${bootSeconds} s · -${cost} cr`;
}

/** A part's DIES IN tag with its seconds left. */
export function diesIn(seconds: number): string {
  return `${LABELS.partTags.diesIn} ${Math.max(0, Math.ceil(seconds))} s`;
}

/** Every label string in LABELS, flattened (tests scan them for the debrief's terms). */
export function allLabels(): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(LABELS);
  return out;
}
