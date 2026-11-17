// The world tick: once a day, at dawn, the world moves on by itself.
//
// Monster lairs grow; strong ones send bands onto the roads and, at full strength, raid the
// nearest hamlet, which then has to recover. The seasons turn. Each of these leaves a world
// event that people talk about. Every roll comes from the seed, the day and the system, so
// the same world plays out the same way until the player steps in (by clearing a lair).
import { seasonOf, type Season } from '../game/calendar';
import { MONSTERS, monstersFor, type MonsterId } from '../game/monsters';
import { biomeAround } from '../gen/levels';
import { habitatFor } from '../gen/outdoor';
import { dangerAt } from '../gen/regions';
import { Rng } from '../gen/rng';
import type { Site, World } from '../gen/types';

export interface WorldEvent {
  day: number;
  kind: 'gather' | 'raid' | 'cleared' | 'season' | 'rebuilt' | 'blight';
  text: string;
  /** The place the news is about (rumours mark it on your map). */
  siteId?: number;
}

/** What the tick keeps between days. Small, and saved with the game. */
export interface WorldState {
  /** The last day the tick has run for. */
  lastTick: number;
  /** Lair strength, 0 to 10, by site id. */
  lairs: Record<number, number>;
  /** Hamlets raided, and the day it happened, by site id. */
  raids: Record<number, number>;
  /** Recent news, oldest first (the last 40). */
  events: WorldEvent[];
  /** Which lair raided each hamlet (by site id). */
  raidedBy?: Record<number, number>;
}

/** Days a raided hamlet stays empty, then days it takes to recover. */
export const RAIDED_DAYS = 5;
export const RECOVER_DAYS = 6;
/** A lair this strong sends bands onto nearby roads. */
export const LAIR_BANDS = 6;
/** How far a lair's bands and raids reach. */
export const LAIR_REACH = 45;

/** Caves, ruins and towers beyond the Vale are lairs. */
export function lairSites(world: World): Site[] {
  return world.sites.filter((s) => !s.vale && (s.kind === 'cave' || s.kind === 'ruin' || s.kind === 'tower'));
}

/** The kind of monster that dens in a lair, fixed by the seed. */
export function lairBeast(world: World, site: Site): MonsterId {
  const habitat = site.kind === 'cave' ? 'cave' : habitatFor(biomeAround(world, site));
  const kinds = monstersFor(habitat, Math.min(5, dangerAt(world, site.x, site.y)), true);
  return new Rng(world.seed, 'lair-beast', site.id).pick(kinds.length ? kinds : ['goblin']);
}

/** A fresh world on day 1: every lair starts somewhere between quiet and stirring. */
export function newWorldState(world: World): WorldState {
  const lairs: Record<number, number> = {};
  for (const s of lairSites(world)) lairs[s.id] = new Rng(world.seed, 'lair-start', s.id).int(0, 5);
  return { lastTick: 1, lairs, raids: {}, events: [] };
}

/** A raided hamlet's state on a day: raided (empty, shop shut), recovering, or fine. */
export function hamletStatus(state: WorldState, siteId: number, day: number): 'raided' | 'recovering' | null {
  const raided = state.raids[siteId];
  if (raided === undefined) return null;
  const since = day - raided;
  if (since < RAIDED_DAYS) return 'raided';
  if (since < RAIDED_DAYS + RECOVER_DAYS) return 'recovering';
  return null;
}

/** News from the last `days` days, newest first. */
export function recentEvents(state: WorldState, day: number, days = 12): WorldEvent[] {
  return state.events.filter((e) => day - e.day <= days).reverse();
}

