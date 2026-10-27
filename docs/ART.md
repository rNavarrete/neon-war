# Art in public/art

Rolando picked these on 27 Oct 2026 with the Brownout art picker.
The source sheets are gpt-image-2 generations drawn on magenta. They were chroma-keyed and cut into single images, then saved as WebP with transparency.
The uncut candidates and the prompt scripts are on branch `claude/project-thread-sctaoa` under `docs/art-candidates/`.

Notes:

- Backgrounds are 1536x1024 (3:2). Draw them to cover the 1920x1080 screen; that crops a little from the top and bottom.
- `hud/goggles-overlay.webp` is stretched to exactly 1920x1080, because it frames the whole view.
- `chars/lux/poses/hug-knees.webp` comes from the first room-pose sheet and the other room poses come from v2, as Rolando asked.
- `parts/` is the component catalog for the whole game: each part in four tiers (scrap, street, pro, solace). Brownout uses only the server, gateway, database and load balancer.
- The overclock kit, job card and estimate dial were added later the same day (round 4, picks overclock-kit-b, job-card-a, estimate-dial-b). `board/overclock-kit` is the kit on its own for its tray card; `server-overclocked` is a server with the kit fitted, and `server-overclocked-hot` is the same server cooking in the surge. The job card and dial frames are empty: their text and numbers are drawn in code.
- Sizes are the cut size in pixels. Scale sprites down rather than up where you can.

