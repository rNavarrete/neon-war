import Phaser from 'phaser';
import { panel } from './hud/panel';
import { bus } from '../game/bus';
import { type Frame, frame } from '../game/frame';
import { type Occurrence, detectOccurrences } from '../game/occurrences';
import { allPortraits } from '../game/portraits';
import { type Run, run } from '../game/run';
import { settings } from '../game/settings';
import { capacityOf, errorShare } from '../sim/board';
import { BROWNOUT, BROWNOUT_RULES } from '../sim/brownout';
import type { BannerChoice } from '../sim/economy';
import { LINES, type LineId, line } from '../strings';
import { provideTestState } from '../testHook';
import { BarkView } from './hud/BarkView';
import { ChartView } from './hud/ChartView';
import { ChatView } from './hud/ChatView';
import { DialView } from './hud/DialView';
import { type BarkState, NO_BARKS, enqueueBark, stepBarks } from './hud/barks';
import {
  type ChatEntry,
  type ChatKind,
  chatEntry,
  chatOf,
  fillerDelay,
  pickFiller,
  pushChat,
  seededRandom,
} from './hud/chat';
import { type CueView, type DirectorState, NEW_DIRECTOR, direct } from './hud/cues';
import { type DialMode, applyEstimate, applySizing, dialModeAt } from './hud/dial';
import { countdownText, errorState } from './hud/format';
import type { HudTestState, PagePoint } from './hud/hook';
import { dismissJobCard, jobCardDue, openJobCard } from './hud/jobCard';
import { BOTTOM, CENTRE, COLORS, FONT, FONT_SANS, LEFT, RIGHT, TOP } from './hud/layout';
import { laundryCutAvailable } from '../sim/failures';
import { cutLaundry, laundryCutAt, regroupAvailable, upcomingDip } from './hud/pending503';
import { REGROUP_UNUSED, type RegroupState, regroupActive, regroupSpent, startRegroup } from './hud/regroup';
import { type DipWarning, dipWarningAt, fallForecastAt, surgeWarningAt } from './hud/warnings';
import { GAME_HEIGHT, GAME_WIDTH } from './BoardScene';
import { storyEnd } from '../story/state';
import { SCENES } from './keys';

const C = BROWNOUT.challenges;
const MIDNIGHT = BROWNOUT.clock.midnight;

const HUD_ART = [
  'chart-window',
  'chat-panel',
  'job-card',
  'estimate-dial',
  'warning-bar',
  'clock-panel',
  'textbox',
  'button',
  'button-hover',
  'button-pressed',
  'regroup-ready',
  'regroup-spent',
];
const ICONS = ['trust', 'credits', 'warning', 'power-dip', 'cut', 'clock'];
const AVATARS = ['kenji', 'mrs-okafor', 'young-father', 'old-man-noodles'];

/** Where on the painted Solace banner (1431x700) its three buttons sit, from its centre. */
const BANNER_BUTTONS: Record<BannerChoice, { dx: number; dy: number; w: number; h: number }> = {
  pay: { dx: 166, dy: 275, w: 250, h: 72 },
  ignore: { dx: 438, dy: 275, w: 250, h: 72 },
  bin: { dx: 632, dy: 275, w: 80, h: 80 },
};

/** Seed for the chat filler, so a run's chat is the same every time (and in tests). */
const CHAT_SEED = 20261231;

/**
 * The job card ignores clicks this soon after a story scene ends: they are the second half of a
 * double-click on the cold open's last line, whose text box sits where the card's OK button lands.
 */
const CARD_GUARD_MS = 400;

const cardGuarded = (): boolean => performance.now() - storyEnd.at < CARD_GUARD_MS;

/**
 * The board's HUD, drawn over BoardScene with a transparent background: job card, estimate dial and
 * chart, clock and countdown, trust and credits, surge and power-dip warnings, the Solace banner,
 * the laundry cut, Regroup, the sizing prompt, barks and both chats. It reads run() every frame and
 * only calls the run's actions; the rules stay in src/sim/.
 */
export class HudScene extends Phaser.Scene {
  ready = false;
  /**
   * WIRING(board): where a part sits in game space, for the power-dip warning. The board sets this
   * when it can say; until then the warning shows at CENTRE.dipFallback.
   */
  partLocator: ((partId: string) => { x: number; y: number } | null) | null = null;

