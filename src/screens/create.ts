import { hint } from '../input/labels';
// Character creation: name, class, background, attributes, colours, world seed, then begin.
import { sfx, stopMusic } from '../audio/sound';
import { Game } from '../game/game';
import { attackBonus, createPlayer, defense, heal, lockpick, magic, sneak } from '../game/player';
import { ATTR_NAMES, BACKGROUNDS, CLASSES, mod, signed, type Attrs, type BackgroundId, type ClassId } from '../game/rules';
import { personName } from '../gen/names';
import { Rng, randomSeed } from '../gen/rng';
import { C } from '../gfx/palette';
import type { Screen } from '../gfx/screen';
import { SCHEMES, playerArt } from '../gfx/sprites';
import type { Action } from '../input/actions';
import { ListView } from './list';
import { PlayScene } from './play';
import type { App, Scene } from './scene';
import { TitleScene } from './title';

/** On a touch screen, say how to bring up the keyboard. */
const TAP = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'TAP THE BOX TO TYPE.' : '';

type Step = 'name' | 'class' | 'background' | 'attrs' | 'colours' | 'seed' | 'confirm';
const STEPS: Step[] = ['name', 'class', 'background', 'attrs', 'colours', 'seed', 'confirm'];
const CLASS_IDS: ClassId[] = ['warrior', 'thief', 'wizard'];

export class CreateScene implements Scene {
  private step: Step = 'name';
  private rng = new Rng('create', Date.now());
  private name = personName(this.rng);
  private cls: ClassId = 'warrior';
  private attrs: Attrs = this.roll();
  private scheme = 0;
  private seed = randomSeed();
  private background: BackgroundId = 'farmhand';
  /** Hard mode: permadeath. */
  private hard = false;
  private list = new ListView(6);

  constructor(private app: App) {}

  typing(): boolean {
    return this.step === 'name' || this.step === 'seed';
  }

  /** The text being typed, for the phone keyboard to edit. */
  text(): string {
    if (this.step === 'name') return this.typed.name ? this.name : '';
    if (this.step === 'seed') return this.typed.seed ? this.seed : '';
    return '';
  }

  /** Whether the player has typed here yet: the first letter replaces the made-up name or seed. */
  private typed = { name: false, seed: false };

  setText(value: string): void {
    if (this.step === 'name' || this.step === 'seed') this.typed[this.step] = true;
    if (this.step === 'name') this.name = value.replace(/[^A-Z]/g, '').slice(0, 8);
    if (this.step === 'seed') this.seed = value.replace(/[^A-Z0-9-]/g, '').slice(0, 12);
  }

  private roll(): Attrs {
    const r = () => this.rng.dice(3, 6);
    return { str: r(), dex: r(), wis: r(), con: r() };
  }

  private next(): void {
    sfx('select');
    const i = STEPS.indexOf(this.step);
    this.step = STEPS[i + 1];
    this.list.cursor = this.cursorFor(this.step);
  }

  /** Lists open on the current choice. */
  private cursorFor(step: Step): number {
    if (step === 'class') return CLASS_IDS.indexOf(this.cls);
    if (step === 'background') return BACKGROUNDS.findIndex((b) => b.id === this.background);
    return 0;
  }

  private back(): void {
    sfx('back');
    const i = STEPS.indexOf(this.step);
    if (i === 0) {
      this.app.go(new TitleScene(this.app));
      return;
    }
    this.step = STEPS[i - 1];
    this.list.cursor = this.cursorFor(this.step);
  }

