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
| C0.tv.01 | scene | TV downstairs | first line, under the rain | "...and Halation, we are five minutes from midnight!" |
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
| C1.card.title | ui | Job card | card opens | THE LIGHTS ARE GOING OUT! |
| C1.card.step1 | ui | Job card | | Drag a SERVER onto the grid. |
| C1.card.step2 | ui | Job card | | Wire the GATEWAY to your server. |
| C1.card.step3 | ui | Job card | | Wire your server to the DATABASE. |
| C1.card.goal | ui | Job card | | Keep the block lit till midnight! |
| C1.card.go | ui | Job card | the card's button | LET'S GO! |
| C1.card.bar | ui | Job card | the alert band when midnight is held | Nobody went dark at midnight. |
| C1.triage.01 | bark | TRIAGE (eager) | card closes | "Lux! The lights are going out all over the block!" |
| C1.triage.02 | bark | TRIAGE (eager) | 2 s later | "Mrs Okafor's stuck in the lift! Kenji's stream froze!" |
| C1.lux.01 | bark | Lux | 2 s after TRIAGE's alarm | "Okay. Breathe. I know this one." |
| C1.triage.03 | bark | TRIAGE (wrong-and-proud) | first server live, 2 s or more after Lux | "The lights are back! I knew my plan would work!" |
| C1.triage.04 | bark | TRIAGE (thinking) | not played (the estimate step is gone; the take stays recorded) | "Hm. Let's watch the real line and see who's right." |
| C1.triage.05 | bark | TRIAGE (eager) | 2 s after Lux, tray glows | "Server on the grid, then wire it up. Go go go!" |
| C1.chat.01 | chat | block: mrs okafor | server goes live | It's back! Bless you Lux |
| C1.chat.02 | chat | stream: viewer | server goes live | first try lol |
| C1.triage.06 | bark | TRIAGE (happy) | 10 s at 30 against 60 | "See the gauge? Your server's barely trying. That's headroom." |
| C1.triage.nudge.place.1 | bark | TRIAGE (eager) | coach: no server on the grid 8 s after the card closes, SERVER card lit | "SERVER card, from the tray, onto the grid. Go on!" |
| C1.triage.nudge.place.2 | bark | TRIAGE (thinking) | coach: still no server, 9 s later | "Lux? Still dark. A server goes on the grid first." |
| C1.lux.nudge.place | bark | Lux | coach: still no server, 12 s later (then again every 25 s while stuck) | "Right. Server card, onto the table." |
| C1.triage.nudge.feed.1 | bark | TRIAGE (thinking) | coach: a server the gateway does not feed, ghost wire lit | "It's just sitting there. Is it even plugged in?" |
| C1.triage.nudge.feed.2 | bark | TRIAGE (eager) | coach: still not fed, 9 s later | "Drag from the gateway onto the server. Requests get in!" |
| C1.lux.nudge.feed | bark | Lux | coach: still not fed, 12 s later (then again every 25 s) | "Don't forget to connect it. Gateway first, then the server." |
| C1.triage.nudge.store.1 | bark | TRIAGE (thinking) | coach: a fed server with no wire to the database, ghost wire lit | "Requests go in... and stop. Where do they go next?" |
| C1.triage.nudge.store.2 | bark | TRIAGE (eager) | coach: still no database wire, 9 s later | "Drag from the server onto the database! Gateway, server, database!" |
| C1.lux.nudge.store | bark | Lux | coach: still no database wire, 12 s later (then again every 25 s) | "Connect it. Server to the database." |

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
| C2.triage.after | bark | TRIAGE (thinking) | any choice, 5 s later | "30 requests a second, capacity 60. Nothing to protect yet." |

