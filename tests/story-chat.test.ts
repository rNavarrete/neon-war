import {
  ARRIVAL,
  CHAT_RECT,
  FILLER,
  avatarFor,
  chatMessage,
  fillerFor,
  fillerMessage,
} from '../src/story/chatPanel';
import { BLOCK_AVATARS, STREAM_AVATARS } from '../src/scenes/avatars';
import { BOX_TOP } from '../src/story/stage';

// The story's stream chat: each row knows its sender, where they post from, and whose face to show.

describe('story chat', () => {
  it('splits the script speaker into a sender and a source', () => {
    expect(chatMessage('block: kenji', 'lux pls')).toEqual({
      who: 'kenji',
      source: 'block',
      text: 'lux pls',
    });
    expect(chatMessage('stream: rainproxy', 'go!')).toEqual({
      who: 'rainproxy',
      source: 'stream',
      text: 'go!',
    });
  });

  it("shows a resident's painted face, and the same viewer disc for the same handle", () => {
    expect(avatarFor(chatMessage('block: mrs okafor', 'x'))).toBe(BLOCK_AVATARS['mrs okafor']);
    const a = avatarFor(chatMessage('stream: rainproxy', 'x'));
    expect(STREAM_AVATARS).toContain(a);
    expect(avatarFor(chatMessage('stream: rainproxy', 'y'))).toBe(a);
  });

  it('keeps the panel in the top-right corner, taller than before but well clear of the text box', () => {
    expect(CHAT_RECT.x + CHAT_RECT.w).toBeLessThanOrEqual(1920 - 16);
    expect(CHAT_RECT.h).toBeGreaterThanOrEqual(500);
    expect(CHAT_RECT.y + CHAT_RECT.h).toBeLessThanOrEqual(BOX_TOP - 120);
  });
});

describe('the chat rolls in live', () => {
  it('lands script lines 0.8 to 2 s apart and fills the gaps every 3 to 6 s', () => {
    expect(ARRIVAL.min).toBeGreaterThanOrEqual(0.8);
    expect(ARRIVAL.min + ARRIVAL.spread).toBeLessThanOrEqual(2);
    expect(FILLER.min).toBe(3);
    expect(FILLER.min + FILLER.spread).toBe(6);
  });

  it('keeps the cold open grumbling about a flaky net, and the rescue panicking with it down', () => {
    const c0 = fillerFor('C0');
    expect(c0.length).toBeGreaterThan(4);
    expect(c0.every((id) => /^fill\.(block|stream)\.slow\./.test(id))).toBe(true);
    expect(fillerFor('C5').every((id) => /^fill\.(block|stream)\.down\./.test(id))).toBe(true);
  });

  it('posts block filler under its resident and stream filler under a viewer handle', () => {
    expect(fillerMessage('fill.block.slow.03')).toEqual({
      who: 'mrs okafor',
      source: 'block',
      text: "Lift's stuck again.",
    });
    const m = fillerMessage('fill.stream.slow.01');
    expect(m.source).toBe('stream');
    expect(m.who).not.toBe('stream');
    expect(m.text).toBe('number go up??');
  });
});
