import requestsDoc from '../docs/ART-REQUESTS.md?raw';
import script from '../docs/SCRIPT.md?raw';
import {
  ART_REQUESTS,
  type ArtRequest,
  BATCHES_NOW,
  PICKED_ART,
  type Size,
  isPicked,
  pickedArt,
  requestFile,
} from '../src/game/artManifest';
import { allPortraits } from '../src/game/portraits';
import { LOCKED_KINDS } from '../src/scenes/board/tray';
import { CARD_IDS, ZONE_IDS } from '../src/scenes/live/layout';
import { scriptFaces } from '../src/story/scripts';

// The art manifest (art3d-1) against the files on disk: every file under public/art that src/
// loads is in src/game/artManifest.ts with its real pixel size; every requested piece has a code
// fallback; docs/ART-REQUESTS.md lists every request in batch order with its fallback.

/** The bits of node:fs the test reads with; the repo has no @types/node, so typed here. */
interface Fs {
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
  readdirSync(path: string, opts: { recursive: true }): string[];
}
const fs = (
  globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }
).process.getBuiltinModule('node:fs') as Fs;

const PUBLIC = new URL('../public/', import.meta.url).pathname;

/** A WebP's pixel size from its RIFF header (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(b: Uint8Array): Size {
  const ascii = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
  const u24 = (at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
  const u16 = (at: number) => b[at] | (b[at + 1] << 8);
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') throw new Error('not a WebP');
  const chunk = ascii(12, 4);
  if (chunk === 'VP8X') return { w: 1 + u24(24), h: 1 + u24(27) };
  if (chunk === 'VP8L') {
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') return { w: u16(26) & 0x3fff, h: u16(28) & 0x3fff };
  throw new Error(`unknown WebP chunk ${chunk}`);
}

const sizeOf = (file: string): Size => webpSize(fs.readFileSync(PUBLIC + file));

// --- What src/ references ------------------------------------------------------------------------

/** Every source file's text, except the manifest and plates, which name every key by design. */
const SOURCES = Object.entries(
  import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
).filter(([path]) => !path.endsWith('/game/artManifest.ts') && !path.endsWith('/scenes/plates.ts'));