### C3 Bigger or more?

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C3.warn.01 | ui | Forecast | 23:55:55 | Everyone's getting ready to film. Demand climbing to 90 a second. |
| C3.chat.01 | chat | block: young father | forecast | video keeps buffering, my son's on in 5 |
| C3.chat.02 | chat | block: kenji | forecast | heating alarm on 3rd floor beeping?? |
| C3.triage.01 | bark | TRIAGE (eager) | tray shows the bigger server and a second server | "New toys! Scale up to a bigger server, or scale out with two?" |
| C3.triage.02 | bark | TRIAGE (thinking) | player racks a second server | "It's on! Why is it doing nothing? Is it shy?" |
| C3.lux.01 | bark | Lux | 5 s after an idle second server | "The gateway only feeds one server." |
| C3.triage.03 | bark | TRIAGE (eager) | player swaps in the bigger server | "Swapping in the big one... 3, 2, 1... it's huge now. 120!" |
| C3.triage.04 | bark | TRIAGE (panicking) | server over 100% for 4 s | "It's getting hot. Like, smell-it hot." |
| C3.chat.03 | chat | stream: viewer | server dies | F |
| C3.triage.nudge.choose.1 | bark | TRIAGE (thinking) | coach: the one server over its limit and dropping calls, both tray cards lit | "Too much for one server! The tray has two ideas." |
| C3.triage.nudge.choose.2 | bark | TRIAGE (thinking) | coach: still over, 9 s later (then again every 25 s) | "Scale up, or scale out? I'm not saying. I'm pointing." |
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
| C4.triage.02 | bark | TRIAGE (panicking) | the big server goes dark | "Big server is down! Big server is DOWN!" |
| C4.chat.01 | chat | block: mrs okafor | 5 s into errors | it's gone again |
| C4.chat.02 | chat | block: young father | retries climb | calling... calling... calling... |
| C4.chat.seed | chat | block: unnamed neighbour | 15 s into the surge | wait isn't she the Takaha— |
| C4.triage.03 | bark | TRIAGE (panicking) | retries climb past 300 | "Everyone keeps hitting refresh. That's making it worse, right?" |
| C4.triage.04 | bark | TRIAGE (thinking) | database starts timing out | "The database is choking on all the repeats." |
| C4.cut.button | ui | Laundry cut | becomes available | Cut the laundry floor loose (about 40 a second) |
| C4.lux.cut | bark | Lux | player cuts the laundry floor | "Sorry, laundry. Washers can wait till next year." |
| C4.chat.cut | chat | block: kenji | after the cut | who turned off the arcade |
| C4.triage.cut | bark | TRIAGE (thinking) | 3 s after the cut | "Less demand. The database is breathing again. Barely." |
| C4.chat.03 | chat | block (system) | 20 s into the surge | Mrs Okafor left the chat |
| C4.chat.04 | chat | stream: viewer | 25 s | is the stream frozen or is it just me |
| C4.grandma.01 | bark | Grandma (through the door) | 30 s | "Two minutes, love! Come down!" |
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
| C5.rei.03 | scene | Rei | crew cable drops | "Here. A load balancer. It spreads traffic across every server behind it, and its health check skips any that's dark." |
| C5.rei.cut | scene | Rei | only if the laundry floor was cut | "You cut the laundry loose." (beat) "...Who taught you that?" |
| C5.lux.cut | scene | Lux | only after C5.rei.cut | "Nobody." |
| C5.ozzie.01 | scene | Ozzie | | "I'll front you 100. It goes on my tab." |
| C5.ozzie.02 | scene | Ozzie | | "Six servers. Buy six, sleep tonight." |
| C5.mika.03 | scene | Mika | | "Six is a waste. Two will do." |
| C5.ozzie.03 | scene | Ozzie | | "Two is how you end up here again." |
| C5.rei.04 | scene | Rei | | "Stop. She can count." (to Lux) "So count." |
| C5.mika.04 | scene | Mika | not played in Session 0 (Regroup is kept for a later session) | "One more thing. When it gets fast, hit this. Time slows down. You get it once." |

### Back on the board

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C5.triage.02 | bark | TRIAGE (sheepish) | board returns | "The big server cooked. The crew put a normal one back. Sorry." |
| C5.triage.03 | bark | TRIAGE (thinking) | 10 s, if under 3 live servers | "120 requests a second. Each server does 60. I'm not saying." |
| C5.rei.05 | bark | Rei | 3 servers live behind the balancer | "There it is." |
| C5.ozzie.04 | bark | Ozzie | 5 or more servers | "See? Six. Sleep tonight." |
| C5.mika.05 | bark | Mika | 5 or more servers | "Look at the chart. Half of that capacity is just heating your room." |
| C5.chat.01 | chat | block: young father | errors stop | it's back!!! |
| C5.triage.nudge.splitter | bark | TRIAGE (thinking) | coach: the gateway does not feed the load balancer, ghost wire lit | "The gateway isn't feeding the load balancer. Connect them!" |
| C5.lux.nudge.splitter | bark | Lux | coach: still not fed, 9 s later (then again every 25 s) | "Gateway into the load balancer. Connect it." |
| C5.triage.nudge.behind.1 | bark | TRIAGE (thinking) | coach: a server outside the load balancer, ghost wire lit | "That server isn't behind the load balancer. Nothing reaches it." |
| C5.triage.nudge.behind.2 | bark | TRIAGE (eager) | coach: still outside, 9 s later | "Load balancer onto the server. Then server onto the database!" |
| C5.lux.nudge.behind | bark | Lux | coach: still outside, 12 s later (then again every 25 s) | "Wire it behind the load balancer." |
| C5.triage.nudge.replace.1 | bark | TRIAGE (sheepish) | coach: a dead server waiting to be swapped, the server lit | "That server cooked! Click it, then press REPLACE." |
| C5.lux.nudge.replace | bark | Lux | coach: still dead, 9 s later (then again every 25 s) | "Swap the dead server." |

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
| C6.rei.01 | bark | Rei | the midnight forecast shows | "Your call. How many?" |
| C6.triage.01 | bark | TRIAGE (thinking) | forecast up 8 s | "150 req/s, 60 per server. Two and a half. Can't buy half a server." |
| C6.ozzie.01 | bark | Ozzie | forecast up, 5 or more boxes running | "Now you're talking." |
| C6.mika.01 | bark | Mika | forecast up, 2 or fewer boxes running | "Brave." |
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
| C7.ozzie.01 | bark | Ozzie | 00:00:10 | "Every server still running is still costing. Just saying." |
| C7.triage.01 | bark | TRIAGE (thinking) | 00:00:15 | "40 requests a second. That's... one server and a bit?" |
| C7.ozzie.down | bark | Ozzie | player decommissions to 2 | "Now that's a New Year's resolution." |
| C7.ozzie.none | bark | Ozzie | 00:00:35, still 4 or more running | "Paying for fireworks we're not watching." |

