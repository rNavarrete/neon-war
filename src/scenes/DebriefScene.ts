import Phaser from 'phaser';
import { defaultDebriefResults, quitToTitle } from '../game/flow';
import { run } from '../game/run';
import { settings } from '../game/settings';
import { type DebriefResults, debriefLines, resultRows } from '../story/debrief';
import { LABELS } from '../story/labels';
import { parseBold, runWords } from '../story/markup';
import { type DebriefStep, playSfx, setLiveView, stopSfx, storyState } from '../story/state';
import { FrameClock, H, VnView, W, cover, fileKey, preloadView } from '../story/view';
import { LINES, type LineId, line } from '../strings';
import { SCENES } from './keys';

const BG = 'art/bg/bedroom-midnight.webp';
const BOOK = 'art/story/night-book-page.webp';

const TERMS: readonly LineId[] = ['C8.terms.sizing', 'C8.terms.scaling', 'C8.terms.failure'];
const CARD: readonly LineId[] = [
  'C8.card.1',
  'C8.card.2',
  'C8.card.3',
  'C8.card.4',
  'C8.card.5',
  'C8.card.6',
  'C8.card.7',
];

const FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';
const HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

/** One beat of the debrief: an optional line in the text box and what appears with it. */
interface Beat {
  step: DebriefStep;
  line?: LineId;
  enter?: () => void;
}

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
 * The debrief (C8): goggles up, back in Lux's room with fireworks outside. Rei grades the night
 * beside the raw results, the terms are named in three groups, the interview-version card, Night
 * Book page 1 ("Demand decides the design") and the title card. A click finishes or advances.
 */
export class DebriefScene extends Phaser.Scene {
  ready = false;
  private results: DebriefResults = defaultDebriefResults();
  private beats: Beat[] = [];
  private beat = -1;
  private view!: VnView;
  private stepLayer: Phaser.GameObjects.Container | null = null;
  private fx!: Phaser.GameObjects.Container;
  private flash!: Phaser.GameObjects.Rectangle;
  private sparks: Spark[] = [];
  private nextBurst = 0;
  private frames = new FrameClock();

  constructor() {
    super(SCENES.debrief);
  }

  init(data: { results?: DebriefResults }): void {
    this.results = data.results ?? defaultDebriefResults();
    this.ready = false;
  }

