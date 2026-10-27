# Neon War: Session 0, Brownout

Levels are called **sessions** (Lux "jacks in" for a session). Brownout is session 0: the tutorial and the
whole MVP. This file is the complete spec for building it: everything a task needs is here or elsewhere in
this repo. It was distilled from earlier design notes (the session spec and the Challenge Design, whose five
recommendations Rolando accepted on 27 Oct 2026); those notes are not needed to build or review anything.
Where docs/PRD.md disagrees with this file, this file wins.

## Pitch

A painted cyberpunk system-design game in the browser. It is New Year's Eve in Halation. Lux Takahashi, 15,
keeps her slum block's net alive against the midnight countdown, nearly loses it when the district piles on,
and is rescued by the Night Shift crew. About 10 minutes.

Neon War is a tool for learning system design above all else. The lesson is **demand decides the design**:
read how much traffic is coming, build just enough to fit, and watch it hold or fail. The player does that four
times with less help each time. Real terms are named only in the debrief.

## What Session 0 teaches

Session 0 is the first chapter of every beginner system design course, and nothing more: the interview
warm-up "How would you scale a web app from one server?" told as a story.

- Requirements (a job card), then a back-of-the-envelope estimate (users times how often they call).
- Throughput against capacity, and headroom (do not run at 100%).
- Scaling up (a bigger box) before scaling out, and the limits of scaling up.
- Single point of failure.
- Scaling out behind a load balancer, with health checks.
- Redundancy: the peak plus one spare (N+1).
- Seen but not mastered: cascading failure, retry storms, load shedding.
- Scaling back down after the peak (optional coda).

Not in Session 0: database work, caching, CDN, object storage, replication, queues, rate limiting, stateless
sessions, sharding, regions. Each gets a later session. The residents' database is on the board but is never
the player's problem.

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

The clock opens at 23:51:30 and runs in real time; midnight lands at the peak of the final surge, about 8½
minutes in. The estimating help fades: TRIAGE does C1's math out loud (badly) and the player corrects it, C3
gives the number, the crew argue numbers in C5, and C6 is the player alone.

| #   | Clock (real time)  | Layer  | What happens                                                                                     | Debrief names                                            |
| --- | ------------------ | ------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| C0  | 23:51:30 (0:00)    | Scene  | Cold open: rain, test fireworks, Lux alone with her mum's photo; she pulls her goggles down. Each line waits for a click; the last one brings the goggles down and starts the board at 23:51:45. | nothing yet                              |
| C1  | 23:51:45 (0:15)    | Board  | **Job card** (who: 120 flats; what must work; the bar: nobody goes dark at midnight; each flat calls about every 4 s). The player sets the **estimate dial** (answer 30 req/s), then places one scrap server and wires gateway → server → database. TRIAGE: "480 a second! I'm great at math." | requirements, requests per second, capacity, estimate |
| C2  | 23:53:00 (1:30)    | Board  | **Solace banner**: "Priority service, 200 credits." Pay, Ignore or Bin. The chart shows 30 against 60: nothing to protect against. | overprovisioning                              |
| C3  | 23:54:30 (3:00)    | Board  | **Bigger or more?** Forecast: demand climbing to 90. The tray offers the **overclock kit** (scale up) beside a second server. A second server racked now sits idle, because the gateway feeds one part only. Doing nothing: the server overheats and dies, and TRIAGE offers its stream replay. | scale up, scale out, headroom |
| C4  | 23:56:30 (5:00)    | Board  | **District surge**, a scripted near-loss: 250 req/s warned 10 s ahead; the overclocked server pegs, a power dip takes it dark, retries climb toward 375, the database times out. Optional: **cut the laundry floor loose** (about 40 req/s). | single point of failure, cascading failure, retry storm, load shedding |
| C5  | 23:57:30 (6:00)    | Scene, then board | **Rescue.** The crew break into her goggles (the one full-immersive moment), drop a load balancer, Ozzie opens his tab, Mika hands over Regroup. The fried server is back at stock 60. Surge settles to 120: 3 servers behind the balancer. Mika says two, Ozzie says six, Rei says count it yourself. | load balancer, horizontal scaling, health check |
| C6  | 23:59:00 (7:30)    | Board  | **Midnight, your call.** Forecast 150 req/s, one rack loses power about 10 s before midnight for 20 s. The estimate dial now counts servers: 150 ÷ 60 = 2.5, so 3 hold the peak and **4** ride out the dip. | capacity planning, peak vs average, redundancy, N+1 |
| C7  | 00:00:00 (8:30)    | Board  | **Scale down** (optional, 30 s): fireworks; demand falls to 40 within 20 s while upkeep keeps ticking. Decommission down to 2. | scale down, elasticity, cost   |
| C8  | 00:01:00 (9:00)    | Scene  | **Debrief.** Goggles up. Rei grades the night; terms named in three groups (sizing, scaling, failure); Night Book page 1, "Demand decides the design"; the interview-version card. | everything above            |

