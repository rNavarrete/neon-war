import { LINES } from '../src/strings';
import type { Part } from '../src/sim/board';
import { BROWNOUT } from '../src/sim/brownout';
import {
  PLATE_NAMES,
  PLATE_STATE,
  PlateCache,
  REPLACE_LABEL,
  cardBarTone,
  partCard,
  partPlate,
  wireCard,
  wirePlate,
} from '../src/scenes/board/plate';
import { type PartTrouble, partLook } from '../src/scenes/board/view';

// The hover plates (board-8): a part's numbers and state in the script's words, never the debrief's.

const gw: Part = { id: 'gateway', kind: 'gateway', slot: null };
const db: Part = { id: 'database', kind: 'database', slot: null };
const lb: Part = { id: 'balancer', kind: 'balancer', slot: null };
const s1: Part = { id: 's', kind: 'server', slot: 's1' };
const kit: Part = { id: 'k', kind: 'server', slot: 's2', boost: 2 };
const none: PartTrouble = { dead: [], dark: [], dips: [], overload: {} };

/** The bold terms of the C8.terms lines (docs/SCRIPT.md, via LINES): what only the debrief may name. */
function debriefTerms(): string[] {
  const terms: string[] = [];
  for (const id of ['C8.terms.sizing', 'C8.terms.scaling', 'C8.terms.failure'] as const) {
    for (const m of LINES[id].text.matchAll(/\*\*(.+?)\*\*/g)) {
      // "Redundancy, N+1" is two terms.
      for (const part of m[1].split(',')) terms.push(part.trim());
    }
  }
  return terms;
}

/** Every plate a part can show: each kind in every state it can be in. */
function everyPlate(): string[] {
  const out: string[] = [];
  const looks: [Part, ReturnType<typeof partLook>, boolean][] = [];
  for (const p of [gw, db, lb, s1, kit]) {
    for (const load of [0, 30, 59, 75, 250]) {
      looks.push([p, partLook(p, load, [], {}, 10, none), false]);
      looks.push([p, partLook(p, load, [], {}, 10, none), true]);
      looks.push([p, partLook(p, load, [], {}, 10, { ...none, overload: { [p.id]: 3 } }), false]);
    }
    looks.push([p, partLook(p, 0, [p.id], { [p.id]: 12 }, 10, none), false]);
    looks.push([p, partLook(p, 50, [p.id], {}, 10, { ...none, dead: [p.id] }), false]);
    looks.push([
      p,
      partLook(p, 50, [p.id], {}, 10, {
        ...none,
        dark: [p.id],
        dips: [{ id: 'surge', part: p.id, warnAt: 0, darkAt: 5, endsAt: 25 }],
      }),
      false,
    ]);
    looks.push([p, partLook(p, 50, [p.id], {}, 10, none), false]);
  }
  for (const [p, look, skipped] of looks) out.push(partPlate(p, look, skipped));
  for (const a of [gw, lb, s1]) for (const b of [lb, s1, db]) out.push(wirePlate(a, b, 45));
  out.push(REPLACE_LABEL, ...Object.values(PLATE_NAMES), ...Object.values(PLATE_STATE));
  return out;
}

describe('hover plates (board-8)', () => {
  it('a server shows its numbers and its state', () => {
    const p = partPlate(s1, partLook(s1, 45, [], {}, 10, none), false);
    expect(p).toMatch(/^SERVER · 45\/60 req\/s · 75%/);
    expect(p).toMatch(/running/);
    expect(p.split('\n')).toHaveLength(3);
  });

  it('says what is wrong in the tags’ words: DIES IN, UNFED, BOOTING, DARK, DEAD, SKIPPED', () => {
    const hot = partPlate(s1, partLook(s1, 90, [], {}, 10, { ...none, overload: { s: 3 } }), false);
    expect(hot).toMatch(/DIES IN 5 s/);
    expect(hot).toMatch(/90\/60 req\/s · 150%/);
    expect(partPlate(s1, partLook(s1, 0, [], {}, 10, none), false)).toMatch(/UNFED · nothing feeds it/);
    expect(partPlate(s1, partLook(s1, 0, ['s'], { s: 12 }, 10, none), false)).toMatch(/BOOTING 2\.0 s/);
    const dark = partLook(s1, 50, ['s'], {}, 10, {
      ...none,
      dark: ['s'],
      dips: [{ id: 'surge', part: 's', warnAt: 0, darkAt: 5, endsAt: 25 }],
    });
    expect(partPlate(s1, dark, false)).toMatch(/DARK · power back in 15 s/);
    const dead = partPlate(s1, partLook(s1, 50, ['s'], {}, 10, { ...none, dead: ['s'] }), false);
    expect(dead).toMatch(/DEAD/);
    expect(dead).toMatch(/REPLACE/);
    expect(partPlate(s1, partLook(s1, 30, [], {}, 10, none), true)).toMatch(/SKIPPED/);
  });

  it('a scaled-up server and the other parts say what they are from labels.ts', () => {
    expect(partPlate(kit, partLook(kit, 30, [], {}, 10, none), false)).toMatch(/30\/120 req\/s/);
    expect(partPlate(kit, partLook(kit, 30, [], {}, 10, none), false)).toMatch(/SCALE UP/);
    expect(partPlate(gw, partLook(gw, 30, [], {}, 10, none), false)).toMatch(
      /^GATEWAY · 30 req\/s coming in/,
    );
    expect(partPlate(db, partLook(db, 30, [], {}, 10, none), false)).toMatch(
      new RegExp(`^DATABASE · 30/${BROWNOUT.database.capacity} req/s`),
    );
    expect(partPlate(lb, partLook(lb, 30, [], {}, 10, none), false)).toMatch(/^LOAD BALANCER/);
    expect(wirePlate(gw, s1, 29.6)).toMatch(/^WIRE · 30 req\/s\nGATEWAY to SERVER/);
  });

  it('names the parts and their numbers in the real terms, never the old crew words', () => {
    // Rolando, 29 Oct 2026: keep the system-design terms intact on screen.
    expect(debriefTerms().length).toBeGreaterThan(10);
    const plates = everyPlate();
    for (const plate of plates) expect(plate, plate).not.toMatch(/\bsplitter\b|\bbox\b|a second|bigger box/i);
    const all = plates.join('\n');
    for (const term of ['LOAD BALANCER', 'capacity', 'req/s', 'health check']) expect(all).toContain(term);
  });

  it('the cache re-sets the text only when what the plate shows changes', () => {
    const c = new PlateCache();
    expect(c.part('s', s1, partLook(s1, 45, [], {}, 10, none), false)).toBe(true);
    const text = c.text;
    expect(c.part('s', s1, partLook(s1, 45.2, [], {}, 10, none), false)).toBe(false);
    expect(c.text).toBe(text);
    expect(c.part('s', s1, partLook(s1, 46, [], {}, 10, none), false)).toBe(true);
    expect(c.wire('gateway>s', gw, s1, 46)).toBe(true);
    expect(c.wire('gateway>s', gw, s1, 46.1)).toBe(false);
    c.reset();
    expect(c.wire('gateway>s', gw, s1, 46.1)).toBe(false);
  });
});

