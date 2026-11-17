// Small open-air sites: the old chapel, shrines, ruins and towers.
// The player walks off any edge to leave.
import { T } from '../game/terrain';
import { monstersFor, type Habitat } from '../game/monsters';
import { personName } from './names';
import { rollLoot } from './loot';
import type { Rng } from './rng';
import type { Chest, Level, MonsterSpawn, NpcSpawn, SiteKind } from './types';

export function generateOutdoor(
  rng: Rng,
  opts: { id: string; name: string; siteId: number; kind: SiteKind; biome: T; depth: number },
): Level {
  const w = 28, h = 20;
  const ground = groundFor(opts.biome);
  const tiles = new Uint8Array(w * h).fill(ground);
  const set = (x: number, y: number, t: T) => { if (x >= 0 && y >= 0 && x < w && y < h) tiles[y * w + x] = t; };
  const get = (x: number, y: number) => tiles[y * w + x] as T;

  // Scatter the biome's plants.
  const plant = plantFor(opts.biome);
  if (plant !== null) {
    for (let i = 0; i < 40; i++) set(rng.int(0, w - 1), rng.int(0, h - 1), plant);
  }

  const npcs: NpcSpawn[] = [];
  const monsters: MonsterSpawn[] = [];
  const chests: Chest[] = [];
  const habitat = habitatFor(opts.biome);
  const kinds = monstersFor(habitat, opts.depth, true);
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2) - 1;

  const clear = (x0: number, y0: number, rw: number, rh: number) => {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) set(x, y, ground);
  };
  const addMonsters = (n: number, list = kinds) => {
    for (let i = 0, tries = 0; i < n && tries < 100 && list.length; tries++) {
      const x = rng.int(2, w - 3), y = rng.int(2, h - 6);
      if (!walkableGround(get(x, y))) continue;
      if (monsters.some((m) => m.x === x && m.y === y)) continue;
      monsters.push({ x, y, kind: rng.pick(list) });
      i++;
    }
  };
  const addChest = (x: number, y: number, locked: boolean) => {
    chests.push({ id: `${opts.id}:c${chests.length}`, x, y, locked, dc: 10 + opts.depth * 2, loot: rollLoot(rng, opts.depth + 1) });
  };

  switch (opts.kind) {
    case 'chapel': {
      // A roofless chapel: broken walls, an altar at the far end, graves outside.
      const bx = cx - 5, by = cy - 4, bw = 11, bh = 8;
      clear(bx - 3, by - 2, bw + 6, bh + 6);
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const edge = x === bx || y === by || x === bx + bw - 1 || y === by + bh - 1;
          set(x, y, edge ? (rng.chance(0.2) ? T.Rubble : T.Wall) : T.DFloor);
        }
      }
      set(cx, by + bh - 1, T.DFloor); // doorway
      set(cx, by + 1, T.Altar);
      for (let i = 0; i < 10; i++) {
        const x = rng.int(1, w - 2), y = rng.int(1, h - 2);
        if (get(x, y) === ground && (x < bx - 1 || x > bx + bw || y > by + bh)) set(x, y, T.Grave);
      }
      addMonsters(3, ['skeleton', 'rat']);
      break;
    }
    case 'shrine': {
      // A statue in a ring of stones with a hermit keeping watch.
      clear(cx - 4, cy - 3, 9, 7);
      for (let a = 0; a < 16; a++) {
        const x = Math.round(cx + Math.cos((a / 16) * Math.PI * 2) * 3);
        const y = Math.round(cy + Math.sin((a / 16) * Math.PI * 2) * 2.5);
        set(x, y, T.Cobble);
      }
      set(cx, cy, T.Statue);
      set(cx - 3, cy - 2, T.Torch);
      set(cx + 3, cy - 2, T.Torch);
      npcs.push({ x: cx + 1, y: cy + 2, role: 'hermit', name: personName(rng), wander: false });
      break;
    }
    case 'tower': {
      // A squat ruined tower with a chest inside and guards around it.
      const bx = cx - 3, by = cy - 3;
      clear(bx - 2, by - 2, 11, 11);
      for (let y = by; y < by + 7; y++) {
        for (let x = bx; x < bx + 7; x++) {
          const edge = x === bx || y === by || x === bx + 6 || y === by + 6;
          set(x, y, edge ? T.Wall : T.DFloor);
        }
      }
      set(cx, by + 6, T.DDoor);
      addChest(cx, by + 2, true);
      addMonsters(2 + rng.int(0, opts.depth));
      break;
    }
    default: {
      // Ruins: broken walls of two or three buildings, a chest or two, and whatever lives there now.
      const n = rng.int(2, 3);
      for (let b = 0; b < n; b++) {
        const bw = rng.int(5, 8), bh = rng.int(4, 6);
        const bx = rng.int(1, w - bw - 2), by = rng.int(1, h - bh - 6);
        for (let y = by; y < by + bh; y++) {
          for (let x = bx; x < bx + bw; x++) {
            const edge = x === bx || y === by || x === bx + bw - 1 || y === by + bh - 1;
            if (edge) set(x, y, rng.chance(0.55) ? T.Wall : rng.chance(0.5) ? T.Rubble : ground);
            else set(x, y, T.DFloor);
          }
        }
        if (b < 2) addChest(bx + 1 + rng.int(0, bw - 3), by + 1 + rng.int(0, bh - 3), rng.chance(0.5));
      }
      addMonsters(2 + rng.int(0, opts.depth));
      break;
    }
  }

  // Keep the arrival point and the bottom edge clear.
  const entry = { x: cx, y: h - 2 };
  clear(cx - 1, h - 3, 3, 3);

  return {
    id: opts.id,
    name: opts.name,
    kind: 'outdoor',
    w, h, tiles,
    dark: false,
    outside: ground,
    entry,
    npcs,
    monsters: monsters.filter((m) => Math.abs(m.x - entry.x) + Math.abs(m.y - entry.y) > 5),
    chests,
    traps: [],
    siteId: opts.siteId,
    floor: 1,
    floors: 1,
    depth: opts.depth,
  };
}

function groundFor(biome: T): T {
  switch (biome) {
    case T.Mire: return T.Mire;
    case T.DeadWood: return T.Dirt;
    case T.Scrub: return T.Scrub;
    default: return T.Grass;
  }
}

function plantFor(biome: T): T | null {
  switch (biome) {
    case T.Pine: return T.Pine;
    case T.DeadWood: return T.DeadWood;
    case T.Hills: return T.Hills;
    case T.Mire: return T.DeadWood;
    default: return null;
  }
}

function walkableGround(t: T): boolean {
  return t === T.Grass || t === T.Dirt || t === T.Mire || t === T.Scrub || t === T.Pine ||
    t === T.DeadWood || t === T.Hills || t === T.DFloor || t === T.Cobble;
}

export function habitatFor(tile: T): Habitat {
  switch (tile) {
    case T.Pine: return 'forest';
    case T.Hills: case T.Mountain: return 'hills';
    case T.Mire: return 'mire';
    case T.DeadWood: case T.RedPeak: return 'dead';
    default: return 'plains';
  }
}