  private runRef: Run | null = null;
  /** The frame the last update read, to detect occurrences against; null before the first. */
  private lastFrame: Frame | null = null;
  /** This frame's occurrences, one array reused every update (see detectOccurrences). */
  private readonly occurrences: Occurrence[] = [];
  /** Bark and filler clock: real seconds times the test speed, stopped while the board is held. */
  private clock = 0;
  private cardOpen = false;
  private earlyClick: (() => void) | null = null;
  private cardClickedEarly = false;
  private unsubscribe: (() => void)[] = [];

  private director: DirectorState = NEW_DIRECTOR;
  private barks: BarkState = NO_BARKS;
  private chats: Record<ChatKind, ChatEntry[]> = { block: [], stream: [] };
  private fillerAt: Record<ChatKind, number> = { block: 0, stream: 0 };
  private lastFiller: Record<ChatKind, LineId | null> = { block: null, stream: null };
  private rand = seededRandom(CHAT_SEED);
  private regroup: RegroupState = REGROUP_UNUSED;
  private dialTouched = false;
  private bannerShown = false;
  private decommissionsAfterMidnight = 0;
  private droppedInC6 = false;
  private lastSurgeAt = -1;
  /** Sim time the current surge warning first went on screen. */
  private surgeShownAt = -1;
  private shownSecond = -1;
  private shownTrust = NaN;
  private shownCredits = NaN;
  private dip: DipWarning | null = null;
  private readonly view: CueView = {
    now: 0,
    demand: 0,
    capacity: 0,
    dropped: 0,
    servers: 0,
    idleServer: false,
    overloaded: false,
    overclocked: false,
    cardClosed: false,
    dialTouched: false,
    estimate: null,
    sizing: null,
    sizingOpen: false,
    bannerShown: false,
    banner: null,
    laundryCut: false,
    decommissionsAfterMidnight: 0,
    droppedInC6: false,
  };

  // Views, built in create().
  private chart!: ChartView;
  private dial!: DialView;
  private barkView!: BarkView;
  private blockChat!: ChatView;
  private streamChat!: ChatView;
  private clockText!: Phaser.GameObjects.Text;
  private countdown!: Phaser.GameObjects.Text;
  private trustText!: Phaser.GameObjects.Text;
  private creditsText!: Phaser.GameObjects.Text;
  private warning!: Phaser.GameObjects.Container;
  private warningNumber!: Phaser.GameObjects.Text;
  private warningLine!: Phaser.GameObjects.Text;
  private dipMark!: Phaser.GameObjects.Container;
  private dipText!: Phaser.GameObjects.Text;
  private card!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Container;
  private bannerOpen = false;
  private sizingPanel!: Phaser.GameObjects.Container;
  private laundry!: Phaser.GameObjects.Container;
  private laundryButton!: Phaser.GameObjects.NineSlice;
  private regroupButton!: Phaser.GameObjects.Image;

  constructor() {
    super(SCENES.hud);
  }

  init(): void {
    this.ready = false;
    const r = run();
    this.cardClickedEarly = false;
    this.cardOpen = jobCardDue(r);
    if (this.cardOpen) {
      openJobCard(r);
      // A click that lands while the HUD art is still loading still dismisses the card.
      const canvas = this.game.canvas;
      const onDown = (): void => {
        if (!cardGuarded()) this.cardClickedEarly = true;
      };
      canvas.addEventListener('pointerdown', onDown);
      this.earlyClick = () => canvas.removeEventListener('pointerdown', onDown);
    }
    provideTestState('hud', () => this.snapshot());
  }

  preload(): void {
    for (const k of HUD_ART) this.loadOnce(`hud:${k}`, `art/hud/${k}.webp`);
    for (const k of ICONS) this.loadOnce(`hud:icon-${k}`, `art/hud/icons/${k}.webp`);
    for (const k of AVATARS) this.loadOnce(`avatar:${k}`, `art/chars/avatars/${k}.webp`);
    this.loadOnce('hud:solace-banner', 'art/board/solace-banner.webp');
    for (const p of allPortraits()) this.loadOnce(p.key, p.file);
  }

