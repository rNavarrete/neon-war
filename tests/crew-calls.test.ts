import { BROWNOUT } from '../src/sim/brownout';
import {
  BANTER,
  CHAT_BEAT,
  HIJACK,
  LINE_GAP,
  banterDue,
  callSteps,
  endingCall,
  faceThrough,
  noiseLevel,
  startCall,
  stepCall,
} from '../src/scenes/hud/crewCalls';
import type { DebriefResults } from '../src/story/debrief';
import { LINES } from '../src/strings';

// The crew's calls over the HUD (Rolando, 1 Nov 2026): the hijack instead of the rescue scene, banter
// in the quiet stretch, and the sign-off with the arcade invitation before the scorecard.

const C = BROWNOUT.challenges;
const MIDNIGHT = BROWNOUT.clock.midnight;
const FREE = { busy: false, queued: 0 };
const BUSY = { busy: true, queued: 0 };

const BEST: DebriefResults = {
  droppedRequests: 120,
  wastedCredits: 0,
  trustLeft: 100,
  banner: 'ignore',
  ozzieTab: 100,
  scaledDown: true,
  midnightHeld: true,
  serversAtMidnight: 4,
};

describe('the hijack', () => {
  it('plays TRIAGE noticing, "who are you", Rei, Lux on the defensive, Mika, then the load balancer', () => {
    expect(callSteps(HIJACK, {}).map((s) => s.id)).toEqual([
      'C5.triage.01',
      'C5.lux.who',
      'C5.triage.who',
      'C5.rei.01',
      'C5.lux.01',
      'C5.rei.build',
      'C5.lux.fine',
      'C5.mika.collapse',
      'C5.rei.02',
      'C5.rei.03',
      'C5.rei.health',
      'C5.ozzie.01',
      'C5.mika.02',
      'C5.rei.04',
    ]);
  });

  it('adds the laundry aside right after the hand-off only when the floor was cut', () => {
    const ids = callSteps(HIJACK, { laundryCut: true }).map((s) => s.id);
    expect(ids.slice(9, 13)).toEqual(['C5.rei.03', 'C5.rei.health', 'C5.rei.cut', 'C5.lux.cut']);
    expect(ids).toHaveLength(16);
  });

  it('jams the channel on the first line, lets Rei, Mika and Ozzie come through, and hands off on the load balancer', () => {
    const cues = HIJACK.filter((s) => s.cue).map((s) => [s.id, s.cue]);
    expect(cues).toEqual([
      ['C5.triage.01', 'static'],
      ['C5.rei.01', 'resolve'],
      ['C5.mika.collapse', 'resolve'],
      ['C5.rei.03', 'handoff'],
      ['C5.ozzie.01', 'resolve'],
    ]);
  });

  it('has the chat react to the hack, the crew and "load balancer, what\'s that?"', () => {
    const chat = HIJACK.flatMap((s) => s.chat ?? []);
    expect(chat).toContain('C5.chat.hack');
    expect(LINES['C5.chat.hack'].text).toBe('did someone just hack the stream??');
    expect(LINES['C5.chat.lb'].text).toBe("load balancer? what's that??");
    expect(LINES['C5.chat.hair'].text).toBe('ok but her hair is SO cool');
    expect(LINES['C5.chat.trust'].text).toBe("lux don't trust them");
  });

  it('keeps every line on the comms band: barks, none of them a scene', () => {
    expect(HIJACK.filter((s) => LINES[s.id].kind !== 'bark').map((s) => s.id)).toEqual([]);
  });
});

describe('every call line fits the call panel', () => {
  it('in three lines: 66 characters at most, the longest one 64', () => {
    const ids = [
      ...HIJACK,
      ...BANTER.flat(),
      ...endingCall({ ...BEST, banner: 'pay', ozzieTab: 300, midnightHeld: false }),
    ].map((s) => s.id);
    const longest = Math.max(...ids.map((id) => LINES[id].text.length));
    expect(longest).toBe(64);
  });
});

describe('stepCall', () => {
  it('sends the first line at once when the band is free, and waits while it is busy', () => {
    const s0 = startCall('hijack', callSteps(HIJACK, {}));
    const a = stepCall(s0, FREE, 10);
    expect(a.play?.id).toBe('C5.triage.01');
    expect(a.state.next).toBe(1);
    const b = stepCall(a.state, BUSY, 11);
    expect(b.play).toBe(null);
    expect(b.state.next).toBe(1);
  });

  it("posts the line's chat reactions a beat after it, one beat apart", () => {
    const s0 = startCall('hijack', [{ id: 'C5.rei.03', chat: ['C5.chat.lb', 'C5.chat.lb2'] }]);
    const a = stepCall(s0, FREE, 0);
    expect(a.state.chat).toEqual([
      { id: 'C5.chat.lb', at: CHAT_BEAT },
      { id: 'C5.chat.lb2', at: 2 * CHAT_BEAT },
    ]);
    const b = stepCall(a.state, BUSY, CHAT_BEAT);
    expect(b.chat).toEqual(['C5.chat.lb']);
    const c = stepCall(b.state, BUSY, 2 * CHAT_BEAT);
    expect(c.chat).toEqual(['C5.chat.lb2']);
  });

  it('leaves a breath between two speakers before the next line', () => {
    const s0 = startCall('banter', BANTER[0]);
    const a = stepCall(s0, FREE, 0);
    const busy = stepCall(a.state, BUSY, 2);
    const freeNow = stepCall(busy.state, FREE, 4);
    expect(freeNow.play).toBe(null);
    const later = stepCall(freeNow.state, FREE, 4 + LINE_GAP);
    expect(later.play?.id).toBe('C5.ozzie.band');
  });

  it('is done once the last line has finished and every reaction has landed', () => {
    const s0 = startCall('banter', [{ id: 'C5.rei.who', chat: ['C5.chat.goodguys'] }]);
    const a = stepCall(s0, FREE, 0);
    const b = stepCall(a.state, FREE, 0.5);
    expect(b.done).toBe(false);
    const c = stepCall(b.state, FREE, CHAT_BEAT);
    expect(c.chat).toEqual(['C5.chat.goodguys']);
    expect(c.done).toBe(true);
  });
});

