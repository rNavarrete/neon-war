import Phaser from 'phaser';
import {
  type Link,
  type MissionState,
  type Placeable,
  MISSION,
  connect,
  createMission,
  decommission,
  disconnect,
  linkKey,
  nodeById,
  place,
  step,
} from '../sim/mission';
import { type Mood, newLines } from '../sim/partner';
import {
  LOCKED_TRAY,
  LOCKED_X0,
  NODE_POS,
  RETRY_POS,
  SLOT_POS,
  SLOT_SNAP,
  TRAY_POS,
  type Point,
  midpoint,
  pointAt,
  route,
  routeLength,
} from './layout';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

const DT = 0.1;
const CYAN = 0x2de2e6;
const AMBER = 0xffb347;
const RED = 0xff3b5c;
const VIOLET = 0xb26bff;
const INK = 0x05070f;
const PACKET_SPEED = 240; // game px per second
const REQ_PER_PACKET = 8;
const MAX_PACKETS = 260;

const LABEL: Record<string, string> = {
  gateway: 'GATEWAY',
  balancer: 'LOAD BAL',
  server: 'APP SRV',
  cache: 'CACHE',
  database: 'DATABASE',
};

const KIND_COLOR: Record<string, number> = {
  gateway: CYAN,
  balancer: CYAN,
  server: CYAN,
  cache: VIOLET,
  database: RED,
};

interface Packet {
  rect: Phaser.GameObjects.Rectangle;
  link: string;
  d: number;
}

const text = (size: number, color = '#cfe9ff') => ({
  fontFamily: 'monospace',
  fontSize: `${size}px`,
  color,
});

// The Viral Signal board: draws the simulation and turns mouse input into sim actions.
// Rules never live here; every change goes through src/sim/mission.ts.
export class BoardScene extends Phaser.Scene {
  ready = false;
  speed = 1;
  state: MissionState = createMission();
  said = new Set<string>();
  mood: Mood = 'focused';
  line = '';
  toast: string | null = null;

  private acc = 0;
  private wiringFrom: string | null = null;
  private linkGfx!: Phaser.GameObjects.Graphics;
  private wireGfx!: Phaser.GameObjects.Graphics;
  private dbGlow!: Phaser.GameObjects.Arc;
  private db!: Phaser.GameObjects.Image;
  private dbBar!: Phaser.GameObjects.Rectangle;
  private backlogGfx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private trustBar!: Phaser.GameObjects.Rectangle;
  private dialogue!: Phaser.GameObjects.Text;
  private moodTag!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private nodeViews = new Map<string, Phaser.GameObjects.Container>();
  private cutHandles = new Map<string, Phaser.GameObjects.Arc>();
  private packets: Packet[] = [];
  private spawnAcc = new Map<string, number>();
  private overlay: Phaser.GameObjects.Container | null = null;
  private trayHome = new Map<Phaser.GameObjects.Container, Point>();

  constructor() {
    super('board');
  }

  init(): void {
    this.ready = false;
    this.state = createMission();
    this.said = new Set();
    this.mood = 'focused';
    this.line = '';
    this.toast = null;
    this.acc = 0;
    this.wiringFrom = null;
    this.nodeViews = new Map();
    this.cutHandles = new Map();
    this.packets = [];
    this.spawnAcc = new Map();
    this.overlay = null;
    this.trayHome = new Map();
  }

  preload(): void {
    this.load.image('board-bg', 'art/board-bg.png');
    this.load.image('db-hot', 'art/db-hot.png');
    this.load.image('partner-worried', 'art/partner-worried.png');
  }

  create(): void {
    const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'board-bg');
    bg.setScale(Math.max(GAME_WIDTH / bg.width, GAME_HEIGHT / bg.height));
    bg.setInteractive().on('pointerdown', () => this.cancelWiring());

    this.drawSlots();
    this.linkGfx = this.add.graphics();
    this.wireGfx = this.add.graphics();
    this.backlogGfx = this.add.graphics();