// The hover card (Rolando, 30 Oct 2026, "a better pop up", option A): the name once on the title
// bar, a coloured state chip, one big number, the load bar, and one plain sentence.
describe('the hover card', () => {
  it('shows the gateway as its name, a RUNNING chip, the number coming in and one sentence', () => {
    const c = partCard(gw, partLook(gw, 30, [], {}, 10, none), false);
    expect(c).toMatchObject({
      name: 'GATEWAY',
      chip: 'RUNNING',
      tone: 'ok',
      big: '30',
      bar: null,
      detail: null,
    });
    expect(c.unit).toBe('req/s coming in');
    // The name is not repeated in the sentence, and the fragments read as sentences.
    expect(c.about).not.toContain('GATEWAY');
    expect(c.about).toMatch(/^[A-Z].*\.$/);
    expect(c.about).not.toContain(' · ');
  });

  it('gives a server its load out of its capacity and a bar that turns amber from 85% and red over 100%', () => {
    const cap = BROWNOUT.server.capacity;
    const c = partCard(s1, partLook(s1, 45, [], {}, 10, none), false);
    expect(c.big).toBe('45');
    expect(c.unit).toBe(`of ${cap} req/s · ${Math.round((45 / cap) * 100)}%`);
    expect(c.bar).toBeCloseTo(45 / cap);
    expect(cardBarTone(0.5)).toBe('info');
    expect(cardBarTone(0.85)).toBe('warn');
    expect(cardBarTone(1.2)).toBe('bad');
  });

  it('colours the chip by state and says the state in words when it is not simply running', () => {
    const over = partCard(s1, partLook(s1, 250, [], {}, 10, { ...none, overload: { [s1.id]: 3 } }), false);
    expect(over.tone).toBe('bad');
    expect(over.detail).not.toBeNull();
    const booting = partCard(s1, partLook(s1, 0, [s1.id], { [s1.id]: 12 }, 10, none), false);
    expect(booting).toMatchObject({ tone: 'info', chip: 'BOOTING', bar: null });
    expect(booting.detail).toContain('BOOTING');
    const dead = partCard(s1, partLook(s1, 50, [s1.id], {}, 10, { ...none, dead: [s1.id] }), false);
    expect(dead).toMatchObject({ tone: 'bad', chip: 'DEAD' });
    const skipped = partCard(s1, partLook(s1, 30, [], {}, 10, none), true);
    expect(skipped).toMatchObject({ tone: 'warn', chip: 'SKIPPED' });
  });

  it('gives a wire its rate and its ends, no chip', () => {
    expect(wireCard(gw, s1, 45)).toMatchObject({
      name: 'WIRE',
      chip: null,
      big: '45',
      detail: 'GATEWAY to SERVER',
    });
  });

  it('uses the real terms, never the old nicknames', () => {
    for (const p of [gw, db, lb, s1, kit])
      for (const load of [0, 45, 250])
        for (const skipped of [false, true]) {
          const c = partCard(p, partLook(p, load, [], {}, 10, none), skipped);
          const words = [c.name, c.chip ?? '', c.big, c.unit, c.detail ?? '', c.about].join(' ');
          expect(words, words).not.toMatch(/\bsplitter\b|\bbox\b|a second|bigger box/i);
        }
  });
});
