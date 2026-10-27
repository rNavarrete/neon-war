// The parts tray: three cards Session 0 uses (scrap server, overclock kit, load balancer) and the
// rest of the component catalog shown locked. Pure, so the tray's contents and layout are tested
// in node.

import { BROWNOUT } from '../../sim/brownout';
import type { Box } from './layout';

export type TrayId = 'server' | 'overclock' | 'balancer';

export interface TrayCard extends Box {
  readonly id: string;
  readonly label: string;
  /** Texture key drawn on the card. */
  readonly art: string;
  readonly locked: boolean;
  /** True for the three cards Session 0 can use; false for the catalog shown locked. */
  readonly main: boolean;
}

/** Every catalog part in public/art/parts/ that Session 0 doesn't use: always shown locked. */
export const LOCKED_KINDS: readonly string[] = [
  'gateway',
  'database',
  'auth',
  'autoscaler',
  'backup',
  'cache',
  'cdn',
  'dns',
  'event-stream',
  'failover-switch',
  'firewall',
  'kv-store',
  'logging',
  'monitoring',
  'object-storage',
  'power-supply',
  'queue',
  'rate-limiter',
  'search-index',
  'worker',
];

const MAIN_W = 100;
const MAIN_H = 135;
const MINI_W = 40;
const MINI_H = 72;

/** The tray's cards with their place in game space. The balancer unlocks once the crew gives it. */
export function trayCards(balancerUnlocked: boolean): TrayCard[] {
  const main: TrayCard[] = [
    {
      id: 'server',
      label: `SERVER ${BROWNOUT.server.cost}`,
      art: 'server',
      locked: false,
      main: true,
      x: 625,
      y: 958,
      w: MAIN_W,
      h: MAIN_H,
    },
    {
      id: 'overclock',
      label: `OVERCLOCK ${BROWNOUT.overclock.cost}`,
      art: 'overclock-kit',
      locked: false,
      main: true,
      x: 737,
      y: 958,
      w: MAIN_W,
      h: MAIN_H,
    },
    {
      id: 'balancer',
      label: 'BALANCER',
      art: 'balancer',
      locked: !balancerUnlocked,
      main: true,
      x: 849,
      y: 958,
      w: MAIN_W,
      h: MAIN_H,
    },
  ];
  const locked = LOCKED_KINDS.map((kind, i): TrayCard => ({
    id: kind,
    label: kind.replace(/-/g, ' '),
    art: `part-${kind}`,
    locked: true,
    main: false,
    x: 935 + (i % 10) * 44,
    y: i < 10 ? 940 : 1020,
    w: MINI_W,
    h: MINI_H,
  }));
  return [...main, ...locked];
}

/** Why a locked card can't be used, to show near the pointer. */
export function lockedReason(id: string): string {
  return id === 'balancer'
    ? "the crew hasn't given you a load balancer"
    : `no ${id.replace(/-/g, ' ')} in Session 0`;
}
