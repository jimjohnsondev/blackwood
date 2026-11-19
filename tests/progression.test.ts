import { describe, expect, it } from 'vitest';
import { Game, type Actor } from '../src/game/game';
import { ITEMS, TOME_IDS, type ItemId } from '../src/game/items';
import { attackBonus, canUse, damageBonus, defense, lockpick, magic, maxMp, sneak } from '../src/game/player';
import { MAX_LEVEL, PERKS, XP_TABLE, type ClassId, type PerkId } from '../src/game/rules';
import { T } from '../src/game/terrain';
import { rollLoot } from '../src/gen/loot';
import { Rng } from '../src/gen/rng';
import { ICONS } from '../src/gfx/icons';
import { PlayScene } from '../src/screens/play';

const ATTRS = { str: 12, dex: 12, wis: 12, con: 12 };
const newGame = (cls: ClassId = 'warrior', extra: object = {}) =>
  new Game({ name: 'TESTER', cls, scheme: 0, attrs: { ...ATTRS }, seed: 'PROG-1', ...extra });

type Inner = {
  gainXp(n: number): void;
  hurtPlayer(n: number): void;
  meleeAttack(a: Actor): void;
  spawnMonster(k: string, x: number, y: number): Actor;
  endTurn(): void;
  die(): void;
  rng: { dice(n: number, s: number, plus?: number): number };
};
const inner = (g: Game) => g as unknown as Inner;

/** Pick level-up options by label until none are owed. */
function choose(g: Game, ...labels: string[]): void {
  for (const label of labels) {
    const opt = g.choice!.options.find((o) => o.label === label);
    expect(opt, `${g.choice?.title}: ${label}`).toBeTruthy();
    g.choice = null;
    opt!.run();
  }
}

function givePerk(g: Game, perk: PerkId): void {
  (g.player.perks ??= []).push(perk);
}

/** An open, empty street around the player. */
function clear(g: Game): void {
  g.actors = g.actors.filter((a) => !a.npc);
  const { x, y } = g.player;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) g.level.tiles[(y + dy) * g.level.w + x + dx] = T.Cobble;
  g.level.chests = [];
}

describe('levels', () => {
  it('go to 15 on a steady curve', () => {
    expect(MAX_LEVEL).toBe(15);
    expect(XP_TABLE[2]).toBe(100);
    expect(XP_TABLE[5]).toBe(1000);
    expect(XP_TABLE[15]).toBe(10500);
    for (let n = 3; n <= 15; n++) expect(XP_TABLE[n]).toBeGreaterThan(XP_TABLE[n - 1]);
  });

  it('each level asks for a skill to train, and it cannot be skipped', () => {
    const g = newGame();
    const scene = new PlayScene({ go: () => {} }, g);
    const before = attackBonus(g.player);
    inner(g).gainXp(100);
    expect(g.player.level).toBe(2);
    expect(g.choice!.title).toBe('LEVEL 2: TRAIN A SKILL');
    g.messages = [];
    scene.input({ kind: 'b' });
    expect(g.choice).not.toBeNull();
    choose(g, 'ATTACK');
    expect(attackBonus(g.player)).toBe(before + 2); // +1 for the level, +1 trained
    expect(g.choice).toBeNull();
  });

  it('level 3 brings a perk, level 4 an attribute point; several levels queue up', () => {
    const g = newGame();
    inner(g).gainXp(XP_TABLE[4]);
    expect(g.player.level).toBe(4);
    choose(g, 'DEFENSE', 'SNEAK', 'HEAL');
    expect(g.choice!.title).toBe('CHOOSE A PERK');
    expect(g.choice!.options.length).toBe(3);
    const perk = g.choice!.options[0].label;
    choose(g, perk);
    expect(g.player.perks!.length).toBe(1);
    expect(g.choice!.title).toBe('RAISE AN ATTRIBUTE');
    choose(g, 'STR');
    expect(g.player.attrs.str).toBe(13);
    expect(g.choice).toBeNull();
    expect(g.levelChoicesDue()).toBe(false);
  });

  it('owed choices survive saving and loading', () => {
    const g = newGame();
    inner(g).gainXp(XP_TABLE[3]);
    g.choice = null;
    const back = Game.fromSave(g.toSave());
    const scene = new PlayScene({ go: () => {} }, back);
    expect((scene as unknown as { overlay: string }).overlay).toBe('choice');
    expect(back.choice!.title).toContain('TRAIN A SKILL');
  });
});

