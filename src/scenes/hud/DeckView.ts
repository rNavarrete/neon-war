// The deck (ZONES.deck) as a Live screen view: the two keys on the right (the headroom bar that sat on
// the left is a line in the gauge now, 30 Oct 2026), 1 REGROUP and 2 CUT 3F, each clicked or pressed on the keyboard. (3 SET went
// with the estimate dial; its slot is left empty.)
// The rules are pure in deck.ts; this file draws them and calls the run's actions:
//
//   1 REGROUP  run().regroup(): quarter speed for 10 s, once, after the crew hands it over
//   2 CUT 3F   cutLaundry(run()) with the wire-cut sound, in the district surge
//
// A press does nothing while the job card or the banner is open, while the board is held (the pause
// menu, a story scene, a failure). Every key
// sits at its final place and is interactive from its first frame: a key becoming ready changes only
// its colour and alpha, so a click the moment it lights lands. Regroup's ready pulse is steady under
// reduce flicker (and the ?test lite flag).
//
// These are the only keys on the deck (the HUD scene's own legacy keys are gone): this view takes
// every click there and every digit 1, 2; hud.regroup, hud.laundry and hud.deck mirror it, and the
// HUD scene lists its hit areas as hud.bounds deck.1..2.
//
// Phaser is a type here only, so the registry and its node tests can import this file.

import type Phaser from 'phaser';
import type { Bus } from '../../game/bus';
import type { Frame } from '../../game/frame';
import { run } from '../../game/run';
import { settings } from '../../game/settings';
import { line } from '../../strings';
import { type Point, type Rect, pagePoint } from '../live/layout';
import type { LiveBudget, LiveClock, LiveHost, LiveView } from '../live/view';
import {
  type CutKey,
  type DeckInput,
  type DeckState,
  KEY_NAMES,
  type KeyName,
  type RegroupKey,
  cutDoneWord,
  emptyDeck,
  keyAlpha,
  keyLit,
  keyRects,
  keyWords,
  pressActs,
  stepDeck,
  tooltipAt,
} from './deck';
import { jobCardDue } from './jobCard';
import { COLORS, FONT } from './layout';
import { cutLaundry } from './pending503';
import { type PagePoint, provideHudSection } from './hook';
import { register as registerLocate } from './locate';
import { KIT, type KeyCap, keyCap } from './kit';
import { GAUGES_DEPTH } from './panel';
import { preloadArt, resolveArt } from '../plates';

/** One key as the hook sees it. */
export interface DeckKeyTestState {
  /** The key's centre in page CSS pixels. */
  x: number;
  y: number;
  /** Ready to press. */
  lit: boolean;
  /** The alpha it is drawn at now. */
  alpha: number;
  /** Takes clicks (from its first frame, whatever its state). */
  interactive: boolean;
  /** The picked keycap drawn now (idle, ready, or pressed just after a press that acted); null in code. */
  cap?: KeyCap | null;
}

/** One press of a key, by click or keyboard, and whether it acted. */
export interface DeckPress {
  key: KeyName;
  via: 'click' | 'key';
  acted: boolean;
  /** Sim seconds. */
  at: number;
}

/** What the hook mirrors as hud.deck. */
export interface DeckTestState {
  regroup: RegroupKey;
  cut: CutKey;
  ring: number;
  pulse: number;
  blocked: boolean;
  bannerOpen: boolean;
  keys: Record<KeyName, DeckKeyTestState>;
  /** The CUT 3F tooltip is showing (hover). */
  tooltip: boolean;
  /** The last presses, oldest first (capped). */
  presses: DeckPress[];
  /** Every press since the view was made, counted. */
  pressed: number;
}

