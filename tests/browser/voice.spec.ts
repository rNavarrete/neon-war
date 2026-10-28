import { type ConsoleMessage, expect, test } from '@playwright/test';
import type { VoiceTestState } from '../../src/game/mixer';
import { dismissJobCard, hud, openBoard } from './live/reach';

// The mixer's voice channel (tech-5) with no voice drop on disk: a band line asks the mixer for its
// clip, the mixer records the request in shell.voice and, since public/audio/voice/manifest.json
// does not list it, plays nothing, fetches nothing and logs nothing. Headless browsers keep audio
// locked, so this asserts the requests, never audibility.

async function voice(page: import('@playwright/test').Page): Promise<VoiceTestState> {
  return page.evaluate(
    () => (window.__neonTest!.state as unknown as { shell: { voice: VoiceTestState } }).shell.voice,
  );
}

test('a bark asks the mixer for its voice: recorded as missing, no file requested, no console error', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const consoleErrors: string[] = [];
  const voiceRequests: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('request', (req) => {
    if (req.url().includes('/audio/voice/')) voiceRequests.push(req.url());
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

  const v = await voice(page);
  // Every id asked for is missing (no manifest), each listed once, and nothing played or ducked.
  expect(v.missing).toContain('C1.triage.01');
  expect(v.missing).toContain('C1.triage.02');
  for (const id of v.recentVoice) expect(v.missing).toContain(id);
  expect(new Set(v.missing).size).toBe(v.missing.length);
  expect(v.started).toEqual([]);
  expect(v.playing).toBeNull();
  expect(v.loaded).toBe(0);
  expect(v.gains).toEqual({ music: 1, sfx: 1, voice: 1 });
  // The groups follow the night's clock: C1 is current, C0 and C2 either side.
  expect(v.groups).toEqual([0, 1, 2]);

  expect(voiceRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(errors).toEqual([]);
});
