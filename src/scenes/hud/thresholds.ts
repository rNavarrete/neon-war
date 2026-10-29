// The numbers the Live screen's instruments share (contract 'thresholds', docs/LIVE.md): where the
// room-left bar turns amber and red, where Lux's cam calms down again, and the fixed top of every
// demand scale (the gauge, the board's channel bank, the scope's ceiling). Luxcam and the board
// import them from here. Pure constants.

/** The bar turns amber once load (demand / wired capacity) reaches 0.7: under 30% of the room left. */
export const HEADROOM_AMBER_FROM = 0.7;

/** Load over 1.0 is over: more is coming than the wired boxes can serve, and the bar goes all red. */
export const HEADROOM_RED_OVER = 1.0;

/** Lux's cam leaves its stressed look once load falls back under 0.6 (hysteresis under the amber line). */
export const HEADROOM_EXIT = 0.6;

/** The top of every demand scale, in req/s: the gauge, the channel bank and the scope run 0..400. */
export const DEMAND_SCALE_MAX = 400;

/** The room-left bar's segments. */
export const HEADROOM_SEGMENTS = 30;
