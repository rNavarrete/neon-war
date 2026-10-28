# Live screen wording pass (learning-3)

One read of every lane's section of `docs/SCRIPT.md` (board, gauges, comms, chat, luxcam, learning) and of
`src/scenes/hud/labels.ts`, before M4 closes. The rules: every line the player reads on the Live screen is
plain, short, consistent and in the crew's voice, and no line prints a C8 debrief term (the bold words in
`C8.terms.*`, plus the stems `tests/teaching.test.ts` bans) before the debrief. Line ids, numbers and rules
did not change; only wording did. A line that was already clear was left alone, even where another phrasing
was possible.

**Status: draft pending decision D8.** Every new alert line, teaching line, chat reaction and label below,
changed or not, waits on Rolando's review of the wording (D8). Nothing in this pass is approved yet.

## Changed lines

| ID | Old | New | Why |
| --- | --- | --- | --- |
| C4.alert.refresh | They're hitting refresh: every call that fails comes straight back. | Everyone's hitting refresh: each failed call comes straight back. | names who, in TRIAGE's words (C4.triage.03) |
| C6.alert.dip | Everyone calls and streams at once, and one rack loses power just before midnight. | Everyone calls and streams at once. One box loses power just before midnight. | "box" is the screen's word for a server; shorter |
| fill.stream.surge.02 | chat is flooding in | the neighbours are all piling in | read as viewers flooding in (the RAID reading D8 rules out) |
| C5.chat.lb | who are these people in her goggles?? | what did they just plug in for her?? | repeated fill.stream.rescue.01; now points at the crew's gift |

## Changed labels and on-screen copy outside SCRIPT.md

These are UI micro-copy, not lines: they have no voice and no id in `LINES`.

| Where | Old | New | Why |
| --- | --- | --- | --- |
| labels.ts `plates.splitter` | SPLITTER · shares the calls across every box wired behind it, and passes over a dark one | SPLITTER · shares the calls across every box wired behind it, and skips a dark one | same verb as Rei (C5.rei.03) and the SKIPPED tag |
| labels.ts `plates.state.skipped` | the splitter passes it over | the splitter skips it | same verb as Rei and the SKIPPED tag |
| board/tray.ts, the crew card's printed name | BALANCER | SPLITTER (`LABELS.plates.names.balancer`) | "balancer" is a C8 term (Load balancer) |
| board/tray.ts `lockedReason('balancer')` | the crew hasn't given you a load balancer | the crew hasn't given you one of those (`LABELS.inventory.splitterLocked`) | printed a C8 term on screen |
| board/crew.ts `placeBalancer` second refusal | the balancer is already racked | the splitter is already racked | printed a C8 term stem on screen |

The tray card's hook `label` stays `BALANCER`: the hook is never drawn, and browser tests key on the card id.

## Pins updated with the new wording

- `tests/board-layout.test.ts`: `lockedReason('balancer')` now matches `/the crew hasn't given you one of those/`
  (was `/load balancer/`).
- `tests/browser/board.spec.ts`: the locked card's refusal now matches `/the crew hasn't given you one of those/i`
  (was `/load balancer/i`).
- `tests/board-inventory.test.ts`: the InventoryView's drawn card titles now contain `splitter` (was
  `balancer`).
- `src/strings.ts` follows `docs/SCRIPT.md` word for word (`tests/strings.test.ts`).
- New cases in `tests/teaching.test.ts` ("the wording pass (learning-3)") pin each change above.

## Read and left as they are

- Gauges anchor: C3.alert.title, C3.alert.down, C4.alert.title, C6.alert.title, C6.alert.held, C6.alert.dark,
  C7.alert.title. BLOCK DOWN (a failure, before the rewind) and BLOCK DARK (midnight) stay two words for two
  moments.
- Chat anchor: every reaction but fill.stream.surge.02. None names a fix, a digit or a term.
- Learning anchor: C4.chat.dark, C6.chat.dark, C7.chat.01, fill.block.dark.01, fill.block.dark.02.
- Board, comms and luxcam anchors have no lines yet.
- labels.ts: every other label. `your guess stays free`, `COMING /s`, `ROOM LEFT` and `SPLITTER (crew gift)` are
  the D8 draft words and are pinned by `tests/teaching.test.ts`.

## Re-record

Lines whose wording changed and need new voice recordings (ja and en), if they are voiced:

- C4.alert.refresh
- C6.alert.dip
- fill.stream.surge.02
- C5.chat.lb
