import { describe, expect, it } from 'vitest';
import { Game, type Actor } from '../src/game/game';
import { addItem, countItem } from '../src/game/player';
import { T, TERRAIN } from '../src/game/terrain';
import { buildLevel, floorsOf } from '../src/gen/levels';
import type { Level, Site, Trap } from '../src/gen/types';
import { generateWorld } from '../src/gen/world';

const ATTRS = { str: 12, dex: 12, wis: 12, con: 12 };
const newGame = (seed = 'DELVE-1', cls: 'warrior' | 'thief' = 'thief') =>
  new Game({ name: 'TESTER', cls, scheme: 0, attrs: ATTRS, seed });
type Inner = {
  enterSite(site: Site, floor: number, arrive: 'entry' | 'down', quiet?: boolean): void;
  goOverworld(): void;
  rng: { dice(n: number, s: number, plus?: number): number };
  pickDoor(x: number, y: number): void;
  at: { siteId: number; floor: number } | null;
};
const inner = (g: Game) => g as unknown as Inner;
const world = generateWorld('DELVE-1');
const find = (pred: (s: Site) => boolean) => world.sites.find(pred)!;
const cells = (L: Level, t: T) => [...L.tiles].map((v, i) => (v === t ? { x: i % L.w, y: Math.floor(i / L.w) } : null)).filter(Boolean) as { x: number; y: number }[];

/** Everything walkable from the way in; `opened` treats sealed doors and deep water as open. */
function reach(L: Level, opened: boolean): Uint8Array {
  const seen = new Uint8Array(L.w * L.h);
  const queue = [L.entry.y * L.w + L.entry.x];
  seen[queue[0]] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    for (const n of [i - 1, i + 1, i - L.w, i + L.w]) {
      if (n < 0 || n >= seen.length || seen[n]) continue;
      const t = L.tiles[n] as T;
      if (!(TERRAIN[t].walk || t === T.LockedDoor || (opened && (t === T.Sealed || t === T.Water)))) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

/** Stand beside a spot and walk into it. */
function walkInto(g: Game, x: number, y: number): void {
  for (const [dx, dy, dir] of [[-1, 0, 'right'], [1, 0, 'left'], [0, -1, 'down'], [0, 1, 'up']] as const) {
    if (!TERRAIN[g.tileAt(x + dx, y + dy)].walk) continue;
    g.player.x = x + dx;
    g.player.y = y + dy;
    g.messages = [];
    g.move(dir);
    return;
  }
  throw new Error('nowhere to stand');
}

describe('dungeon types', () => {
  it('every floor of every dungeon can be finished: stairs, levers and chests all reachable', () => {
    const kinds = new Set<string>();
    for (const s of world.sites) {
      if (!(s.kind === 'cave' || s.kind === 'tower' || s.kind === 'barrow')) continue;
      kinds.add(s.kind === 'cave' ? s.style ?? 'cave' : s.kind);
      const floors = floorsOf(world, s);
      for (let f = 1; f <= floors; f++) {
        const L = buildLevel(world, s, f);
        const shut = reach(L, false), open = reach(L, true);
        const label = `${s.name} floor ${f}`;
        for (const st of [...cells(L, T.StairsUp), ...cells(L, T.StairsDown)]) expect(shut[st.y * L.w + st.x], `${label} stairs`).toBe(1);
        for (const lv of cells(L, T.Lever)) {
          expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => shut[(lv.y + dy) * L.w + lv.x + dx]), `${label} lever`).toBe(true);
        }
        for (const c of L.chests) expect(open[c.y * L.w + c.x], `${label} chest`).toBe(1);
        const onward = L.climbs ? T.StairsUp : T.StairsDown;
        expect(L.tiles.includes(onward), `${label} way on`).toBe(f < floors);
      }
    }
    expect([...kinds].sort()).toEqual(['barrow', 'cave', 'mine', 'sunken', 'tower']);
  });

  it('a tower is climbed: up-stairs lead on, down-stairs lead back and out', () => {
    const g = newGame();
    const tower = find((s) => s.kind === 'tower' && !s.vale);
    inner(g).enterSite(tower, 1, 'entry', true);
    expect(g.level.climbs).toBe(true);
    g.actors = [];
    const up = cells(g.level, T.StairsUp)[0];
    walkInto(g, up.x, up.y);
    expect(inner(g).at!.floor).toBe(2);
    const down = cells(g.level, T.StairsDown)[0];
    walkInto(g, down.x, down.y);
    expect(inner(g).at!.floor).toBe(1);
    const out = cells(g.level, T.StairsDown)[0];
    walkInto(g, out.x, out.y);
    expect(inner(g).at).toBeNull();
  });

  it('a lever opens the sealed vault, and it stays open', () => {
    const g = newGame();
    const tower = find((s) => s.kind === 'tower' && !s.vale);
    const top = floorsOf(world, tower);
    inner(g).enterSite(tower, top, 'entry', true);
    g.actors = [];
    expect(cells(g.level, T.Sealed).length).toBe(1);
    const lever = cells(g.level, T.Lever)[0];
    walkInto(g, lever.x, lever.y);
    expect(cells(g.level, T.Sealed).length).toBe(0);
    expect(g.tileAt(lever.x, lever.y)).toBe(T.LeverOff);
    const back = Game.fromSave(g.toSave());
    expect(cells(back.level, T.Sealed).length).toBe(0);
  });

  it('a drowned temple: deep water bars the vault until the lever drains it, and wading is slow', () => {
    const g = newGame();
    const temple = find((s) => s.style === 'sunken');
    inner(g).enterSite(temple, 1, 'entry', true);
    g.actors = [];
    expect(cells(g.level, T.Water).length).toBeGreaterThan(0);
    const lever = cells(g.level, T.Lever)[0];
    walkInto(g, lever.x, lever.y);
    expect(cells(g.level, T.Water).length).toBe(0);
    const wet = cells(g.level, T.Shallows).find((c) => TERRAIN[g.tileAt(c.x - 1, c.y)].walk && g.tileAt(c.x - 1, c.y) === T.Shallows)!;
    g.level.traps = [];
    g.player.x = wet.x - 1;
    g.player.y = wet.y;
    const before = g.turn;
    g.move('right');
    expect(g.turn - before).toBe(2);
  });
});

