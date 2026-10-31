// The anime opening (Rolando, 30 Oct 2026): a 60 s video, played full screen over the canvas only in
// attract mode, after ATTRACT_IDLE_S with no input on the title ("just have it play if the user stays on
// the main screen idle for 20 seconds"). Any key, click or tap stops it.
// It goes through black both ways (Rolando: the cut between the title music and the opening was abrupt):
// the title and its music fade out together, a beat of black and silence, then the opening fades up; on
// the way out the opening fades down, the title fades back up and its music returns. The curves are pure
// (time in, levels out) so they are unit-tested in node; playOpening() owns the DOM and drives them.
// WebM (VP9/Opus) first, MP4 (H.264/AAC) for Safari, both served from public/video/.

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

/** The fades, in seconds. */
export const FADE = {
  /** Title picture and music down to black and silence, together. */
  out: 1.5,
  /** Black and silence before the opening starts. */
  hold: 0.5,
  /** The opening's picture and sound up from black. */
  in: 0.4,
  /** The opening down to black on a skip. */
  skip: 0.3,
  /** The opening down to black when it ends by itself. */
  ended: 1,
  /** The title's picture back up from black after the opening. */
  titleUp: 0.5,
  /** The title music back in after the opening. */
  musicUp: 1.5,
  /** An input during the fade in: the title's picture and music back over this. */
  cancel: 0.3,
} as const;

/** Where every fade stands: the title music's gain, the black over the title, the opening's picture and sound. */
export interface Levels {
  music: number;
  black: number;
  video: number;
}

// Rounded to a millionth so the fades land exactly on 0 and 1 at their ends (2.4 - 2.0 is not 0.4 in floats).
const clamp01 = (x: number): number => Math.max(0, Math.min(1, Math.round(x * 1e6) / 1e6));

/** Seconds into the fade in when the opening starts playing (after the fade out and the hold). */
export const VIDEO_START = FADE.out + FADE.hold;

/** Going in, t seconds after attract mode fires. */
export function entryLevels(t: number): Levels {
  const down = clamp01(t / FADE.out);
  return { music: 1 - down, black: down, video: clamp01((t - VIDEO_START) / FADE.in) };
}

/** Coming out, t seconds after a skip or the end: the opening down over `down`, then the title back. */
export function exitLevels(t: number, down: number): Levels {
  const after = t - down;
  return {
    video: 1 - clamp01(t / down),
    black: after < 0 ? 1 : 1 - clamp01(after / FADE.titleUp),
    music: after < 0 ? 0 : clamp01(after / FADE.musicUp),
  };
}

/** An input during the fade in, t seconds ago: from the levels it caught back to the title over FADE.cancel. */
export function cancelLevels(t: number, from: Levels): Levels {
  const k = clamp01(t / FADE.cancel);
  return { music: from.music + (1 - from.music) * k, black: from.black * (1 - k), video: 0 };
}

type Phase = 'entry' | 'video' | 'exit' | 'cancel';

/** What the browser tests read about the opening (only with ?test). */
export interface OpeningTestState {
  /** True from the moment attract mode fires until the title is fully back. */
  playing: boolean;
  reason: OpeningReason | null;
  phase: Phase | null;
  /** The gain the title music is under right now (1 when no opening is running). */
  titleMusicGain: number;
}

declare module '../testHook' {
  interface TestSections {
    opening: OpeningTestState;
  }
}

let current: { reason: OpeningReason; phase: Phase; levels: Levels } | null = null;

export function openingPlaying(): boolean {
  return current !== null;
}

/** The gain the title music is under: the overlay scene multiplies the title loop's volume by it. */
export function titleMusicGain(): number {
  return current ? current.levels.music : 1;
}

provideTestState('opening', () => ({
  playing: current !== null,
  reason: current?.reason ?? null,
  phase: current?.phase ?? null,
  titleMusicGain: titleMusicGain(),
}));

function layer(el: HTMLElement, z: number): void {
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    background: '#000',
    zIndex: String(z),
    opacity: '0',
  });
}