/** Run one day of the world. */
export function tickDay(world: World, state: WorldState, day: number): void {
  const say = (e: Omit<WorldEvent, 'day'>) => {
    state.events.push({ day, ...e });
    if (state.events.length > 40) state.events.shift();
  };

  // 1. The seasons.
  const season = seasonOf(world.seed, day);
  if (season !== seasonOf(world.seed, day - 1)) say({ kind: 'season', text: SEASON_NEWS[season] });

  // 2. Hamlets that were raided rebuild.
  for (const [id, raided] of Object.entries(state.raids)) {
    if (day - raided === RAIDED_DAYS + RECOVER_DAYS) {
      const site = world.sites[Number(id)];
      say({ kind: 'rebuilt', text: `${site.name} HAS REBUILT AFTER THE RAID.`, siteId: site.id });
    }
  }

  // 3. Lairs grow, gather and raid.
  for (const lair of lairSites(world)) {
    const before = state.lairs[lair.id] ?? 0;
    const rng = new Rng(world.seed, 'tick', day, 'lair', lair.id);
    let now = before;
    if (rng.chance(0.4)) now = Math.min(10, now + 1);
    const beasts = MONSTERS[lairBeast(world, lair)].plural;
    if (before < LAIR_BANDS && now >= LAIR_BANDS) {
      say({ kind: 'gather', text: `${beasts} GATHER AT ${lair.name}. THE ROADS NEARBY ARE UNSAFE.`, siteId: lair.id });
    }
    if (now >= 10) {
      // At full strength they raid the nearest hamlet that isn't already in ruins.
      const target = world.sites
        .filter((s) => s.kind === 'hamlet' && hamletStatus(state, s.id, day) === null)
        .map((s) => ({ s, d: Math.hypot(s.x - lair.x, s.y - lair.y) }))
        .filter((t) => t.d <= LAIR_REACH)
        .sort((a, b) => a.d - b.d)[0]?.s;
      if (target) {
        state.raids[target.id] = day;
        (state.raidedBy ??= {})[target.id] = lair.id;
        say({ kind: 'raid', text: `${beasts} FROM ${lair.name} RAIDED ${target.name}!`, siteId: target.id });
        now = 4;
      }
    }
    state.lairs[lair.id] = now;
  }
}

/** Run every day the world hasn't caught up with yet, up to `day`. */
export function catchUp(world: World, state: WorldState, day: number): void {
  while (state.lastTick < day) {
    state.lastTick++;
    tickDay(world, state, state.lastTick);
  }
}

/** The player cleared a lair: it falls quiet, and the nearby hamlets are grateful. */
export function clearLair(world: World, state: WorldState, lair: Site, day: number): Site[] {
  state.lairs[lair.id] = 0;
  const beasts = MONSTERS[lairBeast(world, lair)].plural;
  state.events.push({ day, kind: 'cleared', text: `A STRANGER CLEARED THE ${beasts} OUT OF ${lair.name}.`, siteId: lair.id });
  if (state.events.length > 40) state.events.shift();
  return world.sites.filter((s) => (s.kind === 'hamlet' || s.kind === 'village') && Math.hypot(s.x - lair.x, s.y - lair.y) <= LAIR_REACH);
}

/** The strongest lair near a spot whose bands roam that far, if any. */
export function bandsNear(world: World, state: WorldState, x: number, y: number): Site | undefined {
  return lairSites(world)
    .filter((s) => (state.lairs[s.id] ?? 0) >= LAIR_BANDS && Math.hypot(s.x - x, s.y - y) <= 30)
    .sort((a, b) => (state.lairs[b.id] ?? 0) - (state.lairs[a.id] ?? 0))[0];
}

export type { Season };

const SEASON_NEWS: Record<Season, string> = {
  winter: 'WINTER HAS COME. SNOW LIES ON THE ROADS, AND PRICES CLIMB.',
  spring: 'THE THAW HAS COME. SPRING IS IN THE AIR.',
  summer: 'HIGH SUMMER. THE DAYS ARE LONG AND THE ROADS DRY.',
  autumn: 'AUTUMN. THE LEAVES TURN AND THE HARVEST COMES IN.',
};
