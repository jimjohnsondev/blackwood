import { btn, hint } from '../input/labels';
// The play screen: status line, map, message popover, the Items / Stats / Journal
// panels, and the MENU, shop and conversation boxes.
import { playMusic, sfx } from '../audio/sound';
import { SettingsScene } from './settings';
import { Game, type Actor, type Message } from '../game/game';
import { MONSTERS } from '../game/monsters';
import { ITEMS, type ItemId } from '../game/items';
import {
  attackBonus, canUse, countItem, defense, heal, isEquipped, lockpick, magic, maxMp, sneak,
} from '../game/player';
import { questStep, questTitle } from '../game/quests';
import { EndingScene } from './ending';
import { keywordLabel, standingWord } from '../game/people';
import { ATTR_NAMES, BACKGROUNDS, CLASSES, MAX_LEVEL, PERKS, XP_TABLE, mod, signed } from '../game/rules';
import { T, TERRAIN } from '../game/terrain';
import { ICONS } from '../gfx/icons';
import { C, blightColor } from '../gfx/palette';
import type { Screen, Shade } from '../gfx/screen';
import { CHEST_CLOSED, CHEST_OPEN, HORSE, MONSTER_ART, NPC_ART, SCHEMES, playerArt } from '../gfx/sprites';
import { monoOf, type Art } from '../gfx/art';
import { Animator, frameOf } from '../gfx/animate';
import { TILE, TILE_ART, TRAP_ART, siteArt, tileArt, tileFlip } from '../gfx/tiles';
import type { Action, Tab } from '../input/actions';
import type { CastLabel } from '../ui/layout';
import { ListView, type ListItem } from './list';
import type { App, Scene } from './scene';
import { TitleScene } from './title';

type Overlay = 'menu' | 'actions' | 'shop' | 'choice' | 'cast' | null;

// The map sits below the status line: 16 tiles across, about 11.5 tiles down.
const VIEW_TOP = 8;
const VIEW_COLS = 16;
const VIEW_ROWS = 12;

export class PlayScene implements Scene {
  private panel: Tab = 'map';
  private overlay: Overlay = null;
  private list = new ListView(12);
  private menuList = new ListView(10);
  /** Which option the CAST / FIRE strip points at. */
  private castIndex = 0;
  /** The monster aimed spells and arrows will go at (null: the way the player faces). */
  private castTarget: Actor | null = null;
  private shopTab: 'buy' | 'sell' = 'buy';
  private journalTop = 0;
  /** The Journal has two pages: the day-by-day chronicle and what people said about each topic. */
  private journalPage: 'days' | 'quests' | 'topics' = 'days';
  /** The full-screen map (tap MAP again, or press M, while on the map). */
  private mapOpen = false;
  private cursor = { x: 0, y: 0 };
  private shownAt = 0;
  private shownMsg: Message | null = null;

  constructor(private app: App, private game: Game) {
    // A saved game may still owe level-up choices.
    game.offerLevelChoices();
    if (game.choice) this.overlay = 'choice';
  }

  tab(): Tab {
    return this.panel;
  }

  /** The class button: CAST for a wizard, FIRE with a bow or scroll, else LOOK. */
  castLabel(): CastLabel {
    const g = this.game;
    if (g.player.cls === 'wizard') return 'cast';
    return g.quickOptions().length ? 'fire' : 'look';
  }

  // =====================================================================
  // Input
  // =====================================================================

  input(a: Action): void {
    const g = this.game;
    const msg = g.messages[0];

    // A message on screen: A (or B) closes it and does nothing else. Messages that
    // wait for A also block every other input until closed. Passing messages don't
    // get in the way of an open list (MENU, ACTIONS, CAST...): A and B go to the list.
    const listOpen = this.overlay !== null && this.overlay !== 'choice';
    if (msg && (a.kind === 'a' || a.kind === 'b') && (msg.sticky || !listOpen)) {
      g.messages.shift();
      sfx('click');
      return;
    }
    if (msg?.sticky) return;

    if (a.kind === 'tab' && a.tab === 'map' && this.panel === 'map' && !this.overlay && !g.choice) {
      this.mapOpen = !this.mapOpen;
      this.cursor = { x: g.player.x, y: g.player.y };
      this.markIndex = -1;
      sfx(this.mapOpen ? 'select' : 'back');
      return;
    }
    if (a.kind === 'tab') {
      this.mapOpen = false;
      this.overlay = null;
      // A level-up choice waits for you; anything else closes.
      if (!g.choice?.mustChoose) g.choice = null;
      this.panel = a.tab;
      this.list.cursor = 0;
      this.journalTop = 0;
      sfx('move');
      return;
    }

    if (this.mapOpen) return this.mapInput(a);
    if (g.choice || this.overlay === 'choice') return this.choiceInput(a);
    if (this.overlay === 'cast') return this.castInput(a);
    // Tapping a monster on screen opens CAST / FIRE aimed at it.
    if (a.kind === 'point') {
      const foe = this.targetAt(a.x, a.y);
      if (foe && !this.overlay && this.panel === 'map') this.openCast(foe);
      return;
    }
    if (this.overlay === 'menu' || this.overlay === 'actions') return this.menuInput(a);
    if (this.overlay === 'shop') return this.shopInput(a);
    if (this.panel !== 'map') return this.panelInput(a);

    // On the map: every action is a turn (or a free look).
    this.startAction();
    switch (a.kind) {
      case 'dir': g.move(a.dir); break;
      case 'a': g.act(); break;
      case 'look': g.look(); break;
      case 'cast': this.openCast(); break;
      case 'menu':
      case 'actions':
        this.overlay = a.kind;
        this.menuList.cursor = 0;
        sfx('select');
        break;
      case 'b': g.messages = g.messages.filter((m) => m.sticky); break;
    }
    this.finishAction();
  }

  /** New action: short messages from the last turn are cleared away. */
  private startAction(): void {
    this.game.messages = this.game.messages.filter((m) => m.sticky);
  }

  private finishAction(): void {
    const g = this.game;
    if (g.shopOpen) {
      g.shopOpen = false;
      this.overlay = 'shop';
      this.shopTab = 'buy';
      this.list.cursor = 0;
    }
    // Level-up choices still owed come back after any action.
    if (!g.choice && !this.overlay) g.offerLevelChoices();
    if (g.choice) {
      this.overlay = 'choice';
      this.menuList.cursor = g.choice.cursor ?? 0;
    }
  }

  /** Who moved when, for walking and idle animation. */
  private animator = new Animator();
  private animLevel = '';

  /** Which quest place A last jumped to on the big map (-1: none yet). */
  private markIndex = -1;

  private mapInput(a: Action): void {
    const g = this.game;
    // On the big map, A jumps the cursor from one quest place to the next.
    const marks = g.level.kind === 'overworld' ? g.questMarks() : [];
    if (a.kind === 'a' && marks.length) {
      this.markIndex = (this.markIndex + 1) % (marks.length + 1);
      const to = this.markIndex === marks.length ? g.overworld : marks[this.markIndex].site;
      this.cursor = { x: to.x, y: to.y };
      sfx('move');
      return;
    }
    if (a.kind === 'a' || a.kind === 'b' || a.kind === 'menu') {
      this.mapOpen = false;
      sfx('back');
      return;
    }
    if (a.kind === 'dir' && this.game.level.kind === 'overworld') {
      const step = 4;
      const S = this.game.world.size;
      const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[a.dir];
      this.cursor.x = Math.max(0, Math.min(S - 1, this.cursor.x + dx * step));
      this.cursor.y = Math.max(0, Math.min(S - 1, this.cursor.y + dy * step));
    }
  }

