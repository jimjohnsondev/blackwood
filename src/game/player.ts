// The player character and the numbers worked out from class, level, attributes and gear.
import type { Dir } from '../input/actions';
import { baseOf, bonusOf, ITEMS, type ItemId } from './items';
import {
  BACKGROUNDS, CLASSES, mod,
  type Attrs, type BackgroundId, type ClassId, type PerkId, type SkillId, type SpellId,
} from './rules';

/** What the CAST / FIRE button uses: a spell, the bow or a fire scroll. Remembered between uses. */
export type Ready = SpellId | 'bow' | 'scroll' | null;

export interface Player {
  name: string;
  cls: ClassId;
  scheme: number;
  attrs: Attrs;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  mp: number;
  gold: number;
  inventory: { id: ItemId; count: number }[];
  equip: { weapon?: ItemId; armour?: ItemId; shield?: ItemId };
  ready: Ready;
  x: number;
  y: number;
  facing: Dir;
  /** Light in dark places: turns left and how far it reaches. */
  light: { turns: number; radius: number };
  /** WARD: damage it will still soak up, and turns before it fades. */
  ward?: { points: number; turns: number };
  /** Turns before a new WARD can be raised (one ward per fight). */
  wardCooldown?: number;
  /** Sneaking: half speed, +5 Sneak. Ends on attacking. */
  sneaking?: boolean;
  /** Points put into each skill (from levelling and the background). */
  trained?: Partial<Record<SkillId, number>>;
  /** Perks chosen at levels 3, 6, 9, 12 and 15. */
  perks?: PerkId[];
  /** Spells a wizard has learned from tomes. */
  spellbook?: SpellId[];
  background?: BackgroundId;
  /** Level-up choices still to make: skill points, perks, attribute points. */
  pending?: { skills: number; perks: number; attrs: number };
  /** The day SECOND WIND was last used. */
  secondWindDay?: number;
  /** Permadeath. */
  hard?: boolean;
  /** SHIELD spell: turns left. */
  shielded?: number;
  /** A horse, if owned: `at` is the site it waits outside, or null when you're riding it. */
  horse?: { at: number | null };
}

/** Points put into a skill (from training and background). */
export function trained(p: Player, skill: SkillId): number {
  return p.trained?.[skill] ?? 0;
}

/** Training plus whatever the player's gear adds (unique items). */
export function skillBonus(p: Player, skill: SkillId): number {
  let n = trained(p, skill);
  for (const id of [p.equip.weapon, p.equip.armour, p.equip.shield, bestBow(p)]) {
    if (id) n += ITEMS[id].extra?.[skill] ?? 0;
  }
  return n;
}

export function hasPerk(p: Player, perk: PerkId): boolean {
  return !!p.perks?.includes(perk);
}

/** The best bow the player carries, if any (a FINE SHORT BOW beats a plain one). */
export function bestBow(p: Player): ItemId | undefined {
  let best: ItemId | undefined;
  for (const s of p.inventory) {
    if (s.count > 0 && baseOf(s.id) === 'shortbow' && (!best || bonusOf(s.id) > bonusOf(best))) best = s.id;
  }
  return best;
}

export function createPlayer(
  name: string, cls: ClassId, scheme: number, attrs: Attrs, background?: BackgroundId, hard = false,
): Player {
  const info = CLASSES[cls];
  const p: Player = {
    name, cls, scheme, attrs,
    level: 1, xp: 0,
    hp: 1, maxHp: 1, mp: 0,
    gold: info.gold,
    inventory: [],
    equip: {},
    ready: cls === 'wizard' ? 'spark' : null,
    x: 0, y: 0, facing: 'up',
    light: { turns: 0, radius: 2 },
  };
  // Level 1: the full hit die + CON mod, but never fewer than 6 so a new hero survives a rat.
  p.maxHp = Math.max(6, info.hitDie + mod(attrs.con));
  p.hp = p.maxHp;
  p.mp = maxMp(p);
  for (const k of info.kit) {
    addItem(p, k.item, k.count ?? 1);
    if (k.equip) equipItem(p, k.item);
  }
  if (cls === 'thief') p.ready = 'bow';
  p.hard = hard;
  // The background's small head start.
  if (background && BACKGROUNDS.some((b) => b.id === background)) {
    p.background = background;
    const t = (p.trained = {} as Partial<Record<SkillId, number>>);
    if (background === 'farmhand') { p.maxHp += 3; p.hp += 3; }
    if (background === 'acolyte') { t.heal = 1; addItem(p, 'healing'); }
    if (background === 'streetrat') { t.sneak = 1; t.lockpick = 1; }
    if (background === 'soldier') t.attack = 1;
    if (background === 'scribe') { t.magic = 1; addItem(p, 'scroll'); }
  }
  return p;
}

// ---------- derived numbers ----------

