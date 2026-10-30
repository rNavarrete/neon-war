// Where named things on the Live screen sit, for the comms band's leader line (contract 'locate').
// A lane that draws something a line may point at registers a function that says where it is now;
// the band asks by name. Names in use: inventory, inventory:<card>, key:one / key:two,
// headroom, gauge, alert, title, credits, channel. Anything not
// registered (yet) answers null, and the band then draws no leader.
//
// Points are game pixels (the 1920x1080 space every scene draws in), not page pixels. Pure module
// state: no Phaser, no DOM.

export interface LocatedPoint {
  readonly x: number;
  readonly y: number;
}

/** Says where a registered thing is now, or null while it is not on screen. */
export type Locator = () => LocatedPoint | null;

const locators = new Map<string, Locator>();

/**
 * Register where `name` is. A later registration under the same name replaces the earlier one.
 * Returns the function that takes it out again (call it on the view's shutdown); it only removes
 * this registration, never a newer one under the same name.
 */
export function register(name: string, where: Locator): () => void {
  locators.set(name, where);
  return () => {
    if (locators.get(name) === where) locators.delete(name);
  };
}

/** Where `name` is now, or null: not registered, off screen, or its locator failed. */
export function locate(name: string): LocatedPoint | null {
  const where = locators.get(name);
  if (!where) return null;
  try {
    const p = where();
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    // A view mid-shutdown must never take the band down with it.
    return null;
  }
}

/** The names registered now, sorted (for the test hook). */
export function registeredNames(): string[] {
  return [...locators.keys()].sort();
}
