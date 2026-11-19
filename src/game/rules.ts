// Old-school d20 rules with a swords-and-sorcery bent.
import type { ItemId } from './items';

export type ClassId = 'warrior' | 'thief' | 'wizard';
export type AttrId = 'str' | 'dex' | 'wis' | 'con';
export type Attrs = Record<AttrId, number>;

export const ATTR_NAMES: AttrId[] = ['str', 'dex', 'wis', 'con'];

/** Classic modifier table: 3 = -3 ... 9-12 = 0 ... 18 = +3. */
export function mod(score: number): number {
  if (score <= 3) return -3;
  if (score <= 5) return -2;
  if (score <= 8) return -1;
  if (score <= 12) return 0;
  if (score <= 15) return 1;
  if (score <= 17) return 2;
  return 3;
}

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export interface ClassInfo {
  name: string;
  main: AttrId;
  hitDie: number;
  /** Attack bonus grows by +1 every this many levels. */
  attackEvery: number;
  defenseBonus: number;
  sneakBase: number;
  lockpickBase: number;
  magicBase: number;
  /** Sneak, Lockpick and Magic also grow +1 per level for these classes. */
  growsSneakLockpick: boolean;
  growsMagic: boolean;
  armour: ItemId[];
  weapons: ItemId[];
  kit: { item: ItemId; count?: number; equip?: boolean }[];
  gold: number;
  blurb: string[];
}

export const CLASSES: Record<ClassId, ClassInfo> = {
  warrior: {
    name: 'WARRIOR',
    main: 'str',
    hitDie: 10,
    attackEvery: 1,
    defenseBonus: 2,
    sneakBase: 0,
    lockpickBase: 0,
    magicBase: 0,
    growsSneakLockpick: false,
    growsMagic: false,
    armour: ['robes', 'leather', 'chain', 'shield'],
    weapons: ['dagger', 'shortsword', 'sword', 'axe', 'staff', 'shortbow'],
    kit: [
      { item: 'sword', equip: true },
      { item: 'chain', equip: true },
      { item: 'shield', equip: true },
      { item: 'torch', count: 2 },
      { item: 'healing', count: 1 },
    ],
    gold: 30,
    blurb: ['STRONG AND HARD TO KILL.', 'ANY WEAPON, ANY ARMOUR.', '+2 DEFENSE.'],
  },
  thief: {
    name: 'THIEF',
    main: 'dex',
    hitDie: 8,
    attackEvery: 2,
    defenseBonus: 0,
    sneakBase: 4,
    lockpickBase: 4,
    magicBase: 0,
    growsSneakLockpick: true,
    growsMagic: false,
    armour: ['robes', 'leather'],
    weapons: ['dagger', 'shortsword', 'shortbow'],
    kit: [
      { item: 'shortsword', equip: true },
      { item: 'shortbow' },
      { item: 'leather', equip: true },
      { item: 'lockpicks' },
      { item: 'torch', count: 2 },
      { item: 'healing', count: 1 },
    ],
    gold: 60,
    blurb: ['QUIET, QUICK AND GREEDY.', 'SNEAK AND LOCKPICK +4.', 'DOUBLE DAMAGE UNSEEN.'],
  },
  wizard: {
    name: 'WIZARD',
    main: 'wis',
    hitDie: 6,
    attackEvery: 3,
    defenseBonus: 0,
    sneakBase: 0,
    lockpickBase: 0,
    magicBase: 4,
    growsSneakLockpick: false,
    growsMagic: true,
    armour: ['robes'],
    weapons: ['dagger', 'staff'],
    kit: [
      { item: 'staff', equip: true },
      { item: 'robes', equip: true },
      { item: 'mana', count: 2 },
      { item: 'torch', count: 1 },
      { item: 'healing', count: 1 },
    ],
    gold: 40,
    blurb: ['FRAIL, BUT COMMANDS SPELLS.', 'FREE SPARKS, WARD, MEND.', 'MAGIC +4. MP COMES BACK SLOWLY.'],
  },
};

