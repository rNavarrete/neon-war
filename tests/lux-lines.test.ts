// Lux on the board (Rolando, 30 Oct 2026: "give her a few more lines ... having to do with the
// gameplay, how to play"): her asides, the moments that fire them, and how the band treats them.

import { bestPlay } from '../src/game/autopilot';
import { type Frame, frame, resetFrame } from '../src/game/frame';
import { type Occurrence, detectOccurrences } from '../src/game/occurrences';
import { Run } from '../src/game/run';
import { staleAfter } from '../src/scenes/hud/comms';
import {
  BOARD_CUES,
  CUES,
  type CueHost,
  type CueView,
  LUX_CUES,
  NEW_DIRECTOR,
  cueViewOf,
  direct,
  emptyCueView,
} from '../src/scenes/hud/cues';
import { LUX_ASIDES, metaOf } from '../src/scenes/hud/lineMeta';
import { BROWNOUT } from '../src/sim/brownout';
import { LINES, type LineId } from '../src/strings';

const C = BROWNOUT.challenges;
const MIDNIGHT = BROWNOUT.clock.midnight;

function view(over: Partial<CueView> = {}): CueView {
  return { ...emptyCueView(), now: C.c1, demand: 30, cardClosed: true, ...over };
}

/** Run the board's director (scripted cues and Lux's asides) over views; what fired, in order. */
function play(views: Partial<CueView>[]): LineId[] {
  let s = NEW_DIRECTOR;
  const out: LineId[] = [];
  for (const v of views) {
    const r = direct(s, view(v), BOARD_CUES);
    s = r.state;
    out.push(...r.fired);
  }
  return out;
}

const host: CueHost = { cardClosed: true, bannerShown: true, decommissionsAfterMidnight: 0 };

