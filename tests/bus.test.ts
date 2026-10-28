import titleSource from '../src/scenes/hud/title.ts?raw';
import { Bus, type DragState, type GameEvents, dragVerdict } from '../src/game/bus';
import type { PadState } from '../src/scenes/board/layout';
import { readFrame } from '../src/game/frame';
import { Run } from '../src/game/run';
import { CommsView } from '../src/scenes/hud/CommsView';
import { LESSON_IDS, isLesson } from '../src/scenes/hud/lineMeta';
import { ZONES } from '../src/scenes/live/layout';
import { LINES, type LineId } from '../src/strings';

// The bus catalogue (src/game/bus.ts, docs/LIVE.md "Bus events"): the Live screen's events are
// declared in GameEvents itself, not by module augmentation in a lane's file.

describe('the bus catalogue', () => {
  it('carries audience {watching} as declared in GameEvents', () => {
    const bus = new Bus();
    const seen: GameEvents['audience'][] = [];
    const off = bus.on('audience', (e) => seen.push(e));
    bus.emit('audience', { watching: 3 });
    off();
    bus.emit('audience', { watching: 1 });
    expect(seen).toEqual([{ watching: 3 }]);
  });

  it('carries cue {id, kind, at}: one event per fired line of the trigger table', () => {
    const bus = new Bus();
    const seen: GameEvents['cue'][] = [];
    const off = bus.on('cue', (e) => seen.push(e));
    bus.emit('cue', { id: 'C1.triage.01', kind: 'bark', at: 3.5 });
    bus.emit('cue', { id: 'C1.chat.01', kind: 'chat', at: 4 });
    off();
    expect(seen.map((e) => [e.id, e.kind])).toEqual([
      ['C1.triage.01', 'bark'],
      ['C1.chat.01', 'chat'],
    ]);
  });

  it('has no lane file augmenting GameEvents: title.ts no longer declares audience', () => {
    expect(titleSource).not.toMatch(/declare module '..\/..\/game\/bus'/);
    expect(titleSource).not.toMatch(/audience: \{ watching: number \}/);
  });
});

describe('drag carries the legality of the spot under the card', () => {
  // Type-level: the bus's DragState is exactly the board's PadState, both ways.
  const toBus: DragState = 'legal' as PadState;
  const toBoard: PadState = 'wrong' as DragState;

  it('dragVerdict: legal only on a legal pad, null over nothing', () => {
    expect([toBus, toBoard]).toEqual(['legal', 'wrong']);
    expect(dragVerdict('legal')).toEqual({ state: 'legal', legal: true });
    for (const s of ['taken', 'dead', 'poor', 'wrong'] as const)
      expect(dragVerdict(s)).toEqual({ state: s, legal: false });
    expect(dragVerdict(null)).toEqual({ state: null, legal: null });
  });

  it('declares state and legal on GameEvents drag, and an old emit without them still types', () => {
    const bus = new Bus();
    const seen: GameEvents['drag'][] = [];
    bus.on('drag', (e) => seen.push(e));
    bus.emit('drag', { kind: 'card', card: 'server', over: 'cell', ...dragVerdict('poor') });
    bus.emit('drag', { kind: 'card', card: 'server', over: null });
    bus.emit('drag', { kind: null, card: null, over: null, state: null, legal: null });
    expect(seen.map((e) => [e.state ?? null, e.legal ?? null])).toEqual([
      ['poor', false],
      [null, null],
      [null, null],
    ]);
  });
});

/** A scene stub whose every property and call returns another stub (enough for CommsView). */
function stubScene(): unknown {
  const chain = (): unknown => {
    const o: unknown = new Proxy(() => o, {
      get(_t, prop) {
        if (prop === 'then') return undefined;
        if (prop === Symbol.toPrimitive) return () => 0;
        return o;
      },
      apply: () => o,
    });
    return o;
  };
  return chain();
}

describe('line carries the lesson flag', () => {
  it('declares lesson: boolean on GameEvents line', () => {
    const bus = new Bus();
    const seen: GameEvents['line'][] = [];
    bus.on('line', (e) => seen.push(e));
    bus.emit('line', { id: 'C1.triage.06', speaker: 'TRIAGE', tag: 'HINT', lesson: true, since: 2 });
    expect(seen[0].lesson).toBe(true);
  });

  it('CommsView emits lesson from lineMeta for a lesson line and for a plain one', () => {
    const lesson = LESSON_IDS[0];
    const plain = (Object.keys(LINES) as LineId[]).find((id) => LINES[id].kind === 'bark' && !isLesson(id))!;
    expect(isLesson(lesson)).toBe(true);
    const bus = new Bus();
    const seen: GameEvents['line'][] = [];
    bus.on('line', (e) => seen.push(e));
    const view = new CommsView();
    view.create(stubScene() as never, {
      scene: null as never,
      bus,
      rect: ZONES.comms,
      flags: { lite: true },
    });
    const f = readFrame(new Run());
    let t = 0;
    const until = (id: LineId): void => {
      for (let n = 0; n < 4000 && !seen.some((e) => e.id === id); n++)
        view.update(f, { now: (t += 0.05), dt: 0.05 });
    };
    view.enqueue(plain);
    until(plain);
    view.enqueue(lesson);
    until(lesson);
    view.shutdown();
    expect(seen.find((e) => e.id === plain)?.lesson).toBe(false);
    expect(seen.find((e) => e.id === lesson)?.lesson).toBe(true);
  });
});
