// Making sure every chest can be walked up to, and that no chest plugs a passage.
import { T, TERRAIN } from '../game/terrain';
import type { Level } from './types';

/** Tiles the player can get through sooner or later: floor, doors (locked or sealed too), drained water. */
function passable(t: T): boolean {
  return TERRAIN[t].walk || t === T.LockedDoor || t === T.Sealed || t === T.Water;
}

/** Every cell that can be walked to from the way in, with the given cells blocked. */
export function reachable(level: Level, blocked: Set<number>): Uint8Array {
  const { w, h, tiles } = level;
  const seen = new Uint8Array(w * h);
  const start = level.entry.y * w + level.entry.x;
  seen[start] = 1;
  const queue = [start];
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % w;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (n < 0 || n >= w * h || seen[n] || blocked.has(n) || !passable(tiles[n] as T)) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

const count = (a: Uint8Array) => a.reduce((n, v) => n + v, 0);

/**
 * Move any chest that can't be reached (walled in, or hemmed in by furniture) or that blocks
 * the only way somewhere, to the nearest open spot that can be reached and blocks nothing.
 */
export function fixChests(level: Level): void {
  const { w, h, tiles } = level;
  if (level.kind === 'overworld' || !level.chests.length) return;
  const at = (x: number, y: number): T => (x < 0 || y < 0 || x >= w || y >= h ? T.Void : (tiles[y * w + x] as T));
  const cell = (c: { x: number; y: number }) => c.y * w + c.x;
  const chestCells = () => new Set(level.chests.map(cell));
  const busy = new Set<number>([cell(level.entry), ...level.npcs.map(cell), ...level.monsters.map(cell), ...level.traps.map(cell)]);
  if (level.downArrival) busy.add(cell(level.downArrival));
  const special = (t: T) => t === T.Door || t === T.DDoor || t === T.LockedDoor || t === T.Sealed || t === T.Gate
    || t === T.StairsUp || t === T.StairsDown || t === T.Lever;

  for (const chest of level.chests) {
    const all = chestCells();
    const base = reachable(level, all);
    const others = new Set(all);
    others.delete(cell(chest));
    const without = reachable(level, others);
    const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => base[(chest.y + dy) * w + chest.x + dx]);
    const plugs = count(without) - 1 > count(base);
    if (beside && !plugs) continue;

    // Candidates: plain floor that can be reached, nearest the chest's old place first.
    const spots: { x: number; y: number; d: number; open: number }[] = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!without[i] || all.has(i) || busy.has(i)) continue;
      const t = at(x, y);
      if (!TERRAIN[t].walk || special(t) || t === T.Track || t === T.Cobble || t === T.Road) continue;
      let open = 0, nearSpecial = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = at(x + dx, y + dy);
        if (TERRAIN[n].walk) open++;
        if (special(n)) nearSpecial = true;
      }
      if (nearSpecial || Math.abs(x - level.entry.x) + Math.abs(y - level.entry.y) < 3) continue;
      spots.push({ x, y, d: Math.abs(x - chest.x) + Math.abs(y - chest.y), open });
    }
    spots.sort((a, b) => a.d - b.d);
    const want = count(without) - 1;
    search: for (const minOpen of [5, 3, 0]) {
      for (const s of spots) {
        if (s.open < minOpen) continue;
        const trial = new Set(others);
        trial.add(s.y * w + s.x);
        if (count(reachable(level, trial)) < want) continue; // it would plug something here too
        chest.x = s.x;
        chest.y = s.y;
        break search;
      }
    }
  }
}
