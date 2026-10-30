// The anime opening (Rolando, 30 Oct 2026): a 60 s video, played full screen over the canvas only in
// attract mode, after ATTRACT_IDLE_S with no input on the title ("just have it play if the user stays on
// the main screen idle for 20 seconds"). Any key, click or tap stops it. The rules are pure so they are unit-tested in node; playOpening() owns
// the DOM. WebM (VP9/Opus) first, MP4 (H.264/AAC) for Safari, both served from public/video/.

import { provideTestState } from '../testHook';

export const OPENING_SOURCES: readonly { src: string; type: string }[] = [
  { src: 'video/opening.webm', type: 'video/webm' },
  { src: 'video/opening.mp4', type: 'video/mp4' },
];

/** Seconds with no input on the title before attract mode plays the opening. */
export const ATTRACT_IDLE_S = 20;

export type OpeningReason = 'attract';

/** Whether attract mode is due: `limit` seconds since the last input (null: attract is off). */
export function attractDue(lastInput: number, now: number, limit: number | null): boolean {
  return limit !== null && now - lastInput >= limit;
}

/** What the browser tests read about the opening (only with ?test). */
export interface OpeningTestState {
  playing: boolean;
  reason: OpeningReason | null;
}

declare module '../testHook' {
  interface TestSections {
    opening: OpeningTestState;
  }
}

let current: { reason: OpeningReason; close: () => void } | null = null;

export function openingPlaying(): boolean {
  return current !== null;
}

provideTestState('opening', () => ({
  playing: current !== null,
  reason: current?.reason ?? null,
}));

/**
 * Play the opening over everything. `onEnd` runs once, when it ends or is skipped. Skip presses are
 * caught at the window in the capture phase and stopped there, so the game never sees them (a release
 * over a menu button would otherwise press it).
 */
export function playOpening(
  reason: OpeningReason,
  opts: { muted: boolean; volume: number },
  onEnd: () => void,
): void {
  if (current) return;
  const video = document.createElement('video');
  for (const s of OPENING_SOURCES) {
    const source = document.createElement('source');
    source.src = s.src;
    source.type = s.type;
    video.appendChild(source);
  }
  video.playsInline = true;
  video.muted = opts.muted;
  video.volume = Math.max(0, Math.min(1, opts.volume));
  Object.assign(video.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    background: '#000',
    zIndex: '10',
  });
  const hint = document.createElement('div');
  hint.textContent = 'Press any key to skip';
  Object.assign(hint.style, {
    position: 'fixed',
    right: '24px',
    bottom: '18px',
    zIndex: '11',
    color: 'rgba(230, 233, 242, 0.55)',
    font: '14px system-ui, sans-serif',
    letterSpacing: '0.08em',
    pointerEvents: 'none',
  });

  const skip = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  const swallow = (e: Event): void => e.stopPropagation();
  const close = (): void => {
    if (!current) return;
    current = null;
    window.removeEventListener('keydown', skip, true);
    window.removeEventListener('pointerup', skip, true);
    window.removeEventListener('pointerdown', swallow, true);
    window.removeEventListener('mousedown', swallow, true);
    window.removeEventListener('mouseup', swallow, true);
    video.pause();
    video.remove();
    hint.remove();
    onEnd();
  };
  current = { reason, close };
  window.addEventListener('keydown', skip, true);
  window.addEventListener('pointerup', skip, true);
  window.addEventListener('pointerdown', swallow, true);
  window.addEventListener('mousedown', swallow, true);
  window.addEventListener('mouseup', swallow, true);
  video.addEventListener('ended', close);
  // A file the browser can't play, or sound it won't allow, must never leave the player on a black screen.
  video.addEventListener('error', close);
  video.lastElementChild?.addEventListener('error', close);
  document.body.append(video, hint);
  video.play().catch(() => {
    if (!current) return;
    video.muted = true;
    video.play().catch(close);
  });
}
