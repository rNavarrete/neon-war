#!/usr/bin/env python3
"""Neon War: the Brownout art list (https://claude.ai/artifact/Vjy48G8XizZg9uejFiKoLW), all in gpt-image-2.
Usage: brownout_art.py <batch or job> [...] [--dry-run]
  batches: bg (5 backgrounds), lux (2 face sheets + 3 pose sheets), crew (Rei, Mika, Ozzie), extras (photo, avatars)
Each job is one /images/edits call (about $0.20). Outputs go to out/brownout/<job>.png and are never overwritten:
a job whose file exists is skipped, so the script is safe to re-run. One line per call is appended to out/brownout/log.jsonl.
The key comes only from macOS Keychain (service neon-relay-openai) and is never printed or written to disk."""
import base64, json, sys, time
from bakeoff import OUT, ApiError, key
from lux_gpt import call

DIR = OUT / "brownout"
STREET = "slum-street-openai.png"
LUX = "lux-fit-1-nirvana-baby.png"
LUX_FACE = "lux-goggles-portrait.png"

# Backgrounds: match the picked street exactly in style.
BG = ("Use the reference image only for its art style, palette, lighting and level of detail: highly detailed 90s "
      "anime cyberpunk pixel art, crisp pixels, rich painterly light, warm bulbs and TV glow on the poor block, cold "
      "cyan and magenta neon only on the distant clean corporate towers. Do not copy its composition. ")
BG_TAIL = (" Light rain. No people, no animals, no characters anywhere. No text, no letters, no numbers, no logos, no "
           "signs with writing; any screen or poster is blank or abstract.")
ROOM = ("Lux's bedroom, the interior of a cramped room on the fourth floor of a self-built slum tenement in a "
        "rain-soaked megacity on New Year's Eve, just before midnight. Wide side-view composition for a 2D game "
        "scene, eye level, the whole room visible like a stage set, the floor across the bottom fifth kept clear "
        "in the centre so characters can stand there. Patched plaster walls with exposed pipes and conduit, cables "
        "taped along the walls, a low sagging ceiling with a bare bulb. Left: an unmade single bed on a pallet "
        "frame, thin futon mattress, crumpled patchwork blanket, a worn cat plush, stickers on the headboard. Back "
        "wall centre: a big rain-streaked window with a rusty window cage, looking down onto the slum street with "
        "strings of party lights and red paper lanterns, and far off the Solace Systems towers with fireworks above "
        "them. Right: a cluttered home-made desk built from a door on crates: an old CRT monitor and two cracked "
        "flat monitors, a mechanical keyboard, a soldering iron in its stand, coils of wire, open energy-drink cans, "
        "a spare clear goggle lens on a soldering mat beside a roll of electrical tape, and a taped-up phone on a "
        "charger. At the front corner of the desk, angled toward the viewer, a small wooden picture frame with a "
        "photo of a smiling woman, a folded paper charm tucked into the frame. On a wall shelf above the desk: a "
        "charging dock for a small round grey camera drone (the drone sits in it), a ring light, a microphone on a "
        "boom arm and a small red ON-AIR bulb. Fictional 90s grunge band posters with abstract art and no readable "
        "words, sticky notes, a string of fairy lights pinned along the wall. Far right: the door to the hallway, "
        "slightly open, warm light spilling through the gap.")
