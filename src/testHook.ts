// Read-only window into the running game for browser tests. Only installed when the page
// URL has a `test` query parameter, so tests assert on game state instead of pixels.
import type { Mood } from './sim/partner';
import type { Outcome } from './sim/mission';

/** A point in page (CSS) pixels, ready for page.mouse. */
export type PagePoint = [number, number];

export interface MissionSnapshot {
  time: number;
  outcome: Outcome;
  trust: number;
  credits: number;
  dbLoad: number;
  backlog: number;
  errorRate: number;
  nodes: { id: string; kind: string; slot: string | null }[];
  links: { from: string; to: string }[];
}

export interface TestSnapshot {
  /** Key of the active Phaser scene, or null before the first scene starts. */
  scene: string | null;
  /** True once every asset of the active scene has loaded and been placed. */
  ready: boolean;
  /** Width and height of the game canvas in CSS pixels. */
  canvas: { width: number; height: number } | null;
  mission?: MissionSnapshot;
  partner?: { mood: Mood; text: string; said: string[] };
  /** Last message shown for a refused action, if any. */
  toast?: string | null;
  /** Where to point the mouse, in page pixels. */
  at?: {
    nodes: Record<string, PagePoint>;
    slots: Record<string, PagePoint>;
    tray: Record<string, PagePoint>;
    cut: Record<string, PagePoint>;
    remove: Record<string, PagePoint>;
    retry: PagePoint | null;
  };
}

declare global {
  interface Window {
    __neonTest?: { readonly state: TestSnapshot };
  }
}

export function testHookEnabled(search: string): boolean {
  return new URLSearchParams(search).has('test');
}

/** Simulation speed multiplier: 1 normally; tests may ask for more with `?test&speed=N`. */
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
