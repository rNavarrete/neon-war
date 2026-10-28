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