  private choiceInput(a: Action): void {
    const g = this.game;
    const choice = g.choice;
    if (!choice) { this.overlay = null; return; }
    if (a.kind === 'dir' && (a.dir === 'up' || a.dir === 'down')) {
      this.menuList.move(a.dir === 'up' ? -1 : 1, choice.options.length);
      sfx('move');
    } else if (a.kind === 'b') {
      if (choice.mustChoose) return;
      g.choice = null;
      this.overlay = null;
      sfx('back');
    } else if (a.kind === 'a') {
      const opt = choice.options[this.menuList.cursor];
      g.choice = null;
      this.overlay = null;
      this.startAction();
      opt.run();
      this.finishAction();
    }
  }

  /** ACTIONS: things the character does. MENU: things about the game itself. */
  private menuOptions(): { label: string; right?: string; run: () => void }[] {
    const g = this.game;
    const opts: { label: string; right?: string; run: () => void }[] = [];
    if (this.overlay === 'actions') {
      opts.push({ label: 'SNEAK', right: g.player.sneaking ? 'ON' : 'OFF', run: () => g.toggleSneak() });
      opts.push({ label: 'LOOK AHEAD', run: () => g.look() });
      opts.push({ label: 'WAIT A TURN', run: () => g.wait() });
      opts.push({ label: g.level.kind === 'town' ? 'REST' : 'MAKE CAMP', run: () => g.rest() });
      return opts;
    }
    opts.push({ label: 'SAVE GAME', run: () => { g.save(); g.say('GAME SAVED.'); } });
    opts.push({ label: 'SETTINGS', run: () => this.app.go(new SettingsScene(this.app, this, Game.slot)) });
    opts.push({ label: 'COPY SEED', right: g.world.seed, run: () => {
      // To share this world: a friend types the seed when starting a new game.
      void navigator.clipboard?.writeText(g.world.seed).catch(() => {});
      g.say(`THE SEED IS ${g.world.seed}. TYPE IT WHEN STARTING A NEW GAME TO WALK THIS SAME WORLD.`);
    } });
    opts.push({ label: 'QUIT TO TITLE', run: () => { g.save(); this.app.go(new TitleScene(this.app)); } });
    return opts;
  }

  /**
   * CAST / FIRE: open the strip on the last thing used (or LOOK if there is nothing to use),
   * aimed at the nearest monster in sight, or the last one aimed at if it is still there.
   */
  private openCast(aim?: Actor): void {
    const g = this.game;
    const opts = g.quickOptions();
    if (!opts.length) return g.look();
    const last = opts.findIndex((o) => o.id === g.player.ready);
    this.castIndex = Math.max(0, last);
    const targets = g.targets();
    this.castTarget = aim && targets.includes(aim) ? aim : targets.includes(this.castTarget!) ? this.castTarget : targets[0] ?? null;
    this.overlay = 'cast';
    sfx('select');
  }

  /** The monster you could shoot at a point on the screen, if any. */
  private targetAt(px: number, py: number): Actor | undefined {
    if (py < VIEW_TOP) return undefined;
    const cam = this.camera();
    const x = Math.floor((px + cam.x) / TILE), y = Math.floor((py - VIEW_TOP + cam.y) / TILE);
    return this.game.targets().find((a) => a.x === x && a.y === y);
  }

  /** In the strip: left/right (or up/down) to choose, A or CAST again to use, B to put it away. */
  private castInput(a: Action): void {
    const g = this.game;
    const opts = g.quickOptions();
    if (!opts.length) { this.overlay = null; return; }
    const use = () => {
      const opt = opts[this.castIndex % opts.length];
      this.overlay = null;
      this.startAction();
      g.useQuick(opt.id, this.castTarget ?? undefined);
      this.finishAction();
    };
    if (a.kind === 'dir' && (a.dir === 'left' || a.dir === 'right')) {
      // Left / right: which spell.
      this.castIndex = (this.castIndex + (a.dir === 'left' ? -1 : 1) + opts.length) % opts.length;
      sfx('move');
    } else if (a.kind === 'dir') {
      // Up / down: which monster.
      const targets = g.targets();
      if (targets.length > 1) {
        const i = this.castTarget ? targets.indexOf(this.castTarget) : -1;
        this.castTarget = targets[(i + (a.dir === 'up' ? -1 : 1) + targets.length) % targets.length];
        sfx('move');
      }
    } else if (a.kind === 'point') {
      // Tap a monster to aim at it; tap it again to fire.
      const foe = this.targetAt(a.x, a.y);
      if (!foe) return;
      if (foe === this.castTarget) return use();
      this.castTarget = foe;
      sfx('move');
    } else if (a.kind === 'menu' || a.kind === 'actions') {
      this.overlay = a.kind;
      this.menuList.cursor = 0;
      sfx('select');
    } else if (a.kind === 'b') {
      this.overlay = null;
      sfx('back');
    } else if (a.kind === 'a' || a.kind === 'cast') {
      use();
    }
  }

  private menuInput(a: Action): void {
    const opts = this.menuOptions();
    if (a.kind === 'dir' && (a.dir === 'up' || a.dir === 'down')) {
      this.menuList.move(a.dir === 'up' ? -1 : 1, opts.length);
      sfx('move');
    } else if (a.kind === 'b' || a.kind === 'menu' || a.kind === 'actions') {
      // The other button switches straight to its list; the same one closes it.
      const other = (a.kind === 'menu' || a.kind === 'actions') && a.kind !== this.overlay;
      this.overlay = other ? a.kind as 'menu' | 'actions' : null;
      this.menuList.cursor = 0;
      sfx(other ? 'select' : 'back');
    } else if (a.kind === 'a') {
      this.overlay = null;
      sfx('select');
      this.startAction();
      opts[this.menuList.cursor].run();
      this.finishAction();
    }
  }

  private shopItems(): ItemId[] {
    const g = this.game;
    if (this.shopTab === 'buy') return g.shopStock();
    return g.player.inventory.map((s) => s.id).filter((id) => ITEMS[id].price > 0);
  }

  private shopInput(a: Action): void {
    const items = this.shopItems();
    if (a.kind === 'dir') {
      if (a.dir === 'left' || a.dir === 'right') {
        this.shopTab = this.shopTab === 'buy' ? 'sell' : 'buy';
        this.list.cursor = 0;
      } else {
        this.list.move(a.dir === 'up' ? -1 : 1, items.length);
      }
      sfx('move');
    } else if (a.kind === 'b') {
      this.overlay = null;
      sfx('back');
    } else if (a.kind === 'a' && items.length) {
      const id = items[this.list.cursor];
      this.startAction();
      if (this.shopTab === 'buy') this.game.buy(id);
      else this.game.sell(id);
      this.finishAction();
    }
  }