describe('perks', () => {
  it('every class has five, with names and descriptions', () => {
    for (const cls of ['warrior', 'thief', 'wizard'] as ClassId[]) {
      expect(PERKS[cls].length).toBe(5);
      for (const p of PERKS[cls]) expect(p.name.length + p.desc.length).toBeGreaterThan(5);
    }
  });

  it('the simple ones change the numbers', () => {
    const w = newGame('warrior');
    const def = defense(w.player), atk = attackBonus(w.player);
    givePerk(w, 'ironhide'); givePerk(w, 'bulwark'); givePerk(w, 'weaponmaster');
    expect(defense(w.player)).toBe(def + 4); // the warrior starts with a shield
    expect(attackBonus(w.player)).toBe(atk + 1);
    expect(damageBonus(w.player)).toBe(2);

    const t = newGame('thief');
    const lp = lockpick(t.player);
    givePerk(t, 'lightfingers'); givePerk(t, 'deadeye');
    expect(lockpick(t.player)).toBe(lp + 3);
    expect(damageBonus(t.player, true)).toBe(2);

    const z = newGame('wizard');
    const mg = magic(z.player), mp = maxMp(z.player);
    givePerk(z, 'focus'); givePerk(z, 'deepwell');
    expect(magic(z.player)).toBe(mg + 2);
    expect(maxMp(z.player)).toBe(Math.floor(mp * 1.5));
  });

  it('SECOND WIND saves a warrior once a day', () => {
    const g = newGame('warrior');
    givePerk(g, 'secondwind');
    g.player.maxHp = g.player.hp = 40;
    inner(g).hurtPlayer(35);
    expect(g.player.hp).toBe(25);
    inner(g).hurtPlayer(22);
    expect(g.player.hp).toBe(3); // not again today
  });

  it('CLEAVE: a kill gives a free swing at the next foe', () => {
    const g = newGame('warrior');
    clear(g);
    givePerk(g, 'cleave');
    inner(g).rng.dice = (n: number, s: number) => (s === 20 ? 15 : n * s);
    const a = inner(g).spawnMonster('rat', g.player.x + 1, g.player.y);
    const b = inner(g).spawnMonster('rat', g.player.x, g.player.y + 1);
    a.hp = 1;
    b.hp = b.maxHp = 100;
    inner(g).meleeAttack(a);
    expect(g.actors.includes(a)).toBe(false);
    expect(b.hp).toBeLessThan(100);
  });

  it('ASSASSIN: backstabs triple the weapon dice', () => {
    const g = newGame('thief');
    clear(g);
    givePerk(g, 'assassin');
    inner(g).rng.dice = (n: number, s: number) => (s === 20 ? 15 : n * 3);
    const rat = inner(g).spawnMonster('rat', g.player.x + 1, g.player.y);
    rat.hp = rat.maxHp = 100;
    inner(g).meleeAttack(rat);
    const first = 100 - rat.hp;
    inner(g).meleeAttack(rat);
    // Two extra dice of 3 each on the backstab; the bonuses count once.
    expect(first - (100 - first - rat.hp)).toBe(6);
  });

  it('SHADOW STEP: sneaking at full speed; FENCE: better prices; FAMILIAR: light', () => {
    const t = newGame('thief');
    givePerk(t, 'shadowstep');
    t.toggleSneak();
    const turn = t.turn;
    t.move('up');
    expect(t.turn - turn).toBe(1);
    const price = t.sellPrice('sword');
    givePerk(t, 'fence');
    expect(t.sellPrice('sword')).toBeGreaterThan(price);

    const z = newGame('wizard');
    expect(z.lightRadius()).toBe(2);
    givePerk(z, 'familiar');
    expect(z.lightRadius()).toBe(4);
  });
});

