import Phaser from 'phaser';
import { panel } from './hud/panel';
import { bus } from '../game/bus';
import { type Frame, frame } from '../game/frame';
import { type Occurrence, detectOccurrences } from '../game/occurrences';
import { allPortraits } from '../game/portraits';
import { type Run, run } from '../game/run';
import { settings } from '../game/settings';
import { errorShare } from '../sim/board';
import { BROWNOUT } from '../sim/brownout';
import type { BannerChoice } from '../sim/economy';
import { LINES, type LineId, line } from '../strings';
import { provideTestState } from '../testHook';
import { CommsView } from './hud/CommsView';
import { type ChartView, scopeViewOf } from './hud/ChartView';
import { ChatView } from './hud/ChatView';
import { DialView } from './hud/DialView';
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
import {
  CHAT_SILENCE,
  type CueView,
  type DirectorState,
  NEW_DIRECTOR,
  chatSilenced,
  cueViewOf,
  direct,
  emptyCueView,
} from './hud/cues';
import { type DialMode, applyEstimate, applySizing, dialModeAt } from './hud/dial';
import { countdownText, errorState } from './hud/format';
import { type HudBounds, type HudTestState, type PagePoint, hudSection } from './hud/hook';
import { dialQuestionOpen, dismissJobCard, jobCardDue, openJobCard, sizingPromptOpen } from './hud/jobCard';
import {
  BANNER_BUTTONS,
  BOTTOM,
  CENTRE,
  COLORS,
  FONT,
  FONT_SANS,
  type Home,
  JOB_ART,
  KEY,
  RIGHT,
} from './hud/layout';
import { laundryCutAt, upcomingDip } from './hud/pending503';
import { shownCredits, shownTrust } from './hud/title';
import { type DipWarning, dipMarkAt, dipWarningAt, surgeWarningAt } from './hud/warnings';
import { AlertView } from './hud/AlertView';
import { DeckView } from './hud/DeckView';
import { GAME_HEIGHT, GAME_WIDTH } from './BoardScene';
import { storyEnd } from '../story/state';
import { SCENES } from './keys';
import { type LiveFlags, PLAY_FLAGS, flagsFrom } from './live/flags';
import { liveTestState, perfTestState } from './live/hook';
import { CARDS, ZONES, centreOf, pagePoint, pageRect } from './live/layout';
import { createViews } from './live/registry';
import type { LiveHost, LiveView } from './live/view';

const C = BROWNOUT.challenges;
const MIDNIGHT = BROWNOUT.clock.midnight;
/** The sizing prompt's centre in game pixels, for hud.sizingPrompt. */
const SIZING_AT = centreOf(CARDS.sizingPrompt);

const HUD_ART = [
  'chart-window',
  'chat-panel',
  'job-card',
  'estimate-dial',
  'warning-bar',
  'textbox',
  'button',
  'button-hover',
  'button-pressed',
  'regroup-ready',
  'regroup-spent',
];
const ICONS = ['trust', 'credits', 'warning', 'power-dip', 'cut', 'clock'];
const AVATARS = ['kenji', 'mrs-okafor', 'young-father', 'old-man-noodles'];

/** Seed for the chat filler, so a run's chat is the same every time (and in tests). */
const CHAT_SEED = 20261231;

/**
 * The job card ignores clicks this soon after a story scene ends: they are the second half of a
 * double-click on the cold open's last line, whose text box sits where the card's OK button lands.
 */
const CARD_GUARD_MS = 400;

const cardGuarded = (): boolean => performance.now() - storyEnd.at < CARD_GUARD_MS;

/**
 * The board's HUD, drawn over BoardScene with a transparent background and staged into the Live
 * screen's zones (src/scenes/live/layout.ts, docs/LIVE.md). It hosts the zone views (the registry:
 * the title cluster and the clock are TitleView and ClockView, the alert band AlertView, the deck's
 * keys 1 REGROUP, 2 CUT 3F, 3 SET DeckView) and still draws one chat column.
 * Over the feed, only while asked: the job card, the Solace banner, the dial card, the sizing prompt
 * and the power-dip warning. It reads run() every frame and only calls the run's actions; the rules
 * stay in src/sim/.
 */
