// The hover and pinned plates (board-8): a part's numbers and state in the crew's plain words, and
// a wire's. The fixed words come from src/scenes/hud/labels.ts (the one home of the Live screen's
// micro-copy); this module only puts the numbers in. The debrief's terms stay off them: no plate
// says what the debrief names (tests/board-plate.test.ts scans every plate). Pure: no Phaser.

import type { Part, PartKind } from '../../sim/board';
import { LABELS, diesIn } from '../hud/labels';
import type { PartLook, PartStatus } from './view';

/** What a part is called on its plate (LABELS.plates.names). */
export const PLATE_NAMES: Readonly<Record<PartKind, string>> = LABELS.plates.names;

/** The plate's words for how a part is doing, beside the tags it wears (LABELS.plates.state). */
export const PLATE_STATE = LABELS.plates.state;

/** The button on a dead box's pinned plate (LABELS.plates.replace). */
export const REPLACE_LABEL: string = LABELS.plates.replace;

const r = (n: number) => Math.round(n);

/** The first line: the part's name and its numbers, "SERVER · 45/60 req/s · 75%". */
function numbersLine(part: Pick<Part, 'kind'>, look: PartLook): string {
  const name = PLATE_NAMES[part.kind];
  if (look.capacity === null || look.share === null) {
    const what = part.kind === 'gateway' ? 'coming in' : 'passing through';
    return `${name} · ${r(look.load)} req/s ${what}`;
  }
  if (look.status !== 'online') return `${name} · capacity ${look.capacity} req/s when up`;
  return `${name} · ${r(look.load)}/${look.capacity} req/s · ${r(look.share * 100)}%`;
}

/** The second line: the state, in the tags' words with their seconds. */
function stateLine(look: PartLook, skipped: boolean): string {
  const tags = LABELS.partTags;
  switch (look.status) {
    case 'booting':
    case 'rebooting':
      return `${tags.booting} ${look.left.toFixed(1)} s`;
    case 'dark':
      return `${tags.dark} · ${PLATE_STATE.darkBack} ${Math.max(0, Math.ceil(look.left))} s`;
    case 'dead':
      return `DEAD · ${PLATE_STATE.dead}`;
    case 'offline':
      return PLATE_STATE.offline;
    case 'online':
      break;
  }
  if (skipped) return `${tags.skipped} · ${PLATE_STATE.skipped}`;
  if (look.diesIn !== null) return `${PLATE_STATE.over} · ${diesIn(look.diesIn)}`;
  if (look.unfed) return `${tags.unfed} · ${PLATE_STATE.unfed}`;
  return PLATE_STATE.online;
}

/** The third line: what the part is, from labels.ts. */
function aboutLine(part: Pick<Part, 'kind' | 'boost'>): string {
  const p = LABELS.plates;
  switch (part.kind) {
    case 'gateway':
      return p.gateway;
    case 'database':
      return p.database;
    case 'balancer':
      return p.splitter;
    case 'server':
      return part.boost !== undefined ? p.overclock : p.server;
  }
}

/** A part's plate: its numbers, its state and what it is, one per line. */
export function partPlate(part: Pick<Part, 'kind' | 'boost'>, look: PartLook, skipped: boolean): string {
  return `${numbersLine(part, look)}\n${stateLine(look, skipped)}\n${aboutLine(part)}`;
}

/**
 * The plate's text for one target, rebuilt only when something it shows changes: which part or
 * wire, its status, the whole req/s, the capacity, the whole percent, the tenth of a second left,
 * the whole DIES IN seconds, and the UNFED, SKIPPED and kit flags. Steady frames build no strings.
 */
export class PlateCache {
  text = '';
  /** The hover card for the same target, rebuilt with the text. */
  card: PlateCard | null = null;
  private target = '';
  private status: PartStatus | '' = '';
  private load = NaN;
  private capacity: number | null | undefined = undefined;
  private percent = NaN;
  private tenths = NaN;
  private dies = NaN;
  private flags = -1;

  /** Bring the text in line with a part's look; true when it changed. */
  part(id: string, part: Pick<Part, 'kind' | 'boost'>, look: PartLook, skipped: boolean): boolean {
    const load = r(look.load);
    const percent = look.share === null ? -1 : r(look.share * 100);
    const tenths = Math.round(look.left * 10);
    const dies = look.diesIn === null ? -1 : Math.ceil(look.diesIn);
    const flags = (look.unfed ? 1 : 0) | (skipped ? 2 : 0) | (part.boost !== undefined ? 4 : 0);
    if (
      id === this.target &&
      look.status === this.status &&
      load === this.load &&
      look.capacity === this.capacity &&
      percent === this.percent &&
      tenths === this.tenths &&
      dies === this.dies &&
      flags === this.flags
    ) {
      return false;
    }
    this.target = id;
    this.status = look.status;
    this.load = load;
    this.capacity = look.capacity;
    this.percent = percent;
    this.tenths = tenths;
    this.dies = dies;
    this.flags = flags;
    const text = partPlate(part, look, skipped);
    const card = partCard(part, look, skipped);
    const changed = text !== this.text || card.bar !== this.card?.bar;
    this.text = text;
    this.card = card;
    return changed;
  }