describe('the spellbook', () => {
  it('tomes teach a wizard new spells, once, when ready', () => {
    const g = newGame('wizard');
    g.player.inventory.push({ id: 'tome-hold', count: 1 }, { id: 'tome-detect', count: 1 });
    g.useItem('tome-hold');
    expect(g.player.spellbook ?? []).not.toContain('hold'); // needs level 4
    g.player.level = 4;
    g.useItem('tome-hold');
    g.useItem('tome-detect');
    expect(g.player.spellbook).toEqual(['hold', 'detect']);
    expect(g.quickOptions().map((o) => o.id)).toEqual(expect.arrayContaining(['hold', 'detect']));
    expect(g.player.inventory.some((s) => s.id === 'tome-hold' && s.count > 0)).toBe(false);
  });

  it('only a wizard can read them', () => {
    const g = newGame('warrior');
    g.player.inventory.push({ id: 'tome-shield', count: 1 });
    g.useItem('tome-shield');
    expect(g.player.spellbook).toBeUndefined();
  });

  function wizard(...spells: ('detect' | 'shield' | 'hold' | 'recall' | 'banish' | 'chain')[]): Game {
    const g = newGame('wizard');
    g.player.level = 9;
    g.player.mp = 99;
    g.player.spellbook = spells;
    clear(g);
    return g;
  }

  it('SHIELD: +4 defense for a while', () => {
    const g = wizard('shield');
    const d = defense(g.player);
    g.useQuick('shield');
    expect(defense(g.player)).toBe(d + 4);
    for (let i = 0; i < 45; i++) inner(g).endTurn();
    expect(defense(g.player)).toBe(d);
  });

  it('HOLD freezes a foe, even when struck', () => {
    const g = wizard('hold');
    const wolf = inner(g).spawnMonster('wolf', g.player.x + 3, g.player.y);
    g.useQuick('hold', wolf);
    expect(wolf.held).toBe(5); // casting took a turn
    wolf.hp = wolf.maxHp = 100;
    g.player.spellbook = ['hold'];
    for (let i = 0; i < 5 && wolf.hp === 100; i++) g.useQuick('spark', wolf);
    expect(wolf.hp).toBeLessThan(100); // struck...
    expect(wolf.held).toBeGreaterThan(0); // ...and still frozen
    const at = { x: wolf.x, y: wolf.y };
    inner(g).endTurn();
    expect(wolf).toMatchObject(at);
  });

  it('CHAIN BOLT leaps between up to three foes', () => {
    const g = wizard('chain');
    const { x, y } = g.player;
    const foes = [inner(g).spawnMonster('rat', x + 3, y), inner(g).spawnMonster('rat', x + 4, y + 1), inner(g).spawnMonster('rat', x + 4, y + 3)];
    for (const f of foes) f.hp = f.maxHp = 100;
    g.useQuick('chain', foes[0]);
    expect(foes.every((f) => f.hp < 100)).toBe(true);
  });

  it('BANISH burns the undead, and only them', () => {
    const g = wizard('banish');
    const bones = inner(g).spawnMonster('skeleton', g.player.x + 2, g.player.y);
    const wolf = inner(g).spawnMonster('wolf', g.player.x - 2, g.player.y);
    bones.hp = bones.maxHp = wolf.hp = wolf.maxHp = 100;
    g.useQuick('banish');
    expect(bones.hp).toBeLessThan(100);
    expect(wolf.hp).toBe(100);
  });

  it('DETECT shows foes for a while; RECALL takes you home', () => {
    const g = wizard('detect', 'recall');
    g.useQuick('detect');
    expect(g.detectUntil).toBeGreaterThan(g.turn);
    (g as unknown as { goOverworld(): void }).goOverworld();
    g.useQuick('recall');
    expect(g.level.kind).toBe('town');
    expect(g.hereSite().id).toBe(g.world.quest.villageId);
  });
});

