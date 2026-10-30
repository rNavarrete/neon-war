import { BROWNOUT } from '../src/sim/brownout';
import { parseBold, runWords } from '../src/story/markup';
import { rewindKindFor, rewindTarget } from '../src/story/rewind';
import { LINES } from '../src/strings';

const C = BROWNOUT.challenges;

describe('rewinds', () => {
  it("uses TRIAGE's replay before the rescue and Rei's after it", () => {
    expect(rewindKindFor(200, false)).toBe('replay');
    expect(rewindKindFor(C.c5 + 30, true)).toBe('rei-surge');
    expect(rewindKindFor(C.c6 + 50, true)).toBe('rei-midnight');
  });

  it('sends the replay back to the start of the current challenge', () => {
    expect(rewindTarget('replay', C.c1 + 20)).toBe(C.c1);
    expect(rewindTarget('replay', C.c2 + 1)).toBe(C.c2);
    expect(rewindTarget('replay', C.c3 + 50)).toBe(C.c3);
  });

  it("sends Rei's rewinds to the surge start or to 23:59", () => {
    expect(rewindTarget('rei-surge', C.c5 + 10)).toBe(C.c4);
    expect(rewindTarget('rei-midnight', C.c7)).toBe(C.c6);
    expect(C.c6).toBe(275); // 23:54:25 + 4:35 = 23:59:00
  });
});

describe('bold markup', () => {
  it('splits **bold** runs from plain text', () => {
    expect(parseBold('**Load balancer** with **health checks** (splits).')).toEqual([
      { text: 'Load balancer', bold: true },
      { text: ' with ', bold: false },
      { text: 'health checks', bold: true },
      { text: ' (splits).', bold: false },
    ]);
  });

  it('finds every named term in the three groups', () => {
    const bold = (id: keyof typeof LINES) =>
      parseBold(LINES[id].text)
        .filter((r) => r.bold)
        .map((r) => r.text);
    expect(bold('C8.terms.sizing')).toEqual([
      'Requirements',
      'Requests per second',
      'Capacity',
      'Back-of-the-envelope estimate',
      'Headroom',
      'Peak vs average',
    ]);
    expect(bold('C8.terms.scaling')).toHaveLength(5);
    expect(bold('C8.terms.failure')).toHaveLength(5);
  });

  it('splits runs into words that keep their weight', () => {
    expect(runWords(parseBold('**Retry storm** (refresh).'))).toEqual([
      { text: 'Retry ', bold: true },
      { text: 'storm', bold: true },
      { text: ' ', bold: false },
      { text: '(refresh).', bold: false },
    ]);
  });
});
