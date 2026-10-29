// Every scene's key, so scenes start each other without importing each other.
export const SCENES = {
  title: 'title',
  story: 'story',
  board: 'board',
  hud: 'hud',
  pause: 'pause',
  settings: 'settings',
  debrief: 'debrief',
  overlay: 'overlay',
} as const;

export type SceneKey = (typeof SCENES)[keyof typeof SCENES];
