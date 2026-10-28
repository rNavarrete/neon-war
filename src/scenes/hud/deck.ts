// The deck's three keys (ZONES.deck, right of the room-left bar) as pure rules: 1 REGROUP, 2 CUT 3F
// and 3 SET (decision D3), each clicked or pressed on the keyboard. What each key shows comes from
// the Frame: Regroup from the sim's charge (hidden until Mika hands it over, ready, active while its
// 10 s of slow time drains, spent), the laundry cut from the district surge's window (hidden, ready,
// done), SET from the open dial question (dim, ready). Every key is ignored while the job card or the
// Solace banner is open, while the board is held (the pause menu, a story scene, a failure) or
// paused; the dial card and the sizing prompt never block a key, since key 3 is how they are SET.
//
// Pure: no Phaser; time comes in as `clock` (the HUD clock), the steady flag as an argument.

import { BROWNOUT } from '../../sim/brownout';
import { type Rect } from '../live/layout';
import { type DialAsk, dialQuestionOpen } from './jobCard';
import { LABELS } from './labels';
import { BOTTOM, KEY } from './layout';

const C = BROWNOUT.challenges;

export type RegroupKey = 'hidden' | 'ready' | 'active' | 'spent';
export type CutKey = 'hidden' | 'ready' | 'done';
export type SetKey = 'dim' | 'ready';

/** The keys by their digit. */
export type KeyName = 'one' | 'two' | 'three';
export const KEY_NAMES: readonly KeyName[] = ['one', 'two', 'three'];

/** What the deck reads (a Frame fits, plus the HUD's own card flag). */
export interface DeckInput {
  readonly now: number;
  /** The board is held still: a card, a story scene, the pause menu, or a failure waiting. */
  readonly paused: boolean;
  readonly regroup: { readonly charges: number; readonly handedOver: boolean; readonly left: number };
  readonly laundryCut: { readonly at: number } | null;
  readonly laundryCutAvailable: boolean;
  readonly banner: unknown;
  readonly notes: { readonly estimate: number | null; readonly sizing: number | null };
  /** The C1 job card is open (it also holds the board). */
  readonly cardOpen: boolean;
}

export interface DeckState {
  regroup: RegroupKey;
  cut: CutKey;
  set: SetKey;
  /** Share of Regroup's slow time left, 1 to 0, for the draining ring; 0 unless active. */
  ring: number;
  /** The ready Regroup key's alpha: it pulses in play, steady (1) under reduce flicker. */
  pulse: number;
  /** Keys are ignored now (a card or the banner is open, or the board is held). */
  blocked: boolean;
  /** The Solace banner is up. */
  bannerOpen: boolean;
  /** A dial question is open (the dial card shows). */
  dialOpen: boolean;
}

/** The Solace banner is up in C2 until it is answered, never over the job card (HudScene's rule). */
export function bannerOpen(now: number, banner: unknown, cardOpen: boolean): boolean {
  return now >= C.c2 && now < C.c3 && banner === null && !cardOpen;
}

/** Regroup's key from the sim's charge. */
export function regroupKey(r: DeckInput['regroup']): RegroupKey {
  if (!r.handedOver) return 'hidden';
  if (r.left > 0) return 'active';
  return r.charges > 0 ? 'ready' : 'spent';
}

/** The laundry cut's key: ready in the surge window, done once cut (until the crew's tail), else hidden. */
export function cutKey(now: number, available: boolean, cut: { readonly at: number } | null): CutKey {
  if (cut) return now < C.c5 ? 'done' : 'hidden';
  return available ? 'ready' : 'hidden';
}

/** How fast the ready Regroup key pulses, in radians per HUD second (about 1 Hz). */
export const PULSE_RATE = 6;

/** The ready key's pulse: 0.75 to 1 in play, steady at 1 under reduce flicker (or the ?test lite flag). */
export function pulseAt(clock: number, steady: boolean): number {
  return steady ? 1 : 0.75 + 0.25 * Math.sin(clock * PULSE_RATE);
}