    const [dx, dy] = NODE_POS.database;
    this.dbGlow = this.add.circle(dx, dy, 78, RED, 0).setBlendMode(Phaser.BlendModes.ADD);
    this.db = this.add.image(dx, dy, 'db-hot').setScale(0.8);
    this.db.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.clickNode('database'));
    this.add.rectangle(dx + 92, dy, 14, 164, INK, 0.85).setStrokeStyle(1, CYAN);
    this.dbBar = this.add.rectangle(dx + 92, dy + 80, 10, 0, CYAN).setOrigin(0.5, 0);
    this.add.text(dx + 92, dy + 96, 'LOAD', text(11)).setOrigin(0.5, 0);

    // Packets travel under the components, so labels stay readable.
    for (let i = 0; i < MAX_PACKETS; i++) {
      const rect = this.add.rectangle(0, 0, 6, 6, AMBER).setVisible(false);
      this.packets.push({ rect, link: '', d: 0 });
    }
    for (const id of ['gateway', 'balancer', 'server-1', 'server-2']) this.addNodeView(id);

    this.drawPartner();
    this.drawHud();
    this.drawTray();

    this.toastText = this.add
      .text(GAME_WIDTH / 2, 560, '', text(15, '#ffb347'))
      .setOrigin(0.5)
      .setBackgroundColor('#05070fcc')
      .setPadding(8, 4);
    this.toastText.setVisible(false);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.drawWire(p));

    this.sayNewLines();
    this.redraw();
    this.ready = true;
  }

  update(_time: number, delta: number): void {
    if (this.state.outcome === 'playing') {
      this.acc += (delta / 1000) * this.speed;
      while (this.acc >= DT && this.state.outcome === 'playing') {
        this.state = step(this.state, DT);
        this.acc -= DT;
      }
      this.sayNewLines();
      if (this.state.outcome !== 'playing') this.showOutcome();
    }
    this.movePackets((delta / 1000) * Math.min(this.speed, 4));
    this.redraw();
  }

  // ---------- actions ----------

  private apply(result: ReturnType<typeof place>): boolean {
    if (!result.ok) {
      this.showToast(result.reason);
      return false;
    }
    this.state = result.state;
    this.syncNodeViews();
    this.sayNewLines();
    return true;
  }

  private clickNode(id: string): void {
    if (this.state.outcome !== 'playing') return;
    if (this.wiringFrom === null) {
      this.wiringFrom = id;
      return;
    }
    const from = this.wiringFrom;
    this.cancelWiring();
    if (from !== id) this.apply(connect(this.state, from, id));
  }

  private cancelWiring(): void {
    this.wiringFrom = null;
    this.wireGfx.clear();
  }

  private showToast(message: string): void {
    this.toast = message;
    this.toastText.setText(message).setVisible(true);
    this.time.delayedCall(1800, () => {
      if (this.toastText.text === message) this.toastText.setVisible(false);
    });
  }

  private sayNewLines(): void {
    const lines = newLines(this.state, this.said);
    for (const l of lines) this.said.add(l.id);
    const last = lines.at(-1);
    if (last) {
      this.mood = last.mood;
      this.line = last.text;
      this.dialogue.setText(last.text);
      this.moodTag.setText(last.mood.toUpperCase());
    }
  }

  // ---------- building views ----------

  private positionOf(id: string): Point {
    const node = nodeById(this.state, id);
    if (node?.slot) return SLOT_POS[node.slot];
    return NODE_POS[id] ?? [0, 0];
  }

  private addNodeView(id: string): void {
    const node = nodeById(this.state, id);
    if (!node) return;
    const [x, y] = this.positionOf(id);
    const color = KIND_COLOR[node.kind];
    const box = this.add.rectangle(0, 0, 84, 52, INK, 0.92).setStrokeStyle(2, color);
    const label = this.add.text(0, 0, LABEL[node.kind], text(12)).setOrigin(0.5);
    const view = this.add.container(x, y, [box, label]);
    box.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.clickNode(id));
    if (node.slot) {
      const remove = this.add
        .text(36, -30, '×', text(18, '#ff3b5c'))
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      remove.on('pointerdown', () => this.apply(decommission(this.state, id)));
      view.add(remove);
    }
    this.nodeViews.set(id, view);
  }

  private syncNodeViews(): void {
    const live = new Set(this.state.nodes.map((n) => n.id));
    for (const [id, view] of this.nodeViews) {
      if (!live.has(id)) {
        view.destroy();
        this.nodeViews.delete(id);
      }
    }
    for (const n of this.state.nodes) {
      if (n.kind !== 'database' && !this.nodeViews.has(n.id)) this.addNodeView(n.id);
    }
  }

  private drawSlots(): void {
    const g = this.add.graphics();
    g.lineStyle(2, CYAN, 0.55);
    for (const [, [x, y]] of Object.entries(SLOT_POS)) {
      const w = 92;
      const h = 60;
      for (let i = 0; i < w; i += 10) {
        g.lineBetween(x - w / 2 + i, y - h / 2, x - w / 2 + Math.min(i + 5, w), y - h / 2);
        g.lineBetween(x - w / 2 + i, y + h / 2, x - w / 2 + Math.min(i + 5, w), y + h / 2);
      }
      for (let i = 0; i < h; i += 10) {
        g.lineBetween(x - w / 2, y - h / 2 + i, x - w / 2, y - h / 2 + Math.min(i + 5, h));
        g.lineBetween(x + w / 2, y - h / 2 + i, x + w / 2, y - h / 2 + Math.min(i + 5, h));
      }
    }
  }

  private drawTray(): void {
    this.add.rectangle(GAME_WIDTH / 2, 662, 760, 92, INK, 0.88).setStrokeStyle(2, CYAN, 0.6);
    for (const kind of ['cache', 'server'] as Placeable[]) {
      const [x, y] = TRAY_POS[kind];
      const color = kind === 'cache' ? VIOLET : CYAN;
      const card = this.add.container(x, y, [
        this.add.rectangle(0, 0, 120, 70, INK, 1).setStrokeStyle(2, color),
        this.add.text(0, -12, LABEL[kind], text(13)).setOrigin(0.5),
        this.add.text(0, 14, `${MISSION.cost[kind]} cr`, text(12, '#ffb347')).setOrigin(0.5),
      ]);
      card.setSize(120, 70).setInteractive({ useHandCursor: true, draggable: true });
      this.trayHome.set(card, [x, y]);
      card.on('drag', (_p: Phaser.Input.Pointer, dragX: number, dragY: number) =>
        card.setPosition(dragX, dragY),
      );
      card.on('dragend', () => {
        const slot = Object.entries(SLOT_POS).find(
          ([, [sx, sy]]) => Phaser.Math.Distance.Between(card.x, card.y, sx, sy) <= SLOT_SNAP,
        );
        const [hx, hy] = this.trayHome.get(card) ?? [x, y];
        card.setPosition(hx, hy);
        if (slot) this.apply(place(this.state, slot[0], kind));
      });
    }
    LOCKED_TRAY.forEach((name, i) => {
      const x = LOCKED_X0 + i * 92;
      this.add.rectangle(x, 662, 80, 70, INK, 0.7).setStrokeStyle(1, 0x3a4766);
      this.add.text(x, 650, '🔒', text(16)).setOrigin(0.5);
      this.add.text(x, 676, name, text(11, '#56627f')).setOrigin(0.5);
    });
  }

  private drawPartner(): void {
    this.add.rectangle(16, 52, 176, 180, INK, 0.9).setOrigin(0).setStrokeStyle(2, CYAN);
    const portrait = this.add.image(20, 56, 'partner-worried').setOrigin(0);
    portrait.setScale(168 / portrait.width);
    this.add.rectangle(16, 238, 300, 104, INK, 0.9).setOrigin(0).setStrokeStyle(1, CYAN, 0.7);
    this.moodTag = this.add.text(24, 244, '', text(11, '#2de2e6'));
    this.dialogue = this.add.text(24, 262, '', { ...text(14), wordWrap: { width: 284 } });
  }

  private drawHud(): void {
    this.add.rectangle(0, 0, GAME_WIDTH, 40, INK, 0.85).setOrigin(0);
    this.hud = this.add.text(210, 12, '', text(15));
    this.add.text(980, 12, 'TRUST', text(13));
    this.add.rectangle(1040, 13, 220, 14, INK, 1).setOrigin(0).setStrokeStyle(1, CYAN);
    this.trustBar = this.add.rectangle(1042, 15, 216, 10, CYAN).setOrigin(0);
  }

  private showOutcome(): void {
    const won = this.state.outcome === 'won';
    const panel = this.add
      .rectangle(GAME_WIDTH / 2, 360, 620, 300, INK, 0.94)
      .setStrokeStyle(2, won ? CYAN : RED);
    const title = this.add
      .text(GAME_WIDTH / 2, 250, won ? 'CITY RESTORED' : 'CITY LOST', text(30, won ? '#2de2e6' : '#ff3b5c'))
      .setOrigin(0.5);
    const lines = won
      ? [
          'The database was the bottleneck, not the servers.',
          'The cache answered repeat reads, so they never reached it.',
          'Another server would have sent the same load to the database.',
          'Your cache is what brought the city back.',
        ]
      : [
          'The database ran past capacity and dropped requests.',
          'Most viral traffic was the same page, read again and again.',
          'What could answer those reads before they reach it?',
        ];
    const body = this.add.text(GAME_WIDTH / 2, 290, lines.join('\n'), text(15)).setOrigin(0.5, 0);
    body.setAlign('center').setLineSpacing(6);
    const [rx, ry] = RETRY_POS;
    const retry = this.add.container(rx, ry, [
      this.add.rectangle(0, 0, 160, 44, INK, 1).setStrokeStyle(2, AMBER),
      this.add.text(0, 0, 'RETRY', text(18, '#ffb347')).setOrigin(0.5),
    ]);
    retry.setSize(160, 44).setInteractive({ useHandCursor: true });
    retry.on('pointerdown', () => this.scene.restart());
    this.overlay = this.add.container(0, 0, [panel, title, body, retry]);
  }

  // ---------- drawing ----------

  private routeFor(l: Link): Point[] {
    return route(this.positionOf(l.from), this.positionOf(l.to));
  }

  private redraw(): void {
    const s = this.state;
    this.linkGfx.clear();
    const liveKeys = new Set<string>();
    for (const l of s.links) {
      const key = linkKey(l);
      liveKeys.add(key);
      const pts = this.routeFor(l);
      const busy = (s.flow.links[key] ?? 0) > 0;
      this.linkGfx.lineStyle(6, CYAN, busy ? 0.18 : 0.08);
      this.linkGfx.strokePoints(pts.map(([x, y]) => new Phaser.Math.Vector2(x, y)));
      this.linkGfx.lineStyle(2, CYAN, busy ? 0.95 : 0.45);
      this.linkGfx.strokePoints(pts.map(([x, y]) => new Phaser.Math.Vector2(x, y)));
      if (!this.cutHandles.has(key)) {
        const [mx, my] = midpoint(pts);
        const handle = this.add.circle(mx, my, 7, INK, 1).setStrokeStyle(2, AMBER);
        handle.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
          this.apply(disconnect(this.state, l.from, l.to));
        });
        this.cutHandles.set(key, handle);
      }
    }
    for (const [key, h] of this.cutHandles) {
      if (!liveKeys.has(key)) {
        h.destroy();
        this.cutHandles.delete(key);
      }
    }

    const load = Math.min(s.dbLoad, 2);
    this.dbGlow.setFillStyle(RED, Math.min(0.55, Math.max(0, load - 0.7)));
    this.dbGlow.setScale(1 + 0.06 * Math.sin(this.time.now / 120) * (load > 1 ? 1 : 0));
    if (load < 0.9) this.db.setTint(0x8fb6ff);
    else this.db.clearTint();
    const barH = Math.round(160 * Math.min(1, load / 1.5));
    const [bx, by] = NODE_POS.database;
    this.dbBar.setSize(10, barH).setPosition(bx + 92, by + 80 - barH);
    this.dbBar.setFillStyle(load > 1 ? RED : load > 0.8 ? AMBER : CYAN);

    this.backlogGfx.clear();
    const stacked = Math.round(s.backlog / 10);
    this.backlogGfx.fillStyle(AMBER, 1);
    for (let i = 0; i < stacked; i++) {
      const [dx, dy] = NODE_POS.database;
      this.backlogGfx.fillRect(dx - 96 - (i % 4) * 9, dy + 34 - Math.floor(i / 4) * 9, 7, 7);
    }

    for (const [id, view] of this.nodeViews) {
      const box = view.list[0] as Phaser.GameObjects.Rectangle;
      const node = nodeById(s, id);
      box.setStrokeStyle(
        this.wiringFrom === id ? 4 : 2,
        this.wiringFrom === id ? AMBER : KIND_COLOR[node?.kind ?? 'server'],
      );
    }

    const errPct = s.traffic > 0 ? (100 * s.errorRate) / s.traffic : 0;
    this.hud.setText(
      `T+${s.time.toFixed(0).padStart(2, '0')}s   TRAFFIC ${s.traffic.toFixed(0)} req/s   ERRORS ${errPct.toFixed(0)}%   CREDITS ${s.credits}`,
    );
    this.trustBar.setSize(Math.round(216 * (s.trust / 100)), 10);
    this.trustBar.setFillStyle(s.trust > 50 ? CYAN : s.trust > 25 ? AMBER : RED);
  }

  private drawWire(p: Phaser.Input.Pointer): void {
    this.wireGfx.clear();
    if (this.wiringFrom === null) return;
    const pts = route(this.positionOf(this.wiringFrom), [p.worldX, p.worldY]);
    this.wireGfx.lineStyle(2, AMBER, 0.9);
    this.wireGfx.strokePoints(pts.map(([x, y]) => new Phaser.Math.Vector2(x, y)));
  }

  private movePackets(dt: number): void {
    const s = this.state;
    const routes = new Map(s.links.map((l) => [linkKey(l), this.routeFor(l)]));
    for (const [key, pts] of routes) {
      const rate = s.outcome === 'playing' ? (s.flow.links[key] ?? 0) : 0;
      let acc = (this.spawnAcc.get(key) ?? 0) + (rate / REQ_PER_PACKET) * dt;
      while (acc >= 1) {
        const free = this.packets.find((pk) => !pk.rect.visible);
        if (!free) break;
        free.link = key;
        free.d = 0;
        free.rect.setVisible(true);
        const [x, y] = pts[0];
        free.rect.setPosition(x, y);
        acc -= 1;
      }
      this.spawnAcc.set(key, Math.min(acc, 1));
    }
    for (const pk of this.packets) {
      if (!pk.rect.visible) continue;
      const pts = routes.get(pk.link);
      if (!pts) {
        pk.rect.setVisible(false);
        continue;
      }
      pk.d += PACKET_SPEED * dt;
      if (pk.d >= routeLength(pts)) {
        pk.rect.setVisible(false);
        continue;
      }
      const [x, y] = pointAt(pts, pk.d);
      pk.rect.setPosition(x, y);
    }
  }

  // ---------- test hook ----------

  /** Game-coordinate positions of everything a browser test may click or drag. */
  targets(): {
    nodes: Record<string, Point>;
    slots: Record<string, Point>;
    tray: Record<string, Point>;
    cut: Record<string, Point>;
    remove: Record<string, Point>;
    retry: Point | null;
  } {
    const nodes: Record<string, Point> = {};
    const remove: Record<string, Point> = {};
    for (const n of this.state.nodes) {
      const [x, y] = this.positionOf(n.id);
      nodes[n.id] = [x, y];
      if (n.slot) remove[n.id] = [x + 36, y - 30];
    }
    const cut: Record<string, Point> = {};
    for (const l of this.state.links) cut[linkKey(l)] = midpoint(this.routeFor(l));
    return {
      nodes,
      slots: { ...SLOT_POS },
      tray: { ...TRAY_POS },
      cut,
      remove,
      retry: this.overlay ? RETRY_POS : null,
    };
  }
}