describe("Lux's asides", () => {
  it('are short Lux barks, each with one cue and a band row, all listed as asides', () => {
    const ids = LUX_CUES.map((c) => c.id);
    expect(ids).toHaveLength(26);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...LUX_ASIDES].sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(LINES[id].speaker, id).toBe('Lux');
      expect(LINES[id].kind, id).toBe('bark');
      expect(LINES[id].text.length, id).toBeLessThan(70);
      expect(metaOf(id)?.tag, id).toBe('LUX');
      expect(metaOf(id)?.lesson, id).toBe(false);
      expect(
        CUES.some((c) => c.id === id),
        id,
      ).toBe(false);
    }
    expect(BOARD_CUES).toEqual([...CUES, ...LUX_CUES]);
  });

  it('go stale in the band like a hint, while her scripted lines still never do', () => {
    for (const id of LUX_ASIDES) expect(staleAfter(id), id).toBeGreaterThan(0);
    for (const id of ['C1.lux.01', 'C3.lux.01', 'C4.lux.01', 'C6.lux.hold'] as LineId[])
      expect(staleAfter(id), id).toBeNull();
  });

  it('declare every line they wait on', () => {
    for (const c of LUX_CUES) {
      const src = c.when.toString();
      for (const m of src.matchAll(/(?:after\(f, |f\[)'([\w.]+)'/g))
        expect(c.follows ?? [], `${c.id} waits on ${m[1]}`).toContain(m[1]);
    }
  });

  it('C1: a server left with no wire into it for 3 s gets "give it a wire"', () => {
    const placed = { servers: 1, unwiredServer: true };
    expect(play([placed, { ...placed, clock: 2 }])).not.toContain('C1.lux.placed');
    expect(play([placed, { ...placed, clock: 3 }])).toContain('C1.lux.placed');
    // Wired (or live) in time, she says nothing.
    expect(play([placed, { servers: 1, clock: 3 }])).not.toContain('C1.lux.placed');
  });

  it('moving a part for the first time gets "Tidy board, tidy mind."', () => {
    expect(play([{}])).not.toContain('C1.lux.moved');
    expect(play([{ moves: 1 }])).toContain('C1.lux.moved');
  });

  it('C3: "more requests coming in" as the climb is forecast, then the dial', () => {
    const t = C.c3 - 10;
    const fired = play([
      { now: t, clock: 0 },
      { now: t + 5, clock: 5 },
    ]);
    expect(fired).toContain('C3.lux.climbing');
    expect(fired).toContain('C3.lux.watch');
    expect(LINES['C3.lux.climbing'].text).toMatch(/more requests coming in/i);
    // Not before the forecast, and not once the crew are in.
    expect(play([{ now: C.c3 - 30 }])).not.toContain('C3.lux.climbing');
    expect(play([{ now: t, rescued: true }])).not.toContain('C3.lux.climbing');
  });

  it('C3: near the limit with nothing dropped, then over it', () => {
    const near = { now: C.c3 + 5, capacity: 60, demand: 52, dropped: 0 };
    expect(play([near, { ...near, clock: 1 }])).toContain('C3.lux.near');
    expect(
      play([
        { ...near, demand: 40 },
        { ...near, demand: 40, clock: 1 },
      ]),
    ).not.toContain('C3.lux.near');
    const over = { now: C.c3 + 5, capacity: 60, demand: 90, dropped: 30 };
    expect(play([over, { ...over, clock: 1 }])).not.toContain('C3.lux.over');
    expect(play([over, { ...over, clock: 2 }])).toContain('C3.lux.over');
  });

  it('C3: broke under the price of the kit, then thanks for the tip that covers it', () => {
    const broke = { now: C.c3 + 20, servers: 1, credits: BROWNOUT.overclock.cost - 7 };
    expect(play([broke, { ...broke, clock: 3 }])).toContain('C3.lux.broke');
    expect(
      play([
        { ...broke, credits: 200 },
        { ...broke, credits: 200, clock: 3 },
      ]),
    ).not.toContain('C3.lux.broke');
    expect(play([{ now: C.c3 + 25, helpTip: true }])).toContain('C3.lux.tip');
  });

  it('C4: she agrees refreshing makes it worse, a second after TRIAGE asks', () => {
    const s = direct(NEW_DIRECTOR, view({ now: C.c4 + 10 }), BOARD_CUES).state;
    const asked = { ...s, fired: { ...s.fired, 'C4.triage.03': 0 } };
    expect(direct(asked, view({ now: C.c4 + 10, clock: 0.5 }), BOARD_CUES).fired).not.toContain(
      'C4.lux.retry',
    );
    expect(direct(asked, view({ now: C.c4 + 11, clock: 1 }), BOARD_CUES).fired).toContain('C4.lux.retry');
  });

  // Rolando, 31 Oct 2026: the dip at ten seconds out needs the band quiet, so she speaks at twenty.
  it('C6: twenty seconds to midnight, clear of the dip, and only while the night is still open', () => {
    expect(play([{ now: MIDNIGHT - 18 }])).toContain('C6.lux.countdown');
    expect(play([{ now: MIDNIGHT - 12 }])).not.toContain('C6.lux.countdown');
    expect(play([{ now: MIDNIGHT - 8 }])).not.toContain('C6.lux.countdown');
  });

  it('the scripted table alone never fires an aside', () => {
    let s = NEW_DIRECTOR;
    for (let t = C.c1; t < C.c8; t += 1) {
      const r = direct(s, view({ now: t, clock: t, credits: 0, servers: 1, unwiredServer: true, moves: 1 }));
      s = r.state;
      for (const id of r.fired) expect(LUX_ASIDES, id).not.toContain(id);
    }
  });

  it('cueViewOf reads credits, tips, an unwired server and the moves count', () => {
    resetFrame();
    const r = new Run();
    r.now = C.c1;
    const f = frame(r);
    const v = cueViewOf(null, f, [], 0, { ...host, moves: 2 });
    expect(v.credits).toBe(f.credits);
    expect(v.moves).toBe(2);
    expect(v.helpTip).toBe(false);
    expect(v.recoveredTip).toBe(false);
    const tipped: Frame = {
      ...f,
      tips: [
        { at: 1, amount: 70, kind: 'help', n: 0 },
        { at: 2, amount: 30, kind: 'recovered', n: 1 },
      ],
      parts: [...f.parts, { id: 's9', kind: 'server', slot: 'c0-0' } as Frame['parts'][number]],
    };
    const w = cueViewOf(null, tipped, [], 0, host);
    expect(w.helpTip).toBe(true);
    expect(w.recoveredTip).toBe(true);
    expect(w.unwiredServer).toBe(true);
    expect(w.moves).toBe(0);
  });

  it('on best play, Lux talks the player through the night', () => {
    resetFrame();
    const r = new Run();
    r.autopilot = bestPlay;
    r.now = C.c1;
    let prev: Frame | null = null;
    const occ: Occurrence[] = [];
    const v = emptyCueView();
    let s = NEW_DIRECTOR;
    let clock = 0;
    const fired = new Set<LineId>();
    for (let n = 0; n < 20_000 && r.now < C.c8 && !r.play.failure; n++) {
      r.tick(0.1);
      clock += 0.1;
      const f = frame(r);
      detectOccurrences(prev, f, occ);
      prev = f;
      cueViewOf(v, f, occ, clock, host, v);
      const out = direct(s, v, BOARD_CUES);
      s = out.state;
      for (const id of out.fired) fired.add(id);
    }
    const said = LUX_ASIDES.filter((id) => fired.has(id));
    expect(said.length, said.join(', ')).toBeGreaterThanOrEqual(8);
    for (const id of ['C3.lux.climbing', 'C6.lux.countdown', 'C6.lux.midnight'] as LineId[])
      expect(fired.has(id), id).toBe(true);
  });
});
