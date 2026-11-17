// Villages and hamlets: a walled square with a gate, a main street, a cross street,
// and buildings with a keeper inside each one.
import { T } from '../game/terrain';
import { personName } from './names';
import type { Rng } from './rng';
import type { Level, NpcRole, NpcSpawn } from './types';

interface Rect { x: number; y: number; w: number; h: number }

export function generateVillage(
  rng: Rng,
  opts: { id: string; name: string; siteId: number; hamlet: boolean },
): Level {
  const w = opts.hamlet ? 32 : 40;
  const h = opts.hamlet ? 24 : 30;
  const tiles = new Uint8Array(w * h).fill(T.Dirt);
  const set = (x: number, y: number, t: T) => { tiles[y * w + x] = t; };
  const get = (x: number, y: number) => tiles[y * w + x] as T;

  // Outer wall and gate.
  for (let x = 0; x < w; x++) { set(x, 0, T.Wall); set(x, h - 1, T.Wall); }
  for (let y = 0; y < h; y++) { set(0, y, T.Wall); set(w - 1, y, T.Wall); }
  const mid = Math.floor(w / 2);
  const midY = Math.floor(h / 2) + rng.int(-2, 1);
  set(mid, h - 1, T.Gate);

  // Streets.
  for (let y = 1; y < h - 1; y++) set(mid, y, T.Cobble);
  for (let x = 1; x < w - 1; x++) set(x, midY, T.Cobble);

  // Buildings, one or two per quarter.
  const roles: NpcRole[] = opts.hamlet
    ? ['innkeeper', 'shopkeeper', 'villager', 'villager']
    : ['elder', 'innkeeper', 'shopkeeper', 'priest', 'villager', 'villager', 'villager', 'villager'];
  const quarters: Rect[] = rng.shuffle([
    { x: 1, y: 1, w: mid - 1, h: midY - 1 },
    { x: mid + 1, y: 1, w: w - mid - 2, h: midY - 1 },
    { x: 1, y: midY + 1, w: mid - 1, h: h - midY - 2 },
    { x: mid + 1, y: midY + 1, w: w - mid - 2, h: h - midY - 2 },
  ]);
  const buildings: Rect[] = [];
  const npcs: NpcSpawn[] = [];
  let roleIndex = 0;

  for (let pass = 0; pass < 2; pass++) {
    for (const q of quarters) {
      if (roleIndex >= roles.length) break;
      const b = fitBuilding(rng, q, buildings);
      if (!b) continue;
      buildings.push(b);
      const role = roles[roleIndex++];
      const npc = buildHouse(rng, b, role, { set, get, w, h, mid, midY });
      npcs.push(npc);
    }
  }

  // Well near the crossroads.
  const wellX = mid + (rng.chance(0.5) ? 2 : -2);
  const wellY = midY + (rng.chance(0.5) ? 2 : -2);
  if (get(wellX, wellY) === T.Dirt) set(wellX, wellY, T.Well);

  // Graveyard in the village (beside the temple, if there's room).
  if (!opts.hamlet) {
    for (let tries = 0; tries < 80; tries++) {
      const gx = rng.int(2, w - 9), gy = rng.int(2, h - 7);
      if (!areaIs(get, gx - 1, gy - 1, 8, 6, T.Dirt)) continue;
      for (let yy = 0; yy < 4; yy += 2) for (let xx = 0; xx < 6; xx += 2) set(gx + xx, gy + yy, T.Grave);
      break;
    }
  }

  // Bare trees on open ground, away from streets and doors.
  const treeCount = opts.hamlet ? 6 : 10;
  for (let i = 0, tries = 0; i < treeCount && tries < 200; tries++) {
    const x = rng.int(2, w - 3), y = rng.int(2, h - 3);
    if (areaIs(get, x - 1, y - 1, 3, 3, T.Dirt)) { set(x, y, T.BareTree); i++; }
  }

  // People strolling outside.
  const walkers = opts.hamlet ? 2 : 4;
  for (let i = 0, tries = 0; i < walkers && tries < 200; tries++) {
    const x = rng.int(2, w - 3), y = rng.int(2, h - 3);
    const t = get(x, y);
    if ((t === T.Dirt || t === T.Cobble) && !npcs.some((n) => n.x === x && n.y === y)) {
      npcs.push({ x, y, role: i === 0 && !opts.hamlet ? 'beggar' : 'villager', name: personName(rng), wander: true });
      i++;
    }
  }

  return {
    id: opts.id,
    name: opts.name,
    kind: 'town',
    w, h, tiles,
    dark: false,
    outside: T.Grass,
    entry: { x: mid, y: h - 2 },
    npcs,
    monsters: [],
    chests: [],
    traps: [],
    siteId: opts.siteId,
    floor: 1,
    floors: 1,
    depth: 1,
  };
}

