# Neon Relay — Product Requirements Document

**Status:** Concept PRD / prototype scope  
**Working title:** *Neon Relay* (not final)  
**Platform:** Browser, desktop-first  
**Genre:** Real-time incident-command strategy and system-design learning game

## 1. Product summary

*Neon Relay* is a retro-futurist cyberpunk strategy game in which the player keeps a neon megacity online by diagnosing and repairing live backend systems. Players place and connect infrastructure components on a tile-based architecture board while animated request packets flow through the system in real time.

The game teaches practical system-design reasoning through consequences rather than lectures: a cache reduces repeat load but may create stale data; a queue preserves work but adds delay; additional servers add capacity but do not solve a database bottleneck.

## 2. Player fantasy

The player is the unseen incident commander in a rain-soaked city operations room. They are responsible for keeping essential digital services alive while traffic spikes, outages, failed deployments, and sabotage threaten cascading failure.

The city is not the primary play surface. It is the emotional feedback layer: lights, transit, signs, and districts react to the health of the player’s architecture.

## 3. Product goals

- Make backend-system tradeoffs intuitive and memorable for software-engineering students.
- Feel like a tense, polished strategy game rather than a disguised lesson or static diagram tool.
- Teach players to observe symptoms, identify bottlenecks, choose constrained interventions, and verify that fixes work.
- Support short, replayable missions suitable for a browser experience.

## 4. Non-goals for the first prototype

- Full city simulation or open-world exploration.
- Large narrative cutscenes.
- A complete catalog of distributed-systems concepts.
- Multiplayer, user-created levels, or a complex economy.
- Simulating real cloud infrastructure with production-level fidelity.

## 5. Core game loop

1. **Briefing:** An operations partner flags an incoming incident and describes the observable risk in plain language.
2. **Observe:** The player watches packets, architecture-tile health, and a compact HUD for traffic, latency, errors, and city trust.
3. **Diagnose:** The player identifies the likely bottleneck or failure mode.
4. **Act:** With limited credits and grid space, the player selects, places, connects, upgrades, or reroutes components.
5. **Run and verify:** Time resumes; packets flow through the revised system. The player sees whether the system stabilizes or fails.
6. **Resolve and progress:** The city visibly recovers or suffers. Successful missions unlock one new infrastructure option for later scenarios.

## 6. Core gameplay rules

### Architecture board

- Central play surface: a square tile grid with explicit visual connections between components.
- Players drag components from a contextual bottom tray onto valid grid locations.
- Players connect components by dragging neon data lines between input and output ports.
- Small animated packets show the direction, volume, delay, and failure state of traffic.
- The board must remain readable before decorative UI is added.

### Constraints

The prototype uses two primary constraints:

- **Operations budget:** A mission gives a limited number of credits. Each component has a clear cost.
- **Grid/rack capacity:** The player has limited usable placement slots.

Optional later constraint:

- **Deployment time:** Larger changes take time to come online, forcing short-term stabilization before a long-term correction.

### Failure and success

- Individual components show local stress: cool/healthy, amber/near capacity, red/failing.
- System-level failure occurs when error rate or trust stays beyond a mission threshold for a sustained period.
- Winning means meeting the mission’s service goal; it does not require a single perfect architecture.

## 7. Prototype components

| Component | Player-facing behavior | System-design lesson |
| --- | --- | --- |
| Gateway | Receives all incoming traffic | A system has an ingress point and finite intake capacity |
| Load balancer | Splits traffic across multiple servers | Distribution helps only when downstream capacity exists |
| Application server | Processes requests | Horizontal scaling adds processing capacity |
| Cache | Serves repeated reads before they reach the database | Caching protects read-heavy workloads; later missions can introduce stale data |
| Queue | Buffers work during bursts | Durability and smoothing come with delay |
| Database | Stores the source of truth; becomes a common bottleneck | Central dependencies create systemic risk |
| Replica server | Adds redundancy/capacity | Reliability and scaling can introduce coordination tradeoffs |
| Monitoring antenna | Reveals clearer health signals | Observability reduces blind guessing |

## 8. HUD and observability

The HUD must answer: **What is hurting? Where is it happening? Is the fix working?**

Global signals:

- Traffic
- Latency
- Errors
- Trust

Local signals:

- Server capacity pulse or fill state.
- Database heat ring.
- Queue fill represented by stacked packets.
- Cache behavior represented by diverted repeat-request traffic.
- Clear warning colors and path highlights rather than dense numerical dashboards.

## 9. Presentation and interface

- Original retro-futurist anime sci-fi with a lived-in operations desk: warm amber warnings, teal CRT-style monitors, deep navy shadows, restrained magenta city light.
- The board is the dominant center panel.
- Top strip: traffic, latency, errors, trust, budget, pause/speed.
- Left panel: operations-partner portrait and short reactive dialogue.
- Right panel: city feed plus charts.
- Bottom tray: only mission-relevant components; advanced inventory stays collapsed.

During overload, the city feed shows flickering signage, dimming districts, and transport disruption. When recovery begins, packet jams thin, graphs settle, city lights return, and the partner’s expression changes. Use brief micro-scenes, not disruptive cutscenes.

## 10. Operations partner

A remote operations analyst provides context, humanizes the stakes, and gives hints without solving the mission.

- Early missions: direct observations.
- Later missions: symptom-based hints requiring player interpretation.
- Reactive portrait states: focused, worried, alarmed, relieved.
- Optional concise voice lines triggered by meaningful changes.

**Proposed default:** an earnest junior analyst learning alongside the player. Their name, identity, and broader story remain open.

## 11. Starter missions

### Mission 1 — The Surge

A public city service receives an unexpected rush of visitors.

- Teaches the difference between load balancing and added server capacity.
- Available components: gateway, load balancer, application servers, database.

### Mission 2 — Viral Signal

An underground broadcast makes one information page extremely popular.

- Introduces the cache.
- Teaches that caching repeated reads can be more effective than only adding servers.
- Core decision: cache versus additional server capacity.

### Mission 3 — The Lost Order

A high-value transaction service faces a burst that cannot lose requests.

- Introduces the queue.
- Teaches that buffering protects work but creates delay.
- Core decision: reliability versus latency.

## 12. First playable vertical slice

Build Mission 2 first.

Required:

- One board with gateway, load balancer, two app servers, cache, and database.
- Packets visibly increase during a viral event.
- Database overload causes packet backlog, error/latency deterioration, and city distress.
- The player can place and correctly connect a limited-budget cache.
- The cache visibly reduces database traffic and restores health.
- Partner portrait, a few reactive lines, one recovery micro-scene.
- Basic success, failure, and retry states.

Defer advanced connection rules, multiple maps, stale-cache simulation, queues, replicas, rate limiting, regional failover, full character story, and polished final voice acting.

## 13. Success criteria

After playing the vertical slice, a first-time player should understand:

1. The database was the bottleneck.
2. The cache worked because repeated requests no longer reached the database.
3. An extra server would not necessarily have fixed the core problem.
4. Their architecture decision caused the recovery.