declare module './hook' {
  interface HudTestState {
    /** The deck's keys (gauges-8). */
    deck?: DeckTestState;
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The done cut's word, built once. */
const CUT_DONE = cutDoneWord();

/** How many presses hud.deck.presses keeps. */
export const DECK_PRESSES = 20;

/** The digit keys' key codes: 1 and 2 on the main row. */
const KEY_CODES: Readonly<Record<KeyName, number>> = { one: 49, two: 50 };

/** The deck's kit pieces: the three keycaps (docs/ART-REQUESTS.md batch 4). */
const DECK_KIT = [KIT.keyIdle, KIT.keyReady, KIT.keyPressed] as const;

/** One drawn key. */
interface KeyParts {
  /** The picked keycap, its texture swapped by state (null when the scene has no art: code plates). */
  cap: Phaser.GameObjects.Image | null;
  /** The cap last shown. */
  shownCap: KeyCap | null;
  /** HUD time of the last press that acted, for the pressed cap; null before one. */
  pressedAt: number | null;
  /** The key's code plate unlit and lit, drawn once, only without the picked keycaps. */
  dim: Phaser.GameObjects.Graphics | null;
  lit: Phaser.GameObjects.Graphics | null;
  digit: Phaser.GameObjects.Text;
  word: Phaser.GameObjects.Text;
  /** The hit area (null on a scene without zones, such as a node test's stub). */
  zone: Phaser.GameObjects.Zone | null;
  rect: Rect;
  /** What it was last drawn as: lit, and its alpha. */
  shownLit: boolean | null;
  alpha: number;
  word0: string;
}

export class DeckView implements LiveView {
  readonly zone = 'deck' as const;
  readonly budget: LiveBudget = { objects: 18, texts: 7 };
  readonly deck: DeckState = emptyDeck();
  private keys: Partial<Record<KeyName, KeyParts>> = {};
  private ring: Phaser.GameObjects.Graphics | null = null;
  /** The HUD clock this frame (for the pressed cap). */
  private hudNow = 0;
  /** The texture each cap draws from, when the scene has it. */
  private capTexture: Partial<Record<KeyCap, string>> = {};
  private back: Phaser.GameObjects.Graphics | null = null;
  private tooltip: Phaser.GameObjects.Text | null = null;
  private scene: Phaser.Scene | null = null;
  private host: LiveHost | null = null;
  private bus: Bus | null = null;
  private off: (() => void)[] = [];
  private now = 0;
  private laundryCut = false;
  /** The ring's last drawn step (of 60); 0 is the empty ring the graphics starts as. */
  private drawnRing = 0;
  private hovering = false;
  private shownTooltip = false;
  private readonly presses: DeckPress[] = [];
  private pressed = 0;
  /** What the deck reads, one object refilled every frame. */
  private readonly input: Mutable<DeckInput> = {
    now: 0,
    paused: true,
    regroup: { charges: 0, handedOver: false, left: 0 },
    laundryCut: null,
    laundryCutAvailable: false,
    banner: null,
    cardOpen: false,
  };

