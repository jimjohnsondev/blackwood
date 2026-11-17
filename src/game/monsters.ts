// The monster list. Habitats decide where each one turns up.

export type MonsterId =
  | 'rat' | 'wolf' | 'bandit' | 'goblin' | 'spider'
  | 'skeleton' | 'wisp' | 'hag' | 'wight' | 'boss';

export type Habitat = 'plains' | 'forest' | 'hills' | 'mire' | 'dead' | 'dungeon' | 'cave';

export interface MonsterInfo {
  name: string;
  /** For the journal: DEFEATED 3 WOLVES. */
  plural: string;
  level: number;
  /** Hit dice: [count, sides, plus]. */
  hp: [number, number, number];
  defense: number;
  attack: number;
  dmg: [number, number, number];
  xp: number;
  gold?: [number, number];
  habitats: Habitat[];
  /** Outdoors, only comes out at night. */
  nightOnly?: boolean;
  /**
   * How it fights, if not by simply charging:
   * shoots: looses arrows from a few steps off. flees: runs when badly hurt.
   * calls: its cry on first seeing you wakes every other beast nearby.
   */
  way?: 'shoots' | 'flees' | 'calls';
  hit: string;
}

export const MONSTERS: Record<MonsterId, MonsterInfo> = {
  rat: {
    name: 'GIANT RAT', plural: 'GIANT RATS', level: 1, hp: [1, 4, 1], defense: 11, attack: 0, dmg: [1, 3, 0], xp: 5,
    habitats: ['plains', 'dungeon', 'cave'], hit: 'BITES',
  },
  wolf: {
    name: 'WOLF', plural: 'WOLVES', level: 2, hp: [2, 6, 0], defense: 12, attack: 1, dmg: [1, 4, 1], xp: 15,
    habitats: ['forest', 'plains', 'hills'], hit: 'BITES', way: 'calls',
  },
  bandit: {
    name: 'BANDIT', plural: 'BANDITS', level: 2, hp: [2, 8, 0], defense: 13, attack: 2, dmg: [1, 6, 0], xp: 20, gold: [3, 15],
    habitats: ['plains', 'hills', 'forest'], hit: 'STABS', way: 'shoots',
  },
  goblin: {
    name: 'GOBLIN', plural: 'GOBLINS', level: 1, hp: [1, 8, 2], defense: 12, attack: 1, dmg: [1, 6, 0], xp: 12, gold: [1, 6],
    habitats: ['hills', 'cave', 'dungeon'], hit: 'HACKS', way: 'flees',
  },
  spider: {
    name: 'GIANT SPIDER', plural: 'GIANT SPIDERS', level: 3, hp: [2, 8, 2], defense: 13, attack: 2, dmg: [1, 6, 0], xp: 25,
    habitats: ['forest', 'cave', 'dungeon'], hit: 'BITES',
  },
  skeleton: {
    name: 'SKELETON', plural: 'SKELETONS', level: 3, hp: [2, 8, 2], defense: 13, attack: 2, dmg: [1, 6, 0], xp: 25, gold: [0, 8],
    habitats: ['dead', 'dungeon'], nightOnly: true, hit: 'CLAWS',
  },
  wisp: {
    name: 'WISP', plural: 'WISPS', level: 3, hp: [2, 6, 0], defense: 15, attack: 3, dmg: [1, 4, 1], xp: 30,
    habitats: ['mire'], nightOnly: true, hit: 'BURNS',
  },
  hag: {
    name: 'BOG HAG', plural: 'BOG HAGS', level: 4, hp: [4, 8, 0], defense: 14, attack: 4, dmg: [1, 8, 0], xp: 60, gold: [5, 25],
    habitats: ['mire', 'dead'], hit: 'RAKES',
  },
  wight: {
    name: 'WIGHT', plural: 'WIGHTS', level: 5, hp: [4, 8, 4], defense: 15, attack: 4, dmg: [1, 8, 1], xp: 80, gold: [5, 30],
    habitats: ['dungeon', 'dead'], nightOnly: true, hit: 'CHILLS',
  },
  boss: {
    name: 'BOSS', plural: 'BOSSES', level: 6, hp: [5, 8, 0], defense: 13, attack: 4, dmg: [1, 8, 1], xp: 400, gold: [50, 100],
    habitats: [], hit: 'STRIKES',
  },
};

/** Monster kinds that fit a habitat and difficulty (1-5). */
export function monstersFor(habitat: Habitat, depth: number, night: boolean): MonsterId[] {
  const fits = (Object.keys(MONSTERS) as MonsterId[]).filter((id) => {
    const m = MONSTERS[id];
    if (id === 'boss') return false;
    if (!m.habitats.includes(habitat)) return false;
    if (m.nightOnly && !night && habitat !== 'dungeon') return false;
    return m.level <= depth;
  });
  // In dangerous lands the small fry keep away: nothing more than two levels below the danger.
  const floor = Math.min(depth, 5) - 2;
  const worthy = fits.filter((id) => MONSTERS[id].level >= floor);
  return worthy.length ? worthy : fits;
}

/** Big, lone creatures never come in packs; wisps drift in pairs at most. */
const LONERS: MonsterId[] = ['hag', 'wight'];

/** How many come together, by danger: alone in safe lands, in twos and threes in dangerous ones. */
export function packSize(kind: MonsterId, danger: number, roll: number): number {
  if (LONERS.includes(kind) || danger < 4) return 1;
  if (kind === 'wisp') return roll < 0.5 ? 2 : 1;
  if (danger >= 6) return roll < 0.5 ? 3 : 2;
  return roll < 0.7 ? 2 : 1;
}
