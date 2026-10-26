#!/usr/bin/env python3
"""Neon War: Brownout art round 3, everything still missing from the session spec's art inventory
(https://claude.ai/artifact/WsaFpkAYob7fyJXfrCWLNT): board parts, HUD kit, icons, menus, story screens.
Usage: brownout_art2.py <batch or job> [...] [--dry-run]
  batches: board, ui, story, all
Reuses brownout_art.py's runner: one /images/edits call per job (about $0.20), outputs in out/brownout/<job>.png,
never overwritten, so it is safe to re-run. Same Keychain key (service neon-relay-openai), never printed.

Style decisions this round follows (Rolando, 2026-10-26): painted art, not pixelized; the board is what Lux sees
through her AR goggles laid over her bedroom, so board parts are her real scrap hardware drawn as small objects with
a faint cyan AR outline; TRIAGE is Lux's own imperfect assistant AI living in her round camera drone."""
import sys
import brownout_art as b

STYLE = ("Highly detailed 90s anime cyberpunk illustration, rich painterly light, the same rendering style, palette "
         "and level of detail as the reference image (take only the style from it, never its composition). ")
NO_TEXT = " No text, no letters, no numbers, no logos, no labels, no borders, no grid lines."
MAGENTA = " Plain solid flat magenta background (#FF00FF) everywhere around the objects, no shadows on the ground."
TRIO = ("Three separate objects side by side in one row, evenly spaced with wide gaps, all the same scale, each "
        "seen from the same slightly-above three-quarter angle like game pieces on a board, each fully visible. ")
GRID6 = ("Six separate items arranged in a grid of 3 columns and 2 rows, evenly spaced with wide gaps, all the same "
         "size, each centred in its cell, each fully visible. ")
AR = ("Each object has a faint thin cyan holographic outline glow around its silhouette, as if seen through AR "
      "goggles. ")
SCRAP = ("Home-made from salvaged junk: dented beige and grey computer cases, mismatched screws, duct tape, zip ties, "
         "hand-painted marker scribbles that are only abstract squiggles, sticker residue, coloured ribbon cables. ")
UI = ("A game user-interface kit in the style of a home-made AR goggles display: dark translucent smoked-glass "
      "panels with soft cyan edge glow, thin amber accent lines, small strips of grey duct tape holding some corners, "
      "slight scanline texture, clean and readable. Flat front view, no perspective. ")
REFS = [b.STREET]

