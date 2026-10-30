// Where the picked board painting (board/table-plate, Rolando's pick 30 Oct 2026: table D, the
// table standing on Lux's wet rooftop, painted from a steeper, more top-down camera, with a thin
// strip of skyline at the top) draws in the feed's own space, and where its plain glass lands.
// Pure: no Phaser. cells.ts draws the grid on the glass; BoardScene draws the plate here.

import { FEED_SHOWN } from '../live/layout';

export interface GlassPt {
  readonly x: number;
  readonly y: number;
}

/**
 * The painting's file (1536 x 1024, the whole scene) and its glass's corners in file pixels, the
 * corners of lines fitted to the glass's edges: far-left, far-right, near-right, near-left.
 */
export const TABLE_ART = {
  w: 1536,
  h: 1024,
  glass: [
    { x: 289, y: 300 },
    { x: 1244, y: 300 },
    { x: 1382, y: 809 },
    { x: 155, y: 820 },
  ],
} as const;

/**
 * Where a plate of size `cut` draws: covering everything the feed's camera shows (the scene is the
 * whole feed, so no empty sky shows), centred, its foot on the feed's floor, and never above its
 * file's size.
 */
export function platePlace(cut: { readonly w: number; readonly h: number }): {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
} {
  const scale = Math.min(1, Math.max(FEED_SHOWN.w / cut.w, FEED_SHOWN.h / cut.h));
  const w = cut.w * scale;
  const h = cut.h * scale;
  return { x: FEED_SHOWN.x + (FEED_SHOWN.w - w) / 2, y: FEED_SHOWN.y + FEED_SHOWN.h - h, w, h, scale };
}

/** Where the table's plate draws in the feed's space. */
export const TABLE_PLACE = platePlace(TABLE_ART);

/** The glass's corners in the feed's space: far-left, far-right, near-right, near-left. */
export const GLASS: readonly [GlassPt, GlassPt, GlassPt, GlassPt] = TABLE_ART.glass.map((p) => ({
  x: TABLE_PLACE.x + p.x * TABLE_PLACE.scale,
  y: TABLE_PLACE.y + p.y * TABLE_PLACE.scale,
})) as unknown as [GlassPt, GlassPt, GlassPt, GlassPt];
