# Brownout: script line sheet

Every line Session 0 needs, in play order. It follows the challenge flow in `docs/GAME.md` (C0 to C8). Where the
two differ, GAME.md wins on rules and numbers, and this file wins on wording.

- **Line IDs** read `<challenge>.<speaker>.<n>`, for example `C1.triage.02`. Code refers to lines by ID only, and
  every line lives in one strings file keyed by its ID.
- **Kind:** a _scene_ line waits for a click; a _bark_ is a small portrait plus one line and never pauses the
  board; _chat_ is a block-chat or stream-chat message; _ui_ is on-screen text such as the job card.
- **When** says what triggers the line. Times like `0:08` count from the start of that challenge; times like
  `23:59:30` are the in-world clock.
- **Length:** barks stay under 70 characters so they fit one line of the bark box. Scene lines stay under 140.
- **Speakers:** Lux, TRIAGE (her drone AI, with its mood in brackets), Rei (crew lead, name not final), Mika,
  Ozzie, Grandma (heard through the door, never seen), neighbours in the block chat, viewers in Lux's stream chat,
  the TV downstairs, and the Solace banner.
- Lux speaks only in short lines to TRIAGE and the crew. TRIAGE is the only voice before the crew arrives.
- System-design words stay out of every line until the debrief (C8).

## C0 Cold open (23:51:30, click to advance)

Rain, test fireworks, Lux alone on her bed with her mum's photo; the clock flickers to 02:14 for one frame; the
phone lights up; the drone wakes; goggles down. Every line waits for a click, like every other scene; nothing
plays on a timer. The run's clock holds at 23:51:30 until the goggles come down, then C1 starts at 23:51:45.

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C0.tv.01 | scene | TV downstairs | first line, under the rain | "...and Halation, we are ten minutes from midnight!" |
| C0.tv.02 | scene | TV downstairs | click | "Get your people close. Get your cameras ready!" |
| C0.grandma.01 | scene | Grandma (through the door) | click | "Lux? Your show's starting, love." |
| C0.lux.01 | scene | Lux | click, still looking at the photo; the clock flickers to 02:14 | "In a minute, Baachan." |
| C0.chat.01 | chat | block: kenji | click: the phone lights up, all four at once | lux the net's doing the thing again |
| C0.chat.02 | chat | block: young father | with C0.chat.01 | I need to call my son at midnight!! |
| C0.chat.03 | chat | block: mrs okafor | with C0.chat.01 | Countdown stream keeps freezing. Is it you or the rain? |
| C0.chat.04 | chat | block: kenji | with C0.chat.01 | lux pls |
| C0.triage.01 | bark | TRIAGE (eager) | same click, drone iris lights up | "Recording! Oh. Oh, it's the net again, isn't it." |
| C0.lux.02 | scene | Lux | click, goggles down; the next click starts the board | "Yeah. Let's go look." |

## C1 to C3: the board, alone with TRIAGE (23:51:45 to 23:56:30)

TRIAGE does the talking here: eager, often wrong, never gives the answer. Lux corrects it in a word or two.

### C1 Job card and first server

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C1.card.title | ui | Job card | card opens | THE BLOCK. TONIGHT. |
| C1.card.who | ui | Job card | | Who: 120 flats on one line. |
| C1.card.what | ui | Job card | | What must work: calls, streams, the lift, the heating alarms. |
| C1.card.bar | ui | Job card | | The bar: nobody goes dark at midnight. |
| C1.card.rate | ui | Job card | | Each flat pings the net about every 4 seconds. |
| C1.triage.01 | bark | TRIAGE (eager) | card closes, dial appears | "Ooh, a dial! How many a second are coming? I'll guess first." |
| C1.triage.02 | bark | TRIAGE (wrong-and-proud) | 2 s later | "480 a second! I'm great at math." |
| C1.lux.01 | bark | Lux | player touches the dial | "You multiplied. Divide." |
| C1.triage.03 | bark | TRIAGE (sheepish) | player sets 25 to 35 | "...30. That's what I meant. Obviously." |
| C1.triage.04 | bark | TRIAGE (thinking) | player sets any other number | "Hm. Let's watch the real line and see who's right." |
| C1.triage.05 | bark | TRIAGE (eager) | dial set, tray glows | "One scrap box does 60. Rack it and wire it: gateway, box, database." |
| C1.chat.01 | chat | block: mrs okafor | server goes live | It's back! Bless you Lux |
| C1.chat.02 | chat | stream: viewer | server goes live | first try lol |
| C1.triage.06 | bark | TRIAGE (happy) | 10 s at 30 against 60 | "30 coming, 60 of room. Look at all that room." |

