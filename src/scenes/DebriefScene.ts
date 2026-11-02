import Phaser from 'phaser';
import { defaultDebriefResults, quitToTitle } from '../game/flow';
import { run } from '../game/run';
import { settings } from '../game/settings';
import { type DebriefResults, resultRows } from '../story/debrief';
import { LABELS } from '../story/labels';
import { playSfx, setLiveView, stopSfx, storyState } from '../story/state';
import { FrameClock, H, VnView, W, cover, fileKey, preloadView, toPage } from '../story/view';
import { line } from '../strings';
import { SCENES } from './keys';

const BG = 'art/bg/bedroom-midnight.webp';

const FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';

/** A click on the scorecard ends the session, but not one landing this soon after it opens (the
 * tail of a click in the HUD). */
const END_GUARD_SECONDS = 0.8;
/** The card's top and the end-the-session hint near its foot (game px). */
const CARD_Y = 180;
const END_Y = 800;

const SPARKS = 96;
const SPARKS_PER_BURST = 24;
const FIREWORK_COLORS = [0xff4fd8, 0x2de2e6, 0xffd27a, 0xff6b3d, 0xb6ff5c];

interface Spark {
  dot: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
  life: number;
}

/**
 * The end of Session 0 (C8): one screen, then the title (Rolando, 2 Nov 2026: the Night Book's pages of
 * terms and the interview answer were too much text and too much clicking). Goggles up, back in Lux's
 * room with fireworks outside and nobody in it; Rei's grade and the arcade invitation were already said
 * over the HUD (src/scenes/hud/crewCalls.ts). The card holds the night's raw results, the one lesson
 * and the words the night taught; one click ends the session. Results screens in games celebrate, show
 * how the player did at a glance and get out of the way; this one does that in a single beat.
 */
export class DebriefScene extends Phaser.Scene {
  ready = false;
  private results: DebriefResults = defaultDebriefResults();
  private view!: VnView;
  private fx!: Phaser.GameObjects.Container;
  private flash!: Phaser.GameObjects.Rectangle;
  private sparks: Spark[] = [];
  private nextBurst = 0;
  private frames = new FrameClock();
  /** Seconds the scorecard has been up. */
  private shownFor = 0;
  private ending = false;

  constructor() {
    super(SCENES.debrief);
  }

  init(data: { results?: DebriefResults }): void {
    this.results = data.results ?? defaultDebriefResults();
    this.ready = false;
    this.shownFor = 0;
    this.ending = false;
  }

  preload(): void {
    preloadView(this, [BG]);
  }