JOBS = {
    "bg-skyline": ("1536x1024", [STREET], BG + "Wide establishing shot of the megacity Halation on New Year's Eve, a "
        "few minutes before midnight, seen from the edge of a slum rooftop. Foreground, bottom third: slum rooftops "
        "of corrugated tin, patched concrete and plywood, shacks built on top of roofs, water tanks on stilts, "
        "satellite dishes, antennas, laundry lines, a web of spliced cables strung with bare bulbs, coloured party "
        "lights and red paper lanterns, puddles on flat roofs, smoke from a fire barrel. Middle: more leaning slum "
        "blocks stretching away in layers, thousands of small warm windows and blue TV glow. Background: a cluster "
        "of clean white megatowers of the Solace Systems corporation blazing with cold neon, searchlights sweeping "
        "the clouds; the tallest tower carries one giant rectangular screen high up, glowing but blank. Low rain "
        "clouds lit from below. Keep the sky in the upper middle fairly open, because fireworks and a title are "
        "added there later in code." + BG_TAIL),
    "bg-bedroom-lit": ("1536x1024", [STREET], BG + ROOM + " Lighting: a single warm desk lamp and the monitors' glow, "
        "the red ON-AIR bulb lit, warm fairy lights, cool blue city light through the wet window, rain drops on "
        "the glass. Cosy, lonely, lived-in." + BG_TAIL),
    # an edit of the lit room, so it must run after bg-bedroom-lit
    "bg-bedroom-dark": ("1536x1024", ["brownout/bg-bedroom-lit.png"], "Edit this exact image. Keep the room, the "
        "camera, the composition and every object exactly where it is, same art style. Only the lighting changes: "
        "the power has just died. The desk lamp, the monitors, the bare bulb, the fairy lights, the ON-AIR bulb and "
        "the hallway light are all off. The room is almost black, deep blue shadows. The only light left: cold blue "
        "light through the wet window, where the slum street outside has also gone dark while the distant corporate "
        "towers still blaze with neon and fireworks; a faint glint on the glass of the picture frame; one tiny green "
        "standby light on the drone dock." + BG_TAIL),
    "bg-rooftop": ("1536x1024", [STREET], BG + "The rooftop of the same slum block at night on New Year's Eve. Wide "
        "side-view composition for a 2D game scene, eye level, centre foreground kept clear so characters can stand "
        "there. A wet flat concrete roof with puddles reflecting the lights, a low crumbling parapet, rusty water "
        "tanks on stilts, a forest of antennas and satellite dishes, a little shack of corrugated tin with a blue "
        "tarp, laundry lines. On the right: the block's main power and network feed, a thick bundle of black cables "
        "running from a rusty junction box on a steel pole across the gap to the next building. One heavy cable is "
        "cut clean through, its loose end lying in a puddle, spitting bright blue-white sparks. Strings of party "
        "lights and red lanterns sag from the cables. Behind: the city skyline with the clean Solace Systems towers "
        "blazing cold neon, one giant blank screen, and fireworks bursting over them." + BG_TAIL),
    "bg-grandma-flat": ("1536x1024", [STREET], BG + "A small old-fashioned Japanese living room one floor down in "
        "the same slum tenement, New Year's Eve. Wide side-view composition for a 2D game scene, eye level. Worn "
        "tatami mats and patched linoleum, a low kotatsu table with a quilted blanket, bowls of New Year's soba "
        "noodles, a dish of mandarins and a teapot on it. Against the left wall, a boxy old CRT television on a "
        "wooden cabinet, its screen glowing bright with a festive countdown show: a cheering crowd, confetti and "
        "stage lights, no readable writing. A small household shrine shelf with a candle, a sprig of pine and a "
        "framed photo. Paper lanterns, a wall calendar with a picture and no writing, a sliding paper door. On the "
        "right, an open doorway to a narrow steep wooden staircase leading up. A small rainy window. Warm cosy "
        "light from a paper floor lamp and the blue flicker of the TV." + BG_TAIL),
}

# Lux: always from her locked design. Sheets keep one face across every frame.
LUX_DESIGN = ("Lux, a 15-year-old Japanese girl: short choppy black bob with a gold hair clip, warm brown eyes, "
              "translucent yellow raincoat worn open over an oversized faded white long-sleeve band T-shirt, baggy "
              "cargo shorts over black leggings, knee pads, high-top sneakers with mismatched yellow and pink laces, "
              "a home-made streaming-rig backpack with a tall antenna and a red light, and her home-made see-through AR goggles, "
              "a clear taped-together visor with a thin headband, which she wears at all times")
LUX_REFS = [LUX, LUX_FACE]
SHEET = ("Character sheet in highly detailed 90s anime cyberpunk pixel art, the same style as the reference images, "
         "the exact same character in every panel, same face, hair, clip and clothes: " + LUX_DESIGN + ". ")
FACES = ("Six bust portraits, head and shoulders, arranged in a grid of 3 columns and 2 rows, evenly spaced, every "
         "head the same size and at the same height in its cell, three-quarter view, each a clearly different "
         "emotion with expressive anime acting. ")
SOLID = (" No drone, no props unless named, no shadows on the ground, no text, no labels, no numbers, no grid lines, "
         "no borders. Plain solid flat magenta background (#FF00FF) everywhere around the figures.")
POSES = ("Three full-body poses side by side in one row, evenly spaced, whole body visible head to shoes in every "
         "pose, all figures the same scale with feet on one shared baseline, clearly different poses with strong "
         "readable silhouettes. ")
