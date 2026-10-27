import Phaser from 'phaser';
import { needsComputer, readDevice, showComputerNote } from './game/device';
import { bestPlay } from './game/autopilot';
import { newRun } from './game/run';
import { BoardScene, GAME_HEIGHT, GAME_WIDTH } from './scenes/BoardScene';
import { DebriefScene } from './scenes/DebriefScene';
import { HudScene } from './scenes/HudScene';
import { SCENES } from './scenes/keys';
import { OverlayScene } from './scenes/OverlayScene';
import { PauseScene } from './scenes/PauseScene';
import { SettingsScene } from './scenes/SettingsScene';
import { StoryScene } from './scenes/StoryScene';
import { TitleScene } from './scenes/TitleScene';
import { autopilotOn, installTestHook, simSpeed, startScene } from './testHook';

function startGame(): void {
  newRun(simSpeed(window.location.search), autopilotOn(window.location.search) ? bestPlay : null);

  const board = new BoardScene();
  // The first scene in the list starts on load; `?test&scene=<key>` lets a browser test start elsewhere.
  // The overlay starts itself (active) and stays last so it draws over every other scene.
  const scenes: Phaser.Scene[] = [
    new TitleScene(),
    new StoryScene(),
    board,
    new HudScene(),
    new PauseScene(),
    new SettingsScene(),
    new DebriefScene(),
  ];
  const first = startScene(window.location.search);
  const firstIndex = scenes.findIndex((s) => s.sys.settings.key === first);
  if (firstIndex > 0) scenes.unshift(...scenes.splice(firstIndex, 1));
  scenes.push(new OverlayScene());

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#05070f',
    // Painted art: smooth scaling, not pixel art.
    pixelArt: false,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: scenes,
  });

  installTestHook(() => {
    // The scene the player is looking at: the first running one, never the always-on overlay.
    const active = game.scene.getScenes(true).find((s) => s.scene.key !== SCENES.overlay);
    const rect = game.canvas?.getBoundingClientRect();
    const ready = active ? ((active as Phaser.Scene & { ready?: boolean }).ready ?? false) : false;
    return {
      scene: active ? active.scene.key : null,
      ready,
      canvas: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
    };
  });
}

// Desktop only: phones, touch-only devices and narrow windows get a note instead of the game.
const host = document.getElementById('game') ?? document.body;
if (needsComputer(readDevice(window))) showComputerNote(host);
else startGame();
