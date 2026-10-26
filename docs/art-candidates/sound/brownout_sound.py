#!/usr/bin/env python3
"""Neon War: Brownout sound, all generated with ElevenLabs (sound effects + music).
Usage: brownout_sound.py <batch or job> [...] [--dry-run]
  batches: sfx, music, all
One API call per job. Outputs go to out/brownout-sound/<job>.mp3 and are never overwritten: a job whose file exists
is skipped, so the script is safe to re-run. One line per call is appended to out/brownout-sound/log.jsonl.
The key comes only from macOS Keychain (service neon-relay-elevenlabs) and is never printed or written to disk."""
import json, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

DIR = Path(__file__).resolve().parent / "out" / "brownout-sound"
API = "https://api.elevenlabs.io/v1"
WORLD = "Cyberpunk slum on a rainy New Year's Eve, 90s anime film sound. "

# job: (kind, seconds, loop, prompt)
SFX = {
    "rain-loop": (20, True, "Steady rain on a tenement window and a tin roof, muffled city hum behind it, no thunder."),
    "tv-countdown": (15, False, "Muffled TV through the floor of an apartment: a New Year's countdown show, crowd "
                     "cheering and a host shouting, heard through a ceiling, indistinct words."),
    "fireworks": (10, False, "Distant fireworks bursting over a city at night, crackles and booms echoing between "
                  "buildings, heard through a closed window."),
    "midnight-cheer": (8, False, "Midnight on New Year's: distant crowds cheering from many apartment windows, "
                       "party horns, a big firework barrage, joyful."),
    "goggles-on": (2, False, "A plastic visor clicking down over the eyes, then a soft rising electronic hum as a "
                   "heads-up display boots up, small digital chirps."),
    "power-dip": (3, False, "Electrical brownout: a buzzing hum sags, lights flicker with crackling relay clicks, "
                  "then everything powers down with a dying whine."),
    "server-hot": (3, False, "Overheating computer: a cheap fan screaming at full speed, rising pitch, short "
                   "rhythmic warning beeps."),
    "server-die": (2, False, "A small computer dying: fan whine spinning down, a sharp electrical pop and a fizzle."),
    "surge-warning": (2, False, "Urgent short synth alert for a game warning, two descending tones, tense, clean."),
    "place-part": (1, False, "A heavy metal box set down on a floor, then a cable plugging in with a firm click."),
    "wire-connect": (1, False, "A quick electric zap and snap as a cable connects, small and satisfying."),
    "wire-cut": (1, False, "Wire cutters snipping a thick cable, a tiny spark."),
    "regroup-slow": (3, False, "Time slowing down: a deep whoosh, everything pitching down and stretching, a low "
                     "heartbeat, then a held breath."),
    "rescue-cable": (2, False, "A heavy cable dropping from above and clanging onto metal, then a crackle of "
                     "sparks and a power surge hum."),
    "banner-pop": (1.5, False, "A clean, sterile corporate notification chime, glossy and too pleasant."),
    "credits": (0.7, False, "Spending money in a game: a few small scrap metal chips clinking."),
    "triage-blip": (1, False, "A cute small drone chirping a quick question, little robotic beeps, friendly."),
    "triage-panic": (1.5, False, "A small drone panicking: rapid worried robotic beeps and a wobbly propeller whir."),
    "rewind": (2, False, "A VHS tape rewinding fast with digital glitch stutters, then a snap back to silence."),
    "ui-click": (0.5, False, "Soft glassy user-interface click, subtle, futuristic."),
    "ui-hover": (0.5, False, "Very soft short airy UI tick for hovering a button, subtle."),
}
MUSIC = {
    "music-board": (120, "Tense lo-fi cyberpunk synth score for a strategy game, 90s anime film style. Steady "
                    "driving pulse around 100 bpm, analog synth bass, soft breakbeat, glassy arpeggios, distant "
                    "rain texture, slowly building tension, no vocals. Seamless loop, ends where it begins."),
    "music-scene": (90, "Melancholic lo-fi piano and warm synth pads, quiet and lonely, a teenage girl alone in her "
                    "room on New Year's Eve missing her mother, vinyl crackle and rain, slow, no drums, no vocals. "
                    "Seamless loop."),
    "music-finale": (60, "The last minute before midnight: urgent cyberpunk synth music, ticking clock percussion, "
                     "rising strings and synth, racing toward a climax, 90s anime action, no vocals."),
    "music-win-sting": (12, "A short triumphant hopeful synth and piano sting for surviving until midnight, warm, "
                        "emotional, fireworks-bright, resolving chord, no vocals."),
}
JOBS = {**{k: ("sfx",) + v for k, v in SFX.items()}, **{k: ("music", v[0], True, v[1]) for k, v in MUSIC.items()}}
# Music is made in Suno (Rolando, 2026-10-26); the music jobs stay here only as a fallback.
BATCHES = {"sfx": list(SFX), "music": list(MUSIC), "all": list(SFX)}


def key():
    return subprocess.run(["security", "find-generic-password", "-s", "neon-relay-elevenlabs", "-w"],
                          capture_output=True, text=True, check=True).stdout.strip()


def post(path, body, k):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"xi-api-key": k, "Content-Type": "application/json",
                                          "Accept": "audio/mpeg"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read()


def run(job, dry, k):
    kind, secs, loop, prompt = JOBS[job]
    out = DIR / f"{job}.mp3"
    if out.exists():
        return print(json.dumps({"job": job, "skipped": "exists"}))
    if dry:
        return print(json.dumps({"job": job, "kind": kind, "secs": secs, "loop": loop, "chars": len(prompt)}))
    t = time.time()
    try:
        if kind == "sfx":
            body = {"text": WORLD + prompt, "duration_seconds": max(0.5, secs), "prompt_influence": 0.5}
            if loop:
                body["loop"] = True
            audio = post("/sound-generation", body, k)
        else:
            audio = post("/music", {"prompt": prompt, "music_length_ms": int(secs * 1000)}, k)
    except urllib.error.HTTPError as e:
        line = {"job": job, "error": f"{e.code} {e.read()[:300].decode(errors='replace')}"}
    except Exception as e:  # network errors: log and move on, a re-run retries
        line = {"job": job, "error": str(e)[:300]}
    else:
        out.write_bytes(audio)
        line = {"job": job, "file": f"brownout-sound/{out.name}", "secs": round(time.time() - t), "bytes": len(audio)}
    with open(DIR / "log.jsonl", "a") as f:
        f.write(json.dumps(line) + "\n")
    print(json.dumps(line), flush=True)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    jobs = [j for a in args for j in BATCHES.get(a, [a])]
    bad = [j for j in jobs if j not in JOBS]
    if not jobs or bad:
        sys.exit(f"usage: brownout_sound.py {'|'.join(BATCHES)}|<job> ... [--dry-run]; unknown: {bad}")
    DIR.mkdir(parents=True, exist_ok=True)
    dry = "--dry-run" in sys.argv
    k = None if dry else key()
    for j in jobs:
        run(j, dry, k)