## C8 Debrief and Night Book (00:01:00)

Goggles up, back in the rainy room with fireworks outside. Rei grades the night over her earbuds, and the real
terms are named for the first time. Grade lines branch on the raw results; the thresholds behind "some requests
dropped" are not set yet, so a ticket that needs exact numbers stops and asks.

### Rei grades the night

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C8.rei.open | scene | Rei | debrief opens | "Right. Let's see what you did." |
| C8.rei.sizing.good | scene | Rei | midnight held on fewer than 5 boxes | "You counted before you built. Most people don't." |
| C8.rei.sizing.bad | scene | Rei | midnight failed, or 5 or more boxes ran | "You built first and counted later. Count first." |
| C8.rei.banner.pay | scene | Rei | paid the banner | "And you paid Solace. For a minute of nothing." |
| C8.rei.banner.skip | scene | Rei | ignored or binned it | "You didn't take Solace's offer. Good." |
| C8.rei.debt | scene | Rei | Ozzie's tab above 100 | "You owe Ozzie. He will remember." |
| C8.ozzie.debt | scene | Ozzie | after C8.rei.debt | "I'll remember." |
| C8.rei.waste | scene | Rei | 5 or more boxes at midnight | "Half those servers did nothing but cost." |
| C8.rei.down | scene | Rei | scaled down in C7 | "And you turned them off after. That's rarer than it should be." |
| C8.rei.close | scene | Rei | grades done | "Now the words for it. You'll need them." |

### The terms, named (three groups)

