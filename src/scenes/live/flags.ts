// Flags every view on the Live screen can read through its host, decided once from the page URL.
// Pure: a function of the query string, so the rules are unit-tested in node.

export interface LiveFlags {
  /**
   * Reduced effects: decorative particles, parallax and pulses are off so headless browser tests
   * draw fewer frames' worth of work. True under `?test`. Lite changes no hook value, only looks.
   */
  readonly lite: boolean;
}

/** The flags in play (no `?test`). */
export const PLAY_FLAGS: LiveFlags = Object.freeze({ lite: false });

/** The flags for a page URL's query string. */
export function flagsFrom(search: string): LiveFlags {
  const params = new URLSearchParams(search);
  return params.has('test') ? Object.freeze({ lite: true }) : PLAY_FLAGS;
}
