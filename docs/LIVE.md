# The Live screen

The Live screen is what the player sees from C1 to C7: the board (Lux's feed of the block's traffic)
with the instruments, the comms band, the chat and the deck around it, laid out like frame 54 of the
picked mockup (`live-round4-mockups/54-live-v4b-raid.jpg`). This file is the contract between the
lanes that build it. `docs/GAME.md` still owns the rules and numbers.

## Layout contract

`src/scenes/live/layout.ts` is the only geometry source for the Live screen: `ZONES`, `CARDS`,
`rectToArea`, `pageRect` and `LAYOUT_VERSION`. The screen is 1920x1080 game pixels (`SCREEN`),
scaled to fit the window. The contract is frozen after milestone M1; a tech PR that moves a zone
bumps `LAYOUT_VERSION`, and nothing else changes it.

**The rule: no lane hard-codes a pixel outside its own rect.** A view draws inside `ZONES[zone]`
(the rect its `LiveHost` hands it) and reads every edge, centre and size from that rect. The HUD
layout (`src/scenes/hud/layout.ts`) and the board layout (`src/scenes/board/layout.ts`) derive
their numbers from `ZONES` rather than repeating them. A view that needs a point in another zone
asks that zone's lane for it (a locate helper or a hook field), never the number.

### Zones

Twelve rects `{x, y, w, h}` in game pixels. No two overlap; all lie inside 1920x1080
(`tests/live-layout.test.ts`).

| Zone        |    x |   y |    w |   h | Lane    | What it holds                                              |
| ----------- | ---: | --: | ---: | --: | ------- | ---------------------------------------------------------- |
| `title`     |    0 |   0 |  440 | 100 | gauges  | Lux's avatar, the stream title, the viewer count           |
| `alert`     |  460 |   8 | 1040 |  84 | gauges  | The one-at-a-time alert band: surge, fall, dip             |
| `clock`     | 1520 |   0 |  400 | 100 | gauges  | The in-world clock, the countdown, trust and credits       |
| `map`       |   16 | 110 |  408 | 310 | gauges  | The city map with the block's dots                         |
| `cam`       |   16 | 430 |  408 | 270 | luxcam  | Lux's cam frame                                            |
| `gauge`     |   16 | 710 |  408 | 170 | gauges  | The demand gauge with the estimate and sizing marks        |
| `scope`     |   16 | 890 |  408 | 180 | gauges  | The scope: the chart with the demand and capacity lines    |
| `feed`      |  455 | 110 | 1455 | 530 | board   | The board: gateway, balancer, rack, database, packets      |
| `comms`     |  455 | 645 | 1455 | 150 | comms   | The comms band: the crew's slots and the current line      |
| `inventory` |  455 | 800 | 1055 | 165 | board   | The tray of parts                                          |
| `deck`      |  455 | 970 | 1055 | 105 | gauges  | The deck of keys and the headroom bar                      |
| `chat`      | 1525 | 800 |  385 | 275 | chat    | Lux's stream chat                                          |

The board's areas come straight from the table: `rectToArea(ZONES.feed)` is
`{left: 455, right: 1910, top: 110, bottom: 640}` and `rectToArea(ZONES.inventory)` is
`{left: 455, right: 1510, top: 800, bottom: 965}`.

### Cards

Cards are drawn over the feed only while something asks for them, and are the one thing allowed to
cover another lane's zone. The banner, job card and dip fallback keep the centres today's
`HudScene` uses, so every click point `tests/browser/hud.spec.ts` reads from the hook still lands.

| Card           |    x |   y |   w |   h | Centre     | When                                                   |
| -------------- | ---: | --: | --: | --: | ---------- | ------------------------------------------------------ |
| `dialCard`     | 1650 | 120 | 250 | 250 | 1775, 245  | The 230 px dial, while a dial question is open         |
| `sizingPrompt` | 1300 | 120 | 340 | 100 | 1470, 170  | The C6 sizing prompt, beside the dial                  |
| `banner`       |  638 | 172 | 644 | 316 | 960, 330   | The Solace banner (1431x700 art at 0.45), in C2        |
| `jobCard`      |  701 | 156 | 518 | 752 | 960, 532   | The C1 job card (864x1252 art at 0.6), until clicked   |
| `dipFallback`  |  860 | 240 | 200 | 120 | 960, 300   | The power-dip warning when the board can't place it    |

### Helpers

- `rectToArea(rect)` turns a rect into `{left, right, top, bottom}`, the form the board layout uses.
- `centreOf(rect)`, `overlaps(a, b)` and `inside(rect, outer)` are the small geometry the tests and
  views share.
- `pagePoint(point, canvasRect)` and `pageRect(rect, canvasRect)` map game pixels to page CSS
  pixels, identically to `toPage` in `src/scenes/board/layout.ts` (rounded to a tenth), so a browser
  test can click what any lane's hook reports. `canvasRect` is the canvas's `getBoundingClientRect()`.
- `ZONE_IDS` and `CARD_IDS` list the ids in table order; `ZoneId` and `CardId` are their types.