### C2 The Solace banner

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C2.banner.title | ui | Solace banner | slides in | SOLACE PRIORITY SERVICE |
| C2.banner.body | ui | Solace banner | | Your district deserves better. Guaranteed capacity for 60 seconds. 200 credits. |
| C2.banner.buttons | ui | Solace banner | | Pay / Ignore / Bin |
| C2.triage.01 | bark | TRIAGE (eager) | banner appears | "Guaranteed! That's the best kind of capacity, right?" |
| C2.lux.pay | bark | Lux | Pay | "Fine. It's New Year's." |
| C2.triage.pay | bark | TRIAGE (thinking) | 3 s after Pay | "The chart didn't move. Was it supposed to move?" |
| C2.lux.ignore | bark | Lux | Ignore | "Not tonight." |
| C2.lux.bin | bark | Lux | Bin | "Solace selling us our own power back." |
| C2.triage.after | bark | TRIAGE (thinking) | any choice, 5 s later | "30 coming, 60 of room. Nothing to protect yet." |

### C3 Bigger or more?

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C3.warn.01 | ui | Forecast | 23:54:30 | Everyone's getting ready to film. Demand climbing to 90 a second. |
| C3.chat.01 | chat | block: young father | forecast | video keeps buffering, my son's on in 5 |
| C3.chat.02 | chat | block: kenji | forecast | heating alarm on 3rd floor beeping?? |
| C3.triage.01 | bark | TRIAGE (eager) | tray shows kit and second server | "New toys! The kit makes a box bigger. A second box makes... more box." |
| C3.triage.02 | bark | TRIAGE (thinking) | player racks a second server | "It's on! Why is it doing nothing? Is it shy?" |
| C3.lux.01 | bark | Lux | 5 s after an idle second server | "The gateway only feeds one box." |
| C3.triage.03 | bark | TRIAGE (eager) | player fits the overclock kit | "Rebooting... 3, 2, 1... it's huge now. 120!" |
| C3.triage.04 | bark | TRIAGE (panicking) | server over 100% for 4 s | "It's getting hot. Like, smell-it hot." |
| C3.chat.03 | chat | stream: viewer | server dies | F |
| C3.triage.rewind | scene | TRIAGE (sheepish) | a failure in C1 to C3 | "I recorded the last minute. Want to try that again?" |
| C3.lux.rewind | scene | Lux | rewind accepted | "Yeah. Rewind." |

The rewind lines are used for a failure in C1, C2 or C3; only the challenge they return to changes.

## C4 The district surge (23:56:30, a scripted near-loss)

The block is meant to start failing here, whatever the player does. The lines escalate, the chat goes quiet one
neighbour at a time, and TRIAGE panics.

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C4.warn.01 | ui | Surge warning | 10 s before | NEIGHBOURING BLOCKS CUT OFF. About 250 a second rerouting here in 10 s. |
| C4.triage.01 | bark | TRIAGE (panicking) | warning | "250? We're built for 120! I did that math right, I checked!" |
| C4.lux.01 | bark | Lux | surge lands | "Hold. Hold. Hold." |
| C4.flicker.01 | ui | Dip warning | 2 s before the dip | POWER FLICKER |
| C4.triage.02 | bark | TRIAGE (panicking) | overclocked server goes dark | "Big box is down! Big box is DOWN!" |
| C4.chat.01 | chat | block: mrs okafor | 5 s into errors | it's gone again |
| C4.chat.02 | chat | block: young father | retries climb | calling... calling... calling... |
| C4.chat.seed | chat | block: unnamed neighbour | 15 s into the surge | wait isn't she the Takaha— |
| C4.triage.03 | bark | TRIAGE (panicking) | retries climb past 300 | "Everyone keeps hitting refresh. That's making it worse, right?" |
| C4.triage.04 | bark | TRIAGE (thinking) | database starts timing out | "The database is choking on all the repeats." |
| C4.cut.button | ui | Laundry cut | becomes available | Cut the laundry floor loose (about 40 a second) |
| C4.lux.cut | bark | Lux | player cuts the laundry floor | "Sorry, laundry. Washers can wait till next year." |
| C4.chat.cut | chat | block: kenji | after the cut | who turned off the arcade |
| C4.triage.cut | bark | TRIAGE (thinking) | 3 s after the cut | "Less coming in. The database is breathing again. Barely." |
| C4.chat.03 | chat | block (system) | 20 s into the surge | Mrs Okafor left the chat |
| C4.chat.04 | chat | stream: viewer | 25 s | is the stream frozen or is it just me |
| C4.grandma.01 | bark | Grandma (through the door) | 30 s | "Three minutes, love! Come down!" |
| C4.lux.02 | bark | Lux | 35 s | "I can't hold this. I can't—" |