function fitBuilding(rng: Rng, q: Rect, taken: Rect[]): Rect | null {
  for (let tries = 0; tries < 30; tries++) {
    const bw = rng.int(7, Math.min(11, q.w - 2));
    const bh = rng.int(5, Math.min(7, q.h - 2));
    if (bw < 7 || bh < 5) return null;
    const x = rng.int(q.x + 1, q.x + q.w - bw - 1);
    const y = rng.int(q.y + 1, q.y + q.h - bh - 1);
    const b = { x, y, w: bw, h: bh };
    if (x < q.x + 1 || y < q.y + 1) continue;
    if (taken.some((t) => overlaps(t, b, 2))) continue;
    return b;
  }
  return null;
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.x - gap < b.x + b.w && b.x - gap < a.x + a.w && a.y - gap < b.y + b.h && b.y - gap < a.y + a.h;
}

function areaIs(get: (x: number, y: number) => T, x: number, y: number, w: number, h: number, t: T): boolean {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (get(xx, yy) !== t) return false;
  return true;
}

interface Ctx {
  set: (x: number, y: number, t: T) => void;
  get: (x: number, y: number) => T;
  w: number;
  h: number;
  mid: number;
  midY: number;
}

/** Walls, floor, a door facing the nearest street, furniture, and the keeper. */
function buildHouse(rng: Rng, b: Rect, role: NpcRole, c: Ctx): NpcSpawn {
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const edge = x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1;
      c.set(x, y, edge ? T.Wall : T.WoodFloor);
    }
  }

  // Door on the side closest to a street, then a path to that street.
  const cx = b.x + Math.floor(b.w / 2), cy = b.y + Math.floor(b.h / 2);
  const toMain = Math.abs(cx - c.mid), toCross = Math.abs(cy - c.midY);
  let door: { x: number; y: number }, step: { x: number; y: number };
  if (toCross < toMain) {
    door = cy < c.midY ? { x: cx, y: b.y + b.h - 1 } : { x: cx, y: b.y };
    step = { x: 0, y: cy < c.midY ? 1 : -1 };
  } else {
    door = cx < c.mid ? { x: b.x + b.w - 1, y: cy } : { x: b.x, y: cy };
    step = { x: cx < c.mid ? 1 : -1, y: 0 };
  }
  c.set(door.x, door.y, T.Door);
  let px = door.x + step.x, py = door.y + step.y;
  while (px > 0 && py > 0 && px < c.w - 1 && py < c.h - 1 && c.get(px, py) !== T.Cobble) {
    if (c.get(px, py) === T.Dirt) c.set(px, py, T.Cobble);
    else break;
    px += step.x;
    py += step.y;
  }
  // Torches either side of the door, outside.
  for (const side of [-1, 1]) {
    const tx = door.x + step.x + (step.y !== 0 ? side * 2 : 0);
    const ty = door.y + step.y + (step.x !== 0 ? side * 2 : 0);
    if (c.get(tx, ty) === T.Dirt && rng.chance(0.6)) c.set(tx, ty, T.Torch);
  }

  // Furniture along the back wall (the side away from the door).
  const inner = { x: b.x + 1, y: b.y + 1, w: b.w - 2, h: b.h - 2 };
  const back = (i: number) =>
    step.y === 1 ? { x: inner.x + i, y: inner.y }
      : step.y === -1 ? { x: inner.x + i, y: inner.y + inner.h - 1 }
      : step.x === 1 ? { x: inner.x, y: inner.y + i }
      : { x: inner.x + inner.w - 1, y: inner.y + i };
  const backLen = step.y !== 0 ? inner.w : inner.h;
  const furniture: T =
    role === 'innkeeper' ? T.Bed
      : role === 'shopkeeper' ? T.Counter
      : role === 'priest' ? T.Altar
      : T.Bed;
  for (let i = 0; i < backLen; i += role === 'shopkeeper' ? 1 : 2) {
    if (role === 'priest' && i !== Math.floor(backLen / 2)) continue;
    const p = back(i);
    c.set(p.x, p.y, furniture);
  }
  if (role === 'innkeeper' || role === 'elder' || role === 'villager') {
    const tx = inner.x + 1 + rng.int(0, Math.max(0, inner.w - 3));
    const ty = inner.y + 1 + rng.int(0, Math.max(0, inner.h - 3));
    if (c.get(tx, ty) === T.WoodFloor && !(Math.abs(tx - door.x) + Math.abs(ty - door.y) < 2)) c.set(tx, ty, T.Table);
  }

  // The keeper stands one step in from the door's opposite side, in the middle.
  let kx = cx, ky = cy;
  if (c.get(kx, ky) !== T.WoodFloor) {
    for (let y = inner.y; y < inner.y + inner.h; y++) {
      for (let x = inner.x; x < inner.x + inner.w; x++) {
        if (c.get(x, y) === T.WoodFloor) { kx = x; ky = y; }
      }
    }
  }
  return { x: kx, y: ky, role, name: personName(rng), wander: role === 'villager' };
}
