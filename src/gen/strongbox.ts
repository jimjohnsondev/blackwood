// Strongboxes: locked chests in villagers' houses. Opening one is theft, and someone
// may be watching. They use their own seeded stream, so adding them never changes how
// a village is laid out.
import { T } from '../game/terrain';
import { Rng } from './rng';
import type { Chest, Level, Site } from './types';

export function placeStrongboxes(seed: string, site: Site, level: Level): Chest[] {
  const rng = new Rng(seed, 'strongbox', site.id);
  const { w, h, tiles } = level;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? T.Wall : (tiles[y * w + x] as T));
  const spots: { x: number; y: number }[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (at(x, y) !== T.WoodFloor) continue;
      // Against a wall, away from doors, and not where someone stands.
      const around = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)];
      if (around.includes(T.Door)) continue;
      if (!around.includes(T.Wall)) continue;
      if (level.npcs.some((n) => Math.abs(n.x - x) + Math.abs(n.y - y) < 2)) continue;
      spots.push({ x, y });
    }
  }
  const count = Math.min(spots.length, site.kind === 'hamlet' ? 2 : 3);
  const chosen: { x: number; y: number }[] = [];
  for (const spot of rng.shuffle(spots)) {
    if (chosen.length >= count) break;
    // One box per house, roughly: keep them apart.
    if (chosen.some((c) => Math.abs(c.x - spot.x) + Math.abs(c.y - spot.y) < 6)) continue;
    chosen.push(spot);
  }
  return chosen.map((spot, i) => ({
    id: `box:${site.id}:${i}`,
    x: spot.x,
    y: spot.y,
    locked: true,
    dc: site.kind === 'hamlet' ? 12 : 14,
    owned: true,
    loot: rng.chance(0.35)
      ? [{ gold: rng.int(5, 25) }, { item: rng.pick(['healing', 'torch', 'mana'] as const) }]
      : [{ gold: rng.int(8, 30) }],
  }));
}
