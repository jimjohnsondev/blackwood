// Everything the player can carry.

import type { SkillId, SpellId } from './rules';

/** Weapons and armour, which also come in better grades (tiers). */
export type GearId =
  | 'dagger' | 'shortsword' | 'sword' | 'axe' | 'staff' | 'shortbow'
  | 'robes' | 'leather' | 'chain' | 'shield';
export type Tier = 1 | 2 | 3;
/** Spells learned from tomes. */
export type TomeSpell = 'detect' | 'shield' | 'hold' | 'recall' | 'banish' | 'chain';

export type ItemId =
  | GearId
  | `${GearId}+${Tier}`
  | 'torch' | 'healing' | 'mana' | 'lockpicks' | 'scroll'
  | `tome-${TomeSpell}`
  | UniqueId
  | 'horse'
  | 'barrowkey' | 'relic' | 'key' | 'shard';

/** One-of-a-kind treasures, one in each region's landmark. */
export type UniqueId = 'gravebreaker' | 'mireshroud' | 'starfall' | 'wardenbow' | 'lostshield';

export type ItemKind =
  | 'weapon' | 'bow' | 'armour' | 'shield'
  | 'torch' | 'potion' | 'tool' | 'scroll' | 'tome' | 'mount' | 'key' | 'relic';

export interface ItemInfo {
  name: string;
  kind: ItemKind;
  /** Shop price in gold; selling gives half. 0 = can't be sold. */
  price: number;
  /** Damage dice [count, sides]. */
  dmg?: [number, number];
  armour?: number;
  /** Better grades: + to hit and damage (weapons) or + defense (armour). */
  bonus?: number;
  /** The plain item this is a better grade of. */
  base?: GearId;
  /** The spell a tome teaches. */
  spell?: SpellId;
  /** One of a kind. */
  unique?: boolean;
  /** Extra points to skills while it's equipped (uniques). */
  extra?: Partial<Record<SkillId, number>>;
  desc: string;
}

const BASE_ITEMS = {
  dagger: { name: 'DAGGER', kind: 'weapon', price: 4, dmg: [1, 4], desc: 'SHORT AND SHARP.' },
  shortsword: { name: 'SHORT SWORD', kind: 'weapon', price: 12, dmg: [1, 6], desc: 'A QUICK BLADE.' },
  sword: { name: 'LONGSWORD', kind: 'weapon', price: 25, dmg: [1, 8], desc: 'A WELL BALANCED BLADE.' },
  axe: { name: 'WAR AXE', kind: 'weapon', price: 30, dmg: [1, 10], desc: 'HEAVY AND BRUTAL.' },
  staff: { name: 'STAFF', kind: 'weapon', price: 5, dmg: [1, 6], desc: 'GNARLED OAK, SHOD IN IRON.' },
  shortbow: { name: 'SHORT BOW', kind: 'bow', price: 25, dmg: [1, 6], desc: 'AIM AND SHOOT WITH FIRE.' },
  robes: { name: 'ROBES', kind: 'armour', price: 5, armour: 1, desc: 'THICK WOOL. DEFENSE +1.' },
  leather: { name: 'LEATHER', kind: 'armour', price: 15, armour: 2, desc: 'BOILED LEATHER. DEFENSE +2.' },
  chain: { name: 'CHAIN MAIL', kind: 'armour', price: 60, armour: 4, desc: 'RINGS OF IRON. DEFENSE +4.' },
  shield: { name: 'WOOD SHIELD', kind: 'shield', price: 10, armour: 1, desc: 'OAK AND IRON. DEFENSE +1.' },
  torch: { name: 'TORCH', kind: 'torch', price: 2, desc: 'LIGHT IN DARK PLACES. BURNS 400 TURNS.' },
  healing: { name: 'HEAL DRAUGHT', kind: 'potion', price: 15, desc: 'HEALS 2D4+2 + HEAL.' },
  mana: { name: 'MANA DRAUGHT', kind: 'potion', price: 20, desc: 'RESTORES 2D4 MP.' },
  lockpicks: { name: 'LOCKPICKS', kind: 'tool', price: 20, desc: 'LOCKPICK +2 WHILE CARRIED.' },
  scroll: { name: 'FIRE SCROLL', kind: 'scroll', price: 30, desc: 'ANYONE CAN READ IT. 3D6 FIRE AHEAD.' },
  barrowkey: { name: 'BARROW KEY', kind: 'key', price: 0, desc: 'COLD IRON. IT OPENS THE BARROW.' },
  relic: { name: 'RELIC', kind: 'relic', price: 0, desc: 'CRACKED. MADE WHOLE, IT OPENS THE BLACK GATE.' },
  shard: { name: 'RELIC SHARD', kind: 'relic', price: 0, desc: 'A PIECE OF THE RELIC, TAKEN FROM A LIEUTENANT.' },
  key: { name: 'IRON KEY', kind: 'key', price: 12, desc: 'OPENS ONE LOCKED DOOR OR CHEST, THEN BREAKS.' },
} satisfies Record<string, ItemInfo>;

const GEAR: GearId[] = ['dagger', 'shortsword', 'sword', 'axe', 'staff', 'shortbow', 'robes', 'leather', 'chain', 'shield'];
export const TIER_NAMES: Record<Tier, string> = { 1: 'FINE', 2: 'MASTERWORK', 3: 'RUNED' };

