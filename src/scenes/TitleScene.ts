import Phaser from 'phaser';
import { startSession } from '../game/flow';
import { line } from '../strings';
import { SCENES } from './keys';
import { CYAN, MAGENTA, UI_FONT, type ShellButton, addButton, addPanel, preloadButtons } from './shellUi';

const W = 1920;
const H = 1080;

const CREDITS = [
  "Lux's story & design by Rolando Navarrete",
  'Art: gpt-image-2',
  'Music: Suno',
  'Effects: ElevenLabs',
  'Built with Phaser',
].join('\n\n');

// Title screen: the logo over the skyline with Start, Settings and Credits.
export class TitleScene extends Phaser.Scene {
  ready = false;
  creditsOpen = false;
  private menu: ShellButton[] = [];
  private credits: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super(SCENES.title);
  }

  preload(): void {
    this.load.image('title:skyline', 'art/bg/skyline.webp');
    this.load.image('title:logo', 'art/ui/logo.webp');
    preloadButtons(this);
  }

  create(): void {
    this.ready = false;
    this.creditsOpen = false;
    const sky = this.add.image(W / 2, H / 2, 'title:skyline');
    sky.setScale(Math.max(W / sky.width, H / sky.height));
    this.add.rectangle(0, 0, W, H, 0x05070f, 0.35).setOrigin(0);

    this.add.image(W / 2, 320, 'title:logo').setScale(0.72);
    this.add
      .text(W / 2, 600, line('C8.title'), { fontFamily: UI_FONT, fontSize: '40px', color: MAGENTA })
      .setOrigin(0.5)
      .setShadow(0, 0, '#ff3fa4', 12, false, true);

    this.menu = [
      addButton(this, 'start', W / 2 - 360, 820, 'START', () => startSession(this)),
      addButton(this, 'settings', W / 2, 820, 'SETTINGS', () => {
        this.scene.pause();
        this.scene.launch(SCENES.settings, { from: SCENES.title });
      }),
      addButton(this, 'credits', W / 2 + 360, 820, 'CREDITS', () => this.showCredits(true)),
    ];

    this.credits = this.buildCredits();
    this.showCredits(false);
    this.ready = true;
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
