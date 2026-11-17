// The Blight: the villain's grey land, and how it spreads.
//
// Nothing moves while the player stays in the Vale. The clock starts the first day they
// step out of it. Twenty days later the Blight takes its first region, and another every
// fifteen days after, in a fixed order (the lieutenants' lands first). It never enters the
// Vale. Killing a lieutenant frees their land for good. Once the villain is dead the Blight
// draws back, one region every five days, its own heartland last.
import type { World } from '../gen/types';

export interface BlightState {
  /** The day the player first left the Vale. */
  leftVale?: number;
  /** Which lieutenants are dead (same order as the quest's list). */
  ltDead: boolean[];
  /** The day the villain fell. */
  wonDay?: number;
  /** Regions the player has already been told about, so news comes once. */
  told: number[];
}

export const BLIGHT_START = 20;
export const BLIGHT_STEP = 15;
export const RECEDE_STEP = 5;

export function newBlight(): BlightState {
  return { ltDead: [false, false], told: [] };
}

/** The regions under the Blight on a given day, the heartland first. */
export function blightedRegions(world: World, st: BlightState, day: number): number[] {
  const heart = world.regions.find((r) => r.type === 'blight');
  if (!heart) return [];
  const q = world.quest;
  const freed = new Set(q.lieutenants.filter((_, i) => st.ltDead[i]).map((l) => l.region));
  // How far it had spread by `at`.
  const spreadBy = (at: number) => {
    if (st.leftVale === undefined) return 0;
    const steps = Math.floor((at - st.leftVale - BLIGHT_START) / BLIGHT_STEP) + 1;
    return Math.max(0, Math.min(q.blightOrder.length, steps));
  };
  const until = st.wonDay ?? day;
  const taken = [heart.id, ...q.blightOrder.slice(0, spreadBy(until)).filter((r) => !freed.has(r))];
  if (st.wonDay === undefined) return taken;
  // Drawing back: the last taken goes first, the heartland last of all.
  const gone = Math.floor((day - st.wonDay) / RECEDE_STEP);
  return taken.slice(0, Math.max(0, taken.length - gone));
}