  preload(scene: Phaser.Scene): void {
    preloadArt(scene as never, [...DECK_KIT]);
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.scene = scene;
    this.host = host;
    this.bus = host.bus;
    Object.assign(this.deck, emptyDeck());
    this.presses.length = 0;
    this.pressed = 0;
    this.drawnRing = 0;
    this.hovering = false;
    this.shownTooltip = false;

    const add = scene.add;
    const rects = keyRects();
    // The picked keycaps, when the scene has their files (a node test's stub does not).
    const tx = scene.textures as Partial<Phaser.Textures.TextureManager> | undefined;
    const has = (key: string): string | null => {
      const a = resolveArt(key);
      return !a.fallback &&
        typeof add.image === 'function' &&
        typeof tx?.get === 'function' &&
        tx.exists?.(a.texture)
        ? a.texture
        : null;
    };
    this.capTexture = {};
    for (const cap of [KIT.keyIdle, KIT.keyReady, KIT.keyPressed] as const) {
      const t = has(cap);
      if (t) this.capTexture[cap] = t;
    }
    const caps = Object.keys(this.capTexture).length === 3;
    // One opaque backing under the keys, never dimmed, so the HUD's own keys never show through.
    const back = add.graphics();
    back.fillStyle(COLORS.ink, 1);
    for (const name of KEY_NAMES) {
      const r = rects[name];
      back.fillRoundedRect(r.x, r.y, r.w, r.h, 6);
    }
    back.setDepth(GAUGES_DEPTH);
    this.back = back;
    for (const name of KEY_NAMES) {
      const r = rects[name];
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const words = keyWords(name);
      // The keycap at its display size, 80 x 64: the 160 x 128 file at the request's k 0.5.
      const cap = caps
        ? add.image(cx, cy, this.capTexture[KIT.keyIdle] as string).setDisplaySize(r.w, r.h)
        : null;
      const dim = caps ? null : drawPlate(add.graphics(), r, false);
      const lit = caps ? null : drawPlate(add.graphics(), r, true).setVisible(false);
      const digit = add
        .text(cx, cy - 10, words.digit, { fontFamily: FONT, fontSize: '26px', color: COLORS.dim })
        .setOrigin(0.5);
      const word = add
        .text(cx, cy + 17, words.word, { fontFamily: FONT, fontSize: '12px', color: COLORS.dim })
        .setOrigin(0.5);
      // The hit area: at its final place and interactive from the first frame, whatever the key shows.
      const zone = typeof add.zone === 'function' ? add.zone(cx, cy, r.w, r.h).setInteractive() : null;
      zone?.on('pointerdown', () => this.press(name, 'click'));
      if (name === 'two') {
        zone?.on('pointerover', () => {
          this.hovering = true;
        });
        zone?.on('pointerout', () => {
          this.hovering = false;
        });
      }
      for (const o of [cap, dim, lit, digit, word]) o?.setDepth(GAUGES_DEPTH);
      zone?.setDepth(GAUGES_DEPTH);
      this.keys[name] = {
        cap,
        shownCap: cap ? KIT.keyIdle : null,
        pressedAt: null,
        dim,
        lit,
        digit,
        word,
        zone,
        rect: r,
        shownLit: null,
        alpha: -1,
        word0: words.word,
      };
    }
    this.ring = add.graphics().setDepth(GAUGES_DEPTH);
    const tip = tooltipAt(host.rect);
    this.tooltip = add
      .text(tip.x, tip.y, line('C4.cut.button'), {
        fontFamily: FONT,
        fontSize: '13px',
        color: COLORS.heroText,
        backgroundColor: 'rgba(5,7,15,0.9)',
        padding: { x: 6, y: 2 },
      })
      .setOrigin(1, 0)
      .setDepth(GAUGES_DEPTH)
      .setVisible(false);

    // The digits: caught on their Key objects, which Phaser runs before the scene's keydown-ONE..THREE
    // events, and stopped there, so a press acts once, here, under this view's guards.
    const kb = scene.input?.keyboard;
    if (kb) {
      for (const name of KEY_NAMES) {
        const key = kb.addKey(KEY_CODES[name], false, false);
        const onDown = (_k: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void => {
          event.stopImmediatePropagation();
          this.press(name, 'key');
        };
        key.on('down', onDown);
        this.off.push(() => {
          key.off('down', onDown);
          kb.removeKey(key, true);
        });
      }
    }

    // The leader line ends at a key's middle (game px, made once): key:one, key:two.
    for (const name of KEY_NAMES) {
      const r = rects[name];
      const mid = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      this.off.push(registerLocate(`key:${name}`, () => mid));
    }
    this.off.push(provideHudSection('deck', () => this.snapshot()));
    this.off.push(provideHudSection('regroup', () => this.regroupHook()));
    this.off.push(provideHudSection('laundry', () => this.laundryHook()));
  }

  update(frame: Frame, clock: LiveClock): void {
    this.hudNow = clock.now;
    this.now = frame.now;
    this.laundryCut = frame.laundryCut !== null;
    const steady = settings().reduceFlicker || (this.host?.flags.lite ?? false);
    const d = this.deck;
    // The job card's open state is the HUD's rule over the run (it also holds the board).
    const cardOpen = jobCardDue(run());
    const input = this.input;
    input.now = frame.now;
    input.paused = frame.paused;
    input.regroup = frame.regroup;
    input.laundryCut = frame.laundryCut;
    input.laundryCutAvailable = frame.laundryCutAvailable;
    input.banner = frame.banner;
    input.cardOpen = cardOpen;
    stepDeck(d, input, clock.now, steady);
    for (const name of KEY_NAMES) this.drawKey(name);
    this.drawRing();
    const tip = this.hovering && d.cut === 'ready';
    if (tip !== this.shownTooltip) {
      this.shownTooltip = tip;
      this.tooltip?.setVisible(tip);
    }
  }

  /** A click or a digit on `key`: act if the deck lets it, and remember the press for the hook. */
  press(key: KeyName, via: 'click' | 'key'): void {
    const acted = pressActs(this.deck, key) && this.act(key);
    const k = this.keys[key];
    if (acted && k) k.pressedAt = this.hudNow;
    this.pressed++;
    this.presses.push({ key, via, acted, at: this.now });
    if (this.presses.length > DECK_PRESSES) this.presses.shift();
  }

  /** Call the run's action behind a key; true when it took. */
  private act(key: KeyName): boolean {
    const r = run();
    if (key === 'one') return r.regroup().ok;
    const res = cutLaundry(r);
    if (res.ok) this.bus?.emit('sfx', { key: 'wire-cut' });
    return res.ok;
  }

  /** Show a key lit or dim and set its words when its state changes; set its alpha when that changes. */
  private drawKey(name: KeyName): void {
    const k = this.keys[name];
    if (!k) return;
    const lit = keyLit(this.deck, name);
    const word = name === 'two' && this.deck.cut === 'done' ? CUT_DONE : k.word0;
    if (lit !== k.shownLit || word !== k.word.text) {
      k.shownLit = lit;
      k.lit?.setVisible(lit);
      k.dim?.setVisible(!lit);
      const color = lit ? COLORS.heroText : COLORS.dim;
      k.digit.setColor(color);
      if (word !== k.word.text) k.word.setText(word).setFontSize(word.length > 8 ? 11 : 12);
      k.word.setColor(color);
      if (k.zone?.input) k.zone.input.cursor = lit ? 'pointer' : '';
    }
    // The cap: pressed for a moment after a press that acted, else ready when lit, else idle.
    if (k.cap) {
      const cap = keyCap(lit, this.hudNow, k.pressedAt);
      if (cap !== k.shownCap) {
        k.shownCap = cap;
        const t = this.capTexture[cap];
        if (t) k.cap.setTexture(t).setDisplaySize(k.rect.w, k.rect.h);
      }
    }
    const alpha = keyAlpha(this.deck, name);
    if (alpha !== k.alpha) {
      k.alpha = alpha;
      k.cap?.setAlpha(alpha);
      k.dim?.setAlpha(alpha);
      k.lit?.setAlpha(alpha);
      k.digit.setAlpha(alpha);
      k.word.setAlpha(alpha);
    }
  }

  /** Regroup's ring round its digit, draining as its slow time runs out (redrawn per 1/60 of it). */
  private drawRing(): void {
    const g = this.ring;
    const k = this.keys.one;
    if (!g || !k) return;
    const step = Math.round(this.deck.ring * 60);
    if (step === this.drawnRing) return;
    this.drawnRing = step;
    g.clear();
    if (step <= 0) return;
    const cx = k.rect.x + k.rect.w / 2;
    const cy = k.rect.y + k.rect.h / 2 - 10;
    const start = -Math.PI / 2;
    g.lineStyle(3, COLORS.cyan, 0.95);
    g.beginPath();
    g.arc(cx, cy, 19, start, start + (step / 60) * Math.PI * 2, false);
    g.strokePath();
  }

  /** A key's centre in page CSS pixels (test-only; allocates). */
  private keyPage(name: KeyName): PagePoint {
    const k = this.keys[name];
    const r = k?.rect ?? keyRects()[name];
    const centre: Point = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const canvas = this.scene?.game?.canvas?.getBoundingClientRect();
    return canvas ? pagePoint(centre, canvas) : { x: centre.x, y: centre.y };
  }

  /** hud.regroup, built only when the hook is read. */
  regroupHook(): { visible: boolean; active: boolean; spent: boolean; button: PagePoint } {
    return {
      visible: this.deck.regroup !== 'hidden',
      active: this.deck.regroup === 'active',
      spent: this.deck.regroup === 'spent',
      button: this.keyPage('one'),
    };
  }

  /** hud.laundry, built only when the hook is read. */
  laundryHook(): { available: boolean; cut: boolean; button: PagePoint } {
    return { available: this.deck.cut === 'ready', cut: this.laundryCut, button: this.keyPage('two') };
  }

  /** The keys' hit areas in KEY_NAMES order (hud.bounds deck.1..3); empty before create or without zones. */
  keyHits(): Phaser.GameObjects.Zone[] {
    const out: Phaser.GameObjects.Zone[] = [];
    for (const name of KEY_NAMES) {
      const z = this.keys[name]?.zone;
      if (z) out.push(z);
    }
    return out;
  }

  /** hud.deck, built only when the hook is read. */
  snapshot(): DeckTestState {
    const d = this.deck;
    const keys = {} as Record<KeyName, DeckKeyTestState>;
    for (const name of KEY_NAMES) {
      const p = this.keyPage(name);
      const k = this.keys[name];
      keys[name] = {
        x: p.x,
        y: p.y,
        lit: keyLit(d, name),
        alpha: k?.alpha ?? 0,
        interactive: k?.zone?.input?.enabled ?? false,
        cap: k?.shownCap ?? null,
      };
    }
    return {
      regroup: d.regroup,
      cut: d.cut,
      ring: d.ring,
      pulse: d.pulse,
      blocked: d.blocked,
      bannerOpen: d.bannerOpen,
      keys,
      tooltip: this.shownTooltip,
      presses: this.presses.map((p) => ({ ...p })),
      pressed: this.pressed,
    };
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    for (const name of KEY_NAMES) {
      const k = this.keys[name];
      if (!k) continue;
      k.cap?.destroy();
      k.dim?.destroy();
      k.lit?.destroy();
      k.digit.destroy();
      k.word.destroy();
      k.zone?.destroy();
    }
    this.keys = {};
    this.ring?.destroy();
    this.ring = null;
    this.back?.destroy();
    this.back = null;
    this.tooltip?.destroy();
    this.tooltip = null;
    this.scene = null;
    this.host = null;
    this.bus = null;
  }
}

/** Draw a key's plate once: dark with a grey edge, or lit with an amber wash and edge. */
function drawPlate(g: Phaser.GameObjects.Graphics, r: Rect, lit: boolean): Phaser.GameObjects.Graphics {
  g.fillStyle(COLORS.ink, 0.92);
  g.fillRoundedRect(r.x, r.y, r.w, r.h, 6);
  if (lit) {
    g.fillStyle(COLORS.hero, 0.14);
    g.fillRoundedRect(r.x, r.y, r.w, r.h, 6);
  }
  g.lineStyle(2, lit ? COLORS.hero : COLORS.unlit, lit ? 1 : 0.8);
  g.strokeRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 6);
  return g;
}
