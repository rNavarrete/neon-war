import Phaser from 'phaser';
import { type VoiceSetting, settings, updateSettings } from '../game/settings';
import {
  nextTextSpeed,
  nextVoiceSetting,
  stepVoiceVolume,
  stepVolume,
  voiceSettingLabel,
} from '../game/settingsControls';
import { provideTestState } from '../testHook';
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

/** The screen's words: its title, each row's label and the way back. */
export const SETTINGS_TEXT = {
  title: 'SETTINGS',
  volume: 'Volume',
  textSpeed: 'Text speed',
  reduceFlicker: 'Reduce flicker',
  fullscreen: 'Fullscreen',
  voices: 'Voices',
  voiceVolume: 'Voice volume',
  back: 'BACK',
} as const;

/** The settings screen's part of the test snapshot (comms-7): its voice rows. */
export interface SettingsScreenTestState {
  /** The settings screen is up. */
  open: boolean;
  /** The voices setting and the voice volume as stored now. */
  voices: VoiceSetting;
  voiceVolume: number;
  /** What the voices button and the voice volume read on screen ('JA', '90%'), or null while closed. */
  labels: { voices: string; voiceVolume: string } | null;
}

declare module '../testHook' {
  interface TestSections {
    settingsScreen: SettingsScreenTestState;
  }
}

/** A 0..1 level as the screen prints it: 90%. */
function percent(level: number): string {
  return `${Math.round(level * 100)}%`;
}

// Settings: volume, text speed, reduce flicker, fullscreen, and the voices (their language and their
// volume). Opens from the title or the pause menu (launched with `{ from }`) and hands back to
// whichever opened it.
export class SettingsScene extends Phaser.Scene {
  ready = false;
  private from: string = SCENES.title;
  private volumeText!: Phaser.GameObjects.Text;
  private textSpeed!: ShellButton;
  private flicker!: ShellButton;
  private fullscreen!: ShellButton;
  private voices!: ShellButton;
  private voiceVolumeText!: Phaser.GameObjects.Text;

  constructor() {
    super(SCENES.settings);
    provideTestState('settingsScreen', () => this.snapshot());
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
    addPanel(this, W / 2, 540, 1000, 960);
    this.add
      .text(W / 2, 130, SETTINGS_TEXT.title, { fontFamily: UI_FONT, fontSize: '52px', color: MAGENTA })
      .setOrigin(0.5);

    const labelX = W / 2 - 420;
    const controlX = W / 2 + 200;
    // Six rows 112 px apart, so the toggles (108 px tall at this scale) never touch.
    const rows = [250, 362, 474, 586, 698, 810];
    const toggle = 0.44;
    const label = (y: number, text: string) =>
      this.add
        .text(labelX, y, text, { fontFamily: UI_FONT, fontSize: '34px', color: CYAN })
        .setOrigin(0, 0.5);

    label(rows[0], SETTINGS_TEXT.volume);
    addButton(this, 'volumeDown', controlX - 150, rows[0], '−', () => this.nudgeVolume(-1), 0.24, 40);
    this.volumeText = this.add
      .text(controlX, rows[0], '', { fontFamily: UI_FONT, fontSize: '36px', color: CYAN })
      .setOrigin(0.5);
    addButton(this, 'volumeUp', controlX + 150, rows[0], '+', () => this.nudgeVolume(1), 0.24, 40);

    label(rows[1], SETTINGS_TEXT.textSpeed);
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
      toggle,
      30,
    );

    label(rows[2], SETTINGS_TEXT.reduceFlicker);
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
      toggle,
      30,
    );

    label(rows[3], SETTINGS_TEXT.fullscreen);
    this.fullscreen = addButton(
      this,
      'fullscreen',
      controlX,
      rows[3],
      '',
      () => this.toggleFullscreen(),
      toggle,
      30,
    );

    // comms-7: the voices' language (JA, EN, OFF; the line's text always shows) and their volume.
    label(rows[4], SETTINGS_TEXT.voices);
    this.voices = addButton(
      this,
      'voices',
      controlX,
      rows[4],
      '',
      () => {
        updateSettings({ voices: nextVoiceSetting(settings().voices) });
        this.refresh();
      },
      toggle,
      30,
    );

    label(rows[5], SETTINGS_TEXT.voiceVolume);
    addButton(this, 'voiceDown', controlX - 150, rows[5], '−', () => this.nudgeVoiceVolume(-1), 0.24, 40);
    this.voiceVolumeText = this.add
      .text(controlX, rows[5], '', { fontFamily: UI_FONT, fontSize: '36px', color: CYAN })
      .setOrigin(0.5);
    addButton(this, 'voiceUp', controlX + 150, rows[5], '+', () => this.nudgeVoiceVolume(1), 0.24, 40);

    addButton(this, 'back', W / 2, 935, SETTINGS_TEXT.back, () => this.close(), toggle, 30);

    const onFs = () => this.refresh();
    this.scale.on(Phaser.Scale.Events.ENTER_FULLSCREEN, onFs);
    this.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, onFs);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ready = false;
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

  private nudgeVoiceVolume(direction: -1 | 1): void {
    updateSettings({ voiceVolume: stepVoiceVolume(settings().voiceVolume, direction) });
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
    this.volumeText.setText(percent(s.volume));
    this.textSpeed.setText(s.textSpeed.toUpperCase());
    this.flicker.setText(s.reduceFlicker ? 'ON' : 'OFF');
    this.fullscreen.setText(this.scale.isFullscreen ? 'ON' : 'OFF');
    this.voices.setText(voiceSettingLabel(s.voices));
    this.voiceVolumeText.setText(percent(s.voiceVolume));
  }

  /** The settings screen as the test hook reports it (built only when the hook is read). */
  snapshot(): SettingsScreenTestState {
    const s = settings();
    const open = this.ready && this.sys.isActive();
    return {
      open,
      voices: s.voices,
      voiceVolume: s.voiceVolume,
      labels: open ? { voices: this.voices.label.text, voiceVolume: this.voiceVolumeText.text } : null,
    };
  }
}
