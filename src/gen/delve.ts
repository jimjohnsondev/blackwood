// Two more kinds of dungeon: towers you climb, and mines of long tunnels.
import { T } from '../game/terrain';
import { monstersFor, type MonsterId } from '../game/monsters';
import { TOME_IDS } from '../game/items';
import { rollLoot } from './loot';
import type { Rng } from './rng';
import type { Chest, Level, MonsterSpawn, Trap } from './types';

interface Opts { id: string; name: string; siteId: number; floor: number; floors: number; depth: number }
interface Spot { x: number; y: number }

/**
 * A tower: one round floor at a time, and the way on is up. Odd floors have a ring wall
 * around a middle room; even floors are cut into three chambers. The top floor's middle
 * room is a sealed vault, opened by a lever, holding a wizard's hoard.
 */
export function generateTower(rng: Rng, opts: Opts): Level {
  const w = 25, h = 25, c = 12, R = 10;
  const tiles = new Uint8Array(w * h).fill(T.Void);
  const set = (x: number, y: number, t: T) => { tiles[y * w + x] = t; };
  const get = (x: number, y: number) => tiles[y * w + x] as T;
  const dist = (x: number, y: number) => Math.hypot(x - c, y - c);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = dist(x, y);
    if (d <= R) set(x, y, T.DFloor);
    else if (d <= R + 1.5) set(x, y, T.DWall);
  }
  const top = opts.floor === opts.floors;
  const ring = top || opts.floor % 2 === 1;
  let leverAt: Spot | undefined;
  if (ring) {
    // A ring wall with two ways through (sealed on the top floor).
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.round(dist(x, y)) === 5) set(x, y, T.DWall);
    const gaps = rng.shuffle([{ x: c, y: c - 5 }, { x: c + 5, y: c }, { x: c, y: c + 5 }, { x: c - 5, y: c }]).slice(0, top ? 1 : 2);
    for (const g of gaps) set(g.x, g.y, top ? T.Sealed : rng.chance(0.2) ? T.LockedDoor : T.DDoor);
    if (top) {
      leverAt = rng.pick([{ x: c + 8, y: c }, { x: c - 8, y: c }]);
      set(leverAt.x, leverAt.y, T.Lever);
    }
  } else {
    // Two walls across, each with two doors: three chambers.
    for (const y of [c - 3, c + 3]) {
      const xs: number[] = [];
      for (let x = 0; x < w; x++) if (get(x, y) === T.DFloor) { set(x, y, T.DWall); xs.push(x); }
      const doors = rng.shuffle(xs.slice(2, -2)).slice(0, 2);
      doors.forEach((x, i) => set(x, y, i === 1 && rng.chance(0.25) ? T.LockedDoor : T.DDoor));
    }
  }
  // Stairs swap sides each floor, so you arrive where the last flight left you.
  const south = { x: c, y: c + R - 1 }, north = { x: c, y: c - R + 1 };
  const [outStair, upStair] = opts.floor % 2 === 1 ? [south, north] : [north, south];
  const inward = (s: Spot) => ({ x: s.x, y: s.y + Math.sign(c - s.y) });
  set(outStair.x, outStair.y, T.StairsDown);
  if (!top) set(upStair.x, upStair.y, T.StairsUp);

  const entry = inward(outStair);
  const taken = new Set<number>([entry.y * w + entry.x, inward(upStair).y * w + inward(upStair).x]);
  const free = (inner?: boolean): Spot | null => {
    for (let tries = 0; tries < 60; tries++) {
      const x = rng.int(c - R, c + R), y = rng.int(c - R, c + R);
      if (get(x, y) !== T.DFloor || taken.has(y * w + x)) continue;
      if (inner !== undefined && (dist(x, y) < 4.4) !== inner) continue;
      if (Math.abs(x - entry.x) + Math.abs(y - entry.y) < 4) continue;
      taken.add(y * w + x);
      return { x, y };
    }
    return null;
  };

  const depth = Math.min(5, opts.depth + (top ? 1 : 0));
  const kinds = monstersFor('dungeon', depth, true);
  const monsters: MonsterSpawn[] = [];
  for (let i = 0, n = rng.int(2, 3) + (top ? 1 : 0); i < n && kinds.length; i++) {
    const p = free(top && i === 0 ? true : undefined);
    if (p) monsters.push({ ...p, kind: rng.pick(kinds) });
  }
  const chests: Chest[] = [];
  if (top) {
    const p = free(true);
    if (p) chests.push({
      id: `${opts.id}:hoard`, x: p.x, y: p.y, locked: true, dc: 11 + opts.depth * 2,
      loot: [...rollLoot(rng, depth + 1), { item: rng.pick(TOME_IDS) }, { gold: 30 * opts.depth }],
    });
  } else if (rng.chance(0.6)) {
    const p = free(ring ? true : undefined);
    if (p) chests.push({ id: `${opts.id}:c0`, x: p.x, y: p.y, locked: rng.chance(0.4), dc: 10 + opts.depth * 2, loot: rollLoot(rng, depth) });
  }
  for (const ch of chests) if (!top && rng.chance(0.3)) ch.loot.push({ item: 'key' });
  const traps: Trap[] = [];
  for (let i = 0, n = rng.int(1, 2); i < n; i++) {
    const p = free(false);
    if (p) traps.push({ ...p, dc: 10 + opts.depth, kind: rng.pick(['dart', 'alarm'] as const) });
  }
  return {
    id: opts.id, name: opts.name, kind: 'dungeon', w, h, tiles, dark: true, outside: T.Void,
    entry, downArrival: top ? undefined : inward(upStair),
    npcs: [], monsters, chests, traps,
    siteId: opts.siteId, floor: opts.floor, floors: opts.floors, depth, climbs: true,
  };
}