GOG_OFF = "Offline: her see-through AR goggles rest around her neck like headphones, her eyes uncovered. "
GOG_ON = ("She wears her home-made AR goggles over her eyes: a clear taped-together visor through which her eyes "
          "are still visible, faint cyan holographic glow on the glass. ")
JOBS |= {
    "lux-faces-room-v2": ("1536x1024", LUX_REFS, SHEET + FACES + GOG_OFF + "The six emotions, left to right, top row "
        "then bottom row: 1 grieving: looking down at a small wooden picture frame held in both hands, eyes wet, "
        "one tear on her cheek, mouth pressed tight. 2 pulling herself together: wiping her eyes with the back of "
        "her raincoat sleeve, jaw set. 3 startled: eyes wide, eyebrows up, lips parted, face lit from below by a "
        "phone screen. 4 relieved: a small soft smile, eyes half closed, shoulders dropping. 5 exhausted: "
        "cheeks puffed, blowing out a long breath, hair messy. 6 frightened in sudden darkness: face lit only "
        "from below by a cold blue glow, eyes wide, the rest in shadow." + SOLID),
    "lux-faces-board": ("1536x1024", LUX_REFS, SHEET + FACES + GOG_ON + "The six emotions, left to right, top row "
        "then bottom row: 1 tense concentration: brow furrowed, biting her lip, eyes darting. 2 determined: leaning "
        "in, small fierce frown, jaw set. 3 deadpan: flat unimpressed stare, one eyebrow lowered, mouth a straight "
        "line. 4 shocked: mouth open, eyebrows high, sweat drop. 5 confident smirk: one corner of the mouth up, "
        "eyes narrowed. 6 triumphant: huge open grin straight at the viewer, flashing a peace sign next to her "
        "face." + SOLID),
    "lux-poses-room-v2": ("1536x1024", LUX_REFS, SHEET + POSES + "Pose 1: sitting on the floor hugging her knees, side "
        "view facing right, holding a small wooden picture frame against her knees, head bowed, goggles resting "
        "around her neck. Pose 2: standing, front three-quarter view, lifting the goggles from around her neck up over her eyes with both hands, "
        "elbows out, getting ready. Pose 3: standing, turned away from the viewer, goggles around her neck, looking back over her shoulder "
        "with one hand half raised as if someone just called her name." + SOLID),
    "lux-poses-board": ("1536x1024", LUX_REFS, SHEET + POSES + GOG_ON + "Pose 1: standing three-quarter view facing "
        "right, right arm reaching forward with the fingers spread as if touching a floating hologram, weight on "
        "her front foot. Pose 2: standing facing right, arm fully extended pointing ahead, head turned back toward "
        "the viewer as if explaining something. Pose 3: a fast two-handed slashing swipe across her body from upper "
        "left to lower right, knees bent, raincoat flaring with the motion, fierce expression." + SOLID),
    "lux-poses-win-v2": ("1536x1024", LUX_REFS, SHEET + POSES + "Pose 1: goggles on, standing facing right, tapping "
        "the air with her right index finger while her left hand drags something sideways, focused. Pose 2: goggles "
        "on, jumping with both arms thrown up in a cheer, huge grin, raincoat flying, both feet off the ground. "
        "Pose 3: goggles pulled down around her neck, sitting cross-legged on the floor, leaning back on her hands, "
        "worn out with a tired happy smile." + SOLID),
}

# The crew appear as holograms in Lux's goggles (the tint is added in code), so draw them normally on magenta.
CREW = ("Redraw this character from the first reference image in the art style of the second reference image "
        "(take only the rendering style from it, never that girl's face, hair or clothes): highly detailed 90s anime "
        "cyberpunk pixel art, crisp pixels, the exact same character in every panel: ")
REI = ("Rei, 18, the crew lead of a teenage hacker crew: Japanese, a long messy wolf cut dyed half black and half "
       "white, a septum ring, a boxy cropped coral-red padded racing jacket over a black top, black cargo trousers, "
       "a fingerless glove on the right hand, faint burn scars on the right forearm, cool and cocky")
MIKA = ("Mika Santos, 17, the crew's data analyst: Filipina, a neat dark bob, round glasses, a far-too-big grey "
        "hospital orderly jacket with the sleeves rolled up over a black turtleneck, an amber hospital ID tag on a "
        "lanyard, holding a cracked tablet, calm and watchful")
