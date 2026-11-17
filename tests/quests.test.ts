import { describe, expect, it } from 'vitest';
import { Game, type Actor } from '../src/game/game';
import type { QuestKind, SideQuest } from '../src/game/quests';
import type { Site } from '../src/gen/types';

const ATTRS = { str: 12, dex: 12, wis: 12, con: 12 };
const newGame = (seed = 'QUEST-1') => new Game({ name: 'TESTER', cls: 'warrior', scheme: 0, attrs: ATTRS, seed });
type Inner = {
  enterSite(site: Site, floor: number, arrive: 'entry' | 'down', quiet?: boolean): void;
  goOverworld(): void;
  talk(a: Actor): void;
  damageMonster(a: Actor, dmg: number, text: string): void;
  openChest(c: unknown): void;
  actorAt(x: number, y: number): Actor | undefined;
};
const inner = (g: Game) => g as unknown as Inner;

/** Walk the settlements until one offers this kind of job; take it. */
function takeA(g: Game, kind: QuestKind): SideQuest {
  for (const s of g.world.sites.filter((x) => x.kind === 'village' || x.kind === 'hamlet')) {
    inner(g).enterSite(s, 1, 'entry', true);
    const offer = g.offersHere().find((o) => o.kind === kind);
    if (!offer) continue;
    const giver = personHere(g, offer.giver);
    choose(g, giver, 'NEED ANY HELP?');
    choose(g, null, 'I WILL DO IT');
    return g.quests[g.quests.length - 1];
  }
  throw new Error(`no ${kind} offered`);
}

/** The named person, standing beside the player so they can be talked to. */
function personHere(g: Game, name: string): Actor {
  let a = g.actors.find((x) => x.name === name);
  if (!a) {
    // Out on an errand at this hour: bring them in for the test.
    const spawn = g.level.npcs.find((n) => n.name === name)!;
    a = { id: 999, x: 0, y: 0, hp: 1, maxHp: 1, name, npc: spawn, awake: false, asleep: 0, checks: 0 };
    g.actors.push(a);
  }
  a.asleep = 0;
  return a;
}

/** Talk (or use the open list) and pick the option whose label starts with `label`. */
function choose(g: Game, a: Actor | null, label: string): void {
  if (a) { g.messages = []; inner(g).talk(a); }
  const opt = g.choice!.options.find((o) => o.label.startsWith(label));
  expect(opt, `option ${label} in ${g.choice!.options.map((o) => o.label)}`).toBeTruthy();
  g.choice = null;
  opt!.run();
}

function settle(g: Game, q: SideQuest): void {
  inner(g).goOverworld();
  inner(g).enterSite(g.world.sites[q.siteId], 1, 'entry', true);
  const gold = g.player.gold;
  choose(g, personHere(g, q.giver), 'ABOUT');
  expect(q.state).toBe('done');
  expect(g.player.gold).toBe(gold + q.gold);
}

describe('side quests', () => {
  it('every settlement offers one to three jobs, the same ones all through the span of days', () => {
    const g = newGame();
    for (const s of g.world.sites.filter((x) => x.kind === 'village' || x.kind === 'hamlet').slice(0, 6)) {
      inner(g).enterSite(s, 1, 'entry', true);
      const a = g.offersHere();
      expect(a.length).toBeGreaterThanOrEqual(1);
      expect(a.length).toBeLessThanOrEqual(3);
      const again = newGame();
      inner(again).enterSite(s, 1, 'entry', true);
      expect(again.offersHere()).toEqual(a);
    }
  });

  it('rescue: find them deep in the dungeon, then tell the giver', () => {
    const g = newGame();
    const q = takeA(g, 'rescue');
    expect(q.deadline).toBe(g.day + 6);
    const site = g.world.sites[q.target];
    inner(g).goOverworld();
    inner(g).enterSite(site, 1, 'entry', true);
    const floors = g.level.floors;
    if (floors > 1) inner(g).enterSite(site, floors, 'entry', true);
    const lost = g.actors.find((a) => a.questId === q.id)!;
    expect(lost.name).toBe(q.who);
    inner(g).talk(lost);
    expect(q.state).toBe('return');
    settle(g, q);
  });

  it('recover: the heirloom lies in a chest on the deepest floor', () => {
    const g = newGame();
    const q = takeA(g, 'recover');
    const site = g.world.sites[q.target];
    inner(g).goOverworld();
    inner(g).enterSite(site, 1, 'entry', true);
    inner(g).enterSite(site, g.level.floors, 'entry', true);
    const chest = g.level.chests.find((c) => c.id === `quest:${q.id}`)!;
    expect(chest).toBeTruthy();
    inner(g).openChest(chest);
    expect(q.state).toBe('return');
    settle(g, q);
  });

  it('hunt: clearing the lair is the job', () => {
    const g = newGame();
    const q = takeA(g, 'hunt');
    const lair = g.world.sites[q.target];
    inner(g).goOverworld();
    // Every floor must be emptied: go up (or down) through them all, then back out.
    inner(g).enterSite(lair, 1, 'entry', true);
    const floors = g.level.floors;
    for (let f = 1; f <= floors; f++) {
      inner(g).enterSite(lair, f, 'entry', true);
      g.actors = g.actors.filter((a) => !a.monster);
      g.clearedFloors.add(g.level.id);
    }
    inner(g).goOverworld();
    expect(q.state).toBe('return');
    settle(g, q);
  });

  it('deliver: hand the parcel to the right person, in time', () => {
    const g = newGame();
    const q = takeA(g, 'deliver');
    inner(g).goOverworld();
    inner(g).enterSite(g.world.sites[q.target], 1, 'entry', true);
    const gold = g.player.gold;
    choose(g, personHere(g, q.who!), 'GIVE');
    expect(q.state).toBe('done');
    expect(g.player.gold).toBe(gold + q.gold);
  });

  it('investigate: only at night, and the job is done when what stirs is dead', () => {
    const g = newGame();
    const q = takeA(g, 'investigate');
    const site = g.world.sites[q.target];
    inner(g).goOverworld();
    g.time = Math.floor(g.time / 1440) * 1440 + 13 * 60;
    inner(g).enterSite(site, 1, 'entry', true);
    expect(g.actors.some((a) => a.questId === q.id)).toBe(false);
    inner(g).goOverworld();
    g.time += 10 * 60;
    inner(g).enterSite(site, 1, 'entry', true);
    const foes = g.actors.filter((a) => a.questId === q.id);
    expect(foes.length).toBeGreaterThan(0);
    for (const f of foes) inner(g).damageMonster(f, 999, 'YOU HIT');
    expect(q.state).toBe('return');
    settle(g, q);
  });

  it('a rescue left too long fails', () => {
    const g = newGame();
    const q = takeA(g, 'rescue');
    g.time += 1440 * 7;
    g.runWorld();
    expect(q.state).toBe('failed');
  });

  it('taken jobs survive a save', () => {
    const g = newGame();
    const q = takeA(g, 'hunt');
    const back = Game.fromSave(g.toSave());
    expect(back.quests).toEqual([q]);
  });
});
