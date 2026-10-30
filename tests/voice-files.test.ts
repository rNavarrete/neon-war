import voiceDoc from '../docs/VOICE.md?raw';
import { bundledVoiceManifest, idsInGroups, residentGroups } from '../src/game/mixer';
import { speakerName } from '../src/game/portraits';
import { isVoiced, voicePath, voicedLines } from '../src/game/voice';
import { LINES, type LineId } from '../src/strings';

// The recorded voices on disk (docs/VOICE.md): public/audio/voice/manifest.json lists only spoken
// lines, every spoken line has a clip in each language, the clips are real MP3s of a sane size, and
// the stale list in docs/VOICE.md is exactly the lines whose words changed since they were recorded
// (tests/fixtures/voice-recorded-lines.json is the owner's lines.json the takes were made from).

/** The bits of node:fs the test reads with; the repo has no @types/node, so typed here. */
interface Fs {
  existsSync(path: string): boolean;
  readFileSync(path: string, enc?: 'utf8'): Uint8Array | string;
  readdirSync(path: string): string[];
  statSync(path: string): { size: number };
}
const fs = (
  globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }
).process.getBuiltinModule('node:fs') as Fs;

const PUBLIC = new URL('../public/', import.meta.url).pathname;
const LANGS = ['ja', 'en'] as const;

const manifest = JSON.parse(
  fs.readFileSync(`${PUBLIC}audio/voice/manifest.json`, 'utf8') as string,
) as Record<string, string[]>;

/**
 * Voiced lines with no clip in a language, written out so a gap is a decision, not an accident:
 * the lines docs/VOICE.md lists under "Not recorded yet", missing in both languages (none since the
 * coach's nudges were recorded, 30 Oct 2026).
 */
const knownGaps = (): Record<(typeof LANGS)[number], ReadonlySet<string>> => {
  const notRecorded = new Set(idsUnder('Not recorded yet'));
  return { ja: notRecorded, en: notRecorded };
};

/** One clip may not outweigh this (the longest take today is about 115 kB). */
const MAX_BYTES = 1024 * 1024;

type Recorded = [id: string, character: string, en: string, ja: string];
const RECORDED = JSON.parse(
  fs.readFileSync(
    new URL('./fixtures/voice-recorded-lines.json', import.meta.url).pathname,
    'utf8',
  ) as string,
) as Recorded[];

