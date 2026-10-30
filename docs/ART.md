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
- `src/game/artManifest.ts` lists every file here that the game loads, with its cut size, the size it is drawn at and where it shows. `tests/art-manifest.test.ts` re-measures each file and fails when the game loads a file the manifest lacks. The art the Live screen still needs is in `docs/ART-REQUESTS.md`.

| Folder | Files (size) | From |
| --- | --- | --- |
| `art/board/` | server (431x638), server-hot (430x637), server-dead (433x637), gateway (524x612), database (453x423), database-hot (489x506), balancer (449x306), slot-empty (489x294), slot-locked (476x379), block (1002x1431), solace-banner (1431x700), crew-cable (254x1502), overclock-kit (430x467), server-overclocked (466x638), server-overclocked-hot (480x636) | block-cutaway, crew-cable, overclock-kit-b, parts-core, parts-crew, parts-servers, solace-banner, icon-balancer-c (take 3), icon-gateway-c (take 1) |
| `art/hud/` | button (479x245), button-hover (477x245), button-pressed (482x245), regroup-ready (313x311), regroup-spent (313x311), part-card (289x389), chart-window (1008x454), chat-panel (353x524), textbox (884x184), nameplate (433x108), clock-panel (213x207), warning-bar (537x147), tray (611x216), goggles-overlay (1920x1080), job-card (864x1252), estimate-dial (823x835) | estimate-dial-b, goggles-overlay, job-card-a, ui-buttons, ui-panels |
| `art/hud/icons/` | credits (372x360), trust (333x366), clock (404x300), warning (347x327), power-dip (175x395), overheat (192x382), lock (323x359), bin (317x365), packet (336x249), pause (298x335), settings (345x325), cut (346x339) | ui-icons-a, ui-icons-b |
| `art/chars/triage/` | eager (231x290), thinking (232x290), proud (235x290), panic (251x266), sheepish (233x290), happy (235x290) | triage-cat-moods (Rolando's pick, 30 Oct 2026: the cat drone with an LED screen face) |
| `art/chars/lux/faces-board/` | tense (425x457), determined (436x429), deadpan (410x449), shocked (417x456), smirk (427x455), triumphant (506x453) | lux-faces-board-v2b |
| `art/chars/lux/vn/` | neutral (515x927), photo (601x927); room moods composing, exhausted, frightened, grieving, relieved, startled and goggles-down board-deadpan, board-determined, board-shocked, board-smirk, board-tense, board-triumphant (538x927) | vn-lux-b-2-shirt, vn-lux-a-2-shirt, vn-lux-&lt;mood&gt; (tall story sprites edited from vn-lux-b-2, same scale and bottom cut, so they swap in place; the text box covers below the waist) |
| `art/chars/lux/faces-room/` | grieving (442x440), composing (493x438), startled (452x441), relieved (412x429), exhausted (460x431), frightened (400x423) | lux-faces-room-v2 |
| `art/chars/lux/poses/` | reach (459x893), point (353x885), swipe (678x826), tap-drag (423x963), cheer (535x824), rest (468x541), hug-knees (553x683), goggles-up (382x953), look-back (396x927) | lux-poses-board, lux-poses-room, lux-poses-room-v2, lux-poses-win-v2 |
| `art/chars/rei/faces/` | smirk (420x449), stern (392x440), impressed (403x432), grading (421x443), laugh (400x450), annoyed (408x439) | rei-faces |
| `art/chars/rei/poses/` | landing (505x624), arms-crossed (281x889), point (305x884) | rei-poses |
| `art/chars/rei/vn/` | annoyed, grading, impressed, laugh, smirk, stern (454x927); pose-1 (455x927), pose-2 (433x927), pose-3 (435x927) | vn-rei-&lt;mood&gt;, vn-rei-1..3 (tall story sprites; the six moods share one canvas so they swap in place) |
| `art/chars/mika/faces/` | calm (367x457), worried (359x445), reassure (371x456), explain (450x458), focused (365x455), nod (370x461) | mika-sheet |
| `art/chars/mika/poses/` | tablet (296x920), point (455x903), read (311x915) | mika-poses |
| `art/chars/mika/vn/` | calm, explain, focused, nod, reassure, worried (464x927); pose-1 (437x927), pose-2 (400x927), pose-3 (489x927) | vn-mika-&lt;mood&gt;, vn-mika-1..3 (tall story sprites; the six moods share one canvas so they swap in place) |
| `art/chars/ozzie/faces/` | sceptical (460x495), annoyed (481x490), half-smile (456x486), sums (471x501), alarmed (446x495), smug (452x499) | ozzie-faces |
| `art/chars/ozzie/poses/` | coin (365x950), shrug (578x948), nod (322x950) | ozzie-poses |
| `art/chars/ozzie/vn/` | alarmed, annoyed, half-smile, sceptical, smug, sums (538x927); pose-1 (492x927), pose-2 (474x927), pose-3 (533x927) | vn-ozzie-&lt;mood&gt;, vn-ozzie-1..3 (tall story sprites; the six moods share one canvas so they swap in place) |
| `art/ui/` | logo (1441x614) | logo |
| `art/story/` | akemi-photo (805x947), night-book-page (1536x1024) | akemi-photo, night-book-page |
| `art/bg/` | bedroom-lit (1536x1024), bedroom-dark (1536x1024), bedroom-midnight (1536x1024), immersive (1536x1024), skyline (1536x1024), rooftop (1536x1024), grandma-flat (1536x1024), title-rooftop (1536x1024) | bg-bedroom-dark, bg-bedroom-lit, bg-bedroom-midnight, bg-grandma-flat, bg-immersive, bg-rooftop, bg-skyline; title-rooftop is Rolando's title A pick (30 Oct 2026) |
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

## Live screen (M4 picks, 28 Oct 2026)

Rolando picked these 55 pieces, every request of the Live screen's batches 1 to 5 (`docs/ART-REQUESTS.md`): batches 1 to 4 first, then round 2 (six of them recut) and batch 5. Each was downscaled to fit its cut, never upscaled; the sizes below are the files' real sizes, as `PICKED_CUTS` in `src/game/artManifest.ts` holds them.

Notes:

- Round 2 replaced `hud/comms-plate` (1455x149, a divider 520 px in), `hud/icons/system` (an antenna, 41x64), `board/channel-plate` (300x233, shorter than before), `board/server-overclocked-dark` (466x629), the three `hud/live/card-frame-*` (240x280 each, nine-sliced at k 0.5 into the 120x140 card) and `hud/live/corner-marks`.
- `hud/live/corner-marks` is a 96x96 set of all four brackets, one per 48x48 quadrant: a panel draws each corner from its own quadrant, unturned, at 48 px or smaller (`cornerStamps` in `src/scenes/hud/kit.ts`).
- `hud/live/topbar-strip` is 1536x33, short of the 1920x100 bar. It is drawn 1:1 (its request's display is the file size) and the rest of the bar is filled in code, so it is never stretched.
- `hud/comms-plate` (1455x149) and `board/table-plate` (1228x416) are drawn at their file size, centred in the band and under the feed.
- `board/table-plate-midnight` (1061x416) is narrower than the day plate: it is drawn at its own size, centred like the day plate, and cross-fades in at midnight.
- `chars/comms/triage` is rebuilt from the triage-cat-moods eager face (Rolando's pick, 30 Oct 2026) with its LED screen left blank: the comms band's code iris is drawn on it as the screen's eye.
- The cam busts `chars/lux/cam/*` are 924x548 with transparent sides; cheer has the same framing as lean-in and relieved.
- `hud/live/night-shift-sticker` is a blank plate: any words on it are drawn in code.

| Folder | Files (size) | From |
| --- | --- | --- |
| `art/board/` | table-plate (1228x416), server-dark (425x638), server-booting-a (427x638), server-booting-b (420x638), server-overclocked-dark (466x629), balancer-ping-a (449x306), balancer-ping-b (449x306), channel-plate (300x233), table-plate-midnight (1061x416), packet-cube (59x48) | batch 1: table plate, sheet A, sheet B, channel plate; batch 5 midnight plate, packet cube |
| `art/hud/` | city-grid (816x620), comms-plate (1455x149), chat-plate-wide (770x485), cam-backdrop (824x504), gauge-face (480x269), gauge-needle (24x162), cam-frame (408x243), city-grid-lit (816x620) | batch 1 city-grid; batch 2 comms-plate, chat-plate-wide; batch 3 backdrop; batch 5 gauge, cam frame, lit city grid |
| `art/hud/icons/` | door (128x120), tv (128x120), system (41x64), play (128x123), ping (128x123), skipped (128x124) | batch 2 icons |
| `art/hud/live/` | avatar-luxnet (243x256), panel-frame (192x192), label-tab (380x72), tag-chip (216x72), rec-badge (121x48), live-pill (189x56), corner-marks (96x96), divider (8x160), keycap-idle (160x128), keycap-ready (160x128), keycap-pressed (160x128), card-frame-idle (240x280), card-frame-ready (240x280), card-frame-locked (240x280), count-badge (49x56), topbar-strip (1536x33), alert-plate (1040x168), alert-endcap (135x168), night-shift-sticker (320x136) | batch 2 round avatars; batch 4 panel kit, keycaps and cards, topbar-strip, alert-plate; batch 5 sticker |
| `art/chars/comms/` | triage (244x256), rei (240x256), mika (236x256), ozzie (221x256) | batch 2 round avatars |
| `art/chars/avatars/` | stream-1 (244x256), stream-2 (243x256), stream-3 (244x256), stream-4 (243x256), unnamed-neighbour (243x256) | batch 2 stream avatars |
| `art/chars/lux/cam/` | lean-in (924x548), relieved (924x548), cheer (924x548) | batch 3 lean-in, relieved; batch 5 cheer |

## How a picked file lands

The Live screen's new art is requested in `docs/ART-REQUESTS.md`. Until a piece is picked, the game draws its fallback, so nothing waits on a pick.

1. The owner's pipeline draws the sheet on magenta, chroma-keys it, cuts each piece at the cut size in its request row and saves it as WebP with transparency at the key's path: `hud/city-grid` goes to `public/art/hud/city-grid.webp`.
2. In the same PR, the owner adds the key to `PICKED_CUTS` in `src/game/artManifest.ts` with the file's real size (so that request's `cut` is no longer `null`), and adds the file to the tables above.
3. That is the whole change. `tests/art-manifest.test.ts` fails if a request's file is on disk while its `cut` is still `null`, if the size is wrong, or if the file is smaller than the size it is drawn at (a nine-slice only needs its corners at k to fit).

How the code picks it up: views ask `src/scenes/plates.ts` for a key. `preloadArt(scene, keys)` queues the picked file once `cut` is set, or the file the fallback reuses before that. `resolveArt(key)` and `ensureArt(scene, key)` return the texture, tint and alpha to draw, and `fallback: true` while a stand-in draws. A stand-in is a picked file reused with a tint, or a plate baked once in code at the key's display size and labelled with the key. Under `?test`, the `art` hook section lists the keys still on a fallback (`art.fallback`), the picked keys loaded (`art.loaded`), the plates baked so far (`art.baked`) and any object drawing Phaser's missing texture (`art.missing`).

Workers never add, edit or resize files here. The views adopt `resolveArt` in their own tickets (board-12, comms-9, chat-6, luxcam-5), and art3d-5 checked batches 1 to 4 against the manifest once they landed (28 Oct 2026).
