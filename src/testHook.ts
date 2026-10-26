// Read-only window into the running game for browser tests. Only installed when the page
// URL has a `test` query parameter, so tests assert on game state instead of pixels.

export interface TestSnapshot {
  /** Key of the active Phaser scene, or null before the first scene starts. */
  scene: string | null;
  /** True once every asset of the active scene has loaded and been placed. */
  ready: boolean;
  /** Width and height of the game canvas in CSS pixels. */
  canvas: { width: number; height: number } | null;
}

declare global {
  interface Window {
    __neonTest?: { readonly state: TestSnapshot };
  }
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

export function installTestHook(read: () => TestSnapshot): void {
  if (!testHookEnabled(window.location.search)) return;
  Object.defineProperty(window, '__neonTest', {
    value: Object.freeze({
      get state(): TestSnapshot {
        return structuredClone(read());
      },
    }),
    writable: false,
    configurable: false,
  });
}
