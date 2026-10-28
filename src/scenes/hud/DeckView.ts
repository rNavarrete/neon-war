// The deck (ZONES.deck) as a Live screen view: the room-left bar on the left (HeadroomView), and the
// three keys on the right (1 REGROUP, 2 CUT 3F, 3 SET), which the HUD scene still draws until
// gauges-8 moves them here. hud.headroom mirrors the bar for tests.
//
// Phaser is a type here only, so the registry and its node tests can import this file.

import type Phaser from 'phaser';
import type { Frame } from '../../game/frame';
import type { LiveBudget, LiveClock, LiveHost, LiveView } from '../live/view';
import { HeadroomView } from './HeadroomView';
import type { HeadroomColour } from './headroom';
import { provideHudPart } from './panel';

/** What the hook mirrors as hud.headroom. */
export interface HeadroomTestState {
  /** round((1 - demand / wiredCapacity) x 100); null with nothing wired. */
  pct: number | null;
  /** demand / wiredCapacity; null with nothing wired. */
  load: number | null;
  /** Req/s every live server could serve, wired or not. */
  capacity: number;
  /** Req/s the wired, online servers can serve: what the bar measures. */
  wiredCapacity: number;
  demand: number;
  state: HeadroomColour;
  /** Sim time the bar turned red, while it stays red; null otherwise. */
  redSince: number | null;
  /** Segments of room left lit, 0..30. */
  lit: number;
  /** The words on the bar now. */
  label: string;
  /** The right edge of the bar, in game x (the keys sit right of it). */
  right: number;
}

declare module './hook' {
  interface HudTestState {
    /** The room-left bar in the deck (gauges-4). */
    headroom?: HeadroomTestState;
  }
}

export class DeckView implements LiveView {
  readonly zone = 'deck' as const;
  readonly budget: LiveBudget = { ...HeadroomView.budget };
  readonly headroom = new HeadroomView();
  private off: (() => void)[] = [];

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.headroom.create(scene, host.rect, host.bus);
    this.off.push(provideHudPart(scene, 'headroom', () => this.snapshot()));
  }

  update(frame: Frame, clock: LiveClock): void {
    this.headroom.update(frame, clock.now);
  }

  /** hud.headroom, built only when the hook is read. */
  snapshot(): HeadroomTestState {
    const s = this.headroom.state;
    return {
      pct: s.pct,
      load: s.load,
      capacity: s.capacity,
      wiredCapacity: s.wiredCapacity,
      demand: s.demand,
      state: s.state,
      redSince: s.redSince,
      lit: s.lit,
      label: this.headroom.labelText,
      right: this.headroom.right,
    };
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    this.headroom.shutdown();
  }
}
