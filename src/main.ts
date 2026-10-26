import Phaser from 'phaser';
import { BoardScene, GAME_HEIGHT, GAME_WIDTH } from './scenes/BoardScene';
import { installTestHook } from './testHook';

const board = new BoardScene();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#05070f',
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [board],
});

installTestHook(() => {
  const active = game.scene.getScenes(true)[0];
  const rect = game.canvas?.getBoundingClientRect();
  return {
    scene: active ? active.scene.key : null,
    ready: active === board && board.ready,
    canvas: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
  };
});
