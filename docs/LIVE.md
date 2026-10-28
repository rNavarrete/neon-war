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
| `gauge`     |   16 | 710 |  408 | 170 | gauges  | The demand gauge                                           |
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
There is no estimate step: the dial card and the C6 sizing prompt are gone, and nothing is drawn
over the top right of the feed (`live-gauges.spec.ts` checks it).

| Card           |    x |   y |   w |   h | Centre     | When                                                   |
| -------------- | ---: | --: | --: | --: | ---------- | ------------------------------------------------------ |
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
live `flags` getter. `update` runs every frame and must not allocate: it reads the shared `Frame`,
the HUD clock `{now, dt}` (real seconds times the test speed, stopped while the board is held; each
frame's raw length capped at 0.25 s as `run().tick` caps it, so it keeps step with the sim) and
this frame's occurrences, and moves only what changed.

`src/scenes/live/registry.ts` has one line per zone naming the view class that draws it. A lane
replaces its own line when its view lands and touches no other. The feed and the inventory are the
board's and have no line; `BoardScene` draws them. A zone whose view had not landed showed a
`PlaceholderView` (a dashed outline and the zone's name, under everything the HUD draws, never
interactive, two objects). Since M5 every line names its real view, so `live.placeholders` is empty
(`tests/live-flags.test.ts`, `live-skeleton.spec.ts` and `live-tour.spec.ts` check it).
`PlaceholderView` and `placeholderZones()` stay so a new zone can start as one and the hook can
prove none is left.

| Zone    | View (registry line)                    | Lane   |
| ------- | --------------------------------------- | ------ |
| `title` | `TitleView` (`src/scenes/hud/TitleView.ts`) | gauges |
| `alert` | `AlertView`                             | gauges |
| `clock` | `ClockView` (`src/scenes/hud/TitleView.ts`) | gauges |
| `map`   | `MapView`                               | gauges |
| `cam`   | `LuxCamView`                            | luxcam |
| `gauge` | `GaugeView`                             | gauges |
| `scope` | `ChartView`                             | gauges |
| `comms` | `CommsView`                             | comms  |
| `deck`  | `DeckView` (with `HeadroomView`)        | gauges |
| `chat`  | `ChatFeedView`                          | chat   |

`HudScene` hosts the registry: it makes every view in `init`, calls `preload`, `create` (first, so
placeholders sit under the HUD's own objects), `update` each frame and `shutdown` with the scene.
Each frame, after the views' `update`, the host loop runs the trigger table
(`src/scenes/hud/cues.ts`): `cueViewOf` builds the cues' view from the frame, its occurrences, the
HUD clock and what only the HUD knows (into one reused object), `direct()` fires what is due, and
each fired id goes out on the bus as `cue {id, kind: 'bark' | 'chat', at}` (`at` is the HUD clock).
Bark ids go to the comms band's queue and chat ids to the chat; `C6.fail.chat` is the chat going
silent, never a row, and no filler is posted while `chatSilenced` holds (until the rewind).
`hud.cues {fired, silenced}` mirrors it for tests.

### Flags

`src/scenes/live/flags.ts`: `flagsFrom(search)` gives `{lite}`; `lite` is true under `?test` and
means reduced effects (no decorative particles, parallax or pulses). Lite changes looks only, never a
hook value. Views read it through `host.flags`.

### The frame and its occurrences

`src/game/frame.ts`: `frame(run)` is the one read of the run per sim change, shared by every view
(the flow, offline parts, capacity and wired capacity, demand, retries, served/dropped/error share,
the warnings, the dips, the waiting flags, the rewinds, the notes). It returns the identical object
until the play, the notes or a hold changes, so views never call `run().flow` themselves.

Every `Frame` field (`tests/live-docs.test.ts` checks this list against the interface):

| Field | What it holds |
| --- | --- |
| `now` | Sim seconds since the clock opened at 23:51:30 |
| `clock` | The in-world clock as hh:mm:ss |
| `speed` | The test speed multiplier (1 in play) |
| `paused` | Something holds the board (a card, a scene, the pause menu) or a failure waits for its rewind |
| `timeScale` | 0.25 while Regroup runs, otherwise 1 |
| `waitingForFirstBuild` | C1 waits for a server wired gateway to database; the clock holds |
| `waitingForCrewBuild` | After the rescue the clock waits until the servers behind the balancer can carry the tail |
| `parts` | The parts on the board |
| `wires` | The wires on the board |
| `credits` | Credits in hand |
| `trust` | The block's trust |
| `offlineUntil` | Parts booting or rebooting, by id: the sim time they come back |
| `flow` | The routing of this frame's demand over the board, read once |
| `demand` | Req/s the block sends now, after retries |
| `blockDemand` | Req/s the block sends before retries: the curve less the laundry cut |
| `retry` | How far retries have pushed demand up, 0 to 0.5 |
| `capacity` | Req/s every live server could serve, wired or not |
| `wiredCapacity` | Req/s the live servers wired gateway (or balancer) to database can serve |
| `served` | Req/s served |
| `dropped` | Req/s dropped |
| `errorShare` | Share of demand that fails, 0 to 1 |
| `offline` | Part ids serving nothing now: booting, rebooting, dead or dark in a dip |
| `flickering` | Part ids showing the 2 s power-flicker warning |
| `dark` | Part ids dark in a power dip right now |
| `overheating` | Server ids over 100% load, counting down to death |
| `overload` | Seconds each overheating server has spent over 100% load, by id |
| `dead` | Server ids that died from overheating and wait to be replaced |
| `dips` | Every power dip whose warning has started, with its part picked |
| `dip` | The dip whose flicker warning is showing (`{partId, at}`), or null |
| `surge` | The surge warning on screen, or null |
| `fall` | The after-midnight forecast (`{demand}`), or null |
| `laundryCut` | When the laundry cut was taken (`{at}`), or null |
| `laundryCutAvailable` | The laundry cut is offered now (the district surge, before the crew) |
| `rescued` | The crew has come in this run (a rewind before the rescue clears it) |
| `rescue` | When and why the crew came in (`{at, by}`), or null |
| `regroup` | `{charges, handedOver, left}` for the Regroup key |
| `banner` | The C2 banner's answer (`{choice, at}`), or null |
| `midnight` | The stroke of twelve's result, or null before it |
| `failure` | The failure the board froze on, or null |
| `rewinds` | Every rewind so far |
| `crewMet` | The crew has arrived at least once; kept across rewinds |

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

Every event in `GameEvents`, the older ones first (`tests/live-docs.test.ts` checks this table
against `src/game/bus.ts`):

| Event | Emitted by | Payload |
| --- | --- | --- |
| `action` | `run.ts`, for a board move that worked | `{type: 'place' \| 'wire' \| 'cut' \| 'decommission' \| 'overclock' \| 'banner' \| 'laundryCut', ...}` |
| `refused` | `run.ts`, BoardScene, for a move the rules refused | `{reason}` |
| `sfx` | the run, the board, the HUD, the shell, the story | `{key, loop?}` |
| `sfxStop` | the story layer, ending a looped sound | `{key}` |
| `overheat` | `run.ts`, a server goes over 100% load | `{id}` |
| `serverDied` | `run.ts`, a server dies from overheating | `{id}` |
| `powerDip` | `run.ts`, a dip's warning ends and the part goes dark | `{id}` |
| `rescue` | OverlayScene, the crew's cable drops | `{}` |
| `crewArrived` | `run.ts`, the sim brings the crew in | `{by}` |
| `failure` | `run.ts`, the board froze on a failure | `Failure` |
| `midnight` | `run.ts`, the stroke of twelve | `Midnight` |
| `sessionEnd` | `run.ts`, the clock reached 00:01:00 | `{}` |
| `occurrence` | HudScene, once per edge between two frames | `Occurrence` |
| `drag` | BoardScene (above) | `{kind, card, over, state?, legal?}` |
| `line` | CommsView (above) | `{id, speaker, tag, lesson, since}` |
| `lineEnd` | CommsView, the band line ended or was pre-empted | `{id}` |
| `chatLine` | declared for the chat lane; nothing emits it yet (the chat reads `cue`) | `{chat, id, who, text, at}` |
| `alert` | AlertView, an alert went up | `{kind, line, text, at}` |
| `alertEnd` | AlertView, that alert came down | `{kind}` |
| `voice` | CommsView, the story layer: asks the mixer for a clip | `{id}` |
| `voiceStart` | the mixer, the clip started | `{id, seconds}` |
| `voiceStop` | CommsView, the story layer: stop the clip early | `{id}` |
| `voiceEnd` | the mixer, the clip finished or was stopped | `{id}` |
| `cue` | HudScene's host loop (above) | `{id, kind, at}` |
| `audience` | ChatFeedView (above) | `{watching}` |
| `perfSample` | HudScene, once per perf sample | `{at, fps, objects, texts, graphics}` |

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

The sections the views add, beside the host's own keys (`ready`, `now`, `jobCard`, `chart`,
`surge`, `dip`, `dipMark`, `banner`, `bark`, `cues`, `bounds`...):

| Section | Provided by | What it mirrors |
| --- | --- | --- |
| `hud.title` | TitleView | `{live, watching, right, clockRight, avatar, scenePaused}`: the LIVE dot (`held` while a story scene or the pause menu pauses the HUD), WATCHING, the round avatar's baked texture, the right edges |
| `hud.audience` | the chat view (`live/views/chat.ts`) | `{watching}`: the last bus `audience`, null before the first |
| `hud.chat` | ChatFeedView | the merged feed, the drawn rows, the filter and header, the quiet window, `block` and `stream` kept |
| `hud.comms` | CommsView (`live/views/comms.ts`) | the band line, the five slots, `queue`, `history`, `dropped`, the reread log, the TRIAGE mood |
| `hud.bark` | the host, from CommsView | `{current, text, history}`, the band's shown lines (the older name) |
| `hud.luxCam` | LuxCamView | the mood, the art, `history` of moods, REC, the frame, `speaking`, `motion` |
| `hud.alert` | AlertView | the alert up now and its kind, line, tag and text; `hint` and `hintText`, the start-of-C1 hint ("drag a SERVER card onto a glowing pad") while no alert is up |
| `hud.gauge`, `hud.chart` | GaugeView, ChartView | the COMING /s gauge; the scope's series over the host's `chart` |
| `hud.map` | MapView | the city map's dots, raid outlines and midnight |
| `hud.deck`, `hud.headroom`, `hud.regroup`, `hud.laundry` | DeckView | the keys and their states, the room-left bar, Regroup and the laundry cut |
| `hud.chatArt`, `hud.chatTrace` | ChatFeedView | which chat art loaded or fell back; the trace of rows posted, with their cause |
| `hud.measure`, `hud.taught` | `src/scenes/hud/taught.ts` | the board's wires and when the first went in; the trace of moments the night taught, for the debrief's grey lines |

Outside `hud`: `shell.voice` (the mixer: `recentVoice`, `missing`, `playing`, `started`, `groups`), `avatars.baked`
(every round avatar baked, as `avatar:<key>@<size>`), `art` (the art manifest's resolutions),
`board`, `story`, `live` and `perf`.

Every top-level section of `window.__neonTest.state` (each `provideTestState` call;
`tests/live-docs.test.ts` checks the list against the source):

| Section | Provided by | What it mirrors |
| --- | --- | --- |
| `scene`, `ready`, `canvas` | `src/main.ts` (`TestSnapshot` in `src/testHook.ts`) | the scene on top, whether it is ready, the canvas size |
| `board` | BoardScene | parts, wires, pads, the tray, packets and `board.channel` (the channel at the feed's left edge: `demand`, `max`, `level`, `capacityLevel`, `marks`, lanes) |
| `hud` | HudScene, with every `hud.<name>` above | the HUD's keys and the views' sections |
| `live` | HudScene (`src/scenes/live/hook.ts`) | `zones`, `placeholders`, `layoutVersion` |
| `perf` | HudScene (`PerfMeter`) | the display-list counts (see "Perf budget") |
| `story` | `src/story/state.ts` | the story scene up now, its click and Skip points, `finished` |
| `shell` | OverlayScene | the shell's menus and `shell.voice`, the mixer |
| `avatars` | `src/scenes/avatars.ts` | `avatars.baked` |
| `art` | `src/scenes/plates.ts` | the art manifest's resolutions |
| `debriefSeen` | DebriefScene | the debrief's "you saw it at" lines |
| `settingsScreen` | SettingsScene | the settings screen's controls |

`tests/browser/live-tour.spec.ts` reads at least one field of every zone's section (`hud.title`,
`hud.alert`, `hud.clock`, `hud.map`, `hud.luxCam`, `hud.gauge`, `hud.chart`, `hud.comms`,
`hud.deck`, `hud.chat`), `board.channel` and `shell.voice`, at the surge and at midnight, in one
run.

## Lanes and ownership

Each file has one owning lane. A lane edits its own files, its one registry line and its anchored
section of `docs/SCRIPT.md` and `src/strings.ts`; a change it needs in another lane's file goes to
that lane. `src/sim/` is frozen (only decision D2 could open it), and the protected paths in
`CLAUDE.md` belong to Rolando.

| Lane | Zones | Source files | Tests |
| --- | --- | --- | --- |
| tech | none (the host, the contract) | `src/game/run.ts`, `flow.ts`, `director.ts`, `frame.ts`, `occurrences.ts`, `bus.ts`, `mixer.ts`, `audio.ts`, `src/main.ts`, `src/testHook.ts`, `src/scenes/live/` (`layout.ts`, `view.ts`, `registry.ts`, `flags.ts`, `hook.ts`; lanes edit only their registry line), `src/scenes/HudScene.ts`, `src/scenes/hud/layout.ts`, `src/scenes/hud/hook.ts`, `src/scenes/OverlayScene.ts`, `docs/LIVE.md`, `docs/AUDIO.md` | `live-layout`, `frame`, `occurrences`, `live-flags`, `live-docs`, `mixer`, `hud-layout`; `tests/browser/live/reach.ts`, `live-skeleton`, `live-perf`, `live-tour`, `voice`, and the existing `hud`, `board`, `story`, `boot`, `shell` specs |
| board | `feed`, `inventory` | `src/scenes/BoardScene.ts`, `src/scenes/board/` (layout, tray, view, packets, hook, crew, channel, anim, ghost, InventoryView) | `board-layout`, `board-view`, `board-packets`, `board-channel`, `board-anim`; `board-live.spec.ts` |
| gauges | `title`, `alert`, `clock`, `map`, `gauge`, `scope`, `deck` | `src/scenes/hud/` TitleView, title, alerts, AlertView, gauge, GaugeView, headroom, HeadroomView, thresholds, cityMap, MapView, deck, DeckView, ChartView, chartRing, warnings, pending503, regroup, jobCard, format, panel | `hud-title`, `hud-alerts`, `hud-chart`, `hud-gauge`, `hud-headroom`, `hud-map`, `hud-deck`, `hud-format`; `live-gauges.spec.ts` |
| comms | `comms` | `src/scenes/hud/comms.ts`, `CommsView.ts`, `locate.ts`; `src/game/voice.ts`, `settings.ts`, `settingsControls.ts`, `src/scenes/SettingsScene.ts`; the voice emits in `StoryScene.ts`, `src/story/view.ts`, `src/story/state.ts` | `hud-comms`, `game-voice`, `shell-audio`; `comms.spec.ts` |
| chat | `chat` | `src/scenes/hud/chatEngine.ts`, `ChatFeedView.ts`, `chat.ts` | `hud-chat`, `hud-chat-engine`; `chat.spec.ts` |
| luxcam | `cam` | `src/scenes/hud/luxcam.ts`, `LuxCamView.ts`, `src/game/portraits.ts` | `hud-luxcam`; `luxcam.spec.ts` |
| learning | none (the words and the debrief) | `src/scenes/hud/cues.ts`, `lineMeta.ts`, `labels.ts`, `taught.ts`, `src/game/autopilot.ts`, `src/scenes/DebriefScene.ts`, `src/story/debrief.ts`, `src/story/wiring.ts`, `src/strings.ts` and `docs/SCRIPT.md` (each lane edits only its anchored section) | `hud-barks`, `strings`, `teaching`; `teaching.spec.ts` |
| art3d | none (the art) | `src/game/artManifest.ts`, `src/scenes/plates.ts`, `avatarCrop.ts`, `avatars.ts`, `motion.ts`, `docs/ART-REQUESTS.md`, `docs/ART.md` | `art-manifest`, `avatar-crop`, `motion`; `art.spec.ts` |

## Perf budget

The hot-part glow (art3d-6, `GLOW_PROBE_ON` in `src/scenes/motion.ts`): at most three red Glows on
parts over capacity and one 1.5 s GradientMap after the rescue. Measured 28 Oct 2026 at the surge
(headless, speed 20): `perf.frameMs` about 118.5 ms with it on, 112.3 ms off, inside run-to-run noise
(headless baseline about 110 ms), so it stays on. Flipping that one constant drops it.

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
- `perf.host`: the HUD objects that no view made (the cards, the legacy pieces).
- `perf.pools[name]`: the size of each pool registered with `registerPool(name, size)`.
  `pools.packets` is the board's packet sprites, made once and reused.
- `perf.filters`: live Glow and GradientMap filters on objects and cameras (art3d-6's probe).
- `perf.fps.avg` and `perf.frameMs`: the frame rate and the mean real milliseconds per frame
  since the sample before.
- `perf.lite`: the lite flag.

No view reads the meter, and it allocates nothing per object.

### Budgets

The global budget is 750 objects and 110 texts across board and HUD. `live-perf.spec.ts` checks it
at the C4 surge and at midnight: all objects against 750, the drawn texts and all texts (hidden
ones included) against 110, and the board's texts against 28. It also checks three more things:

- Every registered view's `actual` stays within its `budget`.
- `pools.packets` stays at or below 160.
- The pool stops growing: two reads 5 s apart after the rescue are equal.

Per zone, the text budgets sum to 110. A registered view's budget is the one it declares in code,
and each row below is that declaration (`tests/live-perf-table.test.ts` checks both columns
against the built views):

| Zone / owner                                         | Texts | Objects (declared) |
| ---------------------------------------------------- | ----: | -----------------: |
| `title` (TitleView)                                  |     5 |                 11 |
| `alert` (AlertView)                                  |     4 |                 10 |
| `clock` (ClockView)                                  |     2 |                  4 |
| `map` (MapView)                                      |     3 |                 10 |
| `cam` (LuxCamView)                                   |     2 |                 15 |
| `gauge` (GaugeView)                                  |    10 |                 13 |
| `scope` (ChartView)                                  |     5 |                  7 |
| `comms` (CommsView, with the leader line)            |    13 |                 29 |
| `deck` (DeckView with HeadroomView)                  |     8 |                 21 |
| `chat` (ChatFeedView)                                |    17 |                 31 |
| `feed` and `inventory` (BoardScene)                  |    28 |                  - |
| Cards (HUD host: job card, banner, dip)              |    13 |                  - |
| **Total**                                             | **110** |                  |

The chat feed's five rows of name and words need 17 texts, so the host's cards give up 7 of their 20 to keep the total at 110. The host makes 8 of its 13 since the dial card and the sizing prompt went with the estimate step (`HOST_TEXTS` in `src/scenes/hud/cardText.ts`, `tests/hud-card-text.test.ts`, and `perf.host.texts <= 13` in `live-skeleton.spec.ts`):

- **Job card and banner, 7.** The C1 job card (rate, title, who, what, bar, pay line, OK) and the
  C2 Solace banner (title, body, three button words) never show together: the banner waits for the
  card to close. They share one pool of seven texts, made once, which the host moves into whichever
  card opens and dresses from `jobCardTexts()` or `bannerTexts()` (two stay hidden on the banner).
  Every word either card showed before is still on it.
- **Dip warning, 1.**

The legacy pieces (the old chat column, the HUD's own deck digits, the old alert line) are gone,
so nothing else on the host is a text.

Measured on 28 Oct 2026 (speed 20 with autopilot, headless), after the M3 wave 2 merge (the cam,
the comms band's leader line and the leader's locate points):

- **Objects.** 616 at the surge (440 board + 176 HUD) and 632 at midnight (456 + 176), inside 750.
- **Every view.** Each registered view is at or under its declared budget (the rows above).
- **Host.** 33 objects and 13 texts.
- **Drawn texts.** 78 at the surge and 71 at midnight.
- **All texts, hidden ones included.** 102 at the surge (20 board + 82 HUD) and 105 at midnight
  (23 + 82), so the whole count is now inside 110 too: the board's 20 to 23 are inside its 28.
  `live-perf.spec.ts` now asserts all texts against 110 and the board's against 28.
- **Packets.** The pool holds at 116 from the surge to midnight.
- **Frame rate.** 8.7 fps at the surge and 9.0 at midnight (about 112 ms a frame).

Measured earlier on 28 Oct 2026, after the host's cut to 13:

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

Since tech-9 (decision D9) `scripts/check.mjs` caps the Playwright step at **1800 s**, and CI runs
the browser tests as four parallel shards split by file (`docs/checks.md`, "Sharded e2e"). The e2e
step in `check-evidence.json` is merged from the four shards, and its time is the **slowest
shard's**, so the gate that matters is that step's time: under **1500 s**, inside the 1800 s cap.
Each shard job has its own 25-minute CI timeout and the same 1800 s cap on its Playwright run.

Per lane, for its spec file (one spec file per lane), the planned budget and what was measured:

| Lane / spec                                                          | Budget (s) |
| -------------------------------------------------------------------- | ---------: |
| board: `board-live.spec.ts`                                          |        150 |
| gauges: `live-gauges.spec.ts`                                        |        150 |
| comms: `comms.spec.ts`                                               |         90 |
| chat: `chat.spec.ts`                                                 |         90 |
| luxcam: `luxcam.spec.ts`                                             |         60 |
| tech: `live-skeleton` 75, `live-perf` 45, `voice` 15, `live-tour` 45 |        180 |
| art3d: `art.spec.ts`                                                 |         30 |
| learning: `teaching.spec.ts`                                         |        150 |
| **Live total**                                                       |    **900** |
| Existing suite                                                       |        616 |
| **All, serial**                                                      |   **1516** |

- **`live-tour.spec.ts` (tech-8)** is one test, one page load at speed 20 with autopilot, to the
  surge and on to midnight with the C5 rescue clicked through. Measured on the cloud worker on
  28 Oct 2026: about 42 s for the test and 51 s for the file with the worker's start. Its budget is
  45 s, 15 s over the plan's 30 s, because midnight alone costs 40 s from boot (see "Measured
  floors").
- **Serial, the table adds up to 1516 s**, just over 1500 s. Measured serial runs are longer: the
  whole suite took about 27 minutes in one job (`docs/checks.md`), which is why CI shards it.
  Nothing gates on the serial total.
- **Sharded, the e2e step is the slowest shard.** From measured per-file times the four shards run
  about 6.4, 7.7, 8.5 and 4.2 minutes of tests (`docs/checks.md`), so the step takes about 510 s,
  well under 1500 s. `live-tour` adds about 51 s to whichever shard Playwright gives it; even the
  slowest shard with it stays under 600 s. This is a projection from local and earlier CI timings:
  only a CI run's `check-evidence.json` on the candidate commit shows the real figure.
- **Folding the moment tests.** The plan had `live-tour` replace `live-skeleton.spec.ts`'s two
  reach tests (surge within 25 s, midnight within 50 s; about 67 s together). That file is not
  tech-8's to edit in this lane, so both still run; folding them would save about 67 s serial.
- **Raising the cap is a control change.** `scripts/check.mjs` and `.github/workflows/ci.yml` are
  protected paths. Only the owner (Rolando) can change the cap and the CI job timeout. No lane
  edits them, and no lane gets under the cap by weakening an assertion.

Rules for every Live spec:

- Call `test.setTimeout` with the spec's own measured cost plus a margin.
- Run at speed 20 with autopilot through `reach`. Use speed 5 only for the C4 laundry-cut click.
- Write one test per lane that goes past C4, and reuse one page load for everything after a
  moment.
- Take at most 3 screenshots per lane, through `shot`.
- Assert on histories (`bark.history`, `story.finished`, `seen`) rather than on what is current,
  because at speed 20 the current value moves between reads.
- Before a lane adds seconds, record what its spec costs and update this table.