/**
 * Fade the title out and play the opening over everything. `hooks.black` runs when the title is fully
 * black and silent (pause it there), `hooks.titleBack` when the title should start drawing again (resume
 * it), `hooks.done` once the title is fully back. Inputs are caught at the window in the capture phase and
 * stopped there the whole time, so the game never sees them (a release over a menu button would press it).
 */
export function playOpening(
  reason: OpeningReason,
  opts: { muted: boolean; volume: number },
  hooks: { black: () => void; titleBack: () => void; done: () => void },
): void {
  if (current) return;
  const black = document.createElement('div');
  layer(black, 9);
  const video = document.createElement('video');
  for (const s of OPENING_SOURCES) {
    const source = document.createElement('source');
    source.src = s.src;
    source.type = s.type;
    video.appendChild(source);
  }
  video.playsInline = true;
  video.preload = 'auto';
  video.muted = opts.muted;
  layer(video, 10);
  video.style.objectFit = 'contain';
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
    opacity: '0',
  });
  const volume = clamp01(opts.volume);

  const run = { reason, phase: 'entry' as Phase, levels: entryLevels(0) };
  current = run;
  let start = performance.now();
  let paused = false;
  let started = false;
  let down: number = FADE.skip;
  let from = run.levels;
  let raf = 0;

  const enter = (phase: Phase): void => {
    run.phase = phase;
    start = performance.now();
  };
  const exit = (seconds: number): void => {
    if (run.phase !== 'video') return;
    down = seconds;
    enter('exit');
  };
  const cancel = (): void => {
    from = run.levels;
    if (paused) {
      paused = false;
      hooks.titleBack();
    }
    enter('cancel');
  };
  const finish = (): void => {
    cancelAnimationFrame(raf);
    for (const [type, fn] of listeners) window.removeEventListener(type, fn, true);
    video.pause();
    video.remove();
    hint.remove();
    black.remove();
    current = null;
    hooks.done();
  };

  const tick = (now: number): void => {
    const t = Math.max(0, (now - start) / 1000);
    if (run.phase === 'entry' || run.phase === 'video') {
      run.levels = entryLevels(t);
      if (!paused && t >= FADE.out) {
        paused = true;
        hooks.black();
      }
      if (!started && t >= VIDEO_START) {
        started = true;
        run.phase = 'video';
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => exit(FADE.skip));
        });
      }
    } else if (run.phase === 'exit') {
      run.levels = exitLevels(t, down);
      if (paused && t >= down) {
        paused = false;
        video.pause();
        hooks.titleBack();
      }
      if (t >= down + Math.max(FADE.titleUp, FADE.musicUp)) return finish();
    } else {
      run.levels = cancelLevels(t, from);
      if (t >= FADE.cancel) return finish();
    }
    black.style.opacity = String(run.levels.black);
    video.style.opacity = String(run.levels.video);
    hint.style.opacity = String(run.levels.video);
    video.volume = volume * run.levels.video;
    raf = requestAnimationFrame(tick);
  };

  // Before the opening shows, an input calls it off; while it plays, an input skips it.
  const press = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    if (run.phase === 'entry') cancel();
    else if (run.phase === 'video') exit(FADE.skip);
  };
  const swallow = (e: Event): void => e.stopPropagation();
  const listeners: [string, (e: Event) => void][] = [
    ['keydown', press],
    ['pointerup', press],
    ['pointerdown', swallow],
    ['mousedown', swallow],
    ['mouseup', swallow],
  ];
  for (const [type, fn] of listeners) window.addEventListener(type, fn, true);
  video.addEventListener('ended', () => exit(FADE.ended));
  // A file the browser can't play must never leave the player on a black screen.
  const failed = (): void => {
    if (run.phase === 'entry') cancel();
    else exit(FADE.skip);
  };
  video.addEventListener('error', failed);
  video.lastElementChild?.addEventListener('error', failed);
  document.body.append(black, video, hint);
  raf = requestAnimationFrame(tick);
}
