#!/usr/bin/env python3
"""Neon War: Brownout art round 4, the three pieces the challenge design added (docs/GAME.md, "Art and sound"):
the overclock kit (a tray card and an overclocked look for the scrap server), the job card frame and the
estimate dial. Two takes of each so Rolando can pick.
Usage: brownout_art3.py all|<job> ... [--dry-run]
Reuses brownout_art.py's runner: one /images/edits call per job (about $0.20), outputs in out/brownout/<job>.png,
never overwritten, so it is safe to re-run. Same Keychain key (service neon-relay-openai), never printed.
References are the picked round-3 sheets, so the new pieces match the art already in the game."""
import sys
import brownout_art as b
import brownout_art2 as b2

SERVER_REF = ["brownout/parts-servers.png"]
UI_REF = ["brownout/ui-panels.png"]

OVERCLOCK = (b2.STYLE + b2.TRIO + b2.AR + "Match the small scrap server tower in the reference image exactly: same "
    "case, same size, same angle. 1: the overclock kit on its own, a home-made upgrade: a chunky bolt-on cooling "
    "block with a big second fan, copper heat pipes, a bundle of fat red power leads and a hand-soldered booster "
    "board, all held together with zip ties and duct tape. 2: the same scrap server with the kit strapped onto its "
    "side, running hard but healthy: both fans spinning, a hot violet-white glow from the vents, LEDs racing, "
    "a faint electric shimmer. 3: the same overclocked server cooking: vents glowing orange-red, the extra fan "
    "smoking, sparks from the booster board." + b2.NO_TEXT + b2.MAGENTA)

JOB_CARD = (b2.STYLE + b2.UI + "Match the panel style of the reference image exactly. A single job card frame, "
    "like a work order a teenage fixer receives in her AR goggles: a portrait-shaped smoked-glass card, a tab at "
    "the top for a title, a small square slot at the top left for a photo of an apartment block, three empty "
    "ruled rows in the middle for requirements, a highlighted empty strip at the bottom for the goal, a strip of "
    "duct tape across one corner and a small amber pin at the top. All of it empty inside, ready for text. Centred, "
    "fully visible." + b2.NO_TEXT + b2.MAGENTA)

DIAL = (b2.STYLE + b2.UI + "Match the panel style of the reference image exactly. A single estimate dial for a "
    "game HUD, seen straight on: a big round chunky rotary knob salvaged from old audio gear, knurled metal grip "
    "with a bright cyan pointer line, sitting in a round smoked-glass housing with a ring of evenly spaced blank "
    "tick marks glowing cyan, a small empty rectangular readout window below the knob for a number, a strip of "
    "duct tape on the housing. Centred, fully visible." + b2.NO_TEXT + b2.MAGENTA)

NEW = {
    "overclock-kit-a": ("1536x1024", SERVER_REF, OVERCLOCK),
    "overclock-kit-b": ("1536x1024", SERVER_REF, OVERCLOCK),
    "job-card-a": ("1024x1536", UI_REF, JOB_CARD),
    "job-card-b": ("1024x1536", UI_REF, JOB_CARD),
    "estimate-dial-a": ("1024x1024", UI_REF, DIAL),
    "estimate-dial-b": ("1024x1024", UI_REF, DIAL),
}
b.JOBS.update(NEW)

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    jobs = list(NEW) if args == ["all"] else args
    bad = [j for j in jobs if j not in NEW]
    if not jobs or bad:
        sys.exit(f"usage: brownout_art3.py all|<job> ... [--dry-run]; unknown: {bad}")
    b.DIR.mkdir(parents=True, exist_ok=True)
    for j in jobs:
        b.run(j, "--dry-run" in sys.argv)
