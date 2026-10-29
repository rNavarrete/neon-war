import { Run } from '../src/game/run';
import { chartCeiling, countdownText, errorState, secondsToMidnight } from '../src/scenes/hud/format';
import { dismissJobCard, jobCardDue, openJobCard } from '../src/scenes/hud/jobCard';
import { DIP_FALLBACK, dipMarkAt } from '../src/scenes/hud/warnings';
import { partAnchor, partCentre, toPage } from '../src/scenes/board/layout';
import { CARDS, SCREEN, centreOf, pagePoint } from '../src/scenes/live/layout';
import { BROWNOUT } from '../src/sim/brownout';
import { SERVER_SLOTS } from '../src/sim/tick';

describe('midnight countdown', () => {
  it('reads 5:35 when the clock opens and 0:00 at midnight', () => {
    expect(countdownText(0)).toBe('5:35');
    expect(countdownText(BROWNOUT.clock.midnight)).toBe('0:00');
    expect(countdownText(BROWNOUT.clock.midnight + 30)).toBe('0:00');
  });

  it('rounds up, so it only reaches 0:00 on the stroke of midnight', () => {
    expect(countdownText(334.5)).toBe('0:01');
    expect(countdownText(275)).toBe('1:00');
    expect(countdownText(274.2)).toBe('1:01');
    expect(secondsToMidnight(15)).toBe(320);
  });

  it('agrees with the run clock: 23:54:25 at the start, 00:00:00 at midnight', () => {
    const r = new Run();
    expect(r.clock(0)).toBe('23:54:25');
    expect(r.clock(BROWNOUT.clock.midnight)).toBe('00:00:00');
  });
});

describe('chart scale', () => {
  it('fits the highest value with headroom', () => {
    expect(chartCeiling(0)).toBe(60);
    expect(chartCeiling(30)).toBe(60);
    expect(chartCeiling(60)).toBe(120);
    expect(chartCeiling(250)).toBe(300);
    expect(chartCeiling(480)).toBe(600);
    expect(chartCeiling(5000)).toBe(600);
  });
});

describe('chat error state', () => {
  it('picks all fine, some errors or heavy errors from the error share', () => {
    expect(errorState(0)).toBe('ok');
    expect(errorState(0.2)).toBe('slow');
    expect(errorState(0.5)).toBe('down');
    expect(errorState(1)).toBe('down');
  });
});

describe('job card', () => {
  it('holds the board until clicked away, starts C1, and does not come back', () => {
    const r = new Run();
    expect(jobCardDue(r)).toBe(true);
    openJobCard(r);
    expect(r.paused).toBe(true);
    dismissJobCard(r);
    expect(r.paused).toBe(false);
    expect(r.now).toBe(BROWNOUT.challenges.c1);
    expect(jobCardDue(r)).toBe(false);
  });

  it('does not open once the banner is due', () => {
    const r = new Run();
    r.now = BROWNOUT.challenges.c2;
    expect(jobCardDue(r)).toBe(false);
  });
});

describe('the dip mark sits on the part', () => {
  it('is drawn at the board’s anchor for the part, within 2 page px of board.parts[id]', () => {
    const r = new Run();
    for (const slot of SERVER_SLOTS.slice(0, 3)) expect(r.placeServer(slot).ok).toBe(true);
    const canvas = { left: 8, top: 4, width: 1280, height: 720 };
    for (const p of r.session.board.parts) {
      const mark = dipMarkAt(r.session.board, p.id);
      const at = partCentre(p);
      expect(at).not.toBeNull();
      expect(mark).toEqual(partAnchor(r.session.board, p.id));
      // board.parts[] reports partCentre through toPage; the HUD maps the mark through pagePoint.
      const a = pagePoint(mark, canvas);
      const b = toPage(at!, canvas, SCREEN);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(2);
    }
  });

  it('falls back to the dip card when the board can’t place the part', () => {
    const r = new Run();
    expect(dipMarkAt(r.session.board, 'server-404')).toEqual(DIP_FALLBACK);
    expect(DIP_FALLBACK).toEqual(centreOf(CARDS.dipFallback));
  });
});