  input(a: Action): void {
    if (a.kind === 'b') return this.back();
    const updown = a.kind === 'dir' && (a.dir === 'up' || a.dir === 'down') ? (a.dir === 'up' ? -1 : 1) : 0;
    const leftright = a.kind === 'dir' && (a.dir === 'left' || a.dir === 'right') ? (a.dir === 'left' ? -1 : 1) : 0;

    switch (this.step) {
      case 'name':
        if (a.kind === 'char' || a.kind === 'backspace') {
          const now = this.text();
          this.setText(a.kind === 'char' ? now + a.ch : now.slice(0, -1));
        }
        if (updown || leftright) { this.name = personName(this.rng); this.typed.name = false; sfx('move'); }
        if (a.kind === 'a') {
          if (!this.name) this.name = personName(this.rng);
          this.next();
        }
        return;
      case 'class':
        if (updown) { this.list.move(updown, 3); this.cls = CLASS_IDS[this.list.cursor]; sfx('move'); }
        if (a.kind === 'a') this.next();
        return;
      case 'background':
        if (updown) { this.list.move(updown, BACKGROUNDS.length); this.background = BACKGROUNDS[this.list.cursor].id; sfx('move'); }
        if (a.kind === 'a') this.next();
        return;
      case 'attrs':
        if (updown) { this.list.move(updown, 2); sfx('move'); }
        if (a.kind === 'a') {
          if (this.list.cursor === 1) { this.attrs = this.roll(); sfx('click'); }
          else this.next();
        }
        return;
      case 'colours':
        if (updown || leftright) { this.scheme = (this.scheme + (updown || leftright) + 4) % 4; sfx('move'); }
        if (a.kind === 'a') this.next();
        return;
      case 'seed':
        if (a.kind === 'char' || a.kind === 'backspace') {
          const now = this.text();
          this.setText(a.kind === 'char' ? now + a.ch : now.slice(0, -1));
        }
        if (updown || leftright) { this.seed = randomSeed(); this.typed.seed = false; sfx('move'); }
        if (a.kind === 'a') {
          if (!this.seed) this.seed = randomSeed();
          this.next();
        }
        return;
      case 'confirm':
        if (updown) { this.list.move(updown, 3); sfx('move'); }
        if (a.kind === 'a') {
          if (this.list.cursor === 1) { this.hard = !this.hard; sfx('click'); return; }
          if (this.list.cursor === 2) return this.back();
          sfx('select');
          stopMusic();
          const game = new Game({
            name: this.name, cls: this.cls, scheme: this.scheme, attrs: this.attrs, seed: this.seed,
            background: this.background, hard: this.hard,
          });
          // Seed RAID starts beside a freshly raided hamlet, to see the world tick at work.
          if (this.seed === 'RAID') game.setupRaidDemo();
          game.save();
          this.app.go(new PlayScene(this.app, game));
        }
        return;
    }
  }

