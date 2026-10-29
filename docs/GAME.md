# Neon War: Session 0, Brownout

Levels are called **sessions** (Lux "jacks in" for a session). Brownout is session 0: the tutorial and the
whole MVP. This file is the complete spec for building it: everything a task needs is here or elsewhere in
this repo. It was distilled from earlier design notes (the session spec and the Challenge Design, whose five
recommendations Rolando accepted on 27 Oct 2026); those notes are not needed to build or review anything.
Where docs/PRD.md disagrees with this file, this file wins.

## Pitch

A painted cyberpunk system-design game in the browser. It is New Year's Eve in Halation. Lux Takahashi, 15,
keeps her slum block's net alive against the midnight countdown, nearly loses it when the district piles on,
and is rescued by the Night Shift crew. About 6 minutes.

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

The clock opens at 23:54:25 and runs in real time; midnight lands at the peak of the final surge, 5:35 in
(Rolando, 29 Oct 2026: the old 8½ minutes had stretches of just waiting). The estimating help fades: TRIAGE does C1's math out loud (badly) and the player corrects it, C3
gives the number, the crew argue numbers in C5, and C6 is the player alone.

| #   | Clock (real time)  | Layer  | What happens                                                                                     | Debrief names                                            |
| --- | ------------------ | ------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| C0  | 23:54:25 (0:00)    | Scene  | Cold open: rain, test fireworks, Lux alone with her mum's photo; she pulls her goggles down. Each line waits for a click; the last one brings the goggles down and starts the board at 23:54:40. | nothing yet                              |
| C1  | 23:54:40 (0:15)    | Board  | **Job card** (who: 120 flats; what must work; the bar: nobody goes dark at midnight; each flat calls about every 4 s). No estimate step: the card closes straight to the build, and until the first server is down the alert band says "drag a SERVER card onto the grid". The player places one scrap server and wires gateway → server → database. TRIAGE: "480 a second! I'm great at math."; Lux: "You multiplied. Divide."; once the first box is live TRIAGE owns up to 30, the number the gauge reads (30/s). | requirements, requests per second, capacity, estimate |
| C2  | 23:55:10 (0:45)    | Board  | **Solace banner**: "Priority service, 200 credits." Pay, Ignore or Bin. The chart shows 30 against 60: nothing to protect against. | overprovisioning                              |
| C3  | 23:55:55 (1:30)    | Board  | **Bigger or more?** Forecast: demand climbing to 90. The tray offers a **bigger box** (scale up: swap the server for one twice its size) beside a second server. A second server racked now sits idle, because the gateway feeds one part only. Doing nothing: the server overheats and dies, and TRIAGE offers its stream replay. | scale up, scale out, headroom |
| C4  | 23:57:10 (2:45)    | Board  | **District surge**, a scripted near-loss: 250 req/s warned 10 s ahead; the big box pegs, a power dip takes it dark, retries climb toward 375, the database times out. Optional: **cut the laundry floor loose** (about 40 req/s). | single point of failure, cascading failure, retry storm, load shedding |
| C5  | 23:58:00 (3:35)    | Scene, then board | **Rescue.** The crew break into her goggles (the one full-immersive moment), drop a load balancer, Ozzie opens his tab. The big box cooked; the crew put a stock 60 back in its place. Surge settles to 120: 3 servers behind the balancer. Mika says two, Ozzie says six, Rei says count it yourself. | load balancer, horizontal scaling, health check |
| C6  | 23:59:00 (4:35)    | Board  | **Midnight, your call.** Forecast 150 req/s, one rack loses power about 10 s before midnight for 20 s. No sizing question: the player builds the count, and the debrief grades the servers actually running at midnight. 150 ÷ 60 = 2.5, so 3 hold the peak and **4** ride out the dip. | capacity planning, peak vs average, redundancy, N+1 |
| C7  | 00:00:00 (5:35)    | Board  | **Scale down** (optional, 30 s): fireworks; demand falls to 40 within 20 s while upkeep keeps ticking. Decommission down to 2. | scale down, elasticity, cost   |
| C8  | 00:00:30 (6:05)    | Scene  | **Debrief.** Goggles up. Rei grades the night; terms named in three groups (sizing, scaling, failure); Night Book page 1, "Demand decides the design"; the interview-version card. | everything above            |

**Losing is gentle.** There is no game-over screen.

- Before the crew exists (C1 to C3), a failure rewinds through **TRIAGE's stream replay**: "I recorded the
  last minute. Want to try that again?" It goes back to the start of the current challenge.
- If trust hits zero in the surge, the crew arrives anyway and Rei rewinds to the start of the surge.
- If the build fails at midnight, the block goes dark on the stroke of twelve and Rei rewinds to 23:59.

## The tutorial coach

Session 0 is the player's first look at the board, the parts and the HUD, so the game watches for the moments a
first-timer gets stuck (`src/scenes/hud/coach.ts`) and helps more the longer it lasts:

| Stuck on                                          | What lights up                                   | Band says                                 |
| ------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| No server on the grid (C1)                        | the SERVER card                                  | drag a SERVER card onto the grid          |
| The gateway feeds nothing                         | the box, and a ghost wire gateway → box          | drag from the GATEWAY onto your SERVER    |
| A fed box has no wire to the database             | the box, and a ghost wire box → database         | drag from your SERVER onto the DATABASE   |
| After the crew: the gateway doesn't feed the splitter | the splitter, and a ghost wire gateway → splitter | drag from the GATEWAY onto the SPLITTER |
| After the crew: a box outside the splitter        | the box, and a ghost wire splitter → box         | drag from the SPLITTER onto each SERVER   |
| After the crew: a dead box                        | the box and the SERVER card                      | click the dead box and press REPLACE      |
| C3: the one box over its limit, dropping calls    | the BIGGER BOX and SERVER cards (never which)    | (nothing: the forecast is up)             |

