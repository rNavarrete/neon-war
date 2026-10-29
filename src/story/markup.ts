// The debrief's terms mark each named term with **bold**. Split such a line into runs so the scene
// can draw bold and plain Phaser text side by side.

export interface TextRun {
  readonly text: string;
  readonly bold: boolean;
}

/** Split `**bold** plain` markup into runs, in order, dropping empty ones. */
export function parseBold(text: string): TextRun[] {
  return text
    .split('**')
    .map((t, i) => ({ text: t, bold: i % 2 === 1 }))
    .filter((r) => r.text.length > 0);
}

/** Split runs into words for wrapping; each word keeps its run's weight and its trailing spaces. */
export function runWords(runs: readonly TextRun[]): TextRun[] {
  return runs.flatMap((r) => (r.text.match(/\S+\s*|\s+/g) ?? []).map((w) => ({ text: w, bold: r.bold })));
}
