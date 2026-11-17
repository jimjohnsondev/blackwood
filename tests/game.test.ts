import { describe, expect, it } from 'vitest';
import { Game, type Actor } from '../src/game/game';
import type { ClassId } from '../src/game/rules';
import { T, TERRAIN } from '../src/game/terrain';
import type { Dir } from '../src/input/actions';

const ATTRS = { str: 12, dex: 12, wis: 12, con: 12 };

function newGame(cls: ClassId = 'warrior', seed = 'ASH-4F2K'): Game {
  return new Game({ name: 'TESTER', cls, scheme: 0, attrs: ATTRS, seed });
}

/** Breadth-first path on the current map to a tile that passes `goal`. */
function pathTo(g: Game, goal: (x: number, y: number) => boolean): Dir[] | null {
  const { w, h } = g.level;
  const start = g.player.y * w + g.player.x;
  const prev = new Map<number, [number, Dir]>();
  const queue = [start];
  const seen = new Set([start]);
  const steps: [Dir, number, number][] = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
  while (queue.length) {
    const i = queue.shift()!;
    const x = i % w, y = Math.floor(i / w);
    if (i !== start && goal(x, y)) {
      const dirs: Dir[] = [];
      for (let c = i; c !== start; c = prev.get(c)![0]) dirs.unshift(prev.get(c)![1]);
      return dirs;
    }
    for (const [d, dx, dy] of steps) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (seen.has(n)) continue;
      const t = g.tileAt(nx, ny);
      const walk = goal(nx, ny) || (TERRAIN[t].walk && t !== T.Gate);
      if (!walk) continue;
      seen.add(n);
      prev.set(n, [i, d]);
      queue.push(n);
    }
  }
  return null;
}

/** Talk to someone and pick an option from their menu by its label. */
function talkAndPick(g: Game, a: Actor, label: string): void {
  (g as unknown as { talk(a: Actor): void }).talk(a);
  const opt = g.choice?.options.find((o) => o.label === label);
  g.choice = null;
  opt?.run();
}

function clearMessages(g: Game): void {
  g.messages = [];
  g.choice = null;
  g.shopOpen = false;
}