**Losing is gentle.** There is no game-over screen.

- Before the crew exists (C1 to C3), a failure rewinds through **TRIAGE's stream replay**: "I recorded the
  last minute. Want to try that again?" It goes back to the start of the current challenge.
- If trust hits zero in the surge, the crew arrives anyway and Rei rewinds to the start of the surge.
- If the build fails at midnight, the block goes dark on the stroke of twelve and Rei rewinds to 23:59.

## Rules and numbers

Rules live in `src/sim/` as pure TypeScript. These are draft numbers; Rolando tunes them by playing, so code
keeps every number in one constants object.

**Parts on the board:** gateway (feeds one part only, no health check), scrap server, residents' database,
load balancer (crew gift at the rescue). The load balancer splits traffic evenly across the servers wired
behind it and **health-checks** them: a server that is dark, dead or still booting is skipped and gets a grey
"skipped" tag, and its share goes to the live ones. Every other part is shown in the tray but locked.

| Thing                   | Value                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| The block               | 120 flats, each calling about every 4 s: 30 req/s                                           |
| Scrap server            | 60 req/s; costs 80 credits; takes 3 s to boot before it serves                              |
| Replacement server      | the same: 80 credits, 3 s boot (that boot is why 3 servers only hold at midnight with a fast replacement) |
| Overclock kit           | 60 credits; doubles one server to 120 req/s; the server reboots for 3 s and drops traffic meanwhile; one kit per server ("no bigger box in the slum") |
| Overclock burns out     | the overclocked server is the one that cooks in the surge; after the rescue it is back at stock 60 ("the kit fried") |
| Residents' database     | 200 req/s; never the bottleneck in normal play, only the retry pile in the surge (about 375) pushes it over |
| Evening climb (C3)      | ramps to 90 req/s                                                                           |
| District surge (C4)     | 250 req/s, warned 10 s ahead; with retries it climbs toward 375                             |
| Surge tail (C5)         | settles to 120 req/s for the next minute                                                    |
| Final surge (C6)        | 150 req/s, peaking at midnight                                                              |
| After midnight (C7)     | falls from 150 to 40 within 20 s                                                            |
| Laundry floor cut (C4)  | removes about 40 req/s of demand; those neighbours are annoyed                             |
| Starting credits        | 400                                                                                         |
| Starting trust          | 100 (the neighbours)                                                                        |
| Server upkeep           | 5 credits per running server per minute                                                     |
| Load balancer           | free, given by the crew at the rescue                                                       |
| Ozzie's tab             | at the rescue Ozzie fronts 100 credits, then covers any shortfall at midnight up to 200 more, as a debt shown in the debrief; every path stays finishable |
| Solace banner           | 200 credits for 60 s of extra capacity                                                      |
| Estimate dial           | C1: the player sets expected req/s; it stays on the chart as a dashed line while the real line draws in; a wrong guess costs nothing. C6: the same dial counts servers |
| Trust                   | drains 10 per second at a 100% error rate (scaled by the error share); recovers 1 per second while there are no errors; stays between 0 and 100 |
| Overheating             | a server over 100% load for 8 s dies                                                        |
| Retries                 | failed requests come back: demand rises by up to 50% while errors last                      |
| Power dips              | 2 s flicker warning, then the part is dark for 20 s; scripted in the surge, one seeded dip 10 s before midnight |
| Regroup                 | quarter speed for 10 s, once per session, handed over at the rescue                         |
| Rescue trigger          | trust under 30, or 45 s into the district surge                                             |
| Final sizing            | 4 servers ride out the dip; 3 hold only with a fast replacement; 2 drop requests; 5 or more hold but are graded as waste |
| Debrief grade           | dropped requests, wasted credits, trust left, banner choice, Ozzie's tab, whether the player scaled down |

