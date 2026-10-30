// Where story-scene characters stand, the way visual novels stage them (Ren'Py's positions, dating sims,
// Persona, Fire Emblem): a few fixed slots that depend on how many people are on screen, everyone
// standing on the bottom of the frame behind the text box so the box hides where the art is cut,
// and big enough that the face reads. Pure: the VnView places its images from these numbers.

/** Top edge of the text box (game pixels); art standing behind it is cut off here. */
export const BOX_TOP = 880;
/** How tall a full sprite (cut at the waist or thighs) is drawn: its head in the upper sixth of the frame. */
export const SPRITE_H = 900;
/** Art at least this tall is a full sprite and stands on the bottom edge; shorter art is a bust. */
const SPRITE_MIN = 700;
/** How far a bust sinks behind the text box, so its cut edge never shows. */
const BUST_SINK = 60;
/** A bust's scale when not speaking: the speaker's 3% step forward then lands on its own size, never above. */
const BUST_SCALE = 0.97;

/**
 * Slot centres, left to right, for 1 to 5 people. Alone: on the left third line, the way a single
 * sprite is framed off centre, clear of the window and of the stream chat in the top-right corner.
 * Two face each other across the middle; more spread out under the chat panel's left edge.
 */
const SLOTS: readonly (readonly number[])[] = [
  [],
  [620],
  [560, 1260],
  [440, 900, 1360],
  [360, 760, 1160, 1520],
  [300, 620, 940, 1260, 1560],
];

/** The x of each of `count` people on stage, left to right. */
export function slotsFor(count: number): readonly number[] {
  if (count <= 0) return [];
  if (count < SLOTS.length) return SLOTS[count]!;
  const step = 1260 / (count - 1);
  return Array.from({ length: count }, (_, i) => 300 + i * step);
}

/**
 * How art `h` pixels tall stands at slot `x`: its bottom centre and its scale. A full sprite is scaled
 * down to SPRITE_H (never up) and stands on the bottom edge; a bust is drawn near its own size with
 * its cut edge just behind the text box.
 */
export function frameFor(h: number, x: number, frameH: number): { x: number; bottom: number; scale: number } {
  if (h >= SPRITE_MIN) return { x, bottom: frameH, scale: Math.min(1, SPRITE_H / h) };
  return { x, bottom: BOX_TOP + BUST_SINK, scale: BUST_SCALE };
}

/**
 * Characters that fly rather than stand: TRIAGE, Lux's camera drone. A whole drone sunk behind the
 * text box loses half of itself, so a flyer takes no slot and hovers beside the first person's
 * shoulder (companions in visual novels and Persona float at head height next to their partner),
 * bobbing gently; alone, it hovers on the left third like anyone else.
 */
export const HOVERING: ReadonlySet<string> = new Set(['TRIAGE']);
/** A flyer's bottom edge: its body at the standing characters' shoulder height, well above the box. */
export const HOVER_BOTTOM = 720;
/** How far right of the first person's slot a flyer hovers. */
const HOVER_OFFSET = 430;
/** The bob: amplitude in px and period in seconds. */
export const HOVER_BOB = { amp: 5, period: 2.4 } as const;

/** Where a flyer hovers, given the slots of the people standing (left to right). Pure. */
export function hoverFor(standing: readonly number[]): { x: number; bottom: number; scale: number } {
  const x = standing.length > 0 ? standing[0]! + HOVER_OFFSET : SLOTS[1]![0]!;
  return { x, bottom: HOVER_BOTTOM, scale: BUST_SCALE };
}

/** The bob's offset in px at `t` seconds. Pure. */
export function bobAt(t: number): number {
  return Math.sin((t / HOVER_BOB.period) * Math.PI * 2) * HOVER_BOB.amp;
}
