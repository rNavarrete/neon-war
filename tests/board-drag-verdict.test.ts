import boardSource from '../src/scenes/BoardScene.ts?raw';
import { type DragState, dragVerdict } from '../src/game/bus';
import type { PadState } from '../src/scenes/board/layout';

// Cross-lane swap 1: the board's three drag emits carry the pad verdict (drag.state, drag.legal),
// so the comms band and the cam read a real verdict instead of an absent field.

/** The text of every `bus.emit('drag', {...})` call in the board scene. */
function dragEmits(src: string): string[] {
  const out: string[] = [];
  const mark = "bus.emit('drag'";
  let at = src.indexOf(mark);
  while (at >= 0) {
    // Read to the call's closing parenthesis.
    let depth = 0;
    let end = at + 'bus.emit'.length;
    for (; end < src.length; end++) {
      const c = src[end];
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) break;
    }
    out.push(src.slice(at, end + 1));
    at = src.indexOf(mark, end);
  }
  return out;
}

describe('BoardScene emitDrag sends the drag verdict', () => {
  it('imports dragVerdict from the bus', () => {
    expect(boardSource).toMatch(/import \{[^}]*\bdragVerdict\b[^}]*\} from '\.\.\/game\/bus'/);
  });

  it('spreads dragVerdict into each of the three drag emits', () => {
    const emits = dragEmits(boardSource);
    expect(emits).toHaveLength(3);
    for (const e of emits) expect(e, e).toMatch(/\.\.\.dragVerdict\(/);
  });

  it('the card emit takes the pad state under the card; the end and wire emits send null', () => {
    const [end, card, wire] = dragEmits(boardSource);
    expect(end).toMatch(/kind: null[\s\S]*\.\.\.dragVerdict\(null\)/);
    expect(card).toMatch(/kind: 'card'[\s\S]*\.\.\.dragVerdict\(state\)/);
    expect(wire).toMatch(/kind: 'wire'[\s\S]*\.\.\.dragVerdict\(null\)/);
  });

  it("every PadState the board reports is a DragState with the bus's verdict", () => {
    const states: PadState[] = ['legal', 'taken', 'dead', 'poor', 'wrong'];
    for (const s of states) {
      const d: DragState = s;
      expect(dragVerdict(d)).toEqual({ state: s, legal: s === 'legal' });
    }
    expect(dragVerdict(null)).toEqual({ state: null, legal: null });
  });
});
