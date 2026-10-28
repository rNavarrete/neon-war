// The inventory row (the tray of parts): the three cards Session 0 uses (scrap server, overclock
// kit, load balancer) with their prices and how many the player could use now, and a padlocked
// drawer of the rest of the component catalog. Pure, so the row's contents, layout and counts are
// tested in node; src/scenes/board/InventoryView.ts draws it.

import type { Part } from '../../sim/board';
import { BROWNOUT } from '../../sim/brownout';
import { LINES } from '../../strings';
import { LABELS } from '../hud/labels';
import { type Box, SERVER_PADS } from './layout';

export type TrayId = 'server' | 'overclock' | 'balancer';

export interface TrayCard extends Box {
  readonly id: string;
  /** What the test hook calls the card. Never drawn for a drawer mini. */
  readonly label: string;
  /** The title drawn on the card, or null for a drawer mini (drawn without its kind's name). */
  readonly name: string | null;
  /** Credits it costs (0 for the crew's gift), or null for a drawer mini. */
  readonly price: number | null;
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

/** A main card, and where the three sit: left of the drawer, centred on the row. */
export const CARD_SIZE = { w: 120, h: 140 } as const;
const CARD_X = [530, 660, 790] as const;
const CARD_Y = 882;
/** A drawer mini, and the drawer's two rows of ten. */
export const MINI_SIZE = { w: 40, h: 72 } as const;
/** The drawer of locked minis: its left and right edges and its two rows' centres. */
export const DRAWER = { left: 935, right: 1495, rows: [848, 922] as const, perRow: 10 } as const;
const MINI_PITCH = (DRAWER.right - DRAWER.left - MINI_SIZE.w) / (DRAWER.perRow - 1);

/** The inventory row's cards with their place in game space. The balancer unlocks once the crew gives it. */
export function trayCards(balancerUnlocked: boolean): TrayCard[] {
  const card = (
    i: number,
    id: TrayId,
    name: string,
    label: string,
    price: number,
    art: string,
    locked: boolean,
  ): TrayCard => ({
    id,
    label,
    name,
    price,
    art,
    locked,
    main: true,
    x: CARD_X[i],
    y: CARD_Y,
    ...CARD_SIZE,
  });
  const main: TrayCard[] = [
    card(0, 'server', 'SERVER', `SERVER ${BROWNOUT.server.cost}`, BROWNOUT.server.cost, 'server', false),
    card(
      1,
      'overclock',
      'OVERCLOCK',
      `OVERCLOCK ${BROWNOUT.overclock.cost}`,
      BROWNOUT.overclock.cost,
      'overclock-kit',
      false,
    ),
    // The card prints the crew's word for it: the real name waits for the debrief (C8.terms).
    card(
      2,
      'balancer',
      LABELS.plates.names.balancer,
      'BALANCER',
      BROWNOUT.loadBalancer.cost,
      'balancer',
      !balancerUnlocked,
    ),
  ];
  const locked = LOCKED_KINDS.map((kind, i): TrayCard => ({
    id: kind,
    label: kind.replace(/-/g, ' '),
    name: null,
    price: null,
    art: `part-${kind}`,
    locked: true,
    main: false,
    x: DRAWER.left + MINI_SIZE.w / 2 + (i % DRAWER.perRow) * MINI_PITCH,
    y: DRAWER.rows[Math.floor(i / DRAWER.perRow)],
    ...MINI_SIZE,
  }));
  return [...main, ...locked];
}

/** The price chip on a main card: credits, or a gift when it costs nothing. */
export function priceChip(price: number): string {
  return price > 0 ? `${price} cr` : 'GIFT';
}

/**
 * What a click on a drawer mini says: in the crew's own words, not for tonight. The kinds in the
 * drawer are later sessions' parts, so their names stay off the screen until then.
 */
export const NOT_TONIGHT: string = LINES['C2.lux.ignore'].text;

/** Why a locked card can't be used, to show near the pointer. */
export function lockedReason(id: string): string {
  return id === 'balancer' ? LABELS.inventory.splitterLocked : NOT_TONIGHT;
}

/** How many of each main card the player could use right now. */
export interface InventoryCounts {
  server: number;
  overclock: number;
  balancer: number;
}

/** Every server slot on the board. */
const SERVER_SLOT_COUNT = Object.keys(SERVER_PADS).length;

/**
 * How many of each card the player could use now, from the credits, the parts on the board and
 * whether the crew has given the balancer. Counts are derived, never stock: servers are what the
 * credits buy, up to the free slots; kits are what the credits buy, up to the servers without one;
 * the balancer is 1 once given and until it is racked. Never below 0.
 */
export function inventoryCounts(
  credits: number,
  parts: readonly Pick<Part, 'kind' | 'boost'>[],
  balancerGiven: boolean,
): InventoryCounts {
  let servers = 0;
  let unkitted = 0;
  let racked = false;
  for (const p of parts) {
    if (p.kind === 'server') {
      servers++;
      if (p.boost === undefined) unkitted++;
    } else if (p.kind === 'balancer') {
      racked = true;
    }
  }
  const afford = (cost: number) => (cost > 0 ? Math.max(0, Math.floor(credits / cost)) : Infinity);
  return {
    server: Math.max(0, Math.min(afford(BROWNOUT.server.cost), SERVER_SLOT_COUNT - servers)),
    overclock: Math.max(0, Math.min(afford(BROWNOUT.overclock.cost), unkitted)),
    balancer: balancerGiven && !racked ? 1 : 0,
  };
}