| Folder | Files (size) | From |
| --- | --- | --- |
| `art/board/` | server (431x638), server-hot (430x637), server-dead (433x637), gateway (407x704), database (453x423), database-hot (489x506), balancer (480x339), slot-empty (489x294), slot-locked (476x379), block (1002x1431), solace-banner (1431x700), crew-cable (254x1502), overclock-kit (430x467), server-overclocked (466x638), server-overclocked-hot (480x636) | block-cutaway, crew-cable, overclock-kit-b, parts-core, parts-crew, parts-servers, solace-banner |
| `art/hud/` | button (479x245), button-hover (477x245), button-pressed (482x245), regroup-ready (313x311), regroup-spent (313x311), part-card (289x389), chart-window (1008x454), chat-panel (353x524), textbox (884x184), nameplate (433x108), clock-panel (213x207), warning-bar (537x147), tray (611x216), goggles-overlay (1920x1080), job-card (864x1252), estimate-dial (823x835) | estimate-dial-b, goggles-overlay, job-card-a, ui-buttons, ui-panels |
| `art/hud/icons/` | credits (372x360), trust (333x366), clock (404x300), warning (347x327), power-dip (175x395), overheat (192x382), lock (323x359), bin (317x365), packet (336x249), pause (298x335), settings (345x325), cut (346x339) | ui-icons-a, ui-icons-b |
| `art/chars/triage/` | eager (238x290), thinking (235x289), proud (238x289), panic (285x291), sheepish (235x290), happy (238x290) | triage-moods |
| `art/chars/lux/faces-board/` | tense (425x457), determined (436x429), deadpan (410x449), shocked (417x456), smirk (427x455), triumphant (506x453) | lux-faces-board-v2b |
| `art/chars/lux/faces-room/` | grieving (442x440), composing (493x438), startled (452x441), relieved (412x429), exhausted (460x431), frightened (400x423) | lux-faces-room-v2 |
| `art/chars/lux/poses/` | reach (459x893), point (353x885), swipe (678x826), tap-drag (423x963), cheer (535x824), rest (468x541), hug-knees (553x683), goggles-up (382x953), look-back (396x927) | lux-poses-board, lux-poses-room, lux-poses-room-v2, lux-poses-win-v2 |
| `art/chars/rei/faces/` | smirk (420x449), stern (392x440), impressed (403x432), grading (421x443), laugh (400x450), annoyed (408x439) | rei-faces |
| `art/chars/rei/poses/` | landing (505x624), arms-crossed (281x889), point (305x884) | rei-poses |
| `art/chars/mika/faces/` | calm (367x457), worried (359x445), reassure (371x456), explain (450x458), focused (365x455), nod (370x461) | mika-sheet |
| `art/chars/mika/poses/` | tablet (296x920), point (455x903), read (311x915) | mika-poses |
| `art/chars/ozzie/faces/` | sceptical (460x495), annoyed (481x490), half-smile (456x486), sums (471x501), alarmed (446x495), smug (452x499) | ozzie-faces |
| `art/chars/ozzie/poses/` | coin (365x950), shrug (578x948), nod (322x950) | ozzie-poses |
| `art/ui/` | logo (1441x614) | logo |
| `art/story/` | akemi-photo (805x947), night-book-page (1536x1024) | akemi-photo, night-book-page |
| `art/bg/` | bedroom-lit (1536x1024), bedroom-dark (1536x1024), bedroom-midnight (1536x1024), immersive (1536x1024), skyline (1536x1024), rooftop (1536x1024), grandma-flat (1536x1024) | bg-bedroom-dark, bg-bedroom-lit, bg-bedroom-midnight, bg-grandma-flat, bg-immersive, bg-rooftop, bg-skyline |
| `art/chars/avatars/` | kenji (512x512), mrs-okafor (512x512), young-father (512x512), old-man-noodles (512x512) | chat-avatars-v2b |
| `art/parts/auth/` | scrap (241x382), street (249x476), pro (346x660), solace (391x829) | comp-auth |
| `art/parts/autoscaler/` | scrap (282x289), street (299x353), pro (423x471), solace (432x595) | comp-autoscaler |
| `art/parts/backup/` | scrap (277x312), street (309x390), pro (393x514), solace (426x694) | comp-backup |
| `art/parts/cache/` | scrap (287x373), street (312x454), pro (370x590), solace (450x731) | comp-cache |
| `art/parts/cdn/` | scrap (253x406), street (282x602), pro (346x769), solace (393x878) | comp-cdn |
| `art/parts/database/` | scrap (280x456), street (299x533), pro (362x688), solace (419x880) | comp-database |
| `art/parts/dns/` | scrap (278x382), street (323x475), pro (395x651), solace (464x799) | comp-dns |
| `art/parts/event-stream/` | scrap (238x422), street (283x514), pro (354x687), solace (446x804) | comp-event-stream |
| `art/parts/failover-switch/` | scrap (302x413), street (337x504), pro (399x599), solace (442x696) | comp-failover-switch |
| `art/parts/firewall/` | scrap (257x463), street (297x588), pro (349x693), solace (435x829) | comp-firewall |
| `art/parts/gateway/` | scrap (248x472), street (278x573), pro (336x665), solace (411x803) | comp-gateway |
| `art/parts/kv-store/` | scrap (251x355), street (300x466), pro (369x626), solace (438x835) | comp-kv-store |
| `art/parts/load-balancer/` | scrap (320x274), street (338x313), pro (387x380), solace (438x465) | comp-load-balancer |
| `art/parts/logging/` | scrap (247x319), street (301x427), pro (347x655), solace (430x820) | comp-logging |
| `art/parts/monitoring/` | scrap (228x517), street (283x604), pro (340x777), solace (431x897) | comp-monitoring |
| `art/parts/object-storage/` | scrap (301x422), street (339x517), pro (398x661), solace (490x839) | comp-object-storage |
| `art/parts/power-supply/` | scrap (270x331), street (326x439), pro (354x575), solace (384x693) | comp-power-supply |
| `art/parts/queue/` | scrap (260x300), street (352x417), pro (406x603), solace (473x706) | comp-queue |
| `art/parts/rate-limiter/` | scrap (266x382), street (292x466), pro (372x678), solace (405x843) | comp-rate-limiter |
| `art/parts/search-index/` | scrap (276x343), street (291x413), pro (370x544), solace (437x756) | comp-search-index |
| `art/parts/server/` | scrap (257x411), street (301x475), pro (326x636), solace (398x789) | comp-server |
| `art/parts/worker/` | scrap (267x348), street (306x426), pro (373x573), solace (451x708) | comp-worker |
