# Neon War: Mission 2, Viral Signal

## Pitch

Pixel-art cyberpunk incident-command game in the browser. You keep a neon city online by fixing a live
backend. A pirate broadcast makes one page go viral; the database drowns; you decide between a cache and
another server. Full spec: docs/PRD.md. Visual target: docs/board-mockup.jpg.

## Layout (from the mockup)

- Top left: 5-step progress (Briefing, Observe, Diagnose, Act, Verify), partner portrait below it with
  reactive dialogue.
- Centre: the board, skyline behind it.
- Right: three charts (traffic, latency, database load) and a city view.
- Bottom: tray with App Server and Cache, plus locked slots (Queue, Replica, Monitoring, Rate limiter,
  Failover).
- HUD strip: traffic, latency, errors, trust, credits, pause and speed.

## Simulation (pure TypeScript in src/sim/, no Phaser imports)

These numbers are a starting point; Rolando owns them.

- Board: gateway, load balancer, 2 app servers (150 req/s each), database (90 req/s). 3 open rack slots.
  Budget 400 credits.
- Cache costs 300, App Server 250: the player can afford one, not both.
- Traffic: ~40 req/s calm, ramps to ~240 req/s from t=10s to t=20s. ~80% of viral traffic is reads of the
  same page.
- Cache warms over ~4s, then answers ~80% of requests; misses go to the DB.
- DB backlog is drawn as stacked packets; overflow becomes errors.
- Trust drains with errors. Lose at 0 trust. Win by holding errors under 2% for 12s at peak traffic.

## Proof of concept (first milestone)

The smallest playable version of the moment the game is about:

- The board with gateway, load balancer, two servers and the database already wired; packets flow.
- Traffic ramps and the database overheats.
- One empty slot and a Cache in the tray. Drag it in and wire it; database load drops.
- A database-load bar, win or lose, and Retry.
- The partner portrait with a few lines.
- Placeholder shapes for everything without art. No charts, city view or briefing yet.

## The slice is done when

- No changes: the DB overloads and the mission is lost.
- Third app server, wired correctly: the DB still overloads; lost.
- Cache wired from only one server: still overloaded; lost.
- Cache wired from both servers into the DB: mission won.
- The player can place, wire, cut and decommission components by mouse.
- Partner shows focused, worried, alarmed and relieved states with lines.
- Win plays a short recovery scene, then a debrief covering the PRD's four success criteria. Retry works from
  win and loss.
- 60 fps in Chrome on a recent Mac.

## Screenshot review (what Rolando checks at merge)

- Can you tell the DB is the bottleneck within 20s?
- Does it look like the mockup?
- Do packets, warnings and the recovery scene read clearly?
