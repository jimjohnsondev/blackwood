import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import type { ClassId } from '../src/game/rules';
import { T } from '../src/game/terrain';
import { PlayScene } from '../src/screens/play';

const ATTRS = { str: 12, dex: 12, wis: 14, con: 12 };

function newGame(cls: ClassId = 'wizard', seed = 'SPELLS-1'): Game {
  const g = new Game({ name: 'TESTER', cls, scheme: 0, attrs: ATTRS, seed });
  g.messages = [];
  return g;
}

type Inner = {
  spawnMonster(k: string, x: number, y: number): { hp: number; maxHp: number; x: number; y: number };
  hurtPlayer(n: number): void;
  endTurn(): void;
};
const inner = (g: Game) => g as unknown as Inner;

/** Clear a straight street north of the player, with nobody else about. */
function street(g: Game, length = 8): void {
  g.actors = g.actors.filter((a) => !a.npc);
  const { x, y } = g.player;
  for (let i = 1; i <= length; i++) g.level.tiles[(y - i) * g.level.w + x] = T.Cobble;
  g.player.facing = 'up';
}

describe('the CAST / FIRE button', () => {
  it('offers each class what it can use', () => {
    expect(newGame('wizard').quickOptions().map((o) => o.id)).toEqual(['spark', 'ward', 'mend', 'glow']);
    expect(newGame('thief').quickOptions().map((o) => o.id)).toEqual(['bow']);
    expect(newGame('warrior').quickOptions()).toEqual([]);
  });

  it('the button reads CAST, FIRE or LOOK', () => {
    const go = { go: () => {} };
    expect(new PlayScene(go, newGame('wizard')).castLabel()).toBe('cast');
    expect(new PlayScene(go, newGame('thief')).castLabel()).toBe('fire');
    expect(new PlayScene(go, newGame('warrior')).castLabel()).toBe('look');
  });

  it('press once to open the strip, again to use what it shows; it remembers the last choice', () => {
    const g = newGame('wizard');
    const scene = new PlayScene({ go: () => {} }, g);
    street(g);
    const turn = g.turn;
    scene.input({ kind: 'cast' });
    expect(g.turn).toBe(turn); // just opened
    scene.input({ kind: 'dir', dir: 'right' }); // SPARK -> WARD
    scene.input({ kind: 'cast' });
    expect(g.player.ward).toBeTruthy();
    expect(g.player.ready).toBe('ward');
    // Next time the strip opens on WARD.
    g.messages = [];
    scene.input({ kind: 'cast' });
    scene.input({ kind: 'b' });
    expect(g.turn).toBe(turn + 1);
  });

  it('A only acts on what is in front: it never fires', () => {
    const g = newGame('thief');
    street(g);
    const rat = inner(g).spawnMonster('rat', g.player.x, g.player.y - 3);
    const turn = g.turn;
    g.act();
    expect(g.turn).toBe(turn);
    expect(rat.hp).toBe(rat.maxHp);
  });
});

describe('spells', () => {
  it('SPARK is free and hits what is ahead', () => {
    const g = newGame('wizard');
    street(g);
    const rat = inner(g).spawnMonster('rat', g.player.x, g.player.y - 3);
    rat.hp = rat.maxHp = 100;
    const mp = g.player.mp;
    for (let i = 0; i < 20 && rat.hp === 100; i++) { g.messages = []; g.useQuick('spark'); }
    expect(rat.hp).toBeLessThan(100);
    expect(g.player.mp).toBeGreaterThanOrEqual(mp);
  });

  it('WARD soaks up damage before HP, then shatters', () => {
    const g = newGame('wizard');
    g.useQuick('ward');
    const ward = g.player.ward!;
    expect(ward.points).toBeGreaterThanOrEqual(4);
    const hp = g.player.hp;
    inner(g).hurtPlayer(ward.points - 1);
    expect(g.player.hp).toBe(hp);
    inner(g).hurtPlayer(3);
    expect(g.player.ward).toBeUndefined();
    expect(g.player.hp).toBe(hp - 2);
  });

  it('MP comes back as you walk', () => {
    const g = newGame('wizard');
    g.player.mp = 0;
    for (let i = 0; i < 40; i++) inner(g).endTurn();
    expect(g.player.mp).toBeGreaterThan(0);
  });

  it('not enough MP: nothing happens and no turn passes', () => {
    const g = newGame('wizard');
    g.player.mp = 1;
    const turn = g.turn;
    g.useQuick('ward');
    expect(g.player.ward).toBeUndefined();
    expect(g.turn).toBe(turn);
  });

  it('BLINK carries you 3 to 6 steps away from danger (level 3)', () => {
    const g = newGame('wizard');
    g.player.level = 3;
    g.player.mp = 10;
    expect(g.quickOptions().map((o) => o.id)).toContain('blink');
    g.actors = g.actors.filter((a) => !a.npc);
    const { x, y } = g.player;
    inner(g).spawnMonster('wolf', x + 1, y);
    g.useQuick('blink');
    const d = Math.max(Math.abs(g.player.x - x), Math.abs(g.player.y - y));
    expect(d).toBeGreaterThanOrEqual(3);
    expect(d).toBeLessThanOrEqual(6);
    expect(g.player.mp).toBe(8);
  });

  it('FIREBALL burns everything around where it lands (level 5)', () => {
    const g = newGame('wizard');
    g.player.level = 5;
    g.player.mp = 10;
    street(g);
    const { x, y } = g.player;
    g.level.tiles[(y - 4) * g.level.w + x + 1] = T.Cobble;
    const a = inner(g).spawnMonster('rat', x, y - 4);
    const b = inner(g).spawnMonster('rat', x + 1, y - 4);
    a.hp = a.maxHp = b.hp = b.maxHp = 100;
    g.useQuick('fireball');
    expect(a.hp).toBeLessThan(100);
    expect(b.hp).toBeLessThan(100);
    expect(g.player.mp).toBe(5);
  });

  it('the wizard is sturdier: a d6 hit die', () => {
    const g = newGame('wizard');
    expect(g.player.maxHp).toBeGreaterThanOrEqual(6);
  });
});

