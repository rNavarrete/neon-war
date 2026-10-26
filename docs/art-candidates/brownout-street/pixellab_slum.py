#!/usr/bin/env python3
"""Brownout slum-street background via PixelLab v1 pixflux. Key from Keychain (neon-relay-pixellab), never printed."""
import argparse, base64, json, sys, time
from bakeoff import OUT, ApiError, http, key

API = "https://api.pixellab.ai/v1"

PROMPT = (
    "Street-level view down a narrow rain-soaked slum alley in a cyberpunk megacity at night, "
    "anime pixel art, highly detailed. Cramped stacked tenement flats of corrugated metal, "
    "patched concrete and plywood, rusted add-on balconies, tarps, laundry lines, tangled power cables "
    "with paper lanterns, satellite dishes and air-con units dripping with rain. Street level: cramped "
    "shop fronts with hand-painted signs, a steaming noodle cart with red lanterns, vending machines, "
    "crates, barrels, trash bags, puddles reflecting neon. Kids playing with a ball in the street, "
    "neighbours sitting in doorways, an old man on a chair, a dog. Warm amber and red light from the "
    "windows and lanterns, teal and magenta neon signs, deep navy shadows. Far at the end of the alley, "
    "through the gap, the bright white and cyan glass towers of a corporate district blaze on the "
    "horizon. Wide composition, flat open road in the lower middle of the frame. No text, no logos."
)
NEGATIVE = "clean, modern, wealthy, daylight, blurry, photo, 3d render, text, watermark, logo"


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
        seed = 1000 + i * 17
        payload = {"description": PROMPT, "negative_description": NEGATIVE,
                   "image_size": {"width": a.w, "height": a.h}, "text_guidance_scale": 8,
                   "no_background": False, "seed": seed}
        t0 = time.time()
        try:
            res = http("POST", f"{API}/generate-image-pixflux", h, json.dumps(payload).encode())
        except ApiError as e:
            sys.exit(f"image {i} failed: {e}")
        img = res["image"]["base64"] if isinstance(res.get("image"), dict) else res["image"]
        dst = OUT / f"slum-street-{i}.png"; dst.write_bytes(base64.b64decode(img.split(",")[-1]))
        upscale3(dst, OUT / f"slum-street-{i}-x3.png")
        print(f"wrote {dst} (seed {seed}, {time.time() - t0:.0f}s)", flush=True)
    balance()


if __name__ == "__main__":
    main()
