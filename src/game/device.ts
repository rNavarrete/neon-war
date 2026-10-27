// Neon War is desktop only (16:9, mouse). Phones and narrow windows get a short note instead of the
// game. The decision is pure so it is unit-tested; `readDevice` is the only part that reads the browser.

/** Narrowest window the game starts in, in CSS pixels. */
export const MIN_WIDTH = 900;

export const COMPUTER_NOTE =
  'Neon War is made for a computer with a mouse and a wide screen. Open this page on a computer to play.';

export interface DeviceInfo {
  /** Window width in CSS pixels. */
  width: number;
  /** True when any input can point precisely (a mouse or trackpad). */
  finePointer: boolean;
  /** Touch points the device reports (0 without a touch screen). */
  maxTouchPoints: number;
}

/** True when the game should not start: a narrow window, or a touch screen with no mouse. */
export function needsComputer(d: DeviceInfo): boolean {
  if (d.width < MIN_WIDTH) return true;
  return d.maxTouchPoints > 0 && !d.finePointer;
}

export function readDevice(w: Window): DeviceInfo {
  let finePointer = true;
  try {
    finePointer = w.matchMedia('(any-pointer: fine)').matches;
  } catch {
    // No matchMedia: assume a desktop browser.
  }
  return { width: w.innerWidth, finePointer, maxTouchPoints: w.navigator.maxTouchPoints ?? 0 };
}

/** Show the "play on a computer" note in place of the game. Text nodes only, never HTML. */
export function showComputerNote(parent: HTMLElement): HTMLElement {
  const note = document.createElement('div');
  note.id = 'play-on-computer';
  note.setAttribute('role', 'status');
  note.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;' +
    'box-sizing:border-box;background:#05070f;color:#2de2e6;font:20px/1.5 monospace;text-align:center;';
  const text = document.createElement('p');
  text.style.maxWidth = '28em';
  text.textContent = COMPUTER_NOTE;
  note.appendChild(text);
  parent.appendChild(note);
  return note;
}
