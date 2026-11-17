// Builds the map for any site (and floor) on demand, always the same for the same seed.
import { T } from '../game/terrain';
import { generateDungeon } from './dungeon';
import { generateMine, generateTower } from './delve';
import { generateOutdoor } from './outdoor';
import { fixChests } from './reach';
import { Rng } from './rng';
import { generateVillage } from './village';
import { dangerAt, LANDMARKS, type RegionType } from './regions';
import type { ItemId } from '../game/items';
import type { Level, Site, World } from './types';

export function overworldLevel(world: World): Level {
  return {
    id: 'overworld',
    name: 'THE WILDS',
    kind: 'overworld',
    w: world.size,
    h: world.size,
    tiles: world.tiles,
    dark: false,
    outside: T.Ocean,
    entry: { x: 0, y: 0 },
    npcs: [],
    monsters: [],
    chests: [],
    traps: [],
    siteId: -1,
    floor: 0,
    floors: 0,
    depth: 1,
  };
}

/** How many floors a site has. */
export function floorsOf(world: World, site: Site): number {
  const danger = dangerAt(world, site.x, site.y);
  if (site.kind === 'barrow') return 3;
  if (site.kind === 'stronghold') return 5;
  if (site.kind === 'tower' && !site.vale) return Math.min(5, 3 + Math.floor(danger / 3));
  if (site.style === 'mine') return danger >= 4 ? 3 : 2;
  if (site.style === 'sunken') return 2;
  if (site.kind === 'cave') return danger >= 3 ? 2 : 1;
  return 1;
}

/** Which monster kinds a site holds: 1 (gentle) near the Vale up to 5, from its danger. */
export function depthOf(world: World, site: Site): number {
  return Math.min(5, dangerAt(world, site.x, site.y));
}

export function buildLevel(world: World, site: Site, floor = 1): Level {
  const level = makeLevel(world, site, floor);
  fixChests(level);
  return level;
}

function makeLevel(world: World, site: Site, floor: number): Level {
  const rng = new Rng(world.seed, 'site', site.id, floor);
  const id = `site:${site.id}:${floor}`;
  const depth = depthOf(world, site);
  const biome = biomeAround(world, site);

  switch (site.kind) {
    case 'village':
    case 'hamlet':
      return generateVillage(rng, { id, name: site.name, siteId: site.id, hamlet: site.kind === 'hamlet' });
    case 'barrow':
      return generateDungeon(rng, {
        id,
        name: `${site.name} ${floor}`,
        siteId: site.id,
        floor,
        floors: 3,
        depth: Math.max(1, floor),
        cave: false,
        bossFloor: floor === 3,
      });
    case 'stronghold':
      // The villain's keep: five floors, as hard as dungeons get, with the villain at the bottom.
      return generateDungeon(rng, {
        id, name: `${site.name} ${floor}`, siteId: site.id, floor, floors: 5, depth: 5, cave: false, bossFloor: floor === 5,
      });
    case 'cave': {
      const floors = floorsOf(world, site);
      // Deeper floors are a little harder.
      const base = { id, name: site.name, siteId: site.id, floor, floors, depth: Math.min(5, depth + floor - 1) };
      if (site.style === 'mine') return generateMine(rng, base);
      if (site.style === 'sunken') return generateDungeon(rng, { ...base, cave: false, bossFloor: false, sunken: true });
      return generateDungeon(rng, { ...base, cave: true, bossFloor: false });
    }
    case 'tower':
      // Towers in the Vale stay the small ruins they were; beyond it they still stand.
      if (site.vale) break;
      return generateTower(rng, { id, name: site.name, siteId: site.id, floor, floors: floorsOf(world, site), depth });
    case 'landmark':
      return landmarkLevel(world, site, rng, id, biome);
  }
  switch (site.kind) {
    default:
      return generateOutdoor(rng, { id, name: site.name, siteId: site.id, kind: site.kind, biome, depth: site.vale ? 1 : depth });
  }
}

/**
 * A landmark: an old ruin, well guarded, with the region's treasure in a locked chest at
 * the far end from where you come in.
 */
function landmarkLevel(world: World, site: Site, rng: Rng, id: string, biome: T): Level {
  const depth = Math.min(5, dangerAt(world, site.x, site.y) + 1);
  const level = generateOutdoor(rng, { id, name: site.name, siteId: site.id, kind: 'ruin', biome, depth });
  const type = world.regions[site.region]?.type as Exclude<RegionType, 'vale'> | undefined;
  const unique = (LANDMARKS[type ?? 'downs']?.unique ?? 'wardenbow') as ItemId;
  // The far end: the walkable spot furthest from the entrance, clear of other chests.
  let best = { x: level.entry.x, y: level.entry.y }, bestD = -1;
  for (let y = 1; y < level.h - 1; y++) {
    for (let x = 1; x < level.w - 1; x++) {
      const t = level.tiles[y * level.w + x] as T;
      if (t === T.Wall || t === T.Rubble || level.chests.some((c) => c.x === x && c.y === y)) continue;
      if (!(t === T.DFloor || t === T.Grass || t === T.Dirt || t === T.Scrub || t === T.Cobble)) continue;
      const d = Math.abs(x - level.entry.x) + Math.abs(y - level.entry.y);
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
  }
  level.chests.push({
    id: `unique:${site.id}`, x: best.x, y: best.y, locked: true, dc: 12 + depth,
    loot: [{ item: unique }, { gold: 50 * depth }],
  });
  // Guardians around the treasure.
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = best.x + dx, y = best.y + dy;
    if (level.monsters.some((m) => m.x === x && m.y === y)) continue;
    const t = level.tiles[y * level.w + x] as T;
    if (t === T.DFloor || t === T.Grass || t === T.Dirt || t === T.Scrub) level.monsters.push({ x, y, kind: rng.pick(level.monsters.map((m) => m.kind).concat(['skeleton'])) });
  }
  return level;
}

/** The terrain next to a site, which sets the look of its map. */
export function biomeAround(world: World, site: Site): T {
  const counts = new Map<T, number>();
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = site.x + dx, y = site.y + dy;
      if (x < 0 || y < 0 || x >= world.size || y >= world.size) continue;
      const t = world.tiles[y * world.size + x] as T;
      if (t === T.Site || t === T.Road || t === T.Ocean || t === T.Mountain || t === T.RedPeak) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  let best = T.Grass, bestN = 0;
  counts.forEach((n, t) => { if (n > bestN) { best = t; bestN = n; } });
  return best;
}
