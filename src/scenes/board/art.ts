// The board's picked Live-screen art (board-12): which art key each part state, the table, the
// channel and the inventory draw, and where the table plate and the channel plate sit. Every key
// resolves through resolveArt in src/scenes/plates.ts, so a key that is not picked draws its
// fallback (a picked file with a tint, or a baked plate). Pure: no Phaser, so it is tested in node.
//
// Nothing here upscales: each plate is drawn at most at its file's real size (the manifest's cut),
// smaller when its display box is smaller.

import type { Part } from '../../sim/board';
import { type Size, artRequest } from '../../game/artManifest';
import { BOARD_AREA, CHANNEL, TABLE, TABLE_FACE } from './layout';
import type { PartStatus } from './view';

/** The table under the rack: the empty plate (pads are still drawn in code). */
export const TABLE_PLATE_KEY = 'board/table-plate';
/** The trough the block's traffic comes in along, at the feed's left edge. */
export const CHANNEL_PLATE_KEY = 'board/channel-plate';
/**
 * The table after midnight (batch 5): the day plate's silkscreen dimmed and its rim cold, 1061 x
 * 416 against the day plate's 1228 x 416. Drawn at its own size, centred like the day plate, and
 * faded in over it once the clock strikes midnight.
 */
export const TABLE_MIDNIGHT_KEY = 'board/table-plate-midnight';
/** The painted packet cube (batch 5): the feed's traffic, untinted, and red by tint where it drops. */
export const PACKET_CUBE_KEY = 'board/packet-cube';

/** The part-state art: unlit servers, the boot lamp frames and the balancer's ping lamp frames. */
export const PART_ART = {
  serverDark: 'board/server-dark',
  overclockedDark: 'board/server-overclocked-dark',
  bootA: 'board/server-booting-a',
  bootB: 'board/server-booting-b',
  pingA: 'board/balancer-ping-a',
  pingB: 'board/balancer-ping-b',
} as const;

/** The inventory card frames (nine-sliced at k 0.5), the count badge, and the feed's two marks. */
export const CARD_FRAME = {
  idle: 'hud/live/card-frame-idle',
  ready: 'hud/live/card-frame-ready',
  locked: 'hud/live/card-frame-locked',
} as const;
export const COUNT_BADGE_KEY = 'hud/live/count-badge';
export const PING_ICON_KEY = 'hud/icons/ping';
export const SKIPPED_ICON_KEY = 'hud/icons/skipped';

/** Every key the board resolves through the art manifest, in the order it preloads them. */
export const BOARD_ART_KEYS: readonly string[] = [
  TABLE_PLATE_KEY,
  TABLE_MIDNIGHT_KEY,
  CHANNEL_PLATE_KEY,
  PACKET_CUBE_KEY,
  ...Object.values(PART_ART),
  ...Object.values(CARD_FRAME),
  COUNT_BADGE_KEY,
  PING_ICON_KEY,
  SKIPPED_ICON_KEY,
];

/** Whether a key is one of the part-state keys, so the board draws it through the manifest. */
export function isPartArtKey(key: string): boolean {
  return (
    key === PART_ART.serverDark ||
    key === PART_ART.overclockedDark ||
    key === PART_ART.bootA ||
    key === PART_ART.bootB ||
    key === PART_ART.pingA ||
    key === PART_ART.pingB
  );
}

/** How often the boot lamp frame changes: A and B swap 4 times a second. */
export const BOOT_FRAME_HZ = 4;

/**
 * The boot lamp frame `t` seconds in: A and B swap BOOT_FRAME_HZ times a second; under reduce
 * flicker it holds on A and never alternates.
 */
export function bootFrameKey(t: number, calm: boolean): string {
  if (calm) return PART_ART.bootA;
  return Math.floor(t * BOOT_FRAME_HZ) % 2 === 0 ? PART_ART.bootA : PART_ART.bootB;
}

/** How long one health-check ping takes (anim.ts PING_MS): the lamp lights for its first half. */
export const PING_LAMP_SECONDS = 1;

/**
 * The balancer's lamp frame `t` seconds in while it pings its boxes: lit (B) for the first half of
 * each ping, off (A) for the rest; under reduce flicker it holds lit and never alternates.
 */
export function pingLampKey(t: number, calm: boolean): string {
  if (calm) return PART_ART.pingB;
  const phase = (t / PING_LAMP_SECONDS) % 1;
  return phase < 0.5 ? PART_ART.pingB : PART_ART.pingA;
}

/** What the board knows this frame that picks a part's state art. */
export interface PartArtOptions {
  /** Real seconds (the board clock), for the lamp frames. */
  readonly t: number;
  /** settings().reduceFlicker: the lamp frames hold still. */
  readonly calm: boolean;
  /** The balancer has a wire to a box, so it pings down it. */
  readonly pinging: boolean;
  /** The keys whose picked file is loaded; a state whose key is not in it keeps today's art. */
  readonly picked: ReadonlySet<string>;
}

/**
 * The art a part's state draws, given the art partLook picks today (`legacy`): a server that is
 * dark in a dip, or an overclocked one rebooting, is the unlit server (the kit-fitted one when
 * boosted); a booting server shows its boot lamp frames; a balancer that pings shows its lamp
 * frames. Everything else, and any state whose key is not picked (`o.picked`), keeps `legacy`:
 * the board then draws today's art, darkened in code. Pure.
 */
