// Dev helper: the difficulty curve. A warrior with the gear and level you'd expect at each
// stage fights packs of each monster found there, in plain melee (no potions). The warrior is
// built the way a player builds one: STR raised at levels 4, 8 and 12, a skill point every
// level (ATTACK and DEFENSE in turn), and the perks WEAPON MASTER, IRON HIDE, BULWARK, CLEAVE
// (not simulated) and SECOND WIND. Pass BARE=1 for the old bare warrior: no skills, no perks.
// Shows the share of HP lost per fight, and how often the fight is lost. Aim: about 20-40%.
// Run with: npx vite-node scripts/curve.ts
import { createPlayer, attackBonus, damageBonus, defense, weaponDice, addItem, equipItem, hasPerk } from '../src/game/player';
import { mod, type PerkId } from '../src/game/rules';
import { MONSTERS, type MonsterId } from '../src/game/monsters';
import { Rng } from '../src/gen/rng';
const rng = new Rng('b');
const BARE = process.env.BARE === '1';
const A = { str: 14, dex: 12, wis: 10, con: 13 };
const PERK_PICKS: [number, PerkId][] = [[3, 'weaponmaster'], [6, 'ironhide'], [9, 'bulwark'], [12, 'cleave'], [15, 'secondwind']];
// Tier steps as the game uses them (spawnMonster and foe in game.ts, monsterTier in regions.ts).
// Pass other numbers to try them: HP-per-tier ATTACK DAMAGE DEFENSE tier-start.
const args = process.argv.slice(2).map(Number);
const [HPK, ATK, DMG, DEF, TSTART] = args.length === 5 ? args : [0.4, 1, 1, 1, 3];
const tierOf = (d: number) => Math.min(4, Math.max(0, d - TSTART));
const BIG = new Set(['hag', 'wight']);
const packOf = (d: number, id: string) => (BIG.has(id) ? 1 : id === 'wisp' ? Math.min(2, d >= 4 ? 2 : 1) : d >= 6 ? 3 : d >= 4 ? 2 : 1); // the largest packs
const plan = [[1, '', 1], [3, '', 2], [5, '+1', 4], [7, '+2', 5], [10, '+3', 7], [13, '+3', 8], [15, '+3', 8]] as const;
for (const [L, t, danger] of plan) {
  const attrs = { ...A, str: A.str + (BARE ? 0 : [4, 8, 12].filter((n) => L >= n).length) };
  const p = createPlayer('X', 'warrior', 0, attrs);
  p.level = L;
  if (!BARE) {
    p.perks = PERK_PICKS.filter(([n]) => L >= n).map(([, id]) => id);
    p.trained = { attack: Math.floor((L - 1) / 2), defense: Math.ceil((L - 1) / 2) };
  }
  p.maxHp = 11 + (L - 1) * 6.5 | 0;
  for (const id of [`sword${t}`, `chain${t}`, `shield${t}`]) { addItem(p, id as never); equipItem(p, id as never); }
  const tier = tierOf(danger);
  const top = Math.min(5, danger);
  const kinds = (Object.keys(MONSTERS) as MonsterId[]).filter((k) => k !== 'boss' && MONSTERS[k].level <= top && MONSTERS[k].level >= top - 2);
  const row: string[] = [];
  for (const id of kinds) {
    const m = MONSTERS[id];
    const n = packOf(danger, id);
    let won = 0, lost = 0; const N = 1500;
    for (let i = 0; i < N; i++) {
      let hp = p.maxHp;
      let secondWind = hasPerk(p, 'secondwind');
      const foes = Array.from({ length: n }, () => Math.round(rng.dice(m.hp[0], m.hp[1], m.hp[2]) * (1 + tier * HPK)));
      let tt = 0;
      while (hp > 0 && foes.length && tt < 300) {
        tt++;
        const r = rng.dice(1, 20);
        if (r === 20 || (r !== 1 && r + attackBonus(p) >= m.defense + tier * DEF)) { const [a, s] = weaponDice(p); foes[0] -= Math.max(1, rng.dice(a, s) + (BARE ? 0 : mod(p.attrs.str)) + damageBonus(p)); if (foes[0] <= 0) foes.shift(); }
        // only 2 can reach you at once on average in corridors/open ground: let all attack
        for (let k = 0; k < foes.length; k++) {
          const r2 = rng.dice(1, 20);
          if (r2 === 20 || (r2 !== 1 && r2 + m.attack + tier * ATK >= defense(p))) {
            let dmg = Math.max(1, rng.dice(m.dmg[0], m.dmg[1], m.dmg[2] + tier * DMG)) * (r2 === 20 ? 2 : 1);
            if (hasPerk(p, 'ironhide')) dmg = Math.max(1, dmg - 1);
            hp -= dmg;
            if (hp > 0 && hp < p.maxHp / 4 && secondWind) { secondWind = false; hp += Math.floor(p.maxHp / 2); }
          }
        }
      }
      if (hp > 0) { won++; lost += p.maxHp - hp; }
    }
    row.push(`${m.name.split(' ').pop()!.slice(0, 6)}x${n} ${(lost / Math.max(1, won) / p.maxHp * 100).toFixed(0)}%${won < N ? ` (dies ${((1 - won / N) * 100).toFixed(0)}%)` : ''}`);
  }
  console.log(`L${L} hp${p.maxHp} def${defense(p)} danger${danger} tier${tier}: ${row.join(' | ')}`);
}
