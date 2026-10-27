import Phaser from 'phaser';
import {
  type StoryData,
  defaultDebriefResults,
  playDebrief,
  playRescue,
  playRewind,
  startSession,
} from '../game/flow';
import { run } from '../game/run';
import { settings } from '../game/settings';
import type { DebriefResults } from '../story/debrief';
import { LABELS } from '../story/labels';
import { SCRIPTS, type SceneScript, type ScriptStep, chatText, isChat, stepsFor } from '../story/scripts';
import { markSeen, wasSeen } from '../story/seen';
import { playSfx, setLiveView, stopSfx, storyState } from '../story/state';
import type { RewindKind } from '../story/rewind';
import { FrameClock, H, VnView, W, cover, fileKey, preloadView } from '../story/view';
import { testHookEnabled } from '../testHook';
import { SCENES } from './keys';

const EXTRA = {
  photo: 'art/story/akemi-photo.webp',
  goggles: 'art/hud/goggles-overlay.webp',
  cable: 'art/board/crew-cable.webp',
  regroup: 'art/hud/regroup-ready.webp',
} as const;

/** Seconds the rewind animation runs after the last line. */
const REWIND_SECONDS = 1.4;
const RAIN_DROPS = 90;

/**
 * Visual-novel scene player: the cold open, the rescue and the rewind screens. Lines play from the
 * scripts in src/story/scripts.ts; a click finishes the typing line or advances. Timed scenes (the
 * cold open) play on their own. The run is held while a scene is up (src/game/flow.ts does that).
 */
export class StoryScene extends Phaser.Scene {
  ready = false;
  private story: StoryData | null = null;
  private script: SceneScript = SCRIPTS.C0;
  private steps: ScriptStep[] = [];
  private next = 0;
  private elapsed = 0;
  private done = false;
  private rewinding = -1;
  private view!: VnView;
  private clock: Phaser.GameObjects.Text | null = null;
  private tracking: Phaser.GameObjects.Rectangle[] = [];
  private rain: Phaser.GameObjects.Graphics | null = null;
  private drops: { x: number; y: number; v: number }[] = [];
  private flickered = false;
  private frames = new FrameClock();

  constructor() {
    super(SCENES.story);
    if (testHookEnabled(window.location.search)) installStoryTrigger(this);
  }

  init(data: Partial<StoryData>): void {
    this.story = data.scriptId && data.onDone ? (data as StoryData) : null;
    this.ready = false;
  }

  preload(): void {
    const files = Object.values(SCRIPTS).flatMap((s) => (s.backdrop ? [s.backdrop] : []));
    preloadView(this, [...new Set(files), ...Object.values(EXTRA)]);
  }

