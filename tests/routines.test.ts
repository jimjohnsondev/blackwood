import { describe, expect, it } from 'vitest';
import { Game, type Actor } from '../src/game/game';
import { stepTowards, WATCHES } from '../src/game/routines';
import { T, TERRAIN } from '../src/game/terrain';

const ATTRS = { str: 12, dex: 12, wis: 12, con: 12 };
const newGame = (seed = 'ROUTINE-1') => new Game({ name: 'TESTER', cls: 'thief', scheme: 0, attrs: ATTRS, seed });
type Inner = {
  endTurn(): void;
  talk(a: Actor): void;
  openChest(c: unknown): void;
  enterSite(s: unknown, f: number, e: string): void;
  rng: { dice(n: number, s: number): number };
};
const inner = (g: Game) => g as unknown as Inner;
const folk = (g: Game) => g.actors.filter((a) => a.npc);
const who = (g: Game, role: string) => folk(g).find((a) => a.npc!.role === role)!;

/** Jump the clock to an hour of today and let everyone settle there. */
function setHour(g: Game, hour: number): void {
  g.time = Math.floor(g.time / 1440) * 1440 + hour * 60;
  g.snapNpcs();
}

/** Walk everyone towards where they should be, one turn at a time. */
function turns(g: Game, n: number): void {
  for (let i = 0; i < n; i++) inner(g).endTurn();
}

describe('daily routines', () => {
  it('every villager can walk to every spot in their day (several worlds)', () => {
    for (const seed of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) {
      const g = newGame(seed);
      const level = g.level;
      for (const a of folk(g)) {
        const r = a.routine!;
        expect(r, `${seed} ${a.name} has a routine`).toBeTruthy();
        for (const w of WATCHES) {
          const s = r.spots[w];
          expect(TERRAIN[level.tiles[s.y * level.w + s.x] as T].walk, `${seed} ${a.name} ${w} spot is walkable`).toBe(true);
          for (const w2 of WATCHES) {
            const t = r.spots[w2];
            if (s.x === t.x && s.y === t.y) continue;
            expect(stepTowards(level, s, t, () => false), `${seed} ${a.name}: ${w} -> ${w2}`).toBeTruthy();
          }
        }
      }
    }
  });

  it('nobody shares a bed', () => {
    const g = newGame();
    const beds = folk(g).filter((a) => a.routine!.sleeps).map((a) => `${a.routine!.spots.night.x},${a.routine!.spots.night.y}`);
    expect(new Set(beds).size).toBe(beds.length);
  });

  it('is the same every time for the same world', () => {
    const a = newGame('SAME-R'), b = newGame('SAME-R');
    expect(folk(a).map((x) => x.routine)).toEqual(folk(b).map((x) => x.routine));
  });

  it('by night the village sleeps; the innkeeper and the guards stay up', () => {
    const g = newGame();
    setHour(g, 23);
    for (const a of folk(g)) {
      const role = a.npc!.role;
      if (role === 'innkeeper' || role === 'guard') expect(a.asleep, a.name).toBe(0);
      else expect(a.asleep, `${a.name} the ${role}`).toBe(1);
    }
  });

  it('in the morning they wake and go back to work', () => {
    const g = newGame();
    setHour(g, 23);
    g.time = Math.floor(g.time / 1440) * 1440 + 1440 + 7 * 60; // next morning
    (g as unknown as { npcClock: number }).npcClock = g.time;
    turns(g, 1);
    expect(folk(g).every((a) => a.asleep === 0)).toBe(true);
  });

  it('at dusk, villagers walk over to the inn', () => {
    const g = newGame('ROUTINE-2');
    setHour(g, 16);
    g.time += 60; // 17:00, evening begins
    (g as unknown as { npcClock: number }).npcClock = g.time;
    const villager = folk(g).find((a) => a.npc!.role === 'villager' && a.routine!.spots.evening !== a.routine!.spots.afternoon)!;
    const seat = villager.routine!.spots.evening;
    const before = Math.abs(villager.x - seat.x) + Math.abs(villager.y - seat.y);
    g.player.x = 1; g.player.y = 1; // out of the way
    turns(g, 80);
    const after = Math.abs(villager.x - seat.x) + Math.abs(villager.y - seat.y);
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(1);
  });

  it('a long rest puts everyone straight where they belong', () => {
    const g = newGame();
    setHour(g, 9);
    g.time += 14 * 60; // 23:00
    turns(g, 1);
    expect(who(g, 'shopkeeper').asleep).toBe(1);
  });
});

