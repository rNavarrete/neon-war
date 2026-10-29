import { EVENT_SFX, SFX_KEYS, isSfxKey, sfxForAction } from '../src/game/audio';
import { BOARD_SFX, BoardSfx, DROP_GAP_SECONDS, SFX_LOG } from '../src/scenes/board/sfx';
import boardSource from '../src/scenes/BoardScene.ts?raw';

// board-10: the board's sound hooks. Each new board sound fires at most at its stated rate and only
// for keys that exist; the existing mapping (place-part, wire-connect, wire-cut, server-hot,
// server-die, power-dip) is unchanged.

describe('the board sounds', () => {
  it('are the three Live keys the audio lane added, and each exists', () => {
    expect(Object.values(BOARD_SFX).sort()).toEqual(['health-skip', 'packet-drop', 'server-online']);
    for (const key of Object.values(BOARD_SFX)) expect(isSfxKey(key), key).toBe(true);
  });

  it('chime once per completed boot and blip once per new skip', () => {
    const s = new BoardSfx();
    expect(s.online(1)).toBe('server-online');
    expect(s.online(1.1)).toBe('server-online');
    expect(s.skip(2)).toBe('health-skip');
    expect(s.log).toEqual([
      { key: 'server-online', at: 1 },
      { key: 'server-online', at: 1.1 },
      { key: 'health-skip', at: 2 },
    ]);
  });

  it('crackle at most once per 0.5 s while something drops, and never when nothing does', () => {
    const s = new BoardSfx();
    let t = 0;
    const heard: number[] = [];
    for (let i = 0; i < 300; i++, t += 1 / 60) if (s.drop(true, t)) heard.push(t);
    expect(heard.length).toBeGreaterThan(5);
    for (let i = 1; i < heard.length; i++) {
      expect(heard[i] - heard[i - 1]).toBeGreaterThanOrEqual(DROP_GAP_SECONDS - 1e-9);
    }
    // At 60 frames a second over 5 s: one crackle per half second, no more.
    expect(heard.length).toBeLessThanOrEqual(Math.ceil(5 / DROP_GAP_SECONDS) + 1);
    const quiet = new BoardSfx();
    for (let i = 0; i < 100; i++) expect(quiet.drop(false, i * 0.1)).toBeNull();
    expect(quiet.log).toEqual([]);
  });

  it('asks for nothing whose key does not exist', () => {
    const s = new BoardSfx(() => false);
    expect(s.online(0)).toBeNull();
    expect(s.drop(true, 0)).toBeNull();
    expect(s.skip(0)).toBeNull();
    expect(s.log).toEqual([]);
    // Only a key that exists passes: a board with packet-drop missing still chimes.
    const some = new BoardSfx((k) => k !== 'packet-drop');
    expect(some.drop(true, 0)).toBeNull();
    expect(some.online(0)).toBe('server-online');
  });

  it('keeps a bounded log', () => {
    const s = new BoardSfx();
    for (let i = 0; i < SFX_LOG + 20; i++) s.online(i);
    expect(s.log).toHaveLength(SFX_LOG);
    expect(s.log[0].at).toBe(20);
    // The totals keep counting past the log.
    expect(s.counts).toEqual({ 'server-online': SFX_LOG + 20 });
  });
});

describe('the existing board sound mapping is unchanged', () => {
  it('maps the player actions and the sim events as before', () => {
    expect(sfxForAction({ type: 'place', id: 'x' })).toBe('place-part');
    expect(sfxForAction({ type: 'wire', from: 'a', to: 'b' })).toBe('wire-connect');
    expect(sfxForAction({ type: 'cut', from: 'a', to: 'b' })).toBe('wire-cut');
    expect(sfxForAction({ type: 'laundryCut' })).toBe('wire-cut');
    expect(sfxForAction({ type: 'decommission', id: 'x', refund: 40 })).toBe('credits');
    expect(sfxForAction({ type: 'overclock', id: 'x' })).toBe('credits');
    expect(EVENT_SFX).toEqual({
      overheat: 'server-hot',
      serverDied: 'server-die',
      powerDip: 'power-dip',
      rescue: 'rescue-cable',
    });
    for (const k of ['place-part', 'wire-connect', 'wire-cut', 'server-hot', 'server-die', 'power-dip']) {
      expect((SFX_KEYS as readonly string[]).includes(k), k).toBe(true);
    }
  });

  it('the board emits only its three keys itself, each through isSfxKey', () => {
    const emits = [...boardSource.matchAll(/bus\.emit\('sfx', \{ key(?:: ([^}]+))? \}\)/g)].map((m) =>
      (m[1] ?? 'key').trim(),
    );
    expect(emits.length).toBeGreaterThan(0);
    for (const e of emits) expect(e).toBe('key');
    // No key is named at an emit, so none of the existing ones is played by the board directly
    // (the AudioDirector maps those from 'action' and the sim's events).
    expect(boardSource).not.toMatch(/emit\('sfx', \{ key: '/);
    expect(boardSource).toContain('isSfxKey');
  });
});
