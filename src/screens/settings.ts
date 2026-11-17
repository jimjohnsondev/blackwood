// Settings: music, sound effects, full screen, and a page of keyboard controls.
// Reached from the title screen and from MENU during play; B goes back to where you came from.
import { musicOn, setMusic, setSound, sfx, soundOn } from '../audio/sound';
import { Game } from '../game/game';
import { C } from '../gfx/palette';
import { hint } from '../input/labels';
import type { Screen } from '../gfx/screen';
import type { Action } from '../input/actions';
import type { App, Scene } from './scene';

/** The keyboard, as the game reads it (see src/input/keyboard.ts). */
const KEYS: [string, string][] = [
  ['ARROWS', 'MOVE, ATTACK, TALK'],
  ['SPACE', 'A: USE, OK'],
  ['ENTER', 'A, TOO'],
  ['CTRL', 'B: BACK, CLOSE'],
  ['ESC', 'MENU'],
  ['X', 'ACTIONS'],
  ['C OR F', 'CAST, OR FIRE A BOW'],
  ['L', 'LOOK'],
  ['M', 'MAP, TWICE: BIG MAP'],
  ['I', 'ITEMS'],
  ['S', 'STATS'],
  ['J', 'JOURNAL'],
];

/** Is the page showing full screen right now? */
function isFullscreen(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenElement;
}

/** Can this browser go full screen at all? (iPhone Safari can't; "Add to Home Screen" does it instead.) */
function canFullscreen(): boolean {
  return typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
}

