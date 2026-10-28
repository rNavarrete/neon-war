# Art requests

The owner's run list for the Live screen's new art, in batch order. Batches 1 to 4 are requested now; batch 5 waits until they are in.
Every key here is also a request in `src/game/artManifest.ts` (`ART_REQUESTS`), and `tests/art-manifest.test.ts` checks that this file lists exactly those keys, in batch order, with the same sizes, states, prompts and fallbacks.
Workers never add, edit or resize art. Until a piece is picked, `resolveArt(key)` in `src/scenes/plates.ts` draws its fallback, so no ticket waits on a pick.

## How to read a row

- **Key**: the one name every file uses. `hud/city-grid` lands at `public/art/hud/city-grid.webp`.
- **Display**: the size it is drawn at on the 1920x1080 screen.
- **Cut**: the size to cut the picked piece at. It is never smaller than the display size, so nothing is upscaled. Nine-sliced plates give the corner scale k: drawn corners are the cut corners times k.
- **States**: the states the piece has, and which of them code draws (tints, fills, ticks).
- **Prompt**: one line for gpt-image-2, under the style anchor below.
- **Fallback**: what draws until the piece is picked. A path is a picked file reused with a tint; "baked" is a plate drawn once in code at the display size and labelled with the key.

## Pipeline

- gpt-image-2 on the owner's Mac, about $0.22 per 1536x1024 frame. Sheets are 1536x1024 on flat magenta.
- Candidates per sheet: table plate 6, map 5, each cam sheet 4, everything else 3.
- The pipeline chroma-keys, cuts and saves WebP with transparency. The owner opens the PR that adds the files under `public/art`, sets each request's `cut` in `src/game/artManifest.ts` to the file's real size, and adds the files to `docs/ART.md` (see "How a picked file lands" there).

Style anchor, put before every prompt:

> painted cyberpunk, dark navy, amber the only warm light, cyan only for lamps, red only over capacity, same hand as board/server.webp; cutouts on flat magenta, no glow, no text

| Batch | Sheets | Frames | Cost |
| --- | --- | --- | --- |
| 1 board and map | table plate 6, sheet A 3, sheet B 3, channel plate 3, city-grid 5 | 20 | $4.40 |
| 2 band and chat | comms-plate 3, round avatars 3, icons 3, chat-plate-wide 3, stream avatars 3 | 15 | $3.30 |
| 3 cam | lean-in 4, relieved 4, backdrop 3 | 11 | $2.42 |
| 4 shell | panel kit 3, keycaps and cards 3, topbar-strip 3, alert-plate 3 | 12 | $2.64 |
| Total, batches 1 to 4 | 17 picked sheets | 58 | about $13; with a 50% retry margin about 87 frames, $19 |

Sheet A is the three server frames (`board/server-dark`, `board/server-booting-a`, `board/server-booting-b`). Sheet B is `board/server-overclocked-dark` and the two balancer ping frames.

## Batch 1: board and map