OZZIE = ("Ozzie Achebe, 19, the crew's money and supplies guy: Nigerian, tall and lanky, dark skin, a sharp high-top "
         "fade, a thin moustache, a thrifted camel overcoat over a teal retro track jacket, a gold calculator "
         "watch, a battered ledger notebook, a blank old corporate ID badge on a lanyard, sceptical")
JOBS |= {
    "rei-poses": ("1536x1024", ["crew-lux-teen.png", LUX], CREW + REI + ". " + POSES + "Pose 1: a crouched "
        "landing, one knee and one fist on the ground, head up with a smirk, jacket flaring. Pose 2: standing, arms "
        "crossed, weight on one hip, smirking. Pose 3: stern, stepping forward and pointing straight at the viewer, "
        "eyes hard." + SOLID),
    "rei-faces": ("1536x1024", ["crew-lux-teen.png", LUX], CREW + REI + ". " + FACES + "1 smirk. 2 stern and cold. "
        "3 quietly impressed, eyebrows up, small nod. 4 grading: looking down at a small floating tablet, "
        "unreadable. 5 laughing with head tilted back. 6 annoyed sigh, eyes rolled." + SOLID),
    "mika-sheet": ("1536x1024", ["crew-mika-teen.png", LUX], CREW + MIKA + ". Top row: three bust portraits, head "
        "and shoulders, same size: 1 calm, 2 worried, 3 a small reassuring smile. Bottom row: three bust "
        "portraits: 4 explaining, pointing to the side at something off-frame, 5 focused on her tablet, its glow "
        "on her glasses, 6 a slow nod. Evenly spaced grid of 3 columns and 2 rows." + SOLID),
    "mika-poses": ("1536x1024", ["crew-mika-teen.png", LUX], CREW + MIKA + ". " + POSES + "Pose 1: standing calmly, "
        "tablet held to her chest. Pose 2: turned to the side, arm extended pointing at something off-frame to "
        "the right, glancing back at the viewer. Pose 3: reading her tablet, pushing up her glasses with one "
        "finger." + SOLID),
    "ozzie-poses": ("1536x1024", ["crew-ozzie.png", LUX], CREW + OZZIE + ". " + POSES + "Pose 1: annoyed, holding "
        "up a single coin between finger and thumb, open ledger in the other hand. Pose 2: a big shrug, palms up, "
        "eyebrows raised. Pose 3: arms folded, a grudging half smile and a nod, impressed despite himself." + SOLID),
    "ozzie-faces": ("1536x1024", ["crew-ozzie.png", LUX], CREW + OZZIE + ". " + FACES + "1 sceptical raised "
        "eyebrow. 2 annoyed, pinching the bridge of his nose. 3 grudging half smile. 4 doing sums, pencil behind "
        "his ear, eyes up. 5 alarmed, eyes wide. 6 smug grin." + SOLID),
}

JOBS |= {
    "akemi-photo": ("1024x1024", [LUX, LUX_FACE], "Highly detailed 90s anime pixel art, the same style as the "
        "reference images. A small worn wooden picture frame with a chipped corner, seen straight on, filling most "
        "of the image. In the frame, a slightly faded family photo taken at dusk on a slum rooftop with the city "
        "behind: Akemi Takahashi, a Japanese woman in her late thirties, kind tired eyes, short black hair tucked "
        "behind one ear, a utility engineer's work jacket with reflective tape and a blank patch, a hard hat under "
        "her arm, laughing, with her arm around her daughter: the girl from the reference images at about ten "
        "years old, the same black bob and gold hair clip, grinning with a missing front tooth. A folded paper "
        "charm is tucked into the corner of the frame. No text anywhere. Plain solid flat magenta background "
        "(#FF00FF) around the frame."),
    "chat-avatars": ("1024x1024", [STREET], "Four square profile-picture portraits for a stream chat, arranged 2 by "
        "2 with even gaps, each head and shoulders, facing the viewer, highly detailed 90s anime cyberpunk pixel "
        "art in the style of the reference image, each with its own flat solid colour background, all neighbours "
        "in the same poor rainy slum block on New Year's Eve: 1 top left: Kenji, a gap-toothed 9-year-old boy in "
        "a beanie with cat ears and a paper party hat on top, excited. 2 top right: Mrs Okafor, a Nigerian woman "
        "in her sixties with a patterned headwrap and reading glasses on a chain, phone held up to her face, "
        "unimpressed. 3 bottom left: a tired young father with stubble and a sleeping baby on his shoulder. 4 "
        "bottom right: an old Japanese man with a towel around his neck and a bowl of noodles, grumpy. No text, no "
        "names, no borders."),
}

