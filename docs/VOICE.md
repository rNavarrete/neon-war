# Recorded voices

Every spoken line of Session 0 recorded so far (111 lines: the scene lines and the barks of `docs/SCRIPT.md`) has
a recorded clip in Japanese and in English. This page covers where the clips come from, how to
re-record one and which takes are out of date. How the game plays them (channels, the duck, one
voice at a time, lazy groups) is in `docs/AUDIO.md`.

## Where the files come from

Rolando recorded the lines with ElevenLabs (model `eleven_v3`, 128 kbps mono MP3) using the saved
cast voices. The source text is `lines.json` in the voice pipeline folder (one row per line:
`[id, character, english, japanese]`, with performance tags such as `[excited]` that are spoken
as delivery, not as words). `log.jsonl` there records one row per take.

- Clips: `public/audio/voice/ja/<LINE_ID>.mp3` and `public/audio/voice/en/<LINE_ID>.mp3`. The
  build copies `public/` into `dist/` as static files, so nothing is bundled into the game's
  script.
- English TRIAGE takes use the Japanese TRIAGE voice reading the English text, because ElevenLabs
  would not design an English one (Rolando's casting). Under the English setting the game plays
  every line's `en` take, TRIAGE's included (`src/game/voice.ts`).
- `tests/fixtures/voice-recorded-lines.json` is a copy of the `lines.json` the takes were made
  from. Refresh it whenever you re-record.

Lux's 26 board lines (30 Oct 2026, `C1.lux.placed` to `C7.lux.count`) were recorded the same way, with the
same Lux voices, from the project's cloud session at Rolando's request.

## The manifest

`public/audio/voice/manifest.json` is `{"ja": [ids], "en": [ids]}`: the ids that have a clip in
each language, in script order. The build bundles it (`bundledVoiceManifest()` in
`src/game/mixer.ts`), and the mixer requests only the ids it lists. Every other id is recorded in
`shell.voice.missing` and the band keeps its text timing.

The mixer loads only the previous, current and next challenge's clips (about 20 to 30 small files
at a time, never all 170), after the game has started.

`tests/voice-files.test.ts` checks that the manifest lists only spoken lines, every spoken line in
each language, exactly the files on disk, that each file is a real MP3 under 1 MB, and that the
stale list below matches the script.

## Re-recording a line (on Rolando's Mac)

1. Update `lines.json` from `docs/SCRIPT.md` (the English and Japanese text of the changed line).
2. Delete the old take: `voice_lines.py` never overwrites a file in `out/lines/<lang>/`.
3. Run `python3 voice_lines.py ja <LINE_ID>` and `python3 voice_lines.py en <LINE_ID>`. Leave out
   the ids to record every missing line; `--dry-run` lists what would be recorded. The API key
   comes from the macOS Keychain (service `neon-relay-elevenlabs`).
4. Copy the new files into `public/audio/voice/<lang>/`, add any new id to the manifest, and copy
   `lines.json` over `tests/fixtures/voice-recorded-lines.json`.
5. Take the line off the stale list below and run `npm test`.

A take whose wording is slightly old stays in place until it is re-recorded: a slightly old take
beats silence. A take whose speaker changed is removed from the files and the manifest, because it
would be the wrong voice.

## Stale takes

Lines whose words changed in `src/strings.ts` since they were recorded. Words are compared without
the performance tags, the stage directions in brackets and quotes.

- `C1.triage.01`: "Ooh, a dial!" became "Ooh, a card!" when the estimate dial was removed. The
  old take still plays until it is re-recorded.
- `C1.triage.02`: "480 a second!" became TRIAGE's alarm about the lift when the opening dropped its
  sums (30 Oct 2026).
- `C1.lux.01`: "You multiplied. Divide." became "Okay. Breathe. I know this one." (same change).
- `C1.triage.03`: "...30. That's what I meant." became TRIAGE taking credit for the lights coming
  back (same change). `C1.triage.01`, `C1.triage.05` and `C1.triage.06` changed again in it too.
  These old takes say different words, so the six C1 lines want new takes first.
- `C0.tv.01`: "ten minutes from midnight" became "five minutes" when the countdown was shortened
  (29 Oct 2026).
- `C3.triage.01`: "The kit makes a box bigger..." became "A bigger box, or a second box..." when
  the overclock kit became the bigger box (29 Oct 2026).
- `C3.triage.03`: "Rebooting..." became "Swapping in the big one..." (same change).
- `C4.grandma.01`: "Three minutes, love!" became "Two minutes, love!" (shorter countdown).
- `C5.triage.02`: "The big box fried. It's a normal box again." became "The big box cooked. The
  crew put a normal one back." (bigger box).

Real system-design terms (Rolando, 29 Oct 2026: "keep all the terminology and system design jargon
intact"): "box" became "server", "splitter" became "load balancer", "room" became "capacity" or
"headroom", and "coming" became "requests a second" or "demand". `C1.triage.01`, `C3.triage.01` and
`C5.triage.02` above changed again in the same pass. These need new takes too:

- `C1.triage.05`
- `C1.triage.06`
- `C2.triage.after`
- `C3.lux.01`
- `C4.triage.02`
- `C4.triage.cut`
- `C5.rei.03`
- `C5.ozzie.02`
- `C5.triage.03`
- `C5.mika.05`
- `C6.triage.01`
- `C7.ozzie.01`
- `C7.triage.01`
- `C8.rei.waste`

Two lines differ only in stage directions written into the text (`C5.rei.cut` has "(beat)",
`C5.rei.04` has "(to Lux)"); the spoken words match the takes.

## Not recorded yet

Spoken lines added since the last recording session. They show as text with no voice (the mixer
lists them in `shell.voice.missing`) until they are recorded and added to the manifest.

- `C1.triage.nudge.place.1`
- `C1.triage.nudge.place.2`
- `C1.lux.nudge.place`
- `C1.triage.nudge.feed.1`
- `C1.triage.nudge.feed.2`
- `C1.lux.nudge.feed`
- `C1.triage.nudge.store.1`
- `C1.triage.nudge.store.2`
- `C1.lux.nudge.store`
- `C3.triage.nudge.choose.1`
- `C3.triage.nudge.choose.2`
- `C3.triage.nudge.idle`
- `C3.lux.nudge.idle`
- `C5.triage.nudge.splitter`
- `C5.lux.nudge.splitter`
- `C5.triage.nudge.behind.1`
- `C5.triage.nudge.behind.2`
- `C5.lux.nudge.behind`
- `C5.triage.nudge.replace.1`
- `C5.lux.nudge.replace`

## Speaker changed

None. Every take was recorded by the character the script names now.
