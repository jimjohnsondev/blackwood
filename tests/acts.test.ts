import { describe, expect, it } from 'vitest';
import { Game, type Actor } from '../src/game/game';
import { countItem } from '../src/game/player';
import { floorsOf } from '../src/gen/levels';
import type { Site } from '../src/gen/types';
import { generateWorld } from '../src/gen/world';
import { BLIGHT_START, BLIGHT_STEP, RECEDE_STEP, blightedRegions, newBlight } from '../src/sim/blight';

const ATTRS = { str: 12, dex: 12, wis: 12, con: 12 };
const newGame = (seed = 'ACTS-1') => new Game({ name: 'TESTER', cls: 'warrior', scheme: 0, attrs: ATTRS, seed });
type Inner = {
  enterSite(site: Site, floor: number, arrive: 'entry' | 'down', quiet?: boolean): void;
  goOverworld(): void;
  onEnter(x: number, y: number, t: number): boolean;
  talk(a: Actor): void;
  elderTalk(a: Actor): void;
  damageMonster(a: Actor, dmg: number, text: string): void;
  at: { siteId: number; floor: number } | null;
};
const inner = (g: Game) => g as unknown as Inner;
const SITE_TILE = 10;

describe('the world of the later acts', () => {
  it('has a stronghold in the Blight and two lieutenants in two other lands', () => {
    for (const seed of ['ACTS-1', 'ACTS-2', 'ACTS-3']) {
      const w = generateWorld(seed);
      const q = w.quest;
      const hold = w.sites[q.strongholdId];
      expect(hold.kind).toBe('stronghold');
      expect(w.regions[hold.region].type).toBe('blight');
      expect(q.lieutenants.length).toBe(2);
      expect(q.lieutenants[0].region).not.toBe(q.lieutenants[1].region);
      for (const l of q.lieutenants) expect(['vale', 'blight']).not.toContain(w.regions[l.region].type);
      expect(q.blightOrder.slice(0, 2)).toEqual(q.lieutenants.map((l) => l.region));
      expect(q.blightOrder.length).toBe(4);
    }
  });

  it('the Blight waits in the Vale, spreads on a clock, spares freed lands, and draws back after the end', () => {
    const w = generateWorld('ACTS-1');
    const heart = w.regions.find((r) => r.type === 'blight')!.id;
    const st = newBlight();
    expect(blightedRegions(w, st, 500)).toEqual([heart]);
    st.leftVale = 10;
    expect(blightedRegions(w, st, 10 + BLIGHT_START - 1)).toEqual([heart]);
    expect(blightedRegions(w, st, 10 + BLIGHT_START)).toEqual([heart, w.quest.blightOrder[0]]);
    expect(blightedRegions(w, st, 10 + BLIGHT_START + BLIGHT_STEP * 3).length).toBe(5);
    expect(blightedRegions(w, st, 9999)).not.toContain(w.regions.find((r) => r.type === 'vale')!.id);
    st.ltDead[0] = true;
    expect(blightedRegions(w, st, 9999)).not.toContain(w.quest.lieutenants[0].region);
    st.wonDay = 200;
    const atEnd = blightedRegions(w, st, 200).length;
    expect(blightedRegions(w, st, 200 + RECEDE_STEP).length).toBe(atEnd - 1);
    expect(blightedRegions(w, st, 200 + RECEDE_STEP * atEnd)).toEqual([]);
  });
});

