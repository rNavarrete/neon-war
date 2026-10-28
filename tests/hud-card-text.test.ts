import hudSource from '../src/scenes/HudScene.ts?raw';
import {
  CARD_TEXT_POOL,
  type DressableText,
  HOST_TEXTS,
  HOST_TEXT_BUDGET,
  bannerTexts,
  dressCardText,
  jobCardTexts,
} from '../src/scenes/hud/cardText';
import { BANNER_BUTTONS, CENTRE } from '../src/scenes/hud/layout';
import { line } from '../src/strings';

// Tech follow-up 3: the HUD host's cards cost 13 texts or less (docs/LIVE.md "Budgets"). The job
// card and the Solace banner share one pool of texts, and every word either card showed before is
// still on it.

describe('the host text budget', () => {
  it('the job card keeps all seven of its words', () => {
    const t = jobCardTexts();
    expect(t.map((s) => s.text)).toEqual([
      '120',
      line('C1.card.title'),
      line('C1.card.who'),
      line('C1.card.what'),
      line('C1.card.bar'),
      line('C1.card.rate'),
      'OK',
    ]);
    const ok = t[6];
    expect([ok.x, ok.y]).toEqual([CENTRE.jobCardOk.x, CENTRE.jobCardOk.y]);
  });

  it('the banner keeps its title, its body and the three button words on their buttons', () => {
    const t = bannerTexts();
    const labels = line('C2.banner.buttons').split(' / ');
    expect(t.map((s) => s.text)).toEqual([line('C2.banner.title'), line('C2.banner.body'), ...labels]);
    const k = CENTRE.banner.scale;
    expect([t[2].x, t[2].y]).toEqual([BANNER_BUTTONS.pay.dx * k, BANNER_BUTTONS.pay.dy * k]);
    expect([t[3].x, t[3].y]).toEqual([BANNER_BUTTONS.ignore.dx * k, BANNER_BUTTONS.ignore.dy * k]);
  });

  it('one pool serves both cards: the wordier card sets its size', () => {
    expect(CARD_TEXT_POOL).toBe(7);
  });

  it('the host makes 13 texts or less in all', () => {
    const total = HOST_TEXTS.cards + HOST_TEXTS.dip + HOST_TEXTS.sizing + HOST_TEXTS.dial;
    expect(total).toBeLessThanOrEqual(HOST_TEXT_BUDGET);
    expect(HOST_TEXT_BUDGET).toBe(13);
  });

  it('HudScene adds texts only for the pool, the dip line and the sizing line', () => {
    const calls = hudSource.match(/this\.add\s*\.text\(/g) ?? [];
    expect(calls.length).toBe(3);
    expect(hudSource).toMatch(
      /for \(let i = 0; i < CARD_TEXT_POOL; i\+\+\) this\.cardTexts\.push\(this\.add\.text\(/,
    );
    // The sizing prompt's arrow is drawn, not typed.
    expect(hudSource).not.toMatch(/'→'/);
  });
});

describe('dressCardText', () => {
  function stub(): DressableText & { log: string[]; visible: boolean } {
    const log: string[] = [];
    const rec =
      (name: string) =>
      (...a: unknown[]): void => {
        log.push(`${name}(${a.map((x) => JSON.stringify(x)).join(',')})`);
      };
    const t = {
      log,
      visible: true,
      setText: rec('setText'),
      setPosition: rec('setPosition'),
      setOrigin: rec('setOrigin'),
      setFontFamily: rec('setFontFamily'),
      setFontSize: rec('setFontSize'),
      setFontStyle: rec('setFontStyle'),
      setColor: rec('setColor'),
      setAlign: rec('setAlign'),
      setWordWrapWidth: rec('setWordWrapWidth'),
      setVisible(v: boolean) {
        t.visible = v;
      },
    };
    return t;
  }

  it('dresses a text as its spec and shows it', () => {
    const t = stub();
    const s = bannerTexts()[0];
    dressCardText(t, s);
    expect(t.visible).toBe(true);
    expect(t.log).toContain(`setText(${JSON.stringify(s.text)})`);
    expect(t.log).toContain('setFontStyle("bold")');
    expect(t.log).toContain(`setPosition(${s.x},${s.y})`);
    expect(t.log).toContain('setOrigin(0.5,0)');
  });

  it('clears the wrap and the bold of an earlier card, and hides a text the card does not need', () => {
    const t = stub();
    dressCardText(t, jobCardTexts()[6]);
    expect(t.log).toContain('setWordWrapWidth(null)');
    expect(t.log).toContain('setFontStyle("")');
    dressCardText(t, undefined);
    expect(t.visible).toBe(false);
  });
});
