// Dev helper: rough win rates for a hero against single monsters, one fight at a time.
// Run with: npx vite-node scripts/balance.ts
//
// The wizard is shown twice: "wiz-old" plays by the MVP rules (d4 hit die, SPARK d6 for
// 1 MP each, then the staff when MP runs out) and "wizard" by the current ones (d6 hit die,
// WARD first, then free d4 + WIS sparks).
//
// "thief-s" is a thief who sneaks up first: if the monster fails to notice them, the opening
// arrow is an AMBUSH. Run with OLD=1 to see the stealth rules from before the thief rebalance
// (notice DC 10 + level, and an ambush doubling the whole damage).
import { MONSTERS, type MonsterId } from '../src/game/monsters';
import { createPlayer, attackBonus, defense, magic, maxMp, sneak, weaponDice } from '../src/game/player';
import { mod, noticeDc, type ClassId } from '../src/game/rules';
import { Rng } from '../src/gen/rng';

type Who = ClassId | 'wiz-old' | 'thief-s';
const OLD = process.env.OLD === '1';
const dcFor = (level: number) => (OLD ? 10 + level : noticeDc(level));
/** Stealth while sneaking (+5), in daylight. */
const sneaking = (p: ReturnType<typeof createPlayer>) => sneak(p) + 5;
const rng = new Rng('balance');
const ATTRS = { str: 12, dex: 12, wis: 12, con: 12 };
const HIT_DIE: Record<Who, number> = { warrior: 10, thief: 8, 'thief-s': 8, wizard: 6, 'wiz-old': 4 };

interface Hero { p: ReturnType<typeof createPlayer>; who: Who; level: number; mp: number; potions: number }

function hero(who: Who, level: number): Hero {
  const cls: ClassId = who === 'wiz-old' ? 'wizard' : who === 'thief-s' ? 'thief' : who;
  const p = createPlayer('X', cls, 0, ATTRS);
  p.level = level;
  p.maxHp = Math.max(6, HIT_DIE[who] + mod(ATTRS.con)) + (level - 1) * Math.ceil((HIT_DIE[who] + 1) / 2);
  p.hp = p.maxHp;
  return { p, who, level, mp: maxMp(p), potions: 1 };
}

/** One fight to the death. The monster starts 3 steps away: bows and sparks get shots in first. */
function fight(h: Hero, id: MonsterId): boolean {
  const { p, who, level } = h;
  const m = MONSTERS[id];
  let mhp = rng.dice(m.hp[0], m.hp[1], m.hp[2]);
  let ward = 0;
  let gap = 3;
  // Sneaking up: the monster gets its check when the thief comes within 6 steps.
  let unseen = who === 'thief-s' && rng.dice(1, 20) + sneaking(p) >= dcFor(m.level);
  while (p.hp > 0 && mhp > 0) {
    const ranged = (who === 'wizard') || (who === 'wiz-old' && h.mp > 0) || who === 'thief' || who === 'thief-s';
    if (p.hp < p.maxHp / 3 && h.potions > 0) {
      h.potions--;
      p.hp += rng.dice(2, 4, 2);
    } else if (who === 'wizard' && ward === 0 && h.mp >= 2) {
      h.mp -= 2;
      ward = WARD(level);
    } else if (gap > 1 && !ranged) {
      // Nothing to shoot with: wait for it to come.
    } else {
      const r = rng.dice(1, 20);
      const spells = who === 'wizard' || (who === 'wiz-old' && h.mp > 0);
      const bonus = spells ? magic(p) : attackBonus(p, gap > 1);
      if (r === 20 || (r !== 1 && r + bonus >= m.defense)) {
        const [n, s] = weaponDice(p);
        if (who === 'wizard') mhp -= Math.max(1, rng.dice(1, 4) + mod(ATTRS.wis));
        else if (spells) mhp -= Math.max(1, rng.dice(1, 6) + mod(ATTRS.wis));
        else if (gap > 1) {
          const die = rng.dice(1, 6);
          mhp -= unseen ? (OLD ? die * (r === 20 ? 4 : 2) : die * 2) : die;
        }
        else mhp -= Math.max(1, rng.dice(n, s) + mod(p.attrs.str));
      }
      if (who === 'wiz-old' && h.mp > 0) h.mp--;
      unseen = false;
    }
    if (mhp <= 0) break;
    if (gap > 1) { gap--; continue; }
    const r2 = rng.dice(1, 20);
    if (r2 === 20 || (r2 !== 1 && r2 + m.attack >= defense(p))) {
      let dmg = Math.max(1, rng.dice(m.dmg[0], m.dmg[1], m.dmg[2]));
      const soaked = Math.min(ward, dmg);
      ward -= soaked;
      dmg -= soaked;
      p.hp -= dmg;
    }
  }
  return p.hp > 0;
}

const WARD = (level: number) => Number(process.env.WARD_BASE ?? 5) + level * Number(process.env.WARD_PER ?? 1);
const pct = (n: number) => `${Math.round(n / 20)}%`.padStart(4);

console.log('ONE FIGHT, FULL HP AND MP');
for (const who of ['warrior', 'thief', 'thief-s', 'wizard', 'wiz-old'] as Who[]) {
  for (const level of [1, 4, 7]) {
    const row = (['rat', 'goblin', 'wolf', 'bandit', 'skeleton', 'wight', 'boss'] as MonsterId[]).map((id) => {
      let wins = 0;
      for (let t = 0; t < 2000; t++) if (fight(hero(who, level), id)) wins++;
      return `${id} ${pct(wins)}`;
    });
    console.log(who.padEnd(8), 'L' + level, row.join('  '));
  }
}

console.log('\nA DAY ON THE ROAD: RAT, GOBLIN, WOLF, BANDIT IN A ROW (2 MP BACK BETWEEN FIGHTS)');
for (const who of ['warrior', 'thief', 'wizard', 'wiz-old'] as Who[]) {
  for (const level of [1, 2, 4]) {
    let lived = 0;
    for (let t = 0; t < 2000; t++) {
      const h = hero(who, level);
      let ok = true;
      for (const id of ['rat', 'goblin', 'wolf', 'bandit'] as MonsterId[]) {
        if (!fight(h, id)) { ok = false; break; }
        if (who === 'wizard') h.mp = Math.min(maxMp(h.p), h.mp + 2);
        h.p.hp = Math.min(h.p.maxHp, h.p.hp + 1);
      }
      if (ok) lived++;
    }
    console.log(who.padEnd(8), 'L' + level, `survives ${pct(lived)}`);
  }
}

console.log(`
CHANCE A SNEAKING THIEF (DEX 16) GOES UNNOTICED, PER CHECK${OLD ? ' (OLD RULES)' : ''}`);
for (const level of [1, 4, 6, 8, 10]) {
  const p = createPlayer('X', 'thief', 0, { ...ATTRS, dex: 16 });
  p.level = level;
  const row = (['rat', 'wolf', 'skeleton', 'hag', 'wight', 'boss'] as MonsterId[]).map((id) => {
    const need = dcFor(MONSTERS[id].level) - sneaking(p);
    const chance = Math.min(20, Math.max(0, 21 - need)) / 20;
    return `${id} ${`${Math.round(chance * 100)}%`.padStart(4)}`;
  });
  console.log(`L${level}`.padEnd(4), `stealth +${sneaking(p)}`.padEnd(11), row.join('  '));
}
