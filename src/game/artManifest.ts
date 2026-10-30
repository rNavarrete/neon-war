// The art manifest: every picked file under public/art that the game loads, with its real cut size,
// the largest size it is drawn at on the 1920x1080 screen and where it shows; and every piece of art
// the Live screen has asked the owner's pipeline for (docs/ART-REQUESTS.md), with the size to cut it
// at, where it shows and the code fallback that stands in until it is picked.
//
// Pure data and lookups: no Phaser, so tests/art-manifest.test.ts checks it in node against the
// files on disk. Workers never add art (public/art is protected): when the owner drops a picked file,
// its key goes into PICKED_CUTS with the file's real size, so its request's `cut` is no longer null,
// and src/scenes/plates.ts starts loading it instead of the fallback. Nothing else changes.

import type { CardId, ZoneId } from '../scenes/live/layout';

/** A width and height in pixels. */
export interface Size {
  readonly w: number;
  readonly h: number;
}

/**
 * Where a piece of art shows: a Live screen zone or card (src/scenes/live/layout.ts), the whole
 * screen, the story scenes, the title screen, the debrief, or the shell's buttons (title, pause,
 * settings).
 */
export type ArtPlace = ZoneId | CardId | 'screen' | 'story' | 'titleScreen' | 'debrief' | 'shell';

/** A picked file the game loads today. */
export interface PickedArt {
  /** Path under public/, as the scenes pass it to the loader: 'art/board/server.webp'. */
  readonly file: string;
  /** The file's real pixel size (measured from the WebP header; the test re-measures it). */
  readonly cut: Size;
  /** The largest size it is drawn at, in game pixels at 1920x1080. */
  readonly display: Size;
  /** Where it shows (its largest use first when it shows in more than one place). */
  readonly zone: ArtPlace;
  /** What it is used for, in a few words. */
  readonly use: string;
  /** Drawn through a nine-slice (src/scenes/hud/panel.ts) at corner scale k: corners never upscale while k <= 1. */
  readonly nineSlice?: { readonly k: number };
  /** A full-screen backdrop drawn to cover 1920x1080 (docs/ART.md): a 1.25x upscale is accepted. */
  readonly cover?: true;
  /** Why an image is drawn above its cut size today; art3d-5 resolves these. */
  readonly upscaled?: string;
}

/** A requested piece stands in with a picked file, tinted, until it is picked. */
export interface ReuseFallback {
  readonly kind: 'reuse';
  /** A file in PICKED_ART: 'art/hud/textbox.webp'. */
  readonly file: string;
  readonly tint: number;
  readonly alpha: number;
  readonly note: string;
}

/** A requested piece stands in with a plate baked once in code, in its display size. */
export interface BakeFallback {
  readonly kind: 'bake';
  /** The plate's fill; the rim is drawn in the same colour, brighter. */
  readonly color: number;
  readonly alpha: number;
  readonly note: string;
}

export type ArtFallback = ReuseFallback | BakeFallback;

/** Requests by batch: 1 board and map, 2 band and chat, 3 cam, 4 shell, 5 deferred. */
export type ArtBatch = 1 | 2 | 3 | 4 | 5;

export type ArtLane = 'board' | 'gauges' | 'comms' | 'chat' | 'luxcam' | 'art3d';

/** A piece of art the Live screen has asked for. */
export interface ArtRequest {
  /** The one key every file uses: 'hud/city-grid' is public/art/hud/city-grid.webp. */
  readonly key: string;
  readonly what: string;
  readonly batch: ArtBatch;
  readonly lane: ArtLane;
  readonly zone: ArtPlace;
  /** The size it is drawn at, in game pixels. */
  readonly display: Size;
  /** The size the owner's pipeline should cut it at (never smaller than display, unless nine-sliced). */
  readonly target: Size;
  /** The picked file's real size; null until the owner's drop PR lands the file. */
  readonly cut: Size | null;
  /** The states it has, and which of them code draws. */
  readonly states: string;
  /** One line for the gpt-image-2 prompt, under the style anchor. */
  readonly prompt: string;
  /** Nine-sliced at corner scale k (cut corners times k = drawn corners). */
  readonly nineSlice?: { readonly k: number };
  /** What draws while it is not picked. */
  readonly fallback: ArtFallback;
}

const size = (w: number, h: number): Size => ({ w, h });

/**
 * The real size of each picked file of the Live screen's requests (Rolando's picks of 28 Oct 2026,
 * landed by the owner's art pipeline). A request is picked once its key is here.
 *
 * Round 2 (28 Oct 2026) replaced six: the comms plate (1455x149), the antenna system icon (41x64),
 * the shorter channel plate (300x233), the overclocked dark server (466x629), the card frames (all
 * 240x280, nine-sliced at k 0.5 into the 120x140 card) and hud/live/corner-marks, now a 96x96 SET
 * of all four brackets, one per 48x48 quadrant: a panel draws each corner from its own quadrant,
 * unturned (src/scenes/hud/kit.ts cornerStamps). The cam busts (924x548) have transparent sides.
 *
 * Three came out smaller than the size first asked for, so each request's display is the file's
 * own size and its view draws it 1:1, never upscaled (tests/art-manifest.test.ts checks every pick):
 * - hud/live/topbar-strip is 1536x33 against a 1920x100 bar. Stretching it would blur its
 *   hairline, so the view draws it 1:1 (centred, or repeated at scale 1 along the bar) and fills
 *   the rest of the bar in code.
 * - hud/comms-plate is 1455x149 in the 1455x150 band: CommsView centres it on whole pixels.
 * - board/table-plate is 1228x416 under a 1441 px feed: the board centres it (tablePlatePlace).
 */
