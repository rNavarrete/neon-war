// On-screen labels for the story layer that are not script lines (button captions and the
// debrief's result names). Script text stays in src/strings.ts; these are interface words.

export const LABELS = {
  skip: 'Skip',
  chat: 'STREAM CHAT',
  replay: 'REPLAY',
  rec: 'REC',
  rewinding: 'REWINDING',
  /** The scorecard's midnight line (1 Nov 2026). */
  midnightHeld: (servers: number) => `MIDNIGHT HELD on ${servers} server${servers === 1 ? '' : 's'}`,
  midnightDark: 'BLOCK DARK AT MIDNIGHT',
  /** The one-screen end (2 Nov 2026): its kicker, the lesson's label and the way out. */
  complete: 'SESSION COMPLETE',
  lesson: "TONIGHT'S LESSON",
  endSession: 'click to end the session',
  dropped: 'Dropped requests',
  wasted: 'Wasted credits',
  trust: 'Trust left',
  banner: 'Solace banner',
  ozzie: "Ozzie's tab",
  scaledDown: 'Scaled down after midnight',
  bannerPay: 'Paid',
  bannerIgnore: 'Ignored',
  bannerBin: 'Binned',
  bannerNone: 'No answer',
  yes: 'Yes',
  no: 'No',
  turnPage: 'click to turn the page',
  clickOn: 'click to continue',
};
