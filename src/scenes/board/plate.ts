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

/** The first line: the part's name and its numbers, "SERVER · 45/60 a second · 75%". */
function numbersLine(part: Pick<Part, 'kind'>, look: PartLook): string {
  const name = PLATE_NAMES[part.kind];
  if (look.capacity === null || look.share === null) {
    const what = part.kind === 'gateway' ? 'coming in' : 'passing through';
    return `${name} · ${r(look.load)} a second ${what}`;
  }
  if (look.status !== 'online') return `${name} · answers ${look.capacity} a second when up`;
  return `${name} · ${r(look.load)}/${look.capacity} a second · ${r(look.share * 100)}%`;
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
    const changed = text !== this.text;
    this.text = text;
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
  return `WIRE · ${r(rate)} a second\n${PLATE_NAMES[from.kind]} to ${PLATE_NAMES[to.kind]}\nclick it, then the cut button or Delete`;
}