describe('the banter in the quiet stretch', () => {
  const quiet = {
    now: C.c5 + 20,
    crewIn: true,
    running: true,
    calmFor: 10,
    bandFreeFor: 10,
    coaching: false,
  };

  it('starts when the crew are in, the clock runs, nothing drops and the band has been quiet', () => {
    expect(banterDue(quiet)).toBe(true);
  });

  it('waits while the hijack call plays or the build is still short', () => {
    expect(banterDue({ ...quiet, crewIn: false })).toBe(false);
    expect(banterDue({ ...quiet, running: false })).toBe(false);
  });

  it('gives way to drops, the coach and any line on the band', () => {
    expect(banterDue({ ...quiet, calmFor: 2.9 })).toBe(false);
    expect(banterDue({ ...quiet, coaching: true })).toBe(false);
    expect(banterDue({ ...quiet, bandFreeFor: 3.9 })).toBe(false);
  });

  it('keeps clear of the midnight forecast and the last half minute', () => {
    expect(banterDue({ ...quiet, now: C.c6 - 22 })).toBe(false);
    expect(banterDue({ ...quiet, now: C.c6 - 22.1 })).toBe(true);
    expect(banterDue({ ...quiet, now: C.c6 + 17.9 })).toBe(false);
    expect(banterDue({ ...quiet, now: C.c6 + 18 })).toBe(true);
    expect(banterDue({ ...quiet, now: MIDNIGHT - 32 })).toBe(false);
    expect(banterDue({ ...quiet, now: MIDNIGHT - 32.1 })).toBe(true);
  });

  it('tells who the crew are first, and the health check in the fourth exchange', () => {
    expect(BANTER.map((x) => x[0].id)).toEqual([
      'C5.triage.band',
      'C5.mika.watched',
      'C5.ozzie.roles',
      'C5.triage.pings',
      'C5.rei.wire',
      'C5.ozzie.solace',
    ]);
    expect(LINES['C5.mika.health'].text).toBe(
      'Health checks. A server goes dark, it gets skipped. No drama.',
    );
  });
});

describe('the sign-off', () => {
  it('grades, invites Lux to the arcade, and ends on TRIAGE saving the stream', () => {
    expect(endingCall(BEST).map((s) => s.id)).toEqual([
      'C8.rei.ack',
      'C8.rei.sizing.good',
      'C8.rei.invite',
      'C8.rei.leagues',
      'C8.rei.end',
      'C8.lux.invite',
      'C8.triage.going',
      'C8.triage.end',
    ]);
    expect(LINES['C8.rei.invite'].text).toBe("We've been following you for a while, Lux.");
    expect(LINES['C8.rei.leagues'].text).toBe("You're ready for the big leagues.");
  });

  it("calls out the Solace money and Ozzie's tab before the invitation when they cost", () => {
    const ids = endingCall({ ...BEST, banner: 'pay', ozzieTab: 230 }).map((s) => s.id);
    expect(ids.slice(0, 6)).toEqual([
      'C8.rei.ack',
      'C8.rei.sizing.good',
      'C8.rei.banner.pay',
      'C8.rei.debt',
      'C8.ozzie.debt',
      'C8.rei.invite',
    ]);
  });

  it('has the chat lose it over the arcade', () => {
    const rei = endingCall(BEST).find((s) => s.id === 'C8.rei.end');
    expect(rei?.chat).toEqual(['C8.chat.arcade', 'C8.chat.invite']);
  });
});

describe('the static on the call panel', () => {
  it('jams in a quarter second', () => {
    expect(noiseLevel('static', 0)).toBe(0);
    expect(noiseLevel('static', 0.25)).toBe(0.9);
    expect(noiseLevel('static', 5)).toBe(0.9);
  });

  it('bursts as a face comes through, then eases to a crackle', () => {
    expect(noiseLevel('resolve', 0.2)).toBe(1);
    expect(noiseLevel('resolve', 0.45 + 0.4)).toBeCloseTo(0.675, 6);
    expect(noiseLevel('resolve', 3)).toBe(0.35);
  });

  it('clears at the hand-off', () => {
    expect(noiseLevel('clear', 0)).toBe(0.35);
    expect(noiseLevel('clear', 0.6)).toBeCloseTo(0.175, 6);
    expect(noiseLevel('clear', 1.2)).toBe(0);
    expect(noiseLevel(null, 0)).toBe(0);
  });

  it('hides the face under a jam and lets it through a crackle', () => {
    expect(faceThrough(0.9)).toBe(0.12);
    expect(faceThrough(0.35)).toBeCloseTo(0.79, 6);
    expect(faceThrough(0)).toBe(1);
  });
});