const PICKED_CUTS: Readonly<Record<string, Size>> = {
  'board/table-plate': size(1228, 416),
  'board/server-dark': size(425, 638),
  'board/server-booting-a': size(427, 638),
  'board/server-booting-b': size(420, 638),
  'board/server-overclocked-dark': size(466, 629),
  'board/balancer-ping-a': size(449, 306),
  'board/balancer-ping-b': size(449, 306),
  'board/channel-plate': size(300, 233),
  'hud/city-grid': size(816, 620),
  'hud/comms-plate': size(1455, 149),
  'chars/comms/triage': size(244, 256),
  'chars/comms/rei': size(240, 256),
  'chars/comms/mika': size(236, 256),
  'chars/comms/ozzie': size(221, 256),
  'hud/live/avatar-luxnet': size(243, 256),
  'hud/icons/door': size(128, 120),
  'hud/icons/tv': size(128, 120),
  'hud/icons/system': size(41, 64),
  'hud/icons/play': size(128, 123),
  'hud/icons/ping': size(128, 123),
  'hud/icons/skipped': size(128, 124),
  'hud/chat-plate-wide': size(770, 485),
  'chars/avatars/stream-1': size(244, 256),
  'chars/avatars/stream-2': size(243, 256),
  'chars/avatars/stream-3': size(244, 256),
  'chars/avatars/stream-4': size(243, 256),
  'chars/avatars/unnamed-neighbour': size(243, 256),
  'chars/lux/cam/lean-in': size(924, 548),
  'chars/lux/cam/relieved': size(924, 548),
  'hud/cam-backdrop': size(824, 504),
  'hud/live/panel-frame': size(192, 192),
  'hud/live/label-tab': size(380, 72),
  'hud/live/tag-chip': size(216, 72),
  'hud/live/rec-badge': size(121, 48),
  'hud/live/live-pill': size(189, 56),
  'hud/live/corner-marks': size(96, 96),
  'hud/live/divider': size(8, 160),
  'hud/live/keycap-idle': size(160, 128),
  'hud/live/keycap-ready': size(160, 128),
  'hud/live/keycap-pressed': size(160, 128),
  'hud/live/card-frame-idle': size(240, 280),
  'hud/live/card-frame-ready': size(240, 280),
  'hud/live/card-frame-locked': size(240, 280),
  'hud/live/count-badge': size(49, 56),
  'hud/live/topbar-strip': size(1536, 33),
  'hud/live/alert-plate': size(1040, 168),
  'hud/live/alert-endcap': size(135, 168),
  'hud/gauge-face': size(480, 269),
  'hud/gauge-needle': size(24, 162),
  'chars/lux/cam/cheer': size(924, 548),
  'hud/cam-frame': size(408, 243),
  'board/table-plate-midnight': size(1061, 416),
  'hud/city-grid-lit': size(816, 620),
  'board/packet-cube': size(59, 48),
  'hud/live/night-shift-sticker': size(320, 136),
};

/** A request's cut: the picked file's real size, or null while its fallback draws. */
const picked = (key: string): Size | null => PICKED_CUTS[key] ?? null;

/** A cut drawn at scale k, rounded to whole pixels. */
const scaled = (cut: Size, k: number): Size => size(Math.round(cut.w * k), Math.round(cut.h * k));

/** A cut fitted inside a w x h box without upscaling, as the board fits part art. */
const fit = (cut: Size, w: number, h: number): Size => scaled(cut, Math.min(1, w / cut.w, h / cut.h));

/** The story scenes draw portraits at 0.8, and the speaker at 0.8 x 1.03 (src/story/view.ts). */
/** A bust in a story scene (src/story/stage.ts): 0.97, and 1.0 while it speaks. */
const PORTRAIT_K = 0.97 * 1.03;

const portrait = (path: string, cut: Size): PickedArt => ({
  file: `art/chars/${path}.webp`,
  cut,
  display: scaled(cut, PORTRAIT_K),
  zone: 'story',
  use: 'speaker portrait in the story scenes; the bark face (124 px) and the COMMS slot crop',
});

/** A tall story sprite, cut at 927 px: 900 px on stage and 927 (its own size) while it speaks. */
const sprite = (path: string, cut: Size, use: string): PickedArt => ({
  file: `art/chars/${path}.webp`,
  cut,
  display: scaled(cut, 1),
  zone: 'story',
  use,
});

/** The locked parts' scrap tier in the inventory's padlocked drawer: 40x72 minis, art at 72% x 70%. */
const scrap = (kind: string, cut: Size): PickedArt => ({
  file: `art/parts/${kind}/scrap.webp`,
  cut,
  display: fit(cut, 40 * 0.72, 72 * 0.7),
  zone: 'inventory',
  use: `locked ${kind} mini in the padlocked drawer`,
});

const BG = size(1536, 1024);
/** A backdrop scaled to cover 1920x1080: max(1920/1536, 1080/1024) = 1.25. */
const COVER = scaled(BG, 1.25);