The highlight comes after 3 s stuck (4 s for the first server), the first nudge after 6 s (8 s; 4 s in C3), then
the next nudges 9 s and 12 s later, each a little more direct, from TRIAGE or Lux. After that only the most direct
one comes back, every 25 s, while the highlight and band hint stay up. The ghost wire marches toward the part
that takes it. The coach waits while a card or wire is in hand and while the board is held, and a nudge never
comes within 5 s of the player's last drag or click (they are trying). Nudges are ten words or fewer, explain
how the board works, and never give a number or a sizing answer. The chat reacts to the first nudge for each
problem only.

Why this shape: Plants vs. Zombies' tutorial (George Fan, GDC 2012) helps only the player doing the wrong
thing, keeps help passive and short, and warns that noise teaches players to ignore every message; Navi
("Hey! Listen!") is the standard warning about a helper who repeats on a timer; Valve's Portal playtests
found players wanted GLaDOS, but not talking while they worked the puzzle.

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
| Bigger box (scale up)   | 60 credits; swaps one server for one that does 120 req/s; it is down for 3 s while it swaps and drops traffic meanwhile; one size up only ("no bigger box in the slum"). Replaces the overclock kit (Rolando, 29 Oct 2026: overclocking is not real system design) |
| Big box burns out       | the big box is the one that cooks in the surge; after the rescue the crew put a stock 60 in its place |
| Residents' database     | 200 req/s; never the bottleneck in normal play, only the retry pile in the surge (about 375) pushes it over |
| Evening climb (C3)      | ramps to 90 req/s over 45 s                                                                 |
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
| Estimate                | no dial and nothing to set: the job card gives the sum (120 flats every 4 s = 30 req/s), the gauge shows 30/s, and the crew correct TRIAGE's 480 out loud; C6 is graded on the servers built (Final sizing) |
| Trust                   | drains 10 per second at a 100% error rate (scaled by the error share); recovers 1 per second while there are no errors; stays between 0 and 100 |
| Overheating             | a server over 100% load for 8 s dies                                                        |
| Retries                 | failed requests come back: demand rises by up to 50% while errors last                      |
| Power dips              | 2 s flicker warning, then the part is dark for 20 s; scripted in the surge, one seeded dip 10 s before midnight |
| Regroup                 | not in Session 0 (Rolando, 29 Oct 2026: not a tutorial mechanic); the code keeps it for a later session (quarter speed for 10 s, once, `BROWNOUT.regroup.inSession`) |
| Rescue trigger          | trust under 30, or 40 s into the district surge                                             |
| Final sizing            | 4 servers ride out the dip; 3 hold only with a fast replacement; 2 drop requests; 5 or more hold but are graded as waste |
| Debrief grade           | dropped requests, wasted credits, trust left, banner choice, Ozzie's tab, whether the player scaled down |

What the economy is meant to produce (approximate, upkeep included):

| Path                                                   | Credits before midnight | Midnight with 4 servers | Debrief shows                          |
| ------------------------------------------------------ | ----------------------- | ----------------------- | -------------------------------------- |
| Best play (skip banner, bigger box early, 3 at rescue) | about 150               | about 60 left           | no debt                                |
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
(the main readout); trust
and credits; parts tray with locked slots; surge forecast warning with its
number; power-dip flicker warning on the part about to go dark; block chat and Lux's stream chat; crew and
TRIAGE barks; packet and part load readouts; the Solace banner with Pay, Ignore and Bin; the midnight forecast
before the final surge; the start-of-C1 hint on the alert band until the first server is placed.

## Art and sound

Art is painted, not pixel art. It comes from the art pipeline (gpt-image-2, picked by Rolando) and lands in
`public/art/` only through a PR Rolando approves. Workers never add or edit art. Wires, packets, particles,
the chart, panels and text are drawn in code. `docs/ART.md` lists the picked files.

The challenge design's extra art is in `public/art/` too: the big box (`board/server-overclocked` and
`server-overclocked-hot`; it also stands on the BIGGER BOX tray card; `board/overclock-kit` is no longer drawn) and the job card frame (`hud/job-card`). The picked estimate
dial (`hud/estimate-dial`) stays in `public/art/` but is no longer drawn. The "skipped" tag and the stream-replay rewind are drawn in code.

Sound: one board music loop (Suno, "Cell Shaped Chaos") and a small set of effects (ElevenLabs), loaded from
`public/` like all assets.

## Build order

1. Groundwork (this file, the painted-art rules, the routing plumbing in `src/sim/board.ts`, including the
   load balancer's health check and the bigger-box upgrade).
2. Art pass: picks cut out and added to `public/art/`.
3. B1 rules: every number above as pure code, one unit test per number.
4. B2 board and HUD: browser tests drive the mouse.
5. B3 story layer: scene player, cold open, rescue, debrief, Night Book, rewind, barks; a browser test plays
   the whole session.
6. B4 menus and sound (may fold into B2 and B3).

## Brownout is done when

A stranger opens the game link, plays the full 6 minutes without help, and reaches the debrief and the first
Night Book page. Each ticket's acceptance criteria live in its contract, not in this file.
