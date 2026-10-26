#!/usr/bin/env python3
"""Brownout slum-street background via PixelLab v1 pixflux. Key from Keychain (neon-relay-pixellab), never printed."""
import argparse, base64, json, sys, time
from bakeoff import OUT, ApiError, http, key

API = "https://api.pixellab.ai/v1"

PROMPT = "Street-level view down a cramped self-built slum alley in a rainy cyberpunk megacity at night, anime pixel art, highly detailed. Tenements of patched concrete, corrugated tin and plywood stacked eight floors high, rusted add-on balconies on stilts, external metal stairs, cages over windows, blue tarps and plastic sheeting, laundry on every railing. A dense web of sagging power cables and dripping pipes overhead with bare bulbs and flickering fluorescent tubes. Rust streaks, soot, mould, graffiti, trash bags, scrap piles, a burning oil drum, puddles on a wide flat broken-concrete road filling the lower third of the frame. A noodle pot on a gas ring under a tarp, a repair stall, a dead vending machine. Kids kicking a ball, neighbours on plastic stools, an old man, a dog. Warm amber bulb light and cooking-fire glow, desaturated rust and teal walls, deep navy shadows. At the far end, through the narrow gap, the clean white and cyan glass towers of the corporate district blaze. No shop signs, no lettering, no neon signs on the buildings."

NEGATIVE = "clean, tidy, shopping street, market, storefront, neon signs, lettering, text, logo, kanji, modern, wealthy, daylight, blurry, photo, 3d render, watermark"


def upscale3(src, dst):
    try:
        from PIL import Image
        im = Image.open(src); im.resize((im.width * 3, im.height * 3), Image.NEAREST).save(dst)
    except Exception as e:
        print("no 3x preview:", e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=4); ap.add_argument("--balance", action="store_true")
    ap.add_argument("--w", type=int, default=400); ap.add_argument("--h", type=int, default=224)
    a = ap.parse_args()
    h = {"Authorization": f"Bearer {key('neon-relay-pixellab')}", "Content-Type": "application/json"}

    def balance():
        try:
            print("PixelLab balance:", json.dumps(http("GET", f"{API}/balance", h)), flush=True)
        except ApiError as e:
            print("balance check failed:", e)

    balance()
    if a.balance:
        return
    for i in range(1, a.n + 1):
        seed = 2000 + i * 17
        payload = {"description": PROMPT, "negative_description": NEGATIVE,
                   "image_size": {"width": a.w, "height": a.h}, "text_guidance_scale": 8,
                   "no_background": False, "seed": seed}
        t0 = time.time()
        try:
            res = http("POST", f"{API}/generate-image-pixflux", h, json.dumps(payload).encode())
        except ApiError as e:
            sys.exit(f"image {i} failed: {e}")
        img = res["image"]["base64"] if isinstance(res.get("image"), dict) else res["image"]
        dst = OUT / f"slum2-street-{i}.png"; dst.write_bytes(base64.b64decode(img.split(",")[-1]))
        upscale3(dst, OUT / f"slum2-street-{i}-x3.png")
        print(f"wrote {dst} (seed {seed}, {time.time() - t0:.0f}s)", flush=True)
    balance()


if __name__ == "__main__":
    main()