TEE = ("Keep her shirt exactly as in the first reference image: the oversized faded white long-sleeve NIRVANA band T-shirt "
       "with the square blue underwater pool photo of a baby in a white swim diaper reaching for a dollar on a hook, the "
       "photo clearly visible on her chest in every panel. ")
AVATARS = ("Four square profile-picture portraits for a stream chat, arranged 2 by 2 with even gaps, each head and "
    "shoulders facing the viewer, drawn in exactly the same clean 90s anime cyberpunk pixel-art style as the reference "
    "images: big expressive anime eyes, crisp outlines, simple cel-like colour blocks with soft pixel shading, warm "
    "friendly faces, the same art style as the girl in the references (do not draw her). Not realistic, not gritty, no "
    "heavy rendering or wrinkles detail. Each portrait has its own flat bright solid colour background. All are her "
    "neighbours in a poor rainy slum block on New Year's Eve: 1 top left: Kenji, a gap-toothed 9-year-old boy in a "
    "beanie with cat ears and a paper party hat on top, excited. 2 top right: Mrs Okafor, a Nigerian woman in her "
    "sixties with a bright patterned headwrap and reading glasses on a chain, holding up an old phone, unimpressed. 3 "
    "bottom left: a tired young father in a hoodie with a sleeping baby on his shoulder. 4 bottom right: an old Japanese "
    "man with a towel around his neck holding a bowl of noodles, grumpy but kind. No text, no names, no borders.")
for v in "ab":
    JOBS["lux-faces-board-v2" + v] = ("1536x1024", LUX_REFS, SHEET + TEE + FACES + GOG_ON + JOBS["lux-faces-board"][2].split(GOG_ON, 1)[1])
    JOBS["chat-avatars-v2" + v] = ("1024x1024", [LUX, LUX_FACE], AVATARS)
# v2 avatars still came out inked and grimy (Rolando 21:29): copy the crew sprites' crisp pixel art instead.
for v in "ab":
    JOBS["chat-avatars-v3" + v] = ("1024x1024", ["crew-ozzie.png", "crew-mika-teen.png", LUX_FACE], AVATARS.replace(
        "Not realistic, not gritty, no heavy rendering or wrinkles detail.",
        "Match the reference sprites exactly: crisp clean pixel art with visible square pixels, smooth skin, few "
        "wrinkles, no ink hatching, no grime, no scratches, no painterly texture. Not realistic, not gritty."))
BATCHES = {"bg": [j for j in JOBS if j.startswith("bg-")],
           "lux": [j for j in JOBS if j.startswith("lux-")],
           "crew": [j for j in JOBS if j.split("-")[0] in ("rei", "mika", "ozzie")],
           "extras": ["akemi-photo", "chat-avatars"]}


def run(job, dry):
    size, refs, prompt = JOBS[job]
    out = DIR / f"{job}.png"
    if out.exists():
        return print(json.dumps({"job": job, "skipped": "exists"}))
    paths = [OUT / r for r in refs]
    missing = [p.name for p in paths if not p.exists()]
    if dry or missing:
        return print(json.dumps({"job": job, "size": size, "refs": refs, "missing": missing, "chars": len(prompt)}))
    t = time.time()
    try:
        r = call(key("neon-relay-openai"), size, prompt, transparent=False, refs=paths)
    except ApiError as e:
        line = {"job": job, "error": str(e)[:300]}
    else:
        out.write_bytes(base64.b64decode(r["data"][0]["b64_json"]))
        line = {"job": job, "file": f"brownout/{out.name}", "secs": round(time.time() - t), "usage": r.get("usage")}
    with open(DIR / "log.jsonl", "a") as f:
        f.write(json.dumps(line) + "\n")
    print(json.dumps(line), flush=True)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    jobs = [j for a in args for j in BATCHES.get(a, [a])]
    bad = [j for j in jobs if j not in JOBS]
    if not jobs or bad:
        sys.exit(f"usage: brownout_art.py {'|'.join(BATCHES)}|<job> ... [--dry-run]; unknown: {bad}")
    DIR.mkdir(parents=True, exist_ok=True)
    for j in jobs:
        run(j, "--dry-run" in sys.argv)
