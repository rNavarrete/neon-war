# Recorded voices

Every spoken line of Session 0 (131 lines: the scene lines and the barks of `docs/SCRIPT.md`) has
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
same Lux voices, from the project's cloud session at Rolando's request. The same session then
re-recorded the 23 stale takes and recorded the 20 coach nudges (30 Oct 2026, after Rolando heard
the TV say "ten minutes" over a "five minutes" caption), from
`redo-lines-2026-10-30.json` in the voice pipeline folder.

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

- `C0.grandma.01`: "Lux? Your show's starting, love." became "Lux, it's almost midnight, love. Come
  downstairs." (Rolando, 30 Oct 2026). The old take still plays until it is re-recorded; the
  Japanese line for the take is ルクス、もうすぐ年越しよ。下りておいで。

Two lines differ only in stage directions written into the text (`C5.rei.cut` has "(beat)",
`C5.rei.04` has "(to Lux)"); the spoken words match the takes.

## Not recorded yet

Spoken lines added since the last recording session. They show as text with no voice (the mixer
lists them in `shell.voice.missing`) until they are recorded and added to the manifest.

- `C0.triage.01` (TRIAGE, worried): "Hey... you okay, Lux?" / ねえ……ルクス、大丈夫？ Rewritten with the
  cold open's new check-in beat (Rolando, 30 Oct 2026); the old take ("Recording! ... it's the net
  again") said something else entirely, so it was removed rather than left to play as a stale take.
- `C0.lux.03` (Lux, wiping her eyes): "Yeah. I'm fine." / うん。平気。
- `C0.triage.02` (TRIAGE, reading the chat): "Uh... your chat's blowing up. The block's net is dropping
  again." / えっと……チャットが大騒ぎ。またブロックのネットが落ちてる。

## Speaker changed

None. Every take was recorded by the character the script names now.
