import { hint } from '../input/labels';
// The ending: shown once, when the villain falls. Then the game goes on.
import { playMusic, sfx } from '../audio/sound';
import type { Game } from '../game/game';
import { C } from '../gfx/palette';
import type { Screen } from '../gfx/screen';
import type { Action } from '../input/actions';
import { PlayScene } from './play';
import type { App, Scene } from './scene';

export class EndingScene implements Scene {
  private page = 0;
  private pages: string[][];

  constructor(private app: App, private game: Game) {
    const g = game;
    const q = g.world.quest;
    const p = g.player;
    const jobs = g.quests.filter((x) => x.state === 'done').length;
    this.pages = [
      [
        `${q.villain}, ${q.villainTitle}, IS NO MORE.`,
        '',
        `THE ${q.relic}, MADE WHOLE, RINGS ONCE AND IS STILL. IN THE HIGH WINDOWS OF THE HOLD THE GREY LIGHT TURNS, SLOWLY, TO GOLD.`,
      ],
      [
        'OUT IN THE BLIGHT THE FIRST GREEN SHOWS THROUGH THE ASH. IN THE EMPTY HAMLETS, DOORS WILL OPEN AGAIN.',
        '',
        `IN ${g.villageSite().name}, ${q.elderName} WILL BE WATCHING THE ROAD.`,
      ],
      [
        `${p.name}`,
        `LEVEL ${p.level} ${p.cls.toUpperCase()}`,
        '',
        `DAYS ON THE ROAD  ${g.day}`,
        `PLACES FOUND      ${g.visited.size}`,
        `JOBS DONE         ${jobs}`,
        `SEED  ${g.world.seed}`,
        '',
        'THE WORLD IS STILL YOURS TO WANDER.',
      ],
    ];
  }

  input(a: Action): void {
    if (a.kind !== 'a' && a.kind !== 'b') return;
    sfx('select');
    if (++this.page >= this.pages.length) this.app.go(new PlayScene(this.app, this.game));
  }

  draw(s: Screen): void {
    playMusic('ending');
    s.clear(C.black);
    s.text('THE END', 12, 3, C.gold);
    s.hline(4, 6, 25, C.slate);
    let row = 7;
    for (const para of this.pages[this.page]) {
      for (const line of this.page === 2 ? [para] : wrap(para, 26)) s.text(line, 3, row++, this.page === 2 && row < 10 ? C.gold : C.cream);
      if (!para) row++;
    }
    { const h = hint(['A', this.page < this.pages.length - 1 ? 'NEXT' : 'GO ON']); s.text(h, 16 - Math.ceil(h.length / 2), 21, C.dim); }
  }
}

function wrap(text: string, width: number): string[] {
  if (!text) return [];
  const out: string[] = [];
  let line = '';
  for (const w of text.split(' ')) {
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ' ' + w;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}
