// Caravans: traders travelling the roads between the starting village and the region towns.
//
// Where a caravan is depends only on the world and the time: it walks its road one tile
// every half hour, rests half a day at each end, and turns back. So nothing about it needs
// saving, and it is always in the same place at the same time.
import { T } from '../game/terrain';
import { personName } from '../gen/names';
import { findPath } from '../gen/path';
import { Rng } from '../gen/rng';
import type { World } from '../gen/types';

export interface Caravan {
  id: number;
  /** The trader who leads it. */
  name: string;
  /** Road tiles from one town to the other. */
  route: { x: number; y: number }[];
  /** The two towns at its ends (site ids). */
  from: number;
  to: number;
  /** Minutes into its round trip at time 0, so caravans don't move in step. */
  offset: number;
}

const STEP_MINUTES = 30;
const REST_MINUTES = 12 * 60;
const COUNT = 3;

const cache = new WeakMap<World, Caravan[]>();

/** The world's caravans and their roads (worked out once per world). */
export function caravans(world: World): Caravan[] {
  const known = cache.get(world);
  if (known) return known;
  const S = world.size;
  const rng = new Rng(world.seed, 'caravans');
  const home = world.sites[world.quest.villageId];
  const towns = rng.shuffle(world.sites.filter((s) => s.kind === 'village' && s.id !== home.id));
  const list: Caravan[] = [];
  for (const town of towns) {
    if (list.length >= COUNT) break;
    // Along roads only (and through the towns and hamlets on the way).
    const cost = (x: number, y: number) => {
      const t = world.tiles[y * S + x] as T;
      return t === T.Road || t === T.Site ? 1 : Infinity;
    };
    const route = findPath(S, S, home, town, cost, 1);
    if (!route || route.length < 10) continue;
    list.push({ id: list.length, name: personName(rng), route, from: home.id, to: town.id, offset: rng.int(0, 5000) });
  }
  cache.set(world, list);
  return list;
}

/**
 * Where a caravan is at a time (minutes since the start), or null while it rests in a town.
 */
export function caravanAt(c: Caravan, time: number): { x: number; y: number } | null {
  const walk = (c.route.length - 1) * STEP_MINUTES;
  const loop = 2 * (walk + REST_MINUTES);
  let t = (time + c.offset) % loop;
  if (t < REST_MINUTES) return null; // resting at home
  t -= REST_MINUTES;
  if (t < walk) return c.route[Math.floor(t / STEP_MINUTES)];
  t -= walk;
  if (t < REST_MINUTES) return null; // resting at the far town
  t -= REST_MINUTES;
  return c.route[c.route.length - 1 - Math.floor(t / STEP_MINUTES)];
}
