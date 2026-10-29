// Scenes the player has already watched, kept in localStorage so a replay can be skipped. Storage
// can be missing or throw (private windows); then nothing counts as seen and nothing is saved.

const KEY = 'neon-war.seen-scenes';

export function seenScenes(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function wasSeen(id: string): boolean {
  return seenScenes().includes(id);
}

export function markSeen(id: string): void {
  try {
    const seen = seenScenes();
    if (!seen.includes(id)) window.localStorage.setItem(KEY, JSON.stringify([...seen, id]));
  } catch {
    // Storage unavailable: the scene just can't be skipped next time.
  }
}