  create(): void {
    run().hold('scene');
    this.frames = new FrameClock();
    cover(this, fileKey(BG));
    this.add.rectangle(0, 0, W, H, 0x05070f, 0.3).setOrigin(0);
    this.createFireworks();

    this.view = new VnView(this, {
      where: 'room',
      chat: false,
      skippable: false,
      // Nobody stands in Lux's room: the crew were only ever on her comms.
      figures: false,
      onClick: () => this.click(),
      onSkip: () => {},
    });
    setLiveView(this.view);

    Object.assign(storyState, {
      active: true,
      scriptId: 'C8',
      chat: [],
      backdrop: BG,
      look: 'vn',
      fireworks: { bursts: 0, flashes: 0 },
      debrief: {
        step: 'scorecard',
        results: this.results,
        title: line('C8.title'),
        lesson: line('C8.lesson'),
        words: line('C8.lesson.words'),
        end: toPage(this, W / 2, END_Y),
      },
    });
    playSfx('rain-loop', true);
    playSfx('fireworks');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      stopSfx('rain-loop');
      storyState.active = false;
      storyState.debrief = null;
      setLiveView(null);
    });

    this.view.hideBox();
    this.drawScorecard();
    this.ready = true;
  }

  update(time: number): void {
    const dt = this.frames.step(time);
    this.shownFor += dt;
    this.view.update(dt);
    this.updateFireworks(dt);
  }

  /** One click ends the session and goes back to the title. */
  private click(): void {
    if (this.ending || this.shownFor < END_GUARD_SECONDS) return;
    this.ending = true;
    quitToTitle(this);
  }

  /**
   * The one screen: the session's name, how midnight went, the raw result per category, then the
   * lesson in one line and the words for what the player built. No letter grades; Rei already graded
   * it over the HUD.
   */
  private drawScorecard(): void {
    const c = this.add.container(0, 0).setDepth(12);
    const w = 1000;
    const x = (W - w) / 2;
    const y = CARD_Y;
    const h = END_Y + 44 - y;
    c.add(this.add.rectangle(x, y, w, h, 0x0b0820, 0.9).setOrigin(0).setStrokeStyle(3, 0x2de2e6));
    c.add(this.add.rectangle(x, y, w, 8, 0xff4fd8, 0.9).setOrigin(0));
    c.add(
      this.add.text(x + 50, y + 34, LABELS.complete, {
        fontFamily: FONT,
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#ff4fd8',
      }),
    );
    c.add(
      this.add
        .text(x + 50, y + 66, line('C8.title'), {
          fontFamily: FONT,
          fontSize: '54px',
          fontStyle: 'bold',
          color: '#2de2e6',
        })
        .setShadow(0, 0, '#ff4fd8', 18, true, true),
    );
    const held = this.results.midnightHeld;
    c.add(
      this.add.text(
        x + 50,
        y + 146,
        held ? LABELS.midnightHeld(this.results.serversAtMidnight) : LABELS.midnightDark,
        { fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: held ? '#b6ff5c' : '#ff6b6b' },
      ),
    );
    // The results in two columns of three, so the card stays one glance tall.
    const rows = resultRows(this.results);
    const colW = (w - 100 - 40) / 2;
    rows.forEach((r, i) => {
      const col = i < 3 ? 0 : 1;
      const rx = x + 50 + col * (colW + 40);
      const ry = y + 216 + (i % 3) * 52;
      c.add(this.add.rectangle(rx, ry - 10, colW, 1, 0x2de2e6, 0.25).setOrigin(0));
      c.add(this.add.text(rx, ry, r.label, { fontFamily: FONT, fontSize: '24px', color: '#cfc8e8' }));
      c.add(
        this.add
          .text(rx + colW, ry, r.value, {
            fontFamily: FONT,
            fontSize: '26px',
            fontStyle: 'bold',
            color: '#ffd27a',
          })
          .setOrigin(1, 0),
      );
    });
    // The lesson: one line, and the words for what she built.
    const ly = y + 390;
    c.add(this.add.rectangle(x + 40, ly - 16, w - 80, 1, 0xff4fd8, 0.5).setOrigin(0));
    c.add(
      this.add.text(x + 50, ly, LABELS.lesson, {
        fontFamily: FONT,
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#ff4fd8',
      }),
    );
    const lesson = this.add.text(x + 50, ly + 36, line('C8.lesson'), {
      fontFamily: FONT,
      fontSize: '34px',
      fontStyle: 'bold',
      color: '#ffffff',
      wordWrap: { width: w - 100 },
      lineSpacing: 4,
    });
    c.add(lesson);
    c.add(
      this.add.text(x + 50, lesson.y + lesson.height + 22, line('C8.lesson.words'), {
        fontFamily: FONT,
        fontSize: '24px',
        color: '#ffd27a',
        wordWrap: { width: w - 100 },
      }),
    );
    c.add(
      this.add
        .text(W / 2, END_Y, LABELS.endSession, { fontFamily: FONT, fontSize: '22px', color: '#9a95ad' })
        .setOrigin(0.5),
    );
  }

  // --- Fireworks outside the window: pooled sparks; flashes only without reduce flicker -----------

  private createFireworks(): void {
    this.fx = this.add.container(0, 0).setDepth(1);
    this.flash = this.add.rectangle(0, 0, W, H, 0xfff4e0, 0).setOrigin(0);
    this.fx.add(this.flash);
    this.sparks = Array.from({ length: SPARKS }, () => {
      const dot = this.add.circle(0, 0, 4, 0xffffff).setVisible(false);
      this.fx.add(dot);
      return { dot, vx: 0, vy: 0, life: 0 };
    });
    this.nextBurst = 0.3;
  }

  private updateFireworks(dt: number): void {
    this.nextBurst -= dt;
    if (this.nextBurst <= 0) {
      this.burst();
      this.nextBurst = 1.1 + Math.random();
    }
    if (this.flash.alpha > 0) this.flash.setAlpha(Math.max(0, this.flash.alpha - dt * 0.6));
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vy += 90 * dt;
      s.dot.x += s.vx * dt;
      s.dot.y += s.vy * dt;
      s.dot.setAlpha(Math.max(0, s.life / 1.4));
      if (s.life <= 0) s.dot.setVisible(false);
    }
  }

  private burst(): void {
    const x = 200 + Math.random() * (W - 400);
    const y = 120 + Math.random() * 300;
    const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    let n = 0;
    for (const s of this.sparks) {
      if (s.life > 0) continue;
      const a = (n / SPARKS_PER_BURST) * Math.PI * 2;
      const v = 120 + Math.random() * 140;
      s.vx = Math.cos(a) * v;
      s.vy = Math.sin(a) * v;
      s.life = 1.4;
      s.dot.setPosition(x, y).setFillStyle(color).setAlpha(1).setVisible(true);
      if (++n >= SPARKS_PER_BURST) break;
    }
    storyState.fireworks.bursts++;
    if (!settings().reduceFlicker) {
      this.flash.setAlpha(0.16);
      storyState.fireworks.flashes++;
    }
  }
}