  private panelInput(a: Action): void {
    const g = this.game;
    if (a.kind === 'b') {
      this.panel = 'map';
      sfx('back');
      return;
    }
    if (a.kind === 'menu' || a.kind === 'actions') {
      this.panel = 'map';
      this.overlay = a.kind;
      this.menuList.cursor = 0;
      return;
    }
    if (this.panel === 'items') {
      const inv = g.player.inventory;
      if (a.kind === 'dir' && (a.dir === 'up' || a.dir === 'down')) {
        this.list.move(a.dir === 'up' ? -1 : 1, inv.length);
        sfx('move');
      } else if (a.kind === 'a' && inv.length) {
        this.startAction();
        g.useItem(inv[this.list.cursor].id);
        this.finishAction();
      }
    }
    if (this.panel === 'journal' && a.kind === 'dir' && (a.dir === 'left' || a.dir === 'right')) {
      const pages = ['days', 'quests', 'topics'] as const;
      const i = pages.indexOf(this.journalPage) + (a.dir === 'right' ? 1 : -1);
      this.journalPage = pages[(i + pages.length) % pages.length];
      this.journalTop = 0;
      sfx('move');
      return;
    }
    if (this.panel === 'journal' && a.kind === 'dir') {
      if (a.dir === 'up') this.journalTop = Math.max(0, Math.min(this.journalTop, this.pageLines().length - 15) - 1);
      if (a.dir === 'down') this.journalTop++;
    }
  }

  // =====================================================================
  // Drawing
  // =====================================================================

  draw(s: Screen, now: number): void {
    const g = this.game;
    for (const name of g.sounds) sfx(name);
    g.sounds = [];
    playMusic(g.tune());
    // Hard mode: once the last words are read, back to the title.
    // The villain has fallen: the ending, then on with the wandering.
    if (g.ending && !g.messages.length) {
      g.ending = false;
      this.app.go(new EndingScene(this.app, g));
      return;
    }
    if (g.gameOver && !g.messages.length) {
      this.app.go(new TitleScene(this.app));
      return;
    }

    s.clear(C.black);
    if (this.panel === 'map' && this.mapOpen) {
      this.drawFullMap(s, now);
      this.drawStatus(s);
    } else if (this.panel === 'map') {
      this.drawMap(s, now);
      this.drawStatus(s);
      if (this.overlay === 'menu' || this.overlay === 'actions') this.drawMenu(s);
      // Any open choice is drawn, however it was opened (input already goes to it).
      if (g.choice) {
        if (this.overlay !== 'choice') { this.overlay = 'choice'; this.menuList.cursor = g.choice.cursor ?? 0; }
        this.drawChoice(s);
      }
      if (this.overlay === 'shop') this.drawShop(s);
      if (this.overlay === 'cast') this.drawCast(s, now);
    } else {
      this.drawStatus(s);
    }
    if (this.panel === 'items') this.drawItems(s);
    else if (this.panel === 'stats') this.drawStats(s);
    else if (this.panel === 'journal') this.drawJournal(s);
    this.drawPopover(s, now);
  }

  private drawStatus(s: Screen): void {
    const p = this.game.player;
    s.fill(0, 0, 256, 8, C.navy);
    s.text('HP', 1, 0, C.red, C.navy);
    const low = p.hp <= p.maxHp / 4;
    s.text(`${p.hp}/${p.maxHp}`, 4, 0, low ? C.red : C.cream, C.navy);
    if (p.cls === 'wizard') {
      s.text('MP', 11, 0, C.cyan, C.navy);
      s.text(`${p.mp}/${maxMp(p)}`, 14, 0, C.cream, C.navy);
    }
    if (p.ward) s.text('W', 20, 0, C.purple, C.navy);
    if (p.sneaking) {
      if (p.cls === 'wizard') s.text('S', 21, 0, C.green, C.navy);
      else s.text('SNEAK', 11, 0, C.green, C.navy);
    }
    const gold = String(p.gold);
    s.text('GOLD', 26 - gold.length, 0, C.gold, C.navy);
    s.text(gold, 31 - gold.length, 0, C.cream, C.navy);
  }

  private drawMap(s: Screen, now: number): void {
    const g = this.game;
    const p = g.player;
    const level = g.level;
    const outdoorsShade: Shade = g.night && level.kind !== 'dungeon' ? 'night' : 'day';
    const frame = Math.floor(now / 700) % 2;

    // Map tiles are 16x16. `cam` is the map pixel at the top-left of the view.
    const cam = this.camera();
    const toPx = (x: number, y: number) => ({ px: x * TILE - cam.x, py: VIEW_TOP + y * TILE - cam.y });
    const onScreen = (px: number, py: number) => px > -TILE && px < 256 && py > VIEW_TOP - TILE && py < 192;

    // In the dark, light fades in rings towards the edge of the torch's reach.
    const radius = g.lightRadius();
    const lightShade = (x: number, y: number): Shade => {
      const d = Math.hypot(x - p.x, y - p.y) / radius;
      return d <= 0.5 ? 'day' : d <= 0.8 ? 'lit1' : 'lit2';
    };
    // Fresh green in spring, snow in winter and rust in autumn, on the open land only.
    const season = level.kind === 'overworld' ? g.season : 'summer';
    const SEASONAL = new Set([T.Grass, T.Scrub, T.Pine, T.DeadWood, T.Hills]);
    // Blighted land has the colour drained out of it.
    const blighted = level.kind === 'overworld' ? new Set(g.blightedNow()) : new Set<number>();
    const S = g.world.size;
    const greyAt = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S && blighted.has(g.world.regionOf[y * S + x]);
    const seasonal = (tile: number, shade: Shade, x = -1, y = -1): Shade => {
      if (blighted.size && tile !== T.Ocean && tile !== T.Road && greyAt(x, y) && (shade === 'day' || shade === 'night')) {
        return shade === 'day' ? 'blight' : 'blightnight';
      }
      if (!SEASONAL.has(tile) || (shade !== 'day' && shade !== 'night')) return shade;
      if (season === 'winter') return shade === 'day' ? 'snow' : 'snownight';
      if (season === 'autumn' && tile !== T.Pine) return shade === 'day' ? 'autumn' : 'autumnnight';
      if (season === 'spring') return shade === 'day' ? 'spring' : 'springnight';
      return shade;
    };
    const shadeAt = (x: number, y: number): Shade => (level.dark ? lightShade(x, y) : outdoorsShade);

    // A raided hamlet smokes: from its burnt walls inside, and from its icon on the map.
    const raided = level.kind === 'town' && g.siteStatus(level.siteId) === 'raided';
    const smoke: { px: number; py: number; k: number }[] = [];
    const x0 = Math.floor(cam.x / TILE), y0 = Math.floor(cam.y / TILE);
    for (let y = y0; y <= y0 + VIEW_ROWS + 1; y++) {
      for (let x = x0; x <= x0 + VIEW_COLS + 1; x++) {
        let shade: Shade = outdoorsShade;
        if (level.dark) {
          if (g.isVisible(x, y)) shade = lightShade(x, y);
          else if (g.wasSeen(x, y)) shade = 'dim';
          else continue;
        }
        const { px, py } = toPx(x, y);
        const tile = g.tileAt(x, y);
        if (tile === T.Site) {
          const site = g.siteAt(x, y);
          s.art(tileArt(T.Grass, x, y), px, py, seasonal(T.Grass, shade, x, y));
          if (site) s.art(siteArt(site.kind), px, py, shade);
          if (site && g.siteStatus(site.id) === 'raided') smoke.push({ px, py, k: site.id });
          continue;
        }
        if (tile === T.Void) continue;
        s.art(tileArt(tile, x, y), px, py, seasonal(tile, shade, x, y), tileFlip(tile, x, y, frame));
        if (tile === T.Burnt && raided && (x * 7 + y * 11) % 3 === 0) smoke.push({ px, py, k: x * 31 + y });
      }
    }
    for (const sm of smoke) drawSmoke(s, sm.px, sm.py, now, sm.k, g.night);

    for (const trap of g.trapsInSight()) {
      const { px, py } = toPx(trap.x, trap.y);
      if (onScreen(px, py) && (g.isVisible(trap.x, trap.y) || g.wasSeen(trap.x, trap.y))) s.art(TRAP_ART, px, py, g.isVisible(trap.x, trap.y) ? 'day' : 'dim');
    }
    for (const chest of level.chests) {
      const { px, py } = toPx(chest.x, chest.y);
      if (!onScreen(px, py) || !g.isVisible(chest.x, chest.y)) continue;
      s.art(g.isOpened(chest) ? CHEST_OPEN : CHEST_CLOSED, px, py, shadeAt(chest.x, chest.y));
    }

    const sensing = g.turn < g.detectUntil;
    // Animation: walkers step, everyone else breathes; wisps hover. A new place starts fresh.
    if (this.animLevel !== level.id) {
      this.animator.clear();
      this.animLevel = level.id;
    }
    const anim = (id: string, x: number, y: number, pic: Art, flies = false) => frameOf(pic, this.animator.frame(id, x, y, now, flies));
    for (const a of g.actors) {
      const { px, py } = toPx(a.x, a.y);
      if (!onScreen(px, py)) continue;
      if (!g.isVisible(a.x, a.y)) {
        // DETECT: foes beyond your sight show as dim outlines.
        if (sensing && a.monster) s.art(MONSTER_ART[a.monster], px, py, 'dim', a.x > p.x);
        continue;
      }
      if (a.npc) {
        const pic = a.asleep > 0 ? NPC_ART[a.npc.role] : anim(`a${a.id}`, a.x, a.y, NPC_ART[a.npc.role]);
        s.art(pic, px, py, a.asleep > 0 ? 'dim' : outdoorsShade, a.x > p.x);
        if (a.asleep > 0) mark(s, 'Z', px, py, C.cyan);
        else if (g.hasQuestFor(a)) mark(s, '!', px, py, C.gold);
      }
      else if (a.monster) {
        const shade: Shade = a.asleep > 0 ? 'dim' : level.dark ? shadeAt(a.x, a.y) : 'day';
        // The sleeping and the held stay still.
        const still = a.asleep > 0 || !!a.held;
        const pic = still ? MONSTER_ART[a.monster] : anim(`a${a.id}`, a.x, a.y, MONSTER_ART[a.monster], FLIERS.has(a.monster));
        s.art(pic, px, py, shade, a.x > p.x);
        // A small mark over its head: Z asleep, ? hasn't seen you.
        if (a.held) mark(s, 'H', px, py, C.cyan);
        else if (a.asleep > 0) mark(s, 'Z', px, py, C.cyan);
        else if (!a.awake) mark(s, '?', px, py, C.gold);
      }
    }

    const hero = playerArt(p.cls, p.scheme, p.facing);
    const me = toPx(p.x, p.y);
    // Riding: on the map the hero is just the horse, in the hero's own colour.
    if (g.mounted()) s.art(anim('hero', p.x, p.y, riderHorse(p.scheme)), me.px, me.py, 'day', p.facing === 'left');
    else s.art(anim('hero', p.x, p.y, hero.art), me.px, me.py, 'day', hero.flip);
    // A horse left waiting outside a place.
    const waiting = level.kind === 'overworld' ? g.horseSpot() : null;
    if (waiting) {
      const w = toPx(waiting.x, waiting.y);
      if (onScreen(w.px, w.py)) s.art(anim('horse', waiting.x, waiting.y, HORSE), w.px, w.py, outdoorsShade, false);
    }

    // Effects: bolts fly tile by tile, hits flash.
    g.effects = g.effects.filter((e) => {
      // The frame's clock can read a moment earlier than the clock when the effect
      // started, so a brand-new effect may look slightly younger than zero.
      const age = Math.max(0, now - e.start);
      if (e.kind === 'flash') {
        if (age > 160) return false;
        for (const c of e.cells) {
          const { px, py } = toPx(c.x, c.y);
          s.tint(px, py, TILE, e.color, 0.6);
        }
        return true;
      }
      const i = Math.floor(age / 45);
      if (i >= e.cells.length) return false;
      const { px, py } = toPx(e.cells[i].x, e.cells[i].y);
      s.fill(px + 5, py + 5, 6, 6, e.color);
      return true;
    });
  }

