// Read-only window into the running game for browser tests. Only installed when the page
// URL has a `test` query parameter, so tests assert on game state instead of pixels.
//
// Each part of the game adds its own section without touching this file: declare the section's
// type by augmenting TestSections, then call provideTestState with a getter.
//
//   declare module '../testHook' { interface TestSections { board: BoardTestState } }
//   provideTestState('board', () => ({ ... }));

export interface TestSnapshot {
  /** Key of the active Phaser scene, or null before the first scene starts. */
  scene: string | null;
  /** True once every asset of the active scene has loaded and been placed. */
  ready: boolean;
  /** Width and height of the game canvas in CSS pixels. */
  canvas: { width: number; height: number } | null;
}

/** Extra sections of the snapshot, one per part of the game; each file augments this interface. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TestSections {}

export type TestState = TestSnapshot & Partial<TestSections>;

declare global {
  interface Window {
    __neonTest?: { readonly state: TestState };
  }
}

const sections = new Map<string, () => unknown>();

/** Add (or replace) one section of the test snapshot. Cheap to call when the hook is off. */
export function provideTestState<K extends keyof TestSections>(key: K, read: () => TestSections[K]): void {
  sections.set(key, read);
}

export function testHookEnabled(search: string): boolean {
  return new URLSearchParams(search).has('test');
}

/** Simulation speed multiplier: 1 normally; tests may ask for more with `?test&speed=N` (1 to 20). */
export function simSpeed(search: string): number {
  const params = new URLSearchParams(search);
  if (!params.has('test')) return 1;
  const n = Number(params.get('speed'));
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : 1;
}

/** Whether a browser test asked for scripted best play with `?test&autopilot`. */
export function autopilotOn(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('test') && params.has('autopilot');
}

/**
 * Whether a browser test asked for the title's "press any key" gate with `?test&gate`. Under the test
 * hook the gate shows only then, so the other tests reach the menu straight away.
 */
export function gateForced(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('test') && params.has('gate');
}

/** Scene a browser test asks to start in with `?test&scene=<key>`, or null. */
export function startScene(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.has('test') ? params.get('scene') : null;
}

export function installTestHook(read: () => TestSnapshot): void {
  if (!testHookEnabled(window.location.search)) return;
  Object.defineProperty(window, '__neonTest', {
    value: Object.freeze({
      get state(): TestState {
        const snap: Record<string, unknown> = { ...read() };
        for (const [key, get] of sections) snap[key] = get();
        return structuredClone(snap) as unknown as TestState;
      },
    }),
    writable: false,
    configurable: false,
  });
}