/** Every picked file the game loads or a fallback reuses, by folder. */
export const PICKED_ART: readonly PickedArt[] = [
  // board/: the FEED's parts and pads, the banner, the crew's cable.
  {
    file: 'art/board/server.webp',
    cut: size(431, 638),
    display: fit(size(431, 638), 104, 150),
    zone: 'feed',
    use: 'scrap server on a pad; inventory card art',
  },
  {
    file: 'art/board/server-hot.webp',
    cut: size(430, 637),
    display: fit(size(430, 637), 104, 150),
    zone: 'feed',
    use: 'server over its share',
  },
  {
    file: 'art/board/server-dead.webp',
    cut: size(433, 637),
    display: fit(size(433, 637), 104, 150),
    zone: 'feed',
    use: 'dead server',
  },
  {
    file: 'art/board/server-overclocked.webp',
    cut: size(466, 638),
    display: fit(size(466, 638), 104, 150),
    zone: 'feed',
    use: 'server with the kit fitted',
  },
  {
    file: 'art/board/server-overclocked-hot.webp',
    cut: size(480, 636),
    display: fit(size(480, 636), 104, 150),
    zone: 'feed',
    use: 'overclocked server cooking in the surge',
  },
  {
    file: 'art/board/gateway.webp',
    cut: size(524, 612),
    display: fit(size(524, 612), 110, 128),
    zone: 'feed',
    use: 'the gateway',
  },
  {
    file: 'art/board/database.webp',
    cut: size(453, 423),
    display: fit(size(453, 423), 150, 140),
    zone: 'feed',
    use: 'the database',
  },
  {
    file: 'art/board/database-hot.webp',
    cut: size(489, 506),
    display: fit(size(489, 506), 150, 140),
    zone: 'feed',
    use: 'the database above 200 (decision D2)',
  },
  {
    file: 'art/board/balancer.webp',
    cut: size(449, 306),
    display: fit(size(449, 306), 140, 95),
    zone: 'feed',
    use: "the crew's balancer; its inventory card",
  },
  {
    file: 'art/board/overclock-kit.webp',
    cut: size(430, 467),
    display: fit(size(430, 467), 100 * 0.72, 135 * 0.62),
    zone: 'inventory',
    use: 'the overclock kit card',
  },
  {
    file: 'art/board/slot-empty.webp',
    cut: size(489, 294),
    display: scaled(size(489, 294), 132 / 489),
    zone: 'feed',
    use: 'empty pad',
  },
  {
    file: 'art/board/slot-locked.webp',
    cut: size(476, 379),
    display: scaled(size(476, 379), 132 / 476),
    zone: 'feed',
    use: 'the locked balancer pad',
  },
  {
    file: 'art/board/solace-banner.webp',
    cut: size(1431, 700),
    display: scaled(size(1431, 700), 0.45),
    zone: 'banner',
    use: 'the C2 Solace banner card',
  },
  {
    file: 'art/board/crew-cable.webp',
    cut: size(254, 1502),
    display: scaled(size(254, 1502), 0.55),
    zone: 'story',
    use: "the crew's cable in the rescue scene; board-9 on resume",
  },

  // hud/: plates, cards, buttons and icons.
  {
    file: 'art/hud/goggles-overlay.webp',
    cut: size(1920, 1080),
    display: size(1920, 1080),
    zone: 'screen',
    use: 'the goggles frame over the board and the C0 cue (board-1 removes it from the board)',
  },
  {
    file: 'art/hud/part-card.webp',
    cut: size(289, 389),
    display: size(100, 135),
    zone: 'inventory',
    use: 'inventory card frame',
  },
  {
    file: 'art/hud/chart-window.webp',
    cut: size(1008, 454),
    display: size(408, 180),
    zone: 'gauge',
    use: 'the retired SCOPE plate (the LAST 60 s chart is gone); kept for a later instrument',
    nineSlice: { k: 0.4 },
  },
  {
    file: 'art/hud/chat-panel.webp',
    cut: size(353, 524),
    display: size(385, 275),
    zone: 'chat',
    use: 'CHAT plate; the story chat corner at 0.75',
    nineSlice: { k: 0.55 },
  },
  {
    file: 'art/hud/job-card.webp',
    cut: size(864, 1252),
    display: scaled(size(864, 1252), 0.6),
    zone: 'jobCard',
    use: 'the C1 job card',
  },
  {
    file: 'art/hud/warning-bar.webp',
    cut: size(537, 147),
    display: size(1040, 84),
    zone: 'alert',
    use: 'ALERT plate',
    nineSlice: { k: 0.85 },
  },
  {
    file: 'art/hud/clock-panel.webp',
    cut: size(213, 207),
    display: size(124, 121),
    zone: 'clock',
    use: 'clock plate',
  },
  {
    file: 'art/hud/textbox.webp',
    cut: size(884, 184),
    display: scaled(size(884, 184), 1.3),
    zone: 'story',
    use: 'the story text box; the bark box and COMMS stand-in plate (nine-sliced at 0.6)',
    upscaled: 'the story text box draws it at 1.3 (src/story/view.ts); the HUD draws it nine-sliced at 0.6',
  },
  {
    file: 'art/hud/nameplate.webp',
    cut: size(433, 108),
    display: scaled(size(433, 108), 0.8),
    zone: 'story',
    use: "the speaker's nameplate",
  },
  {
    file: 'art/hud/button.webp',
    cut: size(479, 245),
    display: scaled(size(479, 245), 0.6),
    zone: 'shell',
    use: 'shell buttons at 0.6; SET, OK and CUT nine-sliced at 0.45 or more',
  },
  {
    file: 'art/hud/button-hover.webp',
    cut: size(477, 245),
    display: scaled(size(477, 245), 0.6),
    zone: 'shell',
    use: 'button hover state',
  },
  {
    file: 'art/hud/button-pressed.webp',
    cut: size(482, 245),
    display: scaled(size(482, 245), 0.6),
    zone: 'shell',
    use: 'button pressed state',
  },
  {
    file: 'art/hud/regroup-ready.webp',
    cut: size(313, 311),
    display: scaled(size(313, 311), 0.6),
    zone: 'deck',
    use: 'Regroup key (140 px in the deck; 0.6 in the C5 scene)',
  },
  {
    file: 'art/hud/regroup-spent.webp',
    cut: size(313, 311),
    display: size(140, 139),
    zone: 'deck',
    use: 'Regroup spent',
  },
  {
    file: 'art/hud/icons/trust.webp',
    cut: size(333, 366),
    display: scaled(size(333, 366), 0.17),
    zone: 'title',
    use: 'trust chip',
  },
  {
    file: 'art/hud/icons/credits.webp',
    cut: size(372, 360),
    display: scaled(size(372, 360), 0.17),
    zone: 'title',
    use: 'credits chip',
  },
  {
    file: 'art/hud/icons/clock.webp',
    cut: size(404, 300),
    display: scaled(size(404, 300), 0.2),
    zone: 'clock',
    use: 'clock glyph',
  },
  {
    file: 'art/hud/icons/warning.webp',
    cut: size(347, 327),
    display: scaled(size(347, 327), 0.15),
    zone: 'feed',
    use: 'warning triangle (loaded by the HUD; board-5 draws it over a part)',
  },
  {
    file: 'art/hud/icons/power-dip.webp',
    cut: size(175, 395),
    display: scaled(size(175, 395), 0.22),
    zone: 'dipFallback',
    use: 'power-dip warning',
  },
  {
    file: 'art/hud/icons/cut.webp',
    cut: size(346, 339),
    display: scaled(size(346, 339), 0.13),
    zone: 'deck',
    use: 'the laundry cut key; the wire cut button',
  },
  {
    file: 'art/hud/icons/lock.webp',
    cut: size(323, 359),
    display: fit(size(323, 359), 34, 34),
    zone: 'inventory',
    use: 'padlock on locked cards',
  },
  {
    file: 'art/hud/icons/bin.webp',
    cut: size(317, 365),
    display: fit(size(317, 365), 39, 39),
    zone: 'feed',
    use: 'decommission button',
  },
  {
    file: 'art/hud/icons/packet.webp',
    cut: size(336, 249),
    display: size(24, 18),
    zone: 'feed',
    use: 'fallback for the packet cube (batch 5)',
  },

  // chars/: the crew's faces and poses, TRIAGE, the block's avatars.
  portrait('triage/eager', size(231, 290)),
  portrait('triage/thinking', size(232, 290)),
  portrait('triage/proud', size(235, 290)),
  portrait('triage/panic', size(251, 266)),
  portrait('triage/sheepish', size(233, 290)),
  portrait('triage/happy', size(235, 290)),
  portrait('lux/faces-board/determined', size(436, 429)),
  portrait('lux/faces-board/tense', size(425, 457)),
  portrait('lux/faces-board/deadpan', size(410, 449)),
  portrait('lux/faces-board/shocked', size(417, 456)),
  portrait('lux/faces-board/smirk', size(427, 455)),
  portrait('lux/faces-board/triumphant', size(506, 453)),
  sprite(
    'lux/vn/neutral',
    size(515, 927),
    "Lux's story sprite, standing behind the text box (vn-lux-b take 2)",
  ),
  sprite('lux/vn/photo', size(601, 927), "Lux looking at Akemi's photo in the cold open (vn-lux-a take 2)"),
  sprite(
    'lux/vn/composing',
    size(538, 927),
    "Lux's composing story sprite, goggles round her neck (vn-lux-composing)",
  ),
  sprite(
    'lux/vn/exhausted',
    size(538, 927),
    "Lux's exhausted story sprite, goggles round her neck (vn-lux-exhausted)",
  ),
  sprite(
    'lux/vn/frightened',
    size(538, 927),
    "Lux's frightened story sprite, goggles round her neck (vn-lux-frightened)",
  ),
  sprite(
    'lux/vn/grieving',
    size(538, 927),
    "Lux's grieving story sprite, goggles round her neck (vn-lux-grieving)",
  ),
  sprite(
    'lux/vn/relieved',
    size(538, 927),
    "Lux's relieved story sprite, goggles round her neck (vn-lux-relieved)",
  ),
  sprite(
    'lux/vn/startled',
    size(538, 927),
    "Lux's startled story sprite, goggles round her neck (vn-lux-startled)",
  ),
  sprite(
    'lux/vn/board-deadpan',
    size(538, 927),
    "Lux's deadpan story sprite, goggles down (vn-lux-board-deadpan)",
  ),
  sprite(
    'lux/vn/board-determined',
    size(538, 927),
    "Lux's determined story sprite, goggles down (vn-lux-board-determined)",
  ),
  sprite(
    'lux/vn/board-shocked',
    size(538, 927),
    "Lux's shocked story sprite, goggles down (vn-lux-board-shocked)",
  ),
  sprite('lux/vn/board-smirk', size(538, 927), "Lux's smirk story sprite, goggles down (vn-lux-board-smirk)"),
  sprite('lux/vn/board-tense', size(538, 927), "Lux's tense story sprite, goggles down (vn-lux-board-tense)"),
  sprite(
    'lux/vn/board-triumphant',
    size(538, 927),
    "Lux's triumphant story sprite, goggles down (vn-lux-board-triumphant)",
  ),
  portrait('lux/faces-room/composing', size(493, 438)),
  portrait('lux/faces-room/grieving', size(442, 440)),
  portrait('lux/faces-room/relieved', size(412, 429)),
  portrait('lux/faces-room/exhausted', size(460, 431)),
  sprite('rei/vn/annoyed', size(454, 927), "Rei's annoyed story sprite (vn-rei-annoyed, from pose take 1)"),
  sprite('rei/vn/grading', size(454, 927), "Rei's grading story sprite (vn-rei-grading, from pose take 1)"),
  sprite(
    'rei/vn/impressed',
    size(454, 927),
    "Rei's impressed story sprite (vn-rei-impressed, from pose take 1)",
  ),
  sprite('rei/vn/laugh', size(454, 927), "Rei's laugh story sprite (vn-rei-laugh, from pose take 1)"),
  sprite('rei/vn/smirk', size(454, 927), "Rei's smirk story sprite (vn-rei-smirk, from pose take 1)"),
  sprite('rei/vn/stern', size(454, 927), "Rei's stern story sprite (vn-rei-stern, from pose take 1)"),
  sprite('rei/vn/pose-1', size(455, 927), "Rei's tall pose take 1, kept for later scenes (vn-rei-1)"),
  sprite('rei/vn/pose-2', size(433, 927), "Rei's tall pose take 2, kept for later scenes (vn-rei-2)"),
  sprite('rei/vn/pose-3', size(435, 927), "Rei's tall pose take 3, kept for later scenes (vn-rei-3)"),
  sprite('mika/vn/calm', size(464, 927), "Mika's calm story sprite (vn-mika-calm, from pose take 1)"),
  sprite(
    'mika/vn/explain',
    size(464, 927),
    "Mika's explain story sprite (vn-mika-explain, from pose take 1)",
  ),
  sprite(
    'mika/vn/focused',
    size(464, 927),
    "Mika's focused story sprite (vn-mika-focused, from pose take 1)",
  ),
  sprite('mika/vn/nod', size(464, 927), "Mika's nod story sprite (vn-mika-nod, from pose take 1)"),
  sprite(
    'mika/vn/reassure',
    size(464, 927),
    "Mika's reassure story sprite (vn-mika-reassure, from pose take 1)",
  ),
  sprite(
    'mika/vn/worried',
    size(464, 927),
    "Mika's worried story sprite (vn-mika-worried, from pose take 1)",
  ),
  sprite('mika/vn/pose-1', size(437, 927), "Mika's tall pose take 1, kept for later scenes (vn-mika-1)"),
  sprite('mika/vn/pose-2', size(400, 927), "Mika's tall pose take 2, kept for later scenes (vn-mika-2)"),
  sprite('mika/vn/pose-3', size(489, 927), "Mika's tall pose take 3, kept for later scenes (vn-mika-3)"),
  sprite(
    'ozzie/vn/alarmed',
    size(538, 927),
    "Ozzie's alarmed story sprite (vn-ozzie-alarmed, from pose take 1)",
  ),
  sprite(
    'ozzie/vn/annoyed',
    size(538, 927),
    "Ozzie's annoyed story sprite (vn-ozzie-annoyed, from pose take 1)",
  ),
  sprite(
    'ozzie/vn/half-smile',
    size(538, 927),
    "Ozzie's half-smile story sprite (vn-ozzie-half-smile, from pose take 1)",
  ),
  sprite(
    'ozzie/vn/sceptical',
    size(538, 927),
    "Ozzie's sceptical story sprite (vn-ozzie-sceptical, from pose take 1)",
  ),
  sprite('ozzie/vn/smug', size(538, 927), "Ozzie's smug story sprite (vn-ozzie-smug, from pose take 1)"),
  sprite('ozzie/vn/sums', size(538, 927), "Ozzie's sums story sprite (vn-ozzie-sums, from pose take 1)"),
  sprite('ozzie/vn/pose-1', size(492, 927), "Ozzie's tall pose take 1, kept for later scenes (vn-ozzie-1)"),
  sprite('ozzie/vn/pose-2', size(474, 927), "Ozzie's tall pose take 2, kept for later scenes (vn-ozzie-2)"),
  sprite('ozzie/vn/pose-3', size(533, 927), "Ozzie's tall pose take 3, kept for later scenes (vn-ozzie-3)"),
  portrait('rei/faces/smirk', size(420, 449)),
  portrait('rei/faces/grading', size(421, 443)),
  portrait('rei/faces/impressed', size(403, 432)),
  portrait('rei/faces/stern', size(392, 440)),
  portrait('mika/faces/calm', size(367, 457)),
  portrait('mika/faces/reassure', size(371, 456)),
  portrait('mika/faces/explain', size(450, 458)),
  portrait('mika/faces/focused', size(365, 455)),
  portrait('ozzie/faces/smug', size(452, 499)),
  portrait('ozzie/faces/half-smile', size(456, 486)),
  portrait('ozzie/faces/sums', size(471, 501)),
  portrait('ozzie/faces/sceptical', size(460, 495)),
  {
    file: 'art/chars/lux/poses/goggles-up.webp',
    cut: size(382, 953),
    display: scaled(size(382, 953), 0.42),
    zone: 'cam',
    use: 'the 537 s beat on the cam (luxcam-3)',
  },
  {
    file: 'art/chars/avatars/kenji.webp',
    cut: size(512, 512),
    display: size(40, 40),
    zone: 'chat',
    use: 'block chat avatar',
  },
  {
    file: 'art/chars/avatars/mrs-okafor.webp',
    cut: size(512, 512),
    display: size(40, 40),
    zone: 'chat',
    use: 'block chat avatar',
  },
  {
    file: 'art/chars/avatars/young-father.webp',
    cut: size(512, 512),
    display: size(40, 40),
    zone: 'chat',
    use: 'block chat avatar',
  },
  {
    file: 'art/chars/avatars/old-man-noodles.webp',
    cut: size(512, 512),
    display: size(40, 40),
    zone: 'chat',
    use: 'block chat avatar',
  },

  // parts/: the 20 locked kinds' scrap tier (src/scenes/board/tray.ts LOCKED_KINDS).
  scrap('gateway', size(248, 472)),
  scrap('database', size(280, 456)),
  scrap('auth', size(241, 382)),
  scrap('autoscaler', size(282, 289)),
  scrap('backup', size(277, 312)),
  scrap('cache', size(287, 373)),
  scrap('cdn', size(253, 406)),
  scrap('dns', size(278, 382)),
  scrap('event-stream', size(238, 422)),
  scrap('failover-switch', size(302, 413)),
  scrap('firewall', size(257, 463)),
  scrap('kv-store', size(251, 355)),
  scrap('logging', size(247, 319)),
  scrap('monitoring', size(228, 517)),
  scrap('object-storage', size(301, 422)),
  scrap('power-supply', size(270, 331)),
  scrap('queue', size(260, 300)),
  scrap('rate-limiter', size(266, 382)),
  scrap('search-index', size(276, 343)),
  scrap('worker', size(267, 348)),

  // bg/, story/, ui/: backdrops, the story props and the logo.
  {
    file: 'art/bg/skyline.webp',
    cut: BG,
    display: COVER,
    zone: 'feed',
    use: 'the skyline behind the board',
    cover: true,
  },
  {
    file: 'art/bg/bedroom-dark.webp',
    cut: BG,
    display: COVER,
    zone: 'story',
    use: "Lux's room in C0 and the fail scene; the cam backdrop stand-in",
    cover: true,
  },
  {
    file: 'art/bg/title-rooftop.webp',
    cut: BG,
    display: COVER,
    zone: 'titleScreen',
    use: 'the title screen: Lux and TRIAGE on a rooftop (Rolando picked title A, 30 Oct 2026)',
    cover: true,
  },
  {
    file: 'art/bg/immersive.webp',
    cut: BG,
    display: COVER,
    zone: 'story',
    use: 'the C5 rescue backdrop',
    cover: true,
  },
  {
    file: 'art/bg/bedroom-midnight.webp',
    cut: BG,
    display: COVER,
    zone: 'debrief',
    use: 'the debrief room',
    cover: true,
  },
  {
    file: 'art/story/night-book-page.webp',
    cut: BG,
    display: BG,
    zone: 'debrief',
    use: 'the Night Book page',
  },
  {
    file: 'art/story/akemi-photo.webp',
    cut: size(805, 947),
    display: scaled(size(805, 947), 0.7),
    zone: 'story',
    use: "Akemi's photo, an insert in the cold open until Lux speaks",
  },
  {
    file: 'art/ui/logo.webp',
    cut: size(1441, 614),
    display: scaled(size(1441, 614), 0.6),
    zone: 'titleScreen',
    use: 'the title logo',
  },
];