describe('game', () => {
  it('starts in the village with a full kit', () => {
    const g = newGame('thief');
    expect(g.level.kind).toBe('town');
    expect(g.player.hp).toBe(g.player.maxHp);
    expect(g.player.inventory.map((s) => s.id)).toContain('lockpicks');
    expect(g.player.ready).toBe('bow');
  });

  it('can talk to the elder and gets the quest', () => {
    const g = newGame();
    const elder = g.actors.find((a) => a.npc?.role === 'elder')!;
    const path = pathTo(g, (x, y) => x === elder.x && y === elder.y)!;
    expect(path).not.toBeNull();
    for (const d of path) {
      g.move(d);
      if (g.flags.talkedElder) break;
      // The elder may have stepped aside; follow by re-pathing.
    }
    if (!g.flags.talkedElder) {
      const again = pathTo(g, (x, y) => x === elder.x && y === elder.y)!;
      for (const d of again) g.move(d);
    }
    expect(g.flags.talkedElder).toBe(true);
    expect(g.messages.some((m) => m.lines.join(' ').includes('CHAPEL'))).toBe(true);
  });

  it('leaves the village through the gate and wanders for a long time without errors', () => {
    for (const cls of ['warrior', 'thief', 'wizard'] as ClassId[]) {
      const g = newGame(cls, `WANDER-${cls}`);
      const path = pathTo(g, (x, y) => g.tileAt(x, y) === T.Gate)!;
      // (pathTo treats the gate as a goal only)
      expect(path).not.toBeNull();
      for (const d of path) g.move(d);
      expect(g.level.kind).toBe('overworld');
      const dirs: Dir[] = ['up', 'down', 'left', 'right'];
      let dir: Dir = 'up';
      for (let i = 0; i < 3000; i++) {
        clearMessages(g);
        if (i % 7 === 0) dir = dirs[Math.floor(Math.random() * 4)];
        g.move(dir);
        if (i % 13 === 0) g.act();
        expect(g.player.hp).toBeLessThanOrEqual(g.player.maxHp);
        expect(g.player.gold).toBeGreaterThanOrEqual(0);
        if (g.level.kind !== 'overworld' && Math.random() < 0.02) {
          // Wander inside sites too, then let the loop carry on wherever we are.
        }
      }
      expect(g.time).toBeGreaterThan(8 * 60);
    }
  });

  it('runs the whole quest: chapel altar, barrow key, boss, relic, reward', () => {
    const g = newGame('warrior', 'QUEST-RUN');
    const q = g.world.quest;
    const anyG = g as unknown as Record<string, (...args: unknown[]) => unknown>;
    clearMessages(g);

    // Go to the chapel and use the altar.
    const chapel = g.world.sites[q.chapelId];
    anyG.enterSite.call(g, chapel, 1, 'entry');
    const altarPath = pathTo(g, (x, y) => g.tileAt(x, y) === T.Altar);
    expect(altarPath).not.toBeNull();
    // Stand next to the altar, facing it.
    const ax = g.level.tiles.indexOf(T.Altar) % g.level.w;
    const ay = Math.floor(g.level.tiles.indexOf(T.Altar) / g.level.w);
    g.actors = g.actors.filter((a) => !a.monster);
    g.player.x = ax;
    g.player.y = ay + 1;
    g.player.facing = 'up';
    g.act();
    expect(g.flags.searchedChapel).toBe(true);
    expect(g.player.inventory.some((s) => s.id === 'barrowkey')).toBe(true);

    // The barrow opens with the key; go down to the third floor.
    const barrow = g.world.sites[q.barrowId];
    anyG.enterSite.call(g, barrow, 3, 'entry');
    const boss = g.actors.find((a) => a.boss)!;
    expect(boss).toBeDefined();
    boss.hp = 1;
    g.player.maxHp = 999; // a level 1 hero would not survive this fight
    g.player.x = boss.x;
    g.player.y = boss.y + 1;
    if (g.actorAt(g.player.x, g.player.y)) g.actors = g.actors.filter((a) => a === boss || a.x !== g.player.x || a.y !== g.player.y);
    for (let i = 0; i < 50 && g.actors.includes(boss); i++) {
      g.player.hp = g.player.maxHp;
      g.player.x = boss.x;
      g.player.y = boss.y + 1;
      g.move('up');
    }
    expect(g.flags.killedBoss).toBe(true);
    expect(g.player.inventory.some((s) => s.id === 'relic')).toBe(true);

    // Back to the elder.
    anyG.enterSite.call(g, g.world.sites[q.villageId], 1, 'entry');
    const elder = g.actors.find((a) => a.npc?.role === 'elder')!;
    const gold = g.player.gold;
    anyG.talk.call(g, elder);
    expect(g.flags.questDone).toBe(true);
    // Word spreads: home thinks the world of you, other settlements a little better.
    expect(g.repOf(g.world.quest.villageId)).toBe(5);
    const hamlet = g.world.sites.find((s) => s.kind === 'hamlet')!;
    expect(g.repOf(hamlet.id)).toBe(2);
    expect(g.player.gold).toBe(gold + 200);
  });

  it('dying wakes you in the village with half your gold, a day later', () => {
    const g = newGame();
    g.player.gold = 100;
    const day = g.day;
    (g as unknown as { hurtPlayer: (n: number) => void }).hurtPlayer(999);
    expect(g.player.hp).toBe(g.player.maxHp);
    expect(g.player.gold).toBe(50);
    expect(g.day).toBe(day + 1);
    expect(g.level.siteId).toBe(g.world.quest.villageId);
  });

  it('saves and loads', () => {
    const g = newGame('wizard', 'SAVE-TEST');
    g.player.gold = 77;
    g.flags.talkedElder = true;
    const raw = g.toSave();
    const loaded = Game.fromSave(raw);
    expect(loaded.player.gold).toBe(77);
    expect(loaded.flags.talkedElder).toBe(true);
    expect(loaded.player.cls).toBe('wizard');
    expect(loaded.level.id).toBe(g.level.id);
  });

  it('fires the bow in the facing direction', () => {
    const g = newGame('thief', 'BOW-TEST');
    const anyG = g as unknown as { spawnMonster: (k: string, x: number, y: number) => { hp: number; maxHp: number } };
    g.actors = g.actors.filter((a) => !a.npc);
    // Put a rat 3 tiles up a clear street.
    const { x, y } = g.player;
    for (let i = 1; i <= 3; i++) g.level.tiles[(y - i) * g.level.w + x] = T.Cobble;
    const rat = anyG.spawnMonster('rat', x, y - 3);
    rat.hp = 100;
    rat.maxHp = 100;
    g.player.facing = 'up';
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) {
      clearMessages(g);
      g.useQuick('bow');
      hit = rat.hp < 100;
    }
    expect(hit).toBe(true);
  });
});

