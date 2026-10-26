# Neon War

A pixel-art cyberpunk incident-command game in the browser. You keep a neon city online by fixing a live
backend: when a pirate broadcast makes one page go viral and the database drowns, you decide between a cache
and another server.

- What the game is and what the current slice must do: [docs/GAME.md](docs/GAME.md)
- Full product spec: [docs/PRD.md](docs/PRD.md)
- Visual target: [docs/board-mockup.jpg](docs/board-mockup.jpg)
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

Phaser 4 (`pixelArt: true`), Vite, TypeScript (strict), Vitest for the rules in `src/sim/`, Playwright for
the game in a real browser. Art in `public/art/` is generated with gpt-image-2 and snapped onto a true pixel
grid with PixelZ's pixelize step, then picked by hand.
