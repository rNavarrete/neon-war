// The Live screen's micro-copy: titles, tags, key caps, card names and plates. These are not lines
// (nobody says them), so they stay out of LINES and docs/SCRIPT.md; every lane that prints a label
// takes it from here. Pure: strings and formatters.
//
// Real system-design terms, always (Rolando, 29 Oct 2026: "this is a game that is meant for people to
// learn system design, so we need to keep all the terminology and system design jargon intact"):
// LOAD BALANCER, SERVER, CAPACITY, HEADROOM, DEMAND, req/s, scale up. tests/teaching.test.ts pins them.

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
    /** The gauge's title: demand, in requests per second. */
    title: 'DEMAND req/s',
    /** The cyan band: the capacity the wired servers serve. */
    room: 'CAPACITY',
    noRoom: 'NO CAPACITY YET',
    overBy: 'OVER BY',
    noBox: 'no server yet',
  },
  scope: {
    title: 'LAST 60 s',
    coming: 'demand',
    room: 'capacity',
    racked: 'racked, not fed',
    ahead: 'ahead',
  },
  deck: {
    /** The bar of headroom left over the wired servers' capacity. */
    title: 'HEADROOM',
    noBox: 'NO SERVER',
    keys: { one: '1 REGROUP', two: '2 CUT 3F' },
  },
  inventory: {
    server: 'SERVER',
    /** Scale up (vertical scaling): swap one server for a bigger one (Rolando, 29 Oct 2026: no overclocking). */
    overclock: 'SCALE UP',
    /** The crew's gift. */
    splitter: 'LOAD BALANCER (crew gift)',
    gift: 'GIFT',
    /** The padlocked drawer of later nights' parts, drawn without their names. */
    drawer: 'LOCKED · 20 PARTS',
    splitterLocked: "the crew hasn't given you a load balancer yet",
  },
  board: {
    /** The table's power bands, labelled along its far edge ("RACK A" to "RACK D"). */
    rack: 'RACK',
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
    gateway: 'GATEWAY · every request from the block comes in here · feeds one part',
    database: `DATABASE · where every request ends up · capacity ${BROWNOUT.database.capacity} req/s`,
    server: `SERVER · capacity ${BROWNOUT.server.capacity} req/s · ${BROWNOUT.server.cost} cr · boots ${BROWNOUT.server.bootSeconds} s`,
    overclock: `SCALE UP · vertical scaling: swaps one server for one with ${BROWNOUT.overclock.factor}x the capacity · ${BROWNOUT.overclock.cost} cr · down ${BROWNOUT.overclock.rebootSeconds} s while it swaps`,
    splitter:
      'LOAD BALANCER · spreads requests across every server wired behind it; its health check skips a dark one',
    nothingFeeds: 'nothing feeds it',
    /** Each part's name on the first line of its plate, by part kind. */
    names: { gateway: 'GATEWAY', balancer: 'LOAD BALANCER', server: 'SERVER', database: 'DATABASE' },
    /** The plate's words for how a part is doing, beside the tags it wears. */
    state: {
      online: 'running',
      over: 'more coming in than it answers',
      unfed: 'nothing feeds it',
      skipped: 'the load balancer skips it (health check)',
      darkBack: 'power back in',
      dead: 'drop a SERVER card on it or press REPLACE',
      offline: 'off',
    },
    /** The coloured chip on the hover card's title bar, by how the part is doing. */
    chips: {
      running: 'RUNNING',
      booting: 'BOOTING',
      dark: 'DARK',
      dead: 'DEAD',
      off: 'OFF',
      skipped: 'SKIPPED',
      over: 'TOO MUCH',
      unfed: 'UNFED',
    },
    /** The button on a dead server's pinned plate. */
    replace: 'REPLACE',
  },
  /** LIVE CHAT's header: its title and the tag a click on it toggles. */
  chat: {
    title: 'LIVE CHAT',
    both: 'BLOCK + STREAM',
    blockOnly: 'BLOCK ONLY',
  },
} as const;

/** The gauge's sub-line under the big number: the capacity wired in, or what is dropping. */
export function gaugeSubLine(room: number, dropping: number): string {
  if (room <= 0) return LABELS.gauge.noBox;
  if (dropping > 0.5) return `dropping ${Math.round(dropping)} req/s`;
  return `capacity ${Math.round(room)} req/s`;
}

/** The gauge's over-the-room line, or null while the room covers what is coming. */
export function overBy(coming: number, room: number): string | null {
  const over = Math.round(coming - room);
  return over > 0 ? `${LABELS.gauge.overBy} ${over}/s` : null;
}

/**
 * The deck bar's label with the absolute numbers, so the fill and the words agree:
 * "HEADROOM 25% · 90 of 120", "OVER +130 req/s" once past full, "NO SERVER" with nothing wired.
 */
export function roomLeftLabel(coming: number, room: number): string {
  if (room <= 0) return LABELS.deck.noBox;
  const over = Math.round(coming - room);
  if (over > 0) return `OVER +${over} req/s`;
  const pct = Math.round(Math.max(0, 1 - coming / room) * 100);
  return `${LABELS.deck.title} ${pct}% · ${Math.round(coming)} of ${Math.round(room)}`;
}

/** The what-if plate while a server is dragged over a pad: the capacity it would add, or why none. */
export function ghostPlate(addsRoom: number, bootSeconds: number, cost: number): string {
  if (addsRoom <= 0) return `+0 capacity · ${LABELS.plates.nothingFeeds}`;
  return `+${Math.round(addsRoom)} capacity · boots ${bootSeconds} s · -${cost} cr`;
}

/** A part's DIES IN tag with its seconds left. */
export function diesIn(seconds: number): string {
  return `${LABELS.partTags.diesIn} ${Math.max(0, Math.ceil(seconds))} s`;
}

/** Every label string in LABELS, flattened (tests scan them for the real terms). */
export function allLabels(): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(LABELS);
  return out;
}
