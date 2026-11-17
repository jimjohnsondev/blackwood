import type { Region } from './regions';
// Shapes of the generated world. Generation is pure: same seed, same data.
import type { T } from '../game/terrain';
import type { ItemId } from '../game/items';
import type { MonsterId } from '../game/monsters';

export type SiteKind = 'village' | 'hamlet' | 'cave' | 'tower' | 'chapel' | 'shrine' | 'ruin' | 'barrow' | 'landmark' | 'stronghold';

export interface Site {
  id: number;
  kind: SiteKind;
  name: string;
  x: number;
  y: number;
  /** One of the hand-shaped quest sites in the Vale. */
  vale: boolean;
  /** The region it lies in. */
  region: number;
  /** Some caves are something else underneath: a mine in the hills, a drowned temple in the fens. */
  style?: 'mine' | 'sunken';
}

/** One of the villain's two lieutenants: where they den, and what they are. */
export interface Lieutenant {
  name: string;         // MAREN THE DROWNED
  siteId: number;
  region: number;
  kind: MonsterId;
}

export interface Quest {
  /** Acts II and III: the lieutenants, the stronghold in the Blight, and the order the Blight spreads in. */
  lieutenants: Lieutenant[];
  strongholdId: number;
  blightOrder: number[];
  title: string;        // THE BELL OF ODRAN
  villain: string;      // ODRAN
  villainTitle: string; // THE BARROW KING
  relic: string;        // BELL
  problem: string;      // THE DEAD WALK THE MIRE AT NIGHT
  elderName: string;
  villageId: number;
  shrineId: number;
  chapelId: number;
  barrowId: number;
}

export interface World {
  seed: string;
  size: number;
  /** size*size terrain tiles (T values). */
  tiles: Uint8Array;
  sites: Site[];
  /** Key = y * size + x. */
  siteAt: Map<number, Site>;
  quest: Quest;
  /** The Vale and the five lands around it. */
  regions: Region[];
  /** size*size region ids (index into regions). */
  regionOf: Uint8Array;
}

export type NpcRole =
  | 'elder' | 'innkeeper' | 'shopkeeper' | 'priest' | 'villager' | 'beggar' | 'hermit' | 'guard' | 'trader';

export interface NpcSpawn {
  x: number;
  y: number;
  role: NpcRole;
  name: string;
  /** Villagers stroll about; keepers stay behind their counters. */
  wander: boolean;
}

export interface MonsterSpawn {
  x: number;
  y: number;
  kind: MonsterId;
  boss?: boolean;
}

export interface Loot {
  item?: ItemId;
  gold?: number;
  count?: number;
}

export interface Chest {
  id: string;
  x: number;
  y: number;
  locked: boolean;
  /** Lockpick difficulty when locked. */
  dc: number;
  loot: Loot[];
  /** Belongs to someone: opening it is theft. */
  owned?: boolean;
}

/** dart: a wound. pit: a wound and a lost turn. alarm: wakes the whole floor. rocks: a heavy wound. */
export type TrapKind = 'dart' | 'pit' | 'alarm' | 'rocks';

export interface Trap {
  x: number;
  y: number;
  dc: number;
  kind: TrapKind;
}

export type LevelKind = 'overworld' | 'town' | 'outdoor' | 'dungeon';

export interface Level {
  id: string;
  name: string;
  kind: LevelKind;
  w: number;
  h: number;
  tiles: Uint8Array;
  /** Dungeons and caves: only what the player's light reaches is visible. */
  dark: boolean;
  /** Tile drawn outside the map's edges. */
  outside: T;
  /** Where the player arrives from outside or from the floor above. */
  entry: { x: number; y: number };
  /** Where the player arrives when coming back up from the floor below. */
  downArrival?: { x: number; y: number };
  npcs: NpcSpawn[];
  monsters: MonsterSpawn[];
  chests: Chest[];
  traps: Trap[];
  siteId: number;
  floor: number;
  floors: number;
  /** Towers: the way on is up. Up-stairs lead further in, down-stairs back towards the door. */
  climbs?: boolean;
  /** Difficulty 1 (gentle) to 5 (deadly). */
  depth: number;
}
