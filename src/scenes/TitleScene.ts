import Phaser from 'phaser';
import { startSession } from '../game/flow';
import { settings } from '../game/settings';
import { line } from '../strings';
import { FrameClock } from '../story/view';
import { provideTestState } from '../testHook';
import { seededRandom } from './hud/chat';
import { SCENES } from './keys';
import { CYAN, MAGENTA, UI_FONT, type ShellButton, addButton, addPanel, preloadButtons } from './shellUi';
import {
  ART,
  BEAMS,
  type Box,
  type Burst,
  FIREWORK,
  HERO,
  RAIN,
  type Streak,
  beamAngle,
  burstAlpha,
  fallStreak,
  igniteBurst,
  logoDips,
  seedRain,
  sparkAt,
} from './titleFx';

const W = 1920;
const H = 1080;

const CREDITS = [
  "Lux's story & design by Rolando Navarrete",
  'Art: gpt-image-2',
  'Music: Suno',
  'Effects: ElevenLabs',
  'Built with Phaser',
].join('\n\n');

/** The logo, subtitle and menu sit in the empty sky left of Lux (Rolando's pick, 30 Oct 2026: title A). */
const LOGO = { x: 640, y: 300, scale: 0.6 } as const;
const SUBTITLE_Y = 530;
const MENU = { y: 660, xs: [330, 640, 950], scale: 0.55 } as const;
const MAX_BURSTS = 4;

/** What the browser tests read about the title (only with ?test). */
export interface TitleTestState {
  /** The background art's key. */
  art: string;
  /** Where Lux and TRIAGE stand, and the logo's and the menu's boxes, in game px. */
  hero: Box;
  logo: Box;
  menu: Box;
  /** Rain streaks drawn this frame. */
  rainDrawn: number;
  /** The searchlights' angles this frame, degrees. */
  beams: number[];
  /** Fireworks burst since the title opened. */
  bursts: number;
  /** True while the logo's neon dips. */
  logoDip: boolean;
}

declare module '../testHook' {
  interface TestSections {
    title: TitleTestState;
  }
}

// Title screen: Lux and TRIAGE on a rooftop looking at the towers, the logo in the sky beside them,
// rain falling, searchlights sweeping and New Year's fireworks over the city.
export class TitleScene extends Phaser.Scene {
  ready = false;
  creditsOpen = false;
  private menu: ShellButton[] = [];
  private credits: Phaser.GameObjects.GameObject[] = [];
  private logo: Phaser.GameObjects.Image | null = null;
  private rainG: Phaser.GameObjects.Graphics | null = null;
  private beamG: Phaser.GameObjects.Graphics | null = null;
  private fireG: Phaser.GameObjects.Graphics | null = null;
  private streaks: Streak[] = [];
  private bursts: Burst[] = [];
  private rand = seededRandom(20261231);
  private t = 0;
  private nextBurst = 0.6;
  private burstCount = 0;
  private rainDrawn = 0;
  private dip = false;
  private readonly spark = { dx: 0, dy: 0 };
  private frames = new FrameClock();

  constructor() {
    super(SCENES.title);
  }

  preload(): void {
    this.load.image('title:rooftop', 'art/bg/title-rooftop.webp');
    this.load.image('title:logo', 'art/ui/logo.webp');
    preloadButtons(this);
  }

  create(): void {
    this.ready = false;
    this.creditsOpen = false;
    this.t = 0;
    this.nextBurst = 0.6;
    this.burstCount = 0;
    this.rand = seededRandom(20261231);
    this.frames = new FrameClock();

    // Drawn to cover the frame: 1.25x, centred, so 100 px of the art's top and bottom fall outside.
    this.add.image(W / 2, H / 2, 'title:rooftop').setScale(ART.scale);
    // Searchlights behind the rain, added light so they read as beams in the wet air.
    this.beamG = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.fireG = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    // A soft shade behind the logo and menu so the words read over the city lights.
    const shade = this.add.graphics();
    shade.fillGradientStyle(0x05070f, 0x05070f, 0x05070f, 0x05070f, 0.45, 0, 0.45, 0);
    shade.fillRect(0, 0, 1300, H);

    this.logo = this.add.image(LOGO.x, LOGO.y, 'title:logo').setScale(LOGO.scale);
    this.add
      .text(LOGO.x, SUBTITLE_Y, line('C8.title'), { fontFamily: UI_FONT, fontSize: '40px', color: MAGENTA })
      .setOrigin(0.5)
      .setShadow(0, 0, '#ff3fa4', 12, false, true);

    this.rainG = this.add.graphics();
    this.streaks = seedRain(RAIN.count, W, H, this.rand);
    this.bursts = Array.from({ length: MAX_BURSTS }, () => ({ x: 0, y: 0, age: 0, color: 0, live: false }));

    this.menu = [
      addButton(this, 'start', MENU.xs[0], MENU.y, 'START', () => startSession(this), MENU.scale),
      addButton(
        this,
        'settings',
        MENU.xs[1],
        MENU.y,
        'SETTINGS',
        () => {
          this.scene.pause();
          this.scene.launch(SCENES.settings, { from: SCENES.title });
        },
        MENU.scale,
      ),
      addButton(this, 'credits', MENU.xs[2], MENU.y, 'CREDITS', () => this.showCredits(true), MENU.scale),
    ];

    this.credits = this.buildCredits();
    this.showCredits(false);
    provideTestState('title', () => this.snapshot());
    this.ready = true;
  }