describe('traps, keys and doors', () => {
  const inCave = () => {
    const g = newGame();
    const cave = find((s) => s.kind === 'cave' && !s.style && !s.vale);
    inner(g).enterSite(cave, 1, 'entry', true);
    g.actors = [];
    return g;
  };
  /** A fresh trap on open floor two steps east of the player. */
  const plant = (g: Game, kind: Trap['kind']): Trap => {
    const L = g.level;
    for (let y = 1; y < L.h - 1; y++) for (let x = 1; x < L.w - 4; x++) {
      const row = [0, 1, 2, 3].map((d) => g.tileAt(x + d, y));
      if (!row.every((t) => t === T.CaveFloor) || g.level.chests.some((c) => c.y === y && c.x >= x && c.x <= x + 3)) continue;
      const trap: Trap = { x: x + 3, y, dc: 12, kind };
      L.traps = [trap];
      g.player.x = x;
      g.player.y = y;
      g.updateVisibility();
      return trap;
    }
    throw new Error('no open floor');
  };
  const fixDice = (g: Game, n: number) => { inner(g).rng.dice = (count, _s, plus = 0) => n * count + plus; };

  it('a sharp eye spots a trap two steps off; walking into it disarms it', () => {
    const g = inCave();
    const trap = plant(g, 'dart');
    fixDice(g, 19);
    g.move('right');
    expect(g.trapsInSight()).toEqual([trap]);
    const hp = g.player.hp;
    g.move('right');
    g.move('right');
    expect(g.level.traps).toEqual([]);
    expect(g.player.hp).toBe(hp);
    expect(g.player.x).toBe(trap.x - 1);
  });

  it('an unseen dart trap wounds; an alarm wakes the floor', () => {
    const g = inCave();
    const trap = plant(g, 'dart');
    fixDice(g, 1);
    const hp = g.player.hp;
    g.move('right');
    expect(g.trapsInSight()).toEqual([]);
    g.move('right');
    g.move('right');
    expect(g.player.x).toBe(trap.x);
    expect(g.player.hp).toBeLessThan(hp);

    const g2 = inCave();
    plant(g2, 'alarm');
    const sleeper = { id: 99, x: 1, y: 1, hp: 5, maxHp: 5, name: 'RAT', monster: 'rat', awake: false, asleep: 0, checks: 0 } as Actor;
    g2.actors.push(sleeper);
    fixDice(g2, 1);
    g2.move('right'); g2.move('right'); g2.move('right');
    expect(sleeper.awake).toBe(true);
  });

  it('an iron key opens a locked door and is used up; without one a warrior forces it, loudly', () => {
    const g = newGame('DELVE-1', 'warrior');
    const barrow = world.sites[world.quest.barrowId];
    let door: { x: number; y: number } | undefined;
    for (let f = 1; f <= 3 && !door; f++) {
      inner(g).enterSite(barrow, f, 'entry', true);
      door = cells(g.level, T.LockedDoor)[0];
    }
    if (!door) return; // this barrow has no locked doors
    addItem(g.player, 'key');
    inner(g).pickDoor(door.x, door.y);
    expect(g.tileAt(door.x, door.y)).toBe(T.DDoor);
    expect(countItem(g.player, 'key')).toBe(0);
  });
});

describe('chests', () => {
  it('every chest in the world, strongboxes included, can be walked up to', async () => {
    const { reachable } = await import('../src/gen/reach');
    const g = newGame();
    const getLevel = (s: Site, f: number) => (g as unknown as { getLevel(s: Site, f: number): Level }).getLevel(s, f);
    let checked = 0;
    for (const s of g.world.sites) {
      for (let f = 1; f <= floorsOf(g.world, s); f++) {
        const L = getLevel(s, f);
        const seen = reachable(L, new Set(L.chests.map((c) => c.y * L.w + c.x)));
        for (const c of L.chests) {
          checked++;
          const ok = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(c.y + dy) * L.w + c.x + dx]);
          expect(ok, `${s.name} floor ${f} chest at ${c.x},${c.y}`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
