# Neon War

A painted cyberpunk system-design game in the browser, played in sessions. In Session 0, Brownout, Lux
Takahashi, 15, keeps her slum block's net alive on New Year's Eve against the midnight countdown, and learns
that demand decides the design.

- What the game is and what the current session must do: [docs/GAME.md](docs/GAME.md)
- Full product spec (GAME.md wins where they differ): [docs/PRD.md](docs/PRD.md)
- Visual target: the picked art and the Brownout session spec linked from docs/GAME.md
- Rules for anyone (or any agent) changing the code: [CLAUDE.md](CLAUDE.md)

## Develop

Node 22 (see `.nvmrc`).

```sh
npm ci
npm run dev            # play at http://localhost:5173 (add ?test to expose the test hook)
npm run check          # every check CI runs: format, lint, typecheck, unit tests, build, browser tests
```

Browser tests need Chromium: `npx playwright install chromium` once on a new machine.

## Stack

Phaser 4 (`pixelArt: false`), Vite, TypeScript (strict), Vitest for the rules in `src/sim/`, Playwright for
the game in a real browser. Desktop only, built at 1920x1080 and scaled. Art in `public/art/` is painted,
generated with gpt-image-2, and picked by hand; it is not pixel art.
