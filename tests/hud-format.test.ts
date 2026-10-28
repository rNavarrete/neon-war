import { Run } from '../src/game/run';
import {
  DIAL_FREE_NOTE,
  SERVER_MODE_FROM,
  applyEstimate,
  applySizing,
  dialDimmed,
  dialFraction,
  dialLabel,
  dialModeAt,
  dialValueAt,
  turnDial,
} from '../src/scenes/hud/dial';
import { chartCeiling, countdownText, errorState, secondsToMidnight } from '../src/scenes/hud/format';
import {
  dialQuestionOpen,
  dismissJobCard,
  jobCardDue,
  openJobCard,
  sizingPromptOpen,
} from '../src/scenes/hud/jobCard';
import { CENTRE, RIGHT } from '../src/scenes/hud/layout';
import { DIP_FALLBACK, dipMarkAt } from '../src/scenes/hud/warnings';
import { partAnchor, partCentre, toPage } from '../src/scenes/board/layout';
import { CARDS, SCREEN, ZONES, centreOf, inside, pagePoint } from '../src/scenes/live/layout';
import { BROWNOUT } from '../src/sim/brownout';
import { SERVER_SLOTS } from '../src/sim/tick';

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

// ---- gauges-2: the cards over the feed ----

describe('the dial card follows the dock truth table', () => {
  const C = BROWNOUT.challenges;
  const midnight = BROWNOUT.clock.midnight;
  // now, job card open, estimate, sizing -> dial question open, sizing prompt open
  const table: [number, boolean, number | null, number | null, boolean, boolean][] = [
    [C.c1, true, null, null, false, false], // under the job card: nothing docks
    [C.c1, false, null, null, true, false], // C1, card closed, no estimate: the dial asks
    [C.c2 + 30, false, null, null, true, false], // still unanswered later on: still asks
    [C.c1, false, 30, null, false, false], // estimate SET: the card goes
    [SERVER_MODE_FROM - 1, false, 30, null, false, false], // just before the sizing prompt
    [SERVER_MODE_FROM, false, 30, null, true, true], // C6 forecast: the dial counts boxes
    [SERVER_MODE_FROM, false, null, null, true, true], // the C1 estimate never set: C6 asks anyway
    [SERVER_MODE_FROM, true, 30, null, false, false], // a card up: nothing docks
    [C.c6 + 30, false, 30, 4, false, false], // sizing SET: gone
    [midnight, false, 30, null, false, false], // midnight: too late to ask
  ];
  it.each(table)(
    'now %s, card %s, estimate %s, sizing %s',
    (now, cardOpen, estimate, sizing, asks, prompt) => {
      const a = { now, cardOpen, estimate, sizing };
      expect(dialQuestionOpen(a)).toBe(asks);
      expect(sizingPromptOpen(a)).toBe(prompt);
    },
  );
});

describe('the dial card dims after the first wire in C1', () => {
  it('dims only while the C1 question is open and something is wired; the card stays open', () => {
    expect(dialDimmed('reqps', null, false)).toBe(false);
    expect(dialDimmed('reqps', null, true)).toBe(true);
    expect(dialDimmed('reqps', 30, true)).toBe(false);
    expect(dialDimmed('servers', null, true)).toBe(false);
    expect(DIAL_FREE_NOTE).toBe('your guess stays free');
    expect(dialLabel('HOW MANY A SECOND?', true)).toBe(DIAL_FREE_NOTE);
    expect(dialLabel('HOW MANY A SECOND?', false)).toBe('HOW MANY A SECOND?');
    // Dimming is a look only: the question stays open (hud.dial.visible) until SET.
    const ask = { now: BROWNOUT.challenges.c1 + 5, cardOpen: false, estimate: null, sizing: null };
    expect(dialQuestionOpen(ask)).toBe(true);
  });
});

describe('the cards are read from the Live layout', () => {
  it('puts the dial and its buttons on CARDS.dialCard and the sizing prompt on CARDS.sizingPrompt', () => {
    expect(RIGHT.dialCard).toEqual(CARDS.dialCard);
    expect(RIGHT.dial).toMatchObject(centreOf(CARDS.dialCard));
    for (const b of [RIGHT.dialMinus, RIGHT.dialPlus]) {
      expect(inside({ x: b.x - b.r, y: b.y - b.r, w: 2 * b.r, h: 2 * b.r }, CARDS.dialCard)).toBe(true);
    }
    expect(CENTRE.sizing).toEqual(CARDS.sizingPrompt);
    for (const id of ['dialCard', 'sizingPrompt'] as const) expect(inside(CARDS[id], ZONES.feed)).toBe(true);
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