/**
 * A mine: three long tunnels with cart tracks, joined by shafts, with chambers dug off
 * to either side. Goblins like them. Loose rock falls on the careless.
 */
export function generateMine(rng: Rng, opts: Opts): Level {
  const w = 48, h = 32;
  const tiles = new Uint8Array(w * h).fill(T.CaveWall);
  const set = (x: number, y: number, t: T) => { tiles[y * w + x] = t; };
  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? T.Void : (tiles[y * w + x] as T));
  const rows = [rng.int(5, 7), rng.int(15, 17), rng.int(25, 27)];
  for (const y of rows) for (let x = 3; x <= 44; x++) set(x, y, T.Track);
  // Shafts between the tunnels.
  for (let i = 0; i < rows.length - 1; i++) {
    for (const x of [rng.int(6, 20), rng.int(26, 42)]) {
      for (let y = rows[i] + 1; y < rows[i + 1]; y++) set(x, y, T.CaveFloor);
    }
  }
  // Chambers off the tunnels, above or below, each joined by a short cut.
  const chambers: { x: number; y: number; w: number; h: number }[] = [];
  for (let tries = 0; tries < 80 && chambers.length < 8; tries++) {
    const row = rng.pick(rows);
    const cw = rng.int(3, 6), ch = rng.int(3, 4);
    const x = rng.int(4, 43 - cw);
    const above = rng.chance(0.5);
    const y = above ? row - 1 - ch : row + 2;
    if (y < 1 || y + ch >= h - 1) continue;
    let clear = true;
    for (let yy = y - 1; yy <= y + ch && clear; yy++) for (let xx = x - 1; xx <= x + cw; xx++) if (get(xx, yy) !== T.CaveWall) { clear = false; break; }
    if (!clear) continue;
    for (let yy = y; yy < y + ch; yy++) for (let xx = x; xx < x + cw; xx++) set(xx, yy, T.CaveFloor);
    set(x + rng.int(0, cw - 1), above ? row - 1 : row + 1, T.CaveFloor);
    chambers.push({ x, y, w: cw, h: ch });
  }
  // Rock that touches nothing is plain darkness.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (get(x, y) !== T.CaveWall) continue;
    let touches = false;
    for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = get(x + dx, y + dy);
      if (t !== T.CaveWall && t !== T.Void) touches = true;
    }
    if (!touches) set(x, y, T.Void);
  }
  // In at the west end of the top tunnel; on down at the east end of the bottom one.
  set(3, rows[0], T.StairsUp);
  const entry = { x: 4, y: rows[0] };
  let downArrival: Spot | undefined;
  if (opts.floor < opts.floors) {
    set(44, rows[2], T.StairsDown);
    downArrival = { x: 43, y: rows[2] };
  }
  const taken = new Set<number>();
  const spotIn = (r: { x: number; y: number; w: number; h: number }): Spot | null => {
    for (let tries = 0; tries < 20; tries++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      if (taken.has(y * w + x)) continue;
      taken.add(y * w + x);
      return { x, y };
    }
    return null;
  };
  const base = monstersFor('cave', opts.depth, true);
  const kinds: MonsterId[] = base.includes('goblin') ? [...base, 'goblin', 'goblin'] : base;
  const monsters: MonsterSpawn[] = [];
  for (const r of chambers) {
    const n = rng.int(0, 1) + (rng.chance(opts.depth * 0.12) ? 1 : 0);
    for (let i = 0; i < n && kinds.length; i++) {
      const p = spotIn(r);
      if (p) monsters.push({ ...p, kind: rng.pick(kinds) });
    }
  }
  const chests: Chest[] = [];
  for (let i = 0, n = rng.int(1, 3); i < n && chambers.length; i++) {
    const p = spotIn(rng.pick(chambers));
    if (!p) continue;
    const locked = rng.chance(0.4);
    chests.push({ id: `${opts.id}:c${i}`, x: p.x, y: p.y, locked, dc: 10 + opts.depth * 2, loot: rollLoot(rng, opts.depth + (locked ? 1 : 0)) });
  }
  for (const c of chests) if (rng.chance(0.3)) c.loot.push({ item: 'key' });
  // Loose rock over the tracks.
  const traps: Trap[] = [];
  for (let i = 0, tries = 0; i < 2 + opts.floor && tries < 60; tries++) {
    const x = rng.int(9, 42), y = rng.pick(rows);
    if (traps.some((t) => t.x === x && t.y === y)) continue;
    traps.push({ x, y, dc: 10 + opts.depth, kind: rng.chance(0.7) ? 'rocks' : 'pit' });
    i++;
  }
  return {
    id: opts.id, name: opts.name, kind: 'dungeon', w, h, tiles, dark: true, outside: T.Void,
    entry, downArrival, npcs: [], monsters, chests, traps,
    siteId: opts.siteId, floor: opts.floor, floors: opts.floors, depth: opts.depth,
  };
}
