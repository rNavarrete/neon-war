#!/usr/bin/env python3
"""Neon War: the system-design component catalog. Every component in four upgrade tiers, one sheet per component.
Usage: components_art.py <batch or job> [...] [--dry-run]
  batches: core, data, flow, guard, ops, all
Reuses brownout_art.py's runner (one /images/edits call per sheet, about $0.20, out/brownout/<job>.png, never
overwritten, Keychain key neon-relay-openai). Same look as the Brownout board parts: painted, a faint cyan AR outline,
three-quarter view, on magenta for cutting out.

Tiers (left to right, each bigger and more powerful than the last):
  1 Scrap   home-made from junk, what Lux builds alone
  2 Street  custom-built by the Night Shift crew: clean, compact, coral-red accents
  3 Pro     refurbished data-centre hardware: industrial rack gear, heavy, many lights
  4 Solace  the megacorp's flagship: immaculate white and silver, cold cyan glow, huge"""
import sys
import brownout_art as b

STYLE = ("Highly detailed 90s anime cyberpunk illustration, rich painterly light, the same rendering style, palette "
         "and level of detail as the reference image (take only the style from it, never its composition). ")
ROW = ("Four versions of the same machine side by side in one row, evenly spaced with wide gaps, all seen from the "
       "same slightly-above three-quarter angle like game pieces on a board, each fully visible, growing in size and "
       "power from left to right. Each has a faint thin cyan holographic outline glow around its silhouette. ")
TIERS = ("1, smallest: home-made from salvaged junk, dented beige computer cases, duct tape, zip ties, mismatched "
         "screws, a few LEDs. 2: custom-built by a skilled teenage hacker crew, neat and compact, matte black with "
         "coral-red racing stripes and tidy cables. 3: refurbished data-centre hardware, a heavy industrial rack "
         "unit in gunmetal with rows of blinking lights and thick cable bundles. 4, largest: a corporate flagship "
         "machine, an immaculate white and silver monolith with smooth curves and a cold cyan glow, clearly the most "
         "powerful and expensive. ")
TAIL = (" No text, no letters, no numbers, no logos, no labels, no borders, no grid lines. Plain solid flat magenta "
        "background (#FF00FF) everywhere around the objects, no shadows on the ground.")
REFS = [b.STREET]

# name: (batch, what the machine is and the visual idea that tells it apart at a glance)
PARTS = {
    "server": ("core", "An application server that runs the block's apps: a tower or rack box with a fan and status lights."),
    "load-balancer": ("core", "A load balancer: a low wide box with a fan of many cable ports along the front, "
                      "cables splitting out to several outputs."),
    "gateway": ("core", "A network gateway, the front door for all traffic: a box with antennas and one big lit "
                "entry port, like a doorway."),
    "dns": ("core", "A DNS server, the city's address book: a box with a glowing directory dial or card-index "
            "drawer on the front."),
    "cache": ("data", "A cache, very fast memory for repeated answers: a compact unit packed with glowing violet "
              "memory sticks, the fastest-looking part, violet light."),
    "cdn": ("data", "A CDN edge node that keeps copies close to people: a rooftop relay with a dish and antennas "
            "on a small cabinet, signal rings radiating out."),
    "database": ("data", "A relational database: a stack of hard-drive cylinders or disk enclosures with a calm "
                 "blue status light."),
    "kv-store": ("data", "A key-value store: a cabinet of many small numbered drawers, like lockers, each with a "
                 "tiny light."),
    "object-storage": ("data", "Object storage for photos and files: a big bin or silo of stacked storage crates, "
                       "wide and deep, with a loading hatch."),
    "search-index": ("data", "A search index: a machine with a big round lens on top and rotating ring of index "
                     "cards or film strips inside."),
    "queue": ("flow", "A message queue that holds work in line: a long conveyor-belt machine with small glowing "
              "parcels lined up on it."),
    "event-stream": ("flow", "A pub/sub event stream: a tall pipe or tower that splits one stream of glowing "
                     "packets into several branching pipes."),
    "worker": ("flow", "A background worker that processes jobs: a squat machine with robotic arms or a small "
               "assembly line, busy."),
    "rate-limiter": ("guard", "A rate limiter: a turnstile or valve gate on a box that lets glowing packets "
                     "through one at a time."),
    "firewall": ("guard", "A firewall: an armoured blast door or shield panel on a heavy frame, orange warning "
                 "stripes."),
    "auth": ("guard", "An auth service that checks who you are: a box with a keycard slot, a scanner eye and a "
             "small keyhole light."),
    "monitoring": ("ops", "Monitoring: a cluster of small screens showing abstract graphs and gauges on a stand, "
                   "with a little antenna."),
    "logging": ("ops", "Logging: a machine printing an endless paper ribbon or tape that piles up beside it."),
    "autoscaler": ("ops", "An autoscaler: a control box with a big lever and dial, wired to spare server slots "
                   "that light up on demand."),
    "backup": ("ops", "A backup vault: a safe with a heavy round door and tape reels or drives visible inside."),
    "failover-switch": ("ops", "A failover switch: a big two-position industrial switch box that flips traffic "
                        "from a dead line to a standby line, two cables in."),
    "power-supply": ("ops", "Backup power: a UPS battery pack and small generator, with heavy cables and a "
                     "charge meter."),
}
NEW = {f"comp-{k}": ("1536x1024", REFS, STYLE + ROW + "The machine: " + desc + " The four tiers: " + TIERS + TAIL)
       for k, (_, desc) in PARTS.items()}
b.JOBS.update(NEW)

BATCHES = {}
for k, (batch, _) in PARTS.items():
    BATCHES.setdefault(batch, []).append(f"comp-{k}")
BATCHES["all"] = list(NEW)

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    jobs = [j for a in args for j in BATCHES.get(a, [a])]
    bad = [j for j in jobs if j not in NEW]
    if not jobs or bad:
        sys.exit(f"usage: components_art.py {'|'.join(BATCHES)}|<job> ... [--dry-run]; unknown: {bad}")
    b.DIR.mkdir(parents=True, exist_ok=True)
    for j in jobs:
        b.run(j, "--dry-run" in sys.argv)
