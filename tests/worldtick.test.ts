import { describe, expect, it } from 'vitest';
import { Game, type Actor } from '../src/game/game';
import { seasonOf } from '../src/game/calendar';
import { generateWorld } from '../src/gen/world';
import { caravanAt, caravans } from '../src/sim/caravans';
import {
  catchUp, clearLair, hamletStatus, lairSites, newWorldState, RAIDED_DAYS, RECOVER_DAYS, recentEvents,
} from '../src/sim/world';

const ATTRS = { str: 12, dex: 12, wis: 12, con: 12 };
const newGame = (seed = 'TICK-1') => new Game({ name: 'TESTER', cls: 'warrior', scheme: 0, attrs: ATTRS, seed });

describe('the world tick', () => {
  const w = generateWorld('TICK-1');

  it('is the same every time for the same seed', () => {
    const a = newWorldState(w), b = newWorldState(w);
    catchUp(w, a, 120);
    catchUp(w, b, 60);
    catchUp(w, b, 120);
    expect(a).toEqual(b);
  });

  it('a whole year runs quickly, and lairs raid hamlets', () => {
    const s = newWorldState(w);
    const t0 = performance.now();
    catchUp(w, s, 366);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(lairSites(w).length).toBeGreaterThan(0);
    const all = newWorldState(w);
    const kinds = new Set<string>();
    for (let d = 2; d <= 366; d++) {
      catchUp(w, all, d);
      for (const e of all.events) kinds.add(e.kind);
    }
    expect(kinds.has('season')).toBe(true);
    expect(kinds.has('gather')).toBe(true);
    expect(kinds.has('raid')).toBe(true);
  });

  it('a raided hamlet is raided, then recovers, then is fine', () => {
    const s = newWorldState(w);
    s.raids[5] = 10;
    expect(hamletStatus(s, 5, 10)).toBe('raided');
    expect(hamletStatus(s, 5, 10 + RAIDED_DAYS)).toBe('recovering');
    expect(hamletStatus(s, 5, 10 + RAIDED_DAYS + RECOVER_DAYS)).toBe(null);
  });

  it('clearing a lair quiets it and makes news', () => {
    const s = newWorldState(w);
    const lair = lairSites(w)[0];
    s.lairs[lair.id] = 9;
    clearLair(w, s, lair, 3);
    expect(s.lairs[lair.id]).toBe(0);
    expect(recentEvents(s, 3)[0].kind).toBe('cleared');
  });

  it('seasons follow the months', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 360; d++) seen.add(seasonOf('TICK-1', d));
    expect([...seen].sort()).toEqual(['autumn', 'spring', 'summer', 'winter']);
  });
});

describe('caravans', () => {
  const w = generateWorld('TICK-1');

  it('travel along roads, rest at each end, and come back', () => {
    const cs = caravans(w);
    expect(cs.length).toBe(3);
    const c = cs[0];
    let moving = 0, resting = 0;
    for (let t = 0; t < 1440 * 20; t += 30) {
      const at = caravanAt(c, t);
      if (at) {
        moving++;
        expect(c.route.some((r) => r.x === at.x && r.y === at.y)).toBe(true);
      } else resting++;
    }
    expect(moving).toBeGreaterThan(0);
    expect(resting).toBeGreaterThan(0);
  });

  it('a trader appears nearby on the map and sells road goods', () => {
    const g = newGame();
    const c = caravans(g.world)[0];
    let t = g.time;
    while (!caravanAt(c, t)) t += 30;
    const at = caravanAt(c, t)!;
    g.time = t;
    (g as unknown as { goOverworld(): void }).goOverworld();
    g.player.x = at.x + 2;
    g.player.y = at.y;
    (g as unknown as { syncCaravans(): void }).syncCaravans();
    const trader = g.actors.find((a: Actor) => a.caravan === c.id);
    expect(trader?.npc?.role).toBe('trader');
    g.shopFrom = 'trader';
    expect(g.shopStock()).toContain('tome-hold');
  });
});

describe('winter', () => {
  it('raises shop prices', () => {
    const g = newGame();
    let summer = 1, winter = 1;
    while (seasonOf(g.world.seed, summer) !== 'summer') summer++;
    while (seasonOf(g.world.seed, winter) !== 'winter') winter++;
    const priceOn = (day: number) => {
      g.time = (day - 1) * 1440 + 9 * 60;
      return g.shopPrice('sword');
    };
    expect(priceOn(winter)).toBeGreaterThan(priceOn(summer));
  });
});

