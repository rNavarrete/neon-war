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
| `dialCard`     | 1560 | 120 | 340 | 250 | 1730, 245  | The 230 px dial, while a dial question is open         |
| `sizingPrompt` | 1210 | 120 | 340 | 100 | 1380, 170  | The C6 sizing prompt, beside the dial                  |
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

## Views and the registry

A lane draws its zone as a `LiveView` (`src/scenes/live/view.ts`): `zone`, a declared
`budget: {objects, texts}`, optional `preload(scene)`, `create(scene, host)`, `update(frame, clock,
occurrences)` and `shutdown()`. The host (`LiveHost`) is the HUD scene, the bus, the zone's rect and
a live `flags` getter. `update` runs every frame and must not allocate: it reads the shared `Frame`,
the HUD clock `{now, dt}` (real seconds times the test speed, stopped while the board is held) and
this frame's occurrences, and moves only what changed.

`src/scenes/live/registry.ts` has one line per zone naming the view class that draws it. A lane
replaces its own line when its view lands and touches no other. The feed and the inventory are the
board's and have no line; `BoardScene` draws them. Until a lane's view lands its zone shows a
`PlaceholderView`: a dashed outline and the zone's name, under everything the HUD draws today,
never interactive, two objects.

`HudScene` hosts the registry: it makes every view in `init`, calls `preload`, `create` (first, so
placeholders sit under the HUD's own objects), `update` each frame and `shutdown` with the scene.

### Flags

`src/scenes/live/flags.ts`: `flagsFrom(search)` gives `{lite}`; `lite` is true under `?test` and
means reduced effects (no decorative particles, parallax or pulses). Lite changes looks only, never a
hook value. Views read it through `host.flags`.

### The frame and its occurrences

`src/game/frame.ts`: `frame(run)` is the one read of the run per sim change, shared by every view
(the flow, offline parts, capacity and wired capacity, demand, retries, served/dropped/error share,
the warnings, the dips, the waiting flags, the rewinds, the notes). It returns the identical object
until the play, the notes or a hold changes, so views never call `run().flow` themselves.

`src/game/occurrences.ts`: `detectOccurrences(prev, next)` lists the edges between two frames as
`{kind, id?, at}`: `placed`, `wired`, `cut`, `hot`, `died`, `dip`, `skipped`, `retriesRising`,
`laundryCut`, `rescued`, `held`, `dark` (with an id a part went dark in a dip; without one the block
went dark at midnight) and `fall`. Identical frames give none. The HUD emits each one on the bus as
`occurrence` and hands the frame's list to every view's `update`.

### Bus events

`src/game/bus.ts` carries the lane boundaries as typed events: `drag` (board), `line` / `lineEnd`
and `chatLine` (comms, chat), `alert` / `alertEnd` (gauges), `occurrence` (tech), `voice` /
`voiceStart` / `voiceStop` / `voiceEnd` (the mixer) and `perfSample`. Every event before them is
unchanged.

### Hook sections

`src/scenes/live/hook.ts` publishes two sections of `window.__neonTest.state` for browser tests;
no view reads them.

- `live.zones[zone]`: `pageRect(ZONES[zone], canvasRect)` for all twelve zones, in page CSS pixels.
- `live.placeholders`: the registry zones still drawn by a `PlaceholderView`, in registry order.
- `live.layoutVersion`: `LAYOUT_VERSION`.
- `perf.objects.{board, hud}`: objects on each scene's display list; `perf.texts` and
  `perf.graphics`: Text and Graphics objects on both together; `perf.fps.avg`: the frame rate;
  `perf.lite`: the lite flag.

### Script anchors

Each lane adds the lines its views need under its own anchored section of `docs/SCRIPT.md` ("Lane
lines") and the matching `// anchor: <lane>` comment inside `LINES` in `src/strings.ts`, as one
two-file edit, and nowhere else. `tests/strings.test.ts` checks every line either way.

## Browser test budget

### Reach helpers

`tests/browser/live/reach.ts` is how every Live spec gets to a moment of the night. Use it instead
of copying the boilerplate from `hud.spec.ts` and `story.spec.ts`.

- `openBoard(page, {speed, autopilot, params, timeout})` opens `/?test&scene=board`. It defaults
  to speed 20 with autopilot, waits for `hud.ready` and returns `{errors}`, the page errors, which
  keep filling.
- `dismissJobCard(page)` clicks the job card away and waits for `hud.jobCard.open` to be false.
- `setDial(page, value)` uses the dial's plus and minus buttons, then presses SET.
- `reach(page, moment, {timeout})` runs the night on to `'c1'`, `'c3'`, `'surge'`, `'rescue'` or
  `'midnight'`, clicking away the job card and clicking through every story scene on the way
  (Skip when it shows). It returns the hook as read there (`snap`, `hud`), the wall-clock
  `seconds` it took, the `scenes` it clicked through and what it `seen` (every
  `hud.surge.startsAt`, the C5 scene). On a page not yet opened it opens the board at speed 20
  with autopilot first. If it times out, it throws a message naming the hook fields it waited on
  and the last values it read.
- `shot(page, name)` saves `test-results/screens/<name>.png`.

| Moment     | Waits on                                                               | Default timeout |
| ---------- | ---------------------------------------------------------------------- | --------------: |
| `c1`       | `hud.jobCard.open` false, `hud.paused` false, `hud.now >= 15`          |            10 s |
| `c3`       | `hud.now >= 180`                                                       |            20 s |
| `surge`    | `hud.surge.startsAt === 300` seen, then `hud.now >= 300`               |            25 s |
| `rescue`   | `story.scriptId === 'C5'` seen, then `story.finished` has C5, board up |            40 s |
| `midnight` | `hud.clock` matches `/^00:00/`                                         |            50 s |

Timeouts count from the `reach` call on a freshly opened board. `tests/browser/live-skeleton.spec.ts`
proves the two bounds that matter most, `surge` within 25 s and `midnight` within 50 s, and records
each run's seconds as `boot` and `reach` annotations.

### Measured floors per page load

These were measured on the cloud worker (headless Chromium, software WebGL, one worker) on
28 Oct 2026, from `page.goto`, with one page reaching each moment in turn. The sim's top speed is
20 (`src/testHook.ts`), and a frame advances at most 0.25 s times the speed (`Run.tick`). A
spec cannot go faster than this, whatever it asserts.

| Moment                        | Speed 20 with autopilot (s) | Speed 5 with autopilot (s) |
| ----------------------------- | --------------------------: | -------------------------: |
| boot (`hud.ready`)            |                      4 to 6 |                     4 to 6 |
| `c1`                          |                           7 |                          6 |
| `c3`                          |                          15 |                         40 |
| `surge`                       |                    19 to 21 |                         64 |
| `rescue` (C5 clicked through) |                          34 |                         79 |
| `midnight`                    |                    44 to 47 |                        119 |

Clicking through the C5 rescue alone costs about 13 s of wall clock: it is all clicks, and speed
does not shorten it. A spec that needs anything after C5 pays that once, so it should make every
check after C5 on that one page load.

On a board that is already open, the `reach` call alone takes about 15 s to `surge` and 39 to 41 s
to `midnight`. Those are the bounds the spec checks against 25 s and 50 s. The two reach tests cost
about 21 s (surge) and 46 s (midnight), boot included. With the skeleton test, the whole
`live-skeleton.spec.ts` file runs in about 72 s.

### The e2e seconds budget

`scripts/check.mjs` caps the Playwright step at **900 s**. Playwright runs one worker
(`playwright.config.ts`), so the cap is serial wall clock for the whole suite. The suite before the
Live work took 616 s for 34 tests on the last full run (plan figure, not re-measured here). That
leaves 284 s.

Per lane, for its spec file at M3 (one spec file per lane):

| Lane / spec                                                          | Budget (s) |
| -------------------------------------------------------------------- | ---------: |
| board: `board-live.spec.ts`                                          |        150 |
| gauges: `live-gauges.spec.ts`                                        |        150 |
| comms: `comms.spec.ts`                                               |         90 |
| chat: `chat.spec.ts`                                                 |         90 |
| luxcam: `luxcam.spec.ts`                                             |         60 |
| tech: `live-skeleton` 75, `live-perf` 30, `voice` 20, `live-tour` 30 |        155 |
| art3d: `art.spec.ts`                                                 |         30 |
| learning: `teaching.spec.ts`                                         |        150 |
| **Live total**                                                       |    **875** |
| Existing suite                                                       |        616 |
| **All**                                                              |   **1491** |

- **Under the 900 s cap in force today**, only the M1 specs fit: 616 + 75 (`live-skeleton`) + 30
  (`art.spec`) = 721 s, which leaves a **179 s reserve**. No M3 spec can merge until the cap is
  raised.
- **Under decision D9's 1800 s** (tech-9), the full table is 1491 s, which leaves a **309 s
  reserve**. Measured, `live-skeleton` costs 75 s, not the 10 s the plan drafted. That makes the
  tech row 155 s rather than 90 s, and the reserve 309 s rather than 374 s. tech-8 folds the
  moment tests, these two reach tests among them, into one `live-tour` at M5, and brings the suite
  under 1500 s.
- **Raising the cap is a control change.** `scripts/check.mjs` and `.github/workflows/ci.yml` are
  protected paths. Only the owner (Rolando) can change the cap and the CI job timeout, through
  the D9 control-change PR (tech-9). No lane edits them, and no lane gets under the cap by
  weakening an assertion.

Rules for every Live spec:

- Call `test.setTimeout` with the spec's own measured cost plus a margin.
- Run at speed 20 with autopilot through `reach`. Use speed 5 only for the C4 laundry-cut click.
- Write one test per lane that goes past C4, and reuse one page load for everything after a
  moment.
- Take at most 3 screenshots per lane, through `shot`.
- Assert on histories (`bark.history`, `story.finished`, `seen`) rather than on what is current,
  because at speed 20 the current value moves between reads.
- Before a lane adds seconds, record what its spec costs and update this table.