/** A line's words with the performance tags ([excited]), stage directions ((beat)) and quotes taken out. */
function words(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/"/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The character a script speaker is recorded as: 'TRIAGE (eager)' -> 'triage', 'TV downstairs' -> 'tv'. */
function characterOf(speaker: string): string {
  return speakerName(speaker).split(/\s+/)[0].toLowerCase();
}

/** The ids listed under a '## <heading>' of docs/VOICE.md, as `C1.triage.02` in backticks. */
function idsUnder(heading: string): string[] {
  const start = voiceDoc.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`docs/VOICE.md has no "## ${heading}" section`);
  const rest = voiceDoc.slice(start + 3 + heading.length);
  const end = rest.indexOf('\n## ');
  const body = end < 0 ? rest : rest.slice(0, end);
  return [...body.matchAll(/^- `(C\d\.[^`]+)`/gm)].map((m) => m[1]);
}

describe('voice manifest', () => {
  it('has the shape the mixer reads: ja and en lists of unique ids', () => {
    expect(Object.keys(manifest).sort()).toEqual(['en', 'ja']);
    for (const lang of LANGS) {
      expect(Array.isArray(manifest[lang])).toBe(true);
      expect(new Set(manifest[lang]).size).toBe(manifest[lang].length);
    }
  });

  it('is the manifest the build bundles', () => {
    expect(bundledVoiceManifest()).toEqual(manifest);
  });

  it('lists only spoken lines (a scene line or a bark, never a stage direction)', () => {
    const voiced = new Set<string>(voicedLines());
    for (const lang of LANGS)
      for (const id of manifest[lang]) expect(voiced.has(id) && isVoiced(id), id).toBe(true);
  });

  it('lists every spoken line in each language, apart from the known gaps', () => {
    // Two more since the idle-server nudges (30 Oct 2026); 133 since the cold open's check-in beat
    // (Rolando, 30 Oct 2026) added C0.lux.03 and C0.triage.02.
    expect(voicedLines()).toHaveLength(133);
    const KNOWN_GAPS = knownGaps();
    // 20 coach nudges until they were recorded (Rolando, 30 Oct 2026): none left. Then three: the cold
    // open's rewritten check-in beat (Rolando, 30 Oct 2026), waiting on a working voice key.
    expect(KNOWN_GAPS.ja.size).toBe(3);
    for (const lang of LANGS) {
      const listed = new Set(manifest[lang]);
      const gaps = voicedLines().filter((id) => !listed.has(id));
      expect(gaps, lang).toEqual([...KNOWN_GAPS[lang]]);
    }
  });

  it('lists exactly the files on disk', () => {
    for (const lang of LANGS) {
      const files = fs
        .readdirSync(`${PUBLIC}audio/voice/${lang}`)
        .filter((f) => f.endsWith('.mp3'))
        .map((f) => f.slice(0, -4))
        .sort();
      expect(files, lang).toEqual([...manifest[lang]].sort());
    }
  });

  it('keeps only a few groups loaded at a time, never the whole set', () => {
    const all = manifest.ja.length;
    const atStart = idsInGroups(manifest, 'ja', residentGroups(0)).length;
    expect(atStart).toBeGreaterThan(0);
    expect(atStart).toBeLessThan(all / 2);
  });
});

describe('voice files', () => {
  it('are non-empty MP3s under 1 MB each', () => {
    for (const lang of LANGS) {
      for (const id of manifest[lang]) {
        const file = `${PUBLIC}${voicePath(id, lang)}`;
        expect(fs.existsSync(file), file).toBe(true);
        const size = fs.statSync(file).size;
        expect(size, file).toBeGreaterThan(1000);
        expect(size, file).toBeLessThan(MAX_BYTES);
        const b = fs.readFileSync(file) as Uint8Array;
        // An ID3 tag, or straight into an MPEG audio frame (11 sync bits).
        const id3 = b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
        const frame = b[0] === 0xff && (b[1] & 0xe0) === 0xe0;
        expect(id3 || frame, file).toBe(true);
      }
    }
  });
});

describe('recorded wording', () => {
  const byId = new Map(RECORDED.map((r) => [r[0], r]));

  /** Spoken lines that have been recorded: every one but those listed as not recorded yet. */
  const recordedLines = (): LineId[] => {
    const notRecorded = new Set(idsUnder('Not recorded yet'));
    return voicedLines().filter((id) => !notRecorded.has(id));
  };

  it('covers every recorded spoken line once, and nothing else', () => {
    expect(RECORDED.map((r) => r[0]).sort()).toEqual([...recordedLines()].sort());
    expect(byId.size).toBe(RECORDED.length);
  });

  it('was recorded by the speaker the script names now (a changed speaker would mean a wrong voice)', () => {
    for (const id of recordedLines()) expect(byId.get(id)![1], id).toBe(characterOf(LINES[id].speaker));
  });

  it('docs/VOICE.md lists exactly the lines whose words changed since recording', () => {
    const changed = recordedLines().filter((id: LineId) => words(byId.get(id)![2]) !== words(LINES[id].text));
    expect(idsUnder('Stale takes').sort()).toEqual(changed.sort());
  });

  it('the words of a take are compared without tags, stage directions or quotes', () => {
    expect(words('[excited] Ooh, a dial!')).toBe('Ooh, a dial!');
    expect(words('You cut the laundry loose." (beat) "...Who taught you that?')).toBe(
      'You cut the laundry loose. ...Who taught you that?',
    );
  });
});