| Key | What | Display | Cut | States | Lane | Zone | Prompt | Fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `board/table-plate` | perspective PCB table under the parts, no pads painted (code draws any number of pads) | 1441x390 | 1536x416 | one; midnight is a tint | board | feed | PCB desk 30 degrees from above, an even cyan silkscreen grid edge to edge, no pads or footprints (code places 6 to 24+ pads), amber rim at the near lip, empty; trapezoid 1215 px wide at the far edge, 1441 px at the near edge | baked: the code-baked slab the board draws today (0x0b1424) |
| `board/server-dark` | the scrap server with every lamp off (sheet A) | 85x121 | 431x638 | dark | board | feed | board/server.webp with all lamps off | `board/server.webp` (tint 0x55556a): the server tinted dim |
| `board/server-booting-a` | boot lamp frame A: cyan lamp strip low (sheet A) | 85x121 | 431x638 | booting, alternates with -b at 4 Hz | board | feed | board/server.webp with its cyan lamp strip lit low | `board/server.webp` (tint 0xa8c8ff, alpha 0.75): the server tinted cool, pulsing in alpha |
| `board/server-booting-b` | boot lamp frame B: cyan lamp strip high (sheet A) | 85x121 | 431x638 | booting, alternates with -a at 4 Hz | board | feed | board/server.webp with its cyan lamp strip lit high | `board/server.webp` (tint 0xd8e8ff, alpha 0.9): the server tinted cool, pulsing in alpha |
| `board/server-overclocked-dark` | the kit-fitted server unlit (sheet B) | 85x121 | 466x638 | dark | board | feed | board/server-overclocked.webp fully unlit | `board/server-overclocked.webp` (tint 0x55556a): the overclocked server tinted dim |
| `board/balancer-ping-a` | the balancer with its lamp off (sheet B) | 140x100 | 480x339 | ping off, while it passes a box over | board | feed | board/balancer.webp with its lamp off | `board/balancer.webp` (tint 0x9a9ab0): the balancer tinted grey |
| `board/balancer-ping-b` | the balancer with a cyan lamp lit (sheet B) | 140x100 | 480x339 | ping on, while it passes a box over | board | feed | board/balancer.webp with one cyan lamp lit | `board/balancer.webp` (untinted): the balancer as picked |
| `board/channel-plate` | the amber trough entering the feed from the left, engraved scale (optional) | 150x200 | 300x400 | one; fill and ticks are code | board | feed | a dark metal gutter from the left, amber rim, five engraved ticks, empty | baked: a dark trough with an amber rim (0x1a1408) |
| `hud/city-grid` | top-down night map of the district, Lux's block right of centre | 408x310 | 816x620 | one; lights and dots are code | gauges | map | top-down slum district at night, rain-wet streets, one block right-centre with unlit windows, four dark blocks at the left, no labels | baked: a vector street grid (0x0b1424) |

## Batch 2: band and chat