What the economy is meant to produce (approximate, upkeep included):

| Path                                                   | Credits before midnight | Midnight with 4 servers | Debrief shows                          |
| ------------------------------------------------------ | ----------------------- | ----------------------- | -------------------------------------- |
| Best play (skip banner, overclock early, 3 at rescue)  | about 150               | about 60 left           | no debt                                |
| Paid the banner                                        | about −50               | Ozzie covers about 130  | "You owe Ozzie 130", banner called out |
| Racked an idle second server in C3                     | about 135               | about 55 left           | small upkeep cost only                 |
| Overbuilt at the rescue (5 or 6 boxes)                 | about 0 to 70           | small debt              | wasted credits graded                  |

Not set yet: the debrief's grade thresholds. A ticket that needs them stops and asks.

## The interview version

The debrief ends with a card, kept as a Night Book page, that turns the night into an interview answer to
"How would you scale a web app from a single server?": pin down who uses it and what must stay up; estimate
requests per second (users times call rate) and size for the peak, not the average; one server is fine well
under its capacity; scale up first (quick, but it has a ceiling, needs downtime and is still one point of
failure); then scale out behind a load balancer with health checks; size the pool for the peak plus one
spare; scale back down when the peak passes.

## Screens

Desktop only, 16:9, built at 1920x1080 and scaled to fit.

| Screen           | When                              | What is on it                                                                  |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| Title            | On load                           | Logo, Start, Settings, Credits over the skyline                                |
| Scene            | Cold open, rescue, debrief        | Visual-novel layout (see Two layers)                                           |
| Board            | Beats 1 to 6                      | The board, parts, packets, the room behind it, and the HUD                     |
| Pause            | Esc or button                     | Resume, Restart session, Settings, Quit to title                               |
| Settings         | From title or pause               | Volume, text speed, reduce flicker, fullscreen                                 |
| Rewind           | A failure (see Losing is gentle)   | TRIAGE's stream replay before the rescue, Rei's rewind after it, then back into the board                                |
| Debrief          | After midnight                    | Rei's grade per category, banner choice and Ozzie's tab called out, terms named in three groups, the interview-version card |
| Night Book page  | End of debrief                    | Handwritten page with the lesson, then the title card ("Session 0: Brownout")  |

**Board HUD:** the job card at the start; midnight countdown and in-world clock; demand-versus-capacity chart
(the main readout) with the estimate dial and its dashed guess line; trust
and credits; parts tray with locked slots; Regroup button and its one charge; surge forecast warning with its
number; power-dip flicker warning on the part about to go dark; block chat and Lux's stream chat; crew and
TRIAGE barks; packet and part load readouts; the Solace banner with Pay, Ignore and Bin; the sizing prompt
before the final surge.

## Art and sound

Art is painted, not pixel art. It comes from the art pipeline (gpt-image-2, picked by Rolando) and lands in
`public/art/` only through a PR Rolando approves. Workers never add or edit art. Wires, packets, particles,
the chart, panels and text are drawn in code. `docs/ART.md` lists the picked files.

The challenge design's extra art is in `public/art/` too: the overclock kit (`board/overclock-kit`, with
`board/server-overclocked` and `server-overclocked-hot`), the job card frame (`hud/job-card`) and the estimate dial
(`hud/estimate-dial`). The "skipped" tag and the stream-replay rewind are drawn in code.

Sound: one board music loop (Suno, "Cell Shaped Chaos") and a small set of effects (ElevenLabs), loaded from
`public/` like all assets.

## Build order

1. Groundwork (this file, the painted-art rules, the routing plumbing in `src/sim/board.ts`, including the
   load balancer's health check and the overclock upgrade).
2. Art pass: picks cut out and added to `public/art/`.
3. B1 rules: every number above as pure code, one unit test per number.
4. B2 board and HUD: browser tests drive the mouse.
5. B3 story layer: scene player, cold open, rescue, debrief, Night Book, rewind, barks; a browser test plays
   the whole session.
6. B4 menus and sound (may fold into B2 and B3).

## Brownout is done when

A stranger opens the game link, plays the full 10 minutes without help, and reaches the debrief and the first
Night Book page. Each ticket's acceptance criteria live in its contract, not in this file.
