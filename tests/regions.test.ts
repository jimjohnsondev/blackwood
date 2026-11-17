import { describe, expect, it } from 'vitest';
import { Game, type Actor } from '../src/game/game';
import { ITEMS } from '../src/game/items';
import { attackBonus, defense, magic, sneak } from '../src/game/player';
import { T } from '../src/game/terrain';
import { buildLevel } from '../src/gen/levels';
import { dangerAt, LANDMARKS, regionAt, VALE_RADIUS } from '../src/gen/regions';
import { generateWorld } from '../src/gen/world';

const ATTRS = { str: 12, dex: 12, wis: 12, con: 12 };
const newGame = (seed = 'REGION-1', cls: 'warrior' | 'thief' | 'wizard' = 'warrior') =>
  new Game({ name: 'TESTER', cls, scheme: 0, attrs: ATTRS, seed });
type Inner = {
  spawnMonster(k: string, x: number, y: number): Actor;
  goOverworld(): void;
  onEnter(x: number, y: number, t: number): boolean;
};
const inner = (g: Game) => g as unknown as Inner;

describe('regions', () => {
  const w = generateWorld('REGION-1');

  it('the continent is bigger, with the Vale in the middle and five lands around it', () => {
    expect(w.size).toBe(384);
    expect(w.regions.map((r) => r.type).sort()).toEqual(['ashwood', 'blight', 'downs', 'fenlands', 'highlands', 'vale']);
    expect(regionAt(w, w.size / 2, w.size / 2).type).toBe('vale');
    // Every region actually holds land.
    for (const r of w.regions) {
      let land = 0;
      for (let i = 0; i < w.size * w.size; i++) if (w.regionOf[i] === r.id && w.tiles[i] !== T.Ocean) land++;
      expect(land, r.name).toBeGreaterThan(1000);
    }
  });

  it('each region looks like itself', () => {
    const share = (type: string, tiles: T[]) => {
      const r = w.regions.find((x) => x.type === type)!;
      let n = 0, all = 0;
      for (let i = 0; i < w.size * w.size; i++) {
        if (w.regionOf[i] !== r.id || w.tiles[i] === T.Ocean) continue;
        all++;
        if (tiles.includes(w.tiles[i] as T)) n++;
      }
      return n / all;
    };
    expect(share('fenlands', [T.Mire])).toBeGreaterThan(share('downs', [T.Mire]));
    expect(share('highlands', [T.Hills, T.Mountain])).toBeGreaterThan(share('downs', [T.Hills, T.Mountain]));
    expect(share('blight', [T.DeadWood, T.RedPeak])).toBeGreaterThan(share('fenlands', [T.DeadWood, T.RedPeak]));
  });

  it('danger rises with distance from the Vale, and more in the Blight', () => {
    const c = w.size / 2;
    expect(dangerAt(w, c, c)).toBe(1);
    expect(dangerAt(w, c + VALE_RADIUS + 60, c)).toBeGreaterThan(dangerAt(w, c + VALE_RADIUS, c));
    const blight = w.regions.find((r) => r.type === 'blight')!;
    const other = w.regions.find((r) => r.type === 'downs')!;
    const d = (r: { x: number; y: number }) => Math.round(Math.hypot(r.x - c, r.y - c));
    // Compare at the same distance out: the Blight is one step worse.
    const at = (r: { x: number; y: number }) => {
      const k = d(blight) / d(r);
      return dangerAt(w, Math.round(c + (r.x - c) * k), Math.round(c + (r.y - c) * k));
    };
    expect(at(blight)).toBeGreaterThanOrEqual(at(other));
  });
});

describe('danger', () => {
  it('far from the Vale, monsters come in stronger forms', () => {
    const g = newGame();
    inner(g).goOverworld();
    const near = inner(g).spawnMonster('wolf', g.player.x, g.player.y + 1);
    const S = g.world.size;
    let far = { x: 0, y: 0 };
    for (let i = 0; i < S * S; i++) if (dangerAt(g.world, i % S, Math.floor(i / S)) >= 7) { far = { x: i % S, y: Math.floor(i / S) }; break; }
    const dread = inner(g).spawnMonster('wolf', far.x, far.y);
    expect(near.name).toBe('WOLF');
    expect(dread.tier).toBeGreaterThanOrEqual(3);
    expect(dread.name).toMatch(/^(ELDER|DREAD) WOLF$/);
  });

  it('the Stats page names the region and the danger', () => {
    const g = newGame();
    inner(g).goOverworld();
    expect(g.placeName()).toBe('THE VALE');
    expect(g.dangerWord()).toBe('SAFE');
  });
});