/** A string array declared as `const NAME = [...]` in a source file (HudScene keeps its art lists so). */
function constArray(source: string, name: string): string[] {
  const m = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!m) throw new Error(`no const ${name} = [...]`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const hudSource = SOURCES.find(([p]) => p.endsWith('/scenes/HudScene.ts'))![1];

/**
 * Each templated art path in src/ and the files it expands to. A new template fails the test below
 * until it is listed here, so a file loaded through it can't slip past the manifest.
 */
const TEMPLATES: Record<string, () => string[]> = {
  'art/hud/${k}.webp': () => constArray(hudSource, 'HUD_ART').map((k) => `art/hud/${k}.webp`),
  'art/hud/icons/${k}.webp': () => constArray(hudSource, 'ICONS').map((k) => `art/hud/icons/${k}.webp`),
  'art/chars/avatars/${k}.webp': () =>
    constArray(hudSource, 'AVATARS').map((k) => `art/chars/avatars/${k}.webp`),
  'art/chars/${f}.webp': () => scriptFaces().map((f) => `art/chars/${f}.webp`),
  'art/chars/${path}.webp': () => allPortraits().map((p) => p.file),
  'art/parts/${kind}/scrap.webp': () => LOCKED_KINDS.map((k) => `art/parts/${k}/scrap.webp`),
};

function referencedFiles(): { files: Set<string>; unknownTemplates: string[] } {
  const files = new Set<string>();
  const unknownTemplates: string[] = [];
  for (const [, text] of SOURCES) {
    for (const m of text.matchAll(/['"`](art\/[^'"`\s]*\.webp)['"`]/g)) {
      const path = m[1];
      if (!path.includes('${')) files.add(path);
      else if (TEMPLATES[path]) for (const f of TEMPLATES[path]()) files.add(f);
      else unknownTemplates.push(path);
    }
  }
  return { files, unknownTemplates };
}

// --- The manifest against the disk ---------------------------------------------------------------

describe('the art manifest: picked files', () => {
  const { files, unknownTemplates } = referencedFiles();

  it('knows every templated art path in src/', () => {
    expect(unknownTemplates).toEqual([]);
  });

  it('finds the files src/ loads (a sanity floor, so a broken scan cannot pass empty)', () => {
    expect(files.size).toBeGreaterThanOrEqual(70);
    for (const f of ['art/board/server.webp', 'art/hud/chat-panel.webp', 'art/parts/worker/scrap.webp'])
      expect(files.has(f), f).toBe(true);
  });

  it('lists every public/art file referenced by src/', () => {
    const missing = [...files].filter((f) => !pickedArt(f));
    expect(missing).toEqual([]);
  });

  it('gives every listed file its real pixel size, measured from the file on disk', () => {
    for (const p of PICKED_ART) {
      expect(fs.existsSync(PUBLIC + p.file), p.file).toBe(true);
      expect(sizeOf(p.file), p.file).toEqual(p.cut);
    }
  });

  it('lists each file once, under public/art, with a zone from the layout or a named place', () => {
    const places = new Set<string>([
      ...ZONE_IDS,
      ...CARD_IDS,
      'screen',
      'story',
      'titleScreen',
      'debrief',
      'shell',
    ]);
    expect(new Set(PICKED_ART.map((p) => p.file)).size).toBe(PICKED_ART.length);
    for (const p of PICKED_ART) {
      expect(p.file, p.file).toMatch(/^art\/.+\.webp$/);
      expect(places.has(p.zone), `${p.file} zone ${p.zone}`).toBe(true);
      expect(p.display.w, p.file).toBeGreaterThan(0);
      expect(p.display.h, p.file).toBeGreaterThan(0);
    }
  });

  it('draws no plain image above its cut size, except backdrops drawn to cover and noted upscales', () => {
    for (const p of PICKED_ART) {
      if (p.nineSlice) {
        expect(p.nineSlice.k, p.file).toBeLessThanOrEqual(1);
        continue;
      }
      const over = p.display.w > p.cut.w || p.display.h > p.cut.h;
      if (!over) continue;
      if (p.cover) expect(p.display.w / p.cut.w, p.file).toBeLessThanOrEqual(1.25);
      else expect(p.upscaled, `${p.file} is drawn above its cut size without a noted reason`).toBeTruthy();
    }
  });
});

// --- The requests --------------------------------------------------------------------------------

/** The keys lead.json's 'art requests' contract and docs/ART-REQUESTS.md promise. */
const PROMISED = [
  'board/table-plate',
  'board/server-dark',
  'board/server-overclocked-dark',
  'board/channel-plate',
  'hud/city-grid',
  'hud/comms-plate',
  'chars/comms/triage',
  'chars/comms/rei',
  'chars/comms/mika',
  'chars/comms/ozzie',
  'hud/live/avatar-luxnet',
  'hud/icons/door',
  'hud/icons/tv',
  'hud/chat-plate-wide',
  'chars/avatars/stream-1',
  'chars/avatars/stream-2',
  'chars/avatars/stream-3',
  'chars/avatars/stream-4',
  'hud/icons/system',
  'chars/lux/cam/lean-in',
  'chars/lux/cam/relieved',
  'hud/cam-backdrop',
  'hud/live/panel-frame',
  'hud/live/label-tab',
  'hud/live/tag-chip',
  'hud/live/rec-badge',
  'hud/live/live-pill',
  'hud/live/corner-marks',
  'hud/live/divider',
  'hud/live/keycap-idle',
  'hud/live/keycap-ready',
  'hud/live/keycap-pressed',
];

describe('the art manifest: requests', () => {
  it('carries every promised request', () => {
    const keys = new Set(ART_REQUESTS.map((r) => r.key));
    for (const k of PROMISED) expect(keys.has(k), k).toBe(true);
  });

  it('keys each request once, never on a picked file, and lists them in batch order', () => {
    const keys = ART_REQUESTS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) {
      expect(k, k).toMatch(/^[a-z0-9-]+(\/[a-z0-9-]+)+$/);
      expect(pickedArt(requestFile(k)), k).toBeUndefined();
    }
    const batches = ART_REQUESTS.map((r) => r.batch);
    expect(batches).toEqual([...batches].sort((a, b) => a - b));
    expect(BATCHES_NOW).toEqual([1, 2, 3, 4]);
  });

  it('gives every request a code fallback: a picked file to tint, or a plate to bake', () => {
    for (const r of ART_REQUESTS) {
      const f = r.fallback;
      expect(['reuse', 'bake'], r.key).toContain(f.kind);
      expect(f.note.length, r.key).toBeGreaterThan(0);
      expect(f.alpha, r.key).toBeGreaterThan(0);
      expect(f.alpha, r.key).toBeLessThanOrEqual(1);
      if (f.kind === 'reuse') {
        expect(pickedArt(f.file), `${r.key} reuses ${f.file}`).toBeDefined();
        expect(fs.existsSync(PUBLIC + f.file), f.file).toBe(true);
        expect(f.tint, r.key).toBeGreaterThanOrEqual(0);
        expect(f.tint, r.key).toBeLessThanOrEqual(0xffffff);
      } else {
        expect(f.color, r.key).toBeGreaterThanOrEqual(0);
        expect(f.color, r.key).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it('asks for a cut no smaller than the display size, unless it is nine-sliced', () => {
    for (const r of ART_REQUESTS) {
      expect(r.display.w * r.display.h, r.key).toBeGreaterThan(0);
      if (r.nineSlice) expect(r.nineSlice.k, r.key).toBeLessThanOrEqual(1);
      else {
        expect(r.target.w, r.key).toBeGreaterThanOrEqual(r.display.w);
        expect(r.target.h, r.key).toBeGreaterThanOrEqual(r.display.h);
      }
    }
  });

  it('marks a request picked exactly when its file is on disk, with its real size', () => {
    for (const r of ART_REQUESTS) {
      const file = requestFile(r.key);
      const onDisk = fs.existsSync(PUBLIC + file);
      expect(isPicked(r), `${r.key}: on disk ${onDisk}, cut ${JSON.stringify(r.cut)}`).toBe(onDisk);
      if (onDisk) expect(sizeOf(file), r.key).toEqual(r.cut);
    }
  });

  it('never names a debrief term in a key, since a stand-in prints its key on screen', () => {
    const terms = script
      .split('\n')
      .filter((line) => line.startsWith('| C8.terms.'))
      .flatMap((line) => [...line.matchAll(/\*\*([^*]+)\*\*/g)].map((t) => t[1].toLowerCase()));
    expect(terms.length).toBeGreaterThanOrEqual(10);
    for (const r of ART_REQUESTS) {
      const label = r.key.replace(/[/-]/g, ' ').toLowerCase();
      for (const t of terms) expect(label.includes(t), `${r.key} names "${t}"`).toBe(false);
    }
  });
});

// --- docs/ART-REQUESTS.md --------------------------------------------------------------------------

/** The table rows of the request doc, by key: the first cell is the key in backticks. */
function docRows(): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of requestsDoc.split('\n')) {
    const m = /^\| `([^`]+)` \|(.*)\|$/.exec(line);
    if (m)
      rows.set(
        m[1],
        m[2].split('|').map((c) => c.trim()),
      );
  }
  return rows;
}

const sizeText = (s: Size): string => `${s.w}x${s.h}`;

describe('docs/ART-REQUESTS.md', () => {
  const rows = docRows();

  it('lists every request, and only the requests', () => {
    expect([...rows.keys()].sort()).toEqual(ART_REQUESTS.map((r) => r.key).sort());
  });

  it('lists them in batch order, batches 1 to 4 now and 5 deferred', () => {
    const order = [...rows.keys()].map((k) => ART_REQUESTS.find((r) => r.key === k)!.batch);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const b of [1, 2, 3, 4]) expect(requestsDoc).toContain(`## Batch ${b}`);
    expect(requestsDoc).toMatch(/## Batch 5 \(deferred\)/);
  });

  it('gives each row its display and cut sizes, states, prompt and fallback from the manifest', () => {
    for (const r of ART_REQUESTS) {
      const row = rows.get(r.key)!.join(' | ');
      expect(row, r.key).toContain(sizeText(r.display));
      expect(row, r.key).toContain(sizeText(r.target));
      expect(row, r.key).toContain(r.states);
      expect(row, r.key).toContain(r.prompt);
      expect(row, r.key).toContain(fallbackText(r));
    }
  });
});

/** How the doc names a request's fallback. */
function fallbackText(r: ArtRequest): string {
  const f = r.fallback;
  return f.kind === 'reuse' ? `\`${f.file.replace(/^art\//, '')}\`` : `baked: ${f.note}`;
}