function toggleFullscreen(): void {
  if (isFullscreen()) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

export class SettingsScene implements Scene {
  private cursor = 0;
  private page: 'settings' | 'keys' | 'delete' = 'settings';
  /** On the delete page: which slot, and the slot waiting for a yes or no. */
  private slot = 0;
  private confirming: number | null = null;
  private yes = false;
  private note = '';

  /**
   * `back` is the scene to return to. `playing` is the save slot of the game in progress,
   * if Settings was opened during play: that one can't be deleted from under you.
   */
  constructor(private app: App, private back: Scene, private playing?: number) {}

  private leave(): void {
    this.back.resume?.();
    this.app.go(this.back);
  }

  private rows(): { label: string; value: () => string; run: () => void }[] {
    return [
      { label: 'MUSIC', value: () => (musicOn() ? 'ON' : 'OFF'), run: () => setMusic(!musicOn()) },
      { label: 'SOUND EFFECTS', value: () => (soundOn() ? 'ON' : 'OFF'), run: () => setSound(!soundOn()) },
      {
        label: 'FULL SCREEN',
        value: () => (!canFullscreen() ? 'N/A' : isFullscreen() ? 'ON' : 'OFF'),
        run: () => {
          if (!canFullscreen()) this.note = 'NOT ON THIS DEVICE. ADD THE GAME TO YOUR HOME SCREEN INSTEAD.';
          else toggleFullscreen();
        },
      },
      { label: 'KEYBOARD CONTROLS', value: () => '>', run: () => { this.page = 'keys'; } },
      { label: 'DELETE A SAVE', value: () => '>', run: () => { this.page = 'delete'; this.slot = 0; } },
      { label: 'DONE', value: () => '', run: () => this.leave() },
    ];
  }

  input(a: Action): void {
    if (this.page === 'delete') return this.deleteInput(a);
    if (this.page === 'keys') {
      if (a.kind === 'a' || a.kind === 'b' || a.kind === 'menu') {
        sfx('back');
        this.page = 'settings';
      }
      return;
    }
    const rows = this.rows();
    if (a.kind === 'dir' && (a.dir === 'up' || a.dir === 'down')) {
      this.cursor = (this.cursor + (a.dir === 'up' ? -1 : 1) + rows.length) % rows.length;
      sfx('move');
      return;
    }
    if (a.kind === 'b' || a.kind === 'menu') {
      sfx('back');
      this.leave();
      return;
    }
    if (a.kind === 'a' || (a.kind === 'dir' && (a.dir === 'left' || a.dir === 'right') && this.cursor < 3)) {
      this.note = '';
      rows[this.cursor].run();
      sfx('select'); // after the switch, so turning sound on is heard
    }
  }

  /** The three slots; pick one, then say yes (NO is picked first). */
  private deleteInput(a: Action): void {
    if (this.confirming !== null) {
      if (a.kind === 'dir') {
        this.yes = !this.yes;
        sfx('move');
        return;
      }
      if (a.kind === 'b' || (a.kind === 'a' && !this.yes)) {
        sfx('back');
        this.confirming = null;
        return;
      }
      if (a.kind !== 'a') return;
      Game.deleteSave(this.confirming);
      sfx('hurt');
      this.confirming = null;
      return;
    }
    if (a.kind === 'dir' && (a.dir === 'up' || a.dir === 'down')) {
      this.slot = (this.slot + (a.dir === 'up' ? 2 : 1)) % 3;
      sfx('move');
      return;
    }
    if (a.kind === 'b' || a.kind === 'menu') {
      sfx('back');
      this.page = 'settings';
      return;
    }
    if (a.kind !== 'a') return;
    const n = this.slot + 1;
    if (!Game.slotInfo(n) || n === this.playing) return sfx('back');
    sfx('select');
    this.confirming = n;
    this.yes = false;
  }

  private drawDelete(s: Screen): void {
    s.text('DELETE A SAVE', 10, 2, C.orange);
    for (let i = 0; i < 3; i++) {
      const n = i + 1;
      const info = Game.slotInfo(n);
      const y = 5 + i * 3;
      const on = i === this.slot;
      const locked = n === this.playing;
      s.text(`${n} ${info ? info.name : 'EMPTY'}`, 4, y, !info ? C.darkgrey : on ? C.cream : C.dim);
      if (info) s.text(locked ? 'PLAYING NOW' : info.line, 6, y + 1, locked ? C.darkgrey : C.dim);
      if (on) s.text('>', 2, y, C.gold);
    }
    if (this.confirming !== null) {
      const info = Game.slotInfo(this.confirming);
      s.box(3, 14, 26, 6, C.orange);
      s.text(`DELETE ${info?.name ?? 'THIS GAME'}?`, 5, 15, C.cream);
      s.text('IT CANNOT BE UNDONE.', 5, 16, C.dim);
      s.text('NO', 9, 18, this.yes ? C.dim : C.cream);
      s.text('YES', 19, 18, this.yes ? C.orange : C.dim);
      s.text('>', this.yes ? 17 : 7, 18, C.gold);
    }
    { const h = hint(['A', 'CHOOSE'], ['B', 'BACK']); s.text(h, 16 - Math.ceil(h.length / 2), 21, C.dim); }
  }

  draw(s: Screen): void {
    s.clear(C.black);
    s.box(1, 1, 30, 22, C.grey);
    if (this.page === 'delete') return this.drawDelete(s);
    if (this.page === 'keys') {
      s.text('KEYBOARD CONTROLS', 7, 2, C.gold);
      KEYS.forEach(([key, what], i) => {
        s.text(key, 3, 4 + i, C.cream);
        s.text(what, 10, 4 + i, C.dim);
      });
      s.text('ON A PHONE, USE THE PAD', 3, 17, C.dim);
      s.text('AND BUTTONS UNDER THE MAP.', 3, 18, C.dim);
      { const h = hint(['B', 'BACK']); s.text(h, 16 - Math.ceil(h.length / 2), 21, C.dim); }
      return;
    }
    s.text('SETTINGS', 12, 2, C.gold);
    this.rows().forEach((r, i) => {
      const y = 5 + i * 2 + (r.label === 'DONE' ? 1 : 0);
      const on = i === this.cursor;
      s.text(r.label, 4, y, on ? C.cream : C.dim);
      const v = r.value();
      if (v) s.text(v, 28 - v.length, y, v === 'ON' ? C.green : v === '>' ? C.gold : C.dim);
      if (on) s.text('>', 2, y, C.gold);
    });
    if (this.note) {
      const words = this.note.split(' ');
      let line = '', row = 18;
      for (const w of words) {
        if ((line + ' ' + w).trim().length > 26) { s.text(line, 3, row++, C.orange); line = w; }
        else line = (line + ' ' + w).trim();
      }
      if (line) s.text(line, 3, row, C.orange);
    }
    { const h = hint(['A', 'CHANGE'], ['B', 'BACK']); s.text(h, 16 - Math.ceil(h.length / 2), 21, C.dim); }
  }
}
