// Which portrait shows for a line's speaker, from the Speaker column in docs/SCRIPT.md. Barks and
// scenes share it. Speakers without a portrait (the TV, Grandma through the door) return null.

/** Texture key and file (under public/) for a portrait. */
export interface Portrait {
  readonly key: string;
  readonly file: string;
}

const TRIAGE_MOODS: Record<string, string> = {
  eager: 'eager',
  thinking: 'thinking',
  'wrong-and-proud': 'proud',
  panicking: 'panic',
  sheepish: 'sheepish',
  happy: 'happy',
};

const portrait = (path: string): Portrait => ({ key: `portrait:${path}`, file: `art/chars/${path}.webp` });

/** Default faces for the crew and Lux, by where the line is shown. */
const FACES: Record<string, { board: string; room: string }> = {
  Lux: { board: 'lux/faces-board/determined', room: 'lux/faces-room/composing' },
  Rei: { board: 'rei/faces/smirk', room: 'rei/faces/grading' },
  Mika: { board: 'mika/faces/calm', room: 'mika/faces/reassure' },
  Ozzie: { board: 'ozzie/faces/smug', room: 'ozzie/faces/half-smile' },
};

/** The plain name of a speaker, for the nameplate: "TRIAGE (eager)" -> "TRIAGE". */
export function speakerName(speaker: string): string {
  return speaker.replace(/\s*\(.*\)\s*$/, '');
}

/**
 * The portrait for a speaker as written in the script, e.g. "TRIAGE (panicking)" or "Rei".
 * `where` picks Lux's goggles-down board faces or her room faces.
 */
export function portraitFor(speaker: string, where: 'board' | 'room' = 'board'): Portrait | null {
  const name = speakerName(speaker);
  if (name === 'TRIAGE') {
    const mood = /\(([^)]+)\)/.exec(speaker)?.[1] ?? 'eager';
    return portrait(`triage/${TRIAGE_MOODS[mood] ?? 'eager'}`);
  }
  const face = FACES[name];
  return face ? portrait(face[where]) : null;
}

/** Every portrait file, for preloading. */
export function allPortraits(): Portrait[] {
  const paths = [
    ...Object.values(TRIAGE_MOODS).map((m) => `triage/${m}`),
    ...Object.values(FACES).flatMap((f) => [f.board, f.room]),
  ];
  return [...new Set(paths)].map(portrait);
}