describe('journal', () => {
  it('keeps a short chronicle of what mattered', () => {
    const g = newGame('warrior', 'JOURNAL-TEST');
    const anyG = g as unknown as Record<string, (...args: unknown[]) => unknown>;
    expect(g.journal[0].text).toMatch(/^BEGAN YOUR JOURNEY IN /);

    // Talking: one line per person, with what they told you underneath.
    const villager = g.actors.find((a) => a.npc?.role === 'villager')!;
    talkAndPick(g, villager, 'NEWS');
    talkAndPick(g, villager, 'NEWS');
    const talks = g.journal.filter((e) => e.kind === 'talk');
    expect(talks).toHaveLength(1);
    expect(talks[0].text).toBe(`TALKED WITH ${villager.name} IN ${g.villageSite().name}`);
    expect(talks[0].sub).toHaveLength(1);

    // Discovering a place.
    anyG.enterSite.call(g, g.world.sites[g.world.quest.shrineId], 1, 'entry');
    expect(g.journal.some((e) => e.text === 'DISCOVERED WAYSIDE SHRINE')).toBe(true);

    // Fights are counted, and gold is added up after them.
    for (let i = 0; i < 3; i++) {
      const s = anyG.spawnMonster.call(g, 'skeleton', 1, 1) as { hp: number };
      anyG.damageMonster.call(g, s, 999, 'HIT.');
    }
    const last = g.journal.slice(-2).map((e) => e.text);
    expect(last[0]).toBe('DEFEATED 3 SKELETONS');
    expect(last[1]).toMatch(/^FOUND \d+ GOLD PIECES?$|^DEFEATED/);
    // Messages like "YOU MISS" never reach the journal.
    g.say('YOU MISS THE RAT.');
    expect(g.journal.some((e) => e.text.includes('MISS'))).toBe(false);
  });
});

describe('journal by day', () => {
  it('stamps entries with the day and gives each day a calendar date', () => {
    const g = newGame('thief', 'DAYS-TEST');
    const anyG = g as unknown as Record<string, (...args: unknown[]) => unknown>;
    expect(g.journal[0].day).toBe(1);
    g.time += 1440; // next day
    anyG.enterSite.call(g, g.world.sites[g.world.quest.shrineId], 1, 'entry');
    const found = g.journal.find((e) => e.kind === 'discover')!;
    expect(found.day).toBe(2);
    expect(g.dateOf(1)).toMatch(/^\d{1,2} [A-Z]+ \d{3,4}$/);
    expect(g.dateOf(2)).not.toBe(g.dateOf(1));
  });

  it('records purchases, counting the same item bought again that day', () => {
    const g = newGame('warrior', 'SHOP-TEST');
    g.shopkeeper = 'MAREN';
    g.player.gold = 100;
    g.buy('healing');
    g.buy('healing');
    g.buy('torch');
    const bought = g.journal.filter((e) => e.kind === 'bought').map((e) => e.text);
    expect(bought).toEqual(['BOUGHT 2 HEAL DRAUGHTS FROM MAREN', 'BOUGHT A TORCH FROM MAREN']);
  });
});