describe('opening hours', () => {
  it('the shop trades by day and is shut in the evening', () => {
    const g = newGame();
    setHour(g, 10);
    inner(g).talk(who(g, 'shopkeeper'));
    expect(g.choice!.options.map((o) => o.label)).toContain('TRADE');
    setHour(g, 19);
    inner(g).talk(who(g, 'shopkeeper'));
    expect(g.choice!.options.map((o) => o.label)).not.toContain('TRADE');
    expect(g.choice!.text).toContain('SHUT');
  });

  it('sleepers cannot be talked to', () => {
    const g = newGame();
    setHour(g, 23);
    g.choice = null;
    inner(g).talk(who(g, 'shopkeeper'));
    expect(g.choice).toBeNull();
    expect(g.messages.at(-1)!.lines.join(' ')).toContain('IS ASLEEP');
  });

  it('the inn is always open', () => {
    const g = newGame();
    setHour(g, 2);
    inner(g).talk(who(g, 'innkeeper'));
    expect(g.choice!.options.map((o) => o.label)).toContain('REST THE NIGHT');
  });
});

describe('guards', () => {
  it('villages have two, hamlets one', () => {
    const g = newGame();
    expect(folk(g).filter((a) => a.npc!.role === 'guard').length).toBe(2);
    const hamlet = g.world.sites.find((s) => s.kind === 'hamlet')!;
    inner(g).enterSite(hamlet, 1, 'entry');
    expect(folk(g).filter((a) => a.npc!.role === 'guard').length).toBe(1);
  });

  it('a guard shadows a player the village dislikes', () => {
    const g = newGame();
    setHour(g, 10);
    g.rep[g.hereSite().id] = -3;
    const guard = who(g, 'guard');
    // Walk up the main street.
    for (let i = 0; i < 10; i++) g.move('up');
    const d = Math.abs(guard.x - g.player.x) + Math.abs(guard.y - g.player.y);
    expect(d).toBeLessThanOrEqual(3);
  });

  it('sleepers see no thief; a guard sees further than most', () => {
    const g = newGame();
    const [box1, box2] = g.level.chests.filter((c) => c.owned);
    inner(g).rng.dice = () => 2; // any watcher who can see would notice
    const steal = (box: typeof box1) => {
      box.locked = false;
      g.player.x = box.x; g.player.y = box.y;
      g.stealOk.add(box.id); // already said yes to stealing
      inner(g).openChest(box);
    };
    for (const a of folk(g)) { a.x = 0; a.y = 0; }
    const clear = (x: number, y: number) => { g.level.tiles[y * g.level.w + x] = T.Cobble; };

    // A sleeper right beside you sees nothing.
    const sleeper = who(g, 'villager');
    sleeper.x = box1.x + 1; sleeper.y = box1.y; sleeper.asleep = 1;
    steal(box1);
    expect(g.isOpened(box1)).toBe(true);
    expect(g.offences[g.hereSite().id] ?? 0).toBe(0);
    sleeper.x = 0; sleeper.y = 0;

    // Seven steps off in the open: a villager misses it, a guard does not.
    for (let i = 1; i <= 7; i++) clear(box2.x, box2.y - i);
    const villager = folk(g).filter((a) => a.npc!.role === 'villager')[1];
    villager.x = box2.x; villager.y = box2.y - 7;
    const lookout = { ...box2, id: 'copy' };
    steal(lookout as typeof box2);
    expect(g.offences[g.hereSite().id] ?? 0).toBe(0);
    villager.x = 0; villager.y = 0;
    const guard = who(g, 'guard');
    guard.x = box2.x; guard.y = box2.y - 7;
    steal(box2);
    expect(g.offences[g.hereSite().id]).toBe(1);
    expect(g.memories[`${g.hereSite().id}:${guard.name}`]).toContain('thief');
  });

});

