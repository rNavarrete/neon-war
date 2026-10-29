import Phaser from 'phaser';
import { panel } from './hud/panel';
import { bus } from '../game/bus';
import { type Frame, frame } from '../game/frame';
import { type Occurrence, detectOccurrences } from '../game/occurrences';
import { allPortraits } from '../game/portraits';
import { MAX_FRAME_SECONDS, type Run, run } from '../game/run';
import { settings } from '../game/settings';
import { BROWNOUT } from '../sim/brownout';
import type { BannerChoice } from '../sim/economy';
import { LINES, type LineId, line } from '../strings';
import { provideTestState } from '../testHook';
import { CommsView } from './hud/CommsView';
import { type ChartView, scopeViewOf } from './hud/ChartView';
import { ChatFeedView } from './hud/ChatFeedView';
import { chatOf } from './hud/chat';
import {
  type CueView,
  type DirectorState,
  NEW_DIRECTOR,
  chatSilenced,
  cueViewOf,
  direct,
  emptyCueView,
} from './hud/cues';
import { CARD_TEXT_POOL, type CardTextSpec, bannerTexts, dressCardText, jobCardTexts } from './hud/cardText';
import { countdownText } from './hud/format';
import {
  type CoachInput,
  type CoachState,
  NEW_COACH,
  coachHint,
  coachLit,
  coachProblem,
  stepCoach,
} from './hud/coach';
import { type HudBounds, type HudTestState, type PagePoint, hudSection } from './hud/hook';
import { dismissJobCard, jobCardDue, openJobCard } from './hud/jobCard';
import { BANNER_BUTTONS, BOTTOM, CENTRE, COLORS, FONT, type Home, KEY } from './hud/layout';
import { laundryCutAt, upcomingDip } from './hud/pending503';
import { shownCredits, shownTrust } from './hud/title';
import { type DipWarning, dipMarkAt, dipWarningAt, surgeWarningAt } from './hud/warnings';
import { AlertView } from './hud/AlertView';
import { DeckView } from './hud/DeckView';
import { GAME_HEIGHT, GAME_WIDTH } from './BoardScene';
import { storyEnd } from '../story/state';
import { SCENES } from './keys';
import { type LiveFlags, PLAY_FLAGS, flagsFrom } from './live/flags';
import { type CountedObject, type Filtered, PerfMeter, liveTestState } from './live/hook';
import { ZONES, type ZoneId, pagePoint, pageRect } from './live/layout';
import { createViews } from './live/registry';
import type { LiveHost, LiveView } from './live/view';

const C = BROWNOUT.challenges;
const MIDNIGHT = BROWNOUT.clock.midnight;

