import script from '../docs/SCRIPT.md?raw';
import { SCRIPTS, chatText, isChat, scriptFaces, stepsFor, typedChars } from '../src/story/scripts';
import { portraitFor } from '../src/game/portraits';
import { LINES } from '../src/strings';

// The line IDs of a scene's table in docs/SCRIPT.md, in the order the rows are written.
function scriptOrder(prefix: string): string[] {
  return script
    .split('\n')
    .filter((l) => l.startsWith(`| ${prefix}`))
    .map((l) => l.split('|')[1].trim());
}

describe('story scripts', () => {
  it('only uses line IDs from the strings file', () => {
    for (const s of Object.values(SCRIPTS)) for (const st of s.steps) expect(LINES[st.lineId]).toBeDefined();
  });

  it('plays the cold open one click at a time, every C0 line once in SCRIPT.md order, ending with the goggles', () => {
    const c0 = SCRIPTS.C0;
    const ids = Object.keys(LINES).filter((id) => id.startsWith('C0.'));
    expect(c0.steps.map((s) => s.lineId).sort()).toEqual(ids.sort());
    expect(c0.steps.map((s) => s.lineId)).toEqual(scriptOrder('C0.'));
    // No step carries a timer: the scene player only ever moves on a click.
    for (const s of c0.steps) expect(Object.keys(s)).not.toContain('at');
    expect(c0.steps.find((s) => s.lineId === 'C0.lux.01')?.cue).toBe('flicker');
    // The goggles now come down as the jack-in CG (Rolando's pick, sequence C, 30 Oct 2026).
    expect(c0.steps.at(-1)?.cue).toBe('jackin');
    expect(c0.where).toBe('room');
    expect(c0.backdrop).toBe('art/bg/bedroom-dark.webp');
  });

  it('plays the rescue scene lines in script order over the immersive backdrop', () => {
    const c5 = SCRIPTS.C5;
    const sceneIds = Object.keys(LINES).filter(
      (id) =>
        id.startsWith('C5.') &&
        LINES[id as keyof typeof LINES].kind === 'scene' &&
        id !== 'C5.rei.rewind' &&
        id !== 'C5.mika.04',
    );
    // Rolando, 31 Oct 2026: the crew entrance tightened. Rei sets the test, Mika points at the
    // gauge, Ozzie pays and jokes; the server-count argument is out (its lines stay unplayed).
    const unplayed = ['C5.mika.02', 'C5.ozzie.02', 'C5.mika.03', 'C5.ozzie.03'];
    expect(c5.steps.map((s) => s.lineId)).toEqual(sceneIds.filter((id) => !unplayed.includes(id)));
    expect(c5.steps.map((s) => s.lineId)).toEqual([
      'C5.triage.01',
      'C5.rei.01',
      'C5.lux.01',
      'C5.rei.02',
      'C5.mika.01',
      'C5.rei.03',
      'C5.rei.cut',
      'C5.lux.cut',
      'C5.ozzie.01',
      'C5.rei.04',
    ]);
    expect(LINES['C5.rei.02'].text).toBe("Night Shift. We brought the parts. You're doing the wiring.");
    // Mika's Regroup hand-over is not in Session 0 (BROWNOUT.regroup.inSession).
    expect(c5.steps.map((s) => s.lineId)).not.toContain('C5.mika.04');
    expect(c5.backdrop).toBe('art/bg/immersive.webp');
    expect(c5.steps.every((s) => !Object.keys(s).includes('at'))).toBe(true);
  });

  it("adds Rei's laundry aside only when the laundry floor was cut", () => {
    const without = stepsFor(SCRIPTS.C5, {}).map((s) => s.lineId);
    const withCut = stepsFor(SCRIPTS.C5, { laundryCut: true }).map((s) => s.lineId);
    expect(without).not.toContain('C5.rei.cut');
    expect(without).not.toContain('C5.lux.cut');
    expect(withCut.indexOf('C5.lux.cut')).toBe(withCut.indexOf('C5.rei.cut') + 1);
    expect(withCut.length).toBe(without.length + 2);
  });

  it('uses the rewind lines for each rewind screen', () => {
    expect(SCRIPTS['rewind-replay'].steps.map((s) => s.lineId)).toEqual([
      'C3.triage.rewind',
      'C3.lux.rewind',
    ]);
    expect(SCRIPTS['rewind-replay'].look).toBe('vhs');
    expect(SCRIPTS['rewind-rei-surge'].steps.map((s) => s.lineId)).toEqual(['C5.rei.rewind']);
    expect(SCRIPTS['rewind-rei-midnight'].steps.map((s) => s.lineId)).toEqual(['C6.rei.fail']);
  });

  it('sends chat lines to the corner chat with the neighbour name', () => {
    expect(isChat('C0.chat.04')).toBe(true);
    expect(isChat('C0.lux.02')).toBe(false);
    expect(chatText('C0.chat.04')).toBe('kenji: lux pls');
  });

  it('types at the given characters per second, clamped to the line', () => {
    expect(typedChars(0, 50, 20)).toBe(0);
    expect(typedChars(0.1, 50, 20)).toBe(5);
    expect(typedChars(10, 50, 20)).toBe(20);
    expect(typedChars(Number.POSITIVE_INFINITY, 50, 20)).toBe(20);
  });

  it('only overrides faces with picked portrait files', () => {
    for (const f of scriptFaces())
      expect(f).toMatch(
        /^(lux\/faces-(board|room)|lux\/vn|rei\/(faces|vn)|mika\/(faces|vn)|ozzie\/(faces|vn))\//,
      );
  });

  it('stands Lux up in every story scene: her faces there are the tall sprites, goggles down on the board', () => {
    const luxFaces = Object.values(SCRIPTS).flatMap((sc) =>
      sc.steps
        .filter((st) => LINES[st.lineId].speaker === 'Lux')
        .map((st) => st.face ?? portraitFor('Lux', sc.where)?.key.replace('portrait:', '')),
    );
    expect(luxFaces.length).toBeGreaterThan(3);
    for (const f of luxFaces) expect(f).toMatch(/^lux\/vn\//);
    expect(portraitFor('Lux', 'board')?.file).toBe('art/chars/lux/vn/board-determined.webp');
    expect(SCRIPTS.C5.steps.find((st) => st.lineId === 'C5.lux.01')?.face).toBe('lux/vn/board-shocked');
  });

  it('stands the crew up too: Rei, Mika and Ozzie speak from their tall sprites, in the room and on the board', () => {
    for (const who of ['Rei', 'Mika', 'Ozzie'])
      for (const where of ['room', 'board'] as const)
        expect(portraitFor(who, where)?.file).toMatch(new RegExp(`^art/chars/${who.toLowerCase()}/vn/`));
    const crewFaces = Object.values(SCRIPTS).flatMap((sc) =>
      sc.steps.filter((st) => st.face && !st.face.startsWith('lux/')).map((st) => st.face),
    );
    expect(crewFaces.length).toBeGreaterThan(5);
    for (const f of crewFaces) expect(f).toMatch(/^(rei|mika|ozzie)\/vn\//);
  });
});