  draw(s: Screen, now: number): void {
    s.clear(C.black);
    s.fill(0, 0, 256, 8, C.navy);
    s.text('NEW ADVENTURER', 1, 0, C.gold, C.navy);
    s.text(`${STEPS.indexOf(this.step) + 1}/${STEPS.length}`, 28, 0, C.dim, C.navy);
    const blink = Math.floor(now / 400) % 2 === 0;
    const hero = (x: number, y: number, scale: number) => {
      const { art } = playerArt(this.cls, this.scheme, 'down');
      s.artScaled(art, x, y, scale);
    };

    switch (this.step) {
      case 'name':
        s.text('WHAT IS YOUR NAME?', 2, 3, C.cream);
        s.box(2, 5, 14, 3, C.grey);
        s.text(this.name + (blink ? '#' : ' '), 3, 6, C.cream);
        s.text(TAP, 2, 9, C.gold);
        s.text('TYPE A NAME, OR PRESS', 2, 10, C.dim);
        s.text('UP AND DOWN FOR ANOTHER.', 2, 11, C.dim);
        s.text(hint(['A', 'NEXT'], ['B', 'BACK']), 2, 21, C.dim);
        return;

      case 'class': {
        s.text('CHOOSE YOUR CLASS', 2, 3, C.cream);
        this.list.draw(s, CLASS_IDS.map((c) => ({ label: CLASSES[c].name })), 2, 5, 14);
        hero(184, 24, 3);
        CLASSES[this.cls].blurb.forEach((line, i) => s.text(line, 2, 10 + i, C.dim));
        s.text(`HIT DIE  D${CLASSES[this.cls].hitDie}`, 2, 14, C.grey);
        s.text(`MAIN     ${CLASSES[this.cls].main.toUpperCase()}`, 2, 15, C.grey);
        s.text(hint(['A', 'NEXT'], ['B', 'BACK']), 2, 21, C.dim);
        return;
      }

      case 'background': {
        s.text('WHERE DO YOU COME FROM?', 2, 3, C.cream);
        s.text('A SMALL HEAD START.', 2, 4, C.dim);
        // Each background's bonus sits beside its name, so you can compare at a glance.
        this.list.draw(s, BACKGROUNDS.map((b) => ({ label: b.name, right: b.gives })), 2, 6, 28);
        const bg = BACKGROUNDS.find((b) => b.id === this.background)!;
        s.text(bg.name, 2, 13, C.gold);
        wrap(bg.desc, 28).forEach((line, i) => s.text(line, 2, 14 + i, C.cream));
        s.text(hint(['A', 'NEXT'], ['B', 'BACK']), 2, 21, C.dim);
        return;
      }

      case 'attrs': {
        s.text('ROLL YOUR ATTRIBUTES', 2, 3, C.cream);
        s.text('3D6 EACH, IN ORDER.', 2, 4, C.dim);
        ATTR_NAMES.forEach((k, i) => {
          const v = this.attrs[k];
          s.text(k.toUpperCase(), 2, 6 + i, C.grey);
          s.text(String(v).padStart(2), 7, 6 + i, C.cream);
          s.text(signed(mod(v)), 11, 6 + i, mod(v) < 0 ? C.red : mod(v) > 0 ? C.lime : C.dim);
        });
        const p = createPlayer(this.name, this.cls, this.scheme, this.attrs, this.background);
        const derived: [string, string][] = [
          ['HP', String(p.maxHp)],
          ['ATTACK', signed(attackBonus(p))],
          ['DEFENSE', String(defense(p))],
          ['SNEAK', signed(sneak(p))],
          ['LOCKPICK', signed(lockpick(p))],
          ['MAGIC', signed(magic(p))],
          ['HEAL', signed(heal(p))],
        ];
        derived.forEach(([k, v], i) => {
          s.text(k, 17, 6 + i, C.dim);
          s.text(v.padStart(3), 27, 6 + i, C.cream);
        });
        this.list.draw(s, [{ label: 'KEEP THESE' }, { label: 'ROLL AGAIN' }], 2, 15, 14);
        s.text(hint(['A', 'CHOOSE'], ['B', 'BACK']), 2, 21, C.dim);
        return;
      }

      case 'colours':
        s.text('CHOOSE YOUR COLOURS', 2, 3, C.cream);
        hero(80, 36, 6);
        s.text(`< ${SCHEMES[this.scheme].name} >`, 16 - Math.ceil((SCHEMES[this.scheme].name.length + 4) / 2), 17, C.cream);
        s.text(hint(['A', 'NEXT'], ['B', 'BACK']), 2, 21, C.dim);
        return;

      case 'seed':
        s.text('WORLD SEED', 2, 3, C.cream);
        s.text('THE SAME SEED ALWAYS MAKES', 2, 5, C.dim);
        s.text('THE SAME WORLD. SHARE IT!', 2, 6, C.dim);
        s.box(2, 8, 16, 3, C.grey);
        s.text(this.seed + (blink ? '#' : ' '), 3, 9, C.gold);
        s.text(TAP, 2, 12, C.gold);
        s.text('TYPE ONE, OR PRESS UP AND', 2, 13, C.dim);
        s.text('DOWN FOR A RANDOM SEED.', 2, 14, C.dim);
        s.text(hint(['A', 'NEXT'], ['B', 'BACK']), 2, 21, C.dim);
        return;

      case 'confirm': {
        hero(184, 20, 4);
        s.text(this.name, 2, 3, C.gold);
        s.text(`${CLASSES[this.cls].name}  LEVEL 1`, 2, 4, C.dim);
        s.text(BACKGROUNDS.find((b) => b.id === this.background)!.name, 2, 5, C.dim);
        ATTR_NAMES.forEach((k, i) => {
          s.text(`${k.toUpperCase()} ${String(this.attrs[k]).padStart(2)}`, 2 + (i % 2) * 9, 6 + Math.floor(i / 2), C.cream);
        });
        s.text(`SEED ${this.seed}`, 2, 9, C.dim);
        s.text('YOU WAKE AT THE GATE OF A', 2, 11, C.dim);
        s.text('VILLAGE IN THE VALE...', 2, 12, C.dim);
        this.list.draw(s, [
          { label: 'BEGIN' },
          { label: 'HARD MODE', right: this.hard ? 'ON' : 'OFF' },
          { label: 'GO BACK' },
        ], 2, 14, 18);
        if (this.list.cursor === 1) s.text(this.hard ? 'DEATH IS FOREVER.' : 'DIE AND WAKE IN THE TEMPLE.', 2, 18, this.hard ? C.red : C.dim);
        s.text(hint(['A', 'CHOOSE'], ['B', 'BACK']), 2, 21, C.dim);
        return;
      }
    }
  }
}

/** Break text into lines of at most `width` characters. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > width) { lines.push(line); line = word; }
    else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}
