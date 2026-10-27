import { Run } from '../src/game/run';
import {
  applyEstimate,
  applySizing,
  dialFraction,
  dialModeAt,
  dialValueAt,
  turnDial,
} from '../src/scenes/hud/dial';
import { chartCeiling, countdownText, errorState, secondsToMidnight } from '../src/scenes/hud/format';
import { dismissJobCard, jobCardDue, openJobCard } from '../src/scenes/hud/jobCard';
import { BROWNOUT } from '../src/sim/brownout';

describe('midnight countdown', () => {
  it('reads 8:30 when the clock opens and 0:00 at midnight', () => {
    expect(countdownText(0)).toBe('8:30');
    expect(countdownText(BROWNOUT.clock.midnight)).toBe('0:00');
    expect(countdownText(BROWNOUT.clock.midnight + 30)).toBe('0:00');
  });

  it('rounds up, so it only reaches 0:00 on the stroke of midnight', () => {
    expect(countdownText(509.5)).toBe('0:01');
    expect(countdownText(450)).toBe('1:00');
    expect(countdownText(449.2)).toBe('1:01');
    expect(secondsToMidnight(15)).toBe(495);
  });

  it('agrees with the run clock: 23:51:30 at the start, 00:00:00 at midnight', () => {
    const r = new Run();
    expect(r.clock(0)).toBe('23:51:30');
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

describe('estimate dial', () => {
  it('counts req/s until the midnight forecast, then servers', () => {
    expect(dialModeAt(15)).toBe('reqps');
    expect(dialModeAt(BROWNOUT.challenges.c6 - 11)).toBe('reqps');
    expect(dialModeAt(BROWNOUT.challenges.c6 - 10)).toBe('servers');
    expect(dialModeAt(BROWNOUT.challenges.c6)).toBe('servers');
  });

  it('turns in steps and stays on its scale', () => {
    expect(turnDial(0, 6, 'reqps')).toBe(30);
    expect(turnDial(30, -1, 'reqps')).toBe(25);
    expect(turnDial(0, -3, 'reqps')).toBe(0);
    expect(turnDial(595, 5, 'reqps')).toBe(600);
    expect(turnDial(3, 1, 'servers')).toBe(4);
    expect(turnDial(8, 1, 'servers')).toBe(8);
  });

  it('maps a drag angle to a snapped value and back', () => {
    expect(dialValueAt(0.05, 'reqps')).toBe(30);
    expect(dialValueAt(0.5, 'servers')).toBe(4);
    expect(dialFraction(300, 'reqps')).toBe(0.5);
    expect(dialValueAt(2, 'servers')).toBe(8);
  });

  it('a wrong guess costs nothing: credits, trust and the board stay the same', () => {
    const r = new Run();
    const before = r.session;
    expect(applyEstimate(r, 480)).toBe(true);
    expect(r.notes.estimate).toBe(480);
    expect(r.session).toBe(before);
    expect(r.session.board.credits).toBe(BROWNOUT.credits.starting);
    expect(r.session.trust).toBe(BROWNOUT.trust.starting);
  });

  it('keeps the first answer for the debrief', () => {
    const r = new Run();
    applyEstimate(r, 30);
    expect(applyEstimate(r, 480)).toBe(false);
    expect(r.notes.estimate).toBe(30);
    expect(applySizing(r, 4)).toBe(true);
    expect(applySizing(r, 6)).toBe(false);
    expect(r.notes).toEqual({ estimate: 30, sizing: 4 });
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