describe('landmarks', () => {
  it('each holds its region\'s treasure, locked and guarded', () => {
    const w = generateWorld('REGION-2');
    for (const site of w.sites.filter((s) => s.kind === 'landmark')) {
      const level = buildLevel(w, site);
      const chest = level.chests.find((c) => c.id === `unique:${site.id}`)!;
      expect(chest, site.name).toBeTruthy();
      expect(chest.locked).toBe(true);
      const type = w.regions[site.region].type as keyof typeof LANDMARKS;
      expect(chest.loot[0].item).toBe(LANDMARKS[type].unique);
      const guards = level.monsters.filter((m) => Math.abs(m.x - chest.x) + Math.abs(m.y - chest.y) <= 2);
      expect(guards.length, site.name).toBeGreaterThan(0);
    }
  });

  it('the treasures are the best there is, and more', () => {
    const g = newGame('REGION-1', 'wizard');
    const mg = magic(g.player);
    g.player.inventory.push({ id: 'starfall', count: 1 });
    g.useItem('starfall');
    expect(magic(g.player)).toBe(mg + 2);
    expect(ITEMS.starfall.bonus).toBe(3);

    const t = newGame('REGION-1', 'thief');
    const sn = sneak(t.player);
    t.player.inventory.push({ id: 'mireshroud', count: 1 });
    t.useItem('mireshroud');
    expect(sneak(t.player)).toBe(sn + 2);

    const k = newGame('REGION-1', 'warrior');
    const at = attackBonus(k.player), df = defense(k.player);
    k.player.inventory.push({ id: 'gravebreaker', count: 1 }, { id: 'lostshield', count: 1 });
    k.useItem('gravebreaker');
    k.useItem('lostshield');
    expect(attackBonus(k.player)).toBe(at + 4);
    expect(defense(k.player)).toBe(df + 4);
  });
});

describe('horses', () => {
  it('bought in a village, waits outside, and is ridden out', () => {
    const g = newGame();
    g.player.gold = 500;
    g.buy('horse');
    expect(g.player.gold).toBe(350);
    expect(g.player.horse).toEqual({ at: g.hereSite().id });
    expect(g.player.inventory.some((s) => s.id === 'horse')).toBe(false);
    inner(g).goOverworld();
    expect(g.mounted()).toBe(true);
  });

  it('two steps a turn along a road, one off it', () => {
    const g = newGame();
    g.player.horse = { at: null };
    inner(g).goOverworld();
    const S = g.world.size;
    // Find a straight stretch of road three tiles long.
    let start: { x: number; y: number; dir: 'right' } | null = null;
    for (let i = 0; i < S * S && !start; i++) {
      const x = i % S, y = Math.floor(i / S);
      if ([0, 1, 2, 3].every((k) => g.world.tiles[y * S + x + k] === T.Road)) start = { x, y, dir: 'right' };
    }
    expect(start).toBeTruthy();
    g.actors = [];
    g.player.x = start!.x; g.player.y = start!.y;
    const turn = g.turn;
    g.move('right');
    expect(g.player.x).toBe(start!.x + 2);
    expect(g.turn).toBe(turn + 1);
  });

  it('stays outside a place you enter, and you ride on when you leave', () => {
    const g = newGame();
    g.player.horse = { at: null };
    inner(g).goOverworld();
    const shrine = g.world.sites.find((s) => s.kind === 'shrine' && s.vale)!;
    g.player.x = shrine.x; g.player.y = shrine.y + 1;
    inner(g).onEnter(shrine.x, shrine.y, T.Site);
    expect(g.player.horse!.at).toBe(shrine.id);
    expect(g.mounted()).toBe(false);
    inner(g).goOverworld();
    expect(g.mounted()).toBe(true);
  });

  it('only one horse at a time', () => {
    const g = newGame();
    g.player.gold = 500;
    g.buy('horse');
    g.buy('horse');
    expect(g.player.gold).toBe(350);
  });
});

describe('older saves', () => {
  it('a save from before the world grew is refused', () => {
    const g = newGame();
    const raw = JSON.parse(g.toSave());
    raw.v = 1;
    expect(() => Game.fromSave(JSON.stringify(raw))).toThrow();
    expect(() => Game.fromSave(g.toSave())).not.toThrow();
  });
});