export function emptyDeck(): DeckState {
  return {
    regroup: 'hidden',
    cut: 'hidden',
    set: 'dim',
    ring: 0,
    pulse: 1,
    blocked: true,
    bannerOpen: false,
    dialOpen: false,
  };
}

/** The ask the dial question reads, one object reused (no allocation per frame). */
const ask: { now: number; cardOpen: boolean; estimate: number | null; sizing: number | null } = {
  now: 0,
  cardOpen: false,
  estimate: null,
  sizing: null,
};

/** Bring `out` in line with this frame, in place. */
export function stepDeck(out: DeckState, f: DeckInput, clock: number, steady: boolean): DeckState {
  out.regroup = regroupKey(f.regroup);
  out.cut = cutKey(f.now, f.laundryCutAvailable, f.laundryCut);
  ask.now = f.now;
  ask.cardOpen = f.cardOpen;
  ask.estimate = f.notes.estimate;
  ask.sizing = f.notes.sizing;
  out.dialOpen = dialQuestionOpen(ask as DialAsk);
  out.set = out.dialOpen ? 'ready' : 'dim';
  out.ring = out.regroup === 'active' ? Math.min(1, f.regroup.left / BROWNOUT.regroup.seconds) : 0;
  out.pulse = out.regroup === 'ready' ? pulseAt(clock, steady) : 1;
  out.bannerOpen = bannerOpen(f.now, f.banner, f.cardOpen);
  out.blocked = f.paused || f.cardOpen || out.bannerOpen;
  return out;
}

/** A fresh state for one frame (tests; the view refills one in place). */
export function deckState(f: DeckInput, clock: number, steady: boolean): DeckState {
  return stepDeck(emptyDeck(), f, clock, steady);
}

/** Whether a key is lit: ready (pressable). */
export function keyLit(s: DeckState, key: KeyName): boolean {
  if (key === 'one') return s.regroup === 'ready';
  if (key === 'two') return s.cut === 'ready';
  return s.set === 'ready';
}

/**
 * Whether a press of `key` (a click or its digit) acts now: it is lit and nothing blocks the deck.
 * The run's own action may still refuse (it keeps the rules); this is the deck's guard in front of it.
 */
export function pressActs(s: DeckState, key: KeyName): boolean {
  return !s.blocked && keyLit(s, key);
}

/** A key's alpha as drawn: lit keys at full (Regroup's pulse), done keys half, the rest dim. */
export function keyAlpha(s: DeckState, key: KeyName): number {
  if (key === 'one') {
    if (s.regroup === 'ready') return s.pulse;
    if (s.regroup === 'active') return 1;
    return s.regroup === 'spent' ? 0.45 : 0.3;
  }
  if (key === 'two') return s.cut === 'ready' ? 1 : s.cut === 'done' ? 0.45 : 0.3;
  return s.set === 'ready' ? 1 : 0.3;
}

/** What a key's cap says: its digit and its word (labels.ts), split at the first space. */
export function keyWords(key: KeyName): { digit: string; word: string } {
  const label = LABELS.deck.keys[key];
  const at = label.indexOf(' ');
  return { digit: label.slice(0, at), word: label.slice(at + 1) };
}

/** The done cut's word on its key: "CUT · -40/s" (the share of the block it took off). */
export function cutDoneWord(): string {
  return `CUT · -${BROWNOUT.demand.laundryCut}/s`;
}

/** The keys' boxes in game pixels, 80x64 centred at (1272, 1022), (1360, 1022), (1448, 1022). */
export function keyRects(): Record<KeyName, Rect> {
  const box = (i: number): Rect => {
    const k = BOTTOM.keys[i];
    return { x: k.x - k.w / 2, y: k.y - k.h / 2, w: k.w, h: k.h };
  };
  return { one: box(KEY.regroup), two: box(KEY.cut), three: box(KEY.set) };
}

/** Where the CUT 3F tooltip sits: right-aligned to the keys, in the strip above them inside the deck. */
export function tooltipAt(deck: Rect): { x: number; y: number } {
  const r = keyRects();
  return { x: r.three.x + r.three.w, y: deck.y + 2 };
}
