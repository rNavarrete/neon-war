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
occurrences)` and `shutdown()`. The host (`LiveHost`) is the HUD scene, the bus, the zone's rect, a
live `flags` getter and `pressSet()`. `update` runs every frame and must not allocate: it reads the shared `Frame`,
the HUD clock `{now, dt}` (real seconds times the test speed, stopped while the board is held) and
this frame's occurrences, and moves only what changed.

`src/scenes/live/registry.ts` has one line per zone naming the view class that draws it. A lane
replaces its own line when its view lands and touches no other. The feed and the inventory are the
board's and have no line; `BoardScene` draws them. Until a lane's view lands its zone shows a
`PlaceholderView`: a dashed outline and the zone's name, under everything the HUD draws today,
never interactive, two objects.

`HudScene` hosts the registry: it makes every view in `init`, calls `preload`, `create` (first, so
placeholders sit under the HUD's own objects), `update` each frame and `shutdown` with the scene.
Each frame, after the views' `update`, the host loop runs the trigger table
(`src/scenes/hud/cues.ts`): `cueViewOf` builds the cues' view from the frame, its occurrences, the
HUD clock and what only the HUD knows (into one reused object), `direct()` fires what is due, and
each fired id goes out on the bus as `cue {id, kind: 'bark' | 'chat', at}` (`at` is the HUD clock).
Bark ids go to the comms band's queue and chat ids to the chat; `C6.fail.chat` is the chat going
silent, never a row, and no filler is posted while `chatSilenced` holds (until the rewind).
`hud.cues {fired, silenced}` mirrors it for tests.

### LiveHost.pressSet

`pressSet()` is the one action a view may ask of the host: press the dial card's SET, exactly as the
card's own button does. The host forwards it to `DialView.pressSet()`, which records the dial's
value (the C1 estimate or the C6 sizing) and returns `true`, or does nothing and returns `false`
while the dial is locked or no dial question is open. DeckView calls it for key 3 (`3 SET`, the
key or the keyboard), so the deck never holds the dial or knows what SET records. It is optional
on the interface: a host built in a unit test may leave it out, and a view reads it as
`host.pressSet?.() ?? false`.

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
`voiceStart` / `voiceStop` / `voiceEnd` (the mixer), `cue {id, kind, at}` (the host loop, above),
`audience {watching}` (chat) and `perfSample`. Every event before them is unchanged. Lanes declare
no events of their own by module augmentation: a new event is a line in `GameEvents`
(`tests/bus.test.ts` checks it).

| Event | Emitted by | Payload | Heard by |
| --- | --- | --- | --- |
| `drag` | BoardScene, on drag start, each hover change and drag end | `{kind, card, over, state?, legal?}` | comms (no hover while dragging), luxcam |
| `line` | CommsView, when a band line starts | `{id, speaker, tag, lesson, since}` | chat (quiet), luxcam (speaking), the mixer |
| `audience` | ChatFeedView, on every change of `viewersOf` | `{watching}` | TitleView (WATCHING) |

- **`drag.state` and `drag.legal`.** `state` is the board's `PadState` for the pad or part under the
  card in hand (`legal`, `taken`, `dead`, `poor`, `wrong`; the bus spells it `DragState` so it
  imports nothing from a scene), null over nothing, on a wire drag and when the drag ends. `legal`
  is `state === 'legal'`, null where `state` is null. `dragVerdict(state)` builds both. They are
  optional until the board's emit sends them, and a listener reads a missing one as null.
- **`line.lesson`.** True when the line is one of lineMeta's lesson lines (`isLesson(id)`, the
  lines that teach), false otherwise. The chat engine keys its 2 s quiet on it: after a lesson line
  starts, no reaction posts for 2 s, so the lesson is read alone; other band lines do not quiet it.
  `since` is the HUD clock the line started at, and `tag` its band tag (HINT, WARNING, CREW, LUX,
  HOUSE).
- **`audience`.** How many are watching Lux's stream, 0 to 4, from the chat lane's `viewersOf`:
  2 until the first serve, 3 from then, 1 after 5 s of heavy errors, 3 on recovery, 4 on a held
  midnight, 0 when dark. The chat view emits it only when the number changes, and the first
  emission comes with the first change, so TitleView shows WATCHING with no number until then.
  Nothing reads the count back from the hook: `hud.audience.watching` is a mirror for tests.

### Hook sections

`src/scenes/live/hook.ts` publishes two sections of `window.__neonTest.state` for browser tests;
no view reads them.

- `live.zones[zone]`: `pageRect(ZONES[zone], canvasRect)` for all twelve zones, in page CSS pixels.
- `live.placeholders`: the registry zones still drawn by a `PlaceholderView`, in registry order.
- `live.layoutVersion`: `LAYOUT_VERSION`.
- `perf.*`: what is on the display lists, measured by `PerfMeter` (see "Perf budget" below).

The `hud` section is one public snapshot. `HudScene` provides it once, as its own keys with every
key a view file adds laid over them (`hudSection` in `src/scenes/hud/hook.ts`). A view adds
`hud.<name>` with `provideHudSection(name, read)` from the same file, without editing `HudScene.ts`
or `src/testHook.ts`: it declares the key on `HudTestState` by module augmentation, calls
`provideHudSection` in `create` and the remover it returns in `shutdown`. `provideHudPart` in
`src/scenes/hud/panel.ts` is the same call under the gauges views' older name.

The sections the views add, beside the host's own keys (`ready`, `now`, `jobCard`, `dial`,
`chart`, `surge`, `dip`, `dipMark`, `banner`, `sizingPrompt`, `bark`, `cues`, `bounds`...):

| Section | Provided by | What it mirrors |
| --- | --- | --- |
| `hud.title` | TitleView | `{live, watching, right, clockRight, avatar, scenePaused}`: the LIVE dot (`held` while a story scene or the pause menu pauses the HUD), WATCHING, the round avatar's baked texture, the right edges |
| `hud.audience` | the chat view (`live/views/chat.ts`) | `{watching}`: the last bus `audience`, null before the first |
| `hud.chat` | ChatFeedView | the merged feed, the drawn rows, the filter and header, the quiet window, `block` and `stream` kept |
| `hud.comms` | CommsView (`live/views/comms.ts`) | the band line, the five slots, `queue`, `history`, `dropped`, the reread log, the TRIAGE mood |
| `hud.bark` | the host, from CommsView | `{current, text, history}`, the band's shown lines (the older name) |
| `hud.luxCam` | LuxCamView | the mood, the art, `history` of moods, REC, the frame, `speaking`, `motion` |
| `hud.alert` | AlertView | the alert up now and its kind, line, tag and text |
| `hud.gauge`, `hud.chart` | GaugeView, ChartView | the COMING /s gauge; the scope's series and marks over the host's `chart` |
| `hud.map` | MapView | the city map's dots, raid outlines and midnight |
| `hud.deck`, `hud.headroom`, `hud.regroup`, `hud.laundry` | DeckView | the keys and their states, the room-left bar, Regroup and the laundry cut |
| `hud.dialCard` | DialView | `{dimmed, label}`: the dial card's look |
| `hud.chatArt`, `hud.chatTrace` | ChatFeedView | which chat art loaded or fell back; the trace of rows posted, with their cause |
| `hud.measure`, `hud.taught` | `src/scenes/hud/taught.ts` | the SET estimate and when it was taken; the trace of moments the night taught, for the debrief's grey lines |

Outside `hud`: `shell.voice` (the mixer: `recentVoice`, `missing`, `playing`, `started`, `groups`), `avatars.baked`
(every round avatar baked, as `avatar:<key>@<size>`), `art` (the art manifest's resolutions),
`board`, `story`, `live` and `perf`.

## Perf budget

`PerfMeter` in `src/scenes/live/hook.ts` (tech-7) measures the `perf` section. Once a second of real
time, `HudScene` walks both scenes' display lists into every container. It also takes a sample
when the HUD is built and when a story scene pauses the HUD, since no samples come while it is
paused. Between samples the section does not change. `perf.samples` counts the samples, and
`perf.at` is the sim's now at the last one. Each sample also goes out on the bus as `perfSample`.
The fields are:

- `perf.objects.{board, hud}`: every object on each scene's list, container children included.
- `perf.texts`, `perf.textsBy.{board, hud}` and `perf.graphics`: Text and Graphics objects among
  them, hidden ones included.
- `perf.drawn.{objects, texts}`: what the renderer draws now, meaning visible objects inside
  visible containers.
- `perf.zones[zone]`: `{budget, actual}` for every registered view. `budget` is the view's
  declared `budget`, and `actual` counts the objects (and texts) that view made. An object is
  credited to the view whose `create` or `update` was running when the object was added (the HUD
  listens for `ADDED_TO_SCENE`), and a container's children go with it.
- `perf.host`: the HUD objects that no view made (the cards, the dial, the legacy pieces).
- `perf.pools[name]`: the size of each pool registered with `registerPool(name, size)`.
  `pools.packets` is the board's packet sprites, made once and reused.
- `perf.filters`: live Glow and GradientMap filters on objects and cameras (art3d-6's probe).
- `perf.fps.avg` and `perf.frameMs`: the frame rate and the mean real milliseconds per frame
  since the sample before.
- `perf.lite`: the lite flag.

No view reads the meter, and it allocates nothing per object.

### Budgets

The global budget is 750 objects and 110 texts across board and HUD. `live-perf.spec.ts` checks it
at the C4 surge and at midnight: all objects against 750, and the drawn texts against 110 (all
texts are over 110 today; see below). It also checks three more things:

- Every registered view's `actual` stays within its `budget`.
- `pools.packets` stays at or below 160.
- The pool stops growing: two reads 5 s apart after the rescue are equal.

Per zone, the text budgets sum to 110. A registered view's budget is the one it declares in code.
The rows for `cam` and `chat` are the share their lanes have to declare when their views land:

| Zone / owner                                         | Texts | Objects (declared) |
| ---------------------------------------------------- | ----: | -----------------: |
| `title` (TitleView)                                  |     5 |                 11 |
| `alert` (AlertView)                                  |     4 |                 10 |
| `clock` (ClockView)                                  |     2 |                  4 |
| `map` (MapView)                                      |     3 |                 10 |
| `cam` (luxcam, placeholder today)                    |     2 |                  2 |
| `gauge` (GaugeView)                                  |    10 |                 12 |
| `scope` (ChartView)                                  |     5 |                  7 |
| `comms` (CommsView)                                  |    13 |                 24 |
| `deck` (DeckView with HeadroomView)                  |     8 |                 21 |
| `chat` (ChatFeedView)                                |    17 |                 31 |
| `feed` and `inventory` (BoardScene)                  |    28 |                  - |
| Cards (HUD host: job card, banner, dial, sizing, dip) |    13 |                  - |
| **Total**                                             | **110** |                  |

The chat feed's five rows of name and words need 17 texts, so the host's cards give up 7 of their 20 to keep the total at 110. The host makes exactly 13 (`HOST_TEXTS` in `src/scenes/hud/cardText.ts`, `tests/hud-card-text.test.ts`, and `perf.host.texts <= 13` in `live-skeleton.spec.ts`):

- **Job card and banner, 7.** The C1 job card (rate, title, who, what, bar, pay line, OK) and the
  C2 Solace banner (title, body, three button words) never show together: the banner waits for the
  card to close. They share one pool of seven texts, made once, which the host moves into whichever
  card opens and dresses from `jobCardTexts()` or `bannerTexts()` (two stay hidden on the banner).
  Every word either card showed before is still on it.
- **Dial card, 4** (DialView: the question, the value, minus and plus).
- **Sizing prompt, 1.** Its arrow is drawn as a Graphics, not typed as a text.
- **Dip warning, 1.**

The legacy pieces (the old chat column, the HUD's own deck digits, the old alert line) are gone,
so nothing else on the host is a text.

Measured on 28 Oct 2026 (speed 20 with autopilot, headless), after the host's cut to 13:

- **Objects.** 510 at the surge (335 board + 175 HUD) and 529 at midnight, inside 750.
- **Host.** 33 objects and 13 texts (was 19 card texts and 19 legacy ones).
- **Drawn texts.** 82 at the surge and at midnight.
- **All texts, hidden ones included.** 117 at the surge (35 board + 82 HUD) and 124 at midnight
  (42 + 82). The HUD's 82 is its whole share (69 for the views' declared budgets and 13 for the
  host), so the overage is the board alone: 35 to 42 texts against its 28. `live-perf.spec.ts`
  therefore still asserts the drawn texts against 110; it switches to all texts once the board
  lane brings its count to 28 or less.
- **Frame rate.** 8.7 fps at the surge and 9.2 at midnight (about 110 ms a frame).

Measured earlier on 28 Oct 2026, before the chat feed landed:

- **Objects.** 414 to 421 at the surge and 427 to 440 at midnight, well inside 750.
- **Every view.** Each registered view is at or under its declared budget.
- **Drawn texts.** 86 to 87 at the surge and 77 to 84 at midnight. That is what
  `live-perf.spec.ts` asserts against 110.
- **All texts, hidden ones included.** 119 to 121 at the surge and 124 to 128 at midnight. That is
  over 110, for two reasons:
  - The board counts 29 to 38 texts against its 28.
  - The host counts 38 against its 20. Its cards are 19 texts, and the other 19 are legacy pieces
    that stay until their lanes retire them: the legacy chat column (11, replaced when chat-5's
    view lands), the HUD's own deck digits and words (6, which DeckView duplicates) and the legacy
    alert line and number (2, which AlertView duplicates).

The host has since been cut to 13 and the legacy pieces removed (above); the switch to all texts now waits on the board alone.

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

Since then (tech M3 follow-ups, measured 28 Oct 2026):

- `live-skeleton.spec.ts`'s power-dip mark test runs at speed 7, not 20: about 45 s, **26 s more**.
  The dip's warning is up for 2 sim seconds, and a frame steps min(frame, 0.25 s) times the speed;
  the Live screen draws at about 9 fps headless (`perf.fps`, about 110 ms a frame), so at speed 20
  a frame can step 2.2 s and jump the whole warning. At speed 7 a step is 1.75 s at most, so a
  frame always lands in it (`tests/live-dip-watch.test.ts`). A spec that must see a 2 s window
  runs at speed 7 or less; one that reads histories can stay at 20.
- `hud.spec.ts` gains the title's pause-menu test, about **7 s**. The HELD check under the C5
  scene and the C4.lux.cut check after it add nothing measurable.
- With the restaged-HUD test (about 40 s), the file now runs in about 155 s.

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
| tech: `live-skeleton` 75, `live-perf` 45, `voice` 15, `live-tour` 30 |        165 |
| art3d: `art.spec.ts`                                                 |         30 |
| learning: `teaching.spec.ts`                                         |        150 |
| **Live total**                                                       |    **885** |
| Existing suite                                                       |        616 |
| **All**                                                              |   **1501** |

- **Under the 900 s cap in force today**, only the M1 specs fit: 616 + 75 (`live-skeleton`) + 30
  (`art.spec`) = 721 s, which leaves a **179 s reserve**. No M3 spec can merge until the cap is
  raised.
- **Under decision D9's 1800 s** (tech-9), the full table is 1501 s, which leaves a **299 s
  reserve**. Measured, `live-skeleton` costs 75 s, not the 10 s the plan drafted, `live-perf`
  41 s (one page to midnight, the rescue clicked through) and `voice` 13 s. That makes the tech row
  165 s rather than 90 s, and the reserve 299 s rather than 374 s. tech-8 folds the
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
