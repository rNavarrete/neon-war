import { type ConsoleMessage, expect, test } from '@playwright/test';
import type { VoiceTestState } from '../../src/game/mixer';
import { dismissJobCard, hud, openBoard } from './live/reach';

// The mixer's voice channel (tech-5) with the recorded voices on disk (docs/VOICE.md): a band line
// asks the mixer for its clip, the mixer records the request in shell.voice, fetches the clip once
// (from public/audio/voice/<lang>/, listed in public/audio/voice/manifest.json) and plays it:
// voiceStart names it, playing names it while it sounds and the music ducks under it. The
// assertions are on requests and the mixer's own state, never on what is audible.
//
// Changed when the files landed: this test used to assert the no-files state (every id in
// `missing`, nothing started, playing null, loaded 0, gains never ducked, no /audio/voice/ request).
// Those described a drop that had not happened; each is replaced by the new truth below.

async function voice(page: import('@playwright/test').Page): Promise<VoiceTestState> {
  return page.evaluate(
    () => (window.__neonTest!.state as unknown as { shell: { voice: VoiceTestState } }).shell.voice,
  );
}

test('a bark asks the mixer for its voice: the clip is fetched once and plays, no console error', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const consoleErrors: string[] = [];
  const voiceRequests: string[] = [];
  const failed: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('request', (req) => {
    if (req.url().includes('/audio/voice/')) voiceRequests.push(new URL(req.url()).pathname);
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('/audio/voice/')) failed.push(req.url());
  });
  page.on('response', (res) => {
    if (res.url().includes('/audio/voice/') && res.status() >= 400)
      failed.push(`${res.status()} ${res.url()}`);
  });

  const { errors } = await openBoard(page, { speed: 20, autopilot: true });
  const before = await voice(page);
  expect(before.recentVoice).toEqual([]);
  expect(before.playing).toBeNull();
  expect(before.gains).toEqual({ music: 1, sfx: 1, voice: 1 });

  await dismissJobCard(page);
  await expect
    .poll(async () => (await hud(page)).bark.history, { timeout: 20_000, intervals: [50] })
    .toContain('C1.triage.02');
  await expect
    .poll(async () => (await voice(page)).recentVoice, { timeout: 5_000, intervals: [50] })
    .toContain('C1.triage.02');
  // The clip loaded and started: voiceStart named it.
  await expect
    .poll(async () => (await voice(page)).started, { timeout: 10_000, intervals: [50] })
    .toContain('C1.triage.02');

  const v = await voice(page);
  // Every id asked for is in the manifest, so none is missing; each started at most once per request.
  expect(v.missing).toEqual([]);
  for (const id of v.started) expect(v.recentVoice).toContain(id);
  // Only the previous, current and next groups are loaded: C1 is current, C0 and C2 either side.
  expect(v.groups).toEqual([0, 1, 2]);
  expect(v.loaded).toBeGreaterThan(0);
  expect(v.loaded).toBeLessThan(85);

  // The clip was fetched, in Japanese (the default setting), exactly once.
  expect(voiceRequests.filter((u) => u.endsWith('/audio/voice/ja/C1.triage.02.mp3'))).toHaveLength(1);
  // Nothing is fetched twice, nothing in English, and never outside the loaded groups (C0 to C2).
  expect(new Set(voiceRequests).size).toBe(voiceRequests.length);
  for (const u of voiceRequests) expect(u).toMatch(/\/audio\/voice\/ja\/C[0-2]\.[^/]+\.mp3$/);
  expect(failed).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(errors).toEqual([]);
});

test('a playing clip names its id and ducks the music; it is never recorded as missing', async ({ page }) => {
  test.setTimeout(45_000);
  const { errors } = await openBoard(page, { speed: 1, autopilot: true });
  await dismissJobCard(page);
  // At speed 1 a take (one to three seconds) is still sounding when the next poll comes.
  await expect
    .poll(async () => (await voice(page)).playing, { timeout: 20_000, intervals: [25] })
    .not.toBeNull();
  const v = await voice(page);
  expect(v.playing).not.toBeNull();
  expect(v.started).toContain(v.playing);
  expect(v.recentVoice).toContain(v.playing);
  expect(v.missing).toEqual([]);
  // Under a voice the music and the effects duck (fully: 0.35 and 0.7 once the 150 ms ramp is in).
  await expect
    .poll(async () => (await voice(page)).gains.music, { timeout: 5_000, intervals: [25] })
    .toBeLessThan(1);
  expect(errors).toEqual([]);
});
