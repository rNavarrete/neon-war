import commsViewSource from '../src/scenes/hud/CommsView.ts?raw';
import type { CommsLeaderState } from '../src/scenes/hud/CommsView';
import type { CommsTestState } from '../src/scenes/live/views/comms';

// Cross-lane swap 5: hud.comms.leader is typed as what the band reports (CommsLeaderState | null),
// so CommsView needs no cast to fill it. tsc checks the type assertion below (tests are in
// tsconfig's include); the run checks the cast is gone.

describe('hud.comms.leader is typed CommsLeaderState | null', () => {
  it('CommsTestState.leader is exactly CommsLeaderState | null', () => {
    expectTypeOf<CommsTestState['leader']>().toEqualTypeOf<CommsLeaderState | null>();
    const leader: CommsTestState['leader'] = {
      subject: 'zone:gauge',
      target: 'gauge',
      from: { x: 0, y: 0 },
      corner: { x: 1, y: 0 },
      to: { x: 1, y: 1 },
    };
    expect(leader?.target).toBe('gauge');
  });

  it('CommsView fills it without a cast', () => {
    expect(commsViewSource).not.toMatch(/as unknown as null/);
    expect(commsViewSource).toMatch(/leader: this\.leaderNow\(canvas\),/);
  });
});