export class HudScene extends Phaser.Scene {
  ready = false;
  private runRef: Run | null = null;
  /** The frame the last update read, to detect occurrences against; null before the first. */
  private lastFrame: Frame | null = null;
  /** This frame's occurrences, one array reused every update (see detectOccurrences). */
  private readonly occurrences: Occurrence[] = [];
  /** The Live screen's views, one per registry line (src/scenes/live/registry.ts), made in init. */
  private views: LiveView[] = [];
  /** The HUD clock as views see it, one object reused every update. */
  private readonly liveClock: { now: number; dt: number } = { now: 0, dt: 0 };
  private flags: LiveFlags = PLAY_FLAGS;
  /** Bark and filler clock: real seconds times the test speed, stopped while the board is held. */
  private clock = 0;
  private cardOpen = false;
  private earlyClick: (() => void) | null = null;
  private cardClickedEarly = false;
  private unsubscribe: (() => void)[] = [];

  private director: DirectorState = NEW_DIRECTOR;
  private chats: Record<ChatKind, ChatEntry[]> = { block: [], stream: [] };
  /** Both chats in arrival order, for the one chat column. */
  private merged: ChatEntry[] = [];
  private fillerAt: Record<ChatKind, number> = { block: 0, stream: 0 };
  private lastFiller: Record<ChatKind, LineId | null> = { block: null, stream: null };
  private rand = seededRandom(CHAT_SEED);
  private dialTouched = false;
  private bannerShown = false;
  private decommissionsAfterMidnight = 0;
  private lastSurgeAt = -1;
  /** Sim time the current surge warning first went on screen. */
  private surgeShownAt = -1;
  private dip: DipWarning | null = null;
  /** Where the dip mark was last placed, in game pixels (one object, reused). */
  private readonly dipAt: { x: number; y: number } = { x: 0, y: 0 };
  /** What the dial question reads, one object reused every update. */
  private readonly ask: { now: number; cardOpen: boolean; estimate: number | null; sizing: number | null } = {
    now: 0,
    cardOpen: false,
    estimate: null,
    sizing: null,
  };
  /** Every id the director fired this run, in order, as sent out on the bus as `cue` (for the hook). */
  private firedCues: LineId[] = [];
  /** What the cues read this frame (cueViewOf writes into it; it is also the last frame's view). */
  private readonly view: CueView = emptyCueView();
  /** What only the HUD knows, handed to cueViewOf; one object reused every update. */
  private readonly cueHost: {
    cardClosed: boolean;
    dialTouched: boolean;
    sizingOpen: boolean;
    bannerShown: boolean;
    decommissionsAfterMidnight: number;
  } = {
    cardClosed: false,
    dialTouched: false,
    sizingOpen: false,
    bannerShown: false,
    decommissionsAfterMidnight: 0,
  };

  // Views, built in create().
  private chart!: ChartView;
  private dial!: DialView;
  /** The comms band (the registry's comms view): every bark the cue table fires goes to it. */
  private comms: CommsView | null = null;
  /** The alert band and the deck (registry views): hud.bounds and hud.laundry/regroup read them. */
  private alertView: AlertView | null = null;
  private deckView: DeckView | null = null;
  private chatView!: ChatView;
  private dipMark!: Phaser.GameObjects.Container;
  private dipText!: Phaser.GameObjects.Text;
  private card!: Phaser.GameObjects.Container;
  private cardArt!: Phaser.GameObjects.Image;
  private banner!: Phaser.GameObjects.Container;
  private bannerOpen = false;
  private sizingPanel!: Phaser.GameObjects.Container;

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
    // One public snapshot: the scene's own keys with every view's provideHudSection keys over them.
    provideTestState('hud', () => hudSection(this.snapshot()));

