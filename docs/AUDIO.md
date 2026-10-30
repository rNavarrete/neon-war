# Audio in public/audio

Session 0's music and sound effects. They were picked on 27 Oct 2026 from the candidates on branch
`claude/project-thread-sctaoa` (`docs/art-candidates/sound/` and `docs/art-candidates/music/`).

- Effects come from ElevenLabs and the music from Suno, as Rolando decided on 26 Oct 2026.
- Everything loads from `public/`, never from the network.
- The music is one 2 min 41 s loop, "Cell Shaped Chaos". It ships twice: `.ogg` (Opus, copied from the original
  without re-encoding) and `.mp3` (160 kbps) for browsers without Ogg Opus. Load both under one key and let Phaser
  pick.

## Music

| File                            | Length  | Plays                      |
| ------------------------------- | ------- | -------------------------- |
| `music/cell-shaped-chaos.{ogg,mp3}` | 2:41 | On the board, looped; stops in scenes |
| `music/euphoric-menace.{ogg,mp3}` | 2:31 | On the title screen, looped; fades out over 0.8 s when the title closes |

The title has a speaker icon (top right, or the M key) that mutes and unmutes all music, title and board.
The choice is kept in settings (`musicMuted`). Effects and voices still play. Browsers hold audio until the
first click or key press, so the title music starts then if the page opened silent.

"Euphoric Menace" was picked by Rolando on 30 Oct 2026. Its loudness (−15.0 LUFS) is close to "Cell Shaped
Chaos" (−15.6 LUFS), so the two tracks need no gain change.

## Effects (`sfx/`, MP3)

| File                | Length | Plays when                                              |
| ------------------- | ------ | ------------------------------------------------------- |
| `place-part.mp3`    | 1.0 s  | A part lands in a slot                                  |
| `wire-connect.mp3`  | 1.0 s  | A wire is made                                          |
| `wire-cut.mp3`      | 1.0 s  | A wire is cut, or the laundry floor is cut loose        |
| `server-hot.mp3`    | 3.0 s  | A server goes over 100% load                            |
| `server-die.mp3`    | 2.0 s  | A server dies from overheating                          |
| `power-dip.mp3`     | 3.0 s  | A power dip takes a part dark                           |
| `surge-warning.mp3` | 2.0 s  | A surge warning appears                                 |
| `banner-pop.mp3`    | 1.5 s  | The Solace banner slides in                             |
| `credits.mp3`       | 0.7 s  | Credits are spent or refunded                           |
| `regroup-slow.mp3`  | 3.0 s  | Regroup starts                                          |
| `rescue-cable.mp3`  | 2.0 s  | The crew's cable drops at the rescue                    |
| `rewind.mp3`        | 2.0 s  | A rewind (TRIAGE's replay or Rei's)                     |
| `goggles-on.mp3`    | 2.0 s  | Lux pulls her goggles down (cold open)                  |
| `triage-blip.mp3`   | 1.0 s  | A TRIAGE bark appears                                   |
| `triage-panic.mp3`  | 1.5 s  | A panicking TRIAGE bark appears                         |
| `tv-countdown.mp3`  | 15.0 s | The TV downstairs, cold open and the last seconds of C6 |
| `midnight-cheer.mp3`| 8.0 s  | Midnight holds                                          |
| `fireworks.mp3`     | 10.0 s | Midnight and the debrief                                |
| `rain-loop.mp3`     | 20.0 s | Scenes in Lux's room, looped                            |
| `ui-click.mp3`      | 0.5 s  | Any button press                                        |
| `ui-hover.mp3`      | 0.5 s  | Hovering a button                                       |

## Live screen effects (`LIVE_SFX_KEYS`, not yet on disk)

The Live screen adds four effects. They live in `LIVE_SFX_KEYS` in `src/game/mixer.ts`, beside
`SFX_KEYS` in `src/game/audio.ts`, which stays pinned at 21 by `tests/shell-audio.test.ts`.
`isSfxKey` accepts either list, and every emitter guards with it. The files come from the owner's
ElevenLabs run (decision D6), never from a worker. This table is that run's list.

Lengths and loudness are targets for the run, not measured files.

| File                | Length | Loudness | Plays when                                               |
| ------------------- | ------ | -------- | -------------------------------------------------------- |
| `server-online.mp3` | 0.8 s  | -18 LUFS | A server finishes booting and starts taking packets      |
| `packet-drop.mp3`   | 0.4 s  | -22 LUFS | A packet is dropped at a full box                        |
| `health-skip.mp3`   | 0.6 s  | -20 LUFS | The balancer skips a part that is dark or booting        |
| `headroom-red.mp3`  | 1.0 s  | -18 LUFS | The bar under the deck turns red (at most once per 10 s) |

Until a file lands an emitter asking for it is recorded in `shell.recentSfx` and stays silent.
When the files land, the pipeline also writes `public/audio/sfx/manifest.json`, a JSON array of
the keys present (for example `["server-online", "headroom-red"]`). The build bundles that list,
and the overlay scene loads only the keys it names, so a half-finished drop never requests a
missing file.

## Voices

Crew and Lux lines are voiced by the owner's pipeline: `public/audio/voice/<lang>/<LINE_ID>.mp3`
(`ja` and `en`, about -16 LUFS, 128 kbps mono). TRIAGE's English takes are her Japanese voice
reading the English lines. See `docs/VOICE.md`. With the drop the
pipeline writes `public/audio/voice/manifest.json`, `{"ja": [ids], "en": [ids]}`: the ids present
in each language. The build bundles the manifest. Without it the game requests no voice file at all.

## The mixer (`src/game/mixer.ts`)

The mixer is Phaser-free and is unit-tested in `tests/mixer.test.ts` against a fake `SoundPort`.
`OverlayScene` is the real port over Phaser's sound manager.

- **Channels.** There are three: music, sfx and voice. Each gain is a share of the volume set in
  Settings.
- **Ducking.** While a voice clip plays, music drops to 0.35x and sfx to 0.7x. The drop ramps in
  over 150 ms, and the restore ramps out over 400 ms after `voiceEnd`. Both run on the HUD clock
  (real seconds times the test speed, stopped while the board is held).
- **One voice at a time.** A comms band `line` (or a `voice` request from the replay glyph) asks
  for that line's clip, and a new request stops the clip playing first (`voiceEnd` for it). A
  `voiceStop` request stops it as well. Once a clip plays, the mixer emits
  `voiceStart {id, seconds}`, and the band holds the line until the clip ends plus 0.6 s.
- **Only listed ids.** The mixer requests only ids listed in the manifest. Every other id asked for
  goes into `shell.voice.missing`. It plays nothing and sends no `voiceStart`, so the band keeps
  its text dwell.
- **Lazy groups.** Each line belongs to the group of its challenge (`C4.triage.02` is group 4). The
  mixer keeps loaded only the groups of the previous, current and next challenge of
  `frame().now`. It never preloads all of them. A rewind moves `now` back, and the groups follow
  on the next frame.

`shell.voice` in the test hook mirrors it: `recentVoice` (the ids asked for, the last 20),
`missing`, `playing`, `started` (the ids that sent `voiceStart`), `groups`, `loaded` and `gains`.
Headless browsers keep WebAudio locked, so tests assert the requests and never what is audible.
