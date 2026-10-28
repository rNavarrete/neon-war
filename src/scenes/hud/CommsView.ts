// The comms band (ZONES.comms) as a Live screen view: the one home of every board bark. Five round
// slots (TRIAGE, REI, MIKA, OZZIE, HOUSE; the crew dark until they are in), a divider, the speaker's
// nameplate with the line's tag pill, and the line typed out in amber. Lux has no slot: her lines
// show with the LUX tag while her cam answers. The band never holds the run.
//
// The HUD scene hands it each bark the cue table fires (enqueue); the pure model in comms.ts
// decides what shows and for how long. When a line starts the band emits bus `line` (and TRIAGE's
// blip), when it ends `lineEnd`; a `voiceStart` for the line holds it until the clip ends + 0.6 s.
// hud.comms mirrors it for tests (src/scenes/live/views/comms.ts), and hud.bark keeps the ids and
// text BarkView reported.
//
// Phaser is a type here only, so the registry and its node tests can import this file.

import type Phaser from 'phaser';
import type { Bus } from '../../game/bus';
import type { Frame } from '../../game/frame';
import { TEXT_CPS, settings } from '../../game/settings';
import { LINES, type LineId } from '../../strings';
import { COMMS_AVATARS, avatarSource, preloadAvatars, roundAvatar } from '../avatars';
import { type Rect, pagePoint, pageRect } from '../live/layout';
import type { LiveBudget, LiveClock, LiveHost, LiveView } from '../live/view';
import { type CommsTestState, provideCommsHook } from '../live/views/comms';
import {
  COMMS_SLOTS,
  type CommsLayout,
  type CommsState,
  NO_COMMS,
  bandAlpha,
  commsLayout,
  enqueueComms,
  extendForVoice,
  nameOf,
  slotOf,
  stepComms,
  tag,
  triageMood,
  typedOf,
} from './comms';
import { COLORS, FONT, FONT_SANS } from './layout';
import { panel } from './panel';

/** The slot avatars' diameter: the slot's circle, r 42. */
const AVATAR_SIZE = 84;
/** Crew slots before the rescue: dark silhouettes (lead conflict 'Crew slots before the rescue'). */
const DARK_TINT = 0x55556a;
const DARK_ALPHA = 0.3;
/** The nameplate a dark crew slot wears. */
const DARK_NAME = '---';
/** The band's own words: its title. Slot names are the crew's names; tags are lineMeta's. */
export const COMMS_TEXT = { title: 'COMMS' } as const;

/** Bus events remembered for the hook. */
const EMITTED_MAX = 24;

/** HOUSE's chip: the door for Grandma, the TV for the TV downstairs. */
const houseChip = (speaker: string): string =>
  speaker.startsWith('TV') ? COMMS_AVATARS.HOUSE[1] : COMMS_AVATARS.HOUSE[0];

const TAG_COLOR: Readonly<Record<string, number>> = {
  HINT: COLORS.cyan,
  WARNING: COLORS.red,
  CREW: COLORS.hero,
  LUX: COLORS.magenta,
  HOUSE: COLORS.unlit,
};

/** The bark state in the shape hud.bark has always reported. */
export interface BarkSnapshot {
  current: LineId | null;
  text: string | null;
  history: LineId[];
}

export class CommsView implements LiveView {
  readonly zone = 'comms' as const;
  readonly budget: LiveBudget = { objects: 24, texts: 13 };

  /** The band's model; replaced, never mutated. */
  state: CommsState = NO_COMMS;
  private clock = 0;
  private scene: Phaser.Scene | null = null;
  private bus: Bus | null = null;
  private rect: Rect | null = null;
  private L: CommsLayout | null = null;
  private off: (() => void)[] = [];
  private emitted: string[] = [];