/** XP needed to reach each level (index = level): 50 x level x (level - 1). */
export const MAX_LEVEL = 15;
export const XP_TABLE = Array.from({ length: MAX_LEVEL + 1 }, (_, n) => (n < 2 ? 0 : 50 * n * (n - 1)));

// ---------- training ----------

/** Skills a point can go into at each level. */
export type SkillId = 'attack' | 'defense' | 'sneak' | 'lockpick' | 'magic' | 'heal';
export const SKILLS: { id: SkillId; name: string; desc: string }[] = [
  { id: 'attack', name: 'ATTACK', desc: 'HIT MORE OFTEN, NEAR AND FAR.' },
  { id: 'defense', name: 'DEFENSE', desc: 'GET HIT LESS OFTEN.' },
  { id: 'sneak', name: 'SNEAK', desc: 'GO UNSEEN. FOR BACKSTABS.' },
  { id: 'lockpick', name: 'LOCKPICK', desc: 'LOCKS AND TRAPS.' },
  { id: 'magic', name: 'MAGIC', desc: 'SPELLS HIT HARDER. RESIST MAGIC.' },
  { id: 'heal', name: 'HEAL', desc: 'MORE FROM POTIONS AND REST.' },
];

/** Levels that bring a perk, and levels that bring an attribute point. */
export const PERK_LEVELS = [3, 6, 9, 12, 15];
export const ATTR_LEVELS = [4, 8, 12];

export type PerkId =
  | 'cleave' | 'ironhide' | 'secondwind' | 'weaponmaster' | 'bulwark'
  | 'assassin' | 'shadowstep' | 'fence' | 'lightfingers' | 'deadeye'
  | 'focus' | 'deepwell' | 'familiar' | 'quickmind' | 'arcaneward';

export const PERKS: Record<ClassId, { id: PerkId; name: string; desc: string }[]> = {
  warrior: [
    { id: 'cleave', name: 'CLEAVE', desc: 'A KILL IN MELEE GIVES A FREE SWING AT ANOTHER FOE.' },
    { id: 'ironhide', name: 'IRON HIDE', desc: 'DEFENSE +2.' },
    { id: 'secondwind', name: 'SECOND WIND', desc: 'ONCE A DAY, NEAR DEATH, HEAL HALF YOUR HP.' },
    { id: 'weaponmaster', name: 'WEAPON MASTER', desc: 'MELEE ATTACK +1, DAMAGE +2.' },
    { id: 'bulwark', name: 'BULWARK', desc: 'A SHIELD GIVES +2 MORE DEFENSE.' },
  ],
  thief: [
    { id: 'assassin', name: 'ASSASSIN', desc: 'BACKSTABS AND AMBUSHES DO TRIPLE DAMAGE.' },
    { id: 'shadowstep', name: 'SHADOW STEP', desc: 'SNEAK AT FULL SPEED.' },
    { id: 'fence', name: 'FENCE', desc: 'SHOPS PAY YOU A QUARTER MORE.' },
    { id: 'lightfingers', name: 'LIGHT FINGERS', desc: 'LOCKPICK +3.' },
    { id: 'deadeye', name: 'DEADEYE', desc: 'BOW ATTACK +2, DAMAGE +2.' },
  ],
  wizard: [
    { id: 'focus', name: 'SPELL FOCUS', desc: 'MAGIC +2. SPARK DOES D6.' },
    { id: 'deepwell', name: 'DEEP WELL', desc: 'HALF AS MUCH MP AGAIN.' },
    { id: 'familiar', name: 'FAMILIAR', desc: 'A WISP OF LIGHT FOLLOWS YOU UNDERGROUND.' },
    { id: 'quickmind', name: 'QUICK MIND', desc: 'MP COMES BACK TWICE AS FAST.' },
    { id: 'arcaneward', name: 'ARCANE WARD', desc: 'WARD SOAKS HALF AS MUCH AGAIN, AND LASTS LONGER.' },
  ],
};

// ---------- backgrounds ----------

