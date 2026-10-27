// The story layer's section of the test hook (`window.__neonTest.state.story`), plus the sound
// helper the story scenes use so tests can see which effects they asked for.

import { bus } from '../game/bus';
import { run } from '../game/run';
import type { LineId } from '../strings';
import { provideTestState } from '../testHook';
import type { DebriefResults } from './debrief';
import type { RewindKind } from './rewind';
import { seenScenes } from './seen';

export type DebriefStep = 'grades' | 'terms' | 'interview' | 'book' | 'title';

/** A point on the page in CSS pixels, for tests to click. */
export interface PagePoint {
  x: number;
  y: number;
}

export interface StoryTestState {
  /** A story scene or the debrief is on screen. */
  active: boolean;
  /** Script playing ('C0', 'C5', 'rewind-replay'...), 'C8' in the debrief, or null. */
  scriptId: string | null;
  lineId: LineId | null;
  /** The text box has finished typing the current line. */
  typingDone: boolean;
  /** Characters of the current line shown so far. */
  typed: number;
  nameplate: string | null;
  /** Texture key of the speaking portrait, or null when the speaker has none. */
  portrait: string | null;
  /** Speakers on stage and those dimmed (on stage, not speaking). */
  onStage: string[];
  dimmed: string[];
  /** Corner chat lines shown, oldest first. */
  chat: string[];
  /** Background file, or null when the scene is drawn over the frozen board. */
  backdrop: string | null;
  look: string | null;
  /** Where to click to finish the line or advance. */
  click: PagePoint | null;
  skip: { visible: boolean } & PagePoint;
  /** Clicks the scene has handled (so a test can wait for one to land before reading the line). */
  clicks: number;
  /** Effects the story asked for, in order. */
  sfx: string[];
  /** The last rewind: its kind and the clock time it went back to. */
  rewind: { kind: RewindKind; target: number } | null;
  /** Scripts that have finished, in order (this page load). */
  finished: string[];
  seen: string[];
  debrief: {
    step: DebriefStep;
    results: DebriefResults;
    /** Each term group with its bold runs, as drawn. */
    terms: { group: string; bold: string[] }[];
    card: string[];
    page: string | null;
    title: string | null;
  } | null;
  fireworks: { bursts: number; flashes: number };
  runNow: number;
  runHeld: boolean;
}

/**
 * When the last story scene ended (performance.now() ms; -Infinity before any has). The HUD uses it
 * to tell the second half of a double-click on the cold open's last line from a click on the job card.
 */
export const storyEnd = { at: Number.NEGATIVE_INFINITY };

export const storyState: Omit<StoryTestState, 'runNow' | 'runHeld' | 'seen'> = {
  active: false,
  scriptId: null,
  lineId: null,
  typingDone: false,
  typed: 0,
  nameplate: null,
  portrait: null,
  onStage: [],
  dimmed: [],
  chat: [],
  backdrop: null,
  look: null,
  click: null,
  skip: { visible: false, x: 0, y: 0 },
  clicks: 0,
  sfx: [],
  rewind: null,
  finished: [],
  debrief: null,
  fireworks: { bursts: 0, flashes: 0 },
};

declare module '../testHook' {
  interface TestSections {
    story: StoryTestState;
  }
}

/** The fields the visual-novel view reports live, read only when a test asks. */
export type ViewSnapshot = Pick<
  StoryTestState,
  'lineId' | 'typingDone' | 'typed' | 'nameplate' | 'portrait' | 'onStage' | 'dimmed' | 'click' | 'skip'
>;

let liveView: { snapshot(): ViewSnapshot } | null = null;

/** The view on screen now (or null), whose snapshot fills the line fields of the section. */
export function setLiveView(view: { snapshot(): ViewSnapshot } | null): void {
  liveView = view;
}

provideTestState('story', () => ({
  ...storyState,
  ...(liveView?.snapshot() ?? {}),
  seen: seenScenes(),
  runNow: run().now,
  runHeld: run().paused,
}));

/** Play a sound effect (and note it for tests). `loop` asks the sound layer to loop it until stopped. */
export function playSfx(key: string, loop = false): void {
  storyState.sfx.push(key);
  bus.emit('sfx', loop ? { key, loop } : { key });
}

export function stopSfx(key: string): void {
  bus.emit('sfxStop', { key });
}
