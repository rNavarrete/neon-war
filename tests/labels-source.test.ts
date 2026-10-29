import plateSource from '../src/scenes/board/plate.ts?raw';
import chatSource from '../src/scenes/hud/ChatFeedView.ts?raw';
import { CHAT_TEXT } from '../src/scenes/hud/ChatFeedView';
import { LABELS } from '../src/scenes/hud/labels';
import { PLATE_NAMES, PLATE_STATE, REPLACE_LABEL } from '../src/scenes/board/plate';

// Cross-lane swap 2: the plate and chat header words come from LABELS (one place for micro-copy),
// not from copies that could drift. Equal values, so nothing on screen changes.

describe('the plate and chat header read their words from LABELS', () => {
  it('plate.ts takes PLATE_NAMES, PLATE_STATE and REPLACE_LABEL from LABELS.plates', () => {
    expect(PLATE_NAMES).toBe(LABELS.plates.names);
    expect(PLATE_STATE).toBe(LABELS.plates.state);
    expect(REPLACE_LABEL).toBe(LABELS.plates.replace);
    // No literal copy of a plate word is left in plate.ts.
    for (const w of [...Object.values(LABELS.plates.state), LABELS.plates.replace, 'GATEWAY', 'DATABASE'])
      expect(plateSource, w).not.toContain(`'${w}'`);
  });

  it('ChatFeedView takes CHAT_TEXT from LABELS.chat', () => {
    expect(CHAT_TEXT).toEqual({
      title: LABELS.chat.title,
      all: LABELS.chat.both,
      block: LABELS.chat.blockOnly,
    });
    expect(chatSource).toMatch(/title: LABELS\.chat\.title/);
    expect(chatSource).toMatch(/all: LABELS\.chat\.both/);
    expect(chatSource).toMatch(/block: LABELS\.chat\.blockOnly/);
    for (const w of Object.values(LABELS.chat)) expect(chatSource, w).not.toContain(`'${w}'`);
  });
});