  /** The full-screen map: the explored continent at one pixel per tile, or the
   *  current place at four pixels per tile. Unexplored ground stays black. */
  private drawFullMap(s: Screen, now: number): void {
    const g = this.game;
    const blink = Math.floor(now / 350) % 2 === 0;
    const AREA_TOP = 8, AREA_H = 176;
    s.fill(0, AREA_TOP, 256, 184, C.black);

    if (g.level.kind === 'overworld') {
      // Two pixels per tile: half the continent across, panning with the cursor.
      const S = g.world.size;
      const Z = 2;
      const viewW = 256 / Z, viewH = AREA_H / Z;
      const camX = Math.max(0, Math.min(S - viewW, this.cursor.x - viewW / 2));
      const camY = Math.max(0, Math.min(S - viewH, this.cursor.y - viewH / 2));
      const img = s.ctx.createImageData(256, AREA_H);
      const blighted = new Set(g.blightedNow());
      for (let y = 0; y < viewH; y++) {
        for (let x = 0; x < viewW; x++) {
          const i = (y + camY) * S + (x + camX);
          if (!g.explored[i]) continue;
          const t = g.world.tiles[i] as T;
          const site = t === T.Site ? g.world.siteAt.get(i) : undefined;
          const colour = site ? siteArt(site.kind).colors[0] : TILE_ART[t].colors[0];
          // Blighted land shows grey on the map too.
          const rgb = hexToRgb(!site && t !== T.Ocean && blighted.has(g.world.regionOf[i]) ? blightColor(colour) : colour);
          for (let yy = 0; yy < Z; yy++) {
            for (let xx = 0; xx < Z; xx++) {
              const o = ((y * Z + yy) * 256 + x * Z + xx) * 4;
              img.data[o] = rgb[0];
              img.data[o + 1] = rgb[1];
              img.data[o + 2] = rgb[2];
              img.data[o + 3] = 255;
            }
          }
        }
      }
      s.ctx.putImageData(img, 0, AREA_TOP);

      // Places: filled when visited, hollow when only heard of; quest places blink gold.
      const toScreen = (x: number, y: number) => ({ px: (x - camX) * Z + 1, py: AREA_TOP + (y - camY) * Z + 1 });
      for (const k of g.knownSites()) {
        const { px, py } = toScreen(k.site.x, k.site.y);
        if (py < AREA_TOP || py >= AREA_TOP + AREA_H || px < 0 || px >= 256) continue;
        const color = k.quest ? (blink ? C.gold : C.orange) : siteArt(k.site.kind).colors[0];
        s.fill(px - 2, py - 2, 5, 5, C.black);
        if (k.visited) s.fill(px - 1, py - 1, 3, 3, color);
        else {
          s.fill(px - 1, py - 1, 3, 1, color);
          s.fill(px - 1, py + 1, 3, 1, color);
          s.fill(px - 1, py, 1, 1, color);
          s.fill(px + 1, py, 1, 1, color);
        }
      }
      // Quest places: a label beside each one in view, and an arrow at the edge for each one out of it.
      const marks = g.questMarks();
      const inView = (px: number, py: number) => px >= 0 && px < 256 && py >= AREA_TOP && py < AREA_TOP + AREA_H;
      const labels: { x: number; y: number; w: number }[] = [];
      const clear = (x: number, y: number, w: number) => !labels.some((l) => y < l.y + 9 && l.y < y + 9 && x < l.x + l.w && l.x < x + w);
      for (const m of marks) {
        const { px, py } = toScreen(m.site.x, m.site.y);
        const color = m.main ? C.gold : C.cyan;
        const name = m.site.name.replace(/^(THE |RUINS OF |SHRINE OF |BARROW OF |SUNKEN TEMPLE OF |HOLD OF )/, '').slice(0, 10);
        if (inView(px, py)) {
          // A ring round the dot, then the name to the right (or left, near the edge).
          if (blink) {
            s.fill(px - 3, py - 3, 7, 1, color);
            s.fill(px - 3, py + 3, 7, 1, color);
            s.fill(px - 3, py - 3, 1, 7, color);
            s.fill(px + 3, py - 3, 1, 7, color);
          }
          const w = name.length * 8;
          let lx = px + 6 + w <= 256 ? px + 6 : px - 6 - w;
          let ly = Math.max(AREA_TOP, Math.min(AREA_TOP + AREA_H - 8, py - 4));
          for (let tries = 0; tries < 4 && !clear(lx, ly, w); tries++) ly += ly + 18 < AREA_TOP + AREA_H ? 9 : -9;
          labels.push({ x: lx, y: ly, w });
          s.textPx(name, lx, ly, color, C.black);
          continue;
        }
        // Out of view: an arrow pinned to the edge, pointing the way, with the name beside it.
        const cx = 128, cy = AREA_TOP + AREA_H / 2;
        const dx = px - cx, dy = py - cy;
        const t = Math.min(Math.abs((124 - 6) / (dx || 0.001)), Math.abs((AREA_H / 2 - 6) / (dy || 0.001)));
        const ax = Math.round(cx + dx * t), ay = Math.round(cy + dy * t);
        drawArrow(s, ax, ay, dx, dy, color);
        const w = name.length * 8;
        const lx = Math.max(0, Math.min(256 - w, ax - w / 2 - Math.sign(dx) * (w / 2 + 6)));
        let ly = Math.max(AREA_TOP, Math.min(AREA_TOP + AREA_H - 8, ay - 4 - Math.sign(dy) * 9));
        for (let tries = 0; tries < 4 && !clear(lx, ly, w); tries++) ly += ly + 18 < AREA_TOP + AREA_H ? 9 : -9;
        labels.push({ x: lx, y: ly, w });
        s.textPx(name, lx, ly, color, C.black);
      }
      if (marks.length) { const h = `${btn('A')}: NEXT QUEST`; s.textPx(h, 256 - h.length * 8, AREA_TOP, C.dim, C.black); }
      // You.
      const me = toScreen(g.overworld.x, g.overworld.y);
      if (blink) {
        s.fill(me.px - 2, me.py, 5, 1, C.white);
        s.fill(me.px, me.py - 2, 1, 5, C.white);
      }
      // The cursor, and what it is pointing at.
      const c = toScreen(this.cursor.x, this.cursor.y);
      // Four corner brackets around the cursor.
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = c.px + sx * 4, y = c.py + sy * 4;
        s.fill(sx < 0 ? x : x - 1, y, 2, 1, C.gold);
        s.fill(x, sy < 0 ? y : y - 1, 1, 2, C.gold);
      }

      const near = g.knownSites()
        .map((k) => ({ k, d: Math.abs(k.site.x - this.cursor.x) + Math.abs(k.site.y - this.cursor.y) }))
        .filter((n) => n.d <= 4)
        .sort((a, b) => a.d - b.d)[0];
      let label: string;
      const mark = near && marks.find((m) => m.site.id === near.k.site.id);
      if (mark && near!.d <= 1) label = mark.why.length + near!.k.site.name.length + 2 <= 31 ? `${near!.k.site.name}: ${mark.why}` : mark.why;
      else if (near) label = near.k.site.name + (near.k.visited ? '' : ' (UNVISITED)');
      else if (Math.abs(g.overworld.x - this.cursor.x) + Math.abs(g.overworld.y - this.cursor.y) <= 2) label = 'YOU ARE HERE';
      else if (g.explored[this.cursor.y * S + this.cursor.x]) label = TERRAIN[g.world.tiles[this.cursor.y * S + this.cursor.x] as T].name;
      else label = 'UNEXPLORED';
      s.fill(0, 184, 256, 8, C.black);
      s.text(label.slice(0, 31), 1, 23, C.cream);
      return;
    }

