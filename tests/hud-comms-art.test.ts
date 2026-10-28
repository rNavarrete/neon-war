// comms-9 (M4 art swap): the band draws Rolando's picked plate, badges and HOUSE chips. The plate
// came out a little under the band and the chips are not square, so each is drawn at its own size
// (or fitted down), centred, never stretched up; TRIAGE's iris sits over her badge's painted lens.

import { artRequest, isPicked } from '../src/game/artManifest';
import { COMMS_AVATARS } from '../src/scenes/avatars';
import { faceCrop } from '../src/scenes/avatarCrop';
import { TRIAGE_LENS, fitCentred, lensOffset } from '../src/scenes/hud/CommsView';
import { CHIP_SIZE, COMMS_PLATE, commsLayout } from '../src/scenes/hud/comms';
import { ZONES } from '../src/scenes/live/layout';

/** The bit of node:fs the test reads with; the repo has no @types/node, so typed here. */
const fs = (
  globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }
).process.getBuiltinModule('node:fs') as { readFileSync(path: string): Uint8Array };

/** A WebP file's pixel size, read from its header (VP8X, VP8L or VP8 chunk). */
function webpSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(`public/${file}`);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u24 = (o: number): number => v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16);
  const chunk = String.fromCharCode(...b.subarray(12, 16));
  if (chunk === 'VP8X') return { w: 1 + u24(24), h: 1 + u24(27) };
  if (chunk === 'VP8L') {
    const bits = v.getUint32(21, true);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { w: v.getUint16(26, true) & 0x3fff, h: v.getUint16(28, true) & 0x3fff };
}

const inside = (a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

describe('comms-9: the picked band art, drawn at its own size', () => {
  const band = ZONES.comms;

  it('has every comms piece picked, with the manifest cut matching the file on disk', () => {
    for (const key of [
      COMMS_PLATE,
      COMMS_AVATARS.TRIAGE,
      COMMS_AVATARS.REI,
      COMMS_AVATARS.MIKA,
      COMMS_AVATARS.OZZIE,
      ...COMMS_AVATARS.HOUSE,
      'hud/live/avatar-luxnet',
    ]) {
      const r = artRequest(key)!;
      expect(isPicked(r), key).toBe(true);
      expect(webpSize(`art/${key}.webp`), key).toEqual(r.cut);
    }
  });

  it('draws the 1450x144 plate at its own size, centred in the 1455x150 band on whole pixels', () => {
    const cut = artRequest(COMMS_PLATE)!.cut!;
    expect(cut).toEqual({ w: 1450, h: 144 });
    const at = fitCentred(cut.w, cut.h, band);
    expect({ w: at.w, h: at.h }).toEqual(cut);
    expect(inside(at, band)).toBe(true);
    expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true);
    // Centred: the margins either side differ by at most a pixel.
    expect(Math.abs(at.x - band.x - (band.x + band.w - at.x - at.w))).toBeLessThanOrEqual(1);
    expect(Math.abs(at.y - band.y - (band.y + band.h - at.y - at.h))).toBeLessThanOrEqual(1);
  });

  it('fits a picture down to its box and never scales one up', () => {
    const box = { x: 10, y: 20, w: 100, h: 50 };
    expect(fitCentred(40, 20, box)).toEqual({ x: 40, y: 35, w: 40, h: 20 });
    expect(fitCentred(400, 100, box)).toEqual({ x: 10, y: 33, w: 100, h: 25 });
    expect(fitCentred(100, 50, box)).toEqual(box);
    // No size (not loaded, or a node stub): the box itself, so nothing divides by zero.
    expect(fitCentred(0, 0, box)).toEqual(box);
    expect(fitCentred(Number.NaN, 5, box)).toEqual(box);
  });

  it('fits the 128x120 HOUSE chips into the 64 px chip box at their own aspect', () => {
    for (const key of COMMS_AVATARS.HOUSE) {
      const cut = artRequest(key)!.cut!;
      const at = fitCentred(cut.w, cut.h, { x: 0, y: 0, w: CHIP_SIZE, h: CHIP_SIZE });
      expect({ w: at.w, h: at.h }, key).toEqual({ w: 64, h: 60 });
      expect(at.w / at.h, key).toBeCloseTo(cut.w / cut.h, 2);
      expect(at.w, key).toBeLessThanOrEqual(cut.w);
    }
  });

  it('bakes each round badge down from its file, never up', () => {
    for (const key of [COMMS_AVATARS.TRIAGE, COMMS_AVATARS.REI, COMMS_AVATARS.MIKA, COMMS_AVATARS.OZZIE]) {
      const cut = artRequest(key)!.cut!;
      expect(faceCrop(cut.w, cut.h, 84).scale, key).toBeLessThanOrEqual(1);
    }
  });

  it("puts TRIAGE's iris over her badge's lens, inside her slot's disc", () => {
    const cut = artRequest(COMMS_AVATARS.TRIAGE)!.cut!;
    const o = lensOffset(cut.w, cut.h, 84);
    // The lens is painted left of centre, about level with it.
    expect(o.dx).toBeLessThan(-15);
    expect(o.dx).toBeGreaterThan(-30);
    expect(Math.abs(o.dy)).toBeLessThan(6);
    // The widest iris (r 14) and its widest move (5 px) stay inside the slot's r 42 disc.
    const slot = commsLayout(band).slots[0];
    expect(Math.hypot(o.dx, o.dy) + 14 + 5).toBeLessThanOrEqual(slot.r);
    // The lens point is the badge's own: the centre of the file maps to the slot's centre.
    expect(lensOffset(cut.w, cut.h, 84, { fx: 0.5, fy: 0.5 })).toEqual({ dx: 0, dy: 0 });
    expect(TRIAGE_LENS.fx).toBeLessThan(0.5);
    // No size: no offset.
    expect(lensOffset(0, 0, 84)).toEqual({ dx: 0, dy: 0 });
  });
});