C4.chat.seed is a story seed: the message is cut off mid-word, the chat drops, and nobody follows it up.

## C5 The rescue (23:57:30, scene then board)

The crew break into her goggles uninvited, and the board goes fully immersive for the only time. The scene plays
while the sim is frozen; the lines after it are barks.

### Scene

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C5.triage.01 | scene | TRIAGE (panicking) | goggles glitch | "Someone's in our goggles. Someone is IN our goggles." |
| C5.rei.01 | scene | Rei | hologram lands | "Cute setup. Move over." |
| C5.lux.01 | scene | Lux | | "Who are you? Get out of my—" |
| C5.rei.02 | scene | Rei | | "Night Shift. We've been watching your block. You were doing fine. Then you weren't." |
| C5.mika.01 | scene | Mika | | "Breathe. Read the chart." |
| C5.mika.02 | scene | Mika | | "The surge is settling. About 120 a second for the next minute." |
| C5.rei.03 | scene | Rei | crew cable drops | "Here. It splits traffic across every box you wire behind it, and it skips any box that's dark." |
| C5.rei.cut | scene | Rei | only if the laundry floor was cut | "You cut the laundry loose." (beat) "...Who taught you that?" |
| C5.lux.cut | scene | Lux | only after C5.rei.cut | "Nobody." |
| C5.ozzie.01 | scene | Ozzie | | "I'll front you 100. It goes on my tab." |
| C5.ozzie.02 | scene | Ozzie | | "Six boxes. Buy six, sleep tonight." |
| C5.mika.03 | scene | Mika | | "Six is a waste. Two will do." |
| C5.ozzie.03 | scene | Ozzie | | "Two is how you end up here again." |
| C5.rei.04 | scene | Rei | | "Stop. She can count." (to Lux) "So count." |
| C5.mika.04 | scene | Mika | Regroup handed over | "One more thing. When it gets fast, hit this. Time slows down. You get it once." |

### Back on the board

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C5.triage.02 | bark | TRIAGE (sheepish) | board returns | "The big box fried. It's a normal box again. Sorry, big box." |
| C5.triage.03 | bark | TRIAGE (thinking) | 10 s, if under 3 live servers | "120 coming. Each box does 60. I'm not saying the answer." |
| C5.rei.05 | bark | Rei | 3 servers live behind the balancer | "There it is." |
| C5.ozzie.04 | bark | Ozzie | 5 or more servers | "See? Six. Sleep tonight." |
| C5.mika.05 | bark | Mika | 5 or more servers | "Look at the chart. Half of that is just heating your room." |
| C5.chat.01 | chat | block: young father | errors stop | it's back!!! |

### Rewind after the crew arrives

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C5.rei.rewind | scene | Rei | trust reaches 0 in the surge | "Again. Slower." |

## C6 Midnight and C7 scale down (23:59:00 to 00:01:00)

The crew go quiet and the call is Lux's. The outcome lines branch on what holds at midnight.