    this.flags = flagsFrom(window.location.search);
    this.views = createViews();
    this.comms = (this.views.find((v) => v instanceof CommsView) as CommsView | undefined) ?? null;
    this.alertView = (this.views.find((v) => v instanceof AlertView) as AlertView | undefined) ?? null;
    this.deckView = (this.views.find((v) => v instanceof DeckView) as DeckView | undefined) ?? null;
    provideTestState('live', () => liveTestState(this.game.canvas.getBoundingClientRect(), this.views));
    provideTestState('perf', () => {
      const board = this.scene.get(SCENES.board) as Phaser.Scene | null;
      return perfTestState(
        board?.children?.list ?? [],
        this.children.list,
        this.game.loop.actualFps,
        this.flags.lite,
      );
    });
  }

  preload(): void {
    for (const v of this.views) v.preload?.(this);
    for (const k of HUD_ART) this.loadOnce(`hud:${k}`, `art/hud/${k}.webp`);
    for (const k of ICONS) this.loadOnce(`hud:icon-${k}`, `art/hud/icons/${k}.webp`);
    for (const k of AVATARS) this.loadOnce(`avatar:${k}`, `art/chars/avatars/${k}.webp`);
    this.loadOnce('hud:solace-banner', 'art/board/solace-banner.webp');
    for (const p of allPortraits()) this.loadOnce(p.key, p.file);
  }

  create(): void {
    this.resetForRun(run());
    // The Live screen's views go first, so their placeholders sit under everything drawn below.
    for (const v of this.views) v.create(this, this.hostFor(v));
    this.chart = scopeViewOf(this.views);
    this.dial = new DialView(this, {
      touched: () => {
        this.dialTouched = true;
      },
      set: (value) => this.onDialSet(value),
    });
    this.chatView = new ChatView(this, RIGHT.chat, RIGHT.chatTitle, RIGHT.chatBody, 'LIVE CHAT');
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
      for (const v of this.views) v.shutdown();
      this.views = [];
    });

    this.earlyClick?.();
    this.earlyClick = null;
    if (this.cardOpen && this.cardClickedEarly) this.closeJobCard();
    this.ready = true;
  }

  update(_time: number, delta: number): void {
    const r = run();
    if (r !== this.runRef) this.resetForRun(r);
    const step = r.paused ? 0 : (delta / 1000) * r.speed;
    this.clock += step;
    const now = r.now;
    const f = this.readFrame(r);
    this.liveClock.now = this.clock;
    this.liveClock.dt = step;
    for (let i = 0; i < this.views.length; i++) this.views[i].update(f, this.liveClock, this.occurrences);

    const estimate = r.notes.estimate;
    const sizing = r.notes.sizing;
    const ask = this.ask;
    ask.now = now;
    ask.cardOpen = this.cardOpen;
    ask.estimate = estimate;
    ask.sizing = sizing;
    const asked = dialQuestionOpen(ask);
    const sizingOpen = sizingPromptOpen(ask);
    this.updateDial(r, asked);
    this.updateSurge(r);
    this.updateDip(r);
    this.updateBanner(r);
    this.sizingPanel.setVisible(sizingOpen);

    this.runDirector(f, sizingOpen);
    this.updateFiller(r);
  }

  // ---- the frame and its occurrences ----

  /**
   * Read this update's frame of the run (memoised per sim change) and emit each occurrence since
   * the last one on the bus. The occurrence array is reused, so nothing is allocated on a quiet frame.
   */
  private readFrame(r: Run): Frame {
    const f = frame(r);
    if (f === this.lastFrame) {
      this.occurrences.length = 0;
      return f;
    }
    detectOccurrences(this.lastFrame, f, this.occurrences);
    this.lastFrame = f;
    for (let i = 0; i < this.occurrences.length; i++) bus.emit('occurrence', this.occurrences[i]);
    return f;
  }

  /** What a view gets at create: this scene, the bus, its zone's rect and the flags (read live). */
  private hostFor(view: LiveView): LiveHost {
    const flags = (): LiveFlags => this.flags;
    return {
      scene: this,
      bus,
      rect: ZONES[view.zone],
      get flags(): LiveFlags {
        return flags();
      },
      pressSet: (): boolean => this.dial?.pressSet() ?? false,
    };
  }

  // ---- per-run state ----

  private resetForRun(r: Run): void {
    this.runRef = r;
    this.lastFrame = null;
    this.occurrences.length = 0;
    this.director = NEW_DIRECTOR;
    this.comms?.reset();
    this.chats = { block: [], stream: [] };
    this.merged = [];
    this.rand = seededRandom(CHAT_SEED);
    this.fillerAt = {
      block: this.clock + fillerDelay(this.rand),
      stream: this.clock + fillerDelay(this.rand),
    };
    this.dialTouched = false;
    this.bannerShown = false;
    this.decommissionsAfterMidnight = 0;
    // A fresh run: nothing carries over from the last run's view (dropped in C6, the rescue clock).
    Object.assign(this.view, emptyCueView());
    this.firedCues = [];
    this.lastSurgeAt = -1;
    if (this.ready) {
      this.chatView.show([]);
      this.chart.ring.clear();
      this.dial.reset();
      if (jobCardDue(r)) {
        this.cardOpen = true;
        openJobCard(r);
        this.card.setVisible(true);
      }
    }
  }

  // ---- the surge warning and the dip mark ----

  /**
   * Note when each surge warning first shows (hud.surge.shownAt). AlertView draws the band and plays
   * its sound; the scene keeps only this mirror for the hook.
   */
  private updateSurge(r: Run): void {
    const surge = surgeWarningAt(r.now);
    if (surge && surge.surge.startsAt !== this.lastSurgeAt) {
      this.lastSurgeAt = surge.surge.startsAt;
      this.surgeShownAt = r.now;
    }
  }

  private updateDip(r: Run): void {
    this.dip = dipWarningAt(upcomingDip(r), r.now, settings().reduceFlicker);
    if (this.dip) {
      // On the part, at the board's own anchor for it (board.parts[]), or on the fallback card.
      const at = dipMarkAt(r.session.board, this.dip.partId);
      this.dipAt.x = at.x;
      this.dipAt.y = at.y;
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

  /** The dial card shows only while a dial question is open (src/scenes/hud/jobCard.ts). */
  private updateDial(r: Run, asked: boolean): void {
    const mode: DialMode = dialModeAt(r.now);
    this.dial.setVisible(asked);
    this.dial.setMode(mode, mode === 'reqps' ? 'HOW MANY A SECOND?' : 'BOXES FOR MIDNIGHT');
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
      .text((s.w - 56) / 2 + 8, s.h / 2, line('C6.prompt'), {
        fontFamily: FONT,
        fontSize: '21px',
        color: COLORS.white,
        align: 'center',
        wordWrap: { width: s.w - 80 },
      })
      .setOrigin(0.5);
    const arrow = this.add
      .text(s.w - 34, s.h / 2, '→', { fontFamily: FONT, fontSize: '36px', color: COLORS.magentaText })
      .setOrigin(0.5);
    this.tweens.add({ targets: arrow, x: s.w - 24, duration: 500, yoyo: true, repeat: -1 });
    this.sizingPanel = this.add.container(s.x, s.y, [box, text, arrow]).setVisible(false);
  }

  // ---- job card ----

  private buildJobCard(): void {
    const j = CENTRE.jobCard;
    const k = j.scale;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.6).setOrigin(0);
    dim.setInteractive();
    const art = this.add.image(j.x, j.y, 'hud:job-card').setScale(k);
    this.cardArt = art;
    art.setInteractive({ useHandCursor: true });
    art.on('pointerdown', () => {
      if (!cardGuarded()) this.closeJobCard();
    });
    // Positions inside the 864x1252 card art, scaled.
    const at = (ax: number, ay: number): [number, number] => [
      j.x + (ax - JOB_ART.w / 2) * k,
      j.y + (ay - JOB_ART.h / 2) * k,
    ];
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
    const ok = panel(this, 'hud:button', okX, okY, CENTRE.jobCardOk.w, CENTRE.jobCardOk.h, {
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

  /** The OK button along the job card's bottom edge, in game space. */
  private jobCardOk(): [number, number] {
    return [CENTRE.jobCardOk.x, CENTRE.jobCardOk.y];
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

  // ---- barks and chat ----

  /**
   * One frame of the director: the CueView from this frame, its occurrences, the HUD clock and what
   * only the HUD knows (cueViewOf), then direct(). Each fired id goes out on the bus as `cue` and is
   * routed to the bark queue or a chat.
   */
  private runDirector(f: Frame, sizingOpen: boolean): void {
    const host = this.cueHost;
    host.cardClosed = !this.cardOpen;
    host.dialTouched = this.dialTouched;
    host.sizingOpen = sizingOpen;
    host.bannerShown = this.bannerShown;
    host.decommissionsAfterMidnight = this.decommissionsAfterMidnight;
    const v = cueViewOf(this.view, f, this.occurrences, this.clock, host, this.view);
    const out = direct(this.director, v);
    this.director = out.state;
    for (let i = 0; i < out.fired.length; i++) this.cue(out.fired[i]);
  }

  /**
   * Send a fired line out as bus `cue` and route it: chat lines to their chat, barks to the bark
   * queue. C6.fail.chat is the chat going silent, not a row: it is never posted.
   */
  private cue(id: LineId): void {
    const chat = chatOf(id);
    this.firedCues.push(id);
    bus.emit('cue', { id, kind: chat ? 'chat' : 'bark', at: this.clock });
    if (id === CHAT_SILENCE) return;
    if (chat) this.say(chat, id);
    else if (LINES[id].kind === 'bark') this.comms?.enqueue(id);
  }

  private say(chat: ChatKind, id: LineId): void {
    const entry = chatEntry(id);
    this.chats[chat] = pushChat(this.chats[chat], entry);
    this.merged = pushChat(this.merged, entry);
    this.chatView.show(this.merged);
  }

  private updateFiller(r: Run): void {
    // No filler while the job card is up, nor while the chat is silent (dark at midnight, until the rewind).
    if (this.cardOpen || chatSilenced(this.director)) return;
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

  /** Game-space point to page CSS pixels to a tenth, as the board's hook reports parts (pagePoint). */
  private toPagePoint(x: number, y: number): PagePoint {
    const p = pagePoint({ x, y }, this.game.canvas.getBoundingClientRect());
    return { x: p.x, y: p.y };
  }

  private snapshot(): HudTestState {
    const r = run();
    const f = frame(r);
    const built = this.ready;
    const [okX, okY] = this.jobCardOk();
    const ok = this.toPage(okX, okY);
    const w = surgeWarningAt(r.now);
    return {
      ready: built,
      now: r.now,
      paused: r.paused,
      // The clock, the countdown and the chips are drawn by ClockView and TitleView from the same frame.
      clock: f.clock,
      countdown: countdownText(f.now),
      jobCard: { open: this.cardOpen, x: ok.x, y: ok.y },
      dial: {
        visible: built && this.dial.visible,
        mode: built ? this.dial.mode : dialModeAt(r.now),
        value: built ? this.dial.value : 0,
        locked: built && this.dial.locked,
        minus: this.toPage(RIGHT.dialMinus.x, RIGHT.dialMinus.y),
        plus: this.toPage(RIGHT.dialPlus.x, RIGHT.dialPlus.y),
        set: this.keyPoint(KEY.set),
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
      shown: { trust: shownTrust(f.trust), credits: shownCredits(f.credits) },
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
      dipMark: this.dip ? this.toPagePoint(this.dipAt.x, this.dipAt.y) : null,
      banner: {
        open: this.bannerOpen,
        choice: r.session.banner?.choice ?? null,
        pay: built ? this.bannerButton('pay') : { x: 0, y: 0 },
        ignore: built ? this.bannerButton('ignore') : { x: 0, y: 0 },
        bin: built ? this.bannerButton('bin') : { x: 0, y: 0 },
      },
      // DeckView draws the keys and provides these two sections over this base (the same reads).
      laundry: this.deckView?.laundryHook() ?? {
        available: false,
        cut: laundryCutAt(r) !== null,
        button: this.keyPoint(KEY.cut),
      },
      regroup: this.deckView?.regroupHook() ?? {
        visible: false,
        active: false,
        spent: false,
        button: this.keyPoint(KEY.regroup),
      },
      sizingPrompt: {
        open: built && this.sizingPanel.visible,
        ...this.toPagePoint(SIZING_AT.x, SIZING_AT.y),
      },
      bark: this.comms?.barkSnapshot() ?? { current: null, text: null, history: [] },
      cues: { fired: [...this.firedCues], silenced: chatSilenced(this.director) },
      chat: {
        block: this.chats.block.map((e) => `${e.who}: ${e.text}`),
        stream: this.chats.stream.map((e) => `${e.who}: ${e.text}`),
      },
      timeScale: r.timeScale,
      bounds: built ? this.bounds() : [],
    };
  }

  /** A deck key's centre in page CSS pixels. */
  private keyPoint(i: number): PagePoint {
    const k = BOTTOM.keys[i];
    return this.toPage(k.x, k.y);
  }

  /**
   * Where each restaged piece is drawn right now (its display bounds, in page CSS pixels), with the
   * zone or card it belongs in and whether it shows. For tests; built only when the hook is read.
   */
  private bounds(): HudBounds[] {
    const canvas = this.game.canvas.getBoundingClientRect();
    type Bounded = {
      readonly visible: boolean;
      getBounds(): { x: number; y: number; width: number; height: number };
    };
    const pieces: [string, Home, Bounded][] = [
      ['dial', 'dialCard', this.dial.container],
      ['sizing', 'sizingPrompt', this.sizingPanel],
      ['chat', 'chat', this.chatView.panel],
      ['jobCard', 'jobCard', this.cardArt],
      ['banner', 'banner', this.banner],
    ];
    // Views can be shut down (quit to title) while the hook is still read. The alert band and the
    // deck's keys are AlertView's and DeckView's now; they are listed under the same ids.
    const scope = this.chart.builtPanel;
    if (scope) pieces.unshift(['scope', 'scope', scope]);
    const alert = this.alertView?.container;
    if (alert) pieces.unshift(['alert', 'alert', alert]);
    const keys = this.deckView?.keyHits() ?? [];
    for (let i = 0; i < keys.length; i++)
      pieces.splice(pieces.length - 2, 0, [`deck.${i + 1}`, 'deck', keys[i]]);
    const band = this.comms?.container;
    if (band) pieces.push(['comms', 'comms', band]);
    return pieces.map(([id, home, o]) => {
      const b = o.getBounds();
      const shown = id === 'jobCard' ? this.card.visible : o.visible;
      return {
        id,
        home,
        visible: shown,
        rect: pageRect({ x: b.x, y: b.y, w: b.width, h: b.height }, canvas),
      };
    });
  }
}
