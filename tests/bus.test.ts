import titleSource from '../src/scenes/hud/title.ts?raw';
import { Bus, type GameEvents } from '../src/game/bus';

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

  it('has no lane file augmenting GameEvents: title.ts no longer declares audience', () => {
    expect(titleSource).not.toMatch(/declare module '..\/..\/game\/bus'/);
    expect(titleSource).not.toMatch(/audience: \{ watching: number \}/);
  });
});
