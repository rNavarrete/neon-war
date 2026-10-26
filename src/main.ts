import Phaser from 'phaser';
import { BoardScene, GAME_HEIGHT, GAME_WIDTH } from './scenes/BoardScene';
import type { Point } from './scenes/layout';
import { type PagePoint, installTestHook, simSpeed } from './testHook';

const board = new BoardScene();
board.speed = simSpeed(window.location.search);

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

function mapPoints(rec: Record<string, Point>, toPage: (p: Point) => PagePoint): Record<string, PagePoint> {
  return Object.fromEntries(Object.entries(rec).map(([k, p]) => [k, toPage(p)]));
}

installTestHook(() => {
  const active = game.scene.getScenes(true)[0];
  const rect = game.canvas?.getBoundingClientRect();
  const snapshot = {
    scene: active ? active.scene.key : null,
    ready: active === board && board.ready,
    canvas: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
  };
  if (!rect || !snapshot.ready) return snapshot;

  const scale = rect.width / GAME_WIDTH;
  const toPage = ([x, y]: Point): PagePoint => [rect.left + x * scale, rect.top + y * scale];
  const s = board.state;
  const t = board.targets();
  return {
    ...snapshot,
    mission: {
      time: s.time,
      outcome: s.outcome,
      trust: s.trust,
      credits: s.credits,
      dbLoad: s.dbLoad,
      backlog: s.backlog,
      errorRate: s.errorRate,
      nodes: s.nodes.map((n) => ({ id: n.id, kind: n.kind, slot: n.slot })),
      links: s.links.map((l) => ({ from: l.from, to: l.to })),
    },
    partner: { mood: board.mood, text: board.line, said: [...board.said] },
    toast: board.toast,
    at: {
      nodes: mapPoints(t.nodes, toPage),
      slots: mapPoints(t.slots, toPage),
      tray: mapPoints(t.tray, toPage),
      cut: mapPoints(t.cut, toPage),
      remove: mapPoints(t.remove, toPage),
      retry: t.retry ? toPage(t.retry) : null,
    },
  };
});