  /** Bring the text in line with a wire's; true when it changed. */
  wire(key: string, from: Pick<Part, 'kind'>, to: Pick<Part, 'kind'>, rate: number): boolean {
    const load = r(rate);
    if (key === this.target && this.status === '' && load === this.load) return false;
    this.target = key;
    this.status = '';
    this.load = load;
    const text = wirePlate(from, to, rate);
    const changed = text !== this.text;
    this.text = text;
    this.card = wireCard(from, to, rate);
    return changed;
  }

  /** Forget the target (the plate hid), so the next show rebuilds its text. */
  reset(): void {
    this.target = '';
    this.status = '';
    this.load = NaN;
  }
}

/** A wire's plate: what it carries, from where to where, and how to cut it. */
export function wirePlate(from: Pick<Part, 'kind'>, to: Pick<Part, 'kind'>, rate: number): string {
  return `WIRE · ${r(rate)} req/s\n${PLATE_NAMES[from.kind]} to ${PLATE_NAMES[to.kind]}\nclick it, then the cut button or Delete`;
}

// ---- the hover card (Rolando, 30 Oct 2026: "a better pop up", option A, the part card) ----------

/** How the card's chip and state line are coloured: fine, busy or waiting, in trouble, or off. */
export type CardTone = 'ok' | 'info' | 'warn' | 'bad' | 'idle';

/**
 * What the hover card shows, in reading order: the name and a state chip on the title bar, one big
 * number (with a smaller unit after it), the load bar while the part has a limit, the state in a
 * few words when it is not simply running, and one plain sentence of what the part does.
 */
export interface PlateCard {
  name: string;
  chip: string | null;
  tone: CardTone;
  big: string;
  unit: string;
  /** load ÷ capacity for the bar, or null for no bar. */
  bar: number | null;
  /** The state in words, or null when the chip says it all. */
  detail: string | null;
  about: string;
}

/** The part's sentence without its name in front (the title bar has it). */
function aboutText(part: Pick<Part, 'kind' | 'boost'>): string {
  const line = aboutLine(part);
  const prefix = `${PLATE_NAMES[part.kind]} · `;
  const rest = line.startsWith(prefix) ? line.slice(prefix.length) : line;
  // The plate's " · " fragments read as sentences on the card.
  const sentences = rest.split(' · ').map((t) => t.charAt(0).toUpperCase() + t.slice(1));
  return `${sentences.join('. ')}.`;
}

/** The chip and tone for a part's state. */
function chipOf(look: PartLook, skipped: boolean): { chip: string; tone: CardTone } {
  const c = LABELS.plates.chips;
  switch (look.status) {
    case 'booting':
    case 'rebooting':
      return { chip: c.booting, tone: 'info' };
    case 'dark':
      return { chip: c.dark, tone: 'bad' };
    case 'dead':
      return { chip: c.dead, tone: 'bad' };
    case 'offline':
      return { chip: c.off, tone: 'idle' };
    case 'online':
      break;
  }
  if (skipped) return { chip: c.skipped, tone: 'warn' };
  if (look.diesIn !== null) return { chip: c.over, tone: 'bad' };
  if (look.unfed) return { chip: c.unfed, tone: 'warn' };
  return { chip: c.running, tone: 'ok' };
}

/** A part's hover card. Pure; the plate text (partPlate) stays the hook's record of the same facts. */
export function partCard(part: Pick<Part, 'kind' | 'boost'>, look: PartLook, skipped: boolean): PlateCard {
  const { chip, tone } = chipOf(look, skipped);
  const running = look.status === 'online';
  let big: string;
  let unit: string;
  let bar: number | null = null;
  if (look.capacity === null || look.share === null) {
    big = `${r(look.load)}`;
    unit = `req/s ${part.kind === 'gateway' ? 'coming in' : 'passing through'}`;
  } else if (!running) {
    big = `${look.capacity}`;
    unit = 'req/s capacity when up';
  } else {
    big = `${r(look.load)}`;
    unit = `of ${look.capacity} req/s · ${r(look.share * 100)}%`;
    bar = look.share;
  }
  const plain = running && tone === 'ok';
  return {
    name: PLATE_NAMES[part.kind],
    chip,
    tone,
    big,
    unit,
    bar,
    detail: plain ? null : stateLine(look, skipped),
    about: aboutText(part),
  };
}

/** A wire's hover card: what it carries, from where to where, and how to cut it. */
export function wireCard(from: Pick<Part, 'kind'>, to: Pick<Part, 'kind'>, rate: number): PlateCard {
  return {
    name: 'WIRE',
    chip: null,
    tone: 'ok',
    big: `${r(rate)}`,
    unit: 'req/s',
    bar: null,
    detail: `${PLATE_NAMES[from.kind]} to ${PLATE_NAMES[to.kind]}`,
    about: 'click it, then the cut button or Delete',
  };
}

/** The bar's colour band: cyan with room, amber from 85%, red over 100%. */
export function cardBarTone(share: number): CardTone {
  if (share > 1) return 'bad';
  if (share >= 0.85) return 'warn';
  return 'info';
}