| Key | What | Display | Cut | States | Lane | Zone | Prompt | Fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hud/comms-plate` | the COMMS band plate: dark glass, amber hairline, divider, tag well | 1455x150 | 1455x150 | one; the WARNING border is code | comms | comms | a 10:1 near-black glass strip, 1 px amber outline, a divider 520 px in, a chip well right | `hud/textbox.webp` (untinted, alpha 0.9): the text box plate, nine-sliced |
| `chars/comms/triage` | TRIAGE's round badge: a white drone lens | 84x84 | 256x256 | one; lit or dark by tint | comms | comms | a round badge like chars/avatars/kenji.webp: a white drone lens | `chars/triage/eager.webp` (untinted): the eager TRIAGE face, round-cropped |
| `chars/comms/rei` | Rei's round badge, neutral | 84x84 | 256x256 | one; dark before the rescue by tint | comms | comms | a round badge like chars/avatars/kenji.webp: Rei, neutral | `chars/rei/faces/smirk.webp` (untinted): her default board face, round-cropped |
| `chars/comms/mika` | Mika's round badge, neutral | 84x84 | 256x256 | one; dark before the rescue by tint | comms | comms | a round badge like chars/avatars/kenji.webp: Mika, neutral | `chars/mika/faces/calm.webp` (untinted): her default board face, round-cropped |
| `chars/comms/ozzie` | Ozzie's round badge, neutral | 84x84 | 256x256 | one; dark before the rescue by tint | comms | comms | a round badge like chars/avatars/kenji.webp: Ozzie, neutral | `chars/ozzie/faces/smug.webp` (untinted): his default board face, round-cropped |
| `hud/live/avatar-luxnet` | Lux_Net's profile picture in the title cluster | 72x72 | 256x256 | one | gauges | title | a round badge like chars/avatars/kenji.webp: Lux grinning, goggles up | `chars/lux/faces-board/determined.webp` (untinted): her board face, round-cropped |
| `hud/icons/door` | HOUSE chip for Grandma through the door | 64x64 | 128x128 | one | comms | comms | an amber glyph like hud/icons/warning.webp: a door ajar | baked: an amber-rimmed disc (0x2a1d08) |
| `hud/icons/tv` | HOUSE chip for the TV downstairs | 64x64 | 128x128 | one | comms | comms | an amber glyph like hud/icons/warning.webp: an old TV | baked: an amber-rimmed disc (0x2a1d08) |
| `hud/icons/system` | the chat system-row glyph | 20x20 | 64x64 | one | chat | chat | an amber glyph like hud/icons/warning.webp: an antenna | baked: an amber dot (0x2a1d08) |
| `hud/icons/play` | the SET key glyph | 44x44 | 128x128 | one; lit or dim by tint | gauges | deck | an amber glyph like hud/icons/warning.webp: a play triangle | baked: an amber-rimmed square (0x2a1d08) |
| `hud/icons/ping` | the ping mark over a part the balancer checks | 44x44 | 128x128 | one | board | feed | an amber glyph like hud/icons/warning.webp: a radar ping | baked: a cyan-rimmed disc (0x08202a) |
| `hud/icons/skipped` | the SKIPPED stamp on a pad the balancer passes over | 64x64 | 128x128 | one | board | feed | an amber glyph like hud/icons/warning.webp: a dashed box | baked: an amber-rimmed square (0x2a1d08) |
| `hud/chat-plate-wide` | the landscape LIVE CHAT plate with a 36 px header | 385x275 | 770x550 | one | chat | chat | dark navy glass, thin amber rim, lighter header band, empty, the brush of hud/chat-panel.webp | `hud/chat-panel.webp` (untinted): the portrait chat panel, nine-sliced |
| `chars/avatars/stream-1` | stream viewer avatar 1 | 32x32 | 256x256 | one | chat | chat | a cyan-rimmed disc: a hooded teen | baked: a cyan ring with the viewer initial (0x08202a) |
| `chars/avatars/stream-2` | stream viewer avatar 2 | 32x32 | 256x256 | one | chat | chat | a cyan-rimmed disc: a noodle-shop cat sticker | baked: a cyan ring with the viewer initial (0x08202a) |
| `chars/avatars/stream-3` | stream viewer avatar 3 | 32x32 | 256x256 | one | chat | chat | a cyan-rimmed disc: a glitch mask | baked: a cyan ring with the viewer initial (0x08202a) |
| `chars/avatars/stream-4` | stream viewer avatar 4 | 32x32 | 256x256 | one | chat | chat | a cyan-rimmed disc: a rain-soaked commuter | baked: a cyan ring with the viewer initial (0x08202a) |
| `chars/avatars/unnamed-neighbour` | a faceless neighbour for the seeded chat line | 32x32 | 256x256 | one | chat | chat | a cyan-rimmed disc: a backlit faceless silhouette | baked: a cyan ring (0x08202a) |

## Batch 3: cam

| Key | What | Display | Cut | States | Lane | Zone | Prompt | Fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `chars/lux/cam/lean-in` | Lux leaning in at the drone, a hand on her goggles | 388x230 | 924x548 | leaning | luxcam | cam | the girl of chars/lux/faces-board/determined.webp, webcam bust, leaning in, one hand on her goggles, amber light from below-left | `chars/lux/faces-board/determined.webp` (untinted): her determined board face, cropped to the lens |
| `chars/lux/cam/relieved` | Lux, goggles down, eyes shut, exhaling | 388x230 | 924x548 | relieved | luxcam | cam | same framing as lean-in, goggles on, eyes closed, exhaling, a small smile | `chars/lux/faces-room/relieved.webp` (untinted): her relieved room face, cropped to the lens |
| `hud/cam-backdrop` | the bedroom from the drone's eye, empty | 412x252 | 824x504 | all; 20% darker while panicking (tint) | luxcam | cam | a cluttered teenage bedroom at night from desk height, rain-streaked window, blurred neon, no characters | `bg/bedroom-dark.webp` (tint 0xc0c0d0): the dark bedroom, cropped to the lens |

## Batch 4: shell

| Key | What | Display | Cut | States | Lane | Zone | Prompt | Fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hud/live/panel-frame` | panel frame, nine-sliced with 48 px corners | 408x270 | 192x192 (nine-slice, k 0.5) | one; tints by code | art3d | screen | thin dark translucent frames, 2 px amber edges, bracket corner marks like the mockup, a label tab, tag chip, REC badge, LIVE pill, divider | baked: a dark plate with a 2 px amber rim (0x0b1424) |
| `hud/live/label-tab` | label tab on a panel | 240x36 | 480x72 | one; tints by code | art3d | screen | thin dark translucent frames, 2 px amber edges, bracket corner marks like the mockup, a label tab, tag chip, REC badge, LIVE pill, divider | baked: a dark plate with a 2 px amber rim (0x0b1424) |
| `hud/live/tag-chip` | tag chip | 120x36 | 240x72 | one; tints by code | art3d | screen | thin dark translucent frames, 2 px amber edges, bracket corner marks like the mockup, a label tab, tag chip, REC badge, LIVE pill, divider | baked: a dark plate with a 2 px amber rim (0x0b1424) |
| `hud/live/rec-badge` | REC badge on the cam | 72x24 | 144x48 | one; tints by code | art3d | cam | thin dark translucent frames, 2 px amber edges, bracket corner marks like the mockup, a label tab, tag chip, REC badge, LIVE pill, divider | baked: a dark plate with a 2 px amber rim (0x0b1424) |
| `hud/live/live-pill` | LIVE pill in the title | 96x28 | 192x56 | one; tints by code | art3d | title | thin dark translucent frames, 2 px amber edges, bracket corner marks like the mockup, a label tab, tag chip, REC badge, LIVE pill, divider | baked: a dark plate with a 2 px amber rim (0x0b1424) |
| `hud/live/corner-marks` | bracket corner marks for a panel | 48x48 | 96x96 | one; tints by code | art3d | screen | thin dark translucent frames, 2 px amber edges, bracket corner marks like the mockup, a label tab, tag chip, REC badge, LIVE pill, divider | baked: a dark plate with a 2 px amber rim (0x0b1424) |
| `hud/live/divider` | divider rule | 4x150 | 8x300 | one; tints by code | art3d | screen | thin dark translucent frames, 2 px amber edges, bracket corner marks like the mockup, a label tab, tag chip, REC badge, LIVE pill, divider | baked: a dark plate with a 2 px amber rim (0x0b1424) |
| `hud/live/keycap-idle` | deck key, idle | 80x64 | 160x128 (nine-slice, k 0.5) | idle, ready, pressed: one file each | gauges | deck | three wide deck keys (dark, amber-lit edge, pressed darker), empty centres | `hud/button.webp` (tint 0x55556a): the picked button, nine-sliced |
| `hud/live/keycap-ready` | deck key, ready | 80x64 | 160x128 (nine-slice, k 0.5) | idle, ready, pressed: one file each | gauges | deck | three wide deck keys (dark, amber-lit edge, pressed darker), empty centres | `hud/button-hover.webp` (untinted): the picked button, nine-sliced |
| `hud/live/keycap-pressed` | deck key, pressed | 80x64 | 160x128 (nine-slice, k 0.5) | idle, ready, pressed: one file each | gauges | deck | three wide deck keys (dark, amber-lit edge, pressed darker), empty centres | `hud/button-pressed.webp` (untinted): the picked button, nine-sliced |
| `hud/live/card-frame-idle` | inventory card frame, idle | 120x140 | 240x280 (nine-slice, k 0.5) | idle, ready, locked: one file each | board | inventory | three square card frames (grey, amber, dim), empty centres | `hud/part-card.webp` (untinted): the picked part card, tinted |
| `hud/live/card-frame-ready` | inventory card frame, ready | 120x140 | 240x280 (nine-slice, k 0.5) | idle, ready, locked: one file each | board | inventory | three square card frames (grey, amber, dim), empty centres | `hud/part-card.webp` (tint 0xffb347): the picked part card, tinted |
| `hud/live/card-frame-locked` | inventory card frame, locked | 120x140 | 240x280 (nine-slice, k 0.5) | idle, ready, locked: one file each | board | inventory | three square card frames (grey, amber, dim), empty centres | `hud/part-card.webp` (tint 0x55556a, alpha 0.8): the picked part card, tinted |
| `hud/live/count-badge` | count badge on an inventory card | 40x28 | 80x56 | one | board | inventory | a small dark count badge with an amber edge | baked: an amber-rimmed pill (0x2a1d08) |
| `hud/live/topbar-strip` | the top bar band | 1920x100 | 1920x100 | one; states are tints | gauges | screen | a thin dark band with one amber hairline | baked: a dark band with an amber hairline (0x05070f) |
| `hud/live/alert-plate` | the alert banner plate | 1040x84 | 1040x168 (nine-slice, k 0.5) | one; states are tints | gauges | alert | a long dark plate with a 2 px amber edge like the mockup's raid banner | `hud/warning-bar.webp` (untinted): the picked warning bar, nine-sliced |
| `hud/live/alert-endcap` | the alert banner's hazard end cap | 120x84 | 240x168 | one | gauges | alert | a hazard-striped end cap, amber and black, for the right end of the alert plate | baked: amber hazard stripes drawn in code (0x2a1d08) |

