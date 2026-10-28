import { Run } from '../src/game/run';
import { twelveHour } from '../src/scenes/hud/format';
import { BROWNOUT } from '../src/sim/brownout';
import { seenText } from '../src/story/debrief';

// Rolando (28 Oct 2026): the clock on screen reads in 12-hour time, never 24-hour.

describe('twelveHour', () => {
  it('reads the night in 12-hour time', () => {
    expect(twelveHour('23:51:30')).toBe('11:51:30 PM');
    expect(twelveHour('23:59:59')).toBe('11:59:59 PM');
    expect(twelveHour('00:00:00')).toBe('12:00:00 AM');
    expect(twelveHour('00:01:00')).toBe('12:01:00 AM');
    expect(twelveHour('02:14:00')).toBe('2:14:00 AM');
    expect(twelveHour('12:00:00')).toBe('12:00:00 PM');
    expect(twelveHour('11:05:09')).toBe('11:05:09 AM');
  });

  it("turns the run's clock into what the title shows, from the open to past midnight", () => {
    const r = new Run();
    expect(twelveHour(r.clock(0))).toBe('11:51:30 PM');
    expect(twelveHour(r.clock(BROWNOUT.clock.midnight))).toBe('12:00:00 AM');
  });

  it('prints the debrief\'s "you saw it at" time in 12-hour time', () => {
    const text = seenText({
      clock: '23:52:10',
      line: null,
      moment: null,
      value: 0,
    } as unknown as Parameters<typeof seenText>[0]);
    expect(text.startsWith('you saw it at 11:52:10 PM: ')).toBe(true);
  });
});
