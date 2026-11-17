import { btn, hint } from '../input/labels';
// Title screen: a night landscape, the title tune, and New Game / Continue.
import { playMusic, sfx, stopMusic } from '../audio/sound';
import { Game } from '../game/game';
import { T } from '../game/terrain';
import { C } from '../gfx/palette';
import type { Screen } from '../gfx/screen';
import { TILE_ART } from '../gfx/tiles';
import type { Action } from '../input/actions';
import { CreateScene } from './create';
import { PlayScene } from './play';
import { SettingsScene } from './settings';
import type { App, Scene } from './scene';

const SLOTS = [1, 2, 3];

export class TitleScene implements Scene {
  private cursor = 0;
  /** The main menu, or the list of save slots (to continue from, or to start a new game over). */
  private mode: 'main' | 'continue' | 'replace' = 'main';
  private slots = SLOTS.map((n) => Game.slotInfo(n));

  constructor(private app: App) {}

  /** Back from Settings: a save may have been deleted there. */
  resume(): void {
    this.slots = SLOTS.map((n) => Game.slotInfo(n));
    this.mode = 'main';
    this.cursor = 0;
  }

  /** Slots holding a game that can be loaded. */
  private usable(): number[] {
    return SLOTS.filter((n) => this.slots[n - 1] && !this.slots[n - 1]!.old);
  }

  private options(): string[] {
    return [...(this.usable().length ? ['CONTINUE'] : []), 'NEW GAME', 'SETTINGS'];
  }

  private load(slot: number): void {
    const game = Game.load(slot);
    if (!game) return;
    stopMusic();
    this.app.go(new PlayScene(this.app, game));
  }

  private startNew(slot: number): void {
    Game.slot = slot;
    Game.deleteSave(slot);
    this.app.go(new CreateScene(this.app));
  }

  input(a: Action): void {
    playMusic('title');
    const count = this.mode === 'main' ? this.options().length : SLOTS.length;
    if (a.kind === 'dir' && (a.dir === 'up' || a.dir === 'down')) {
      this.cursor = (this.cursor + (a.dir === 'up' ? -1 : 1) + count) % count;
      sfx('move');
    }
    if (a.kind === 'b' && this.mode !== 'main') {
      sfx('back');
      this.mode = 'main';
      this.cursor = 0;
      return;
    }
    if (a.kind !== 'a') return;
    sfx('select');
    if (this.mode === 'continue') {
      if (this.usable().includes(this.cursor + 1)) this.load(this.cursor + 1);
      return;
    }
    if (this.mode === 'replace') return this.startNew(this.cursor + 1);
    const choice = this.options()[this.cursor];
    if (choice === 'SETTINGS') return this.app.go(new SettingsScene(this.app, this));
    if (choice === 'CONTINUE') {
      const usable = this.usable();
      if (usable.length === 1) return this.load(usable[0]);
      this.mode = 'continue';
      this.cursor = usable[0] - 1;
      return;
    }
    // A new game takes the first free slot (an old-world save counts as free).
    const free = SLOTS.find((n) => !this.slots[n - 1] || this.slots[n - 1]!.old);
    if (free) return this.startNew(free);
    this.mode = 'replace';
    this.cursor = 0;
  }

  draw(s: Screen, now: number): void {
    playMusic('title');
    s.clear(C.black);
    // Stars.
    for (let i = 0; i < 40; i++) {
      const x = (i * 97) % 256, y = (i * 53) % 90;
      const twinkle = Math.floor(now / 400 + i) % 7 === 0;
      s.fill(x, y, 1, 1, twinkle ? C.dim : C.grey);
    }
    // Moon.
    for (let y = -6; y <= 6; y++) {
      for (let x = -6; x <= 6; x++) {
        if (x * x + y * y <= 36 && (x + 3) * (x + 3) + (y - 2) * (y - 2) > 25) s.fill(206 + x, 30 + y, 1, 1, C.cream);
      }
    }
    // Landscape: peaks, then dark pines.
    for (let i = 0; i < 16; i++) {
      s.art(TILE_ART[(i * 7) % 5 === 0 ? T.RedPeak : T.Mountain], i * 16, 124, 'night');
      s.art(TILE_ART[T.Pine], i * 16, 140 + ((i * 3) % 2) * 4, 'night', i % 2 === 0);
      s.art(TILE_ART[T.Pine], i * 16 + 8, 156, 'night');
    }
    s.fill(0, 172, 256, 20, C.black);

    s.textPx('BLACKWOOD', 56, 40, C.darkred, undefined, 2);
    s.textPx('BLACKWOOD', 55, 39, C.gold, undefined, 2);
    s.text('A TALE OF THE VALE', 7, 8, C.dim);
    s.text('VERSION 1.1', 1, 23, C.darkgrey);
    if (this.mode === 'main') {
      if (this.slots.some((x) => x?.old) && !this.usable().length) {
        s.text('YOUR SAVE IS FROM AN OLDER,', 3, 17, C.orange);
        s.text('SMALLER WORLD. START ANEW.', 3, 18, C.orange);
      }
      const opts = this.options();
      // Up to four choices, kept above the hills.
      const gap = opts.length > 2 ? 10 : 16;
      opts.forEach((label, i) => {
        const y = (opts.length > 3 ? 80 : 88) + i * gap;
        const selected = i === this.cursor;
        s.textPx(label, (16 - Math.floor(label.length / 2)) * 8, y, selected ? C.cream : C.dim, C.black);
        if (selected) s.textPx('>', (14 - Math.floor(label.length / 2)) * 8, y, C.gold, C.black);
      });
    } else {
      // The three save slots.
      s.fill(16, 80, 224, 96, C.black);
      s.box(2, 10, 28, 12, C.grey);
      s.text(this.mode === 'continue' ? 'CONTINUE WHICH GAME?' : 'ALL FULL. REPLACE WHICH?', 4, 11, C.gold);
      SLOTS.forEach((n, i) => {
        const info = this.slots[i];
        const y = 13 + i * 3;
        const selected = i === this.cursor;
        const dim = this.mode === 'continue' && (!info || info.old);
        s.text(`${n} ${info ? info.name : 'EMPTY'}`, 5, y, dim ? C.darkgrey : selected ? C.cream : C.dim);
        if (info) s.text(info.line, 7, y + 1, dim ? C.darkgrey : C.dim);
        if (selected) s.text('>', 3, y, C.gold);
      });
    }

    if (this.mode !== 'main') { const h = hint(['A', 'CHOOSE'], ['B', 'BACK']); s.text(h, 16 - Math.ceil(h.length / 2), 22, C.dim); }
    else if (Math.floor(now / 600) % 2 === 0) { const press = `PRESS ${btn('A')}`; s.text(press, 16 - Math.ceil(press.length / 2), 22, C.dim); }
  }
}