/** The style anchor every prompt in docs/ART-REQUESTS.md sits under. */
export const STYLE_ANCHOR =
  'painted cyberpunk, dark navy, amber the only warm light, cyan only for lamps, red only over capacity, same hand as board/server.webp; cutouts on flat magenta, no glow, no text';

const DIM_TINT = 0x55556a;
const NAVY = 0x0b1424;
const AMBER = 0xffb347;
const CYAN = 0x5ce1ff;

const reuse = (file: string, tint: number, alpha: number, note: string): ReuseFallback => ({
  kind: 'reuse',
  file,
  tint,
  alpha,
  note,
});
const bake = (color: number, alpha: number, note: string): BakeFallback => ({
  kind: 'bake',
  color,
  alpha,
  note,
});

/** The display size of a part in the feed's middle row (rows scale 0.88 / 1.0 / 1.06; the front row is the largest). */
const RACK_FRONT = size(85, 121);

/** Every requested piece, in batch order (docs/ART-REQUESTS.md is generated from the same table). */
export const ART_REQUESTS: readonly ArtRequest[] = [
  // Batch 1: board and map.
  {
    key: 'board/table-plate',
    what: 'perspective PCB table under the parts, no pads painted (code draws any number of pads)',
    batch: 1,
    lane: 'board',
    zone: 'feed',
    display: size(1228, 416),
    target: size(1536, 416),
    cut: picked('board/table-plate'),
    states: 'one; midnight is a tint',
    prompt:
      'PCB desk 30 degrees from above, an even cyan silkscreen grid edge to edge, no pads or footprints (code places 6 to 24+ pads), amber rim at the near lip, empty; trapezoid 1215 px wide at the far edge, 1441 px at the near edge',
    fallback: bake(NAVY, 0.9, 'the code-baked slab the board draws today'),
  },
  {
    key: 'board/server-dark',
    what: 'the scrap server with every lamp off (sheet A)',
    batch: 1,
    lane: 'board',
    zone: 'feed',
    display: RACK_FRONT,
    target: size(431, 638),
    cut: picked('board/server-dark'),
    states: 'dark',
    prompt: 'board/server.webp with all lamps off',
    fallback: reuse('art/board/server.webp', DIM_TINT, 1, 'the server tinted dim'),
  },
  {
    key: 'board/server-booting-a',
    what: 'boot lamp frame A: cyan lamp strip low (sheet A)',
    batch: 1,
    lane: 'board',
    zone: 'feed',
    display: RACK_FRONT,
    target: size(431, 638),
    cut: picked('board/server-booting-a'),
    states: 'booting, alternates with -b at 4 Hz',
    prompt: 'board/server.webp with its cyan lamp strip lit low',
    fallback: reuse('art/board/server.webp', 0xa8c8ff, 0.75, 'the server tinted cool, pulsing in alpha'),
  },
  {
    key: 'board/server-booting-b',
    what: 'boot lamp frame B: cyan lamp strip high (sheet A)',
    batch: 1,
    lane: 'board',
    zone: 'feed',
    display: RACK_FRONT,
    target: size(431, 638),
    cut: picked('board/server-booting-b'),
    states: 'booting, alternates with -a at 4 Hz',
    prompt: 'board/server.webp with its cyan lamp strip lit high',
    fallback: reuse('art/board/server.webp', 0xd8e8ff, 0.9, 'the server tinted cool, pulsing in alpha'),
  },
  {
    key: 'board/server-overclocked-dark',
    what: 'the kit-fitted server unlit (sheet B)',
    batch: 1,
    lane: 'board',
    zone: 'feed',
    display: RACK_FRONT,
    target: size(466, 638),
    cut: picked('board/server-overclocked-dark'),
    states: 'dark',
    prompt: 'board/server-overclocked.webp fully unlit',
    fallback: reuse('art/board/server-overclocked.webp', DIM_TINT, 1, 'the overclocked server tinted dim'),
  },
  {
    key: 'board/balancer-ping-a',
    what: 'the balancer with its lamp off (sheet B)',
    batch: 1,
    lane: 'board',
    zone: 'feed',
    display: size(140, 95),
    target: size(449, 306),
    cut: picked('board/balancer-ping-a'),
    states: 'ping off, while it passes a box over',
    prompt: 'board/balancer.webp with its lamp off',
    fallback: reuse('art/board/balancer.webp', 0x9a9ab0, 1, 'the balancer tinted grey'),
  },
  {
    key: 'board/balancer-ping-b',
    what: 'the balancer with a cyan lamp lit (sheet B)',
    batch: 1,
    lane: 'board',
    zone: 'feed',
    display: size(140, 95),
    target: size(449, 306),
    cut: picked('board/balancer-ping-b'),
    states: 'ping on, while it passes a box over',
    prompt: 'board/balancer.webp with one cyan lamp lit',
    fallback: reuse('art/board/balancer.webp', 0xffffff, 1, 'the balancer as picked'),
  },
  {
    key: 'board/channel-plate',
    what: 'the amber trough entering the feed from the left, engraved scale (optional)',
    batch: 1,
    lane: 'board',
    zone: 'feed',
    display: size(150, 200),
    target: size(300, 400),
    cut: picked('board/channel-plate'),
    states: 'one; fill and ticks are code',
    prompt: 'a dark metal gutter from the left, amber rim, five engraved ticks, empty',
    fallback: bake(0x1a1408, 0.85, 'a dark trough with an amber rim'),
  },
  {
    key: 'hud/city-grid',
    what: "top-down night map of the district, Lux's block right of centre",
    batch: 1,
    lane: 'gauges',
    zone: 'map',
    display: size(408, 310),
    target: size(816, 620),
    cut: picked('hud/city-grid'),
    states: 'one; lights and dots are code',
    prompt:
      'top-down slum district at night, rain-wet streets, one block right-centre with unlit windows, four dark blocks at the left, no labels',
    fallback: bake(NAVY, 0.95, 'a vector street grid'),
  },

  // Batch 2: band and chat.
  {
    key: 'hud/comms-plate',
    what: 'the COMMS band plate: dark glass, amber hairline, divider, tag well',
    batch: 2,
    lane: 'comms',
    zone: 'comms',
    display: size(1455, 149),
    target: size(1455, 150),
    cut: picked('hud/comms-plate'),
    states: 'one; the WARNING border is code',
    prompt: 'a 10:1 near-black glass strip, 1 px amber outline, a divider 520 px in, a chip well right',
    fallback: reuse('art/hud/textbox.webp', 0xffffff, 0.9, 'the text box plate, nine-sliced'),
  },
  {
    key: 'chars/comms/triage',
    what: "TRIAGE's round badge: a white drone lens",
    batch: 2,
    lane: 'comms',
    zone: 'comms',
    display: size(84, 84),
    target: size(256, 256),
    cut: picked('chars/comms/triage'),
    states: 'one; lit or dark by tint',
    prompt: 'a round badge like chars/avatars/kenji.webp: a white drone lens',
    fallback: reuse('art/chars/triage/eager.webp', 0xffffff, 1, 'the eager TRIAGE face, round-cropped'),
  },
  {
    key: 'chars/comms/rei',
    what: "Rei's round badge, neutral",
    batch: 2,
    lane: 'comms',
    zone: 'comms',
    display: size(84, 84),
    target: size(256, 256),
    cut: picked('chars/comms/rei'),
    states: 'one; dark before the rescue by tint',
    prompt: 'a round badge like chars/avatars/kenji.webp: Rei, neutral',
    fallback: reuse('art/chars/rei/faces/smirk.webp', 0xffffff, 1, 'her default board face, round-cropped'),
  },
  {
    key: 'chars/comms/mika',
    what: "Mika's round badge, neutral",
    batch: 2,
    lane: 'comms',
    zone: 'comms',
    display: size(84, 84),
    target: size(256, 256),
    cut: picked('chars/comms/mika'),
    states: 'one; dark before the rescue by tint',
    prompt: 'a round badge like chars/avatars/kenji.webp: Mika, neutral',
    fallback: reuse('art/chars/mika/faces/calm.webp', 0xffffff, 1, 'her default board face, round-cropped'),
  },
  {
    key: 'chars/comms/ozzie',
    what: "Ozzie's round badge, neutral",
    batch: 2,
    lane: 'comms',
    zone: 'comms',
    display: size(84, 84),
    target: size(256, 256),
    cut: picked('chars/comms/ozzie'),
    states: 'one; dark before the rescue by tint',
    prompt: 'a round badge like chars/avatars/kenji.webp: Ozzie, neutral',
    fallback: reuse('art/chars/ozzie/faces/smug.webp', 0xffffff, 1, 'his default board face, round-cropped'),
  },
  {
    key: 'hud/live/avatar-luxnet',
    what: "Lux_Net's profile picture in the title cluster",
    batch: 2,
    lane: 'gauges',
    zone: 'title',
    display: size(72, 72),
    target: size(256, 256),
    cut: picked('hud/live/avatar-luxnet'),
    states: 'one',
    prompt: 'a round badge like chars/avatars/kenji.webp: Lux grinning, goggles up',
    fallback: reuse(
      'art/chars/lux/faces-board/determined.webp',
      0xffffff,
      1,
      'her board face, round-cropped',
    ),
  },
  {
    key: 'hud/icons/door',
    what: 'HOUSE chip for Grandma through the door',
    batch: 2,
    lane: 'comms',
    zone: 'comms',
    display: size(64, 64),
    target: size(128, 128),
    cut: picked('hud/icons/door'),
    states: 'one',
    prompt: 'an amber glyph like hud/icons/warning.webp: a door ajar',
    fallback: bake(0x2a1d08, 1, 'an amber-rimmed disc'),
  },
  {
    key: 'hud/icons/tv',
    what: 'HOUSE chip for the TV downstairs',
    batch: 2,
    lane: 'comms',
    zone: 'comms',
    display: size(64, 64),
    target: size(128, 128),
    cut: picked('hud/icons/tv'),
    states: 'one',
    prompt: 'an amber glyph like hud/icons/warning.webp: an old TV',
    fallback: bake(0x2a1d08, 1, 'an amber-rimmed disc'),
  },
  {
    key: 'hud/icons/system',
    what: 'the chat system-row glyph',
    batch: 2,
    lane: 'chat',
    zone: 'chat',
    display: size(20, 20),
    target: size(64, 64),
    cut: picked('hud/icons/system'),
    states: 'one',
    prompt: 'an amber glyph like hud/icons/warning.webp: an antenna',
    fallback: bake(0x2a1d08, 1, 'an amber dot'),
  },
  {
    key: 'hud/icons/play',
    what: 'the SET key glyph',
    batch: 2,
    lane: 'gauges',
    zone: 'deck',
    display: size(44, 44),
    target: size(128, 128),
    cut: picked('hud/icons/play'),
    states: 'one; lit or dim by tint',
    prompt: 'an amber glyph like hud/icons/warning.webp: a play triangle',
    fallback: bake(0x2a1d08, 1, 'an amber-rimmed square'),
  },
  {
    key: 'hud/icons/ping',
    what: 'the ping mark over a part the balancer checks',
    batch: 2,
    lane: 'board',
    zone: 'feed',
    display: size(44, 44),
    target: size(128, 128),
    cut: picked('hud/icons/ping'),
    states: 'one',
    prompt: 'an amber glyph like hud/icons/warning.webp: a radar ping',
    fallback: bake(0x08202a, 1, 'a cyan-rimmed disc'),
  },
  {
    key: 'hud/icons/skipped',
    what: 'the SKIPPED stamp on a pad the balancer passes over',
    batch: 2,
    lane: 'board',
    zone: 'feed',
    display: size(64, 64),
    target: size(128, 128),
    cut: picked('hud/icons/skipped'),
    states: 'one',
    prompt: 'an amber glyph like hud/icons/warning.webp: a dashed box',
    fallback: bake(0x2a1d08, 1, 'an amber-rimmed square'),
  },
  {
    key: 'hud/chat-plate-wide',
    what: 'the landscape LIVE CHAT plate with a 36 px header',
    batch: 2,
    lane: 'chat',
    zone: 'chat',
    display: size(385, 275),
    target: size(770, 550),
    cut: picked('hud/chat-plate-wide'),
    states: 'one',
    prompt: 'dark navy glass, thin amber rim, lighter header band, empty, the brush of hud/chat-panel.webp',
    fallback: reuse('art/hud/chat-panel.webp', 0xffffff, 1, 'the portrait chat panel, nine-sliced'),
  },
  ...[1, 2, 3, 4].map((n): ArtRequest => ({
    key: `chars/avatars/stream-${n}`,
    what: `stream viewer avatar ${n}`,
    batch: 2,
    lane: 'chat',
    zone: 'chat',
    display: size(36, 36),
    target: size(256, 256),
    cut: picked(`chars/avatars/stream-${n}`),
    states: 'one',
    prompt: [
      'a cyan-rimmed disc: a hooded teen',
      'a cyan-rimmed disc: a noodle-shop cat sticker',
      'a cyan-rimmed disc: a glitch mask',
      'a cyan-rimmed disc: a rain-soaked commuter',
    ][n - 1],
    fallback: bake(0x08202a, 1, 'a cyan ring with the viewer initial'),
  })),
  {
    key: 'chars/avatars/unnamed-neighbour',
    what: 'a faceless neighbour for the seeded chat line',
    batch: 2,
    lane: 'chat',
    zone: 'chat',
    display: size(36, 36),
    target: size(256, 256),
    cut: picked('chars/avatars/unnamed-neighbour'),
    states: 'one',
    prompt: 'a cyan-rimmed disc: a backlit faceless silhouette',
    fallback: bake(0x08202a, 1, 'a cyan ring'),
  },

  // Batch 3: cam.
  {
    key: 'chars/lux/cam/lean-in',
    what: 'Lux leaning in at the drone, a hand on her goggles',
    batch: 3,
    lane: 'luxcam',
    zone: 'cam',
    display: size(388, 230),
    target: size(924, 548),
    cut: picked('chars/lux/cam/lean-in'),
    states: 'leaning',
    prompt:
      'the girl of chars/lux/faces-board/determined.webp, webcam bust, leaning in, one hand on her goggles, amber light from below-left',
    fallback: reuse(
      'art/chars/lux/faces-board/determined.webp',
      0xffffff,
      1,
      'her determined board face, cropped to the lens',
    ),
  },
  {
    key: 'chars/lux/cam/relieved',
    what: 'Lux, goggles down, eyes shut, exhaling',
    batch: 3,
    lane: 'luxcam',
    zone: 'cam',
    display: size(388, 230),
    target: size(924, 548),
    cut: picked('chars/lux/cam/relieved'),
    states: 'relieved',
    prompt: 'same framing as lean-in, goggles on, eyes closed, exhaling, a small smile',
    fallback: reuse(
      'art/chars/lux/faces-room/relieved.webp',
      0xffffff,
      1,
      'her relieved room face, cropped to the lens',
    ),
  },
  {
    key: 'hud/cam-backdrop',
    what: "the bedroom from the drone's eye, empty",
    batch: 3,
    lane: 'luxcam',
    zone: 'cam',
    display: size(412, 252),
    target: size(824, 504),
    cut: picked('hud/cam-backdrop'),
    states: 'all; 20% darker while panicking (tint)',
    prompt:
      'a cluttered teenage bedroom at night from desk height, rain-streaked window, blurred neon, no characters',
    fallback: reuse('art/bg/bedroom-dark.webp', 0xc0c0d0, 1, 'the dark bedroom, cropped to the lens'),
  },

  // Batch 4: shell (frame language, deck keys, cards, top bar, alert).
  ...(
    [
      ['panel-frame', 'panel frame, nine-sliced with 48 px corners', size(408, 270), size(192, 192), 0.5],
      ['label-tab', 'label tab on a panel', size(240, 36), size(480, 72), undefined],
      ['tag-chip', 'tag chip', size(120, 36), size(240, 72), undefined],
      ['rec-badge', 'REC badge on the cam', size(72, 24), size(144, 48), undefined],
      ['live-pill', 'LIVE pill in the title', size(96, 28), size(192, 56), undefined],
      ['corner-marks', 'bracket corner marks for a panel', size(48, 48), size(96, 96), undefined],
      ['divider', 'divider rule', size(4, 150), size(8, 300), undefined],
    ] as const
  ).map(([name, what, display, target, k]): ArtRequest => ({
    key: `hud/live/${name}`,
    what,
    batch: 4,
    lane: 'art3d',
    zone: name === 'rec-badge' ? 'cam' : name === 'live-pill' ? 'title' : 'screen',
    display,
    target,
    cut: picked(`hud/live/${name}`),
    states: 'one; tints by code',
    prompt:
      'thin dark translucent frames, 2 px amber edges, bracket corner marks like the mockup, a label tab, tag chip, REC badge, LIVE pill, divider',
    ...(k === undefined ? {} : { nineSlice: { k } }),
    fallback: bake(NAVY, 0.85, 'a dark plate with a 2 px amber rim'),
  })),
  ...(
    [
      ['keycap-idle', 'deck key, idle', 'art/hud/button.webp', DIM_TINT],
      ['keycap-ready', 'deck key, ready', 'art/hud/button-hover.webp', 0xffffff],
      ['keycap-pressed', 'deck key, pressed', 'art/hud/button-pressed.webp', 0xffffff],
    ] as const
  ).map(([name, what, file, tint]): ArtRequest => ({
    key: `hud/live/${name}`,
    what,
    batch: 4,
    lane: 'gauges',
    zone: 'deck',
    display: size(80, 64),
    target: size(160, 128),
    cut: picked(`hud/live/${name}`),
    states: 'idle, ready, pressed: one file each',
    prompt: 'three wide deck keys (dark, amber-lit edge, pressed darker), empty centres',
    nineSlice: { k: 0.5 },
    fallback: reuse(file, tint, 1, 'the picked button, nine-sliced'),
  })),
  ...(
    [
      ['card-frame-idle', 'inventory card frame, idle', 0xffffff, 1],
      ['card-frame-ready', 'inventory card frame, ready', AMBER, 1],
      ['card-frame-locked', 'inventory card frame, locked', DIM_TINT, 0.8],
    ] as const
  ).map(([name, what, tint, alpha]): ArtRequest => ({
    key: `hud/live/${name}`,
    what,
    batch: 4,
    lane: 'board',
    zone: 'inventory',
    display: size(120, 140),
    target: size(240, 280),
    cut: picked(`hud/live/${name}`),
    states: 'idle, ready, locked: one file each',
    prompt: 'three square card frames (grey, amber, dim), empty centres',
    nineSlice: { k: 0.5 },
    fallback: reuse('art/hud/part-card.webp', tint, alpha, 'the picked part card, tinted'),
  })),
  {
    key: 'hud/live/count-badge',
    what: 'count badge on an inventory card',
    batch: 4,
    lane: 'board',
    zone: 'inventory',
    display: size(40, 28),
    target: size(80, 56),
    cut: picked('hud/live/count-badge'),
    states: 'one',
    prompt: 'a small dark count badge with an amber edge',
    fallback: bake(0x2a1d08, 1, 'an amber-rimmed pill'),
  },
  {
    key: 'hud/live/topbar-strip',
    what: 'the top bar band',
    batch: 4,
    lane: 'gauges',
    zone: 'screen',
    // The pick is 1536x33, short of the 1920x100 bar it was cut for: drawn 1:1, never stretched
    // (see PICKED_CUTS). The bar around it is code fill.
    display: size(1536, 33),
    target: size(1920, 100),
    cut: picked('hud/live/topbar-strip'),
    states: 'one; states are tints',
    prompt: 'a thin dark band with one amber hairline',
    fallback: bake(0x05070f, 0.9, 'a dark band with an amber hairline'),
  },
  {
    key: 'hud/live/alert-plate',
    what: 'the alert banner plate',
    batch: 4,
    lane: 'gauges',
    zone: 'alert',
    display: size(1040, 84),
    target: size(1040, 168),
    cut: picked('hud/live/alert-plate'),
    states: 'one; states are tints',
    prompt: "a long dark plate with a 2 px amber edge like the mockup's raid banner",
    nineSlice: { k: 0.5 },
    fallback: reuse('art/hud/warning-bar.webp', 0xffffff, 1, 'the picked warning bar, nine-sliced'),
  },
  {
    key: 'hud/live/alert-endcap',
    what: "the alert banner's hazard end cap",
    batch: 4,
    lane: 'gauges',
    zone: 'alert',
    display: size(120, 84),
    target: size(240, 168),
    cut: picked('hud/live/alert-endcap'),
    states: 'one',
    prompt: 'a hazard-striped end cap, amber and black, for the right end of the alert plate',
    fallback: bake(0x2a1d08, 1, 'amber hazard stripes drawn in code'),
  },

  // Batch 5: deferred until batches 1 to 4 were in; picked 28 Oct 2026 (round 2). Each keeps its fallback.
  {
    key: 'hud/gauge-face',
    what: 'the demand gauge face',
    batch: 5,
    lane: 'gauges',
    zone: 'gauge',
    display: size(240, 135),
    target: size(480, 280),
    cut: picked('hud/gauge-face'),
    states: 'one',
    prompt: 'a dark half-dial with engraved amber ticks, empty',
    fallback: bake(NAVY, 0.9, 'the vector arc gauges-5 draws'),
  },
  {
    key: 'hud/gauge-needle',
    what: 'the demand gauge needle',
    batch: 5,
    lane: 'gauges',
    zone: 'gauge',
    display: size(12, 81),
    target: size(24, 176),
    cut: picked('hud/gauge-needle'),
    states: 'one',
    prompt: 'a thin amber needle with a dark hub',
    fallback: bake(AMBER, 1, 'a code-drawn line'),
  },
  {
    key: 'chars/lux/cam/cheer',
    what: 'Lux cheering on the cam',
    batch: 5,
    lane: 'luxcam',
    zone: 'cam',
    display: size(388, 230),
    target: size(924, 548),
    cut: picked('chars/lux/cam/cheer'),
    states: 'cheer',
    prompt: 'same framing as lean-in, both fists up, grinning',
    fallback: reuse('art/chars/lux/faces-board/triumphant.webp', 0xffffff, 1, 'her triumphant board face'),
  },
  {
    key: 'hud/cam-frame',
    what: 'the cam frame',
    batch: 5,
    lane: 'luxcam',
    zone: 'cam',
    display: size(408, 243),
    target: size(408, 270),
    cut: picked('hud/cam-frame'),
    states: 'one; amber or red rim by tint',
    prompt: 'a webcam frame with bracket corners and a thin amber rim, empty',
    fallback: bake(NAVY, 0.6, 'a code-drawn rim'),
  },
  {
    key: 'board/table-plate-midnight',
    what: 'the table plate after midnight',
    batch: 5,
    lane: 'board',
    zone: 'feed',
    display: size(1061, 416),
    target: size(1536, 416),
    cut: picked('board/table-plate-midnight'),
    states: 'one',
    prompt: 'board/table-plate at midnight: the silkscreen dimmer, the amber rim cold',
    fallback: bake(0x070d18, 0.9, 'the slab tinted for midnight'),
  },
  {
    key: 'hud/city-grid-lit',
    what: "the map's lit windows",
    batch: 5,
    lane: 'gauges',
    zone: 'map',
    display: size(408, 310),
    target: size(816, 620),
    cut: picked('hud/city-grid-lit'),
    states: 'one; floors light by code',
    prompt: "hud/city-grid with every window of Lux's block lit amber",
    fallback: bake(NAVY, 0.6, 'lit floors drawn as code rects'),
  },
  {
    key: 'board/packet-cube',
    what: 'a packet cube',
    batch: 5,
    lane: 'board',
    zone: 'feed',
    display: size(24, 18),
    target: size(64, 48),
    cut: picked('board/packet-cube'),
    states: 'normal and red by tint',
    prompt: 'a small glowing data cube in cyan, three-quarter view',
    fallback: reuse('art/hud/icons/packet.webp', CYAN, 1, 'the packet icon, tinted'),
  },
  {
    key: 'hud/live/night-shift-sticker',
    what: 'the NIGHT SHIFT sticker',
    batch: 5,
    lane: 'art3d',
    zone: 'screen',
    display: size(160, 80),
    target: size(320, 160),
    cut: picked('hud/live/night-shift-sticker'),
    states: 'one',
    prompt: 'a scuffed vinyl sticker shape, amber and navy, blank face for code text',
    fallback: bake(0x2a1d08, 1, 'an amber-rimmed plate'),
  },
];

/** The batches the owner has run: all five, picked by 28 Oct 2026 (batch 5 was deferred until 1 to 4 were in). */
export const BATCHES_NOW: readonly ArtBatch[] = [1, 2, 3, 4, 5];

/** A picked file's entry by its path under public/. */
export function pickedArt(file: string): PickedArt | undefined {
  return PICKED_ART.find((p) => p.file === file);
}

/** A request by key. */
export function artRequest(key: string): ArtRequest | undefined {
  return ART_REQUESTS.find((r) => r.key === key);
}

/** The file a request lands at under public/: 'hud/city-grid' -> 'art/hud/city-grid.webp'. */
export function requestFile(key: string): string {
  return `art/${key}.webp`;
}

/** Whether a request has been picked: its file has landed and the manifest carries its cut size. */
export function isPicked(r: ArtRequest): boolean {
  return r.cut !== null;
}