  create(): void {
    // Started bare (`?test&scene=story`): run the session from the top, cold open first.
    if (!this.story) {
      startSession(this);
      return;
    }
    const s = (this.script = SCRIPTS[this.story.scriptId]);
    this.steps = stepsFor(s, { laundryCut: this.story.laundryCut });
    this.next = 0;
    this.elapsed = 0;
    this.done = false;
    this.rewinding = -1;
    this.flickered = false;
    this.frames = new FrameClock();
    this.clock = null;
    this.tracking = [];
    this.rain = null;

    if (s.backdrop) cover(this, fileKey(s.backdrop));
    if (s.look === 'vhs') this.drawReplay();
    if (s.look === 'crew') this.add.rectangle(0, 0, W, H, 0x05070f, 0.55).setOrigin(0);
    if (s.where === 'room') this.drawRoom();

    const skippable = wasSeen(s.id);
    this.view = new VnView(this, {
      where: s.where,
      chat: s.look === 'vn',
      skippable,
      onClick: () => this.click(),
      onSkip: () => this.finish(),
    });
    this.view.waitsForClick = s.endAt === undefined;
    setLiveView(this.view);

    Object.assign(storyState, {
      active: true,
      scriptId: s.id,
      chat: [],
      backdrop: s.backdrop,
      look: s.look,
    });
    if (s.where === 'room') playSfx('rain-loop', true);
    if (s.id === 'C5') this.cameras.main.shake(400, settings().reduceFlicker ? 0.002 : 0.006);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (s.where === 'room') stopSfx('rain-loop');
      storyState.active = false;
      setLiveView(null);
    });

    // Click scenes start on their first line; timed scenes wait for its timer.
    if (s.endAt === undefined) this.advance();
    this.ready = true;
  }

  update(time: number): void {
    const real = this.frames.step(time);
    if (!this.story || this.done) return;
    // Timers follow the test speed; the typewriter stays at reading speed (a click finishes it).
    const dt = real * run().speed;
    this.elapsed += dt;
    this.view.update(real);
    this.updateRain(dt);
    this.updateTracking(dt);

    const s = this.script;
    if (s.endAt !== undefined) {
      while (this.next < this.steps.length && (this.steps[this.next].at ?? 0) <= this.elapsed) this.advance();
      this.updateColdOpenClock();
      if (this.elapsed >= s.endAt) this.finish();
    }
    if (this.rewinding >= 0) {
      this.rewinding += dt;
      this.updateRewindClock(Math.min(1, this.rewinding / REWIND_SECONDS));
      if (this.rewinding >= REWIND_SECONDS) this.finish();
    }
  }

  /** A click finishes the typing line, or goes on to the next one in a click scene. */
  private click(): void {
    if (this.done || this.rewinding >= 0) return;
    if (!this.view.typingDone) {
      this.view.finishTyping();
      return;
    }
    if (this.script.endAt === undefined) this.advance();
  }

  /** Show the next step; chat lines go to the corner and fall through to the step after. */
  private advance(): void {
    while (this.next < this.steps.length) {
      const step = this.steps[this.next++];
      this.cue(step);
      if (isChat(step.lineId)) {
        this.view.chat(chatText(step.lineId));
        if (this.script.endAt !== undefined) return;
        continue;
      }
      this.view.say(step.lineId, step.face);
      return;
    }
    if (this.script.endAt !== undefined) return;
    if (this.story?.rewind) this.startRewind();
    else this.finish();
  }

  private cue(step: ScriptStep): void {
    if (step.cue === 'goggles') {
      playSfx('goggles-on');
      const lens = this.add
        .image(W / 2, H / 2, fileKey(EXTRA.goggles))
        .setDepth(40)
        .setAlpha(0);
      lens.setDisplaySize(W, H);
      this.tweens.add({ targets: lens, alpha: 1, duration: 800 / run().speed });
    }
    if (step.cue === 'cable') {
      playSfx('rescue-cable');
      const cable = this.add
        .image(W / 2, -700, fileKey(EXTRA.cable))
        .setScale(0.55)
        .setDepth(5);
      this.tweens.add({ targets: cable, y: 330, duration: 700 / run().speed, ease: 'Back.Out' });
    }
    if (step.cue === 'regroup') {
      const icon = this.add
        .image(W / 2, 560, fileKey(EXTRA.regroup))
        .setScale(0.6)
        .setDepth(15)
        .setAlpha(0);
      this.tweens.add({ targets: icon, alpha: 1, duration: 500 / run().speed });
    }
  }

  private finish(): void {
    if (this.done || !this.story) return;
    this.done = true;
    markSeen(this.script.id);
    storyState.finished = [...storyState.finished, this.script.id];
    this.story.onDone(this);
  }

  // --- Lux's room: rain on the window, Akemi's photo, the clock flickering to 02:14 ---------------

  private drawRoom(): void {
    this.add.rectangle(0, 0, W, H, 0x05070f, 0.25).setOrigin(0);
    this.rain = this.add.graphics().setDepth(2);
    this.drops = Array.from({ length: RAIN_DROPS }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      v: 900 + Math.random() * 600,
    }));
    if (this.script.photo) {
      this.add.image(1180, 560, fileKey(EXTRA.photo)).setScale(0.42).setAngle(-6).setDepth(8);
      this.clock = this.add
        .text(80, 60, run().clock(0), { fontFamily: 'monospace', fontSize: '40px', color: '#ff5a5a' })
        .setDepth(9);
    }
  }

  private updateRain(dt: number): void {
    const g = this.rain;
    if (!g) return;
    g.clear();
    g.lineStyle(2, 0x9fb8ff, 0.25);
    for (const d of this.drops) {
      d.y += d.v * dt;
      if (d.y > H) {
        d.y -= H + 40;
        d.x = Math.random() * W;
      }
      g.lineBetween(d.x, d.y, d.x - 6, d.y + 28);
    }
  }

  private updateColdOpenClock(): void {
    if (!this.clock) return;
    // The clock flickers to 02:14 for one frame (the night her mum died); a steady clock with reduce flicker.
    if (!this.flickered && this.elapsed >= 7 && !settings().reduceFlicker) {
      this.flickered = true;
      this.clock.setText('02:14:00');
      return;
    }
    this.clock.setText(run().clock(Math.floor(this.elapsed)));
  }

  // --- TRIAGE's stream replay: VHS lines over the frozen board -----------------------------------

  private drawReplay(): void {
    this.add.rectangle(0, 0, W, H, 0x04030a, 0.62).setOrigin(0);
    const lines = this.add.graphics();
    lines.fillStyle(0x000000, 0.28);
    for (let y = 0; y < H; y += 6) lines.fillRect(0, y, W, 2);
    this.tracking = [0, 1].map((i) =>
      this.add.rectangle(0, 300 + i * 420, W, 18 + i * 10, 0xffffff, 0.07).setOrigin(0),
    );
    this.add
      .text(80, 60, `◀◀ ${LABELS.replay}`, {
        fontFamily: 'monospace',
        fontSize: '54px',
        fontStyle: 'bold',
        color: '#ff3b5c',
      })
      .setDepth(9);
    this.clock = this.add
      .text(W - 80, 60, `● ${LABELS.rec}  ${run().clock()}`, {
        fontFamily: 'monospace',
        fontSize: '36px',
        color: '#f2ecff',
      })
      .setOrigin(1, 0)
      .setDepth(9);
  }

  private updateTracking(dt: number): void {
    for (const r of this.tracking) {
      r.y += 140 * dt * (this.rewinding >= 0 ? -12 : 1);
      if (r.y > H) r.y = -30;
      if (r.y < -30) r.y = H;
    }
  }

  private startRewind(): void {
    this.rewinding = 0;
    this.view.hideBox();
    playSfx('rewind');
    if (!this.clock) {
      this.clock = this.add
        .text(W - 80, 60, '', { fontFamily: 'monospace', fontSize: '36px', color: '#2de2e6' })
        .setOrigin(1, 0)
        .setDepth(9);
    }
    this.add
      .text(W / 2, H / 2, `◀◀ ${LABELS.rewinding}`, {
        fontFamily: 'monospace',
        fontSize: '72px',
        fontStyle: 'bold',
        color: this.script.look === 'vhs' ? '#ff3b5c' : '#2de2e6',
      })
      .setOrigin(0.5)
      .setDepth(30);
    const streaks = this.add.graphics().setDepth(25);
    streaks.fillStyle(0xffffff, 0.08);
    for (let y = 40; y < H; y += 90) streaks.fillRect(0, y, W, 3);
    this.tweens.add({ targets: streaks, x: -W / 3, duration: (REWIND_SECONDS * 1000) / run().speed });
  }

  private updateRewindClock(k: number): void {
    const r = this.story?.rewind;
    if (!r || !this.clock) return;
    this.clock.setText(`◀◀ ${run().clock(r.from + (r.target - r.from) * k)}`);
  }
}

declare global {
  interface Window {
    /** Test-only triggers for the story flow (installed only with `?test`). */
    __neonStory?: {
      startSession(): void;
      playRescue(laundryCut?: boolean): void;
      playRewind(kind: RewindKind): void;
      playDebrief(results?: Partial<DebriefResults>): void;
      /** Set the run's clock (seconds since 23:51:30), to stage a failure at a given time. */
      setNow(now: number): void;
    };
  }
}

/** Expose the flow to browser tests so they can play scenes before ENG-503 wires the triggers. */
function installStoryTrigger(story: StoryScene): void {
  const from = (): Phaser.Scene =>
    story.game.scene.getScenes(true).find((s) => s.scene.key !== SCENES.story) ?? story;
  window.__neonStory = {
    startSession: () => startSession(from()),
    playRescue: (laundryCut) => playRescue(from(), { laundryCut }),
    playRewind: (kind) => playRewind(from(), kind),
    playDebrief: (results) => playDebrief(from(), { ...defaultDebriefResults(), ...results }),
    setNow: (now) => {
      run().now = now;
    },
  };
}