    // Inside a place: the whole floor at 4 pixels per tile (only what you've seen, in the dark).
    const level = g.level;
    const scale = Math.max(1, Math.min(4, Math.floor(Math.min(256 / level.w, AREA_H / level.h))));
    const ox = Math.floor((256 - level.w * scale) / 2);
    const oy = AREA_TOP + Math.floor((AREA_H - level.h * scale) / 2);
    for (let y = 0; y < level.h; y++) {
      for (let x = 0; x < level.w; x++) {
        if (level.dark && !g.wasSeen(x, y)) continue;
        const t = g.tileAt(x, y);
        if (t === T.Void) continue;
        let color = TILE_ART[t].colors[0];
        if (t === T.StairsDown || t === T.StairsUp) color = C.white;
        else if (TERRAIN[t].walk && t !== T.Door && t !== T.DDoor && t !== T.Gate) color = dimHex(color);
        s.fill(ox + x * scale, oy + y * scale, scale, scale, color);
      }
    }
    for (const chest of level.chests) {
      if (level.dark && !g.wasSeen(chest.x, chest.y)) continue;
      s.fill(ox + chest.x * scale + 1, oy + chest.y * scale + 1, Math.max(1, scale - 2), Math.max(1, scale - 2), g.isOpened(chest) ? C.darkgrey : C.gold);
    }
    if (blink) s.fill(ox + g.player.x * scale, oy + g.player.y * scale, scale, scale, C.white);
    s.fill(0, 184, 256, 8, C.black);
    s.text(g.placeName().slice(0, 31), 1, 23, C.cream);
  }

  /** Map pixel at the top-left of the view. The player is centred, except that
   *  small maps stop at their edges instead of showing empty space. */
  private camera(): { x: number; y: number } {
    const { player: p, level } = this.game;
    const viewH = 192 - VIEW_TOP;
    const centre = (pos: number, view: number) => pos * TILE + TILE / 2 - Math.floor(view / 2);
    if (level.kind === 'overworld') return { x: centre(p.x, 256), y: centre(p.y, viewH) };
    const axis = (pos: number, size: number, view: number) => {
      const full = size * TILE;
      if (full <= view) return Math.floor((full - view) / 2);
      return Math.max(0, Math.min(full - view, centre(pos, view)));
    };
    return { x: axis(p.x, level.w, 256), y: axis(p.y, level.h, viewH) };
  }

  /** Is the hero drawn at or below this screen row (8px rows)? Boxes there would hide them. */
  private heroBelow(row: number): boolean {
    const g = this.game;
    if (this.panel !== 'map' || this.mapOpen) return false;
    const heroBottom = VIEW_TOP + g.player.y * TILE - this.camera().y + TILE;
    return heroBottom > row * 8 - 2;
  }

  private drawPopover(s: Screen, now: number): void {
    const g = this.game;
    const msg = g.messages[0];
    if (!msg) return;
    if (msg !== this.shownMsg) {
      this.shownMsg = msg;
      this.shownAt = now;
    }
    if (!msg.sticky) {
      const life = g.messages.length > 1 ? 1400 : 2600;
      if (now - this.shownAt > life) {
        g.messages.shift();
        return;
      }
    }
    // At the bottom of the map, unless the hero is down there (say, just through a gate).
    const top = this.heroBelow(20) ? 1 : 20;
    s.box(0, top, 32, 4, C.grey, C.black);
    msg.lines.forEach((line, i) => s.text(line, 1, top + 1 + i, C.cream));
    if (msg.sticky && Math.floor(now / 400) % 2 === 0) s.text('A', 30, top + 2, C.gold, C.black);
  }

  /**
   * The CAST / FIRE strip across the bottom of the map (so it never hides what you
   * are aiming at), plus the aim itself: a dotted path and a blinking frame on the target.
   */
  private drawCast(s: Screen, now: number): void {
    const g = this.game;
    const opts = g.quickOptions();
    if (!opts.length) return;
    const i = this.castIndex % opts.length;
    const o = opts[i];
    const aimed = g.isAimed(o.id);
    const target = this.castTarget && g.actors.includes(this.castTarget) ? this.castTarget : null;

    if (aimed) {
      const cam = this.camera();
      const toPx = (x: number, y: number) => ({ px: x * TILE - cam.x, py: VIEW_TOP + y * TILE - cam.y });
      const path = g.shotPath(target ?? undefined);
      for (const c of path.cells) {
        const { px, py } = toPx(c.x, c.y);
        if (c.x === path.hit?.x && c.y === path.hit?.y) continue;
        s.fill(px + 7, py + 7, 2, 2, C.gold);
      }
      if (path.hit && Math.floor(now / 250) % 2 === 0) {
        const { px, py } = toPx(path.hit.x, path.hit.y);
        // Four corner brackets around the target.
        for (const [cx, cy] of [[0, 0], [12, 0], [0, 12], [12, 12]]) {
          s.fill(px + cx, py + cy, 4, 1, C.gold);
          s.fill(px + cx + (cx ? 3 : 0), py + cy, 1, 4, C.gold);
          s.fill(px + cx, py + cy + (cy ? 3 : 0), 4, 1, C.gold);
        }
      }
    }

    // Along the bottom of the map, unless the hero is down there.
    const top = this.heroBelow(18) ? 1 : 18;
    s.box(0, top, 32, 6, C.grey);
    s.text(g.player.cls === 'wizard' ? 'CAST' : 'FIRE', 2, top, C.gold, C.black);
    s.text(`${i + 1}/${opts.length}`, 29 - String(opts.length).length * 2, top, C.dim, C.black);
    s.text('<', 1, top + 1, opts.length > 1 ? C.gold : C.darkgrey);
    s.text('>', 30, top + 1, opts.length > 1 ? C.gold : C.darkgrey);
    s.text(o.name, 3, top + 1, o.ok ? C.cream : C.darkgrey);
    if (o.cost) s.text(o.cost, 29 - o.cost.length, top + 1, o.ok ? C.cyan : C.red);
    s.text(wrapLines(o.desc, 26)[0], 3, top + 2, C.dim);
    let help: string;
    let color: string = C.dim;
    if (!o.ok) { help = 'NOT ENOUGH MP'; color = C.red; }
    else if (!aimed) help = hint(['A', 'USE'], ['B', 'CANCEL']);
    else if (target) help = `AT ${MONSTERS[target.monster!].name}`.slice(0, 26);
    else help = 'NO TARGET: FIRES AHEAD';
    s.text(help, 3, top + 3, color);
    if (aimed && o.ok && g.targets().length > 1) s.text('UP/DOWN: NEXT TARGET', 3, top + 4, C.darkgrey);
    else if (aimed && o.ok && target) s.text(hint(['A', 'FIRE'], ['B', 'CANCEL']), 3, top + 4, C.darkgrey);
  }

  private drawMenu(s: Screen): void {
    const opts = this.menuOptions();
    const rows = Math.min(opts.length, 10);
    s.box(5, 2, 22, rows + 3, C.grey);
    s.text(this.overlay === 'actions' ? 'ACTIONS' : 'MENU', 7, 2, C.gold, C.black);
    this.menuList.rows = rows;
    this.menuList.draw(s, opts, 6, 4, 20);
  }

  private drawChoice(s: Screen): void {
    const choice = this.game.choice!;
    const text = choice.text ? wrapLines(choice.text, 25).slice(0, 6) : [];
    const gap = text.length ? text.length + 1 : 0;
    // Options with descriptions (perks, skills) show the highlighted one's under the list.
    const hasDesc = choice.options.some((o) => o.desc);
    const descRows = hasDesc ? 3 : 0;
    // Long lists (ASK ABOUT) scroll inside the box.
    const rows = Math.min(choice.options.length, 12 - gap - descRows);
    s.box(2, 4, 28, rows + 4 + gap + descRows, C.grey);
    s.text(choice.title.slice(0, 24), 4, 4, C.gold, C.black);
    text.forEach((l, i) => s.text(l, 4, 6 + i, C.cream));
    this.menuList.rows = rows;
    this.menuList.draw(s, choice.options, 3, 6 + gap, 26);
    const desc = choice.options[this.menuList.cursor]?.desc;
    if (desc) wrapLines(desc, 25).slice(0, 2).forEach((l, i) => s.text(l, 4, 7 + gap + rows + i, C.dim));
  }

  private drawShop(s: Screen): void {
    const g = this.game;
    const items = this.shopItems();
    s.box(0, 1, 32, 19, C.grey);
    s.text('BUY', 2, 2, this.shopTab === 'buy' ? C.gold : C.dim);
    s.text('SELL', 7, 2, this.shopTab === 'sell' ? C.gold : C.dim);
    s.text('< >', 12, 2, C.darkgrey);
    const gold = `${g.player.gold}G`;
    s.text(gold, 30 - gold.length, 2, C.gold);
    const listItems: ListItem[] = items.map((id) => {
      const price = this.shopTab === 'buy' ? g.shopPrice(id) : g.sellPrice(id);
      const owned = this.shopTab === 'sell' ? countItem(g.player, id) : 0;
      const label = ITEMS[id].name + (owned > 1 ? ` X${owned}` : '');
      const blocked = this.shopTab === 'buy' && !canUse(g.player, id);
      return { label, right: `${price}`, icon: ICONS[id], color: blocked ? C.darkgrey : undefined };
    });
    this.list.rows = 10;
    this.list.draw(s, listItems, 1, 4, 29);
    s.hline(14, 1, 30, C.slate);
    const id = items[this.list.cursor];
    if (id) {
      wrapLines(ITEMS[id].desc, 28).slice(0, 2).forEach((l, i) => s.text(l, 2, 15 + i, C.cream));
      if (this.shopTab === 'buy' && !canUse(g.player, id)) s.text(`${CLASSES[g.player.cls].name}S CANNOT USE IT.`, 2, 17, C.orange);
    } else s.text('NOTHING TO SELL.', 2, 15, C.dim);
    s.text(hint(['A', this.shopTab === 'buy' ? 'BUY' : 'SELL'], ['B', 'LEAVE']), 2, 21, C.dim);
  }

  private drawItems(s: Screen): void {
    const g = this.game;
    const p = g.player;
    s.box(0, 1, 32, 19, C.grey);
    s.text('INVENTORY', 2, 2, C.gold);
    const inv = p.inventory;
    const items: ListItem[] = inv.map((stack) => {
      const flag = isEquipped(p, stack.id) ? 'E'
        : (stack.id === 'shortbow' && p.ready === 'bow') || (stack.id === 'scroll' && p.ready === 'scroll') ? 'R'
        : stack.count > 1 ? String(stack.count) : '';
      return { label: ITEMS[stack.id].name, right: flag, icon: ICONS[stack.id] };
    });
    this.list.rows = 10;
    this.list.draw(s, items, 1, 4, 29);
    s.hline(14, 1, 30, C.slate);
    const stack = inv[this.list.cursor];
    if (stack) {
      const item = ITEMS[stack.id];
      wrapLines(item.desc, 28).slice(0, 2).forEach((l, i) => s.text(l, 2, 15 + i, C.cream));
      if (item.dmg) s.text(`DAMAGE ${item.dmg[0]}D${item.dmg[1]}`, 2, 17, C.dim);
      if (isEquipped(p, stack.id)) s.text('EQUIPPED', 18, 17, C.cyan);
      else if (!canUse(p, stack.id)) s.text(`${CLASSES[p.cls].name}S CANNOT USE IT.`, 2, 17, C.orange);
    } else s.text('YOU CARRY NOTHING.', 2, 15, C.dim);
    s.text(hint(['A', 'USE'], ['B', 'BACK']), 2, 21, C.dim);
  }

  private drawStats(s: Screen): void {
    const g = this.game;
    const p = g.player;
    s.box(0, 1, 32, 20, C.grey);
    const hero = playerArt(p.cls, p.scheme, 'down');
    s.art(hero.art, 220, 14);
    s.text(p.name, 2, 2, C.gold);
    s.text(`${CLASSES[p.cls].name}  LEVEL ${p.level}${p.hard ? '  HARD' : ''}`, 2, 3, p.hard ? C.red : C.dim);
    if (p.background) s.text(BACKGROUNDS.find((b) => b.id === p.background)!.name, 2, 6, C.dim);
    s.text('HP', 2, 4, C.red);
    s.text(`${p.hp}/${p.maxHp}`, 6, 4);
    if (p.cls === 'wizard') {
      s.text('MP', 17, 4, C.cyan);
      s.text(`${p.mp}/${maxMp(p)}`, 21, 4);
    }
    s.text('XP', 2, 5, C.dim);
    s.text(p.level >= MAX_LEVEL ? `${p.xp}` : `${p.xp}/${XP_TABLE[p.level + 1]}`, 6, 5);

    ATTR_NAMES.forEach((k, i) => {
      const x = 2 + (i % 2) * 15, y = 7 + Math.floor(i / 2);
      s.text(k.toUpperCase(), x, y, C.grey);
      s.text(String(p.attrs[k]).padStart(2), x + 4, y);
      s.text(signed(mod(p.attrs[k])), x + 7, y, C.dim);
    });
    const derived: [string, string][] = [
      ['ATTACK', signed(attackBonus(p))],
      ['DEFENSE', String(defense(p))],
      ['SNEAK', signed(sneak(p))],
      ['LOCKPICK', signed(lockpick(p))],
      ['MAGIC', signed(magic(p))],
      ['HEAL', signed(heal(p))],
    ];
    derived.forEach(([k, v], i) => {
      const x = 2 + (i % 2) * 15, y = 10 + Math.floor(i / 2);
      s.text(k, x, y, C.dim);
      s.text(v.padStart(3), x + 9, y);
    });
    if (p.perks?.length) {
      const names = p.perks.map((id) => PERKS[p.cls].find((x) => x.id === id)?.name ?? id).join(', ');
      s.text('PERKS', 2, 13, C.dim);
      s.text(names.length > 22 ? names.slice(0, 21) + '+' : names, 8, 13, C.gold);
    }
    const weapon = p.equip.weapon ? ITEMS[p.equip.weapon].name : 'FISTS';
    s.text('WEAPON', 2, 14, C.dim);
    s.text(weapon.slice(0, 21), 9, 14);
    s.text('READY', 2, 15, C.dim);
    // HORSE sits at column 22 on this row, so keep READY short when it shows.
    s.text((p.ready ? p.ready.toUpperCase() : 'NOTHING').slice(0, p.horse ? 12 : 21), 9, 15);
    const here = g.at ? g.world.sites[g.at.siteId] : null;
    if (here && (here.kind === 'village' || here.kind === 'hamlet')) {
      s.text('STANDING', 2, 16, C.dim);
      const rep = g.repOf(here.id);
      s.text(standingWord(rep), 11, 16, rep >= 2 ? C.green : rep <= -2 ? C.orange : C.cream);
    }
    if (!here || (here.kind !== 'village' && here.kind !== 'hamlet')) {
      s.text('DANGER', 2, 16, C.dim);
      const word = g.dangerWord();
      s.text(word, 11, 16, g.dangerHere() >= 5 ? C.red : g.dangerHere() >= 3 ? C.orange : C.cream);
    }
    if (p.horse) {
      s.text('HORSE', 22, 15, C.dim);
      s.text(p.horse.at === null ? 'RIDING' : 'WAITING', 22, 16, C.cream);
    }
    const tod = g.timeOfDay();
    s.text(g.placeName().slice(0, 27 - tod.length), 2, 17);
    s.text(tod, 30 - tod.length, 17, g.night ? C.purple : C.gold);
    s.text(`DAY ${g.day} - ${g.dateOf(g.day)}`, 2, 18, C.dim);
    s.text(g.season.toUpperCase() + (g.season === 'winter' ? ' - PRICES ARE HIGH' : ''), 2, 19, g.season === 'winter' ? C.cream : C.dim);
    s.text(`SEED ${g.world.seed}`, 2, 21, C.dim);
  }

  private journalLines(): { text: string; color: string }[] {
    const g = this.game;
    const q = g.world.quest;
    const f = g.flags;
    const lines: { text: string; color: string }[] = [];
    const add = (text: string, color: string = C.cream) => {
      for (const l of wrapLines(text, 28)) lines.push({ text: l, color });
    };
    // Where to go and what to do next, shown under the current objective.
    const hints = () => {
      for (const h of g.objectiveHints()) {
        wrapLines(h, 24).forEach((l, i) => lines.push({ text: (i === 0 ? '  > ' : '    ') + l, color: C.gold }));
      }
    };
    if (!f.talkedElder) {
      add('NO QUEST YET.', C.gold);
      add(`SPEAK TO ${q.elderName}, THE ELDER OF ${g.villageSite().name}.`, C.dim);
      hints();
    } else {
      add(q.title, C.gold);
      add(q.problem, C.dim);
      lines.push({ text: '', color: C.dim });
      const steps: [boolean, string][] = [
        [f.talkedElder, 'SPEAK TO THE ELDER'],
        [f.searchedChapel, 'SEARCH THE OLD CHAPEL'],
        [f.killedBoss, `DEFEAT ${q.villain}`],
        [f.questDone, `RETURN THE ${q.relic}`],
      ];
      // Acts II and III appear once the elder has told of them.
      if (f.questDone) {
        q.lieutenants.forEach((l, i) => steps.push([!!g.blight.ltDead[i], `SLAY ${l.name}`]));
        steps.push([f.won, `END ${q.villain} IN THE BLIGHT`]);
      }
      const current = steps.findIndex(([done]) => !done);
      steps.forEach(([done, text], i) => {
        lines.push({ text: `[${done ? '+' : ' '}] ${text}`, color: done ? C.dim : C.cream });
        if (i === current) hints();
      });
    }
    // Days, newest first; within a day, in the order things happened.
    const days = [...new Set(g.journal.map((e) => e.day))].sort((a, b) => b - a);
    for (const day of days) {
      lines.push({ text: '', color: C.dim });
      add(`DAY ${day} - ${g.dateOf(day)}`, C.gold);
      for (const e of g.journal.filter((j) => j.day === day)) {
        wrapLines(e.text, 26).forEach((l, i) => lines.push({ text: (i === 0 ? '- ' : '  ') + l, color: C.cream }));
        for (const sub of e.sub) {
          wrapLines(sub, 24).forEach((l, i) => lines.push({ text: (i === 0 ? '  - ' : '    ') + l, color: C.dim }));
        }
      }
    }
    return lines;
  }

  /** The Topics page: everything the player can ask about, with what people said. */
  private topicLines(): { text: string; color: string }[] {
    const g = this.game;
    const lines: { text: string; color: string }[] = [];
    const topics = Object.keys(g.topicNotes)
      .map((k) => ({ k, label: keywordLabel(g.world, k) }))
      .filter((t) => t.label)
      .sort((a, b) => a.label!.localeCompare(b.label!));
    if (!topics.length) {
      for (const l of wrapLines('NOTHING YET. ASK PEOPLE ABOUT PLACES, PEOPLE AND THE NEWS THEY TELL YOU.', 28)) lines.push({ text: l, color: C.dim });
    }
    for (const t of topics) {
      if (lines.length) lines.push({ text: '', color: C.dim });
      lines.push({ text: t.label!.slice(0, 28), color: C.gold });
      for (const note of g.topicNotes[t.k]) {
        wrapLines(note, 26).forEach((l, i) => lines.push({ text: (i === 0 ? '- ' : '  ') + l, color: C.cream }));
      }
    }
    return lines;
  }

  private pageLines(): { text: string; color: string }[] {
    if (this.journalPage === 'topics') return this.topicLines();
    if (this.journalPage === 'quests') return this.questLines();
    return this.journalLines();
  }

  /** Jobs taken: open ones first (what to do next, and by when), then finished ones dimmed. */
  private questLines(): { text: string; color: string }[] {
    const g = this.game;
    const lines: { text: string; color: string }[] = [];
    const open = g.quests.filter((q) => q.state === 'active' || q.state === 'return').reverse();
    const closed = g.quests.filter((q) => q.state === 'done' || q.state === 'failed').reverse();
    if (!open.length && !closed.length) {
      for (const l of wrapLines('NO JOBS YET. PEOPLE WITH A ! OVER THEIR HEADS NEED HELP.', 28)) lines.push({ text: l, color: C.dim });
    }
    for (const q of open) {
      if (lines.length) lines.push({ text: '', color: C.dim });
      lines.push({ text: questTitle(g.world, q).slice(0, 28), color: C.gold });
      const by = q.deadline !== undefined && q.state === 'active' ? ` BY DAY ${q.deadline}.` : '';
      for (const l of wrapLines(questStep(g.world, q) + by, 28)) lines.push({ text: l, color: C.cream });
      lines.push({ text: `${q.gold} GOLD FROM ${q.giver}`.slice(0, 28), color: C.dim });
    }
    if (closed.length) {
      if (lines.length) lines.push({ text: '', color: C.dim });
      for (const q of closed) {
        lines.push({ text: questTitle(g.world, q).slice(0, 22), color: C.dim });
        lines[lines.length - 1].text = lines[lines.length - 1].text.padEnd(23) + (q.state === 'done' ? 'DONE' : 'FAILED');
      }
    }
    return lines;
  }

  private drawJournal(s: Screen): void {
    s.box(0, 1, 32, 19, C.grey);
    const page = this.journalPage;
    const lines = this.pageLines();
    const rows = 15;
    this.journalTop = Math.min(this.journalTop, Math.max(0, lines.length - rows));
    s.text('JOURNAL', 2, 2, page === 'days' ? C.gold : C.dim);
    s.text('QUESTS', 10, 2, page === 'quests' ? C.gold : C.dim);
    s.text('TOPICS', 17, 2, page === 'topics' ? C.gold : C.dim);
    for (let i = 0; i < rows; i++) {
      const l = lines[this.journalTop + i];
      if (l) s.text(l.text, 2, 3 + i, l.color);
    }
    if (this.journalTop > 0) s.text('-', 30, 2, C.dim);
    if (this.journalTop + rows < lines.length) s.text('+', 30, 18, C.dim);
    s.text(`ARROWS SCROLL, PAGE   ${hint(['B', 'BACK'])}`, 2, 21, C.dim);
  }
}