| ID | Kind | Group | Line |
| --- | --- | --- | --- |
| C8.terms.sizing | ui | Sizing | **Requirements** (keep the block lit till midnight). **Requests per second** (your block sent about 30). **Capacity** (one server did 60). **Back-of-the-envelope estimate** (120 flats, each calling every 4 s, is about 30: a quick sum before you build). **Headroom** (don't run at 100%). **Peak vs average** (midnight, not the evening). |
| C8.terms.scaling | ui | Scaling | **Scaling up** (the bigger server: quick, but it has a ceiling and goes dark while it swaps). **Scaling out** (more servers). **Load balancer** with **health checks** (splits traffic, skips dark servers). **Scaling down** (turning them off after). |
| C8.terms.failure | ui | Failure | **Single point of failure** (one big server). **Cascading failure** (one part falls, the next follows). **Retry storm** (everyone hitting refresh). **Load shedding** (cutting the laundry loose). **Redundancy, N+1** (the peak plus one spare). |

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
| fill.block.ok.05 | block | all fine | old man noodles: noodles are on. midnight noodles |
| fill.block.ok.06 | block | all fine | kenji: who's on the roof for fireworks |
| fill.block.ok.07 | block | all fine | young father: my son says hi to everyone |
| fill.block.ok.08 | block | all fine | mrs okafor: Has anyone seen my cat. Grey. Judgemental. |
| fill.block.ok.09 | block | all fine | kenji: lux ur famous on the stairs group chat |
| fill.block.ok.10 | block | all fine | old man noodles: the rain is stopping i think |
| fill.block.slow.01 | block | some errors | kenji: lagging |
| fill.block.slow.02 | block | some errors | old man noodles: the picture is doing the stairs thing |
| fill.block.slow.03 | block | some errors | mrs okafor: Lift's stuck again. |
| fill.block.slow.04 | block | some errors | young father: video keeps freezing on his face |
| fill.block.slow.05 | block | some errors | mrs okafor: The heating alarm is beeping again. |
| fill.block.down.01 | block | heavy errors | young father: anyone else? |
| fill.block.down.02 | block | heavy errors | kenji: LUX |
| fill.block.down.03 | block | heavy errors | old man noodles: hello? anyone? |
| fill.block.down.04 | block | heavy errors | mrs okafor: Lux, love, it's all gone. |
| fill.stream.ok.01 | stream | all fine | ok the drone cam is actually sick |
| fill.stream.ok.02 | stream | all fine | lux fixing the net on NYE is so lux |
| fill.stream.ok.03 | stream | all fine | what's that chart |
| fill.stream.ok.04 | stream | all fine | first time catching a live one |
| fill.stream.ok.05 | stream | all fine | the rain sounds on this stream are elite |
| fill.stream.ok.06 | stream | all fine | triage say hi |
| fill.stream.ok.07 | stream | all fine | is that her room? cozy |
| fill.stream.ok.08 | stream | all fine | chat be nice it's NYE |
| fill.stream.ok.09 | stream | all fine | lux drop the playlist |
| fill.stream.ok.10 | stream | all fine | lux pls show the cat drone 🐱 |
| fill.stream.ok.11 | stream | all fine | triage's little face 🥺 |
| fill.stream.ok.12 | stream | all fine | chat is so cozy tonight ☕ |
| fill.stream.ok.13 | stream | all fine | this is better than tv 📺 |
| fill.stream.ok.14 | stream | all fine | the rain + lofi + servers 😌 |
| fill.stream.ok.15 | stream | all fine | first NYE stream let's go 🎆 |
| fill.stream.ok.16 | stream | all fine | who's here from block seven 👋 |
| fill.stream.ok.17 | stream | all fine | brb getting noodles 🍜 |
| fill.stream.ok.18 | stream | all fine | lux's backpack has an ANTENNA |
| fill.stream.ok.19 | stream | all fine | low key learning stuff rn 🤓 |
| fill.stream.ok.20 | stream | all fine | happy new year early 🎉 |
| fill.stream.ok.21 | stream | all fine | the vibes are immaculate ✨ |
| fill.stream.slow.01 | stream | some errors | number go up?? |
| fill.stream.slow.02 | stream | some errors | triage is panicking again lol |
| fill.stream.slow.03 | stream | some errors | the chart is doing something |
| fill.stream.slow.04 | stream | some errors | lag on my end too |
| fill.stream.slow.05 | stream | some errors | uh oh 👀 |
| fill.stream.slow.06 | stream | some errors | buffering... ⏳ |
| fill.stream.slow.07 | stream | some errors | the gauge is getting full 😬 |
| fill.stream.slow.08 | stream | some errors | the server is sweating 💦 |
| fill.stream.slow.09 | stream | some errors | triage's face is NOT ok |
| fill.stream.slow.10 | stream | some errors | lux it's doing the thing |
| fill.stream.slow.11 | stream | some errors | my video froze mid-dance 🕺 |
| fill.stream.slow.12 | stream | some errors | chat hold the line 🫡 |
| fill.stream.down.01 | stream | heavy errors | stream lagging bad |
| fill.stream.down.02 | stream | heavy errors | rip |
| fill.stream.down.03 | stream | heavy errors | f in the chat |
| fill.stream.down.04 | stream | heavy errors | we lost her |
| fill.stream.down.05 | stream | heavy errors | NOOOO 😱 |
| fill.stream.down.06 | stream | heavy errors | F 💀 |
| fill.stream.down.07 | stream | heavy errors | we're so cooked 🍳 |
| fill.stream.down.08 | stream | heavy errors | the lights!!! 🌑 |
| fill.stream.down.09 | stream | heavy errors | triage x_x mood |
| fill.stream.down.10 | stream | heavy errors | lux save us 🙏 |
| fill.stream.down.11 | stream | heavy errors | the lift is stuck again 😭 |
| fill.stream.down.12 | stream | heavy errors | don't panic. (panicking) |
| fill.stream.down.13 | stream | heavy errors | rip the countdown stream 🪦 |

No filler line names a fix or a system-design term.

## Lane lines

Each lane of the Live screen (`docs/LIVE.md`) adds the lines its views need in its own section below,
as one two-file edit: a row here and an entry under the matching `// anchor: <lane>` comment inside
`LINES` in `src/strings.ts`. IDs keep the `<challenge>.<speaker>.<n>` form (or `fill.<chat>.<state>.<n>`
for filler), so `tests/strings.test.ts` checks them like every other line. A section with only its
header has no lines yet. UI micro-copy (labels, key caps) is not a line and stays out of these tables.

### Board lane <!-- anchor: board -->

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |

### Gauges lane <!-- anchor: gauges -->

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C1.alert.place | ui | Alert | C1 after the job card closes, until the first server is on the board | drag a SERVER card onto the grid |
| C1.alert.feed | ui | Alert | coach: the gateway feeds no server | drag from the GATEWAY onto your SERVER |
| C1.alert.store | ui | Alert | coach: a fed server has no wire to the database | drag from your SERVER onto the DATABASE |
| C1.tip.01 | ui | Tip | a viewer's tip alert (the HUD picks one per tip) | for the noodle cam 🍜 |
| C1.tip.02 | ui | Tip | a viewer's tip alert (the HUD picks one per tip) | buy triage a snack 🐱 |
| C1.tip.03 | ui | Tip | a viewer's tip alert (the HUD picks one per tip) | W stream, take my coins |
| C1.tip.04 | ui | Tip | a viewer's tip alert (the HUD picks one per tip) | keep the lights on lux 💡 |
| C1.tip.05 | ui | Tip | a viewer's tip alert (the HUD picks one per tip) | from floor six with love ❤️ |
| C1.tip.06 | ui | Tip | a viewer's tip alert (the HUD picks one per tip) | triage tax 💸 |
| C1.tip.07 | ui | Tip | a viewer's tip alert (the HUD picks one per tip) | you got this lux 💙 |
| C1.tip.08 | ui | Tip | a viewer's tip alert (the HUD picks one per tip) | my lift works!! here 🛗 |
| C1.tip.09 | ui | Tip | a viewer's tip alert (the HUD picks one per tip) | happy almost new year 🎆 |
| C1.tip.10 | ui | Tip | a viewer's tip alert (the HUD picks one per tip) | for the server fund 🤖 |
| C1.tip.11 | ui | Tip | a viewer's tip alert (the HUD picks one per tip) | first donation ever!! |
| C1.tip.12 | ui | Tip | a viewer's tip alert (the HUD picks one per tip) | cable money 🔌 |
| C5.alert.splitter | ui | Alert | coach: the gateway does not feed the load balancer | drag from the GATEWAY onto the LOAD BALANCER |
| C5.alert.behind | ui | Alert | coach: a server outside the load balancer | drag from the LOAD BALANCER onto each SERVER |
| C5.alert.replace | ui | Alert | coach: a dead server waits | click the dead server and press REPLACE |
| C3.alert.title | ui | Alert | the C3 forecast headline, after the number | EVERYONE FILMING |
| C3.alert.down | ui | Alert | a failure freezes the board, before the rewind | BLOCK DOWN |
| C4.alert.title | ui | Alert | the C4 forecast and the surge, after the number | NEIGHBOURS REROUTED HERE |
| C4.alert.refresh | ui | Alert | sub-line once retries push the surge up | Everyone's hitting refresh: each failed call comes straight back. |
| C6.alert.title | ui | Alert | the C6 forecast headline, after the number | MIDNIGHT |
| C6.alert.dip | ui | Alert | C6 forecast sub-line until the sizing is SET | Everyone calls and streams at once. One server loses power before midnight. |
| C6.alert.held | ui | Alert | midnight, the block held | HELD |
| C6.alert.dark | ui | Alert | midnight, the block went dark | BLOCK DARK |
| C7.alert.title | ui | Alert | the after-midnight forecast headline, after the number | FIREWORKS |

The alert band prints the number first and these words after it; the sub-line is the challenge's
forecast or flicker line. The C1 hint is the exception: with no alert up it stands alone on the
band, with no number. Wording is a draft until the owner approves it (decision D8).

### Comms lane <!-- anchor: comms -->

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |

### Chat lane <!-- anchor: chat -->

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| fill.stream.placed.01 | stream | stream | a part is placed on the board | ooh new server |
| fill.stream.placed.02 | stream | stream | a part is placed on the board | she's building it live lol |
| fill.stream.placed.03 | stream | stream | a part is placed on the board | server acquired |
| fill.stream.placed.04 | stream | stream | a part is placed on the board | ooh new server 🤖 |
| fill.stream.placed.05 | stream | stream | a part is placed on the board | click! satisfying 😩 |
| fill.stream.placed.06 | stream | stream | a part is placed on the board | two servers?? big brain 🧠 |
| fill.stream.placed.07 | stream | stream | a part is placed on the board | speedrun any percent 🏃 |
| fill.stream.placed.08 | stream | stream | a part is placed on the board | lux built that in a blink?? |
| fill.stream.wired.01 | stream | stream | a wire is connected | cable management speedrun |
| fill.stream.wired.02 | stream | stream | a wire is connected | is that thing plugged in now |
| fill.stream.wired.03 | stream | stream | a wire is connected | click. nice. |
| fill.stream.wired.04 | stream | stream | a wire is connected | cable management queen 👑 |
| fill.stream.wired.05 | stream | stream | a wire is connected | plug it in plug it in 🔌 |
| fill.stream.wired.06 | stream | stream | a wire is connected | the requests are flowing 🟡🟡🟡 |
| fill.stream.overclock.01 | stream | stream | the player swaps in the bigger server | she's going for the big server?? brave |
| fill.stream.overclock.02 | stream | stream | the player swaps in the bigger server | big server energy |
| fill.stream.waiting.01 | stream | stream | the coach nudges about an empty grid | lux? you there? |
| fill.stream.waiting.02 | stream | stream | the coach nudges about an empty grid | she's reading the manual lol |
| fill.stream.waiting.03 | stream | stream | the coach nudges about an empty grid | chat is she ok |
| fill.block.waiting.01 | block | block | the coach nudges about an empty grid (a complaint) | kenji: lux is it on yet? |
| fill.block.waiting.02 | block | block | the coach nudges about an empty grid (a complaint) | young father: still nothing on my end |
| fill.block.waiting.03 | block | block | the coach nudges about an empty grid (a complaint) | old man noodles: noodle cam still dark |
| fill.stream.unplugged.01 | stream | stream | the coach nudges about a wire | is it plugged in tho |
| fill.stream.unplugged.02 | stream | stream | the coach nudges about a wire | chat she forgot a cable |
| fill.stream.unplugged.03 | stream | stream | the coach nudges about a wire | plug it in plug it in plug it in |
| fill.stream.unplugged.04 | stream | stream | the coach nudges about a wire | triage is trying its best |
| fill.stream.panic.01 | stream | stream | TRIAGE's alarm about the lift | LUX GO GO GO |
| fill.stream.panic.02 | stream | stream | TRIAGE's alarm about the lift | not the lift again |
| fill.stream.banner.01 | stream | stream | the Solace banner slides in | ugh solace ads on NYE |
| fill.stream.banner.02 | stream | stream | the Solace banner slides in | solace popup lmao |
| fill.stream.banner.03 | stream | stream | the Solace banner slides in | solace really said 'deserves better' huh |
| fill.block.banner.01 | block | block | the Solace banner slides in | mrs okafor: Solace sent me the same advert. |
| fill.block.countdown.01 | block | block | one minute to midnight | mrs okafor: One minute everyone!! |
| fill.block.countdown.02 | block | block | one minute to midnight | old man noodles: one minute. noodles ready |
| fill.block.countdown.03 | block | block | one minute to midnight | young father: he's dialling in. come on come on |
| fill.stream.countdown.01 | stream | stream | one minute to midnight | ONE MINUTE |
| fill.stream.countdown.02 | stream | stream | one minute to midnight | chat it's almost time |
| fill.stream.countdown.03 | stream | stream | one minute to midnight | lux you got this |
| fill.block.final.01 | block | block | ten seconds to midnight | kenji: TEN |
| fill.block.final.02 | block | block | ten seconds to midnight | mrs okafor: Hold hands everyone |
| fill.stream.final.01 | stream | stream | ten seconds to midnight | TEN NINE EIGHT |
| fill.stream.final.02 | stream | stream | ten seconds to midnight | here we gooo |
| fill.stream.final.03 | stream | stream | ten seconds to midnight | don't blink |
| fill.block.scaledown.01 | block | block | a server is turned off after midnight | old man noodles: quiet now. good night everyone |
| fill.stream.scaledown.01 | stream | stream | a server is turned off after midnight | turning servers off already? |
| fill.stream.scaledown.02 | stream | stream | a server is turned off after midnight | eco mode lux |
| fill.stream.pay.01 | stream | stream | the player pays the Solace banner | she PAID solace?? lux no |
| fill.stream.ignore.01 | stream | stream | the player ignores the Solace banner | solace ad skipped. respect |
| fill.stream.bin.01 | stream | stream | the player bins the Solace banner | binned the solace ad lmao |
| fill.block.served.01 | block | block | the first serve, or a new box starts serving | kenji: oh it's moving again |
| fill.block.served.02 | block | block | the first serve, or a new box starts serving | old man noodles: noodle cam is back |
| fill.block.served.03 | block | block | the first serve, or a new box starts serving | young father: video's moving again |
| fill.stream.served.01 | stream | stream | the first serve, or a new box starts serving | picture's back |
| fill.stream.served.02 | stream | stream | the first serve, or a new box starts serving | smooth now |
| fill.block.errors.01 | block | block | errors held 1 s (a complaint) | young father: my call just dropped |
| fill.block.errors.02 | block | block | errors held 1 s (a complaint) | kenji: pages won't load |
| fill.block.errors.03 | block | block | errors held 1 s (a complaint) | old man noodles: the noodle cam froze |
| fill.stream.errors.01 | stream | stream | errors held 1 s | buffering... |
| fill.stream.errors.02 | stream | stream | errors held 1 s | is it freezing for anyone else |
| fill.stream.errors.03 | stream | stream | errors held 1 s | frozen for me |
| fill.block.heavy.01 | block | block | heavy errors held 2 s (a complaint) | old man noodles: nothing is working at all |
| fill.block.heavy.02 | block | block | heavy errors held 2 s (a complaint) | young father: lux please, my son is waiting |
| fill.stream.heavy.01 | stream | stream | heavy errors held 2 s | stream's dying chat |
| fill.stream.heavy.02 | stream | stream | heavy errors held 2 s | the picture is just one frame now |
| fill.stream.heavy.03 | stream | stream | heavy errors held 2 s | it's all red chat |
| fill.block.recovered.01 | block | block | calm 3 s after a spell of errors (thanks) | young father: it's working again. thank you |
| fill.block.recovered.02 | block | block | calm 3 s after a spell of errors (thanks) | kenji: ok lux saved it |
| fill.block.recovered.03 | block | block | calm 3 s after a spell of errors (thanks) | old man noodles: thank you lux |
| fill.stream.recovered.01 | stream | stream | calm 3 s after a spell of errors | WE'RE BACK |
| fill.stream.recovered.02 | stream | stream | calm 3 s after a spell of errors | she actually did it |
| fill.stream.recovered.03 | stream | stream | calm 3 s after a spell of errors | lets gooo |
| fill.block.rejoin.01 | block | block (system) | the recovery, if Mrs Okafor left | system: Mrs Okafor joined the chat |
| fill.block.retries.01 | block | block | retries climb (a complaint) | kenji: i just keep hitting reload |
| fill.block.retries.02 | block | block | retries climb (a complaint) | old man noodles: pressing the button again and again |
| fill.stream.retries.01 | stream | stream | retries climb | everyone spamming refresh rn |
| fill.stream.retries.02 | stream | stream | retries climb | refresh refresh refresh |
| fill.stream.hot.01 | stream | stream | a server starts to overheat | is that server smoking |
| fill.stream.hot.02 | stream | stream | a server starts to overheat | smell-o-vision on, it's toasty |
| fill.stream.hot.03 | stream | stream | a server starts to overheat | that server is cooking |
| fill.stream.died.01 | stream | stream | a server dies from the heat | rip server |
| fill.stream.died.02 | stream | stream | a server dies from the heat | it's gone. pour one out |
| fill.stream.died.03 | stream | stream | a server dies from the heat | server down. SERVER DOWN |
| fill.stream.dip.01 | stream | stream | a power flicker warning starts | lights flickering on her side |
| fill.stream.dip.02 | stream | stream | a power flicker warning starts | did her power just blink |
| fill.stream.skipped.01 | stream | stream | calls go around a dark box, once a run | it just went around the dark one. neat |
| fill.block.laundry.01 | block | block | the laundry floor is cut loose | old man noodles: my washing stopped halfway |
| fill.stream.laundry.01 | stream | stream | the laundry floor is cut loose | she cut a whole floor off lol |
| fill.stream.laundry.02 | stream | stream | the laundry floor is cut loose | rip laundry floor |
| fill.stream.warning.01 | stream | stream | a surge warning goes up | something big is coming, look at that line |
| fill.stream.warning.02 | stream | stream | a surge warning goes up | uh oh |
| fill.stream.warning.03 | stream | stream | a surge warning goes up | line's going up chat |
| fill.block.surge.01 | block | block | the surge lands | kenji: the whole street is online now |
| fill.block.surge.02 | block | block | the surge lands | old man noodles: so many people on the wifi tonight |
| fill.stream.surge.01 | stream | stream | the surge lands | here it comes |
| fill.stream.surge.02 | stream | stream | the surge lands | the neighbours are all piling in |
| fill.stream.surge.03 | stream | stream | the surge lands | OH NO |
| fill.stream.rescue.01 | stream | stream | the crew arrive | WHO ARE THESE PEOPLE |
| fill.stream.rescue.02 | stream | stream | the crew arrive | she has backup?? |
| fill.stream.rescue.03 | stream | stream | the crew arrive | lux has FRIENDS?? |
| fill.block.held.01 | block | block | midnight held | kenji: HAPPY NEW YEAR LUX |
| fill.block.held.02 | block | block | midnight held | old man noodles: noodle cam saw the fireworks |
| fill.block.held.03 | block | block | midnight held | mrs okafor: Happy new year, Lux x |
| fill.stream.held.01 | stream | stream | midnight held | clean midnight. no lag |
| fill.stream.held.02 | stream | stream | midnight held | best stream of the year |
| fill.stream.held.03 | stream | stream | midnight held | HAPPY NEW YEAR CHAT |
| fill.stream.triage.01 | stream | stream | TRIAGE's fans: one filler in five, in any state | TRIAGE IS SO CUTE 😭 |
| fill.stream.triage.02 | stream | stream | TRIAGE's fans: one filler in five, in any state | triage for president 🗳️ |
| fill.stream.triage.03 | stream | stream | TRIAGE's fans: one filler in five, in any state | protect triage at all costs 🛡️ |
| fill.stream.triage.04 | stream | stream | TRIAGE's fans: one filler in five, in any state | triage's x_x face lmaooo |
| fill.stream.triage.05 | stream | stream | TRIAGE's fans: one filler in five, in any state | i'd buy a triage plushie 🧸 |
| fill.stream.triage.06 | stream | stream | TRIAGE's fans: one filler in five, in any state | triage: confident. also triage: 🤡 |
| fill.stream.triage.07 | stream | stream | TRIAGE's fans: one filler in five, in any state | triage yelled GO GO GO 📣 |
| fill.stream.triage.08 | stream | stream | TRIAGE's fans: one filler in five, in any state | give triage a raise 💸 |
| fill.stream.triage.09 | stream | stream | TRIAGE's fans: one filler in five, in any state | triage ^_^ ❤️ |
| fill.stream.triage.10 | stream | stream | TRIAGE's fans: one filler in five, in any state | is triage ok?? 🥺 |
| fill.stream.triage.11 | stream | stream | TRIAGE's fans: one filler in five, in any state | triage moodboard: 😃🤔😎😱😳😊 |
| fill.stream.triage.12 | stream | stream | TRIAGE's fans: one filler in five, in any state | triage stop panicking 😭 |
| fill.stream.triage.13 | stream | stream | TRIAGE's fans: one filler in five, in any state | triage blinked at me ❤️ |
| fill.stream.triage.14 | stream | stream | TRIAGE's fans: one filler in five, in any state | trust triage? no. love triage? YES |
| fill.stream.win.01 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | W |
| fill.stream.win.02 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | W W W |
| fill.stream.win.03 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | HUGE W |
| fill.stream.win.04 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | W LUX |
| fill.stream.win.05 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | W TRIAGE |
| fill.stream.win.06 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | ❤️❤️❤️ |
| fill.stream.win.07 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | 💙💙💙💙 |
| fill.stream.win.08 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | 🔥🔥🔥 |
| fill.stream.win.09 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | LETS GOOO |
| fill.stream.win.10 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | she did it 😭❤️ |
| fill.stream.win.11 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | lights are back!!! 💡💡💡 |
| fill.stream.win.12 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | GOAT behaviour 🐐 |
| fill.stream.win.13 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | clip that 📸 |
| fill.stream.win.14 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | absolute cinema 🎬 |
| fill.stream.win.15 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | certified block hero 🏅 |
| fill.stream.win.16 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | mrs okafor's lift is FREE 🛗 |
| fill.stream.win.17 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | my wifi said thank u lux 📶 |
| fill.stream.win.18 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | the block is BLOCKING 💪 |
| fill.stream.win.19 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | chat we're so back |
| fill.stream.win.20 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | W W W W W W |
| fill.stream.win.21 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | ❤️ from floor six |
| fill.stream.win.22 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | ten outta ten no notes 🙌 |
| fill.stream.win.23 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | standing ovation 👏👏👏 |
| fill.stream.win.24 | stream | stream | a big moment: lights back, a surge survived, midnight (a burst) | noodle cam restored 🍜✨ |

Reactions to what happens on the board (src/scenes/hud/chatEngine.ts REACTIONS), one pool per
`fill.<chat>.<pool>.` prefix. None names a fix, a number or a system-design word. Wording is a draft
until the owner approves it (decision D8).

### Luxcam lane <!-- anchor: luxcam -->

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |

### Learning lane <!-- anchor: learning -->

| ID | Kind | Speaker | When | Line |
| --- | --- | --- | --- | --- |
| C4.chat.dark | chat | block: kenji | the surge's power dip takes the big server dark | lights just blinked and the net went with them |
| C5.chat.lb | chat | stream: viewer | 3 s after the board returns from the rescue | what did they just plug in for her?? |
| C6.chat.dark | chat | block: young father | 23:59:50, the dip takes a server dark | lights blinked. please. ten more seconds |
| C7.chat.01 | chat | block: mrs okafor | 5 s after midnight held | Happy New Year Lux. Now get some sleep x |
| fill.block.dark.01 | block | block | filler while a server is dark | kenji: everything just went out again |
| fill.block.dark.02 | block | block | filler while a server is dark | old man noodles: the noodle cam is just my own face now |

Wording is a draft until the owner approves it (decision D8).

## Not settled yet

- The crew lead's name is a placeholder (Rei Kuroda). Keep it in the strings file only.
- The debrief grade thresholds are not set.