export function attackBonus(p: Player, ranged = false): number {
  const info = CLASSES[p.cls];
  const classBonus = 1 + Math.floor((p.level - 1) / info.attackEvery);
  const gear = ranged ? bonusOf(bestBow(p)) : bonusOf(p.equip.weapon);
  const perk = ranged ? (hasPerk(p, 'deadeye') ? 2 : 0) : hasPerk(p, 'weaponmaster') ? 1 : 0;
  return classBonus + (ranged ? mod(p.attrs.dex) : mod(p.attrs.str)) + skillBonus(p, 'attack') + gear + perk;
}

/** Extra damage from a better grade of weapon and from perks. */
export function damageBonus(p: Player, ranged = false): number {
  if (ranged) return bonusOf(bestBow(p)) + (hasPerk(p, 'deadeye') ? 2 : 0);
  return bonusOf(p.equip.weapon) + (hasPerk(p, 'weaponmaster') ? 2 : 0);
}

export function defense(p: Player): number {
  const armour = p.equip.armour ? ITEMS[p.equip.armour].armour ?? 0 : 0;
  const shield = p.equip.shield ? ITEMS[p.equip.shield].armour ?? 0 : 0;
  const grades = bonusOf(p.equip.armour) + bonusOf(p.equip.shield);
  const perks = hasPerk(p, 'bulwark') && p.equip.shield ? 1 : 0;
  return 10 + armour + shield + grades + perks + (p.shielded ? 4 : 0) + mod(p.attrs.dex) + CLASSES[p.cls].defenseBonus + skillBonus(p, 'defense');
}

export function sneak(p: Player): number {
  const info = CLASSES[p.cls];
  return info.sneakBase + (info.growsSneakLockpick ? p.level - 1 : 0) + mod(p.attrs.dex) + skillBonus(p, 'sneak');
}

export function lockpick(p: Player): number {
  const info = CLASSES[p.cls];
  return info.lockpickBase + (info.growsSneakLockpick ? p.level - 1 : 0) + mod(p.attrs.dex) +
    (hasItem(p, 'lockpicks') ? 2 : 0) + skillBonus(p, 'lockpick') + (hasPerk(p, 'lightfingers') ? 3 : 0);
}

export function magic(p: Player): number {
  const info = CLASSES[p.cls];
  return info.magicBase + (info.growsMagic ? p.level - 1 : 0) + mod(p.attrs.wis) + skillBonus(p, 'magic') + (hasPerk(p, 'focus') ? 2 : 0);
}

export function heal(p: Player): number {
  return mod(p.attrs.con) + mod(p.attrs.wis) + skillBonus(p, 'heal');
}

export function maxMp(p: Player): number {
  if (p.cls !== 'wizard') return 0;
  const mp = Math.max(2, 3 + mod(p.attrs.wis)) * p.level;
  return hasPerk(p, 'deepwell') ? Math.floor(mp * 1.5) : mp;
}

export function weaponDice(p: Player): [number, number] {
  return p.equip.weapon ? ITEMS[p.equip.weapon].dmg ?? [1, 2] : [1, 2];
}

// ---------- inventory ----------

export function hasItem(p: Player, id: ItemId): boolean {
  return p.inventory.some((s) => s.id === id && s.count > 0);
}

export function countItem(p: Player, id: ItemId): number {
  return p.inventory.find((s) => s.id === id)?.count ?? 0;
}

export function addItem(p: Player, id: ItemId, count = 1): void {
  const stack = p.inventory.find((s) => s.id === id);
  if (stack) stack.count += count;
  else p.inventory.push({ id, count });
}

export function removeItem(p: Player, id: ItemId, count = 1): void {
  const stack = p.inventory.find((s) => s.id === id);
  if (!stack) return;
  stack.count -= count;
  if (stack.count <= 0) {
    p.inventory = p.inventory.filter((s) => s !== stack);
    if (p.equip.weapon === id) p.equip.weapon = undefined;
    if (p.equip.armour === id) p.equip.armour = undefined;
    if (p.equip.shield === id) p.equip.shield = undefined;
    if (id === 'shortbow' && p.ready === 'bow') p.ready = null;
    if (id === 'scroll' && p.ready === 'scroll') p.ready = null;
  }
}

export function canUse(p: Player, id: ItemId): boolean {
  const kind = ITEMS[id].kind;
  const info = CLASSES[p.cls];
  if (kind === 'weapon' || kind === 'bow') return info.weapons.includes(baseOf(id));
  if (kind === 'armour' || kind === 'shield') return info.armour.includes(baseOf(id));
  return true;
}

export function isEquipped(p: Player, id: ItemId): boolean {
  return p.equip.weapon === id || p.equip.armour === id || p.equip.shield === id;
}

export function equipItem(p: Player, id: ItemId): void {
  const kind = ITEMS[id].kind;
  if (kind === 'weapon') p.equip.weapon = id;
  if (kind === 'armour') p.equip.armour = id;
  if (kind === 'shield') p.equip.shield = id;
}
