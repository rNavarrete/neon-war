import Phaser from 'phaser';
import { MUSIC_FILES, MUSIC_KEY, SFX_KEYS, audio, musicWanted, sfxPath } from '../game/audio';
import { bus } from '../game/bus';
import { run } from '../game/run';
import { onSettingsChange, settings } from '../game/settings';
import { provideTestState, testHookEnabled } from '../testHook';
import { SCENES } from './keys';
import { openPause } from './PauseScene';
import type { PauseScene } from './PauseScene';
import type { SettingsScene } from './SettingsScene';
import { type ShellButton, addButton, buttonPositions, preloadButtons } from './shellUi';

const W = 1920;

/** The shell's part of the test snapshot. */
export interface ShellTestState {
  /** The last effect key asked for, audible or not (headless browsers may lock audio). */
  lastSfx: string | null;
  /** True while the board music loop is playing (or queued to start once audio unlocks). */
  musicPlaying: boolean;
  settings: { volume: number; textSpeed: string; reduceFlicker: boolean; fullscreen: boolean };
  /** True while the pause menu is open. */
  paused: boolean;
  /** The sim clock, run().now. */
  simNow: number;
  creditsOpen: boolean;
  /** Where to click each button that can be pressed now, in page CSS pixels, by button id. */
  buttons: Record<string, { x: number; y: number }>;
}

declare module '../testHook' {
  interface TestSections {
    shell: ShellTestState;
  }
}

/** Test-only handle on `window.__neonShell` (only with `?test`): drives the real Run and bus. */
export interface ShellTestHandle {
  /** Place a server in a slot through the real Run action; returns the new part's id or null. */
  place(slot: string): string | null;
  /** Wire two parts through the real Run action. */
  connect(from: string, to: string): boolean;
  /** Emit a failure event the way ENG-503 will. */
  emit(event: 'overheat' | 'serverDied' | 'powerDip' | 'rescue', id?: string): void;
}

declare global {
  interface Window {
    __neonShell?: ShellTestHandle;
  }
}

// Always running, drawn over every scene: the pause button and Esc while the board runs, and all
// audio (the board music loop and every effect the bus asks for, at the volume in settings).
export class OverlayScene extends Phaser.Scene {
  ready = false;
  private music: Phaser.Sound.BaseSound | null = null;
  private musicOn = false;
  private pauseButton: ShellButton | null = null;

  constructor() {
    super({ key: SCENES.overlay, active: true });
  }

  init(): void {
    if (testHookEnabled(window.location.search)) this.installTestHandle();
  }

  preload(): void {
    preloadButtons(this);
  }

  create(): void {
    this.sound.volume = settings().volume;
    const offSettings = onSettingsChange((s) => {
      this.sound.volume = s.volume;
    });
    audio.attach({
      play: (key, loop) => {
        if (!this.cache.audio.exists(key)) return;
        // A looping effect (the rain) plays once at a time, however often it is asked for.
        if (loop && this.sound.get(key)?.isPlaying) return;
        this.sound.play(key, { loop });
      },
      stop: (key) => {
        this.sound.stopByKey(key);
      },
    });
    this.loadAudio();

    this.pauseButton = addButton(this, 'pause', W - 70, 52, 'II', () => openPause(this), 0.2, 30);
    this.pauseButton.setVisible(false);
    this.input.keyboard?.on('keydown-ESC', () => this.onEscape());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offSettings();
      audio.attach(null);
    });
    this.ready = true;
  }

  /**
   * Load the music and effects after the pause button is up, so Esc works at once; an effect asked
   * for before its file arrives is recorded but silent.
   */
  private loadAudio(): void {
    this.load.audio(MUSIC_KEY, [...MUSIC_FILES]);
    for (const key of SFX_KEYS) this.load.audio(key, sfxPath(key));
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (!this.cache.audio.exists(MUSIC_KEY)) return;
      this.music = this.sound.add(MUSIC_KEY, { loop: true });
      if (this.musicOn) this.playMusic(true);
    });
    this.load.start();
  }

  update(): void {
    const sm = this.scene;
    const boardOpen = sm.isActive(SCENES.board) || sm.isPaused(SCENES.board);
    const sceneOpen = sm.isActive(SCENES.title) || sm.isActive(SCENES.story) || sm.isActive(SCENES.debrief);
    this.setMusic(musicWanted({ boardOpen, sceneOpen }));
    this.pauseButton?.setVisible(sm.isActive(SCENES.board));
  }

  private onEscape(): void {
    const sm = this.scene;
    if (sm.isActive(SCENES.settings)) (sm.get(SCENES.settings) as SettingsScene).close();
    else if (sm.isActive(SCENES.pause)) (sm.get(SCENES.pause) as PauseScene).resumeGame();
    else openPause(this);
  }

  private setMusic(on: boolean): void {
    if (on === this.musicOn) return;
    this.musicOn = on;
    this.playMusic(on);
  }

  private playMusic(on: boolean): void {
    try {
      if (on) this.music?.play();
      else this.music?.stop();
    } catch {
      // Locked or missing audio never stops the game.
    }
  }

  /** The shell's snapshot for browser tests. */
  snapshot(): ShellTestState {
    const s = settings();
    const rect = this.game.canvas?.getBoundingClientRect();
    const title = this.scene.get(SCENES.title) as { creditsOpen?: boolean } | null;
    return {
      lastSfx: audio.lastSfx,
      musicPlaying: this.musicOn && this.music !== null,
      settings: {
        volume: s.volume,
        textSpeed: s.textSpeed,
        reduceFlicker: s.reduceFlicker,
        fullscreen: this.scale.isFullscreen,
      },
      paused: this.scene.isActive(SCENES.pause) || this.scene.isPaused(SCENES.pause),
      simNow: run().now,
      creditsOpen: (this.scene.isActive(SCENES.title) && title?.creditsOpen) ?? false,
      buttons: rect ? buttonPositions(rect, W) : {},
    };
  }

  private installTestHandle(): void {
    provideTestState('shell', () => this.snapshot());
    window.__neonShell = {
      place: (slot) => {
        const r = run().placeServer(slot);
        if (!r.ok) return null;
        const parts = run().session.board.parts;
        return parts[parts.length - 1].id;
      },
      connect: (from, to) => run().connect(from, to).ok,
      emit: (event, id = 's1') => {
        if (event === 'rescue') bus.emit('rescue', {});
        else bus.emit(event, { id });
      },
    };
  }
}
