import Phaser from 'phaser';
import { newRun } from './game/run';
import { BoardScene, GAME_HEIGHT, GAME_WIDTH } from './scenes/BoardScene';
import { DebriefScene } from './scenes/DebriefScene';
import { HudScene } from './scenes/HudScene';
import { PauseScene } from './scenes/PauseScene';
import { SettingsScene } from './scenes/SettingsScene';
import { StoryScene } from './scenes/StoryScene';
import { TitleScene } from './scenes/TitleScene';
import { installTestHook, simSpeed, startScene } from './testHook';

newRun(simSpeed(window.location.search));

const board = new BoardScene();
// The first scene in the list starts on load; `?test&scene=<key>` lets a browser test start elsewhere.
const scenes: Phaser.Scene[] = [
  board,
  new TitleScene(),
  new StoryScene(),
  new HudScene(),
  new PauseScene(),
  new SettingsScene(),
  new DebriefScene(),
];
const first = startScene(window.location.search);
const firstIndex = scenes.findIndex((s) => s.sys.settings.key === first);
if (firstIndex > 0) scenes.unshift(...scenes.splice(firstIndex, 1));

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
  const active = game.scene.getScenes(true)[0];
  const rect = game.canvas?.getBoundingClientRect();
  const ready = active ? ((active as Phaser.Scene & { ready?: boolean }).ready ?? false) : false;
  return {
    scene: active ? active.scene.key : null,
    ready: active === board ? board.ready : ready,
    canvas: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
  };
});