## Batch 5 (deferred)

Run these only after batches 1 to 4 are in. Each ships with its fallback until then.

| Key | What | Display | Cut | States | Lane | Zone | Prompt | Fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hud/gauge-face` | the demand gauge face | 240x140 | 480x280 | one | gauges | gauge | a dark half-dial with engraved amber ticks, empty | baked: the vector arc gauges-5 draws (0x0b1424) |
| `hud/gauge-needle` | the demand gauge needle | 12x88 | 24x176 | one | gauges | gauge | a thin amber needle with a dark hub | baked: a code-drawn line (0xffb347) |
| `chars/lux/cam/cheer` | Lux cheering on the cam | 388x230 | 924x548 | cheer | luxcam | cam | same framing as lean-in, both fists up, grinning | `chars/lux/faces-board/triumphant.webp` (untinted): her triumphant board face |
| `hud/cam-frame` | the cam frame | 408x270 | 408x270 | one; amber or red rim by tint | luxcam | cam | a webcam frame with bracket corners and a thin amber rim, empty | baked: a code-drawn rim (0x0b1424) |
| `board/table-plate-midnight` | the table plate after midnight | 1441x390 | 1536x416 | one | board | feed | board/table-plate at midnight: the silkscreen dimmer, the amber rim cold | baked: the slab tinted for midnight (0x070d18) |
| `hud/city-grid-lit` | the map's lit windows | 408x310 | 816x620 | one; floors light by code | gauges | map | hud/city-grid with every window of Lux's block lit amber | baked: lit floors drawn as code rects (0x0b1424) |
| `board/packet-cube` | a packet cube | 24x18 | 64x48 | normal and red by tint | board | feed | a small glowing data cube in cyan, three-quarter view | `hud/icons/packet.webp` (tint 0x5ce1ff): the packet icon, tinted |
| `hud/live/night-shift-sticker` | the NIGHT SHIFT sticker | 160x80 | 320x160 | one | art3d | screen | a scuffed vinyl sticker shape, amber and navy, blank face for code text | baked: an amber-rimmed plate (0x2a1d08) |
