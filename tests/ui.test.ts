import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { PlayScene } from '../src/screens/play';

const ATTRS = { str: 12, dex: 12, wis: 12, con: 12 };
const newGame = () => {
  const g = new Game({ name: 'TESTER', cls: 'thief', scheme: 0, attrs: ATTRS, seed: 'UI-1' });
  g.messages = []; // the welcome and the first tip have been read
  return g;
};
type Inner = { overlay: string | null; menuOptions(): { label: string }[]; heroBelow(row: number): boolean };
const inner = (s: PlayScene) => s as unknown as Inner;

describe('ACTIONS and MENU', () => {
  it('ACTIONS holds what the character does; MENU holds the game itself', () => {
    const scene = new PlayScene({ go: () => {} }, newGame());
    scene.input({ kind: 'actions' });
    expect(inner(scene).overlay).toBe('actions');
    expect(inner(scene).menuOptions().map((o) => o.label)).toEqual(['SNEAK', 'LOOK AHEAD', 'WAIT A TURN', 'REST']);
    scene.input({ kind: 'menu' }); // switches straight across
    expect(inner(scene).overlay).toBe('menu');
    expect(inner(scene).menuOptions().map((o) => o.label)).toEqual(['SAVE GAME', 'SETTINGS', 'COPY SEED', 'QUIT TO TITLE']);
    scene.input({ kind: 'menu' }); // the same button closes it
    expect(inner(scene).overlay).toBeNull();
  });

  it('SNEAK from ACTIONS turns sneaking on', () => {
    const g = newGame();
    const scene = new PlayScene({ go: () => {} }, g);
    scene.input({ kind: 'actions' });
    scene.input({ kind: 'a' });
    expect(g.player.sneaking).toBe(true);
  });

  it('WAIT A TURN passes a turn', () => {
    const g = newGame();
    const scene = new PlayScene({ go: () => {} }, g);
    const t = g.turn;
    scene.input({ kind: 'actions' });
    scene.input({ kind: 'dir', dir: 'down' });
    scene.input({ kind: 'dir', dir: 'down' });
    scene.input({ kind: 'a' });
    expect(g.turn).toBe(t + 1);
  });
});

describe('message boxes stay clear of the hero', () => {
  it('just inside the village gate the hero is low on screen, so messages go to the top', () => {
    const g = newGame();
    const scene = new PlayScene({ go: () => {} }, g);
    expect(g.level.kind).toBe('town');
    // You start at the gate, at the bottom edge of the village.
    expect(inner(scene).heroBelow(20)).toBe(true);
  });

  it('out on the open map the hero is centred, so messages stay at the bottom', () => {
    const g = newGame();
    (g as unknown as { goOverworld(): void }).goOverworld();
    const scene = new PlayScene({ go: () => {} }, g);
    expect(inner(scene).heroBelow(20)).toBe(false);
  });
});

describe('MENU in the middle of a fight', () => {
  it('passing combat messages do not eat the A press in MENU', () => {
    let went: unknown = null;
    const g = newGame();
    const scene = new PlayScene({ go: (s: unknown) => { went = s; } } as never, g);
    scene.input({ kind: 'menu' });
    scene.input({ kind: 'dir', dir: 'up' }); // wraps round to the last entry: QUIT TO TITLE
    g.say('THE GOBLIN HACKS! 2 DAMAGE.'); // a fight goes on around you
    scene.input({ kind: 'a' });
    expect(went?.constructor.name).toBe('TitleScene');
  });

  it('a message that waits for A still has to be read first', () => {
    const g = newGame();
    const scene = new PlayScene({ go: () => {} }, g);
    scene.input({ kind: 'menu' });
    g.say('THE ELDER SPEAKS OF THE BARROW.', true);
    scene.input({ kind: 'a' });
    expect(g.messages.length).toBe(0);
    expect(inner(scene).overlay).toBe('menu');
  });

  it('MENU from the CAST strip opens the menu', () => {
    const g = new Game({ name: 'TESTER', cls: 'wizard', scheme: 0, attrs: ATTRS, seed: 'UI-1' });
    g.messages = []; // the welcome and the first tip have been read
    const scene = new PlayScene({ go: () => {} }, g);
    scene.input({ kind: 'cast' });
    expect(inner(scene).overlay).toBe('cast');
    scene.input({ kind: 'menu' });
    expect(inner(scene).overlay).toBe('menu');
  });
});