  update(time: number): void {
    // Real seconds between frames (capped at 0.25 s), like the story scenes.
    const dt = this.frames.step(time);
    this.t += dt;
    const reduce = settings().reduceFlicker;
    this.drawBeams();
    this.drawRain(dt);
    this.drawFireworks(dt, reduce);
    this.dip = logoDips(this.t, reduce);
    this.logo?.setAlpha(this.dip ? 0.55 : 1);
  }

  private drawBeams(): void {
    const g = this.beamG!;
    g.clear();
    for (const b of BEAMS) {
      const a = Phaser.Math.DegToRad(beamAngle(b, this.t));
      const ex = b.x + Math.cos(a) * b.len;
      const ey = b.y + Math.sin(a) * b.len;
      const nx = -Math.sin(a) * b.spread;
      const ny = Math.cos(a) * b.spread;
      g.fillStyle(0x9fd8ff, 0.07).fillTriangle(b.x, b.y, ex + nx, ey + ny, ex - nx, ey - ny);
      g.fillStyle(0xcfeaff, 0.06).fillTriangle(
        b.x,
        b.y,
        ex + nx * 0.35,
        ey + ny * 0.35,
        ex - nx * 0.35,
        ey - ny * 0.35,
      );
    }
  }

  private drawRain(dt: number): void {
    const g = this.rainG!;
    g.clear();
    g.lineStyle(1.5, 0xbcd6ff, 0.28);
    let n = 0;
    for (const s of this.streaks) {
      fallStreak(s, dt, W, H, this.rand);
      g.lineBetween(s.x, s.y, s.x - RAIN.dx, s.y - RAIN.dy);
      n++;
    }
    this.rainDrawn = n;
  }

  private drawFireworks(dt: number, reduce: boolean): void {
    const g = this.fireG!;
    g.clear();
    this.nextBurst -= dt;
    if (this.nextBurst <= 0) {
      const free = this.bursts.find((b) => !b.live);
      if (free) {
        igniteBurst(free, this.rand);
        this.burstCount++;
      }
      this.nextBurst = FIREWORK.gapMin + this.rand() * FIREWORK.gapSpread;
    }
    for (const b of this.bursts) {
      if (!b.live) continue;
      b.age += dt;
      if (b.age >= FIREWORK.life) {
        b.live = false;
        continue;
      }
      // Reduce flicker keeps the fireworks but drops their opening flash.
      const alpha = reduce ? Math.min(0.6, burstAlpha(b.age)) : burstAlpha(b.age);
      g.fillStyle(b.color, alpha);
      for (let i = 0; i < FIREWORK.sparks; i++) {
        sparkAt(i, b.age, this.spark);
        g.fillCircle(b.x + this.spark.dx, b.y + this.spark.dy, 2.2);
      }
    }
  }

  private snapshot(): TitleTestState {
    const lw = (this.logo?.width ?? 0) * LOGO.scale;
    const lh = (this.logo?.height ?? 0) * LOGO.scale;
    const bw = (this.menu[0]?.image.width ?? 0) * MENU.scale;
    const bh = (this.menu[0]?.image.height ?? 0) * MENU.scale;
    return {
      art: 'bg/title-rooftop',
      hero: { ...HERO },
      logo: { x: LOGO.x - lw / 2, y: LOGO.y - lh / 2, w: lw, h: lh },
      menu: { x: MENU.xs[0] - bw / 2, y: MENU.y - bh / 2, w: MENU.xs[2] - MENU.xs[0] + bw, h: bh },
      rainDrawn: this.rainDrawn,
      beams: BEAMS.map((b) => beamAngle(b, this.t)),
      bursts: this.burstCount,
      logoDip: this.dip,
    };
  }

  private buildCredits(): Phaser.GameObjects.GameObject[] {
    const before = this.children.list.length;
    addPanel(this, W / 2, 560, 900, 620);
    this.add
      .text(W / 2, 320, 'CREDITS', { fontFamily: UI_FONT, fontSize: '44px', color: MAGENTA })
      .setOrigin(0.5);
    this.add
      .text(W / 2, 540, CREDITS, { fontFamily: UI_FONT, fontSize: '30px', color: CYAN, align: 'center' })
      .setOrigin(0.5);
    addButton(this, 'creditsClose', W / 2, 770, 'CLOSE', () => this.showCredits(false), 0.5, 30);
    return this.children.list.slice(before);
  }

  private showCredits(open: boolean): void {
    this.creditsOpen = open;
    for (const obj of this.credits)
      (obj as unknown as Phaser.GameObjects.Components.Visible).setVisible(open);
    for (const b of this.menu) b.setVisible(!open);
  }
}
