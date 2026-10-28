// The comms band's section of the read-only test hook: hud.comms (the band as drawn), beside the
// legacy hud.bark (the same ids and text as before the band replaced BarkView). Test mirror only:
// no view reads it back; chat and luxcam hear the band through bus `line` / `lineEnd`.

import type Phaser from 'phaser';
import type { LineTag } from '../../../game/bus';
import type { LineId } from '../../../strings';
import type { CommsSlot } from '../../hud/comms';
import type { PagePoint } from '../../hud/hook';
import { provideHudPart } from '../../hud/panel';
import type { Rect } from '../layout';

/** The line the band shows now. */
export interface CommsLineState {
  id: LineId;
  /** The speaker as docs/SCRIPT.md writes it ('TRIAGE (eager)'). */
  speaker: string;
  /** The nameplate ('TRIAGE', 'LUX', 'GRANDMA'). */
  name: string;
  tag: LineTag;
  text: string;
  /** Characters typed so far, and whether the whole line is out. */
  typed: number;
  typingDone: boolean;
  /** HUD clock it started and ends. */
  since: number;
  until: number;
  /** A voice clip started for it. */
  voiced: boolean;
}

export interface CommsSlotState {
  name: CommsSlot;
  /** The slot's centre and radius in page CSS pixels. */
  x: number;
  y: number;
  r: number;
  /** Lit: TRIAGE and HOUSE always, the crew once they are in (run().rescued). */
  present: boolean;
  /** The current line's speaker sits here. */
  speaking: boolean;
}

export interface CommsLogState {
  /** The three-row log shows (a 400 ms hover or a click pin). */
  open: boolean;
  pinned: boolean;
  /** The last three shown lines, newest last. */
  lines: { id: LineId; name: string; text: string }[];
  /** A point on the band to hover or click, and one outside it, in page CSS pixels. */
  band: PagePoint;
  outside: PagePoint;
  /** The replay glyph (re-requests the newest line's voice), in page CSS pixels. */
  replay: PagePoint;
  /** Ids the replay glyph re-requested, oldest first (last 12). */
  replayed: LineId[];
}

export interface CommsTestState {
  line: CommsLineState | null;
  slots: CommsSlotState[];
  queue: LineId[];
  /** Shown lines, oldest first (last 12). */
  history: LineId[];
  /** Lines dropped stale, never shown (last 12). */
  dropped: LineId[];
  log: CommsLogState;
  /** The leader line (comms-8); null until it lands. */
  leader: null;
  /** TRIAGE's mood while she speaks, else null. */
  triage: { mood: string } | null;
  /** The line's opacity (it fades over 250 ms when the band goes idle). */
  alpha: number;
  /** The band's zone, and what it draws (its display bounds), in page CSS pixels. */
  rect: Rect;
  drawn: Rect;
  /** Bus events the band emitted, oldest first (last 24): 'line:<id>', 'lineEnd:<id>', 'voice:<id>'. */
  emitted: string[];
}

declare module '../../hud/hook' {
  interface HudTestState {
    /** The comms band (comms-2). */
    comms?: CommsTestState;
  }
}

/** Mirror the band as hud.comms; returns the function that takes it out again. */
export function provideCommsHook(scene: Phaser.Scene, read: () => CommsTestState): () => void {
  return provideHudPart(scene, 'comms', read);
}