NEW = {
    # Board pieces
    "parts-servers": ("1536x1024", REFS, STYLE + TRIO + AR + "Three versions of the same small scrap server tower, "
        + SCRAP + "a few blinking status LEDs and a little fan. 1: running normally, green LEDs, calm. 2: overheating, "
        "glowing orange-red vents, heat shimmer, a wisp of smoke, amber warning LEDs. 3: dead, completely dark, all "
        "lights off, scorched black streaks on the case, a thin trail of grey smoke." + NO_TEXT + MAGENTA),
    "parts-core": ("1536x1024", REFS, STYLE + TRIO + AR + "1: the block's network gateway, a battered wall-mounted "
        "router box with four bent antennas, a tangle of cables out of its bottom, a single big green status light. "
        "2: the residents' database, a squat stack of three old hard-drive enclosures strapped together with "
        "a bungee cord, a calm blue status light. 3: the same database stack overloaded and timing out, red "
        "flashing lights, drives rattling, a small pile of glowing amber data cubes heaped up beside it."
        + NO_TEXT + MAGENTA),
    "parts-crew": ("1536x1024", REFS, STYLE + TRIO + AR + "1: a load balancer built by a skilled teenage hacker crew, "
        "clean and sleek compared to scrap: a low matte-black box with a coral-red racing stripe, a fan of neat "
        "cable ports along the front, a row of crisp white lights. 2: an empty build slot, a flat square floor pad "
        "of scuffed metal with a dashed glowing cyan outline and corner marks, waiting for a part. 3: a locked "
        "build slot, the same floor pad darker and dimmed, a chunky padlock hologram hovering over it."
        + NO_TEXT + MAGENTA),
    "block-cutaway": ("1024x1536", REFS, STYLE + "A cutaway cross-section of a narrow self-built slum apartment "
        "tenement, five storeys tall, front wall removed like a dollhouse, seen straight on. Each floor shows three "
        "tiny flats with residents' silhouettes, warm lamps, blue TV glow, laundry, party lights for New Year's Eve. "
        "Ground floor: a coin laundry with a row of washing machines on the left and a tiny arcade with two glowing "
        "cabinets on the right. Rooftop: water tank, antennas, a satellite dish. Cables run down the outside wall. "
        "Every window lit." + NO_TEXT + MAGENTA),
    "solace-banner": ("1536x1024", REFS, STYLE + "A floating corporate advertisement panel that slides into a "
        "player's AR view: a wide glossy rectangle, immaculate white and pale silver with a soft cyan gradient, "
        "perfectly clean and sterile, a calm abstract corporate symbol of interlocking rings on the left, a large "
        "empty area in the middle for text, two blank pill-shaped buttons and a small round close button at the "
        "bottom right. It must look out of place, too clean and too perfect next to scrappy home-made gear. Flat "
        "front view, centred." + NO_TEXT + MAGENTA),
    "crew-cable": ("1024x1536", REFS, STYLE + "A single thick black network cable dropping straight down from the "
        "top edge, wrapped in coral-red tape at intervals, ending in a big industrial plug with a glowing white "
        "tip throwing a few sparks. Centred, vertical." + NO_TEXT + MAGENTA),
    # HUD kit
    "ui-panels": ("1536x1024", REFS, STYLE + UI + "A sprite sheet of empty frames, evenly spaced with wide gaps: "
        "top left, a large wide window panel for a chart; top right, a tall narrow side panel for a chat feed; "
        "middle left, a long wide dialogue text box; middle right, a small tab-shaped nameplate; bottom left, a "
        "compact square panel for a countdown clock; bottom middle, a wide warning bar with amber diagonal hazard "
        "stripes at both ends; bottom right, a horizontal tray panel with five empty card sockets. All frames "
        "empty inside." + NO_TEXT + MAGENTA),
    "ui-buttons": ("1536x1024", REFS, STYLE + UI + GRID6 + "1: a wide rectangular button, normal. 2: the same "
        "button highlighted, brighter cyan glow. 3: the same button pressed, darker and inset. 4: a round power "
        "button with a slow-motion clock symbol, fully charged and glowing violet. 5: the same round button spent, "
        "grey and dark. 6: a small parts card, a blank playing-card-shaped tile with a slot for a picture."
        + NO_TEXT + MAGENTA),
    "ui-icons-a": ("1536x1024", REFS, STYLE + GRID6 + "Six game HUD icons, bold readable silhouettes, glowing "
        "cyan and amber, home-made AR style: 1 a stack of worn scrap credit chips. 2 a little apartment block with a "
        "heart, for the neighbours' trust. 3 a cracked digital alarm clock. 4 an amber warning triangle. 5 a "
        "lightning bolt over a flickering bulb, for a power dip. 6 a thermometer in the red, for overheating."
        + NO_TEXT + MAGENTA),
    "ui-icons-b": ("1536x1024", REFS, STYLE + GRID6 + "Six game HUD icons, bold readable silhouettes, glowing "
        "cyan and amber, home-made AR style: 1 a chunky padlock. 2 a dented trash bin. 3 a single glowing data "
        "packet, a small amber cube with a light trail. 4 a pause symbol. 5 a gear for settings. 6 a pair of "
        "scissors cutting a cable, for cutting a floor loose." + NO_TEXT + MAGENTA),
    "goggles-overlay": ("1536x1024", REFS, STYLE + "First-person view looking out through home-made see-through AR "
        "goggles: only the frame of the visor is drawn, around the very edges of the image: the curved edge of a "
        "clear plastic visor, strips of grey duct tape and a zip tie at the corners, faint scratches and a small "
        "crack in one corner, a soft cyan HUD glow hugging the rim, a tiny red recording dot top right. Everything "
        "inside the rim, the whole centre of the image, is plain solid flat magenta (#FF00FF)." + NO_TEXT),
    "triage-moods": ("1536x1024", ["lux-streamer-body.png"], STYLE + GRID6 + "TRIAGE, a small round grey camera "
        "drone (the one floating beside the girl in the reference image) that is a girl's home-made assistant AI. "
        "Its big round camera lens is its face: the iris and a ring of light around it show its mood. Same drone, "
        "same size and angle in every cell: 1 eager, iris wide and bright cyan, tilted forward. 2 thinking, iris "
        "half-closed, a spinning ring of dots. 3 wrong but proud, iris in a smug curve, little sparkle. 4 "
        "panicking, iris tiny and red, wobbling with motion lines. 5 sheepish, iris looking down and to the side, "
        "dim. 6 happy, iris a bright upturned arc." + NO_TEXT + MAGENTA),
    # Menus and story screens
    "logo": ("1536x1024", REFS, STYLE + "A game title logo reading exactly NEON WAR, in two lines or one, bold "
        "chunky condensed letters built like a flickering neon sign mounted on a scrappy metal frame, cyan and "
        "hot-pink neon tubes, one letter flickering half dark, exposed wires and a few strips of tape on the "
        "frame. Only the words NEON WAR, spelled correctly, no other text." + MAGENTA),
    "night-book-page": ("1536x1024", REFS, STYLE + "An open battered notebook lying flat, seen straight from "
        "above, filling the image: the crew's handbook. The left page is covered in old faded handwriting in blue "
        "ink, small sketches of wires and boxes and arrows, coffee rings, all the writing tiny and illegible, "
        "abstract squiggles only. The right page is clean, faintly lined and empty, ready to be written on, with a "
        "pencil lying across the corner. Warm desk-lamp light, a dog-eared corner, tape on the spine." + NO_TEXT),
    "bg-bedroom-midnight": ("1536x1024", ["brownout/bg-bedroom-lit.png"], "Edit this exact image. Keep the room, "
        "the camera, the composition and every object exactly where it is, same art style. Only change what is "
        "outside the window: it is just after midnight on New Year's Day and the whole sky over the city is full "
        "of huge colourful fireworks, their light washing warm gold and pink over the wet window glass and onto "
        "the room. The slum street's party lights are all lit." + b.BG_TAIL),
    "bg-immersive": ("1536x1024", REFS, STYLE + "A fully immersive digital space inside AR goggles: the hideout "
        "of a teenage hacker crew rendered as a virtual world. An endless dark violet void with a glowing cyan grid "
        "floor stretching to the horizon, floating fragments of a ruined city (a rooftop with a water tank, an "
        "arcade cabinet, a train carriage) hanging in the air like islands, cables of light connecting them, a "
        "huge slow moon made of wireframe, drifting particles. Wide composition for a 2D game scene, centre "
        "foreground clear for characters to stand." + NO_TEXT + " No people, no characters."),
}
b.JOBS.update(NEW)

BATCHES = {
    "board": ["parts-servers", "parts-core", "parts-crew", "block-cutaway", "solace-banner", "crew-cable"],
    "ui": ["ui-panels", "ui-buttons", "ui-icons-a", "ui-icons-b", "goggles-overlay", "triage-moods"],
    "story": ["logo", "night-book-page", "bg-bedroom-midnight", "bg-immersive"],
}
BATCHES["all"] = [j for v in BATCHES.values() for j in v]

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    jobs = [j for a in args for j in BATCHES.get(a, [a])]
    bad = [j for j in jobs if j not in NEW]
    if not jobs or bad:
        sys.exit(f"usage: brownout_art2.py {'|'.join(BATCHES)}|<job> ... [--dry-run]; unknown: {bad}")
    b.DIR.mkdir(parents=True, exist_ok=True)
    for j in jobs:
        b.run(j, "--dry-run" in sys.argv)
