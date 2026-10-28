// The registry of views on the Live screen: one line per zone, naming the LiveView class that draws
// it. A lane replaces its own line (and only that line) when its view lands; until then the zone
// shows a PlaceholderView. The feed and the inventory are the board's, drawn by BoardScene, and have
// no line here. The HUD scene creates every entry in this order (docs/LIVE.md).

import { AlertView } from '../hud/AlertView';
import { ChartView } from '../hud/ChartView';
import { CommsView } from '../hud/CommsView';
import { DeckView } from '../hud/DeckView';
import { GaugeView } from '../hud/GaugeView';
import { MapView } from '../hud/MapView';
import { ClockView, TitleView } from '../hud/TitleView';
import type { ZoneId } from './layout';
import { type LiveView, PlaceholderView } from './view';

export interface RegistryEntry {
  readonly zone: ZoneId;
  /** The lane that owns the zone. */
  readonly lane: 'board' | 'gauges' | 'comms' | 'chat' | 'luxcam' | 'learning';
  /** Make a fresh view for the zone; called once per HUD scene start. */
  readonly make: () => LiveView;
}

export const REGISTRY: readonly RegistryEntry[] = [
  { zone: 'title', lane: 'gauges', make: () => new TitleView() },
  { zone: 'alert', lane: 'gauges', make: () => new AlertView() },
  { zone: 'clock', lane: 'gauges', make: () => new ClockView() },
  { zone: 'map', lane: 'gauges', make: () => new MapView() },
  { zone: 'cam', lane: 'luxcam', make: () => new PlaceholderView('cam') },
  { zone: 'gauge', lane: 'gauges', make: () => new GaugeView() },
  { zone: 'scope', lane: 'gauges', make: () => new ChartView() },
  { zone: 'comms', lane: 'comms', make: () => new CommsView() },
  { zone: 'deck', lane: 'gauges', make: () => new DeckView() },
  { zone: 'chat', lane: 'chat', make: () => new PlaceholderView('chat') },
];

/** The zones the registry draws, in registry order. */
export const REGISTRY_ZONES: readonly ZoneId[] = REGISTRY.map((e) => e.zone);

/** The zones the board draws itself, so they never get a registry line. */
export const BOARD_ZONES: readonly ZoneId[] = ['feed', 'inventory'];

/** A fresh view for every registry line, in registry order. */
export function createViews(): LiveView[] {
  return REGISTRY.map((e) => e.make());
}

/** The zones among `views` still drawn by a PlaceholderView, in order. */
export function placeholderZones(views: readonly LiveView[]): ZoneId[] {
  return views.filter((v) => v instanceof PlaceholderView).map((v) => v.zone);
}