const HUD_ART = [
  'chart-window',
  'chat-panel',
  'job-card',
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
 * keys 1 REGROUP and 2 CUT 3F DeckView, LIVE CHAT ChatFeedView).
 * Over the feed, only while asked: the job card, the Solace banner and the power-dip warning. It reads run() every frame and only calls the run's actions; the rules
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
  /** The perf hook's meter (tech-7): display-list walks once a second, and which view made each object. */
  private perf = new PerfMeter(false);
  private readonly madeBy = new WeakMap<object, ZoneId>();
  /** The zone whose view is creating or updating now, so the objects it adds are counted as its. */
  private building: ZoneId | null = null;
  /** Bark and filler clock: real seconds times the test speed, stopped while the board is held. */
  private clock = 0;
  private cardOpen = false;
  private earlyClick: (() => void) | null = null;
  private cardClickedEarly = false;
  private unsubscribe: (() => void)[] = [];

  private director: DirectorState = NEW_DIRECTOR;
  /** The tutorial coach: what the player is stuck on and how long (src/scenes/hud/coach.ts). */
  private coach: CoachState = NEW_COACH;
  /** What the board was last told to light: the problem's key and whether it showed. */
  private coachShown: string | null = null;
  /** Every nudge the coach said this run, in order (for the hook). */
  private coachSaid: LineId[] = [];
  /** A card or wire is in hand on the board: the coach waits rather than talk over the drag. */
  private dragging = false;
  private readonly coachInput: { -readonly [K in keyof CoachInput]: CoachInput[K] } = {
    now: 0,
    paused: false,
    cardOpen: false,
    waitingForFirstBuild: false,
    rescued: false,
    parts: [],
    wires: [],
    dead: [],
    offline: [],
    load: {},
    dropped: 0,
  };
  private bannerShown = false;
  private decommissionsAfterMidnight = 0;
  private lastSurgeAt = -1;
  /** Sim time the current surge warning first went on screen. */
  private surgeShownAt = -1;
  private dip: DipWarning | null = null;
  /** Where the dip mark was last placed, in game pixels (one object, reused). */
  private readonly dipAt: { x: number; y: number } = { x: 0, y: 0 };
  /** Every id the director fired this run, in order, as sent out on the bus as `cue` (for the hook). */
  private firedCues: LineId[] = [];
  /** What the cues read this frame (cueViewOf writes into it; it is also the last frame's view). */
  private readonly view: CueView = emptyCueView();
  /** What only the HUD knows, handed to cueViewOf; one object reused every update. */
  private readonly cueHost: {
    cardClosed: boolean;
    bannerShown: boolean;
    decommissionsAfterMidnight: number;
  } = {
    cardClosed: false,
    bannerShown: false,
    decommissionsAfterMidnight: 0,
  };

  // Views, built in create().
  private chart!: ChartView;
  /** The comms band (the registry's comms view): every bark the cue table fires goes to it. */
  private comms: CommsView | null = null;
  /** The alert band and the deck (registry views): hud.bounds and hud.laundry/regroup read them. */
  private alertView: AlertView | null = null;
  private deckView: DeckView | null = null;
  /** LIVE CHAT (the registry's chat view): it hears the cue table's chat ids on the bus. */
  private chatFeed: ChatFeedView | null = null;
  private dipMark!: Phaser.GameObjects.Container;
  private dipText!: Phaser.GameObjects.Text;
  private card!: Phaser.GameObjects.Container;
  private cardArt!: Phaser.GameObjects.Image;
  private banner!: Phaser.GameObjects.Container;
  private bannerOpen = false;
  /**
   * The job card's and the banner's words: one pool of texts, dressed for whichever card shows (the
   * banner only comes after the card is closed), so the host stays inside its 13 texts.
   */
  private cardTexts: Phaser.GameObjects.Text[] = [];
  private readonly jobWords: CardTextSpec[] = jobCardTexts();
  private readonly bannerWords: CardTextSpec[] = bannerTexts();
  /** Which card the pooled texts are dressed for now. */
  private dressedFor: 'job' | 'banner' | null = null;

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
    this.chatFeed = (this.views.find((v) => v instanceof ChatFeedView) as ChatFeedView | undefined) ?? null;
    provideTestState('live', () => liveTestState(this.game.canvas.getBoundingClientRect(), this.views));
    this.perf = new PerfMeter(this.flags.lite);
    provideTestState('perf', () => this.perf.state);
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
    // The Live screen's views go first (every registry zone has its real view; none is a placeholder).
    // Each object a view adds is remembered as its own, for the perf hook's per-zone counts.
    const onAdded = (o: object): void => {
      if (this.building) this.madeBy.set(o, this.building);
    };
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
    this.unsubscribe.push(() => this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded));
    // A scene over the board pauses the HUD, and with it the samples: take one as it stops.
    const onPause = (): void => {
      this.samplePerf();
    };
    this.events.on(Phaser.Scenes.Events.PAUSE, onPause);
    this.unsubscribe.push(() => this.events.off(Phaser.Scenes.Events.PAUSE, onPause));
    for (const v of this.views) {
      this.building = v.zone;
      v.create(this, this.hostFor(v));
    }
    this.building = null;
    this.chart = scopeViewOf(this.views);
    this.buildDipMark();
    this.cardTexts = [];
    this.dressedFor = null;
    for (let i = 0; i < CARD_TEXT_POOL; i++) this.cardTexts.push(this.add.text(0, 0, ''));
    this.buildBanner();
    this.buildJobCard();

    this.unsubscribe.push(
      bus.on('action', (a) => {
        if (a.type === 'decommission' && run().now >= MIDNIGHT) this.decommissionsAfterMidnight++;
      }),
      bus.on('drag', (d) => {
        this.dragging = d.kind !== null;
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
    this.samplePerf();
    this.ready = true;
  }

  update(_time: number, delta: number): void {
    const r = run();
    if (r !== this.runRef) this.resetForRun(r);
    // The frame's real length, capped as run().tick caps it, so the HUD clock keeps step with the
    // sim. Phaser's smoothed delta falls back to an old frame's length on a frame over 200 ms, which
    // in a slow headless browser at test speed 20 left this clock (the band, the cue delays, a voice
    // clip's hold) running several times slower than the sim it narrates.
    const real = Math.min(this.game.loop.rawDelta / 1000, MAX_FRAME_SECONDS);
    const step = r.paused ? 0 : real * r.speed;
    this.clock += step;
    const f = this.readFrame(r);
    this.liveClock.now = this.clock;
    this.liveClock.dt = step;
    for (let i = 0; i < this.views.length; i++) {
      this.building = this.views[i].zone;
      this.views[i].update(f, this.liveClock, this.occurrences);
    }
    this.building = null;

    this.updateSurge(r);
    this.updateDip(r);
    this.updateBanner(r);

    this.runDirector(f);
    this.runCoach(f, step);
    if (this.perf.frame(delta)) this.samplePerf();
  }

  /** One perf sample: walk both display lists (tech-7), and send it out as bus `perfSample`. */
  private samplePerf(): PerfMeter['state'] {
    const board = this.scene.get(SCENES.board) as Phaser.Scene | null;
    const s = this.perf.sample({
      now: run().now,
      board: board?.children?.list ?? [],
      hud: this.children.list,
      cameras: [...(board?.cameras?.cameras ?? []), ...this.cameras.cameras] as unknown as Filtered[],
      views: this.views,
      ownerOf: (o: CountedObject) => this.madeBy.get(o),
    });
    const objects = s.objects.board + s.objects.hud;
    bus.emit('perfSample', { at: this.clock, fps: s.fps.avg, objects, texts: s.texts, graphics: s.graphics });
    return s;
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
    };
  }

  // ---- per-run state ----

  private resetForRun(r: Run): void {
    this.runRef = r;
    this.lastFrame = null;
    this.occurrences.length = 0;
    this.director = NEW_DIRECTOR;
    this.coach = NEW_COACH;
    this.coachSaid = [];
    this.publishCoach(null);
    this.comms?.reset();
    this.chatFeed?.reset(this.clock);
    this.bannerShown = false;
    this.decommissionsAfterMidnight = 0;
    // A fresh run: nothing carries over from the last run's view (dropped in C6, the rescue clock).
    Object.assign(this.view, emptyCueView());
    this.firedCues = [];
    this.lastSurgeAt = -1;
    if (this.ready) {
      this.chart.ring.clear();
      if (jobCardDue(r)) {
        this.cardOpen = true;
        openJobCard(r);
        this.dressCards('job');
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
    // The words (rate, title, who, what, bar, pay, OK) are the pooled card texts (cardText.ts).
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
    this.card = this.add.container(0, 0, [dim, art, ok]).setVisible(this.cardOpen);
    this.dressCards('job');
  }

  /**
   * Move the pooled card texts into the card that is about to show and dress them for it. Runs when
   * a card opens, never per frame; the other card is hidden then (the banner waits for the job card).
   */
  private dressCards(which: 'job' | 'banner'): void {
    if (this.dressedFor === which) return;
    this.dressedFor = which;
    const into = which === 'job' ? this.card : this.banner;
    const words = which === 'job' ? this.jobWords : this.bannerWords;
    for (let i = 0; i < this.cardTexts.length; i++) {
      const t = this.cardTexts[i];
      into.add(t);
      dressCardText(t, words[i]);
    }
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
    // The title, the body and the three button words are the pooled card texts (cardText.ts).
    const choices: BannerChoice[] = ['pay', 'ignore', 'bin'];
    const buttons = choices.map((choice) => {
      const p = BANNER_BUTTONS[choice];
      const zone = this.add
        .zone(p.dx * k, p.dy * k, p.w * k + 8, p.h * k + 8)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.chooseBanner(choice));
      return zone;
    });
    this.banner = this.add.container(b.x, b.y, [art, ...buttons]).setVisible(false);
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
      this.dressCards('banner');
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
  private runDirector(f: Frame): void {
    const host = this.cueHost;
    host.cardClosed = !this.cardOpen;
    host.bannerShown = this.bannerShown;
    host.decommissionsAfterMidnight = this.decommissionsAfterMidnight;
    const v = cueViewOf(this.view, f, this.occurrences, this.clock, host, this.view);
    const out = direct(this.director, v);
    this.director = out.state;
    for (let i = 0; i < out.fired.length; i++) this.cue(out.fired[i]);
  }

  /**
   * One frame of the tutorial coach: what the player is stuck on (coachProblem), timed on the HUD
   * clock while the board runs and nothing is in hand. A due nudge goes to the comms band like a
   * bark and out on the bus for the chat; a change in what is lit goes out as bus `coach` for the
   * board and the alert band.
   */
  private runCoach(f: Frame, dt: number): void {
    const c = this.coachInput;
    c.now = f.now;
    c.paused = f.paused;
    c.cardOpen = this.cardOpen;
    c.waitingForFirstBuild = f.waitingForFirstBuild;
    c.rescued = f.rescued;
    c.parts = f.parts;
    c.wires = f.wires;
    c.dead = f.dead;
    c.offline = f.offline;
    c.load = f.flow.load;
    c.dropped = f.dropped;
    // Recomputed only when the sim moved or the card closed: the same frame gives the same problem.
    const p = f === this.lastCoachFrame && this.cardOpen === this.lastCoachCard ? this.coach.problem : coachProblem(c);
    this.lastCoachFrame = f;
    this.lastCoachCard = this.cardOpen;
    const out = stepCoach(this.coach, p, dt, f.paused || this.dragging);
    this.coach = out.state;
    if (out.nudge) {
      this.coachSaid.push(out.nudge);
      this.comms?.enqueue(out.nudge);
      bus.emit('coachNudge', { step: out.state.problem?.step ?? '', id: out.nudge, at: this.clock });
    }
    const shown = coachLit(this.coach) && this.coach.problem ? this.coach.problem.key : null;
    if (shown !== this.coachShown) this.publishCoach(shown);
  }

  private lastCoachFrame: Frame | null = null;
  private lastCoachCard = false;

  /** Tell the board and the band what the coach lights now (`key` null: nothing). */
  private publishCoach(key: string | null): void {
    this.coachShown = key;
    const p = key !== null ? this.coach.problem : null;
    bus.emit('coach', {
      step: p?.step ?? null,
      cards: p?.cards ?? [],
      parts: p?.parts ?? [],
      wire: p?.wire ?? null,
      hint: p ? coachHint(this.coach) : null,
    });
  }

  /**
   * Send a fired line out as bus `cue` and route it: barks to the bark queue. Chat ids are the chat
   * view's: it hears the cue and posts it (ChatFeedView; C6.fail.chat silences it instead of a row).
   */
  private cue(id: LineId): void {
    const chat = chatOf(id);
    this.firedCues.push(id);
    bus.emit('cue', { id, kind: chat ? 'chat' : 'bark', at: this.clock });
    if (!chat && LINES[id].kind === 'bark') this.comms?.enqueue(id);
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
      chart: built
        ? {
            demand: this.chart.ring.lastDemand,
            capacity: this.chart.ring.lastCapacity,
            ceiling: this.chart.ceiling,
          }
        : { demand: 0, capacity: 0, ceiling: 0 },
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
      bark: this.comms?.barkSnapshot() ?? { current: null, text: null, history: [] },
      cues: { fired: [...this.firedCues], silenced: chatSilenced(this.director) },
      coach: {
        step: this.coach.problem?.step ?? null,
        key: this.coach.problem?.key ?? null,
        lit: coachLit(this.coach),
        stuckFor: this.coach.stuckFor,
        hint: coachHint(this.coach),
        cards: [...(this.coach.problem?.cards ?? [])],
        parts: [...(this.coach.problem?.parts ?? [])],
        wire: this.coach.problem?.wire ?? null,
        said: [...this.coachSaid],
      },
      // The chat view provides hud.chat (block and stream kept, the feed beside them) over this.
      chat: { block: [], stream: [] },
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
    const chatPanel = this.chatFeed?.panel;
    if (chatPanel) pieces.push(['chat', 'chat', chatPanel]);
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