  create(): void {
    this.resetForRun(run());
    this.buildTopStrip();
    this.chart = new ChartView(this);
    this.dial = new DialView(this, {
      touched: () => {
        this.dialTouched = true;
      },
      set: (value) => this.onDialSet(value),
    });
    this.blockChat = new ChatView(this, LEFT.block, 'BLOCK CHAT');
    this.streamChat = new ChatView(this, LEFT.stream, 'LUX // LIVE');
    this.barkView = new BarkView(this);
    this.buildLaundry();
    this.buildRegroup();
    this.buildDipMark();
    this.buildSizingPrompt();
    this.buildBanner();
    this.buildJobCard();

    this.unsubscribe.push(
      bus.on('action', (a) => {
        if (a.type === 'decommission' && run().now >= MIDNIGHT) this.decommissionsAfterMidnight++;
      }),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of this.unsubscribe) off();
      this.unsubscribe = [];
      this.earlyClick?.();
      this.earlyClick = null;
    });

    this.earlyClick?.();
    this.earlyClick = null;
    if (this.cardOpen && this.cardClickedEarly) this.closeJobCard();
    this.ready = true;
  }

  update(_time: number, delta: number): void {
    const r = run();
    if (r !== this.runRef) this.resetForRun(r);
    if (!r.paused) this.clock += (delta / 1000) * r.speed;
    const now = r.now;
    this.readFrame(r);

    this.updateTopStrip(r);
    const estimate = r.notes.estimate;
    const sizing = r.notes.sizing;
    this.chart.update(
      now,
      r.demand,
      r.capacity,
      estimate,
      sizing !== null ? sizing * BROWNOUT.server.capacity : null,
    );
    this.updateDial(r);
    this.updateWarnings(r);
    this.updateBanner(r);
    this.updateLaundry(r);
    this.updateRegroup(r);
    const sizingOpen = this.dial.mode === 'servers' && sizing === null && now < MIDNIGHT && !this.cardOpen;
    this.sizingPanel.setVisible(sizingOpen);

    this.runDirector(r, sizingOpen);
    this.updateBarks();
    this.updateFiller(r);
  }

  // ---- the frame and its occurrences ----

  /**
   * Read this update's frame of the run (memoised per sim change) and emit each occurrence since
   * the last one on the bus. The occurrence array is reused, so nothing is allocated on a quiet frame.
   */
  private readFrame(r: Run): void {
    const f = frame(r);
    if (f === this.lastFrame) {
      this.occurrences.length = 0;
      return;
    }
    detectOccurrences(this.lastFrame, f, this.occurrences);
    this.lastFrame = f;
    for (let i = 0; i < this.occurrences.length; i++) bus.emit('occurrence', this.occurrences[i]);
  }

  // ---- per-run state ----

  private resetForRun(r: Run): void {
    this.runRef = r;
    this.lastFrame = null;
    this.occurrences.length = 0;
    this.director = NEW_DIRECTOR;
    this.barks = NO_BARKS;
    this.chats = { block: [], stream: [] };
    this.rand = seededRandom(CHAT_SEED);
    this.fillerAt = {
      block: this.clock + fillerDelay(this.rand),
      stream: this.clock + fillerDelay(this.rand),
    };
    this.regroup = REGROUP_UNUSED;
    this.dialTouched = false;
    this.bannerShown = false;
    this.decommissionsAfterMidnight = 0;
    this.droppedInC6 = false;
    this.lastSurgeAt = -1;
    if (this.ready) {
      this.blockChat.show([]);
      this.streamChat.show([]);
      this.chart.ring.clear();
      this.dial.reset();
      if (jobCardDue(r)) {
        this.cardOpen = true;
        openJobCard(r);
        this.card.setVisible(true);
      }
    }
  }

  // ---- top strip: clock, countdown, trust, credits, surge warning ----

  private buildTopStrip(): void {
    const p = TOP.clockPanel;
    this.add
      .image(p.x, p.y, 'hud:clock-panel')
      .setOrigin(0)
      .setDisplaySize(p.size, p.size * (207 / 213));
    this.add.image(p.x + p.size / 2, p.y + p.size / 2, 'hud:icon-clock').setScale(0.2);
    this.clockText = this.add.text(TOP.clockText.x, TOP.clockText.y, '', {
      fontFamily: FONT,
      fontSize: '40px',
      color: COLORS.cyanText,
    });
    this.countdown = this.add.text(TOP.countdown.x, TOP.countdown.y, '', {
      fontFamily: FONT,
      fontSize: '22px',
      color: COLORS.amberText,
    });
    this.add.image(TOP.trust.x, TOP.trust.y, 'hud:icon-trust').setScale(0.17);
    this.trustText = this.add
      .text(TOP.trust.x + 38, TOP.trust.y, '', { fontFamily: FONT, fontSize: '34px', color: COLORS.white })
      .setOrigin(0, 0.5);
    this.add.image(TOP.credits.x, TOP.credits.y, 'hud:icon-credits').setScale(0.17);
    this.creditsText = this.add
      .text(TOP.credits.x + 38, TOP.credits.y, '', {
        fontFamily: FONT,
        fontSize: '34px',
        color: COLORS.white,
      })
      .setOrigin(0, 0.5);

    const w = TOP.warning;
    const bar = panel(this, 'hud:warning-bar', 0, 0, w.w, w.h, { k: 0.85, slice: [90, 90, 40, 40] });
    this.warningNumber = this.add.text(96, 18, '', {
      fontFamily: FONT,
      fontSize: '28px',
      color: COLORS.amberText,
    });
    this.warningLine = this.add.text(96, 56, '', {
      fontFamily: FONT_SANS,
      fontSize: '17px',
      color: COLORS.white,
      wordWrap: { width: w.w - 192 },
      maxLines: 3,
    });
    this.warning = this.add
      .container(w.x, w.y, [bar, this.warningNumber, this.warningLine])
      .setVisible(false);
  }

  private updateTopStrip(r: Run): void {
    const second = Math.floor(r.now);
    if (second !== this.shownSecond) {
      this.shownSecond = second;
      this.clockText.setText(r.clock());
      this.countdown.setText(`midnight in ${countdownText(r.now)}`);
    }
    const trust = Math.round(r.session.trust);
    if (trust !== this.shownTrust) {
      this.shownTrust = trust;
      this.trustText.setText(String(trust));
      this.trustText.setColor(trust < BROWNOUT.rescue.trustBelow ? COLORS.redText : COLORS.white);
    }
    const credits = Math.floor(r.session.board.credits);
    if (credits !== this.shownCredits) {
      this.shownCredits = credits;
      this.creditsText.setText(String(credits));
      this.creditsText.setColor(credits < 0 ? COLORS.redText : COLORS.white);
    }
  }

  private updateWarnings(r: Run): void {
    const surge = surgeWarningAt(r.now);
    if (surge) {
      if (surge.surge.startsAt !== this.lastSurgeAt) {
        this.lastSurgeAt = surge.surge.startsAt;
        this.surgeShownAt = r.now;
        this.warningLine.setText(line(surge.line));
        bus.emit('sfx', { key: 'surge-warning' });
      }
      this.warningNumber.setText(
        surge.inSeconds > 0
          ? `▲ ${surge.surge.demand}/s in ${surge.inSeconds}s`
          : `▲ ${surge.surge.demand}/s NOW`,
      );
      this.warning.setVisible(true);
    } else {
      const fall = fallForecastAt(r.now);
      if (fall) {
        this.warningNumber.setText(`▼ ${fall.demand}/s`);
        this.warningLine.setText(line(fall.line));
      }
      this.warning.setVisible(fall !== null);
    }

    this.dip = dipWarningAt(upcomingDip(r), r.now, settings().reduceFlicker);
    if (this.dip) {
      const at = this.partLocator?.(this.dip.partId) ?? CENTRE.dipFallback;
      this.dipMark.setPosition(at.x, at.y);
      this.dipText.setText(line(r.now < C.c5 ? 'C4.flicker.01' : 'C6.flicker.01'));
    }
    this.dipMark.setVisible(this.dip?.lit ?? false);
  }

  private buildDipMark(): void {
    const icon = this.add.image(0, -10, 'hud:icon-power-dip').setScale(0.22);
    this.dipText = this.add
      .text(0, 48, '', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#ffe066',
        backgroundColor: 'rgba(5,7,15,0.8)',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 0);
    this.dipMark = this.add.container(0, 0, [icon, this.dipText]).setVisible(false);
  }

  // ---- dial and sizing prompt ----

  private updateDial(r: Run): void {
    const mode: DialMode = dialModeAt(r.now);
    this.dial.setVisible(!this.cardOpen);
    this.dial.setMode(mode, mode === 'reqps' ? 'EXPECTED REQ/S' : 'BOXES FOR MIDNIGHT');
    const answer = mode === 'reqps' ? r.notes.estimate : r.notes.sizing;
    if (answer !== null && !this.dial.locked) this.dial.lock(answer);
    this.dial.draw();
  }

  private onDialSet(value: number): void {
    const r = run();
    bus.emit('sfx', { key: 'ui-click' });
    if (this.dial.mode === 'reqps') applyEstimate(r, value);
    else applySizing(r, value);
  }

  private buildSizingPrompt(): void {
    const s = CENTRE.sizing;
    const box = panel(this, 'hud:textbox', 0, 0, s.w, s.h, { k: 0.6 });
    const text = this.add
      .text(s.w / 2 - 20, s.h / 2, line('C6.prompt'), {
        fontFamily: FONT,
        fontSize: '28px',
        color: COLORS.white,
      })
      .setOrigin(0.5);
    const arrow = this.add
      .text(s.w - 40, s.h / 2, '→', { fontFamily: FONT, fontSize: '40px', color: COLORS.magentaText })
      .setOrigin(0.5);
    this.tweens.add({ targets: arrow, x: s.w - 26, duration: 500, yoyo: true, repeat: -1 });
    this.sizingPanel = this.add.container(s.x, s.y, [box, text, arrow]).setVisible(false);
  }

  // ---- job card ----

  private buildJobCard(): void {
    const j = CENTRE.jobCard;
    const k = j.scale;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.6).setOrigin(0);
    dim.setInteractive();
    const art = this.add.image(j.x, j.y, 'hud:job-card').setScale(k);
    art.setInteractive({ useHandCursor: true });
    art.on('pointerdown', () => {
      if (!cardGuarded()) this.closeJobCard();
    });
    // Positions inside the 864x1252 card art, scaled.
    const at = (ax: number, ay: number): [number, number] => [j.x + (ax - 432) * k, j.y + (ay - 626) * k];
    const text = (ax: number, ay: number, s: string, size: number, color: string, wrap: number) =>
      this.add
        .text(...at(ax, ay), s, {
          fontFamily: FONT_SANS,
          fontSize: `${size}px`,
          color,
          align: 'center',
          wordWrap: { width: wrap * k },
        })
        .setOrigin(0.5);
    const parts = [
      dim,
      art,
      text(153, 200, '120', 40, COLORS.amberText, 190),
      text(540, 200, line('C1.card.title'), 30, COLORS.cyanText, 480),
      text(419, 466, line('C1.card.who'), 24, COLORS.white, 680),
      text(419, 679, line('C1.card.what'), 24, COLORS.white, 680),
      text(419, 886, line('C1.card.bar'), 24, COLORS.white, 680),
      text(432, 1107, line('C1.card.rate'), 23, COLORS.amberText, 560),
    ];
    const [okX, okY] = this.jobCardOk();
    const ok = panel(this, 'hud:button', okX, okY, 170, 62, {
      k: 0.4,
      slice: [70, 70, 60, 60],
      centred: true,
    });
    ok.setInteractive({ useHandCursor: true });
    ok.on('pointerover', () => ok.setTexture('hud:button-hover'));
    ok.on('pointerout', () => ok.setTexture('hud:button'));
    ok.on('pointerdown', () => {
      if (!cardGuarded()) this.closeJobCard();
    });
    const okText = this.add.text(okX, okY, 'OK', {
      fontFamily: FONT,
      fontSize: '26px',
      color: COLORS.cyanText,
    });
    okText.setOrigin(0.5);
    this.card = this.add.container(0, 0, [...parts, ok, okText]).setVisible(this.cardOpen);
  }

  /** The OK button under the job card, in game space. */
  private jobCardOk(): [number, number] {
    const j = CENTRE.jobCard;
    return [j.x, j.y + (1252 / 2) * j.scale + 10];
  }

  private closeJobCard(): void {
    if (!this.cardOpen) return;
    this.cardOpen = false;
    this.card.setVisible(false);
    bus.emit('sfx', { key: 'ui-click' });
    dismissJobCard(run());
  }

  // ---- Solace banner ----

  private buildBanner(): void {
    const b = CENTRE.banner;
    const k = b.scale;
    const art = this.add.image(0, 0, 'hud:solace-banner').setScale(k);
    art.setInteractive(); // swallows clicks so they don't reach the board under the banner
    const title = this.add.text(83, -112, line('C2.banner.title'), {
      fontFamily: FONT_SANS,
      fontSize: '24px',
      fontStyle: 'bold',
      color: '#1d4f8f',
    });
    title.setOrigin(0.5, 0);
    const body = this.add.text(83, -70, line('C2.banner.body'), {
      fontFamily: FONT_SANS,
      fontSize: '19px',
      color: '#2a3b55',
      align: 'center',
      wordWrap: { width: 400 },
    });
    body.setOrigin(0.5, 0);
    const labels = line('C2.banner.buttons').split(' / ');
    const choices: BannerChoice[] = ['pay', 'ignore', 'bin'];
    const buttons = choices.flatMap((choice, i) => {
      const p = BANNER_BUTTONS[choice];
      const x = p.dx * k;
      const y = p.dy * k;
      const zone = this.add.zone(x, y, p.w * k + 8, p.h * k + 8).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.chooseBanner(choice));
      const label = this.add
        .text(x, choice === 'bin' ? y + 26 : y, labels[i] ?? choice, {
          fontFamily: FONT_SANS,
          fontSize: choice === 'bin' ? '13px' : '17px',
          color: '#2a3b55',
        })
        .setOrigin(0.5);
      return [zone, label];
    });
    this.banner = this.add.container(b.x, b.y, [art, title, body, ...buttons]).setVisible(false);
  }

  private bannerButton(choice: BannerChoice): PagePoint {
    const b = CENTRE.banner;
    const p = BANNER_BUTTONS[choice];
    return this.toPage(b.x + p.dx * b.scale, this.banner.y + p.dy * b.scale);
  }

  private updateBanner(r: Run): void {
    const due = r.now >= C.c2 && r.now < C.c3 && r.session.banner === null && !this.cardOpen;
    if (due && !this.bannerOpen) {
      this.bannerOpen = true;
      this.bannerShown = true;
      this.banner.setVisible(true).setY(-200);
      this.tweens.add({ targets: this.banner, y: CENTRE.banner.y, duration: 450, ease: 'Back.Out' });
      bus.emit('sfx', { key: 'banner-pop' });
    } else if (!due && this.bannerOpen) {
      this.bannerOpen = false;
      this.tweens.killTweensOf(this.banner);
      this.banner.setVisible(false);
    }
  }

  private chooseBanner(choice: BannerChoice): void {
    const res = run().chooseBanner(choice);
    bus.emit('sfx', { key: 'ui-click' });
    if (res.ok && choice === 'pay') bus.emit('sfx', { key: 'credits' });
  }

  // ---- laundry cut and Regroup ----

  private buildLaundry(): void {
    const l = RIGHT.laundry;
    this.laundryButton = panel(this, 'hud:button', 0, 0, l.w, l.h, { k: 0.45, slice: [70, 70, 60, 60] });
    this.laundryButton.setInteractive({ useHandCursor: true });
    this.laundryButton.on('pointerover', () => this.laundryButton.setTexture('hud:button-hover'));
    this.laundryButton.on('pointerout', () => this.laundryButton.setTexture('hud:button'));
    this.laundryButton.on('pointerdown', () => {
      const r = run();
      if (laundryCutAt(r) !== null) return;
      this.laundryButton.setTexture('hud:button-pressed');
      cutLaundry(r);
      bus.emit('sfx', { key: 'wire-cut' });
    });
    const icon = this.add.image(46, l.h / 2, 'hud:icon-cut').setScale(0.13);
    const text = this.add
      .text(84, l.h / 2, line('C4.cut.button'), {
        fontFamily: FONT_SANS,
        fontSize: '18px',
        color: COLORS.white,
        wordWrap: { width: l.w - 110 },
      })
      .setOrigin(0, 0.5);
    this.laundry = this.add.container(l.x, l.y, [this.laundryButton, icon, text]).setVisible(false);
  }

  private updateLaundry(r: Run): void {
    const inSurge = laundryCutAvailable(r.now, r.rescued) || (laundryCutAt(r) !== null && r.now < C.c5);
    const cut = laundryCutAt(r) !== null;
    this.laundry.setVisible(inSurge);
    this.laundry.setAlpha(cut ? 0.45 : 1);
  }

  private buildRegroup(): void {
    const g = BOTTOM.regroup;
    this.regroupButton = this.add.image(g.x, g.y, 'hud:regroup-ready').setDisplaySize(g.size, g.size);
    this.regroupButton.setInteractive({ useHandCursor: true, pixelPerfect: false });
    this.regroupButton.on('pointerdown', () => {
      const r = run();
      if (!regroupAvailable(r) || this.regroup.startedAt !== null) return;
      // The sim slows itself to quarter speed for 10 s and plays the effect; the HUD tracks the button.
      if (r.regroup().ok) this.regroup = startRegroup(this.regroup, this.clock);
    });
    this.regroupButton.setVisible(false);
  }

  private updateRegroup(r: Run): void {
    const used = this.regroup.startedAt !== null;
    this.regroupButton.setVisible(regroupAvailable(r) || used);
    if (!used) return;
    const spent = regroupSpent(this.regroup, this.clock);
    this.regroupButton.setTexture(spent ? 'hud:regroup-spent' : 'hud:regroup-ready');
    this.regroupButton.setDisplaySize(BOTTOM.regroup.size, BOTTOM.regroup.size);
    this.regroupButton.setAlpha(spent ? 0.7 : 0.75 + 0.25 * Math.sin(this.clock * 6));
  }

  // ---- barks and chat ----

  private runDirector(r: Run, sizingOpen: boolean): void {
    const v = this.view;
    v.now = r.now;
    v.clock = this.clock;
    v.demand = r.demand;
    v.capacity = r.capacity;
    v.dropped = r.flow.dropped > 1e-6 ? r.flow.dropped : 0;
    let servers = 0;
    let idle = false;
    let overloaded = false;
    let overclocked = false;
    for (const p of r.session.board.parts) {
      if (p.kind !== 'server') continue;
      servers++;
      if ((p.boost ?? 1) > 1) overclocked = true;
      if ((r.session.offlineUntil[p.id] ?? 0) > r.now) continue;
      const load = r.flow.load[p.id] ?? 0;
      if (load <= 0) idle = true;
      if (v.dropped > 0 && load >= capacityOf(p, BROWNOUT_RULES) - 1e-6) overloaded = true;
    }
    v.servers = servers;
    v.idleServer = idle;
    v.overloaded = overloaded;
    v.overclocked = overclocked;
    v.cardClosed = !this.cardOpen;
    v.dialTouched = this.dialTouched;
    v.estimate = r.notes.estimate;
    v.sizing = r.notes.sizing;
    v.sizingOpen = sizingOpen;
    v.bannerShown = this.bannerShown;
    v.banner = r.session.banner?.choice ?? null;
    v.laundryCut = laundryCutAt(r) !== null;
    if (v.dropped > 0 && r.now >= C.c6 - BROWNOUT.demand.forecastLeadSeconds && r.now <= MIDNIGHT + 1) {
      this.droppedInC6 = true;
    }
    v.droppedInC6 = this.droppedInC6;
    v.decommissionsAfterMidnight = this.decommissionsAfterMidnight;

    const out = direct(this.director, v);
    this.director = out.state;
    for (const id of out.fired) this.cue(id);
  }

  /** Route a fired line to the bark queue or a chat. */
  private cue(id: LineId): void {
    const chat = chatOf(id);
    if (chat) this.say(chat, id);
    else if (LINES[id].kind === 'bark') this.barks = enqueueBark(this.barks, id);
  }

  private say(chat: ChatKind, id: LineId): void {
    this.chats[chat] = pushChat(this.chats[chat], chatEntry(id));
    (chat === 'block' ? this.blockChat : this.streamChat).show(this.chats[chat]);
  }

  private updateBarks(): void {
    const next = stepBarks(this.barks, this.clock);
    if (next === this.barks) return;
    this.barks = next;
    const id = next.current?.id ?? null;
    if (id && id !== this.barkView.shown && LINES[id].speaker.startsWith('TRIAGE')) {
      bus.emit('sfx', { key: LINES[id].speaker.includes('panicking') ? 'triage-panic' : 'triage-blip' });
    }
    this.barkView.show(id);
  }

  private updateFiller(r: Run): void {
    if (this.cardOpen) return;
    const state = errorState(errorShare(r.flow, r.demand));
    for (const chat of ['block', 'stream'] as const) {
      if (this.clock < this.fillerAt[chat]) continue;
      const id = pickFiller(chat, state, this.rand, this.lastFiller[chat]);
      this.lastFiller[chat] = id;
      this.say(chat, id);
      this.fillerAt[chat] = this.clock + fillerDelay(this.rand);
    }
  }

  // ---- helpers ----

  private loadOnce(key: string, file: string): void {
    if (!this.textures.exists(key)) this.load.image(key, file);
  }

  /** Game-space point to page CSS pixels. */
  private toPage(x: number, y: number): PagePoint {
    const rect = this.game.canvas.getBoundingClientRect();
    return {
      x: Math.round(rect.left + (x * rect.width) / GAME_WIDTH),
      y: Math.round(rect.top + (y * rect.height) / GAME_HEIGHT),
    };
  }

  private snapshot(): HudTestState {
    const r = run();
    const built = this.ready;
    const [okX, okY] = this.jobCardOk();
    const ok = this.toPage(okX, okY);
    const w = surgeWarningAt(r.now);
    return {
      ready: built,
      now: r.now,
      paused: r.paused,
      clock: built ? this.clockText.text : r.clock(),
      countdown: built ? this.countdown.text.replace('midnight in ', '') : countdownText(r.now),
      jobCard: { open: this.cardOpen, x: ok.x, y: ok.y },
      dial: {
        visible: built && this.dial.visible,
        mode: built ? this.dial.mode : dialModeAt(r.now),
        value: built ? this.dial.value : 0,
        locked: built && this.dial.locked,
        minus: this.toPage(RIGHT.dialMinus.x, RIGHT.dialMinus.y),
        plus: this.toPage(RIGHT.dialPlus.x, RIGHT.dialPlus.y),
        set: this.toPage(RIGHT.dialSet.x, RIGHT.dialSet.y),
      },
      notes: { ...r.notes },
      chart: built
        ? {
            demand: this.chart.ring.lastDemand,
            capacity: this.chart.ring.lastCapacity,
            ceiling: this.chart.ceiling,
            estimateLine: r.notes.estimate,
          }
        : { demand: 0, capacity: 0, ceiling: 0, estimateLine: null },
      sim: {
        demand: r.demand,
        block: r.blockDemand,
        capacity: r.capacity,
        trust: r.session.trust,
        credits: r.session.board.credits,
      },
      shown: {
        trust: Number(built ? this.trustText.text : NaN),
        credits: Number(built ? this.creditsText.text : NaN),
      },
      surge: w
        ? {
            demand: w.surge.demand,
            startsAt: w.surge.startsAt,
            inSeconds: w.inSeconds,
            line: w.line,
            shownAt: this.lastSurgeAt === w.surge.startsAt ? this.surgeShownAt : null,
          }
        : null,
      dip: this.dip ? { ...this.dip } : null,
      banner: {
        open: this.bannerOpen,
        choice: r.session.banner?.choice ?? null,
        pay: built ? this.bannerButton('pay') : { x: 0, y: 0 },
        ignore: built ? this.bannerButton('ignore') : { x: 0, y: 0 },
        bin: built ? this.bannerButton('bin') : { x: 0, y: 0 },
      },
      laundry: {
        available: built && this.laundry.visible && laundryCutAt(r) === null,
        cut: laundryCutAt(r) !== null,
        button: this.toPage(RIGHT.laundry.x + RIGHT.laundry.w / 2, RIGHT.laundry.y + RIGHT.laundry.h / 2),
      },
      regroup: {
        visible: built && this.regroupButton.visible,
        active: regroupActive(this.regroup, this.clock),
        spent: regroupSpent(this.regroup, this.clock),
        button: this.toPage(BOTTOM.regroup.x, BOTTOM.regroup.y),
      },
      sizingPrompt: { open: built && this.sizingPanel.visible },
      bark: {
        current: this.barks.current?.id ?? null,
        text: this.barks.current ? line(this.barks.current.id) : null,
        history: [...this.barks.history],
      },
      chat: {
        block: this.chats.block.map((e) => `${e.who}: ${e.text}`),
        stream: this.chats.stream.map((e) => `${e.who}: ${e.text}`),
      },
      timeScale: r.timeScale,
    };
  }
}