export type BackgroundId = 'farmhand' | 'acolyte' | 'streetrat' | 'soldier' | 'scribe';
/** `gives` is the short bonus shown beside the name when choosing. */
export const BACKGROUNDS: { id: BackgroundId; name: string; gives: string; desc: string }[] = [
  { id: 'farmhand', name: 'FARMHAND', gives: '+3 HP', desc: 'TOUGH FROM HARD WORK. YOU START WITH 3 MORE HIT POINTS.' },
  { id: 'acolyte', name: 'ACOLYTE', gives: 'HEAL +1', desc: 'RAISED IN A TEMPLE. HEAL +1, AND AN EXTRA HEALING DRAUGHT.' },
  { id: 'streetrat', name: 'STREET RAT', gives: 'SNEAK, LOCKS', desc: 'GREW UP ON THE STREETS. SNEAK +1 AND LOCKPICK +1.' },
  { id: 'soldier', name: 'SOLDIER', gives: 'ATTACK +1', desc: 'SERVED IN THE LEVY. ATTACK +1.' },
  { id: 'scribe', name: 'SCRIBE', gives: 'MAGIC +1', desc: 'READS OLD SCRIPTS. MAGIC +1, AND A FIRE SCROLL.' },
];

export type SpellId =
  | 'spark' | 'ward' | 'mend' | 'glow' | 'sleep' | 'blink' | 'fireball'
  | 'detect' | 'shield' | 'hold' | 'recall' | 'chain' | 'banish';

export interface Spell {
  id: SpellId;
  name: string;
  mp: number;
  level: number;
  ranged: boolean;
  /** Learned from a tome rather than by levelling. */
  tome?: boolean;
  desc: string;
}

export const SPELLS: Spell[] = [
  { id: 'spark', name: 'SPARK', mp: 0, level: 1, ranged: true, desc: 'FREE BOLT. D4 + WIS MOD.' },
  { id: 'ward', name: 'WARD', mp: 2, level: 1, ranged: false, desc: 'SOAKS UP THE NEXT BLOWS.' },
  { id: 'mend', name: 'MEND', mp: 2, level: 1, ranged: false, desc: 'HEALS D6 + HEAL.' },
  { id: 'glow', name: 'GLOW', mp: 1, level: 1, ranged: false, desc: 'LIGHT FOR DARK PLACES.' },
  { id: 'sleep', name: 'SLEEP', mp: 3, level: 3, ranged: false, desc: 'WEAK FOES NEARBY SLEEP.' },
  { id: 'blink', name: 'BLINK', mp: 2, level: 3, ranged: false, desc: 'JUMP AWAY FROM DANGER.' },
  { id: 'fireball', name: 'FIREBALL', mp: 5, level: 5, ranged: true, desc: 'BURSTS: 2D6 TO ALL AROUND.' },
  // Learned from tomes (the level is the least a wizard needs to understand it).
  { id: 'detect', name: 'DETECT', mp: 2, level: 2, ranged: false, tome: true, desc: 'SENSE FOES AND CHESTS NEARBY.' },
  { id: 'shield', name: 'SHIELD', mp: 3, level: 2, ranged: false, tome: true, desc: 'DEFENSE +4 FOR A WHILE.' },
  { id: 'hold', name: 'HOLD', mp: 4, level: 4, ranged: true, tome: true, desc: 'FREEZES ONE FOE IN PLACE.' },
  { id: 'recall', name: 'RECALL', mp: 6, level: 5, ranged: false, tome: true, desc: 'HOME TO THE TEMPLE, AT ONCE.' },
  { id: 'banish', name: 'BANISH', mp: 5, level: 6, ranged: false, tome: true, desc: '3D6 TO THE UNDEAD NEARBY.' },
  { id: 'chain', name: 'CHAIN BOLT', mp: 6, level: 7, ranged: true, tome: true, desc: 'LEAPS BETWEEN UP TO 3 FOES.' },
];

/**
 * What d20 + stealth must reach for a monster of this level not to notice you. It climbs
 * twice as fast as the level so a thief's growing Sneak can't outrun it: rats never see a
 * sneaking thief coming, but wights and worse still might.
 */
export const noticeDc = (level: number): number => 12 + 2 * level;

/** Check difficulties. */
export const EASY = 10;
export const HARD = 15;
export const VERY_HARD = 20;
