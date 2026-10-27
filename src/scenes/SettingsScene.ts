import Phaser from 'phaser';
import { settings, updateSettings } from '../game/settings';
import { nextTextSpeed, stepVolume } from '../game/settingsControls';
import { SCENES } from './keys';
import {
  CYAN,
  MAGENTA,
  UI_FONT,
  type ShellButton,
  addButton,
  addDim,
  addPanel,
  preloadButtons,
} from './shellUi';

const W = 1920;

// Settings: volume, text speed, reduce flicker, fullscreen. Opens from the title or the pause menu
// (launched with `{ from }`) and hands back to whichever opened it.
export class SettingsScene extends Phaser.Scene {
  ready = false;
  private from: string = SCENES.title;
  private volumeText!: Phaser.GameObjects.Text;
  private textSpeed!: ShellButton;
  private flicker!: ShellButton;
  private fullscreen!: ShellButton;

  constructor() {
    super(SCENES.settings);
  }

  init(data: { from?: string }): void {
    this.from = data?.from ?? SCENES.title;
  }

  preload(): void {
    preloadButtons(this);
  }

  create(): void {
    this.ready = false;
    addDim(this, 0.6);
    addPanel(this, W / 2, 540, 1000, 820);
    this.add
      .text(W / 2, 200, 'SETTINGS', { fontFamily: UI_FONT, fontSize: '52px', color: MAGENTA })
      .setOrigin(0.5);

    const labelX = W / 2 - 420;
    const controlX = W / 2 + 200;
    const rows = [320, 450, 580, 710];
    const label = (y: number, text: string) =>
      this.add
        .text(labelX, y, text, { fontFamily: UI_FONT, fontSize: '34px', color: CYAN })
        .setOrigin(0, 0.5);

    label(rows[0], 'Volume');
    addButton(this, 'volumeDown', controlX - 150, rows[0], '−', () => this.nudgeVolume(-1), 0.24, 40);
    this.volumeText = this.add
      .text(controlX, rows[0], '', { fontFamily: UI_FONT, fontSize: '36px', color: CYAN })
      .setOrigin(0.5);
    addButton(this, 'volumeUp', controlX + 150, rows[0], '+', () => this.nudgeVolume(1), 0.24, 40);

    label(rows[1], 'Text speed');
    this.textSpeed = addButton(
      this,
      'textSpeed',
      controlX,
      rows[1],
      '',
      () => {
        updateSettings({ textSpeed: nextTextSpeed(settings().textSpeed) });
        this.refresh();
      },
      0.5,
      30,
    );

    label(rows[2], 'Reduce flicker');
    this.flicker = addButton(
      this,
      'reduceFlicker',
      controlX,
      rows[2],
      '',
      () => {
        updateSettings({ reduceFlicker: !settings().reduceFlicker });
        this.refresh();
      },
      0.5,
      30,
    );

    label(rows[3], 'Fullscreen');
    this.fullscreen = addButton(
      this,
      'fullscreen',
      controlX,
      rows[3],
      '',
      () => this.toggleFullscreen(),
      0.5,
      30,
    );

    addButton(this, 'back', W / 2, 860, 'BACK', () => this.close(), 0.5, 30);

    const onFs = () => this.refresh();
    this.scale.on(Phaser.Scale.Events.ENTER_FULLSCREEN, onFs);
    this.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, onFs);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.ENTER_FULLSCREEN, onFs);
      this.scale.off(Phaser.Scale.Events.LEAVE_FULLSCREEN, onFs);
    });

    this.refresh();
    this.ready = true;
  }

  /** Back to the scene that opened settings. */
  close(): void {
    this.scene.stop();
    if (this.scene.isPaused(this.from)) this.scene.resume(this.from);
  }

  private nudgeVolume(direction: -1 | 1): void {
    updateSettings({ volume: stepVolume(settings().volume, direction) });
    this.refresh();
  }

  private toggleFullscreen(): void {
    try {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    } catch {
      // Fullscreen refused (iframe, headless browser): nothing to do.
    }
    this.refresh();
  }

  private refresh(): void {
    const s = settings();
    this.volumeText.setText(`${Math.round(s.volume * 100)}%`);
    this.textSpeed.setText(s.textSpeed.toUpperCase());
    this.flicker.setText(s.reduceFlicker ? 'ON' : 'OFF');
    this.fullscreen.setText(this.scale.isFullscreen ? 'ON' : 'OFF');
  }
}