describe('directions in the journal', () => {
  it('keeps where the elder and the chapel altar say to go', () => {
    const g = newGame('warrior', 'DIRECTIONS');
    const anyG = g as unknown as Record<string, (...args: unknown[]) => unknown>;
    const q = g.world.quest;
    const elder = g.actors.find((a) => a.npc?.role === 'elder')!;
    anyG.talk.call(g, elder);
    const talk = g.journal.find((e) => e.kind === 'talk' && e.who === elder.name)!;
    expect(talk.sub.some((l) => /THE OLD CHAPEL LIES (NORTH|SOUTH|EAST|WEST)/.test(l))).toBe(true);

    anyG.enterSite.call(g, g.world.sites[q.chapelId], 1, 'entry');
    anyG.useAltar.call(g);
    const altar = g.journal.find((e) => e.text.startsWith('SEARCHED THE ALTAR'))!;
    expect(altar.sub.some((l) => l.includes(`THE BARROW OF ${q.villain} LIES`))).toBe(true);
  });

  it('keeps the directions in villagers’ rumours about places', () => {
    // Talk to every villager in a few worlds; any rumour about a place must carry its direction.
    let checked = 0;
    for (const seed of ['R1', 'R2', 'R3', 'R4']) {
      const g = newGame('thief', seed);
      for (const v of g.actors.filter((a) => a.npc && ['villager', 'beggar'].includes(a.npc.role))) talkAndPick(g, v, 'NEWS');
      for (const e of g.journal.filter((j) => j.kind === 'talk')) {
        for (const line of e.sub) {
          if (line.includes(' LIES ')) {
            expect(line).toMatch(/ LIES (NORTH|SOUTH|EAST|WEST)[A-Z ]* OF [A-Z ]+, (NOT FAR|A DAY'S WALK|FAR AWAY)\.$/);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('message boxes', () => {
  it('A closes any message without doing anything else, and A on an empty tile is silent', async () => {
    const { PlayScene } = await import('../src/screens/play');
    const g = newGame('thief', 'POPOVER');
    const scene = new PlayScene({ go: () => {} }, g);
    g.messages = [];
    g.player.ready = null;
    // Face an empty tile and press A: no message, no turn.
    const turn = g.turn;
    g.player.facing = 'down';
    scene.input({ kind: 'a' });
    expect(g.messages).toHaveLength(0);
    expect(g.turn).toBe(turn);

    // A short message: A closes it instead of acting.
    g.player.ready = 'bow';
    g.say('A SHORT MESSAGE.');
    scene.input({ kind: 'a' });
    expect(g.messages).toHaveLength(0);
    expect(g.turn).toBe(turn);

    // A message that waits for A: moving does nothing, A closes it.
    g.say('A LONG ONE.', true);
    const { x, y } = g.player;
    scene.input({ kind: 'dir', dir: 'up' });
    expect([g.player.x, g.player.y]).toEqual([x, y]);
    scene.input({ kind: 'a' });
    expect(g.messages).toHaveLength(0);
  });
});

describe('quest objectives', () => {
  it('says where to go next at every step', () => {
    const g = newGame('warrior', 'OBJECTIVES');
    const q = g.world.quest;
    expect(g.objectiveHints()[0]).toBe(`${q.elderName} WAITS IN ${g.villageSite().name}.`);
    g.flags.talkedElder = true;
    expect(g.objectiveHints()[0]).toMatch(/^THE OLD CHAPEL LIES (NORTH|SOUTH|EAST|WEST)/);
    g.flags.searchedChapel = true;
    expect(g.objectiveHints()[0]).toMatch(new RegExp(`^THE BARROW OF ${q.villain} LIES .* OF THE OLD CHAPEL`));
    g.flags.killedBoss = true;
    expect(g.objectiveHints()[0]).toBe(`BRING THE ${q.relic} TO ${q.elderName} IN ${g.villageSite().name}.`);
    // Act II: one hint per living lieutenant, naming the town to ask in.
    g.flags.questDone = true;
    expect(g.objectiveHints().length).toBe(2);
    expect(g.objectiveHints()[0]).toMatch(new RegExp(`^${q.lieutenants[0].name}: ASK IN `));
    g.flags.won = true;
    expect(g.objectiveHints()).toEqual([]);
  });
});

describe('map', () => {
  it('records explored ground and known places, and keeps them through a save', () => {
    const g = newGame('warrior', 'MAP-TEST');
    const anyG = g as unknown as Record<string, (...args: unknown[]) => unknown>;
    expect(g.explored.some((v) => v === 1)).toBe(false);
    anyG.goOverworld.call(g);
    const S = g.world.size;
    expect(g.explored[g.player.y * S + g.player.x]).toBe(1);
    expect(g.explored[g.player.y * S + g.player.x + 8]).toBe(1);
    expect(g.explored[g.player.y * S + g.player.x + 20]).toBe(0);

    // The village is always known; the chapel shows up once the elder mentions it.
    const known = () => g.knownSites().map((k) => k.site.id);
    expect(known()).toContain(g.world.quest.villageId);
    expect(known()).not.toContain(g.world.quest.chapelId);
    g.flags.talkedElder = true;
    expect(g.knownSites().find((k) => k.site.id === g.world.quest.chapelId)?.quest).toBe(true);

    // Dungeon memory and overworld exploration survive saving.
    g.player.inventory.push({ id: 'barrowkey', count: 1 });
    anyG.enterSite.call(g, g.world.sites[g.world.quest.barrowId], 1, 'entry');
    const seenBefore = g.seen.get(g.level.id)!.reduce((a, b) => a + b, 0);
    expect(seenBefore).toBeGreaterThan(0);
    const loaded = Game.fromSave(g.toSave());
    expect(loaded.explored.reduce((a, b) => a + b, 0)).toBe(g.explored.reduce((a, b) => a + b, 0));
    expect(loaded.seen.get(g.level.id)!.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(seenBefore);
  });
});