describe('talk in a raided hamlet', () => {
  it('is all about the raid, points to the lair, and thanks you once it is cleared', () => {
    const g = newGame('RAID');
    const inner = g as unknown as { talk(a: Actor): void; goOverworld(): void; onEnter(x: number, y: number, t: number): boolean };
    g.setupRaidDemo();
    const h = g.world.sites.find((s) => g.siteStatus(s.id) === 'raided')!;
    const lair = g.world.sites[g.worldState.raidedBy![h.id]];
    const enter = () => { inner.goOverworld(); inner.onEnter(h.x, h.y, 10); g.messages = []; };
    enter();
    const v = g.actors.find((a) => a.npc?.role === 'villager')!;
    expect(g.askable(v)[0]).toBe('raid');
    g.askAbout(v, 'raid');
    expect(g.messages.map((m) => m.lines.join(' ')).join(' ')).toContain(lair.name);
    expect(g.heardOf.has(lair.id)).toBe(true);
    clearLair(g.world, g.worldState, lair, g.day);
    enter();
    const v2 = g.actors.find((a) => a.npc?.role === 'villager')!;
    inner.talk(v2);
    expect(g.choice?.text).not.toMatch(/ARE THEY COMING BACK|EVERYTHING I HAD/);
  });
});

describe('how monsters fight', () => {
  type Fight = { monstersAct(): void; goOverworld(): void; rng: { dice(n: number, s: number, p?: number): number; chance(p: number): boolean } };
  const arena = () => {
    const g = newGame('FIGHT-1');
    const f = g as unknown as Fight;
    f.goOverworld();
    g.actors = [];
    g.messages = [];
    return { g, f };
  };
  const foe = (g: Game, kind: string, dx: number, hp = 10): Actor => {
    const a = { id: 500 + g.actors.length, x: g.player.x + dx, y: g.player.y, hp, maxHp: 10, name: kind.toUpperCase(), monster: kind, awake: true, asleep: 0, checks: 2 } as Actor;
    g.actors.push(a);
    return a;
  };

  it('a badly hurt goblin runs; a healthy one closes in', () => {
    const { g, f } = arena();
    const hurt = foe(g, 'goblin', 3, 2);
    f.monstersAct();
    expect(Math.abs(hurt.x - g.player.x) + Math.abs(hurt.y - g.player.y)).toBeGreaterThanOrEqual(3);
    const { g: g2, f: f2 } = arena();
    const fresh = foe(g2, 'goblin', 3);
    f2.monstersAct();
    expect(Math.abs(fresh.x - g2.player.x) + Math.abs(fresh.y - g2.player.y)).toBeLessThan(3);
  });

  it("a wolf's howl wakes the pack, once", () => {
    const { g, f } = arena();
    const wolf = foe(g, 'wolf', 4);
    const other = foe(g, 'rat', 7);
    other.awake = false;
    f.monstersAct();
    expect(wolf.called).toBe(true);
    expect(other.awake).toBe(true);
  });

  it('a bandit with a clear shot looses an arrow from a distance', () => {
    const { g, f } = arena();
    g.updateVisibility();
    const bandit = foe(g, 'bandit', 3);
    if (!g.isVisible(bandit.x, bandit.y)) return; // something in the way on this map
    f.rng.chance = () => true;
    f.rng.dice = () => 20;
    g.player.hp = g.player.maxHp = 500;
    const hp = g.player.hp;
    f.monstersAct();
    expect(bandit.x).toBe(g.player.x + 3);
    expect(g.player.hp).toBeLessThan(hp);
  });
});

describe('save slots', () => {
  it('three slots keep three separate games', () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    for (const slot of [1, 2, 3]) {
      Game.slot = slot;
      const g = new Game({ name: `HERO${slot}`, cls: 'warrior', scheme: 0, attrs: ATTRS, seed: `SLOT-${slot}` });
      g.save();
    }
    expect([1, 2, 3].map((n) => Game.slotInfo(n)?.name)).toEqual(['HERO1', 'HERO2', 'HERO3']);
    expect(Game.load(2)?.world.seed).toBe('SLOT-2');
    expect(Game.slot).toBe(2);
    Game.deleteSave(2);
    expect(Game.slotInfo(2)).toBeNull();
    expect(Game.slotInfo(3)?.line).toBe('L1 WARRIOR  DAY 1');
    Game.slot = 1;
  });
});