describe('sprite animation', () => {
  it('makes breathing, stepping and hovering frames from one picture, and walkers step', async () => {
    const { frameOf, Animator } = await import('../src/gfx/animate');
    const { HORSE } = await import('../src/gfx/sprites');
    const count = (a: { pixels: Uint8Array }) => a.pixels.reduce((n, v) => n + (v ? 1 : 0), 0);
    for (const f of ['breathe', 'stepL', 'stepR', 'hover'] as const) {
      const a = frameOf(HORSE, f);
      expect(a).not.toBe(HORSE);
      expect(frameOf(HORSE, f)).toBe(a); // made once
      expect(count(a)).toBeGreaterThan(count(HORSE) * 0.8);
    }
    const an = new Animator();
    expect(an.frame('x', 1, 1, 0)).toMatch(/still|breathe/);
    expect(an.frame('x', 2, 1, 100)).toMatch(/step/);
    expect(an.frame('x', 2, 1, 1000)).toMatch(/still|breathe/);
  });
});

describe('title screen and settings', () => {
  it('deletes a save from Settings only after a yes, never the game being played, and shows key names on a keyboard', async () => {
    const { TitleScene } = await import('../src/screens/title');
    const { SettingsScene } = await import('../src/screens/settings');
    const { hint, setUsingKeys } = await import('../src/input/labels');
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    Game.slot = 1;
    newGame().save();
    Game.slot = 2;
    newGame().save();
    Game.slot = 1;
    let scene: unknown = null;
    const app = { go: (s: unknown) => { scene = s; } };
    const title = new TitleScene(app);
    expect((title as unknown as { options(): string[] }).options()).toEqual(['CONTINUE', 'NEW GAME', 'SETTINGS']);
    title.input({ kind: 'dir', dir: 'down' });
    title.input({ kind: 'dir', dir: 'down' });
    title.input({ kind: 'a' });
    expect(scene).toBeInstanceOf(SettingsScene);
    const settings = scene as InstanceType<typeof SettingsScene>;
    type In = Parameters<typeof settings.input>[0];
    const press = (...as: In[]) => as.forEach((a) => settings.input(a));
    press(...Array(4).fill({ kind: 'dir', dir: 'down' }), { kind: 'a' }); // DELETE A SAVE
    press({ kind: 'a' }, { kind: 'a' }); // slot 1, then NO (picked first)
    expect(Game.slotInfo(1)).not.toBeNull();
    press({ kind: 'a' }, { kind: 'dir', dir: 'right' }, { kind: 'a' }); // slot 1, YES
    expect(Game.slotInfo(1)).toBeNull();
    press({ kind: 'b' }, { kind: 'b' }); // back to the title, which sees the change
    expect(scene).toBe(title);

    // During play, the game in progress is safe.
    const inGame = new SettingsScene(app, title, 2);
    for (let i = 0; i < 4; i++) inGame.input({ kind: 'dir', dir: 'down' });
    inGame.input({ kind: 'a' });
    inGame.input({ kind: 'dir', dir: 'down' }); // slot 2
    inGame.input({ kind: 'a' });
    inGame.input({ kind: 'dir', dir: 'right' });
    inGame.input({ kind: 'a' });
    expect(Game.slotInfo(2)).not.toBeNull();

    setUsingKeys(true);
    expect(hint(['A', 'NEXT'], ['B', 'BACK'])).toBe('SPACE NEXT   CTRL BACK');
    setUsingKeys(false);
    expect(hint(['A', 'NEXT'], ['B', 'BACK'])).toBe('A NEXT   B BACK');
  });
});
