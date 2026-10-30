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
  Lux: { board: 'lux/vn/board-determined', room: 'lux/vn/neutral' },
  Rei: { board: 'rei/vn/smirk', room: 'rei/vn/grading' },
  Mika: { board: 'mika/vn/calm', room: 'mika/vn/reassure' },
  Ozzie: { board: 'ozzie/vn/smug', room: 'ozzie/vn/half-smile' },
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

/**
 * The portrait for a file under public/art/chars/: 'art/chars/lux/poses/goggles-up.webp' ->
 * key 'portrait:lux/poses/goggles-up'. The same key the speaker portraits load under, so a file both
 * use is loaded once.
 */
export function portraitOfFile(file: string): Portrait {
  return portrait(file.replace(/^art\/chars\//, '').replace(/\.webp$/, ''));
}

/** Lux's six goggles-down board faces, the ones her cam and the bark faces draw from. */
const LUX_BOARD_FACES = ['deadpan', 'determined', 'shocked', 'smirk', 'tense', 'triumphant'] as const;

/** Every one of Lux's board faces (public/art/chars/lux/faces-board), for preloading. */
export function allBoardFaces(): Portrait[] {
  return LUX_BOARD_FACES.map((f) => portrait(`lux/faces-board/${f}`));
}

/** Every portrait file, for preloading. */
export function allPortraits(): Portrait[] {
  const paths = [
    ...Object.values(TRIAGE_MOODS).map((m) => `triage/${m}`),
    ...Object.values(FACES).flatMap((f) => [f.board, f.room]),
  ];
  return [...new Set(paths)].map(portrait);
}