describe('the three acts', () => {
  it('plays through: the shade, the elder, two lieutenants, the black gate, the villain, the ending', () => {
    const g = newGame();
    const q = g.world.quest;
    const home = g.world.sites[q.villageId];
    const hold = g.world.sites[q.strongholdId];
    g.player.hp = g.player.maxHp = 999;

    // Act I ends: the shade in the Barrow, then the elder.
    const barrow = g.world.sites[q.barrowId];
    inner(g).enterSite(barrow, 3, 'entry', true);
    const shade = g.actors.find((a) => a.boss)!;
    expect(shade.name).toBe(`SHADE OF ${q.villain}`);
    inner(g).damageMonster(shade, 999, 'HIT');
    expect(g.flags.killedBoss).toBe(true);
    inner(g).goOverworld();
    inner(g).enterSite(home, 1, 'entry', true);
    inner(g).elderTalk({ name: q.elderName } as Actor);
    expect(g.flags.questDone).toBe(true);
    expect(countItem(g.player, 'relic')).toBe(1);
    expect(g.keywords.has('quest:lt0') && g.keywords.has('quest:lt1')).toBe(true);
    expect(g.heardOf.has(hold.id)).toBe(true);

    // The gate will not open yet.
    inner(g).goOverworld();
    g.player.x = hold.x; g.player.y = hold.y;
    inner(g).onEnter(hold.x, hold.y, SITE_TILE);
    expect(inner(g).at).toBeNull();

    // Act II: ask in the lieutenant's own land, find the den, kill them.
    q.lieutenants.forEach((lt, i) => {
      const den = g.world.sites[lt.siteId];
      const town = g.world.sites.find((s) => s.kind === 'village' && s.region === lt.region)!;
      inner(g).enterSite(town, 1, 'entry', true);
      const someone = g.actors.find((a) => a.npc)!;
      g.askAbout(someone, `quest:lt${i}`);
      expect(g.heardOf.has(den.id)).toBe(true);
      inner(g).goOverworld();
      inner(g).enterSite(den, floorsOf(g.world, den), 'entry', true);
      const boss = g.actors.find((a) => a.lieutenant === i)!;
      expect(boss.name).toBe(lt.name);
      inner(g).damageMonster(boss, 9999, 'HIT');
      expect(g.blight.ltDead[i]).toBe(true);
      inner(g).goOverworld();
    });
    expect(countItem(g.player, 'shard')).toBe(2);

    // Act III: the gate opens; the villain has a second wind; then the ending.
    g.player.x = hold.x; g.player.y = hold.y;
    inner(g).onEnter(hold.x, hold.y, SITE_TILE);
    expect(inner(g).at?.siteId).toBe(hold.id);
    inner(g).enterSite(hold, 5, 'entry', true);
    const villain = g.actors.find((a) => a.final)!;
    expect(villain.name).toBe(q.villain);
    const before = g.actors.length;
    inner(g).damageMonster(villain, villain.maxHp / 2 + 1, 'HIT');
    expect(villain.phase2).toBe(true);
    expect(g.actors.length).toBeGreaterThan(before);
    inner(g).damageMonster(villain, 9999, 'HIT');
    expect(g.flags.won).toBe(true);
    expect(g.ending).toBe(true);
    expect(g.blight.wonDay).toBe(g.day);

    // A save keeps all of it.
    const back = Game.fromSave(g.toSave());
    expect(back.flags.won).toBe(true);
    expect(back.blight.ltDead).toEqual([true, true]);
  });

  it('the Blight empties hamlets, fills towns with refugees, and makes the land more dangerous', () => {
    const g = newGame();
    const q = g.world.quest;
    const land = q.blightOrder[0];
    const hamlet = g.world.sites.find((s) => s.kind === 'hamlet' && s.region === land);
    const farTown = g.world.sites.find((s) => s.kind === 'village' && s.region === q.blightOrder[3])!;
    const spot = g.world.sites.find((s) => s.region === land)!;
    inner(g).goOverworld();
    const before = g.dangerHere(spot.x, spot.y);
    g.blight.leftVale = 1;
    g.time += 1440 * (BLIGHT_START + 1);
    g.runWorld();
    expect(g.blightedNow()).toContain(land);
    expect(g.worldState.events.some((e) => e.kind === 'blight')).toBe(true);
    expect(g.dangerHere(spot.x, spot.y)).toBe(Math.min(8, before + 1));
    if (hamlet) {
      inner(g).goOverworld();
      inner(g).enterSite(hamlet, 1, 'entry', true);
      expect(g.actors.filter((a) => a.npc).length).toBe(0);
    }
    inner(g).goOverworld();
    inner(g).enterSite(farTown, 1, 'entry', true);
    expect(g.actors.filter((a) => a.refugee).length).toBe(2);
  });

  it('the clock starts only when the player first leaves the Vale', () => {
    const g = newGame();
    inner(g).goOverworld();
    g.wait();
    expect(g.blight.leftVale).toBeUndefined();
    const out = g.world.sites.find((s) => g.world.regions[s.region].type !== 'vale')!;
    g.player.x = out.x + 1; g.player.y = out.y;
    g.wait();
    expect(g.blight.leftVale).toBe(g.day);
  });
});

describe('quest places on the map', () => {
  it('lists where each quest points, with a reason, and A on the big map jumps between them', async () => {
    const { PlayScene } = await import('../src/screens/play');
    const g = newGame();
    const q = g.world.quest;
    expect(g.questMarks().map((m) => m.why)).toEqual([`SPEAK TO ${q.elderName}`]);
    Object.assign(g.flags, { talkedElder: true, searchedChapel: true, killedBoss: true, questDone: true });
    const marks = g.questMarks();
    expect(marks.map((m) => m.why)).toEqual(q.lieutenants.map((l) => `ASK ABOUT ${l.name}`));
    expect(marks.every((m) => m.site.kind === 'village' && m.main)).toBe(true);
    expect(g.knownSites().filter((k) => k.quest).map((k) => k.site.id).sort()).toEqual(marks.map((m) => m.site.id).sort());

    inner(g).goOverworld();
    g.messages = [];
    const scene = new PlayScene({ go: () => {} }, g);
    const cursor = () => (scene as unknown as { cursor: { x: number; y: number } }).cursor;
    const open = () => (scene as unknown as { mapOpen: boolean }).mapOpen;
    scene.input({ kind: 'tab', tab: 'map' });
    if (!open()) scene.input({ kind: 'tab', tab: 'map' });
    expect(open()).toBe(true);
    scene.input({ kind: 'a' });
    expect(cursor()).toEqual({ x: marks[0].site.x, y: marks[0].site.y });
    scene.input({ kind: 'a' });
    expect(cursor()).toEqual({ x: marks[1].site.x, y: marks[1].site.y });
    scene.input({ kind: 'a' }); // and back to you
    expect(cursor()).toEqual({ x: g.overworld.x, y: g.overworld.y });
  });
});
