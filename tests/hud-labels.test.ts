import { LABELS, allLabels } from '../src/scenes/hud/labels';
import { CHAT_TEXT } from '../src/scenes/hud/ChatFeedView';
import { PLATE_NAMES, PLATE_STATE, REPLACE_LABEL } from '../src/scenes/board/plate';

// labels.ts takes over the chat header's words and the board plate's words (tech follow-up 2), so
// every word on the Live screen comes from one file the debrief-term scan reads. The views still
// hold their own copies until their lanes swap them in; these tests keep the two equal meanwhile.

describe('LABELS.chat: LIVE CHAT header', () => {
  it('has the title and the two filter tags', () => {
    expect(LABELS.chat).toEqual({ title: 'LIVE CHAT', both: 'BLOCK + STREAM', blockOnly: 'BLOCK ONLY' });
  });

  it('matches what ChatFeedView prints today', () => {
    expect(LABELS.chat.title).toBe(CHAT_TEXT.title);
    expect(LABELS.chat.both).toBe(CHAT_TEXT.all);
    expect(LABELS.chat.blockOnly).toBe(CHAT_TEXT.block);
  });
});

describe('LABELS.plates: the board plate words', () => {
  it('names every part kind as plate.ts does', () => {
    expect(LABELS.plates.names).toEqual({ ...PLATE_NAMES });
  });

  it('has every state word plate.ts uses, and the REPLACE button', () => {
    expect(LABELS.plates.state).toEqual({ ...PLATE_STATE });
    expect(LABELS.plates.replace).toBe(REPLACE_LABEL);
  });

  it('keeps the earlier plate lines unchanged (additions only)', () => {
    expect(LABELS.plates.nothingFeeds).toBe('nothing feeds it');
    expect(LABELS.plates.gateway.startsWith('GATEWAY · ')).toBe(true);
  });

  it('lists the new words in allLabels, so the debrief-term scan reads them', () => {
    const all = allLabels();
    for (const w of [
      ...Object.values(LABELS.chat),
      ...Object.values(LABELS.plates.names),
      ...Object.values(LABELS.plates.state),
      LABELS.plates.replace,
    ])
      expect(all).toContain(w);
  });
});
