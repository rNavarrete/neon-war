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
