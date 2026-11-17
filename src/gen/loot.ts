// What's inside a chest, scaled by difficulty (1-5).
import { TOME_IDS, withTier, type ItemId } from '../game/items';
import type { Rng } from './rng';
import type { Loot } from './types';

const COMMON: ItemId[] = ['healing', 'healing', 'torch', 'torch', 'mana'];
const RARE: ItemId[] = ['scroll', 'shortsword', 'leather', 'shield', 'shortbow', 'lockpicks'];
const PRECIOUS: ItemId[] = ['sword', 'axe', 'chain', 'scroll'];

export function rollLoot(rng: Rng, depth: number): Loot[] {
  const loot: Loot[] = [{ gold: rng.int(5, 15) * depth }];
  loot.push({ item: rng.pick(COMMON), count: rng.chance(0.3) ? 2 : 1 });
  if (rng.chance(0.25 + depth * 0.08)) loot.push({ item: withTier(rng.pick(RARE), gearTier(rng, depth)) });
  if (depth >= 3 && rng.chance(0.15 * depth)) loot.push({ item: withTier(rng.pick(PRECIOUS), gearTier(rng, depth)) });
  // Tomes turn up from the second floor down.
  if (depth >= 2 && rng.chance(0.08 + depth * 0.03)) loot.push({ item: rng.pick(TOME_IDS) });
  return loot;
}

/** Deeper chests hold better grades: FINE from depth 2, MASTERWORK from 3, RUNED from 4. */
function gearTier(rng: Rng, depth: number): number {
  let tier = 0;
  if (depth >= 2 && rng.chance(0.5)) tier++;
  if (depth >= 3 && rng.chance(0.4)) tier++;
  if (depth >= 4 && rng.chance(0.3)) tier++;
  return tier;
}
