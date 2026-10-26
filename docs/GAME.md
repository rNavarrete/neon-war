# Neon War: Session 0, Brownout

Levels are called **sessions** (Lux "jacks in" for a session). Brownout is session 0: the tutorial and the
whole MVP. The full spec, with the reasoning behind every choice, is the Brownout session spec
(https://claude.ai/artifact/WsaFpkAYob7fyJXfrCWLNT). Where docs/PRD.md disagrees with this file, this file
wins.

## Pitch

A painted cyberpunk system-design game in the browser. It is New Year's Eve in Halation. Lux Takahashi, 15,
keeps her slum block's net alive against the midnight countdown, nearly loses it when the district piles on,
and is rescued by the Night Shift crew. About 10 minutes.

The lesson is **demand decides the design**: read how much traffic is coming, build just enough to fit, and
watch it hold or fail. The player does that four times with less help each time. Real terms (throughput,
capacity, peak load, headroom, load balancer, N+1) are named only in the debrief.

## Two layers

- **Scenes** play like a visual novel: a full background, a mostly still portrait of the speaker (dimmed when
  not speaking), a nameplate, a typewriter text box and Lux's stream chat in a corner. Click to advance; scenes
  can be skipped on replay.
- **The board** is what Lux sees through her AR goggles, laid over her bedroom. The board never pauses for
  story: lines during play are short **barks** (small portrait plus one line).
- At the rescue the crew pulls her into their digital space: one scripted full-immersive board backdrop.

## Cast on the board

- **TRIAGE**: Lux's own home-made assistant AI, living in her camera drone. Its iris is its face. Eager,
  chatty and sometimes wrong: it rounds numbers badly, trusts the Solace banner and panics in the cascade. It
  points and guesses but never gives the answer. Moods: eager, thinking, wrong-and-proud, panicking, sheepish,
  happy.
- **The Night Shift crew**: Rei Kuroda (lead, name not final), Mika Santos and Ozzie. Their advice is
  opinion, not orders.
- **Solace Systems**: the megacorp. Its banner is deliberately too clean.

## Flow

The clock opens at 23:51:30 and midnight lands at the peak of the final surge.

| #   | Real time | Clock    | Layer  | What happens                                                                                     | What it teaches                                                  |
| --- | --------- | -------- | ------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 0   | 0:00      | 23:51:30 | Scene  | Cold open: rain, fireworks, Lux alone with her mum's photo; she pulls her goggles down. 15 s, no input. | The world and the stakes.                                        |
| 1   | 0:15      | 23:51:45 | Board  | One scrap server, about 30 req/s. TRIAGE: "Count what's coming."                                 | Read demand; one server fits; overbuilding burns credits.        |
| 2   | 1:30      | 23:53    | Board  | Solace banner: "Priority service, 200 credits." Pay, Ignore or Bin.                              | Credits and choices; buying blind.                               |
| 3   | 3:00      | 23:54:30 | Board  | Demand climbs to about 90 against 60. A second server helps only once traffic reaches it.        | Add capacity when demand passes it; it only counts if reached.   |
| 4   | 5:00      | 23:56:30 | Board  | Warning: about 250 req/s in 10 s. Server overheats and dies, retries pile up, database times out. Optional: cut the laundry floor loose. | Forecasts, cascading failure, load shedding. |
| 5   | 6:00      | 23:57:30 | Scene, then board | The crew breaks into her goggles, drops a load balancer and hands over Regroup.        | Load balancer; advice as opinions.                               |
| 6   | 7:30      | 23:59    | Board  | Crew goes quiet. Forecast: 150 req/s at midnight, a power dip 10 s before. "Your call. How many?" | The whole loop alone; build for the peak plus one spare.        |
| 7   | 9:00      | 00:00:30 | Scene  | Goggles up, back in her room. Rei grades the night. First Night Book page.                       | Real terms named for the first time.                             |

**Losing is gentle.** There is no game-over screen. If trust hits zero before the rescue, the crew arrives
anyway and Rei rewinds to the start of the cascade. If the build fails at midnight, the block goes dark on the
stroke of twelve and Rei rewinds to one minute to midnight.

## Rules and numbers

Rules live in `src/sim/` as pure TypeScript. These are draft numbers; Rolando tunes them by playing, so code
keeps every number in one constants object.

**Parts on the board:** gateway (feeds one part only), scrap server, residents' database, load balancer
(crew gift, fans out evenly to every server wired behind it). Every other part is shown in the tray but
locked.

| Thing                   | Value                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| The block               | 120 flats, each calling about every 4 s: 30 req/s                                           |
| Scrap server capacity   | 60 req/s                                                                                    |
| Evening climb (beat 3)  | ramps to 90 req/s                                                                           |
| District surge (beat 4) | 250 req/s, warned at least 10 s ahead                                                       |
| Final surge (beat 6)    | 150 req/s, peaking at midnight                                                              |
| Starting credits        | 400                                                                                         |
| Starting trust          | 100 (the neighbours)                                                                        |
| Scrap server            | costs 80 credits, takes 3 s to boot before it serves                                        |
| Server upkeep           | 5 credits per running server per minute                                                     |
| Load balancer           | free, given by the crew at the rescue                                                       |
| Rescue loan             | Ozzie fronts 100 credits at the rescue                                                      |
| Solace banner           | 200 credits for 60 s of extra capacity                                                      |
| Trust                   | drains 10 per second at a 100% error rate (scaled by the error share); recovers 1 per second while there are no errors; stays between 0 and 100 |
| Overheating             | a server over 100% load for 8 s dies                                                        |
| Retries                 | failed requests come back: demand rises by up to 50% while errors last                      |
| Power dips              | 2 s flicker warning, then the part is dark for 20 s; scripted in the cascade, one seeded dip 10 s before midnight |
| Regroup                 | quarter speed for 10 s, once per session, handed over at the rescue                         |
| Rescue trigger          | trust under 30, or 45 s into the district surge                                             |
| Final sizing            | 4 servers ride out the dip; 3 hold only with a fast replacement; 2 drop requests; 6 or more waste credits |
| Debrief grade           | dropped requests, wasted credits, trust left, banner choice                                 |

What the economy is meant to produce at the final surge:

| Path                      | Credits at the final surge   | What the player can build                                  |
| ------------------------- | ---------------------------- | ---------------------------------------------------------- |
| Skipped the banner        | about 360                    | 4 servers (one spare) with about 200 left                  |
| Paid the banner           | about 160                    | exactly 4 servers, nothing left for a mistake              |
| Built extra servers early | less, upkeep ran longer      | the overbuild shows up as less to spend at midnight        |

Not set yet: the cost of a replacement server mid-surge, the residents' database capacity, and the
debrief's grade thresholds. A ticket that needs one of these stops and asks.

## Screens

Desktop only, 16:9, built at 1920x1080 and scaled to fit.

| Screen           | When                              | What is on it                                                                  |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| Title            | On load                           | Logo, Start, Settings, Credits over the skyline                                |
| Scene            | Cold open, rescue, debrief        | Visual-novel layout (see Two layers)                                           |
| Board            | Beats 1 to 6                      | The board, parts, packets, the room behind it, and the HUD                     |
| Pause            | Esc or button                     | Resume, Restart session, Settings, Quit to title                               |
| Settings         | From title or pause               | Volume, text speed, reduce flicker, fullscreen                                 |
| Rewind           | Trust hits zero, or midnight fails | Short glitch, Rei's line, back into the board                                 |
| Debrief          | After midnight                    | Rei's grade per category, banner choice called out, terms named                |
| Night Book page  | End of debrief                    | Handwritten page with the lesson, then the title card ("Session 0: Brownout")  |

**Board HUD:** midnight countdown and in-world clock; demand-versus-capacity chart (the main readout); trust
and credits; parts tray with locked slots; Regroup button and its one charge; surge forecast warning with its
number; power-dip flicker warning on the part about to go dark; block chat and Lux's stream chat; crew and
TRIAGE barks; packet and part load readouts; the Solace banner with Pay, Ignore and Bin; the sizing prompt
before the final surge.

## Art and sound

Art is painted, not pixel art. It comes from the art pipeline (gpt-image-2, picked by Rolando) and lands in
`public/art/` only through a PR Rolando approves. Workers never add or edit art. Wires, packets, particles,
the chart, panels and text are drawn in code.

Sound: one board music loop (Suno, "Cell Shaped Chaos") and a small set of effects (ElevenLabs), loaded from
`public/` like all assets.

## Build order

1. Groundwork (this file, the painted-art rules, the routing plumbing in `src/sim/board.ts`).
2. Art pass: picks cut out and added to `public/art/`.
3. B1 rules: every number above as pure code, one unit test per number.
4. B2 board and HUD: browser tests drive the mouse.
5. B3 story layer: scene player, cold open, rescue, debrief, Night Book, rewind, barks; a browser test plays
   the whole session.
6. B4 menus and sound (may fold into B2 and B3).

## Brownout is done when

A stranger opens the game link, plays the full 10 minutes without help, and reaches the debrief and the first
Night Book page. Each ticket's acceptance criteria live in its contract, not in this file.