/** FINE, MASTERWORK and RUNED versions of every weapon and armour. */
function tiered(): Record<string, ItemInfo> {
  const out: Record<string, ItemInfo> = {};
  for (const id of GEAR) {
    const b: ItemInfo = BASE_ITEMS[id];
    for (const tier of [1, 2, 3] as Tier[]) {
      const weapon = b.kind === 'weapon' || b.kind === 'bow';
      out[`${id}+${tier}`] = {
        ...b,
        name: `${TIER_NAMES[tier]} ${b.name}`,
        price: Math.round(b.price * (1 + tier * 1.5)) + tier * 20,
        bonus: tier,
        base: id,
        desc: weapon ? `TO HIT AND DAMAGE +${tier}.` : `DEFENSE +${(b.armour ?? 0) + tier}.`,
      };
    }
  }
  return out;
}

/** Tomes: a wizard reads one to learn its spell for good. */
const TOMES: Record<`tome-${TomeSpell}`, ItemInfo> = {
  'tome-detect': { name: 'TOME: DETECT', kind: 'tome', price: 60, spell: 'detect', desc: 'A WIZARD LEARNS DETECT FROM IT.' },
  'tome-shield': { name: 'TOME: SHIELD', kind: 'tome', price: 80, spell: 'shield', desc: 'A WIZARD LEARNS SHIELD FROM IT.' },
  'tome-hold': { name: 'TOME: HOLD', kind: 'tome', price: 120, spell: 'hold', desc: 'A WIZARD LEARNS HOLD FROM IT.' },
  'tome-recall': { name: 'TOME: RECALL', kind: 'tome', price: 150, spell: 'recall', desc: 'A WIZARD LEARNS RECALL FROM IT.' },
  'tome-banish': { name: 'TOME: BANISH', kind: 'tome', price: 150, spell: 'banish', desc: 'A WIZARD LEARNS BANISH FROM IT.' },
  'tome-chain': { name: 'TOME: CHAIN BOLT', kind: 'tome', price: 200, spell: 'chain', desc: 'A WIZARD LEARNS CHAIN BOLT FROM IT.' },
};
export const TOME_IDS = Object.keys(TOMES) as `tome-${TomeSpell}`[];

/** The landmarks' treasures: the best grade, and something more. */
const UNIQUES: Record<UniqueId, ItemInfo> = {
  gravebreaker: {
    ...BASE_ITEMS.axe, name: 'GRAVEBREAKER', price: 600, bonus: 3, base: 'axe', unique: true, extra: { attack: 1 },
    desc: "A GIANT'S AXE. TO HIT AND DAMAGE +3, ATTACK +1.",
  },
  mireshroud: {
    ...BASE_ITEMS.leather, name: 'MIRESHROUD', price: 600, bonus: 3, base: 'leather', unique: true, extra: { sneak: 2 },
    desc: 'BOG-BLACK LEATHER. DEFENSE +5, SNEAK +2.',
  },
  starfall: {
    ...BASE_ITEMS.staff, name: 'STARFALL STAFF', price: 600, bonus: 3, base: 'staff', unique: true, extra: { magic: 2 },
    desc: 'A SHARD OF THE FALLEN STAR. +3, MAGIC +2.',
  },
  wardenbow: {
    ...BASE_ITEMS.shortbow, name: "WARDEN'S BOW", price: 600, bonus: 3, base: 'shortbow', unique: true, extra: { sneak: 1 },
    desc: 'NEVER MISSES ITS MARK, THEY SAY. +3, SNEAK +1.',
  },
  lostshield: {
    ...BASE_ITEMS.shield, name: 'AEGIS OF THE LOST', price: 600, bonus: 3, base: 'shield', unique: true, extra: { defense: 1 },
    desc: 'THE LAST SHIELD OF A DEAD CITY. DEFENSE +6.',
  },
};

/** A horse: bought, not carried. Faster on roads. */
const MOUNTS = {
  horse: { name: 'HORSE', kind: 'mount', price: 150, desc: 'TWO STEPS A TURN ON ROADS. WAITS OUTSIDE PLACES.' } as ItemInfo,
};

export const ITEMS = { ...BASE_ITEMS, ...tiered(), ...TOMES, ...UNIQUES, ...MOUNTS } as Record<ItemId, ItemInfo>;

/** The plain version of an item (a RUNED SWORD is a SWORD). */
export function baseOf(id: ItemId): ItemId {
  return ITEMS[id]?.base ?? id;
}

/** Grade of a weapon or armour: 0 plain, 1 FINE, 2 MASTERWORK, 3 RUNED. */
export function bonusOf(id: ItemId | undefined): number {
  return id ? ITEMS[id]?.bonus ?? 0 : 0;
}

/** A better grade of an item, if it has grades. */
export function withTier(id: ItemId, tier: number): ItemId {
  if (tier <= 0 || !GEAR.includes(id as GearId)) return id;
  return `${id as GearId}+${Math.min(3, tier) as Tier}`;
}

/** Gear sold in village and hamlet shops. */
export const SHOP_STOCK: ItemId[] = [
  'torch', 'healing', 'mana', 'scroll', 'lockpicks',
  'dagger', 'shortsword', 'sword', 'axe', 'staff', 'shortbow',
  'robes', 'leather', 'chain', 'shield',
  'shortsword+1', 'sword+1', 'staff+1', 'leather+1', 'shield+1',
  'tome-detect', 'tome-shield',
  'horse',
];

/** What caravan traders carry: road goods and a few finer things from far towns. */
export const TRADER_STOCK: ItemId[] = [
  'healing', 'mana', 'torch', 'scroll',
  'sword+1', 'leather+1', 'chain+1', 'shortbow+1', 'staff+2', 'dagger+2',
  'tome-hold', 'tome-recall',
];