describe('nobody can trap you', () => {
  /** A house door, and the floor tile just inside it. */
  function houseDoor(g: Game) {
    const L = g.level;
    const at = (x: number, y: number) => L.tiles[y * L.w + x] as T;
    for (let y = 1; y < L.h - 1; y++) for (let x = 1; x < L.w - 1; x++) {
      if (at(x, y) !== T.Door) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (at(x + dx, y + dy) === T.WoodFloor && TERRAIN[at(x - dx, y - dy)].walk) {
          return { door: { x, y }, inside: { x: x + dx, y: y + dy }, outside: { x: x - dx, y: y - dy }, out: [-dx, -dy] as const };
        }
      }
    }
    throw new Error('no house door');
  }
  const dirOf = (dx: number, dy: number) => (dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up') as 'up';

  it('walking into someone standing in a doorway squeezes past them', () => {
    const g = newGame();
    setHour(g, 10);
    const { door, inside, out } = houseDoor(g);
    const v = who(g, 'villager');
    for (const a of folk(g)) if (a !== v) { a.x = 0; a.y = 0; }
    v.x = door.x; v.y = door.y;
    g.player.x = inside.x; g.player.y = inside.y;
    g.move(dirOf(out[0], out[1]));
    expect(g.player).toMatchObject(door);
    expect(v).toMatchObject(inside);
    expect(g.choice).toBeNull();
  });

  it('a guard following you waits outside rather than coming through the door', () => {
    const g = newGame();
    setHour(g, 10);
    g.rep[g.hereSite().id] = -5;
    const { door, inside } = houseDoor(g);
    g.player.x = inside.x; g.player.y = inside.y;
    const guard = who(g, 'guard');
    guard.x = door.x; guard.y = door.y + 3;
    turns(g, 30);
    expect(guard.x === door.x && guard.y === door.y).toBe(false);
    expect(g.level.tiles[guard.y * g.level.w + guard.x]).not.toBe(T.WoodFloor);
  });

  it('a hated player can always get back out of a house (several worlds, every hour)', () => {
    for (const seed of ['T1', 'T2', 'T3', 'T4']) {
      for (const hour of [10, 14, 18, 23]) {
        const g = newGame(seed);
        setHour(g, hour);
        g.rep[g.hereSite().id] = -5;
        const { inside, outside, out } = houseDoor(g);
        g.player.x = inside.x; g.player.y = inside.y;
        g.player.hp = g.player.maxHp = 999;
        turns(g, 40); // let everyone crowd round
        let escaped = false;
        for (let i = 0; i < 12 && !escaped; i++) {
          g.choice = null;
          g.messages = [];
          g.move(dirOf(out[0], out[1]));
          escaped = Math.abs(g.player.x - inside.x) + Math.abs(g.player.y - inside.y) >= 2;
        }
        expect(escaped, `${seed} at ${hour}:00 (door out to ${outside.x},${outside.y})`).toBe(true);
      }
    }
  });
});

describe('room to move', () => {
  it('nobody stands next to anyone else, guards keep off the road, and rooms stay open', () => {
    for (const seed of ['SPACE-1', 'SPACE-2', 'SPACE-3']) {
      const g = newGame(seed);
      const sites = g.world.sites.filter((s) => s.kind === 'village' || s.kind === 'hamlet').slice(0, 5);
      for (const site of sites) {
        (g as unknown as { enterSite(s: unknown, f: number, a: string, q: boolean): void }).enterSite(site, 1, 'entry', true);
        const people = g.actors.filter((a) => a.routine);
        const tile = (x: number, y: number) => g.level.tiles[y * g.level.w + x];
        for (const watch of ['morning', 'afternoon', 'evening'] as const) {
          const spots = people.map((a) => a.routine!.spots[watch]);
          for (let i = 0; i < spots.length; i++) {
            for (let j = i + 1; j < spots.length; j++) {
              const d = Math.max(Math.abs(spots[i].x - spots[j].x), Math.abs(spots[i].y - spots[j].y));
              expect(d, `${seed} ${site.name} ${watch}: ${people[i].name} and ${people[j].name}`).toBeGreaterThan(1);
            }
          }
        }
        for (const a of people.filter((x) => x.npc!.role === 'guard')) {
          for (const watch of ['morning', 'afternoon', 'evening', 'night'] as const) {
            const s = a.routine!.spots[watch];
            expect(tile(s.x, s.y), `${seed} ${site.name} guard ${watch}`).not.toBe(T.Cobble);
          }
        }
      }
    }
  });

  it('asks before stealing from a strongbox, and LEAVE IT takes nothing', () => {
    const g = newGame();
    const box = g.level.chests.find((c) => c.owned)!;
    inner(g).openChest(box);
    expect(g.choice?.options.map((o) => o.label)).toEqual(['LEAVE IT', 'STEAL FROM IT']);
    g.choice!.options[0].run();
    expect(g.isOpened(box)).toBe(false);
  });
});
