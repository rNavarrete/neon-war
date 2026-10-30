import { artRequest } from '../src/game/artManifest';
import {
  CHAT_PLATE_BAND,
  CHAT_PLATE_K,
  CHAT_PLATE_SLICE,
  CHAT_PLATE_WIDE,
  SYSTEM_GLYPH,
  SYSTEM_GLYPH_SIZE,
  chatHeaderLayout,
  systemGlyphSize,
  nineSliceScales,
} from '../src/scenes/hud/ChatFeedView';
import { CHAT_BODY, CHAT_HEADER, ROW_AVATAR } from '../src/scenes/hud/chat';
import { BLOCK_AVATARS, STREAM_AVATARS } from '../src/scenes/avatars';

// chat-6 with the picks landed: every painted piece draws at its display size or smaller than its
// file, and the wide plate's nine-slice keeps its header band inside the header strip.

describe('the landed chat art draws at display size, never upscaled (chat-6)', () => {
  const plate = artRequest(CHAT_PLATE_WIDE)!;

  // The plate was requested for the 385x275 chat zone. The layout A column (465x750, Rolando 30 Oct
  // 2026) is too tall for it, so the column draws the code glass (hud-chat.test.ts); where the plate
  // does draw, it is at that request size.
  const PAINTED = { w: 385, h: 275 };
  it('nine-slices the 770x485 wide plate into the 385x275 zone with every region scaled down', () => {
    expect(plate.cut).toEqual({ w: 770, h: 485 });
    expect(plate.display).toEqual(PAINTED);
    const s = nineSliceScales(plate.cut!, PAINTED, CHAT_PLATE_K, CHAT_PLATE_SLICE);
    for (const [part, v] of Object.entries(s)) {
      expect(v, part).toBeGreaterThan(0);
      expect(v, part).toBeLessThanOrEqual(1);
    }
    // The corners never show bigger than the plain glass beside them.
    expect(s.corner).toBeLessThanOrEqual(Math.min(s.midX, s.midY));
    const [l, r, t, b] = CHAT_PLATE_SLICE;
    expect(l + r).toBeLessThan(plate.cut!.w);
    expect(t + b).toBeLessThan(plate.cut!.h);
    expect((l + r) * CHAT_PLATE_K).toBeLessThan(PAINTED.w);
    expect((t + b) * CHAT_PLATE_K).toBeLessThan(PAINTED.h);
  });

  it('keeps the painted header band unstretched inside the 40 px header strip, above the rows', () => {
    const [, , t] = CHAT_PLATE_SLICE;
    expect(CHAT_PLATE_BAND.bottom).toBeLessThanOrEqual(t);
    const top = CHAT_HEADER.y + CHAT_PLATE_BAND.top * CHAT_PLATE_K;
    const bottom = CHAT_HEADER.y + CHAT_PLATE_BAND.bottom * CHAT_PLATE_K;
    expect(top).toBeGreaterThanOrEqual(CHAT_HEADER.y);
    expect(bottom).toBeLessThanOrEqual(CHAT_BODY.y);
    expect(CHAT_HEADER.h).toBe(40);
  });

  it('centres the title and the tag on the band when the wide plate draws, and keeps chat-4 placing otherwise', () => {
    const wide = chatHeaderLayout('wide');
    const band = CHAT_HEADER.y + ((CHAT_PLATE_BAND.top + CHAT_PLATE_BAND.bottom) / 2) * CHAT_PLATE_K;
    expect(Math.abs(wide.titleY - band)).toBeLessThanOrEqual(1);
    expect(wide).toMatchObject({ titleOriginY: 0.5, tagY: wide.titleY, divider: false });
    // The tag's 20 px pill stays inside the header strip.
    expect(wide.tagY - 10).toBeGreaterThanOrEqual(CHAT_HEADER.y);
    expect(wide.tagY + 10).toBeLessThanOrEqual(CHAT_BODY.y);
    expect(chatHeaderLayout('portrait')).toEqual({
      titleY: CHAT_HEADER.y + 14,
      titleOriginY: 0,
      tagY: CHAT_HEADER.y + 22,
      divider: true,
    });
  });

  // 36 px since the layout A chat's bigger rows (Rolando, 30 Oct 2026); 32 before.
  it('draws the 36 px row discs and the 20 px system glyph from larger files', () => {
    for (const key of [...STREAM_AVATARS, BLOCK_AVATARS['unnamed neighbour']]) {
      const r = artRequest(key)!;
      expect(r.display, key).toEqual({ w: ROW_AVATAR, h: ROW_AVATAR });
      expect(Math.min(r.cut!.w, r.cut!.h), key).toBeGreaterThanOrEqual(ROW_AVATAR);
    }
    const glyph = artRequest(SYSTEM_GLYPH)!;
    expect(glyph.display).toEqual({ w: SYSTEM_GLYPH_SIZE, h: SYSTEM_GLYPH_SIZE });
    expect(glyph.cut!.w).toBeGreaterThanOrEqual(SYSTEM_GLYPH_SIZE);
    expect(glyph.cut!.h).toBeGreaterThanOrEqual(SYSTEM_GLYPH_SIZE);
  });

  it('draws the 41x64 antenna glyph at its own aspect inside the 20 px box, never squashed or upscaled', () => {
    const cut = artRequest(SYSTEM_GLYPH)!.cut!;
    expect(cut).toEqual({ w: 41, h: 64 });
    const s = systemGlyphSize(cut);
    expect(s.h).toBe(SYSTEM_GLYPH_SIZE);
    expect(s.w).toBeLessThanOrEqual(SYSTEM_GLYPH_SIZE);
    expect(s.w / s.h).toBeCloseTo(cut.w / cut.h, 6);
    expect(systemGlyphSize({ w: 10, h: 8 })).toEqual({ w: 10, h: 8 });
    expect(systemGlyphSize(null)).toEqual({ w: SYSTEM_GLYPH_SIZE, h: SYSTEM_GLYPH_SIZE });
  });
});