  private root: Phaser.GameObjects.Container | null = null;
  private ring: Phaser.GameObjects.Graphics | null = null;
  private pill: Phaser.GameObjects.Graphics | null = null;
  private faces: Phaser.GameObjects.Image[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private nameText: Phaser.GameObjects.Text | null = null;
  private tagText: Phaser.GameObjects.Text | null = null;
  private lineText: Phaser.GameObjects.Text | null = null;

  /** What is drawn now, so update only touches what changed. */
  private shownTyped = -1;
  private shownAlpha = -1;
  private shownPresent: boolean | null = null;
  private houseTextures: [string, string] = ['', ''];
  private houseArt: [boolean, boolean] = [false, false];
  private houseGlyph: Phaser.GameObjects.Graphics | null = null;

  preload(scene: Phaser.Scene): void {
    preloadAvatars(scene as never, [
      COMMS_AVATARS.TRIAGE,
      COMMS_AVATARS.REI,
      COMMS_AVATARS.MIKA,
      COMMS_AVATARS.OZZIE,
      ...COMMS_AVATARS.HOUSE,
    ]);
  }

  create(scene: Phaser.Scene, host: LiveHost): void {
    this.scene = scene;
    this.bus = host.bus;
    this.rect = host.rect;
    const L = commsLayout(host.rect);
    this.L = L;
    const add = scene.add;
    const r = host.rect;

    const plate = scene.textures.exists('hud:textbox')
      ? panel(scene, 'hud:textbox', r.x, r.y, r.w, r.h, { k: 0.6 })
      : add.rectangle(r.x, r.y, r.w, r.h, COLORS.ink, 0.9).setOrigin(0);
    const title = add.text(L.title.x, L.title.y, COMMS_TEXT.title, {
      fontFamily: FONT,
      fontSize: '13px',
      color: COLORS.cyanText,
    });

    const slots = add.graphics();
    for (const s of L.slots) {
      slots.fillStyle(COLORS.ink, 0.85);
      slots.fillCircle(s.x, s.y, s.r);
      slots.lineStyle(2, COLORS.unlit, 0.9);
      slots.strokeCircle(s.x, s.y, s.r);
    }
    slots.lineStyle(1, COLORS.cyan, 0.35);
    slots.lineBetween(L.divider.x, L.divider.top, L.divider.x, L.divider.bottom);

    // Bake every face once here, so a swap in update is a setTexture.
    const avatarScene = scene as unknown as Parameters<typeof roundAvatar>[0];
    const house = [
      roundAvatar(avatarScene, COMMS_AVATARS.HOUSE[0], AVATAR_SIZE),
      roundAvatar(avatarScene, COMMS_AVATARS.HOUSE[1], AVATAR_SIZE),
    ];
    this.houseTextures = [house[0].texture, house[1].texture];
    // Until the door and TV chips are picked, HOUSE is a code glyph rather than a stand-in plate.
    this.houseArt = [
      avatarSource(COMMS_AVATARS.HOUSE[0]).file !== null,
      avatarSource(COMMS_AVATARS.HOUSE[1]).file !== null,
    ];
    this.houseGlyph = add.graphics();
    this.faces = L.slots.map((s) => {
      const a = s.name === 'HOUSE' ? house[0] : roundAvatar(avatarScene, COMMS_AVATARS[s.name], AVATAR_SIZE);
      const img = add.image(s.x, s.y, a.texture);
      img.setDisplaySize(AVATAR_SIZE, AVATAR_SIZE);
      img.setTint(a.tint);
      img.setAlpha(a.alpha);
      return img;
    });
    this.labels = L.slots.map((s) =>
      add
        .text(s.x, L.slotLabelY, s.name, { fontFamily: FONT, fontSize: '12px', color: COLORS.dim })
        .setOrigin(0.5, 0),
    );

    this.ring = add.graphics();
    this.pill = add.graphics();
    this.nameText = add.text(L.name.x, L.name.y, '', {
      fontFamily: FONT,
      fontSize: '17px',
      color: COLORS.cyanText,
    });
    this.tagText = add
      .text(L.tag.x, L.tag.y + L.tag.h / 2, '', { fontFamily: FONT, fontSize: '13px', color: COLORS.white })
      .setOrigin(0, 0.5);
    this.lineText = add.text(L.text.x, L.text.y, '', {
      fontFamily: FONT_SANS,
      fontSize: '28px',
      color: COLORS.heroText,
      wordWrap: { width: L.text.w },
      maxLines: 3,
    });

    this.root = add.container(0, 0, [
      plate,
      title,
      slots,
      ...this.faces,
      this.houseGlyph,
      ...this.labels,
      this.ring,
      this.pill,
      this.nameText,
      this.tagText,
      this.lineText,
    ]);

    this.off.push(
      host.bus.on('voiceStart', (v) => {
        this.state = extendForVoice(this.state, v.id, this.clock, v.seconds);
      }),
      provideCommsHook(scene, () => this.snapshot()),
    );
    this.drawLine(null);
    this.setPresent(false);
    this.showHouse(0);
  }

  /** The band, for the HUD's bounds check. */
  get container(): Phaser.GameObjects.Container | null {
    return this.root;
  }

  /** A bark the cue table fired; it shows when the band's rules let it. */
  enqueue(id: LineId): void {
    this.state = enqueueComms(this.state, id, this.clock);
  }

  /** A new run: forget every line (the HUD scene calls it when the run is replaced). */
  reset(): void {
    if (this.state.current) this.emit('lineEnd', this.state.current.id);
    this.state = NO_COMMS;
  }

  update(frame: Frame, clock: LiveClock): void {
    this.clock = clock.now;
    if (!this.root) return;
    const cps = TEXT_CPS[settings().textSpeed];
    const prev = this.state;
    const next = stepComms(prev, clock.now, cps);
    if (next !== prev) {
      this.state = next;
      const was = prev.current?.id ?? null;
      const now = next.current?.id ?? null;
      if (was !== now || (prev.current && next.current && prev.current.since !== next.current.since)) {
        if (was) this.emit('lineEnd', was);
        if (now) this.startLine(now, next.current!.since);
      }
    }

    const c = this.state.current;
    if (c) {
      const typed = typedOf(c, clock.now, cps);
      if (typed !== this.shownTyped) {
        this.shownTyped = typed;
        this.lineText!.setText(LINES[c.id].text.slice(0, typed));
      }
    }
    const alpha = bandAlpha(this.state, clock.now);
    if (alpha !== this.shownAlpha) {
      this.shownAlpha = alpha;
      this.nameText!.setAlpha(alpha);
      this.tagText!.setAlpha(alpha);
      this.pill!.setAlpha(alpha);
      this.lineText!.setAlpha(alpha);
      this.ring!.setAlpha(alpha);
    }
    if (frame.rescued !== this.shownPresent) this.setPresent(frame.rescued);
  }

  /** hud.bark: the same ids and text BarkView's queue reported. */
  barkSnapshot(): BarkSnapshot {
    const c = this.state.current;
    return { current: c?.id ?? null, text: c ? LINES[c.id].text : null, history: [...this.state.history] };
  }

  shutdown(): void {
    for (const off of this.off) off();
    this.off = [];
    this.root?.destroy();
    this.root = null;
    this.ring = null;
    this.pill = null;
    this.nameText = null;
    this.tagText = null;
    this.lineText = null;
    this.faces = [];
    this.labels = [];
    this.houseGlyph = null;
    this.scene = null;
    this.bus = null;
  }

  // ---- drawing ----

  private emit(kind: 'lineEnd' | 'voice', id: LineId): void {
    this.emitted.push(`${kind}:${id}`);
    if (this.emitted.length > EMITTED_MAX) this.emitted.shift();
    if (kind === 'lineEnd') this.bus?.emit('lineEnd', { id });
    else if (kind === 'voice') this.bus?.emit('voice', { id });
  }

  /** A line starts: tell chat and the cam, and give TRIAGE her blip. */
  private startLine(id: LineId, since: number): void {
    const l = LINES[id];
    this.emitted.push(`line:${id}`);
    if (this.emitted.length > EMITTED_MAX) this.emitted.shift();
    this.bus?.emit('line', { id, speaker: l.speaker, tag: tag(id), since });
    this.drawLine(id);
    if (slotOf(l.speaker) === 'TRIAGE') {
      this.bus?.emit('sfx', { key: tag(id) === 'WARNING' ? 'triage-panic' : 'triage-blip' });
    }
  }

  /** Redraw the nameplate, tag pill and speaker ring for a line (or clear them). Once per line. */
  private drawLine(id: LineId | null): void {
    const L = this.L!;
    this.shownTyped = -1;
    this.ring!.clear();
    this.pill!.clear();
    if (!id) {
      this.nameText!.setText('');
      this.tagText!.setText('');
      this.lineText!.setText('');
      return;
    }
    const l = LINES[id];
    const t = tag(id);
    const colour = TAG_COLOR[t] ?? COLORS.cyan;
    this.nameText!.setText(nameOf(id));
    const px = L.name.x + this.nameText!.width + 14;
    this.tagText!.setText(t);
    this.tagText!.setPosition(px + 9, L.tag.y + L.tag.h / 2);
    this.pill!.fillStyle(colour, 0.25);
    this.pill!.fillRoundedRect(px, L.tag.y, this.tagText!.width + 18, L.tag.h, 6);
    this.pill!.lineStyle(1, colour, 0.9);
    this.pill!.strokeRoundedRect(px, L.tag.y, this.tagText!.width + 18, L.tag.h, 6);
    this.lineText!.setText('');

    const slot = slotOf(l.speaker);
    if (slot) {
      const i = COMMS_SLOTS.indexOf(slot);
      const s = L.slots[i];
      if (slot === 'HOUSE') this.showHouse(houseChip(l.speaker) === COMMS_AVATARS.HOUSE[1] ? 1 : 0);
      this.ring!.lineStyle(3, t === 'WARNING' ? COLORS.red : COLORS.hero, 1);
      this.ring!.strokeCircle(s.x, s.y, s.r);
    }
  }

  /** HOUSE's chip: 0 the door, 1 the TV; its picked art, or a code glyph until that lands. */
  private showHouse(which: 0 | 1): void {
    const i = COMMS_SLOTS.indexOf('HOUSE');
    const s = this.L!.slots[i];
    const face = this.faces[i];
    const g = this.houseGlyph!;
    g.clear();
    if (this.houseArt[which]) {
      face.setTexture(this.houseTextures[which]).setVisible(true);
      return;
    }
    face.setVisible(false);
    g.lineStyle(2, COLORS.cyan, 0.7);
    if (which === 0) {
      // A door: a tall frame with a knob.
      g.strokeRect(s.x - 13, s.y - 21, 26, 42);
      g.fillStyle(COLORS.cyan, 0.7);
      g.fillCircle(s.x + 7, s.y + 2, 2.5);
    } else {
      // A TV: a screen on a stand.
      g.strokeRoundedRect(s.x - 22, s.y - 17, 44, 30, 4);
      g.lineBetween(s.x - 8, s.y + 21, s.x + 8, s.y + 21);
      g.lineBetween(s.x, s.y + 13, s.x, s.y + 21);
    }
  }

  /** Light the crew's slots (or darken them before the rescue). */
  private setPresent(present: boolean): void {
    this.shownPresent = present;
    const L = this.L!;
    for (let i = 0; i < L.slots.length; i++) {
      const name = L.slots[i].name;
      if (name === 'TRIAGE' || name === 'HOUSE') continue;
      this.faces[i].setTint(present ? 0xffffff : DARK_TINT);
      this.faces[i].setAlpha(present ? 1 : DARK_ALPHA);
      this.labels[i].setText(present ? name : DARK_NAME);
    }
  }

  // ---- the hook ----

  /** hud.comms, built only when the hook is read. */
  snapshot(): CommsTestState {
    const canvas = this.scene?.game.canvas.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    };
    const r = this.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    const L = this.L ?? commsLayout(r);
    const c = this.state.current;
    const cps = TEXT_CPS[settings().textSpeed];
    const scale = canvas.width / 1920;
    const speaking = c ? slotOf(LINES[c.id].speaker) : null;
    const present = this.shownPresent === true;
    const b = this.root?.getBounds();
    const typed = c ? typedOf(c, this.clock, cps) : 0;
    return {
      line: c
        ? {
            id: c.id,
            speaker: LINES[c.id].speaker,
            name: nameOf(c.id),
            tag: tag(c.id),
            text: LINES[c.id].text,
            typed,
            typingDone: typed >= LINES[c.id].text.length,
            since: c.since,
            until: c.until,
            voiced: c.voiced,
          }
        : null,
      slots: L.slots.map((s) => {
        const p = pagePoint(s, canvas);
        return {
          name: s.name,
          x: p.x,
          y: p.y,
          r: Math.round(s.r * scale * 10) / 10,
          present: s.name === 'TRIAGE' || s.name === 'HOUSE' || present,
          speaking: speaking === s.name,
        };
      }),
      queue: this.state.queue.map((q) => q.id),
      history: [...this.state.history],
      dropped: [...this.state.dropped],
      log: {
        open: false,
        pinned: false,
        lines: [],
        band: pagePoint({ x: L.text.x + 200, y: r.y + r.h / 2 }, canvas),
        outside: pagePoint({ x: L.text.x + 200, y: r.y - 60 }, canvas),
        replay: pagePoint({ x: L.replay.x + L.replay.w / 2, y: L.replay.y + L.replay.h / 2 }, canvas),
        replayed: [],
      },
      leader: null,
      triage: c && triageMood(c.id) ? { mood: triageMood(c.id)! } : null,
      alpha: bandAlpha(this.state, this.clock),
      rect: pageRect(r, canvas),
      drawn: b ? pageRect({ x: b.x, y: b.y, w: b.width, h: b.height }, canvas) : pageRect(r, canvas),
      emitted: [...this.emitted],
    };
  }
}
