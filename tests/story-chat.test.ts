import { CHAT_RECT, avatarFor, chatMessage } from '../src/story/chatPanel';
import { BLOCK_AVATARS, STREAM_AVATARS } from '../src/scenes/avatars';

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

  it('keeps the panel in the top-right corner, short enough that the plate never stretches past its file', () => {
    expect(CHAT_RECT.x + CHAT_RECT.w).toBeLessThanOrEqual(1920 - 16);
    expect(CHAT_RECT.h).toBeLessThanOrEqual(354);
  });
});