  preload(): void {
    preloadView(this, [BG, BOOK]);
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
      onClick: () => this.click(),
      onSkip: () => {},
    });
    setLiveView(this.view);

    const grades = debriefLines(this.results);
    this.beats = [
      ...grades.map((id, i): Beat => ({
        step: 'grades',
        line: id,
        enter: i === 0 ? () => this.drawResults() : undefined,
      })),
      { step: 'terms', enter: () => this.drawTerms() },
      { step: 'interview', line: 'C8.rei.interview', enter: () => this.drawCard() },
      { step: 'book', line: 'C8.book.open', enter: () => this.drawBook() },
      { step: 'book', line: 'C8.triage.end', enter: () => this.writePage() },
      { step: 'book', line: 'C8.rei.end' },
      { step: 'title', enter: () => this.drawTitle() },
    ];
    this.beat = -1;

    Object.assign(storyState, {
      active: true,
      scriptId: 'C8',
      chat: [],
      backdrop: BG,
      look: 'vn',
      fireworks: { bursts: 0, flashes: 0 },
      debrief: { step: 'grades', results: this.results, terms: [], card: [], page: null, title: null },
    });
    playSfx('rain-loop', true);
    playSfx('fireworks');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      stopSfx('rain-loop');
      storyState.active = false;
      storyState.debrief = null;
      setLiveView(null);
    });

    this.advance();
    this.ready = true;
  }

  update(time: number): void {
    const dt = this.frames.step(time);
    this.view.update(dt);
    this.updateFireworks(dt);
  }

  private click(): void {
    if (!this.view.typingDone) {
      this.view.finishTyping();
      return;
    }
    if (this.beat >= this.beats.length - 1) {
      quitToTitle(this);
      return;
    }
    this.advance();
  }

  private advance(): void {
    const b = this.beats[++this.beat];
    const prev = this.beat > 0 ? this.beats[this.beat - 1] : null;
    if (prev && prev.step !== b.step && prev.step !== 'book') {
      this.stepLayer?.destroy();
      this.stepLayer = null;
    }
    if (storyState.debrief) storyState.debrief.step = b.step;
    b.enter?.();
    if (b.line) this.view.say(b.line);
    else this.view.hideBox();
  }

  private layer(depth: number): Phaser.GameObjects.Container {
    this.stepLayer = this.add.container(0, 0).setDepth(depth);
    return this.stepLayer;
  }

  /** The raw result per category, beside Rei as she grades. */
  private drawResults(): void {
    const c = this.layer(12);
    c.add(this.add.rectangle(90, 110, 620, 560, 0x0b0820, 0.86).setOrigin(0).setStrokeStyle(2, 0x2de2e6));
    c.add(
      this.add.text(130, 140, LABELS.results, {
        fontFamily: FONT,
        fontSize: '40px',
        fontStyle: 'bold',
        color: '#2de2e6',
      }),
    );
    resultRows(this.results).forEach((r, i) => {
      const y = 230 + i * 70;
      c.add(this.add.text(130, y, r.label, { fontFamily: FONT, fontSize: '28px', color: '#cfc8e8' }));
      c.add(
        this.add
          .text(670, y, r.value, { fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: '#ffd27a' })
          .setOrigin(1, 0),
      );
    });
  }

  /** The terms, named in three groups, with each term in bold. */
  private drawTerms(): void {
    const c = this.layer(25);
    const colW = 560;
    const terms: { group: string; bold: string[] }[] = [];
    TERMS.forEach((id, i) => {
      const x = 80 + i * (colW + 40);
      c.add(this.add.rectangle(x, 120, colW, 800, 0x0b0820, 0.9).setOrigin(0).setStrokeStyle(2, 0xff4fd8));
      const group = LINES[id].speaker;
      c.add(
        this.add.text(x + 30, 150, group, {
          fontFamily: FONT,
          fontSize: '42px',
          fontStyle: 'bold',
          color: '#ff4fd8',
        }),
      );
      const runs = parseBold(line(id));
      this.layoutRuns(c, runs, x + 30, 230, colW - 60);
      terms.push({ group, bold: runs.filter((r) => r.bold).map((r) => r.text) });
    });
    if (storyState.debrief) storyState.debrief.terms = terms;
  }

  /** Lay bold and plain runs out word by word, wrapping at `width`. */
  private layoutRuns(
    c: Phaser.GameObjects.Container,
    runs: ReturnType<typeof parseBold>,
    left: number,
    top: number,
    width: number,
  ): void {
    const lineH = 40;
    const space = 8;
    let x = left;
    let y = top;
    for (const w of runWords(runs)) {
      const word = w.text.trim();
      const gap = w.text.length > w.text.trimEnd().length ? space : 0;
      if (!word) {
        if (x > left) x += space;
        continue;
      }
      const t = this.add.text(x, y, word, {
        fontFamily: FONT,
        fontSize: '28px',
        fontStyle: w.bold ? 'bold' : '',
        color: w.bold ? '#ffd27a' : '#e8e4f5',
      });
      if (x > left && x + t.width > left + width) {
        x = left;
        y += lineH;
        t.setPosition(x, y);
      }
      x += t.width + gap;
      c.add(t);
    }
  }

  /** The interview-version card. */
  private drawCard(): void {
    const c = this.layer(12);
    c.add(this.add.rectangle(90, 70, 860, 720, 0xf3ecd8, 0.97).setOrigin(0).setStrokeStyle(4, 0x2de2e6));
    c.add(
      this.add.text(130, 100, LABELS.card, {
        fontFamily: FONT,
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#7a3cff',
      }),
    );
    const title = this.add.text(130, 140, line('C8.card.title'), {
      fontFamily: FONT,
      fontSize: '34px',
      fontStyle: 'bold',
      color: '#1b1430',
      wordWrap: { width: 780 },
    });
    c.add(title);
    let y = 150 + title.height + 20;
    for (const id of CARD) {
      const t = this.add.text(130, y, line(id), {
        fontFamily: FONT,
        fontSize: '26px',
        color: '#241c3c',
        wordWrap: { width: 780 },
        lineSpacing: 4,
      });
      c.add(t);
      y += t.height + 14;
    }
    if (storyState.debrief) storyState.debrief.card = [line('C8.card.title'), ...CARD.map(line)];
  }

  /** Night Book page 1: the book opens over the room. */
  private drawBook(): void {
    const c = this.layer(12);
    const book = this.add.image(W / 2, H / 2, fileKey(BOOK)).setAlpha(0);
    c.add(book);
    this.tweens.add({ targets: book, alpha: 1, duration: 700 });
  }

  /** The lesson, handwritten on the blank right-hand page. */
  private writePage(): void {
    const c = this.stepLayer ?? this.layer(12);
    const text = this.add
      .text(1050, 170, line('C8.book.page1'), {
        fontFamily: HAND,
        fontSize: '38px',
        color: '#2a2440',
        wordWrap: { width: 520 },
        lineSpacing: 14,
      })
      .setAngle(-1.5)
      .setAlpha(0);
    c.add(text);
    this.tweens.add({ targets: text, alpha: 1, duration: 900 });
    if (storyState.debrief) storyState.debrief.page = line('C8.book.page1');
  }

  /** The title card, with the fireworks over it. */
  private drawTitle(): void {
    const c = this.layer(50);
    c.add(this.add.rectangle(0, 0, W, H, 0x05070f, 0.94).setOrigin(0));
    const title = this.add
      .text(W / 2, H / 2, line('C8.title'), {
        fontFamily: FONT,
        fontSize: '96px',
        fontStyle: 'bold',
        color: '#2de2e6',
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#ff4fd8', 24, true, true)
      .setAlpha(0);
    c.add(title);
    this.tweens.add({ targets: title, alpha: 1, duration: 1200 });
    this.fx.setDepth(55);
    playSfx('fireworks');
    if (storyState.debrief) storyState.debrief.title = line('C8.title');
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
