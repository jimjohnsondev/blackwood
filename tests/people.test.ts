import { describe, expect, it } from 'vitest';
import { Game, type Actor } from '../src/game/game';
import { ask, keywordLabel, traitOf } from '../src/game/people';
import type { ClassId } from '../src/game/rules';
import type { Chest } from '../src/gen/types';

const ATTRS = { str: 12, dex: 12, wis: 12, con: 12 };

function newGame(cls: ClassId = 'warrior', seed = 'PEOPLE-1'): Game {
  return new Game({ name: 'TESTER', cls, scheme: 0, attrs: ATTRS, seed });
}

type Inner = {
  talk(a: Actor): void;
  openChest(c: Chest): void;
  onEnter(x: number, y: number, t: number): boolean;
  rng: { dice(n: number, s: number): number };
};
const inner = (g: Game) => g as unknown as Inner;

function talkAndPick(g: Game, a: Actor, label: string): void {
  inner(g).talk(a);
  const opt = g.choice?.options.find((o) => o.label === label);
  expect(opt, `${a.name} has no ${label} option`).toBeTruthy();
  g.choice = null;
  opt!.run();
}

const someone = (g: Game, role: string) => g.actors.find((a) => a.npc?.role === role)!;

describe('talk', () => {
  it('opens a menu with the person’s trade, NEWS or ASK ABOUT, and BYE', () => {
    const g = newGame();
    // Jobs on offer (NEED ANY HELP?) come first; side quests have their own tests.
    const labels = () => g.choice!.options.map((o) => o.label).filter((l) => l !== 'NEED ANY HELP?');
    inner(g).talk(someone(g, 'shopkeeper'));
    expect(labels()).toEqual(['TRADE', 'ASK ABOUT...', 'BYE']);
    expect(g.choice!.text).toBeTruthy();
    inner(g).talk(someone(g, 'villager'));
    expect(labels()).toEqual(['NEWS', 'ASK ABOUT...', 'BYE']);
  });

  it('the elder still opens with the quest the first time', () => {
    const g = newGame();
    inner(g).talk(someone(g, 'elder'));
    expect(g.flags.talkedElder).toBe(true);
    expect(g.choice).toBeNull();
    expect(g.keywords.has('quest:trouble')).toBe(true);
    // After that, a menu.
    inner(g).talk(someone(g, 'elder'));
    expect(g.choice!.options[0].label).toBe('ASK FOR NEWS');
  });

  it('gives the same answer to the same question in the same world', () => {
    const a = newGame('warrior', 'SAME');
    const b = newGame('thief', 'SAME');
    const va = someone(a, 'innkeeper'), vb = someone(b, 'innkeeper');
    expect(va.name).toBe(vb.name);
    a.askAbout(va, 'job');
    b.askAbout(vb, 'job');
    expect(a.messages.at(-1)!.lines).toEqual(b.messages.at(-1)!.lines);
    expect(traitOf('SAME', a.hereSite().id, va.name)).toBe(traitOf('SAME', b.hereSite().id, vb.name));
  });

  it('asking about the village names the people who keep it', () => {
    const g = newGame();
    const v = someone(g, 'villager');
    g.askAbout(v, `site:${g.hereSite().id}`);
    const keeper = someone(g, 'shopkeeper');
    expect(g.keywords.has(`person:${g.hereSite().id}:${keeper.name}`)).toBe(true);
    // ...who can then be asked about by name.
    expect(g.askable(v)).toContain(`person:${g.hereSite().id}:${keeper.name}`);
  });

  it('asking about a place gives directions, marks it on the map and notes it', () => {
    let answered = 0;
    for (const seed of ['P1', 'P2', 'P3', 'P4', 'P5']) {
      const g = newGame('warrior', seed);
      const here = g.hereSite();
      const hamlet = g.world.sites
        .filter((s) => s.kind === 'hamlet')
        .sort((s1, s2) => Math.hypot(s1.x - here.x, s1.y - here.y) - Math.hypot(s2.x - here.x, s2.y - here.y))[0];
      g.heardOf.add(hamlet.id);
      const inn = someone(g, 'innkeeper');
      expect(g.askable(inn)).toContain(`site:${hamlet.id}`);
      g.messages = [];
      g.askAbout(inn, `site:${hamlet.id}`);
      const said = g.messages.map((m) => m.lines.join(' ')).join(' ');
      if (said.includes(' LIES ')) {
        answered++;
        expect(g.topicNotes[`site:${hamlet.id}`][0]).toContain(inn.name);
        expect(g.journal.at(-1)!.sub.at(-1)).toMatch(/ LIES (NORTH|SOUTH|EAST|WEST)[A-Z ]* OF [A-Z ]+, (NOT FAR|A DAY'S WALK|FAR AWAY)\.$/);
      }
    }
    expect(answered).toBeGreaterThan(2);
  });

  it('gossip teaches new topics to ask about, kept on the Topics page', () => {
    let taught = 0;
    for (const seed of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']) {
      const g = newGame('warrior', seed);
      for (const v of g.actors.filter((a) => a.npc?.role === 'villager')) talkAndPick(g, v, 'NEWS');
      for (const k of g.keywords) {
        if (!k.startsWith('lore:')) continue;
        taught++;
        expect(keywordLabel(g.world, k)).toBeTruthy();
        expect(g.topicNotes[k].length).toBeGreaterThan(0);
      }
    }
    expect(taught).toBeGreaterThan(0);
  });

  it('every keyword in every list has a label and an answer', () => {
    const g = newGame('wizard', 'ALL-KEYS');
    for (const v of g.actors.filter((a) => a.npc && a.npc.role !== 'elder')) talkAndPick(g, v, 'ASK ABOUT...');
    g.keywords.add('quest:villain');
    g.keywords.add('quest:relic');
    for (const s of g.world.sites) g.heardOf.add(s.id);
    for (const a of g.actors.filter((x) => x.npc)) {
      for (const k of g.askable(a)) {
        expect(keywordLabel(g.world, k), k).toBeTruthy();
        const answer = ask(
          {
            world: g.world,
            speaker: { name: a.name, role: a.npc!.role, siteId: g.hereSite().id },
            trait: traitOf(g.world.seed, g.hereSite().id, a.name),
            here: g.hereSite(),
            residents: [],
            rep: 0,
            questFlags: g.flags,
          },
          k,
        );
        expect(answer.lines.length).toBeGreaterThan(0);
        for (const line of answer.lines) expect(line).toMatch(/^[A-Z0-9 .,!?'\-:]+$/);
      }
    }
  });
});

describe('standing', () => {
  it('a liked player pays less, a hero sleeps free, a disliked one pays more', () => {
    const g = newGame();
    const id = g.hereSite().id;
    const base = g.shopPrice('healing');
    g.rep[id] = 5;
    expect(g.shopPrice('healing')).toBeLessThan(base);
    expect(g.innPrice()).toBeLessThan(10);
    g.rep[id] = 7;
    expect(g.innPrice()).toBe(0);
    g.rep[id] = -3;
    expect(g.shopPrice('healing')).toBeGreaterThan(base);
    expect(g.sellPrice('healing')).toBeLessThan(Math.floor(base / 2));
  });

  it('a temple gift raises standing once a day', () => {
    const g = newGame();
    g.player.gold = 100;
    const priest = someone(g, 'priest');
    talkAndPick(g, priest, 'DONATE TO THE TEMPLE');
    talkAndPick(g, priest, 'DONATE TO THE TEMPLE');
    expect(g.repOf(g.hereSite().id)).toBe(1);
    expect(g.player.gold).toBe(80);
    expect(g.journal.some((e) => e.kind === 'gift')).toBe(true);
  });

  it('a disliked player is turned away from the gate at night', () => {
    const g = newGame();
    const village = g.hereSite();
    g.rep[village.id] = -6;
    g.time = 22 * 60;
    (g as unknown as { goOverworld(): void }).goOverworld();
    inner(g).onEnter(village.x, village.y, 0 + g.tileAt(village.x, village.y));
    expect(g.level.kind).toBe('overworld');
    expect(g.messages.some((m) => m.lines.join(' ').includes('BARRED'))).toBe(true);
  });
});

describe('theft', () => {
  it('villages have strongboxes in their houses', () => {
    const g = newGame();
    const boxes = g.level.chests.filter((c) => c.owned);
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) expect(b.locked).toBe(true);
  });

  it('caught once: a fine. Caught again: a fine and a three-day ban', () => {
    const g = newGame('warrior', 'THIEF-1');
    g.player.gold = 100;
    const village = g.hereSite();
    const [box1, box2] = g.level.chests.filter((c) => c.owned);
    const watcher = someone(g, 'villager');
    for (const a of g.actors) if (a !== watcher) { a.x = 0; a.y = 0; }
    inner(g).rng.dice = () => 2; // every roll fails: someone always sees
    const catchAt = (box: Chest) => {
      g.player.x = box.x;
      g.player.y = box.y;
      watcher.x = box.x + 1;
      watcher.y = box.y;
      g.stealOk.add(box.id); // already said yes to stealing
      inner(g).openChest(box);
    };

    catchAt(box1);
    expect(g.player.gold).toBe(80);
    expect(g.repOf(village.id)).toBe(-2);
    expect(g.isOpened(box1)).toBe(false);
    expect(g.journal.at(-1)!.text).toBe(`CAUGHT STEALING IN ${village.name}`);
    expect(g.memories[`${village.id}:${watcher.name}`]).toContain('thief');

    catchAt(box2 ?? box1);
    expect(g.player.gold).toBe(60);
    expect(g.level.kind).toBe('overworld');
    expect(g.bannedUntil[village.id]).toBe(g.day + 3);

    // Walking back in is refused until the ban ends.
    inner(g).onEnter(village.x, village.y, g.tileAt(village.x, village.y));
    expect(g.level.kind).toBe('overworld');
    g.time += 3 * 1440;
    inner(g).onEnter(village.x, village.y, g.tileAt(village.x, village.y));
    expect(g.level.kind).toBe('town');
  });

  it('unseen, the strongbox opens and its gold is yours', () => {
    const g = newGame('thief', 'THIEF-2');
    const box = g.level.chests.find((c) => c.owned)!;
    for (const a of g.actors) { a.x = 0; a.y = 0; } // nobody near
    inner(g).rng.dice = () => 19;
    const before = g.player.gold;
    g.stealOk.add(box.id); // already said yes to stealing
    inner(g).openChest(box);
    expect(g.isOpened(box)).toBe(true);
    expect(g.player.gold).toBeGreaterThan(before);
    expect(g.repOf(g.hereSite().id)).toBe(0);
  });
});

describe('saving people', () => {
  it('keeps topics, standing, bans and memories', () => {
    const g = newGame();
    const id = g.hereSite().id;
    g.keywords.add('lore:wolves');
    g.topicNotes['lore:wolves'] = ['ODO: THEY HUNT IN PACKS.'];
    g.rep[id] = 4;
    g.bannedUntil[99] = 7;
    g.memories['1:ODO'] = ['donor'];
    const back = Game.fromSave(g.toSave());
    expect(back.keywords.has('lore:wolves')).toBe(true);
    expect(back.topicNotes['lore:wolves']).toEqual(['ODO: THEY HUNT IN PACKS.']);
    expect(back.repOf(id)).toBe(4);
    expect(back.bannedUntil[99]).toBe(7);
    expect(back.memories['1:ODO']).toEqual(['donor']);
  });

  it('old saves without any of this still load', () => {
    const g = newGame();
    const raw = JSON.parse(g.toSave());
    for (const k of ['keywords', 'topicNotes', 'rep', 'offences', 'bannedUntil', 'memories', 'giftDays']) delete raw[k];
    const back = Game.fromSave(JSON.stringify(raw));
    expect(back.keywords.size).toBe(0);
    expect(back.repOf(back.hereSite().id)).toBe(0);
  });
});