describe('better gear', () => {
  it('comes in three grades, each better than the last', () => {
    expect(ITEMS['sword+1'].name).toBe('FINE LONGSWORD');
    expect(ITEMS['chain+3'].name).toBe('RUNED CHAIN MAIL');
    const g = newGame('warrior');
    const atk = attackBonus(g.player), def = defense(g.player);
    g.player.inventory.push({ id: 'sword+2', count: 1 }, { id: 'chain+3', count: 1 });
    g.useItem('sword+2');
    g.useItem('chain+3');
    expect(attackBonus(g.player)).toBe(atk + 2);
    expect(damageBonus(g.player)).toBe(2);
    expect(defense(g.player)).toBe(def + 3);
  });

  it('follows the same class rules as the plain item', () => {
    const z = newGame('wizard');
    expect(canUse(z.player, 'staff+3')).toBe(true);
    expect(canUse(z.player, 'sword+1')).toBe(false);
  });

  it('a better bow counts as a bow', () => {
    const t = newGame('thief');
    t.player.inventory = t.player.inventory.filter((s) => s.id !== 'shortbow');
    t.player.inventory.push({ id: 'shortbow+2', count: 1 });
    expect(t.quickOptions()[0].name).toBe('MASTERWORK SHORT BOW');
    expect(attackBonus(t.player, true)).toBeGreaterThan(attackBonus(newGame('thief').player, true));
  });

  it('every item has a picture', () => {
    for (const id of Object.keys(ITEMS) as ItemId[]) expect(ICONS[id], id).toBeTruthy();
  });

  it('deeper chests hold better grades and tomes', () => {
    const rng = new Rng('loot-test');
    const deep: string[] = [], shallow: string[] = [];
    for (let i = 0; i < 400; i++) {
      for (const l of rollLoot(rng, 4)) if (l.item) deep.push(l.item);
      for (const l of rollLoot(rng, 1)) if (l.item) shallow.push(l.item);
    }
    expect(deep.some((id) => id.endsWith('+3'))).toBe(true);
    expect(deep.some((id) => (TOME_IDS as string[]).includes(id))).toBe(true);
    expect(shallow.some((id) => id.includes('+') || id.startsWith('tome'))).toBe(false);
  });
});

describe('backgrounds and hard mode', () => {
  it('a background gives a small head start', () => {
    const plain = newGame('thief');
    const farm = newGame('thief', { background: 'farmhand' });
    expect(farm.player.maxHp).toBe(plain.player.maxHp + 3);
    const rat = newGame('thief', { background: 'streetrat' });
    expect(sneak(rat.player)).toBe(sneak(plain.player) + 1);
    const scribe = newGame('wizard', { background: 'scribe' });
    expect(magic(scribe.player)).toBe(magic(newGame('wizard').player) + 1);
    expect(scribe.player.inventory.some((s) => s.id === 'scroll')).toBe(true);
  });

  it('in hard mode, death ends the tale and the save', () => {
    const store: Record<string, string> = {};
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; },
    };
    const g = newGame('warrior', { hard: true });
    g.save();
    expect(Game.hasSave()).toBe(true);
    inner(g).die();
    expect(g.gameOver).toBe(true);
    expect(Game.hasSave()).toBe(false);
    let went: unknown;
    const scene = new PlayScene({ go: (s: unknown) => { went = s; } } as never, g);
    g.messages = [];
    scene.draw({ clear() {}, fill() {}, text() {}, box() {} } as never, 0);
    expect((went as object).constructor.name).toBe('TitleScene');
  });

  it('in normal mode, death is a setback', () => {
    const g = newGame('warrior');
    inner(g).die();
    expect(g.gameOver).toBe(false);
    expect(g.player.hp).toBe(g.player.maxHp);
  });
});

describe('level-up choices are never lost', () => {
  it('switching tabs keeps them; they show again on the map', () => {
    const g = newGame();
    const scene = new PlayScene({ go: () => {} }, g);
    inner(g).gainXp(100);
    g.messages = [];
    scene.input({ kind: 'tab', tab: 'stats' });
    expect(g.choice?.mustChoose).toBe(true);
    scene.input({ kind: 'tab', tab: 'map' });
    expect(g.choice?.title).toContain('TRAIN A SKILL');
  });

  it('a choice opened outside a turn is still drawn and answered', () => {
    const g = newGame();
    const scene = new PlayScene({ go: () => {} }, g);
    inner(g).gainXp(100);
    g.messages = [];
    const calls: string[] = [];
    const screen = new Proxy({}, { get: (_t, k) => (...args: unknown[]) => { if (k === 'text') calls.push(String(args[0])); } });
    scene.draw(screen as never, 0);
    expect(calls).toContain('LEVEL 2: TRAIN A SKILL');
    scene.input({ kind: 'a' });
    expect(g.player.trained?.attack).toBe(1);
  });
});