### C6 Midnight, your call

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C6.warn.01 | ui | Forecast | 23:59:00 | MIDNIGHT: everyone calls and streams at once. About 150 a second. |
| C6.rei.01 | bark | Rei | sizing prompt opens | "Your call. How many?" |
| C6.prompt | ui | Sizing prompt | | How many boxes for midnight? |
| C6.triage.01 | bark | TRIAGE (thinking) | prompt open 8 s | "150 coming, 60 a box. That's two and a half boxes. You can't buy half a box." |
| C6.ozzie.01 | bark | Ozzie | player sets 5 or more | "Now you're talking." |
| C6.mika.01 | bark | Mika | player sets 2 | "Brave." |
| C6.tv.01 | bark | TV downstairs | 23:59:30 | "Thirty seconds, Halation!" |
| C6.flicker.01 | ui | Dip warning | 23:59:48 | POWER FLICKER |
| C6.triage.02 | bark | TRIAGE (panicking) | 23:59:50, a server goes dark | "Not now! Not NOW!" |
| C6.tv.02 | bark | TV downstairs | 23:59:55 | "Five! Four! Three!..." |
| C6.chat.hold.01 | chat | block (several neighbours) | midnight, nothing dropped | HAPPY NEW YEAR!!! |
| C6.chat.hold.02 | chat | block: young father | midnight + 2 s | he picked up. he picked up. thank you |
| C6.rei.hold | bark | Rei | held with no drops | "Clean." |
| C6.rei.scrape | bark | Rei | held, but some requests dropped | "Ugly. But it held." |
| C6.triage.hold | bark | TRIAGE (happy) | held | "We did it! I helped! Did I help?" |
| C6.lux.hold | bark | Lux | held | "You helped." |
| C6.fail.chat | chat | block (system) | midnight, block dark | (the chat stops; no messages) |
| C6.rei.fail | scene | Rei | block dark at midnight | "Dark at midnight. Again, from one minute out." |

### C7 Scale down (optional, 30 s)

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C7.warn.01 | ui | Forecast | 00:00:05 | Everyone's watching fireworks. Demand falling to about 40 a second. |
| C7.ozzie.01 | bark | Ozzie | 00:00:10 | "Every box still running is still costing. Just saying." |
| C7.triage.01 | bark | TRIAGE (thinking) | 00:00:15 | "40 coming. That's... one box and a bit?" |
| C7.ozzie.down | bark | Ozzie | player decommissions to 2 | "Now that's a New Year's resolution." |
| C7.ozzie.none | bark | Ozzie | 00:00:35, still 4 or more running | "Paying for fireworks we're not watching." |

## C8 Debrief and Night Book (00:01:00)

Goggles up, back in the rainy room with fireworks outside. Rei grades the night over her earbuds, and the real
terms are named for the first time. Grade lines branch on the raw results; the thresholds behind "some requests
dropped" and "estimate close" are not set yet, so a ticket that needs exact numbers stops and asks.

### Rei grades the night

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C8.rei.open | scene | Rei | debrief opens | "Right. Let's see what you did." |
| C8.rei.sizing.good | scene | Rei | estimate close and midnight held | "You counted before you built. Most people don't." |
| C8.rei.sizing.bad | scene | Rei | estimate far off or midnight failed | "You built first and counted later. Count first." |
| C8.rei.banner.pay | scene | Rei | paid the banner | "And you paid Solace. For a minute of nothing." |
| C8.rei.banner.skip | scene | Rei | ignored or binned it | "You didn't take Solace's offer. Good." |
| C8.rei.debt | scene | Rei | Ozzie's tab above 100 | "You owe Ozzie. He will remember." |
| C8.ozzie.debt | scene | Ozzie | after C8.rei.debt | "I'll remember." |
| C8.rei.waste | scene | Rei | 5 or more boxes at midnight | "Half those boxes did nothing but cost." |
| C8.rei.down | scene | Rei | scaled down in C7 | "And you turned them off after. That's rarer than it should be." |
| C8.rei.close | scene | Rei | grades done | "Now the words for it. You'll need them." |

### The terms, named (three groups)

