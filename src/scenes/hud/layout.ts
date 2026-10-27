// Where the HUD's panels sit, in 1920x1080 game space. The board keeps x 380-1540, y 140-880 for
// its parts and the bottom centre (x 560-1360, y > 880) for its tray; the HUD stays in the top strip
// (y < 140), the left column (x < 380), the right column (x > 1540) and the bottom corners. Only
// the job card, the Solace banner and the sizing prompt cover the board, and only while open.

export const FONT = 'ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace';
export const FONT_SANS = 'system-ui, "Segoe UI", Roboto, "DejaVu Sans", Arial, sans-serif';

export const COLORS = {
  cyan: 0x2de2e6,
  cyanText: '#2de2e6',
  amber: 0xffa62b,
  amberText: '#ffa62b',
  magenta: 0xff4fd8,
  magentaText: '#ff6be0',
  white: '#e8f1ff',
  dim: '#8aa0c8',
  red: 0xff4d4d,
  redText: '#ff6b6b',
  ink: 0x05070f,
};

export const TOP = {
  clockPanel: { x: 20, y: 8, size: 124 },
  clockText: { x: 160, y: 18 },
  countdown: { x: 160, y: 72 },
  trust: { x: 560, y: 70 },
  credits: { x: 740, y: 70 },
  warning: { x: 940, y: 6, w: 600, h: 128 },
};

export const RIGHT = {
  chart: { x: 1552, y: 150, w: 356, h: 250, inset: 28 },
  dialLabel: { x: 1730, y: 420 },
  dial: { x: 1730, y: 552, size: 230 },
  dialMinus: { x: 1588, y: 552, r: 26 },
  dialPlus: { x: 1872, y: 552, r: 26 },
  dialSet: { x: 1730, y: 708, w: 150, h: 58 },
  laundry: { x: 1556, y: 760, w: 350, h: 110 },
};

export const LEFT = {
  block: { x: 16, y: 150, w: 352, h: 430, rows: 6 },
  stream: { x: 16, y: 590, w: 352, h: 290, rows: 4 },
};

export const BOTTOM = {
  bark: { x: 16, y: 906, w: 540, h: 160 },
  regroup: { x: 1452, y: 990, size: 140 },
};

export const CENTRE = {
  jobCard: { x: 960, y: 532, scale: 0.6 },
  banner: { x: 960, y: 330, scale: 0.45 },
  sizing: { x: 700, y: 150, w: 600, h: 112 },
  /** WIRING(board): where the dip warning goes when the board hasn't said where the part is. */
  dipFallback: { x: 960, y: 300 },
};
