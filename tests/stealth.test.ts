import { describe, expect, it } from 'vitest';
import { Game, type Actor } from '../src/game/game';
import { sneak } from '../src/game/player';
import type { ClassId } from '../src/game/rules';
import { T } from '../src/game/terrain';

const ATTRS = { str: 12, dex: 14, wis: 12, con: 12 };

function field(cls: ClassId = 'thief'): Game {
  const g = new Game({ name: 'TESTER', cls, scheme: 0, attrs: ATTRS, seed: 'STEALTH-1' });
  g.actors = g.actors.filter((a) => !a.npc);
  g.level.chests = [];
  const { x, y } = g.player;
  for (let dy = -6; dy <= 6; dy++) for (let dx = -7; dx <= 7; dx++) {
    const tx = x + dx, ty = y + dy;
    if (tx >= 0 && ty >= 0 && tx < g.level.w && ty < g.level.h) g.level.tiles[ty * g.level.w + tx] = T.Cobble;
  }
  g.messages = [];
  return g;
}

type Inner = {
  spawnMonster(k: string, x: number, y: number): Actor;
  meleeAttack(a: Actor): void;
  rng: { dice(n: number, s: number): number };
};
const inner = (g: Game) => g as unknown as Inner;

describe('sneaking', () => {
  it('SNEAK adds 5 to stealth; night outdoors adds 3 more', () => {
    const g = field();
    g.time = 12 * 60;
    const base = g.stealth();
    expect(base).toBe(sneak(g.player));
    g.toggleSneak();
    expect(g.stealth()).toBe(base + 5);
    g.time = 23 * 60;
    expect(g.stealth()).toBe(base + 8);
  });

  it('underground, being outside your light helps', () => {
    const g = field();
    const q = g.world.quest;
    (g as unknown as { enterSite(s: unknown, f: number, e: string): void }).enterSite(g.world.sites[q.barrowId], 1, 'entry');
    const p = g.player;
    expect(g.stealth({ x: p.x + 1, y: p.y })).toBe(sneak(p));
    expect(g.stealth({ x: p.x + 9, y: p.y })).toBe(sneak(p) + 3);
  });

  it('is slow: each step lets the world take two turns', () => {
    const g = field();
    const t = g.turn;
    g.move('down');
    const normal = g.turn - t;
    g.toggleSneak();
    const t2 = g.turn;
    g.move('up');
    expect(g.turn - t2).toBe(normal * 2);
  });

  it('ends when you attack', () => {
    const g = field();
    g.toggleSneak();
    const rat = inner(g).spawnMonster('rat', g.player.x + 1, g.player.y);
    inner(g).meleeAttack(rat);
    expect(g.player.sneaking).toBe(false);
  });

  it('lets a thief slip past a monster far more often', () => {
    const tries = (sneaking: boolean) => {
      let unseen = 0;
      for (let i = 0; i < 300; i++) {
        const g = field();
        g.time = 12 * 60;
        if (sneaking) g.toggleSneak();
        const { x, y } = g.player;
        const wolf = inner(g).spawnMonster('wolf', x + 5, y);
        g.move('up');
        g.move('down');
        if (!wolf.awake) unseen++;
      }
      return unseen;
    };
    expect(tries(true)).toBeGreaterThan(tries(false) + 30);
  });

  it('keeps a high-level thief from being invisible to dangerous monsters', () => {
    const spotted = (kind: string) => {
      let seen = 0;
      for (let i = 0; i < 100; i++) {
        const g = field();
        g.time = 12 * 60;
        g.player.level = 6;
        g.toggleSneak();
        const { x, y } = g.player;
        const m = inner(g).spawnMonster(kind, x + 5, y);
        g.move('up');
        g.move('down');
        if (m.awake) seen++;
      }
      return seen;
    };
    expect(spotted('rat')).toBe(0);
    expect(spotted('wight')).toBeGreaterThan(5);
  });
});

describe('backstab and ambush', () => {
  it('a thief doubles the weapon dice in melee against a monster that has not seen them', () => {
    const g = field();
    inner(g).rng.dice = (n: number, s: number) => (s === 20 ? 15 : n * 3);
    const rat = inner(g).spawnMonster('rat', g.player.x + 1, g.player.y);
    rat.hp = rat.maxHp = 100;
    inner(g).meleeAttack(rat);
    const first = 100 - rat.hp;
    expect(g.messages.some((m) => m.lines.join(' ').includes('BACKSTAB!'))).toBe(true);
    inner(g).meleeAttack(rat); // now it has seen you
    const second = 100 - first - rat.hp;
    // The short sword's die rolled 3 both times: the backstab adds one more die, not the bonuses.
    expect(first - second).toBe(3);
  });

  it('a backstab does not stack with a critical', () => {
    const g = field();
    inner(g).rng.dice = (n: number, s: number) => (s === 20 ? 20 : n * 3);
    const rat = inner(g).spawnMonster('rat', g.player.x + 1, g.player.y);
    rat.hp = rat.maxHp = 100;
    inner(g).meleeAttack(rat);
    const backstab = 100 - rat.hp;
    expect(g.messages.some((m) => m.lines.join(' ').includes('CRITICAL!'))).toBe(false);
    inner(g).meleeAttack(rat); // seen now: a plain critical doubles everything
    const crit = 100 - backstab - rat.hp;
    expect(crit % 2).toBe(0);
    expect(backstab).toBe(crit / 2 + 3);
  });

  it('hitting one monster alerts the others that can see it, but not sleepers', () => {
    const g = field();
    inner(g).rng.dice = (n: number, s: number) => (s === 20 ? 15 : n);
    const { x, y } = g.player;
    const rat = inner(g).spawnMonster('rat', x + 1, y);
    rat.hp = rat.maxHp = 100;
    const near = inner(g).spawnMonster('rat', x + 3, y);
    const sleeper = inner(g).spawnMonster('rat', x + 3, y + 1);
    sleeper.asleep = 5;
    const far = inner(g).spawnMonster('rat', x - 6, y + 6);
    for (const a of [near, sleeper, far]) a.awake = false;
    inner(g).meleeAttack(rat);
    expect(near.awake).toBe(true);
    expect(sleeper.awake).toBe(false);
    expect(far.awake).toBe(false);
  });

  it('a thief’s arrow at an unaware monster is an ambush: double damage', () => {
    const g = field();
    inner(g).rng.dice = (n: number, s: number) => (s === 20 ? 15 : n * 3);
    const wolf = inner(g).spawnMonster('wolf', g.player.x + 4, g.player.y);
    wolf.hp = wolf.maxHp = 100;
    g.useQuick('bow', wolf);
    expect(100 - wolf.hp).toBe(6);
    expect(g.messages.some((m) => m.lines.join(' ').includes('AMBUSH!'))).toBe(true);
    g.useQuick('bow', wolf);
    expect(100 - wolf.hp).toBe(9);
  });

  it('the wizard’s spark gets no ambush bonus', () => {
    const g = field('wizard');
    inner(g).rng.dice = (n: number, s: number) => (s === 20 ? 15 : n * 3);
    const wolf = inner(g).spawnMonster('wolf', g.player.x + 4, g.player.y);
    wolf.hp = wolf.maxHp = 100;
    g.useQuick('spark', wolf);
    expect(g.messages.some((m) => m.lines.join(' ').includes('AMBUSH!'))).toBe(false);
  });
});
