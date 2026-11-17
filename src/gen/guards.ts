// Guards: one or two per settlement, added to a village or hamlet after it is built.
// They use their own seeded stream, so adding them never changes the village itself.
import { T, TERRAIN } from '../game/terrain';
import { personName } from './names';
import { Rng } from './rng';
import type { Level, NpcSpawn, Site } from './types';

export function placeGuards(seed: string, site: Site, level: Level): NpcSpawn[] {
  const rng = new Rng(seed, 'guards', site.id);
  const { w, h, tiles } = level;
  const gateX = [...Array(w).keys()].find((x) => tiles[(h - 1) * w + x] === T.Gate) ?? Math.floor(w / 2);
  const count = site.kind === 'village' ? 2 : 1;
  const out: NpcSpawn[] = [];
  for (const dx of [-1, 1, -2, 2]) {
    if (out.length >= count) break;
    const x = gateX + dx, y = h - 2;
    const t = tiles[y * w + x] as T;
    if (!TERRAIN[t].walk || level.npcs.some((n) => n.x === x && n.y === y)) continue;
    out.push({ x, y, role: 'guard', name: personName(rng), wander: false });
  }
  return out;
}
