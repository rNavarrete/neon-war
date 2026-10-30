import Phaser from 'phaser';
import {
  MUSIC_FILES,
  MUSIC_KEY,
  MUSIC_LEVEL,
  SFX_KEYS,
  TITLE_MUSIC_FADE,
  TITLE_MUSIC_FILES,
  TITLE_MUSIC_KEY,
  audio,
  musicWanted,
  sfxPath,
  titleMusicWanted,
} from '../game/audio';
import { bus } from '../game/bus';
import { frame } from '../game/frame';
import { type SoundPort, VOICE_CUT_FADE_MS, type VoiceTestState, bundledLiveSfx, mixer } from '../game/mixer';
import { run } from '../game/run';
import { onSettingsChange, settings } from '../game/settings';
import { type VoiceHookFields, voiceHookFields } from '../game/voice';
import { provideTestState, testHookEnabled } from '../testHook';
import { ZONES } from './live/layout';
import { SCENES } from './keys';
import { titleMusicGain } from './opening';
import { openPause } from './PauseScene';
import type { PauseScene } from './PauseScene';
import type { SettingsScene } from './SettingsScene';
import { type ShellButton, addButton, buttonPositions, preloadButtons } from './shellUi';

const W = 1920;

/** The shell's part of the test snapshot. */
export interface ShellTestState {
  /** The last effect key asked for, audible or not (headless browsers may lock audio). */
  lastSfx: string | null;
  /** The last 20 effect keys asked for, oldest first. */
  recentSfx: string[];
  /**
   * The mixer's voice channel (src/game/mixer.ts): ids asked for, ids the manifest lacks, the duck;
   * plus voice.ts's hook fields: the voices setting (lang), the voice volume, the last id asked for
   * and whether music or sfx are ducked. `requested` is the mixer's own record ('lang:id' in the
   * language the setting gave each request when it was made).
   */
  voice: VoiceTestState & Pick<VoiceHookFields, 'lang' | 'volume' | 'lastVoice' | 'ducked'>;
  /** True while the board music loop is playing (or queued to start once audio unlocks). */
  musicPlaying: boolean;
  /** True while the title music loop is playing (or queued to start once audio unlocks). */
  titleMusicPlaying: boolean;
  /** The title loop's volume as last set (it follows the anime opening's fades). */
  titleMusicVolume: number;
  /** The level the title loop sits at when no opening is fading it (the music level under the mixer). */
  titleMusicLevel: number;
  settings: {
    volume: number;
    textSpeed: string;
    reduceFlicker: boolean;
    fullscreen: boolean;
    /** The voices setting: 'ja', 'en' or 'off'. */
    voices: string;
    /** The voice volume, 0 to 1. */
    voiceVolume: number;
    /** The title's speaker icon: true when the music is muted. */
    musicMuted: boolean;
  };
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
  /** Place a server with its footprint anchored at a cell ('c3-11') through the real Run action; returns the new part's id or null. */
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
// audio (the board music loop and every effect the bus asks for, at the volume in settings). The
// mixer (src/game/mixer.ts) decides the voice clips and the duck; this scene is its SoundPort.
/**
 * The volume a sound was last set to. Phaser keeps it on `currentConfig` (typed only on NoAudioSound);
 * `volume` reads the Web Audio gain's value, which lags the setting and stalls without an audio device.
 */
function volumeSet(s: Phaser.Sound.BaseSound): number {
  return (s as unknown as { currentConfig: Phaser.Types.Sound.SoundConfig }).currentConfig.volume ?? 0;
}

export class OverlayScene extends Phaser.Scene {
  ready = false;
  private music: Phaser.Sound.BaseSound | null = null;
  private musicOn = false;
  private titleMusic: Phaser.Sound.BaseSound | null = null;
  private titleMusicOn = false;
  private pauseButton: ShellButton | null = null;
  /** The mixer's clock: real seconds times the test speed, stopped while the board is held (the HUD clock). */
  private mixClock = 0;
  /** The effects channel's gain from the mixer (ducked under a voice). */
  private sfxGain = 1;
  /** The voice clip playing, if any. */
  private voiceSound: Phaser.Sound.BaseSound | null = null;
  /** Cut clips still fading out (VOICE_CUT_FADE_MS); the duck leaves them alone. */
  private readonly fadingVoices = new Set<Phaser.Sound.BaseSound>();

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
        this.sound.play(key, { loop, volume: this.sfxGain });
      },
      stop: (key) => {
        this.sound.stopByKey(key);
      },
    });
    mixer.attach(this.soundPort());
    this.loadAudio();
    // Browsers hold every sound until the first click or key press, and Phaser drops a play asked
    // for before then. Once sound is allowed, start whichever music the screen wants from the top.
    this.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
      if (this.titleMusicOn) this.playTitleMusic(true);
      if (this.musicOn) this.playMusic(true);
    });

    // At the clock zone's right end, beside the clock's painted plate (which ends at CLOCK_RIGHT_LIMIT).
    const clock = ZONES.clock;
    this.pauseButton = addButton(
      this,
      'pause',
      clock.x + clock.w - 36,
      clock.y + 62,
      'II',
      () => openPause(this),
      0.13,
      22,
    );
    this.pauseButton.setVisible(false);
    this.input.keyboard?.on('keydown-ESC', () => this.onEscape());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offSettings();
      audio.attach(null);
      mixer.attach(null);
      for (const s of this.fadingVoices) s.destroy();
      this.fadingVoices.clear();
    });
    this.ready = true;
  }

  /**
   * Load the music and effects after the pause button is up, so Esc works at once; an effect asked
   * for before its file arrives is recorded but silent.
   */
  private loadAudio(): void {
    // The title's loop first: it is what the first screen plays.
    this.load.audio(TITLE_MUSIC_KEY, [...TITLE_MUSIC_FILES]);
    this.load.audio(MUSIC_KEY, [...MUSIC_FILES]);
    for (const key of SFX_KEYS) this.load.audio(key, sfxPath(key));
    // The Live effects load only once their files have landed (public/audio/sfx/manifest.json).
    for (const key of bundledLiveSfx()) this.load.audio(key, sfxPath(key));
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (this.cache.audio.exists(TITLE_MUSIC_KEY)) {
        this.titleMusic = this.sound.add(TITLE_MUSIC_KEY, {
          loop: true,
          volume: MUSIC_LEVEL * mixer.gain('music'),
        });
        if (this.titleMusicOn) this.playTitleMusic(true);
      }
      if (!this.cache.audio.exists(MUSIC_KEY)) return;
      this.music = this.sound.add(MUSIC_KEY, { loop: true, volume: MUSIC_LEVEL * mixer.gain('music') });
      if (this.musicOn) this.playMusic(true);
    });
    this.load.start();
  }

  update(_time: number, delta: number): void {
    const f = frame(run());
    this.mixClock += f.paused ? 0 : (delta / 1000) * f.speed;
    mixer.tick(this.mixClock, f.now);

    const sm = this.scene;
    const boardOpen = sm.isActive(SCENES.board) || sm.isPaused(SCENES.board);
    const sceneOpen = sm.isActive(SCENES.title) || sm.isActive(SCENES.story) || sm.isActive(SCENES.debrief);
    const muted = settings().musicMuted;
    this.setMusic(musicWanted({ boardOpen, sceneOpen }) && !muted);
    this.setTitleMusic(titleMusicWanted({ titleOpen: sm.isActive(SCENES.title), muted }));
    // The anime opening fades the title loop out and back in (src/scenes/opening.ts): follow its gain.
    // Only when the level moves: each setVolume queues an event on the Web Audio gain's timeline, and a
    // write every frame for as long as the title shows piles thousands of them up.
    const tm = this.titleMusic;
    if (this.titleMusicOn && tm && !this.tweens.isTweening(tm)) {
      const level = MUSIC_LEVEL * mixer.gain('music') * titleMusicGain();
      if (Math.abs(level - volumeSet(tm)) > 1e-4) {
        try {
          (tm as Phaser.Sound.WebAudioSound).setVolume(level);
        } catch {
          // Locked or missing audio never stops the game.
        }
      }
    }
    this.pauseButton?.setVisible(sm.isActive(SCENES.board));
  }

  /** The mixer's port onto Phaser's sound manager. Every call is guarded: locked audio never throws out. */
  private soundPort(): SoundPort {
    return {
      loadVoice: (key, url) => {
        if (this.cache.audio.exists(key)) return;
        this.load.audio(key, url);
        this.load.start();
      },
      unloadVoice: (key) => {
        // removeByKey destroys every sound of the key, a clip still fading out included: stop its fade
        // first, or the tween sets the volume of a destroyed sound and throws out of the game loop.
        for (const s of this.fadingVoices) {
          if (s.key !== key) continue;
          this.tweens.killTweensOf(s);
          this.fadingVoices.delete(s);
        }
        if (this.voiceSound?.key === key) this.voiceSound = null;
        this.sound.removeByKey(key);
        this.cache.audio.remove(key);
      },
      voiceReady: (key) => this.cache.audio.exists(key),
      playVoice: (key, volume, onEnd) => {
        if (!this.cache.audio.exists(key)) return null;
        this.voiceSound?.destroy();
        const s = this.sound.add(key, { volume });
        s.once(Phaser.Sound.Events.COMPLETE, () => {
          if (this.voiceSound === s) this.voiceSound = null;
          s.destroy();
          onEnd();
        });
        if (!s.play()) {
          s.destroy();
          return null;
        }
        this.voiceSound = s;
        return Number.isFinite(s.duration) ? s.duration : 0;
      },
      stopVoice: () => {
        const s = this.voiceSound;
        this.voiceSound = null;
        if (s) this.fadeOutVoice(s);
      },
      setGain: (channel, gain) => {
        if (channel === 'music') {
          const level = MUSIC_LEVEL * gain;
          (this.music as Phaser.Sound.WebAudioSound | null)?.setVolume?.(level);
          if (this.titleMusicOn) (this.titleMusic as Phaser.Sound.WebAudioSound | null)?.setVolume?.(level);
          return;
        }
        this.sfxGain = gain;
        // Effects already sounding (the rain loop) follow the duck too; the music and the voice do not.
        for (const s of this.sound.getAllPlaying()) {
          if (s !== this.music && s !== this.titleMusic && s !== this.voiceSound && !this.fadingVoices.has(s))
            (s as Phaser.Sound.WebAudioSound).setVolume?.(gain);
        }
      },
    };
  }

  /**
   * Cut a voice clip with a VOICE_CUT_FADE_MS fade to 0, then destroy it (not at once: a hard stop
   * clicks). Its COMPLETE listener goes first, so a cut clip never reports a natural end.
   */
  private fadeOutVoice(s: Phaser.Sound.BaseSound): void {
    s.off(Phaser.Sound.Events.COMPLETE);
    const done = (): void => {
      this.fadingVoices.delete(s);
      s.destroy();
    };
    if (!s.isPlaying) {
      done();
      return;
    }
    this.fadingVoices.add(s);
    this.tweens.add({ targets: s, volume: 0, duration: VOICE_CUT_FADE_MS, onComplete: done });
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

  private setTitleMusic(on: boolean): void {
    if (on === this.titleMusicOn) return;
    this.titleMusicOn = on;
    this.playTitleMusic(on);
  }

  /**
   * Start the title loop from the top at the music level, or fade it out over TITLE_MUSIC_FADE and
   * stop it. Asked for while audio is still locked, it is started again on the UNLOCKED event.
   */
  private playTitleMusic(on: boolean): void {
    const m = this.titleMusic as Phaser.Sound.WebAudioSound | null;
    if (!m) return;
    try {
      this.tweens.killTweensOf(m);
      if (on) {
        m.setVolume(MUSIC_LEVEL * mixer.gain('music') * titleMusicGain());
        m.play();
      } else if (m.isPlaying) {
        this.tweens.add({
          targets: m,
          volume: 0,
          duration: TITLE_MUSIC_FADE * 1000,
          onComplete: () => {
            if (!this.titleMusicOn) m.stop();
          },
        });
      }
    } catch {
      // Locked or missing audio never stops the game.
    }
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
    const v = mixer.snapshot();
    // voice.ts's fields join the mixer's; the mixer's requested (made at request time) is kept.
    return {
      lastSfx: audio.lastSfx,
      recentSfx: [...audio.recentSfx],
      voice: { ...v, ...voiceHookFields(v, s), requested: v.requested },
      musicPlaying: this.musicOn && this.music !== null,
      titleMusicPlaying: this.titleMusicOn && this.titleMusic !== null,
      // The volume the game last set (the audio thread's gain.value lags it, and stalls without a device).
      titleMusicVolume: this.titleMusic ? volumeSet(this.titleMusic) : 0,
      titleMusicLevel: MUSIC_LEVEL * mixer.gain('music'),
      settings: {
        volume: s.volume,
        textSpeed: s.textSpeed,
        reduceFlicker: s.reduceFlicker,
        fullscreen: this.scale.isFullscreen,
        voices: s.voices,
        voiceVolume: s.voiceVolume,
        musicMuted: s.musicMuted,
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