export function stateArt(
  part: Pick<Part, 'kind' | 'boost'>,
  status: PartStatus,
  legacy: string,
  o: PartArtOptions,
): string {
  let key: string | null = null;
  if (part.kind === 'server') {
    const boosted = part.boost !== undefined;
    if (status === 'dark') key = boosted ? PART_ART.overclockedDark : PART_ART.serverDark;
    else if (status === 'rebooting') key = PART_ART.overclockedDark;
    else if (status === 'booting') key = boosted ? PART_ART.overclockedDark : bootFrameKey(o.t, o.calm);
  } else if (part.kind === 'balancer' && o.pinging) {
    key = pingLampKey(o.t, o.calm);
  }
  return key !== null && o.picked.has(key) ? key : legacy;
}

/** A plate placed in game pixels: its top-left, drawn size and scale (always <= 1). */
export interface PlatePlace {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly scale: number;
}

/** The table's code trapezoid: its far edge, near edge and lit face, in game pixels. */
export const TABLE_TRAPEZOID = {
  top: TABLE.far.y,
  bottom: TABLE.near.y + TABLE_FACE,
  left: TABLE.near.left,
  right: TABLE.near.right,
} as const;

/**
 * Where the painted table plate draws for a file of size `cut`. Its display is the trapezoid's
 * 1441 x 408 box (top and face), but a plate is never drawn larger than its file: the scale is the
 * smaller of 1 and what fits the box, so a 1228 x 416 file draws at 1228 x 416 scaled to fit the
 * feed. It is centred on the table's centre line, and its foot sits on the feed's floor (never
 * lower than BOARD_AREA.bottom), so its far rim lines up with the trapezoid's far edge. Pure.
 */
export function tablePlatePlace(cut: Size): PlatePlace {
  const boxW = TABLE_TRAPEZOID.right - TABLE_TRAPEZOID.left;
  const roomH = BOARD_AREA.bottom - TABLE_TRAPEZOID.top;
  const scale = Math.min(1, boxW / cut.w, roomH / cut.h);
  const w = cut.w * scale;
  const h = cut.h * scale;
  const cx = (TABLE_TRAPEZOID.left + TABLE_TRAPEZOID.right) / 2;
  const bottom = BOARD_AREA.bottom;
  return { x: cx - w / 2, y: bottom - h, w, h, scale };
}

/**
 * Where the channel plate draws for a file of size `cut`: inside its 150 x 200 display box (never
 * larger than the file), its left edge on the channel's mouth and centred on the mouth's height.
 */
export function channelPlatePlace(cut: Size): PlatePlace {
  const display = artRequest(CHANNEL_PLATE_KEY)?.display ?? { w: 150, h: 200 };
  const scale = Math.min(1, display.w / cut.w, display.h / cut.h);
  const w = cut.w * scale;
  const h = cut.h * scale;
  const cy = (CHANNEL.mouth.top + CHANNEL.mouth.bottom) / 2;
  return { x: CHANNEL.mouth.x, y: cy - h / 2, w, h, scale };
}

/** Which frame an inventory card wears: locked (padlocked), idle (none to use now) or ready. */
export function cardFrameKey(locked: boolean, count: number): string {
  if (locked) return CARD_FRAME.locked;
  return count > 0 ? CARD_FRAME.ready : CARD_FRAME.idle;
}

/** The nine-slice corner scale every card frame draws at (docs/ART-REQUESTS.md, k 0.5). */
export const CARD_FRAME_K = 0.5;
/** The corner every card frame is sliced at, in file pixels (drawn at CARD_FRAME_K of it). */
export const CARD_FRAME_SLICE = 32;

/**
 * The count badge's scale: inside its 40 x 28 display box and never above 1, keeping the file's
 * shape (a 49 x 56 badge draws 24.5 x 28).
 */
export function badgeScale(cut: Size): number {
  const display = artRequest(COUNT_BADGE_KEY)?.display ?? { w: 40, h: 28 };
  return Math.min(1, display.w / cut.w, display.h / cut.h);
}

/** How long the midnight plate takes to fade in over the day plate, in board seconds (instant when calm). */
export const MIDNIGHT_PLATE_FADE = 2;

/** The midnight plate's alpha `t` seconds after midnight struck: 0 before, 1 once faded in. Pure. */
export function midnightPlateAlpha(t: number | null, calm: boolean): number {
  if (t === null || t < 0) return 0;
  if (calm) return 1;
  return Math.min(1, t / MIDNIGHT_PLATE_FADE);
}

/**
 * The packet cube's scale: inside its 24 x 18 display box and never above 1, keeping the file's
 * shape (the 59 x 48 cube draws about 22 x 18).
 */
export function packetScale(cut: Size): number {
  const display = artRequest(PACKET_CUBE_KEY)?.display ?? { w: 24, h: 18 };
  return Math.min(1, display.w / cut.w, display.h / cut.h);
}

/** A square mark's scale to draw `px` wide (or tall, the larger side), never above 1. */
export function markScale(cut: Size, px: number): number {
  return Math.min(1, px / Math.max(cut.w, cut.h));
}