describe('aiming', () => {
  /** A wizard on open floor in the village, nobody about. */
  function field(): Game {
    const g = newGame('wizard', 'AIM-1');
    g.actors = g.actors.filter((a) => !a.npc);
    const { x, y } = g.player;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -7; dx <= 7; dx++) {
      const tx = x + dx, ty = y + dy;
      if (tx >= 0 && ty >= 0 && tx < g.level.w && ty < g.level.h) g.level.tiles[ty * g.level.w + tx] = T.Cobble;
    }
    g.level.chests = [];
    return g;
  }

  it('finds monsters at any angle, nearest first', () => {
    const g = field();
    const { x, y } = g.player;
    const far = inner(g).spawnMonster('rat', x + 5, y - 3);
    const near = inner(g).spawnMonster('rat', x - 2, y + 1);
    const targets = g.targets();
    expect(targets).toEqual([near, far]);
  });

  it('hits a monster that is not lined up, without moving', () => {
    const g = field();
    const { x, y } = g.player;
    const rat = inner(g).spawnMonster('rat', x + 4, y - 2) as unknown as import('../src/game/game').Actor;
    rat.hp = rat.maxHp = 100;
    for (let i = 0; i < 20 && rat.hp === 100; i++) g.useQuick('spark', rat);
    expect(rat.hp).toBeLessThan(100);
    expect(g.player.x).toBe(x);
    expect(g.player.facing).toBe('right');
  });

  it('a monster behind a wall, or behind another monster, is not a target', () => {
    const g = field();
    const { x, y } = g.player;
    g.level.tiles[(y - 2) * g.level.w + x] = T.Wall;
    const hidden = inner(g).spawnMonster('rat', x, y - 4);
    const front = inner(g).spawnMonster('rat', x + 2, y);
    const behind = inner(g).spawnMonster('rat', x + 4, y);
    const targets = g.targets();
    expect(targets).toContain(front);
    expect(targets).not.toContain(hidden);
    expect(targets).not.toContain(behind);
  });

  it('CAST aims at the nearest monster, UP/DOWN switches, CAST again fires at it', () => {
    const g = field();
    const scene = new PlayScene({ go: () => {} }, g);
    const { x, y } = g.player;
    const a = inner(g).spawnMonster('rat', x + 2, y + 1);
    const b = inner(g).spawnMonster('rat', x - 3, y - 3);
    a.hp = a.maxHp = b.hp = b.maxHp = 100;
    scene.input({ kind: 'cast' });
    expect((scene as unknown as { castTarget: unknown }).castTarget).toBe(a);
    scene.input({ kind: 'dir', dir: 'down' });
    expect((scene as unknown as { castTarget: unknown }).castTarget).toBe(b);
    const mp = g.player.mp;
    for (let i = 0; i < 20 && b.hp === 100; i++) {
      scene.input({ kind: 'cast' });
      scene.input({ kind: 'cast' });
    }
    expect(b.hp).toBeLessThan(100);
    expect(a.hp).toBe(100);
    expect(g.player.mp).toBeGreaterThanOrEqual(mp); // SPARK is free
  });

  it('tapping a monster on screen opens CAST aimed at it', () => {
    const g = field();
    const scene = new PlayScene({ go: () => {} }, g);
    const { x, y } = g.player;
    inner(g).spawnMonster('rat', x + 1, y);
    const far = inner(g).spawnMonster('rat', x + 3, y - 2);
    const cam = (scene as unknown as { camera(): { x: number; y: number } }).camera();
    scene.input({ kind: 'point', x: far.x * 16 - cam.x + 8, y: 8 + far.y * 16 - cam.y + 8 });
    expect((scene as unknown as { overlay: string }).overlay).toBe('cast');
    expect((scene as unknown as { castTarget: unknown }).castTarget).toBe(far);
  });

  it('with nothing in sight, aimed spells still fire the way you face', () => {
    const g = field();
    const scene = new PlayScene({ go: () => {} }, g);
    scene.input({ kind: 'cast' });
    expect((scene as unknown as { castTarget: unknown }).castTarget).toBeNull();
    scene.input({ kind: 'cast' });
    expect(g.messages.at(-1)!.lines.join(' ')).toContain('FLIES INTO EMPTINESS');
  });
});
