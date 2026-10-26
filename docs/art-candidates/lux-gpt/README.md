# Lux (gpt-image-2 candidates)

**Locked default (2026-10-26): `lux-final-body.png`**, the skater outfit (see-through yellow raincoat,
Nirvana Nevermind long-sleeve, cargo shorts over leggings, knee pads, high-tops with yellow and pink laces),
streaming-rig backpack, taped phone, camera drone, and home-made see-through AR goggles that she wears at all
times (it's how she jacks into incidents). `lux-fit-1-nirvana-baby.png` is the same design without goggles.

Kept for reference: the other outfits (`lux-fit-*`), the streamer and AR-goggles portraits, and the tee variants
(`lux-fit-1-bandtee.png` with an original band, `lux-fit-1-nirvana.png` with no figure in the print).
Backgrounds are solid #FF00FF and need a chroma-key pass before use as sprites.

## Sprite strips (`sprites/`)

Built from the raw magenta sheets by `lux_sprites.py` in the bake-off folder: magenta keyed out (including the
pink the see-through coat picked up), every frame on an even grid, feet on one baseline, mirrored to face left.
Load in Phaser with `this.load.spritesheet(key, path, { frameWidth, frameHeight })`; `*-preview.gif` shows each loop.

| Strip | Frames | Cell | Source sheet |
| --- | --- | --- | --- |
| `lux-walk.png` | 8 | 192x192 | `lux-walk-keys-goggles-v2.png` (side view; jacked in, goggles on) |
| `lux-walk-offline.png` | 8 | 192x192 | `lux-walk-keys-neck.png` (side view; offline, goggles around neck) |
| `lux-idle.png` | 4 | 192x192 | `lux-idle-goggles.png` (breathing, glance up from phone) |
| `lux-fidget.png` | 4 | 192x192 | `lux-fidget-goggles.png` frames 1-4 (frames 5-6 lost the goggles) |
| `drone-hover.png` | 4 | 96x96 | `lux-drone-keys.png` top row |
| `drone-iris.png` | 4 | 96x96 | `lux-drone-keys.png` bottom row |

All Lux strips show the goggles. Pre-goggles sheets (`lux-walk-keys.png`, `lux-idle-1.png`, `lux-idle-keys.png`) are
kept for reference only.