| ID | Kind | Group | Line |
| --- | --- | --- | --- |
| C8.terms.sizing | ui | Sizing | **Requirements** (the job card). **Requests per second** (120 flats every 4 s = 30). **Capacity** (one box did 60). **Back-of-the-envelope estimate** (the dial). **Headroom** (don't run at 100%). **Peak vs average** (midnight, not the evening). |
| C8.terms.scaling | ui | Scaling | **Scaling up** (the overclock kit: quick, but it has a ceiling and a reboot). **Scaling out** (more boxes). **Load balancer** with **health checks** (splits traffic, skips dark boxes). **Scaling down** (turning them off after). |
| C8.terms.failure | ui | Failure | **Single point of failure** (one big box). **Cascading failure** (one part falls, the next follows). **Retry storm** (everyone hitting refresh). **Load shedding** (cutting the laundry loose). **Redundancy, N+1** (the peak plus one spare). |

### The interview version

| ID | Kind | Speaker | Line |
| --- | --- | --- | --- |
| C8.rei.interview | scene | Rei | "Someday somebody in a nice shirt will ask you how to scale a web app from one server. Here's your answer." |
| C8.card.title | ui | Card | How would you scale a web app from a single server? |
| C8.card.1 | ui | Card | 1. Pin down who uses it and what must stay up. |
| C8.card.2 | ui | Card | 2. Estimate requests per second: users times how often they call. Size for the peak, not the average. |
| C8.card.3 | ui | Card | 3. One server is fine while it runs well under capacity. |
| C8.card.4 | ui | Card | 4. Scale up first: quick, but it has a ceiling, needs downtime, and is still one point of failure. |
| C8.card.5 | ui | Card | 5. Then scale out behind a load balancer with health checks. |
| C8.card.6 | ui | Card | 6. Size the pool for the peak plus one spare. |
| C8.card.7 | ui | Card | 7. Scale back down when the peak passes. |

### Night Book page 1 and the close

| ID | Kind | Speaker | Line |
| --- | --- | --- | --- |
| C8.book.open | scene | (stage direction, no text) | She opens the book. The first pages are full of old handwriting that isn't Rei's. She turns past them to a blank page. |
| C8.book.page1 | ui | Night Book | Demand decides the design. Count who's coming, how often, and how big the peak gets. Build for the peak, with room for one part to die. |
| C8.triage.end | scene | TRIAGE (happy) | "Stream saved. 4 viewers. Best night ever." |
| C8.rei.end | scene | Rei | "Arcade under the rail line. Tomorrow, midnight. Don't be late." |
| C8.title | ui | Title card | Session 0: Brownout |

## Chat filler

Random lines keep both chats alive between scripted messages. The game picks one every 6 to 10 s from the pool
that matches the block's state: all fine (no errors), some errors (error share above 0 and under 50%), or heavy
errors (50% or more). Neighbours use the four chat avatars: kenji, mrs okafor, young father and old man noodles.

| ID | Chat | State | Line |
| --- | --- | --- | --- |
| fill.block.ok.01 | block | all fine | old man noodles: is the noodle cam on? |
| fill.block.ok.02 | block | all fine | kenji: lux can you make the wifi faster for the countdown |
| fill.block.ok.03 | block | all fine | mrs okafor: Happy almost new year everyone x |
| fill.block.ok.04 | block | all fine | young father: practising my midnight call face |
| fill.block.slow.01 | block | some errors | kenji: lagging |
| fill.block.slow.02 | block | some errors | old man noodles: the picture is doing the stairs thing |
| fill.block.slow.03 | block | some errors | mrs okafor: Lift's stuck again. |
| fill.block.down.01 | block | heavy errors | young father: anyone else? |
| fill.block.down.02 | block | heavy errors | kenji: LUX |
| fill.stream.ok.01 | stream | all fine | ok the drone cam is actually sick |
| fill.stream.ok.02 | stream | all fine | lux fixing the net on NYE is so lux |
| fill.stream.ok.03 | stream | all fine | what's that chart |
| fill.stream.slow.01 | stream | some errors | number go up?? |
| fill.stream.slow.02 | stream | some errors | triage is panicking again lol |
| fill.stream.down.01 | stream | heavy errors | stream lagging bad |
| fill.stream.down.02 | stream | heavy errors | rip |

No filler line names a fix or a system-design term.

## Not settled yet

- The crew lead's name is a placeholder (Rei Kuroda). Keep it in the strings file only.
- The debrief grade thresholds are not set.
