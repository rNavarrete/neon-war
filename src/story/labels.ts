// On-screen labels for the story layer that are not script lines (button captions and the
// debrief's result names). Script text stays in src/strings.ts; these are interface words.

export const LABELS = {
  skip: 'Skip',
  chat: 'STREAM CHAT',
  replay: 'REPLAY',
  rec: 'REC',
  rewinding: 'REWINDING',
  results: 'TONIGHT',
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
  card: 'THE INTERVIEW VERSION',
  clickOn: 'click to continue',
} as const;
