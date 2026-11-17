// Daily routines: where each person in a village or hamlet is at each time of day.
//
// The day has four watches. People work in the morning, run errands in the afternoon,
// gather at the inn (or the temple) in the evening and sleep at home at night. Everything
// is worked out from the village's layout and the seed, so the same person always keeps
// the same habits. Nothing here changes the game state: game.ts moves people towards the
// spot this file gives them.
import { Rng } from '../gen/rng';
import type { Level, NpcRole } from '../gen/types';
import { T, TERRAIN } from './terrain';

export type Watch = 'morning' | 'afternoon' | 'evening' | 'night';
export const WATCHES: Watch[] = ['morning', 'afternoon', 'evening', 'night'];

/** Which watch a time of day (minutes since midnight) falls in. */
export function watchAt(minuteOfDay: number): Watch {
  const h = Math.floor(minuteOfDay / 60) % 24;
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

export const WATCH_NAMES: Record<Watch, string> = {
  morning: 'MORNING', afternoon: 'AFTERNOON', evening: 'EVENING', night: 'NIGHT',
};

export interface Spot { x: number; y: number }

export interface Routine {
  /** Where they head in each watch. */
  spots: Record<Watch, Spot>;
  /** Watches in which they stroll around their spot rather than stand at it. */
  strolls: Watch[];
  /** Asleep once they reach their night spot (innkeepers and guards stay up). */
  sleeps: boolean;
  /** Keepers whose business is open in this watch (TRADE, HEAL...). */
  working: Watch[];
}

interface Person { name: string; role: NpcRole; x: number; y: number }

/** A building: its floor, the beds in it, and who it belongs to. */
interface Building { owner: Person; floor: Spot[]; all: Spot[]; bedSides: Spot[]; door?: Spot }

/**
 * Plan everyone's day. `people` are the level's people in order (as placed by the
 * generator, guards last); the result lines up with it.
 */
export function planRoutines(seed: string, siteId: number, level: Level, people: Person[]): Routine[] {
  const rng = new Rng(seed, 'routine', siteId);
  const { w, h, tiles } = level;
  const at = (x: number, y: number): T => (x < 0 || y < 0 || x >= w || y >= h ? T.Wall : (tiles[y * w + x] as T));
  const key = (s: Spot) => `${s.x},${s.y}`;
  // Who stands where in each watch. People keep a clear tile all around them, so there's
  // always room to walk past and to talk to the one you mean.
  const taken: Record<Watch, Spot[]> = { morning: [], afternoon: [], evening: [], night: [] };
  const crowds = (s: Spot, watch: Watch, gap: number) =>
    taken[watch].some((t) => Math.max(Math.abs(t.x - s.x), Math.abs(t.y - s.y)) <= gap);
  /**
   * The first spot in the list with space around it (and that passes `ok`). If there's none,
   * `squeeze` allows standing next to someone (beds); otherwise it's the fallback.
   */
  const claim = (list: Spot[], fallback: Spot, watch: Watch, ok: (s: Spot) => boolean = () => true, squeeze = false): Spot => {
    for (const gap of squeeze ? [1, 0] : [1]) {
      for (const s of list) {
        if (crowds(s, watch, gap) || !ok(s)) continue;
        taken[watch].push(s);
        return s;
      }
    }
    if (!crowds(fallback, watch, 0)) taken[watch].push(fallback);
    return fallback;
  };

  // Buildings: the floor around each person who starts indoors.
  const buildings: Building[] = [];
  for (const p of people) {
    if (at(p.x, p.y) !== T.WoodFloor) continue;
    const floor = flood(p, (x, y) => at(x, y) === T.WoodFloor);
    const floorKeys = new Set(floor.map(key));
    const bedSides = floor.filter((s) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(s.x + dx, s.y + dy) === T.Bed));
    let door: Spot | undefined;
    for (const s of floor) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (at(s.x + dx, s.y + dy) === T.Door) door = { x: s.x + dx, y: s.y + dy };
    }
    // Seats away from the door and the keeper's own spot.
    const roomy = floor.filter((s) => !(door && Math.abs(s.x - door.x) + Math.abs(s.y - door.y) <= 2) && !(s.x === p.x && s.y === p.y));
    buildings.push({ owner: p, floor: rng.shuffle(roomy).filter((s) => floorKeys.has(key(s))), all: floor, bedSides: rng.shuffle(bedSides), door });
  }
  const buildingOf = (role: NpcRole) => buildings.find((b) => b.owner.role === role);
  const inn = buildingOf('innkeeper');
  const temple = buildingOf('priest');
  const homeOf = (p: Person) => buildings.find((b) => b.owner === p);

  // Open ground for working and errands: dirt and cobbles, not hard against a wall.
  const outdoors: Spot[] = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const t = at(x, y);
    if ((t === T.Dirt || t === T.Cobble) && TERRAIN[t].walk) outdoors.push({ x, y });
  }
  const gate = (() => {
    for (let x = 0; x < w; x++) if (at(x, h - 1) === T.Gate) return { x, y: h - 2 };
    return { x: Math.floor(w / 2), y: h - 2 };
  })();
  const crossroads = (() => {
    let best = outdoors[0] ?? gate, bestN = -1;
    for (const s of outdoors) {
      if (at(s.x, s.y) !== T.Cobble) continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => at(s.x + dx, s.y + dy) === T.Cobble).length;
      if (n > bestN) { best = s; bestN = n; }
    }
    return best;
  })();
  // Open ground to stand on: off the road, away from doorways, with room on every side.
  const open = rng.shuffle(outdoors.filter((s) => {
    if (at(s.x, s.y) === T.Cobble) return false;
    let free = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const t = at(s.x + dx, s.y + dy);
      if (t === T.Door || t === T.Gate) return false;
      if (TERRAIN[t].walk) free++;
    }
    return free >= 6;
  }));
  const far = (a: Spot, b: Spot) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  /** Open ground, nearest to `c` first. */
  const openNear = (c: Spot) => [...open].sort((a, b) => far(a, c) - far(b, c));

  /** A seat indoors must leave every other part of the room reachable from the door. */
  const keepsRoomOpen = (b: Building, watch: Watch) => (seat: Spot): boolean => {
    if (!b.door) return true;
    const blocked = new Set([key(seat), ...taken[watch].map(key)]);
    const inside = new Set(b.all.map(key));
    const start = b.all.filter((s) => far(s, b.door!) === 1 && !blocked.has(key(s)));
    if (!start.length) return false;
    const seen = new Set(start.map(key));
    const queue = [...start];
    while (queue.length) {
      const s = queue.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { x: s.x + dx, y: s.y + dy };
        if (!inside.has(key(n)) || blocked.has(key(n)) || seen.has(key(n))) continue;
        seen.add(key(n));
        queue.push(n);
      }
    }
    return b.all.every((s) => blocked.has(key(s)) || seen.has(key(s)));
  };

  // Keepers keep their own spot, all day.
  for (const p of people) {
    if (p.role !== 'villager' || at(p.x, p.y) === T.WoodFloor) for (const w of WATCHES) taken[w].push({ x: p.x, y: p.y });
  }

  return people.map((p): Routine => {
    const own: Spot = { x: p.x, y: p.y };
    const evenings = () => (temple && rng.chance(0.25) ? temple : inn);
    // A seat for the evening: if the room is full, they stay where they are.
    const seat = (b?: Building) => (b ? claim(b.floor, own, 'evening', keepsRoomOpen(b, 'evening')) : own);
    const bedIn = (b: Building | undefined, fallback: Spot) => (b ? claim(b.bedSides, fallback, 'night', () => true, true) : fallback);
    const all = (s: Spot) => ({ morning: s, afternoon: s, evening: s, night: s });

    switch (p.role) {
      case 'innkeeper':
      case 'hermit':
        return { spots: all(own), strolls: [], sleeps: false, working: [...WATCHES] };
      case 'shopkeeper':
        return {
          spots: { morning: own, afternoon: own, evening: seat(inn), night: own },
          strolls: [], sleeps: true, working: ['morning', 'afternoon'],
        };
      case 'priest':
        return { spots: { ...all(own) }, strolls: [], sleeps: true, working: ['morning', 'afternoon', 'evening'] };
      case 'elder': {
        const home = homeOf(p);
        return {
          spots: { morning: own, afternoon: own, evening: rng.chance(0.5) ? seat(inn) : own, night: bedIn(home, own) },
          strolls: [], sleeps: true, working: ['morning', 'afternoon', 'evening'],
        };
      }
      case 'beggar':
        return { spots: all(own), strolls: ['morning', 'afternoon'], sleeps: true, working: [] };
      case 'guard': {
        // By day beside the gate, in the evening by the crossroads, at night on patrol:
        // always on open ground next to the road, never on it.
        const post = claim(openNear(gate), own, 'morning');
        claim([post], post, 'afternoon');
        const watchSpot = claim(openNear(crossroads), post, 'evening');
        const patrol = claim(openNear(crossroads), post, 'night');
        return {
          spots: { morning: post, afternoon: post, evening: watchSpot, night: patrol },
          strolls: ['night'], sleeps: false, working: [...WATCHES],
        };
      }
      default: {
        // Villagers: work outside, run an errand, an evening out, home to bed.
        const home = homeOf(p);
        const work = home ? claim(open, own, 'morning') : claim(openNear(own), own, 'morning');
        const errand = claim(rng.shuffle(openNear(crossroads).slice(0, 30)), work, 'afternoon');
        const evening = seat(evenings());
        const bed = home ? bedIn(home, own) : bedIn(inn, evening);
        return {
          spots: { morning: work, afternoon: errand, evening, night: bed },
          strolls: ['morning', 'afternoon'], sleeps: true, working: [],
        };
      }
    }
  });

  /** Every spot reachable from `from` through tiles that pass the test. */
  function flood(from: Spot, ok: (x: number, y: number) => boolean): Spot[] {
    const seen = new Set<string>([key(from)]);
    const out: Spot[] = [];
    const queue: Spot[] = [from];
    while (queue.length) {
      const s = queue.shift()!;
      out.push(s);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { x: s.x + dx, y: s.y + dy };
        if (seen.has(key(n)) || !ok(n.x, n.y)) continue;
        seen.add(key(n));
        queue.push(n);
      }
    }
    return out;
  }
}

/**
 * The next step from `from` towards `to` through walkable tiles, avoiding anything
 * `blocked` says no to. Undefined if there's no way (or already there).
 */
export function stepTowards(
  level: Level, from: Spot, to: Spot, blocked: (x: number, y: number) => boolean,
): Spot | undefined {
  if (from.x === to.x && from.y === to.y) return undefined;
  const { w, h, tiles } = level;
  const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && TERRAIN[tiles[y * w + x] as T].walk && tiles[y * w + x] !== T.Gate;
  const prev = new Int32Array(w * h).fill(-1);
  const start = from.y * w + from.x, goal = to.y * w + to.x;
  prev[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === goal) break;
    const cx = cur % w, cy = (cur - cx) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, n = ny * w + nx;
      if (!walk(nx, ny) || prev[n] !== -1) continue;
      // Others in the way only matter right next to us; further on they'll have moved.
      if (n !== goal && Math.abs(nx - from.x) + Math.abs(ny - from.y) === 1 && blocked(nx, ny)) continue;
      prev[n] = cur;
      queue.push(n);
    }
  }
  if (prev[goal] === -1) return undefined;
  let step = goal;
  while (prev[step] !== start) step = prev[step];
  return { x: step % w, y: Math.floor(step / w) };
}