function wrapLines(text: string, width: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ' ' + w;
    else { out.push(line); line = w; }
  }
  if (line || !out.length) out.push(line);
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Floors are drawn darker than walls on the place map, so rooms read as outlines. */
function dimHex(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number) => Math.round(v * 0.6).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Tiny 3x5 marks drawn over a monster's head. */
const MARKS: Record<string, string[]> = {
  '?': ['###', '..#', '.##', '...', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
};

function mark(s: Screen, ch: string, px: number, py: number, color: string): void {
  const rows = MARKS[ch];
  const x0 = px + 12, y0 = py;
  s.fill(x0 - 1, y0 - 1, 5, 7, C.black);
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') s.fill(x0 + x, y0 + y, 1, 1, color); }));
}

/** Smoke rising from a burnt spot: a few grey puffs that drift up, spread and fade, then start again. */
function drawSmoke(s: Screen, px: number, py: number, now: number, k: number, night: boolean): void {
  const SHADES = night ? ['#6a6a7a', '#50505e', '#383844'] : ['#b8b2ae', '#8e8886', '#64605e'];
  for (let i = 0; i < 4; i++) {
    const t = ((now / 2000 + i / 4 + (k % 7) / 7) % 1); // 0 = just risen, 1 = gone
    const rise = Math.floor(t * 26);
    const drift = Math.round(Math.sin(t * 5 + k) * 3 * t);
    const size = t < 0.35 ? 3 : t < 0.7 ? 4 : 5;
    const shade = SHADES[t < 0.35 ? 0 : t < 0.7 ? 1 : 2];
    const y = py + 4 - rise;
    if (y < VIEW_TOP) continue; // never over the status bar
    s.fill(px + 7 + drift - (size >> 1), y, size, size, shade);
  }
}

/** Arrow shapes, 7x7, pointing right and down-right; the other six are turns and flips of these. */
const ARROW_E = ['...#...', '....#..', '.....#.', '#######', '.....#.', '....#..', '...#...'];
const ARROW_SE = ['.......', '.#.....', '..#....', '...#..#', '....#.#', '.....##', '..#####'];

/** A small arrow centred on (x, y) pointing along (dx, dy), for quest places off the edge of the map. */
function drawArrow(s: Screen, x: number, y: number, dx: number, dy: number, color: string): void {
  // Snap to one of eight directions.
  const turn = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)); // -4..4, 0 = east
  const diagonal = Math.abs(turn) % 2 === 1;
  const shape = diagonal ? ARROW_SE : ARROW_E;
  // Quarter turns clockwise needed from the base shape.
  const quarters = ((diagonal ? (turn - 1) / 2 : turn / 2) % 4 + 4) % 4;
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      if (shape[r][c] !== '#') continue;
      let ox = c - 3, oy = r - 3;
      for (let q = 0; q < quarters; q++) [ox, oy] = [-oy, ox];
      s.fill(x + ox, y + oy, 1, 1, color);
    }
  }
}

/** The horse the hero rides, drawn in the hero's colour scheme (one per scheme, made once). */
const riderHorses = new Map<number, Art>();
function riderHorse(scheme: number): Art {
  let a = riderHorses.get(scheme);
  if (!a) {
    a = monoOf(HORSE, (SCHEMES[scheme] ?? SCHEMES[0]).body);
    riderHorses.set(scheme, a);
  }
  return a;
}

/** Creatures that fly hover in place instead of walking. */
const FLIERS = new Set<string>(['wisp']);
