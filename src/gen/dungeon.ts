// Dungeon and cave floors: rooms from a BSP split, joined by corridors.
import { T, TERRAIN } from '../game/terrain';
import { monstersFor, type Habitat } from '../game/monsters';
import { rollLoot } from './loot';
import type { Rng } from './rng';
import type { Chest, Level, MonsterSpawn, Trap, TrapKind } from './types';

interface Room { x: number; y: number; w: number; h: number }

export function generateDungeon(
  rng: Rng,
  opts: {
    id: string;
    name: string;
    siteId: number;
    floor: number;
    floors: number;
    depth: number;
    cave: boolean;
    bossFloor: boolean;
    /** A drowned temple: some rooms stand in shallow water, and the vault lies behind deep water. */
    sunken?: boolean;
  },
): Level {
  const w = 48, h = 32;
  const floorT = opts.cave ? T.CaveFloor : T.DFloor;
  const wallT = opts.cave ? T.CaveWall : T.DWall;
  const tiles = new Uint8Array(w * h).fill(wallT);
  const roomMask = new Uint8Array(w * h);
  const set = (x: number, y: number, t: T) => { tiles[y * w + x] = t; };
  const get = (x: number, y: number) => tiles[y * w + x] as T;

  // BSP split into leaves, one room per leaf.
  const rooms: Room[] = [];
  const split = (x: number, y: number, rw: number, rh: number, depth: number): Room[] => {
    const canH = rw >= 20, canV = rh >= 14;
    if (depth > 4 || (!canH && !canV) || (depth > 2 && rng.chance(0.2))) {
      const roomW = rng.int(4, Math.min(rw - 2, opts.bossFloor ? 12 : 10));
      const roomH = rng.int(3, Math.min(rh - 2, 7));
      const room = { x: x + rng.int(1, rw - roomW - 1), y: y + rng.int(1, rh - roomH - 1), w: roomW, h: roomH };
      rooms.push(room);
      for (let yy = room.y; yy < room.y + room.h; yy++) {
        for (let xx = room.x; xx < room.x + room.w; xx++) {
          set(xx, yy, floorT);
          roomMask[yy * w + xx] = 1;
        }
      }
      return [room];
    }
    const horizontal = canH && (!canV || rw > rh * 1.4 || (rw >= rh && rng.chance(0.5)));
    let a: Room[], b: Room[];
    if (horizontal) {
      const cut = rng.int(10, rw - 10);
      a = split(x, y, cut, rh, depth + 1);
      b = split(x + cut, y, rw - cut, rh, depth + 1);
    } else {
      const cut = rng.int(7, rh - 7);
      a = split(x, y, rw, cut, depth + 1);
      b = split(x, y + cut, rw, rh - cut, depth + 1);
    }
    corridor(rng.pick(a), rng.pick(b));
    return a.concat(b);
  };

  const corridor = (r1: Room, r2: Room) => {
    let x = r1.x + Math.floor(r1.w / 2), y = r1.y + Math.floor(r1.h / 2);
    const tx = r2.x + Math.floor(r2.w / 2), ty = r2.y + Math.floor(r2.h / 2);
    const horizFirst = rng.chance(0.5);
    const carve = () => { if (get(x, y) === wallT) set(x, y, floorT); };
    if (horizFirst) {
      while (x !== tx) { x += Math.sign(tx - x); carve(); }
      while (y !== ty) { y += Math.sign(ty - y); carve(); }
    } else {
      while (y !== ty) { y += Math.sign(ty - y); carve(); }
      while (x !== tx) { x += Math.sign(tx - x); carve(); }
    }
  };

  split(0, 0, w, h, 0);

  // Doors where a corridor meets a room (not in caves).
  if (!opts.cave) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (get(x, y) !== floorT || roomMask[y * w + x]) continue;
        const roomBeside = roomMask[y * w + x - 1] || roomMask[y * w + x + 1] || roomMask[(y - 1) * w + x] || roomMask[(y + 1) * w + x];
        if (!roomBeside) continue;
        const walledH = get(x, y - 1) === wallT && get(x, y + 1) === wallT;
        const walledV = get(x - 1, y) === wallT && get(x + 1, y) === wallT;
        if ((walledH || walledV) && rng.chance(0.4)) set(x, y, rng.chance(0.15) ? T.LockedDoor : T.DDoor);
      }
    }
  }

  // Solid rock that doesn't touch any open floor is left as plain darkness,
  // so only the walls around rooms and corridors are drawn.
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && get(x, y) !== wallT && get(x, y) !== T.Void;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (get(x, y) !== wallT) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1; dx++) if (open(x + dx, y + dy)) touches = true;
      if (!touches) set(x, y, T.Void);
    }
  }

  // Stairs: up in the first room, down (or the boss) in the room farthest from it.
  const first = rooms[0];
  const centre = (r: Room) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });
  const up = centre(first);
  set(up.x, up.y, T.StairsUp);
  const farthest = rooms.reduce((best, r) => {
    const c = centre(r), bc = centre(best);
    return Math.abs(c.x - up.x) + Math.abs(c.y - up.y) > Math.abs(bc.x - up.x) + Math.abs(bc.y - up.y) ? r : best;
  }, rooms[1] ?? first);
  const down = centre(farthest);
  const besideStairs = (p: { x: number; y: number }) => {
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]]) {
      if (get(p.x + dx, p.y + dy) === floorT) return { x: p.x + dx, y: p.y + dy };
    }
    return p;
  };
  let downArrival: { x: number; y: number } | undefined;
  if (opts.floor < opts.floors) {
    set(down.x, down.y, T.StairsDown);
    downArrival = besideStairs(down);
  }
  const entry = besideStairs(up);

  // Monsters.
  const habitat: Habitat = opts.cave ? 'cave' : 'dungeon';
  const kinds = monstersFor(habitat, opts.depth, true);
  const monsters: MonsterSpawn[] = [];
  const occupied = new Set<number>([up.y * w + up.x, down.y * w + down.x, entry.y * w + entry.x]);
  const freeSpot = (r: Room) => {
    for (let tries = 0; tries < 20; tries++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      if (get(x, y) === floorT && !occupied.has(y * w + x)) {
        occupied.add(y * w + x);
        return { x, y };
      }
    }
    return null;
  };
  for (const r of rooms) {
    if (r === first) continue;
    const count = rng.int(0, 1) + (rng.chance(opts.depth * 0.12) ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const p = freeSpot(r);
      if (p && kinds.length) monsters.push({ ...p, kind: rng.pick(kinds) });
    }
  }
  if (opts.bossFloor) {
    const p = freeSpot(farthest) ?? down;
    monsters.push({ ...p, kind: 'boss', boss: true });
    for (let i = 0; i < 2; i++) {
      const g = freeSpot(farthest);
      if (g) monsters.push({ ...g, kind: 'skeleton' });
    }
  }

  // A sealed vault: a dead-end room shut by a stone door (deep water in a drowned temple),
  // opened by a lever somewhere else on the floor.
  let vault: Room | undefined;
  if (!opts.cave) {
    const isOpen = (x: number, y: number) => get(x, y) !== wallT && get(x, y) !== T.Void;
    const gapsOf = (r: Room) => {
      const out: { x: number; y: number }[] = [];
      for (let x = r.x; x < r.x + r.w; x++) for (const y of [r.y - 1, r.y + r.h]) if (isOpen(x, y)) out.push({ x, y });
      for (let y = r.y; y < r.y + r.h; y++) for (const x of [r.x - 1, r.x + r.w]) if (isOpen(x, y)) out.push({ x, y });
      return out;
    };
    /** Everything the player can walk to from the way in, with the vault shut. */
    const reach = () => {
      const seen = new Uint8Array(w * h);
      const queue = [entry.y * w + entry.x];
      seen[queue[0]] = 1;
      while (queue.length) {
        const i = queue.pop()!;
        for (const n of [i - 1, i + 1, i - w, i + w]) {
          if (n < 0 || n >= w * h || seen[n]) continue;
          const t = tiles[n] as T;
          if (!TERRAIN[t].walk && t !== T.LockedDoor) continue;
          seen[n] = 1;
          queue.push(n);
        }
      }
      return seen;
    };
    search: for (const r of rng.shuffle([...rooms])) {
      if (r === first || r === farthest) continue;
      const gaps = gapsOf(r);
      if (gaps.length !== 1) continue;
      const gap = gaps[0];
      const was = get(gap.x, gap.y);
      for (const o of rng.shuffle(rooms.filter((x) => x !== r))) {
        const corners = rng.shuffle([
          { x: o.x, y: o.y }, { x: o.x + o.w - 1, y: o.y }, { x: o.x, y: o.y + o.h - 1 }, { x: o.x + o.w - 1, y: o.y + o.h - 1 },
        ]);
        for (const c of corners) {
          if (get(c.x, c.y) !== floorT || occupied.has(c.y * w + c.x)) continue;
          set(gap.x, gap.y, opts.sunken ? T.Water : T.Sealed);
          set(c.x, c.y, T.Lever);
          const seen = reach();
          const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(c.y + dy) * w + c.x + dx]);
          const others = rooms.every((x) => x === r || seen[centre(x).y * w + centre(x).x] || get(centre(x).x, centre(x).y) !== floorT);
          // The way to the vault's door must stay open too (the lever mustn't plug its corridor).
          const toDoor = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(gap.y + dy) * w + gap.x + dx]);
          if (beside && others && toDoor && seen[down.y * w + down.x]) {
            occupied.add(c.y * w + c.x);
            vault = r;
            break search;
          }
          set(gap.x, gap.y, was);
          set(c.x, c.y, floorT);
        }
      }
    }
  }

  // Chests.
  const chests: Chest[] = [];
  if (vault) {
    const p = freeSpot(vault);
    if (p) chests.push({ id: `${opts.id}:vault`, x: p.x, y: p.y, locked: false, dc: 0, loot: [...rollLoot(rng, opts.depth + 2), { gold: 20 * opts.depth }] });
  }
  const chestCount = rng.int(1, 3) + (opts.bossFloor ? 1 : 0);
  for (let i = 0; i < chestCount; i++) {
    const r = i === 0 && opts.bossFloor ? farthest : rng.pick(rooms.slice(1).length ? rooms.slice(1) : rooms);
    const p = freeSpot(r);
    if (!p) continue;
    const locked = rng.chance(0.4);
    chests.push({
      id: `${opts.id}:c${i}`,
      x: p.x,
      y: p.y,
      locked,
      dc: 10 + opts.depth * 2,
      loot: rollLoot(rng, opts.depth + (locked ? 1 : 0)),
    });
  }

  // Now and then a chest holds an iron key.
  for (const c of chests) if (rng.chance(0.3)) c.loot.push({ item: 'key' });

  // Traps, hidden on the floor of rooms and corridors.
  const trapKinds: TrapKind[] = opts.cave ? ['pit', 'rocks'] : ['dart', 'dart', 'pit', 'alarm'];
  const traps: Trap[] = [];
  const trapCount = opts.cave ? 1 : 1 + opts.floor;
  for (let i = 0, tries = 0; i < trapCount && tries < 100; tries++) {
    const x = rng.int(1, w - 2), y = rng.int(1, h - 2);
    if (get(x, y) !== floorT || occupied.has(y * w + x)) continue;
    if (Math.abs(x - up.x) + Math.abs(y - up.y) < 5) continue;
    occupied.add(y * w + x);
    traps.push({ x, y, dc: 10 + opts.depth, kind: rng.pick(trapKinds) });
    i++;
  }

  // A drowned temple: about half the rooms stand knee-deep in water.
  if (opts.sunken) {
    for (const r of rooms) {
      if (r === first || !rng.chance(0.5)) continue;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (get(x, y) === floorT) set(x, y, T.Shallows);
    }
  }

  return {
    id: opts.id,
    name: opts.name,
    kind: 'dungeon',
    w, h, tiles,
    dark: true,
    outside: T.Void,
    entry,
    downArrival,
    npcs: [],
    monsters,
    chests,
    traps,
    siteId: opts.siteId,
    floor: opts.floor,
    floors: opts.floors,
    depth: opts.depth,
  };
}
