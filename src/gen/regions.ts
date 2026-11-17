// Regions: the continent is split into the Vale in the middle and five lands around it,
// each with its own look, name and dangers. Danger rises in rings outward from the Vale.
import type { World } from './types';

export type RegionType = 'vale' | 'fenlands' | 'highlands' | 'ashwood' | 'downs' | 'blight';

export interface Region {
  id: number;
  type: RegionType;
  name: string;
  /** Roughly the middle of the region. */
  x: number;
  y: number;
}

/** How each region pulls the terrain: wetter, rockier, deader... */
export const REGION_BIAS: Record<RegionType, { moist: number; ridge: number; blight: number }> = {
  vale: { moist: 0, ridge: 0, blight: 0 },
  fenlands: { moist: 0.13, ridge: -0.06, blight: 0.06 },
  highlands: { moist: 0.04, ridge: 0.09, blight: 0 },
  ashwood: { moist: 0.02, ridge: 0, blight: 0.22 },
  downs: { moist: -0.09, ridge: -0.03, blight: 0.02 },
  blight: { moist: 0, ridge: 0.04, blight: 0.4 },
};

export const REGION_WORDS: Record<RegionType, (base: string) => string> = {
  vale: () => 'THE VALE',
  fenlands: (b) => `THE ${b} FENS`,
  highlands: (b) => `THE ${b} HEIGHTS`,
  ashwood: (b) => `${b} ASHWOOD`,
  downs: (b) => `THE ${b} DOWNS`,
  blight: () => 'THE BLIGHT',
};

/** The landmark each kind of region hides, and the treasure kept there. */
export const LANDMARKS: Record<Exclude<RegionType, 'vale'>, { name: string; unique: string; lore: string }> = {
  fenlands: { name: 'SUNKEN SPIRE', unique: 'mireshroud', lore: 'A DROWNED TOWER LEANS OUT OF THE BOG.' },
  highlands: { name: "GIANT'S GRAVE", unique: 'gravebreaker', lore: 'BONES THE SIZE OF TREES LIE UNDER THE CAIRN.' },
  ashwood: { name: 'FALLEN STAR', unique: 'starfall', lore: 'A BLACK STONE STILL SMOKES IN ITS CRATER.' },
  downs: { name: 'STONE CIRCLE', unique: 'wardenbow', lore: 'THE OLD STONES HUM AS YOU PASS BETWEEN THEM.' },
  blight: { name: 'LOST CITY', unique: 'lostshield', lore: 'STREETS OF ASH, EMPTY FOR A THOUSAND YEARS.' },
};

/** The radius of the Vale, where it is always safe-ish. */
export const VALE_RADIUS = 40;

/** Which region a tile belongs to. */
export function regionAt(world: World, x: number, y: number): Region {
  const S = world.size;
  if (x < 0 || y < 0 || x >= S || y >= S) return world.regions[0];
  return world.regions[world.regionOf[y * S + x]] ?? world.regions[0];
}

/**
 * Danger at a spot, 1 (the Vale) to 8: one step for every 30 tiles beyond the Vale,
 * and one more in the Blight. Picks the monsters, their strength and the loot.
 */
export function dangerAt(world: World, x: number, y: number): number {
  const d = Math.hypot(x - world.size / 2, y - world.size / 2);
  let n = 1 + Math.floor(Math.max(0, d - 15) / 30);
  if (regionAt(world, x, y).type === 'blight') n++;
  return Math.max(1, Math.min(8, n));
}

export const DANGER_WORDS = ['', 'SAFE', 'QUIET', 'WARY', 'PERILOUS', 'DANGEROUS', 'DEADLY', 'DEADLY', 'CURSED'];

/** Past danger 3 monsters come in stronger forms: GRIM, DIRE, ELDER, DREAD. */
export function monsterTier(danger: number): number {
  // GRIM from danger 4, then a step stronger with each step of danger, up to DREAD.
  return Math.min(4, Math.max(0, danger - 3));
}

export const TIER_PREFIX = ['', 'GRIM ', 'DIRE ', 'ELDER ', 'DREAD '];
