# Blackwood

A 1980s-style 8-bit RPG for the browser, phone first. Vite + TypeScript, no framework, no
runtime dependencies. The README has the full design notes, milestone by milestone.

## Commands

```sh
npm install
npm run dev            # http://localhost:5173 (add ?debug for `blackwood` in the console)
npm test               # vitest run
npm run build          # tsc --noEmit, then a static site in dist/
npm run build:single   # one self-contained dist-single/index.html (no service worker)
npx vite-node scripts/balance.ts   # fight odds per class
npx vite-node scripts/curve.ts     # difficulty curve; aim for 20-40% HP lost per fight
npx vite-node scripts/worldmap.ts  # world stats and a map image
```

`npm run build` type-checks first, so a type error fails the build (and the Pages deploy).
`noUnusedLocals` and `noUnusedParameters` are on.

## Layout

- `src/main.ts` boot and frame loop; registers `public/sw.js` outside single-file mode.
- `src/gen/` seeded generation (world, regions, villages, dungeons, quests). `src/game/` rules,
  player, items, monsters, dialogue, and `game.ts`, which holds every player action.
- `src/sim/` the daily world tick (lairs, caravans, the Blight). `src/screens/`, `src/gfx/`,
  `src/input/`, `src/ui/`, `src/audio/` are presentation.
- `tests/` covers determinism, reachability and a scripted quest run.

## Rules to keep

- **Determinism.** Everything in the world comes from the seed: use `new Rng(seed, 'site', id)`
  (its own stream per system), never `Math.random()`. The world tick must give the same result
  however the player gets to a given day. Tests check this.
- **Saves** store only the seed plus what the player changed, in `localStorage`
  (`blackwood-full-save-v1`, three slots). Changing what the world generates breaks old saves;
  bump the save version when that happens.
- **Paths stay relative** (`base: './'` in `vite.config.ts`, `./` in `index.html`, the manifest
  and `sw.js`). The site is served from a subpath on GitHub Pages, so a leading `/` breaks it.
- **Service worker cache.** Bump `CACHE` in `public/sw.js` when its list of files changes.
- Art is drawn as text grids in `src/gfx/`; the screen is 256x192.

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`: install, test, build, then publish `dist/`
to GitHub Pages at https://jimjohnsondev.github.io/blackwood/. The repo's Pages source must be
set to "GitHub Actions".
