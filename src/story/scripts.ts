// The story layer's scenes as data: which lines play, in what order, over which backdrop. A step
// with `at` plays on a timer (seconds from the scene's start); a step without it waits for a click
// after the step before. Text never lives here, only line IDs from src/strings.ts.

import { LINES, type LineId } from '../strings';

/** Something a step does besides showing its line. */
export type Cue =
  /** The goggles come down: goggles-on sound and the lens fades in (cold open). */
  | 'goggles'
  /** The crew's cable drops in (rescue). */
  | 'cable'
  /** Mika hands over Regroup (rescue). */
  | 'regroup';

/** A condition a step needs to be played. */
export type StepCondition = 'laundryCut';

export interface ScriptStep {
  readonly lineId: LineId;
  /** Seconds from the scene's start; absent means wait for a click after the step before. */
  readonly at?: number;
  /** Portrait path under art/chars/ to use instead of the speaker's default face. */
  readonly face?: string;
  readonly cue?: Cue;
  /** Played only when this flag is set. */
  readonly onlyIf?: StepCondition;
}

/** How the scene is drawn: a painted visual novel, TRIAGE's stream replay, or a crew rewind. */
export type SceneLook = 'vn' | 'vhs' | 'crew';

export type ScriptId = 'C0' | 'C5' | 'rewind-replay' | 'rewind-rei-surge' | 'rewind-rei-midnight';

export interface SceneScript {
  readonly id: ScriptId;
  /** Background file under public/, or null to draw over the frozen board. */
  readonly backdrop: string | null;
  /** Lux's room (room faces, rain) or her goggles (board faces). */
  readonly where: 'room' | 'board';
  readonly look: SceneLook;
  /** Timed scenes end on their own this many seconds in; click scenes end after their last line. */
  readonly endAt?: number;
  /** Show Akemi's photo (the cold open). */
  readonly photo?: boolean;
  readonly steps: readonly ScriptStep[];
}

/** C0, the cold open: 15 s, no input, lines on the "When" timers from docs/SCRIPT.md. */
const COLD_OPEN: SceneScript = {
  id: 'C0',
  backdrop: 'art/bg/bedroom-dark.webp',
  where: 'room',
  look: 'vn',
  endAt: 15,
  photo: true,
  steps: [
    { lineId: 'C0.tv.01', at: 1 },
    { lineId: 'C0.tv.02', at: 4 },
    { lineId: 'C0.grandma.01', at: 6 },
    { lineId: 'C0.lux.01', at: 8, face: 'lux/faces-room/grieving' },
    { lineId: 'C0.chat.01', at: 9 },
    { lineId: 'C0.chat.02', at: 10 },
    { lineId: 'C0.chat.03', at: 11 },
    { lineId: 'C0.chat.04', at: 12 },
    { lineId: 'C0.triage.01', at: 13 },
    { lineId: 'C0.lux.02', at: 14, face: 'lux/faces-room/composing', cue: 'goggles' },
  ],
};

/** C5, the rescue: the crew break into her goggles over the full-immersive backdrop. */
const RESCUE: SceneScript = {
  id: 'C5',
  backdrop: 'art/bg/immersive.webp',
  where: 'board',
  look: 'vn',
  steps: [
    { lineId: 'C5.triage.01' },
    { lineId: 'C5.rei.01' },
    { lineId: 'C5.lux.01', face: 'lux/faces-board/shocked' },
    { lineId: 'C5.rei.02' },
    { lineId: 'C5.mika.01' },
    { lineId: 'C5.mika.02', face: 'mika/faces/explain' },
    { lineId: 'C5.rei.03', cue: 'cable' },
    { lineId: 'C5.rei.cut', onlyIf: 'laundryCut', face: 'rei/faces/impressed' },
    { lineId: 'C5.lux.cut', onlyIf: 'laundryCut', face: 'lux/faces-board/deadpan' },
    { lineId: 'C5.ozzie.01', face: 'ozzie/faces/sums' },
    { lineId: 'C5.ozzie.02' },
    { lineId: 'C5.mika.03', face: 'mika/faces/focused' },
    { lineId: 'C5.ozzie.03', face: 'ozzie/faces/sceptical' },
    { lineId: 'C5.rei.04', face: 'rei/faces/stern' },
    { lineId: 'C5.mika.04', face: 'mika/faces/reassure', cue: 'regroup' },
  ],
};

/** TRIAGE's stream replay, for a failure in C1 to C3. */
const REWIND_REPLAY: SceneScript = {
  id: 'rewind-replay',
  backdrop: null,
  where: 'board',
  look: 'vhs',
  steps: [{ lineId: 'C3.triage.rewind' }, { lineId: 'C3.lux.rewind', face: 'lux/faces-board/deadpan' }],
};

/** Rei's rewind when trust hits zero in the surge. */
const REWIND_REI_SURGE: SceneScript = {
  id: 'rewind-rei-surge',
  backdrop: 'art/bg/immersive.webp',
  where: 'board',
  look: 'crew',
  steps: [{ lineId: 'C5.rei.rewind', face: 'rei/faces/stern' }],
};

/** Rei's rewind when the block goes dark at midnight. */
const REWIND_REI_MIDNIGHT: SceneScript = {
  id: 'rewind-rei-midnight',
  backdrop: 'art/bg/bedroom-dark.webp',
  where: 'board',
  look: 'crew',
  steps: [{ lineId: 'C6.rei.fail', face: 'rei/faces/stern' }],
};

export const SCRIPTS: Readonly<Record<ScriptId, SceneScript>> = {
  C0: COLD_OPEN,
  C5: RESCUE,
  'rewind-replay': REWIND_REPLAY,
  'rewind-rei-surge': REWIND_REI_SURGE,
  'rewind-rei-midnight': REWIND_REI_MIDNIGHT,
};

/** The steps a scene plays given the run's flags (the laundry cut adds Rei's aside in C5). */
export function stepsFor(script: SceneScript, flags: { readonly laundryCut?: boolean }): ScriptStep[] {
  return script.steps.filter((s) => !s.onlyIf || flags[s.onlyIf] === true);
}

/** True for lines shown in the corner chat instead of the text box. */
export function isChat(id: LineId): boolean {
  return LINES[id].kind === 'chat';
}

/** The chat line as shown in the corner: "kenji: lux pls" from speaker "block: kenji". */
export function chatText(id: LineId): string {
  const who = LINES[id].speaker.replace(/^(block|stream):\s*/, '');
  return `${who}: ${LINES[id].text}`;
}

/** Characters of a line shown after `seconds` of typing at `cps` characters per second. */
export function typedChars(seconds: number, cps: number, length: number): number {
  return Math.max(0, Math.min(length, Math.floor(seconds * cps)));
}

/** Every portrait path a script overrides, for preloading. */
export function scriptFaces(): string[] {
  const faces = Object.values(SCRIPTS).flatMap((s) => s.steps.flatMap((st) => (st.face ? [st.face] : [])));
  return [...new Set(faces)];
}
