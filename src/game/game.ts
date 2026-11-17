import { named } from '../input/labels';
// The game itself: one object holding the world, the player and the current map,
// and one method per thing the player can do. It never touches the screen;
// the screens read it and draw.
import { DIRS, type Dir } from '../input/actions';
import { fixChests } from '../gen/reach';
import { personName } from '../gen/names';
import { biomeAround, buildLevel, depthOf, floorsOf, overworldLevel } from '../gen/levels';
import { habitatFor } from '../gen/outdoor';
import { Rng } from '../gen/rng';
import type { Chest, Level, NpcSpawn, Site, Trap, TrapKind, World } from '../gen/types';
import { generateWorld } from '../gen/world';
import { packBits, unpackBits } from './bits';
import { dateOf } from './calendar';
import { compass, distanceWords, rumour, type Rumour } from './dialogue';
import {
  ask, buyRate, greeting, keywordLabel, personKey, roleWords, sellRate, siteTitle, traitOf, whereIs,
  type Keyword, type Person, type Trait,
} from './people';
import { placeStrongboxes } from '../gen/strongbox';
import { placeGuards } from '../gen/guards';
import { DANGER_WORDS, dangerAt, LANDMARKS, monsterTier, regionAt, TIER_PREFIX, type RegionType } from '../gen/regions';
import type { MonsterInfo } from './monsters';
import {
  bandsNear, catchUp, clearLair, hamletStatus, lairBeast, lairSites, newWorldState, recentEvents,
  type WorldState,
} from '../sim/world';
import { caravanAt, caravans } from '../sim/caravans';
import { blightedRegions, newBlight, type BlightState } from '../sim/blight';
import {
  deadlineFor, farSpot, questOffers, questPitch, questStep, questThanks, questTitle, type SideQuest,
} from './quests';
import { seasonOf, type Season } from './calendar';
import { planRoutines, stepTowards, watchAt, type Routine, type Watch } from './routines';
import { ITEMS, SHOP_STOCK, TRADER_STOCK, type ItemId } from './items';
import { MONSTERS, monstersFor, packSize, type MonsterId } from './monsters';
import {
  addItem, attackBonus, bestBow, canUse, countItem, createPlayer, damageBonus, defense, equipItem, hasItem, hasPerk, heal, isEquipped, trained,
  lockpick, magic, maxMp, removeItem, sneak, weaponDice, type Player,
} from './player';
import type { Ready } from './player';
import {
  ATTR_LEVELS, ATTR_NAMES, CLASSES, HARD, MAX_LEVEL, PERK_LEVELS, PERKS, SKILLS, SPELLS, XP_TABLE, mod,
  type Attrs, type BackgroundId, type ClassId, type Spell,
} from './rules';
import { T, TERRAIN, walkable } from './terrain';

// ---------- things the screens read ----------

export interface Actor {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  name: string;
  monster?: MonsterId;
  npc?: NpcSpawn;
  boss?: boolean;
  /** Has noticed the player. */
  awake: boolean;
  /** Turns left asleep (Sleep spell). */
  asleep: number;
  /** Sneak checks already made against this monster (far, then adjacent). */
  checks: number;
  /** Townsfolk: where they go at each time of day. */
  routine?: Routine;
  /** Turns left frozen by HOLD (unlike sleep, a blow doesn't break it). */
  held?: number;
  /** Stronger forms far from the Vale: 1 GRIM, 2 DIRE, 3 ELDER, 4 DREAD. */
  tier?: number;
  /** A caravan's trader, by caravan id. */
  caravan?: number;
  /** Someone who fled the Blight. */
  refugee?: boolean;
  /** One of the villain's lieutenants (0 or 1), or the villain in the stronghold. */
  lieutenant?: number;
  final?: boolean;
  /** The villain's second wind has been spent. */
  phase2?: boolean;
  /** It has already raised its cry (wolves call the pack once). */
  called?: boolean;
  /** Part of a side quest: the lost person to rescue, or what stirs at night. */
  questId?: string;
}

/** Something the CAST / FIRE button can use. */
export type QuickId = NonNullable<Ready>;
export interface QuickOption {
  id: QuickId;
  name: string;
  /** "2MP", "FREE", "X3" (scrolls left). */
  cost: string;
  desc: string;
  /** False when there isn't enough MP. */
  ok: boolean;
}

export interface Message {
  lines: string[];
  /** Stays until the player presses A. */
  sticky: boolean;
}

export interface Choice {
  title: string;
  /** A line or two under the title (what the speaker says on greeting). */
  text?: string;
  options: { label: string; right?: string; desc?: string; run: () => void }[];
  /** Which option the cursor starts on. */
  cursor?: number;
  /** Can't be dismissed with B (level-up choices). */
  mustChoose?: boolean;
}

export interface Effect {
  kind: 'bolt' | 'flash';
  cells: { x: number; y: number }[];
  color: string;
  start: number;
}

/** One line in the Journal's chronicle, with optional details under it. */
export interface JournalEntry {
  kind: 'start' | 'talk' | 'discover' | 'defeat' | 'gold' | 'found' | 'bought' | 'quest' | 'level' | 'death' | 'caught' | 'gift';
  /** Game day it happened on (day 1 = the day the journey began). */
  day: number;
  text: string;
  sub: string[];
  /** Who was talked to, for merging repeat conversations. */
  who?: string;
  monster?: MonsterId;
  item?: ItemId;
  count?: number;
  amount?: number;
}

export type QuestFlag = 'talkedElder' | 'searchedChapel' | 'killedBoss' | 'questDone' | 'won';

export interface Creation {
  name: string;
  cls: ClassId;
  scheme: number;
  attrs: Attrs;
  seed: string;
  background?: BackgroundId;
  /** Hard mode: permadeath. */
  hard?: boolean;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const START_TIME = 8 * 60; // day 1, 08:00
// Its own save slot, so the MVP and the full game never overwrite each other.
const SAVE_KEY = 'blackwood-full-save-v1';
/** 2: the bigger continent with regions (milestone 4). Older saves can't load. */
const SAVE_VERSION = 2;

export class Game {
  world: World;
  player: Player;
  level!: Level;
  actors: Actor[] = [];
  /** Where the player is: null = overworld, else a site and floor. */
  at: { siteId: number; floor: number } | null = null;
  /** The player's overworld position (the site tile while inside a site). */
  overworld = { x: 0, y: 0 };

  time = START_TIME;
  turn = 0;
  steps = 0;
  /** When the player last made camp, so camping can't be repeated straight away. */
  lastCamp = -Infinity;
  flags: Record<QuestFlag, boolean> = { talkedElder: false, searchedChapel: false, killedBoss: false, questDone: false, won: false };
  /** Acts II and III: the Blight's clock, the lieutenants, the day the villain fell. */
  blight: BlightState = newBlight();
  /** The last day the game saved itself. */
  private savedDay = 0;
  /** First-time tips already shown. */
  tips: string[] = [];
  /** Set when the villain falls: the screen shows the ending, then play goes on. */
  ending = false;
  /** The Journal's chronicle of things that mattered. */
  journal: JournalEntry[] = [];
  /** Sites the player has been inside. */
  visited = new Set<number>();
  /** Sites someone has told the player about (shown on the map before a visit). */
  heardOf = new Set<number>();
  /** Overworld tiles the player has seen, for the map's fog of war. */
  explored: Uint8Array = new Uint8Array(0);

  /** Changes to generated maps, by key "levelId:x,y" or chest id. */
  openedChests = new Set<string>();
  unlockedDoors = new Set<string>();
  removedTraps = new Set<string>();
  /** Traps the player has spotted (drawn on the floor; walking into one tries to disarm it). */
  seenTraps = new Set<string>();
  /** Traps already given their one chance to be spotted this visit. */
  private checkedTraps = new Set<string>();
  /** Floors whose lever has been pulled. */
  pulledLevers = new Set<string>();
  /** Floors emptied of monsters on this visit to a site: they stay empty until you leave. */
  clearedFloors = new Set<string>();
  shrineDays: Record<number, number> = {};

  /** Hard mode death: the play screen returns to the title once the last message is read. */
  gameOver = false;

  /** The world tick: lairs, raids and news. */
  worldState!: WorldState;
  /** Which stock the open shop sells: a village shop or a caravan. */
  shopFrom: 'shop' | 'trader' = 'shop';

  /** DETECT shows foes through the dark until this turn. */
  detectUntil = 0;

  // ---------- people ----------
  /** People, quest words and gossip topics the player can ASK ABOUT (places come from the map). */
  keywords = new Set<Keyword>();
  /** What people said about each topic, for the Journal's Topics page. */
  topicNotes: Record<Keyword, string[]> = {};
  /** How each settlement feels about the player, -10 to +10, by site id. */
  rep: Record<number, number> = {};
  /** Times caught stealing in each settlement. */
  offences: Record<number, number> = {};
  /** Settlements the player may not enter until the given day. */
  bannedUntil: Record<number, number> = {};
  /** What individual people remember about the player, by person key. */
  memories: Record<string, string[]> = {};
  /** The last day the player gave to a temple or beggar, by person key. */
  giftDays: Record<string, number> = {};
  /** Side quests the player has taken, in the order taken. */
  quests: SideQuest[] = [];
  private offerCache = new Map<string, SideQuest[]>();
  /** Strongboxes the player has already chosen to steal from (so it only asks once each). */
  stealOk = new Set<string>();

  // Read by the screens each frame.
  messages: Message[] = [];
  choice: Choice | null = null;
  shopOpen = false;
  /** Who runs the shop that is open, for the journal. */
  shopkeeper = '';
  sounds: string[] = [];
  effects: Effect[] = [];
  visible: Uint8Array = new Uint8Array(0);
  seen = new Map<string, Uint8Array>();
  dead = false;

  private rng: Rng;
  private nextActorId = 1;
  private levelCache = new Map<string, Level>();

  constructor(c: Creation) {
    this.world = generateWorld(c.seed);
    this.rng = new Rng(c.seed, 'play', Date.now());
    this.player = createPlayer(c.name, c.cls, c.scheme, c.attrs, c.background, c.hard);
    this.worldState = newWorldState(this.world);
    this.explored = new Uint8Array(this.world.size * this.world.size);
    const village = this.villageSite();
    this.overworld = { x: village.x, y: village.y };
    this.enterSite(village, 1, 'entry', true);
    this.visited.add(village.id);
    this.note({ kind: 'start', text: `BEGAN YOUR JOURNEY IN ${village.name}`, sub: [] });
    this.say(`WELCOME TO ${village.name}, ${this.player.name}.`);
    this.say(`THE ELDER, ${this.world.quest.elderName}, WISHES TO SPEAK WITH YOU.`);
    this.tip('start');
  }

  /** A first-time hint, shown once per game. */
  private tip(id: keyof typeof TIPS): void {
    if (this.tips.includes(id)) return;
    this.tips.push(id);
    this.say(`TIP: ${TIPS[id]()}`, true);
  }

  // =====================================================================
  // Queries used by the screens
  // =====================================================================

  get day(): number { return Math.floor(this.time / 1440) + 1; }
  get hour(): number { return Math.floor((this.time % 1440) / 60); }
  get night(): boolean { return this.hour >= 20 || this.hour < 6; }

  timeOfDay(): string {
    const h = this.hour;
    if (h < 6) return 'NIGHT';
    if (h < 9) return 'DAWN';
    if (h < 12) return 'MORNING';
    if (h < 17) return 'AFTERNOON';
    if (h < 21) return 'EVENING';
    return 'NIGHT';
  }

  /** Where the player is, for the Stats panel. */
  placeName(): string {
    if (!this.at) return regionAt(this.world, this.player.x, this.player.y).name;
    const site = this.world.sites[this.at.siteId];
    return this.level.floors > 1 ? `${site.name} ${this.at.floor}` : site.name;
  }

  /** Riding: on the open map with your horse. */
  mounted(): boolean {
    return this.level.kind === 'overworld' && this.player.horse?.at === null;
  }

  /** Where the horse waits, if not under you. */
  horseSpot(): { x: number; y: number } | null {
    const at = this.player.horse?.at;
    if (at === undefined || at === null) return null;
    const site = this.world.sites[at];
    return site ? { x: site.x + 1, y: site.y } : null;
  }

  /** How dangerous it is here, in a word (SAFE ... CURSED). */
  dangerWord(): string {
    return DANGER_WORDS[this.dangerHere()];
  }

  tileAt(x: number, y: number): T {
    if (x < 0 || y < 0 || x >= this.level.w || y >= this.level.h) return this.level.outside;
    return this.level.tiles[y * this.level.w + x] as T;
  }

  actorAt(x: number, y: number): Actor | undefined {
    return this.actors.find((a) => a.x === x && a.y === y);
  }

  chestAt(x: number, y: number): Chest | undefined {
    return this.level.chests.find((c) => c.x === x && c.y === y);
  }

  isOpened(chest: Chest): boolean {
    return this.openedChests.has(chest.id);
  }

  isVisible(x: number, y: number): boolean {
    if (!this.level.dark) return true;
    if (x < 0 || y < 0 || x >= this.level.w || y >= this.level.h) return false;
    return this.visible[y * this.level.w + x] === 1;
  }

  wasSeen(x: number, y: number): boolean {
    if (!this.level.dark) return true;
    if (x < 0 || y < 0 || x >= this.level.w || y >= this.level.h) return false;
    return this.seen.get(this.level.id)![y * this.level.w + x] === 1;
  }

  siteAt(x: number, y: number): Site | undefined {
    if (this.at) return undefined;
    return this.world.siteAt.get(y * this.world.size + x);
  }

  villageSite(): Site {
    return this.world.sites[this.world.quest.villageId];
  }

  /** The wizard's spells: those that come with level, then those learned from tomes. */
  spells(): Spell[] {
    const p = this.player;
    if (p.cls !== 'wizard') return [];
    const book = p.spellbook ?? [];
    return SPELLS.filter((s) => (s.tome ? book.includes(s.id) : s.level <= p.level));
  }

  // =====================================================================
  // Player actions (each one is a turn unless it says otherwise)
  // =====================================================================

  move(dir: Dir): void {
    if (this.dead) return;
    const p = this.player;
    p.facing = dir;
    const [dx, dy] = DIRS[dir];
    const nx = p.x + dx, ny = p.y + dy;

    // Leaving an open-air site by its edge.
    if (this.level.kind === 'outdoor' && (nx < 0 || ny < 0 || nx >= this.level.w || ny >= this.level.h)) {
      this.leaveSite();
      return;
    }

    const other = this.actorAt(nx, ny);
    if (other?.monster) {
      this.meleeAttack(other);
      this.endTurn();
      return;
    }
    if (other?.npc) {
      // Someone blocking a doorway (or a guard on your heels) steps past you; otherwise talk.
      if (this.inTheWay(other)) {
        other.x = p.x;
        other.y = p.y;
        p.x = nx;
        p.y = ny;
        this.say(`YOU SQUEEZE PAST ${other.name}.`);
        this.endTurn();
        return;
      }
      this.talk(other);
      return;
    }
    const chest = this.chestAt(nx, ny);
    if (chest) {
      this.openChest(chest);
      return;
    }
    const tile = this.tileAt(nx, ny);
    if (tile === T.LockedDoor) {
      this.pickDoor(nx, ny);
      return;
    }
    if (tile === T.Lever) return this.pullLever();
    if (!TERRAIN[tile].walk) return; // just turn to face it
    const known = this.level.traps.find((t) => t.x === nx && t.y === ny && this.seenTraps.has(this.trapKey(t)));
    if (known) return this.disarmTrap(known);

    p.x = nx;
    p.y = ny;
    if (this.level.kind === 'overworld') this.overworld = { x: nx, y: ny };
    if (this.level.kind !== 'overworld' || this.turn % 2 === 0) this.sounds.push('step');

    if (this.onEnter(nx, ny, tile)) return;
    // On horseback along a road: a second step in the same turn.
    if (this.mounted() && tile === T.Road) {
      const [dx, dy] = DIRS[dir];
      const x2 = nx + dx, y2 = ny + dy;
      if (this.tileAt(x2, y2) === T.Road && !this.actorAt(x2, y2)) {
        p.x = x2;
        p.y = y2;
        this.overworld = { x: x2, y: y2 };
        this.markExplored();
      }
    }
    // Wading is slow, and so is sneaking: the world gets a second turn for every step.
    if (tile === T.Shallows || (p.sneaking && !hasPerk(p, 'shadowstep'))) {
      this.endTurn();
      if (this.dead) return;
    }
    this.endTurn();
  }

  /** Let a turn pass without doing anything (good for letting a monster come to you). */
  wait(): void {
    if (this.dead) return;
    this.endTurn();
  }

  /** SNEAK on or off (from ACTIONS). */
  toggleSneak(): void {
    const p = this.player;
    p.sneaking = !p.sneaking;
    this.say(p.sneaking ? 'YOU MOVE SLOWLY AND QUIETLY. ATTACKING WILL END IT.' : 'YOU STOP SNEAKING.');
  }

  /**
   * How hard the player is to notice, by a given monster: Sneak, +5 while sneaking,
   * +3 in the dark (night outdoors, or beyond the reach of your light underground).
   */
  stealth(watcher?: { x: number; y: number }): number {
    const p = this.player;
    let n = sneak(p);
    if (p.sneaking) n += 5;
    const outdoors = this.level.kind === 'overworld' || this.level.kind === 'town' || this.level.kind === 'outdoor';
    if (outdoors && this.night) n += 3;
    else if (this.level.dark && watcher && Math.hypot(watcher.x - p.x, watcher.y - p.y) > this.lightRadius()) n += 3;
    return n;
  }

  /** Attacking gives the player away. */
  private stopSneaking(): void {
    if (this.player.sneaking) {
      this.player.sneaking = false;
      this.say('YOU ARE NO LONGER SNEAKING.');
    }
  }

  /** A: talk, open, use what's in front, or fire the readied bow or spell. */
  act(): void {
    if (this.dead) return;
    const p = this.player;
    const [dx, dy] = DIRS[p.facing];
    const fx = p.x + dx, fy = p.y + dy;
    const other = this.actorAt(fx, fy);
    if (other?.npc) return this.talk(other);
    const chest = this.chestAt(fx, fy);
    if (chest) return this.openChest(chest);
    const tile = this.tileAt(fx, fy);
    if (tile === T.LockedDoor) return this.pickDoor(fx, fy);
    if (tile === T.Lever) return this.pullLever();
    if (tile === T.Altar) return this.useAltar();
    if (tile === T.Statue) return this.useStatue();
    if (tile === T.Well) return this.say('YOU DRAW COOL WATER AND DRINK.');
    if (other?.monster) {
      this.meleeAttack(other);
      return this.endTurn();
    }
    // Nothing in front and nothing readied: A does nothing, silently.
  }

  look(): void {
    const p = this.player;
    const [dx, dy] = DIRS[p.facing];
    const fx = p.x + dx, fy = p.y + dy;
    const other = this.actorAt(fx, fy);
    if (other && this.isVisible(fx, fy)) {
      if (other.monster) {
        const hurt = other.hp < other.maxHp / 2 ? ' IT IS BADLY HURT.' : '';
        const mood = other.asleep > 0 ? ' IT IS ASLEEP.' : !other.awake ? ' IT HAS NOT SEEN YOU.' : '';
        return this.say(`YOU SEE ${article(other.name)}.${mood}${hurt}`);
      }
      return this.say(`YOU SEE ${other.name}, ${roleName(other.npc!.role)}.`);
    }
    const chest = this.chestAt(fx, fy);
    if (chest) return this.say(this.isOpened(chest) ? 'AN OPEN CHEST.' : chest.locked ? 'A LOCKED CHEST.' : 'A CHEST.');
    const site = this.siteAt(fx, fy) ?? this.siteAt(p.x, p.y);
    if (site) return this.say(`${site.name}. STEP ONTO IT TO ENTER.`);
    if (!this.isVisible(fx, fy)) return this.say('TOO DARK TO SEE.');
    const here = TERRAIN[this.tileAt(fx, fy)].look;
    this.say(`${here} ${this.timeOfDay()} OF DAY ${this.day}.`);
  }

  // ---------- items ----------

  useItem(id: ItemId): void {
    const p = this.player;
    const item = ITEMS[id];
    switch (item.kind) {
      case 'weapon':
      case 'armour':
      case 'shield':
        if (!canUse(p, id)) return this.say(`A ${CLASSES[p.cls].name} CANNOT USE ${item.name}.`);
        if (isEquipped(p, id) && item.kind !== 'weapon') {
          if (item.kind === 'armour') p.equip.armour = undefined;
          else p.equip.shield = undefined;
          this.say(`YOU TAKE OFF THE ${item.name}.`);
        } else {
          equipItem(p, id);
          this.say(`YOU READY THE ${item.name}.`);
        }
        this.sounds.push('equip');
        return this.endTurn();
      case 'bow':
        if (!canUse(p, id)) return this.say(`A ${CLASSES[p.cls].name} CANNOT USE A BOW.`);
        p.ready = 'bow';
        return this.say('SHOOT IT WITH THE FIRE BUTTON.');
      case 'scroll':
        p.ready = 'scroll';
        return this.say(`READ IT WITH ${named('CAST')}, AIMED AT A FOE.`);
      case 'torch':
        if (!this.level.dark) return this.say('SAVE YOUR TORCHES FOR DARK PLACES. THEY LIGHT THEMSELVES THERE.');
        removeItem(p, 'torch');
        p.light = { turns: 400, radius: 5 };
        this.sounds.push('equip');
        this.say('YOU LIGHT A TORCH.');
        this.updateVisibility();
        return;
      case 'potion': {
        removeItem(p, id);
        this.sounds.push('drink');
        if (id === 'healing') {
          const amount = Math.max(1, this.rng.dice(2, 4, 2) + heal(p));
          p.hp = Math.min(p.maxHp, p.hp + amount);
          this.say(`YOU DRINK. +${amount} HP.`);
        } else {
          if (p.cls !== 'wizard') this.say('YOU FEEL CLEAR-HEADED, BUT HAVE NO MAGIC TO RESTORE.');
          else {
            const amount = this.rng.dice(2, 4);
            p.mp = Math.min(maxMp(p), p.mp + amount);
            this.say(`YOU DRINK. +${amount} MP.`);
          }
        }
        return this.endTurn();
      }
      case 'tome': {
        const spell = SPELLS.find((x) => x.id === item.spell)!;
        if (p.cls !== 'wizard') return this.say('THE RUNES SWIM BEFORE YOUR EYES. ONLY A WIZARD COULD READ THEM.');
        if ((p.spellbook ?? []).includes(spell.id)) return this.say(`YOU ALREADY KNOW ${spell.name}.`);
        if (p.level < spell.level) return this.say(`TOO DEEP FOR YOU YET. COME BACK AT LEVEL ${spell.level}.`);
        removeItem(p, id);
        (p.spellbook ??= []).push(spell.id);
        this.sounds.push('levelup');
        this.say(`YOU STUDY THE TOME AND LEARN ${spell.name}. ${spell.desc}`, true);
        this.note({ kind: 'level', text: `LEARNED THE ${spell.name} SPELL`, sub: [] });
        return this.endTurn();
      }
      default:
        return this.say(item.desc);
    }
  }

  // ---------- the CAST / FIRE button ----------

  /** What the CAST / FIRE button can use now: the wizard's spells, the bow, fire scrolls. */
  quickOptions(): QuickOption[] {
    const p = this.player;
    const out: QuickOption[] = [];
    for (const spell of this.spells()) {
      out.push({ id: spell.id, name: spell.name, cost: spell.mp ? `${spell.mp}MP` : 'FREE', desc: spell.desc, ok: p.mp >= spell.mp });
    }
    const bow = bestBow(p);
    if (bow && canUse(p, bow)) {
      out.push({ id: 'bow', name: ITEMS[bow].name, cost: '', desc: 'AN ARROW. D6 DAMAGE.', ok: true });
    }
    if (hasItem(p, 'scroll')) {
      out.push({ id: 'scroll', name: 'FIRE SCROLL', cost: `X${countItem(p, 'scroll')}`, desc: 'FLAMES, 3D6. USED UP.', ok: true });
    }
    return out;
  }

  /** Use a spell, the bow or a scroll, and remember it for next time. Aimed ones go at `target`, if given. */
  useQuick(id: QuickId, target?: Actor): void {
    if (this.dead) return;
    this.player.ready = id;
    if (id === 'bow' || id === 'scroll') return this.fire(id, target);
    this.cast(id, target);
  }

  /** Does this option shoot at something (and so want a target)? */
  isAimed(id: QuickId): boolean {
    return id === 'bow' || id === 'scroll' || id === 'spark' || id === 'fireball' || id === 'hold' || id === 'chain';
  }

  /**
   * Monsters the player could shoot right now: on screen, in sight, and with nothing
   * else in the way. Nearest first.
   */
  targets(): Actor[] {
    const p = this.player;
    return this.actors
      .filter((a) => a.monster && Math.abs(a.x - p.x) <= 7 && Math.abs(a.y - p.y) <= 5 && this.isVisible(a.x, a.y))
      .filter((a) => this.shotPath(a).hit === a)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
  }

  /**
   * Where a shot goes: a straight line at any angle towards `target` (or the way the
   * player faces), up to 8 steps, stopping at walls and at the first person or monster.
   */
  shotPath(target?: { x: number; y: number }): { cells: { x: number; y: number }[]; hit?: Actor } {
    const p = this.player;
    let [dx, dy] = DIRS[p.facing];
    if (target && (target.x !== p.x || target.y !== p.y)) {
      dx = target.x - p.x;
      dy = target.y - p.y;
    }
    const n = Math.max(Math.abs(dx), Math.abs(dy));
    const cells: { x: number; y: number }[] = [];
    for (let i = 1; i <= 8; i++) {
      const x = p.x + Math.round((dx * i) / n), y = p.y + Math.round((dy * i) / n);
      const tile = this.tileAt(x, y);
      if (TERRAIN[tile].opaque || tile === T.LockedDoor) break;
      cells.push({ x, y });
      const a = this.actorAt(x, y);
      if (a?.monster) return { cells, hit: a };
      if (a?.npc) break;
    }
    return { cells };
  }

  /** Turn to face roughly towards a point (so the sprite looks where it shoots). */
  private faceTowards(x: number, y: number): void {
    const p = this.player;
    const dx = x - p.x, dy = y - p.y;
    if (dx === 0 && dy === 0) return;
    p.facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }

  cast(id: Spell['id'], target?: Actor): void {
    const p = this.player;
    const spell = SPELLS.find((s) => s.id === id)!;
    if (p.mp < spell.mp) return this.say(`NOT ENOUGH MP FOR ${spell.name}.`);
    if (id === 'spark' || id === 'fireball') return this.fire(id, target);
    if (id === 'blink') return this.blink();
    if (id === 'hold' || id === 'chain') return this.aimedSpell(id, target);
    if (id === 'recall') return this.recall();
    p.mp -= spell.mp;
    this.sounds.push('spell');
    if (id === 'ward') {
      let points = 5 + p.level + Math.max(0, mod(p.attrs.wis));
      if (hasPerk(p, 'arcaneward')) points = Math.floor(points * 1.5);
      p.ward = { points, turns: hasPerk(p, 'arcaneward') ? 160 : 80 };
      this.say(`A SHIMMERING WARD SURROUNDS YOU. IT WILL SOAK UP ${points} DAMAGE.`);
    } else if (id === 'mend') {
      const amount = Math.max(1, this.rng.dice(1, 6) + heal(p));
      p.hp = Math.min(p.maxHp, p.hp + amount);
      this.say(`WARMTH FLOWS THROUGH YOU. +${amount} HP.`);
    } else if (id === 'glow') {
      p.light = { turns: 300, radius: 7 };
      this.say('A COLD WHITE LIGHT FLOATS ABOVE YOU.');
      this.updateVisibility();
    } else if (id === 'sleep') {
      const maxLevel = 3 + Math.floor(p.level / 3);
      let n = 0;
      for (const a of this.actors) {
        if (!a.monster || a.boss) continue;
        if (Math.abs(a.x - p.x) + Math.abs(a.y - p.y) > 4) continue;
        if (MONSTERS[a.monster].level > maxLevel) continue;
        a.asleep = 8;
        n++;
      }
      this.say(n ? `${n} FOE${n > 1 ? 'S FALL' : ' FALLS'} ASLEEP.` : 'NOTHING NEARBY FALLS ASLEEP.');
    } else if (id === 'shield') {
      p.shielded = 40;
      this.say('A WALL OF FORCE HANGS BEFORE YOU. DEFENSE +4.');
    } else if (id === 'detect') {
      // Mark every foe and chest within 16 steps on the map, for a while.
      const near = (o: { x: number; y: number }) => Math.max(Math.abs(o.x - p.x), Math.abs(o.y - p.y)) <= 16;
      const foes = this.actors.filter((a) => a.monster && near(a));
      const chests = this.level.chests.filter((c) => near(c) && !this.isOpened(c));
      this.detectUntil = this.turn + 30;
      const seen = this.seen.get(this.level.id);
      if (seen) for (const c of chests) seen[c.y * this.level.w + c.x] = 1;
      const traps = this.level.traps.filter(near);
      for (const t of traps) this.seenTraps.add(this.trapKey(t));
      if (traps.length) this.say(`AND ${traps.length} TRAP${traps.length === 1 ? '' : 'S'}, NOW PLAIN TO SEE.`);
      this.say(`YOU SENSE ${foes.length} FOE${foes.length === 1 ? '' : 'S'} AND ${chests.length} CHEST${chests.length === 1 ? '' : 'S'} NEARBY.`);
    } else if (id === 'banish') {
      const undead = this.actors.filter((a) => a.monster && UNDEAD.includes(a.monster) && Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) <= 5);
      this.effects.push({ kind: 'flash', cells: undead.map((a) => ({ x: a.x, y: a.y })), color: '#ffffcc', start: now() });
      if (!undead.length) this.say('HOLY LIGHT FLARES, BUT NO UNDEAD ARE NEAR.');
      for (const a of undead) {
        let dmg = Math.max(1, this.rng.dice(3, 6) + mod(p.attrs.wis));
        if (a.boss) dmg = Math.ceil(dmg / 2);
        this.damageMonster(a, dmg, `HOLY LIGHT SEARS ${the(a)} FOR ${dmg}.`);
      }
    }
    this.endTurn();
  }

  /** HOLD and CHAIN BOLT: aimed like SPARK. */
  private aimedSpell(id: 'hold' | 'chain', aim?: Actor): void {
    const p = this.player;
    const spell = SPELLS.find((s) => s.id === id)!;
    if (aim && this.actors.includes(aim)) this.faceTowards(aim.x, aim.y);
    else aim = undefined;
    const { cells, hit } = this.shotPath(aim);
    p.mp -= spell.mp;
    this.stopSneaking();
    this.sounds.push('spell');
    this.effects.push({ kind: 'bolt', cells, color: id === 'hold' ? '#88ccff' : '#ffff66', start: now() });
    if (!hit) {
      this.say(`YOUR ${spell.name} FINDS NO TARGET.`);
      return this.endTurn();
    }
    if (id === 'hold') {
      if (hit.boss) this.say(`${the(hit)} SHRUGS OFF YOUR HOLD.`);
      else {
        hit.held = 6;
        hit.awake = true;
        this.say(`${the(hit)} IS FROZEN IN PLACE.`);
      }
      return this.endTurn();
    }
    // CHAIN BOLT: the first foe, then leaps to up to two more within 3 steps.
    const struck: Actor[] = [hit];
    let from = hit;
    for (let i = 0; i < 2; i++) {
      const next = this.actors
        .filter((a) => a.monster && !struck.includes(a) && Math.max(Math.abs(a.x - from.x), Math.abs(a.y - from.y)) <= 3)
        .sort((a, b) => dist(a, from) - dist(b, from))[0];
      if (!next) break;
      this.effects.push({ kind: 'bolt', cells: [{ x: from.x, y: from.y }, { x: next.x, y: next.y }], color: '#ffff66', start: now() });
      struck.push(next);
      from = next;
    }
    struck.forEach((a, i) => {
      const dmg = Math.max(1, (i === 0 ? this.rng.dice(2, 6) : this.rng.dice(1, 6)) + mod(p.attrs.wis));
      if (this.actors.includes(a)) this.damageMonster(a, dmg, `LIGHTNING STRIKES ${the(a)} FOR ${dmg}.`);
    });
    this.endTurn();
  }

  /** RECALL: straight back to the temple of the starting village. */
  private recall(): void {
    const p = this.player;
    p.mp -= SPELLS.find((s) => s.id === 'recall')!.mp;
    this.sounds.push('spell');
    const village = this.villageSite();
    this.overworld = { x: village.x, y: village.y };
    this.enterSite(village, 1, 'entry', true);
    const priest = this.actors.find((a) => a.npc?.role === 'priest');
    if (priest) {
      const spot = this.freeNeighbour(priest.x, priest.y);
      if (spot) { p.x = spot.x; p.y = spot.y; }
    }
    this.say(`THE WORLD FOLDS AWAY. YOU STAND IN THE TEMPLE OF ${village.name}.`);
    this.updateVisibility();
    this.save();
  }

  /** BLINK: vanish and reappear 3 to 6 steps away, as far from danger as possible. */
  private blink(): void {
    const p = this.player;
    const foes = this.actors.filter((a) => a.monster && a.asleep === 0);
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 3) continue;
        const x = p.x + dx, y = p.y + dy;
        if (x < 0 || y < 0 || x >= this.level.w || y >= this.level.h) continue;
        const tile = this.tileAt(x, y);
        if (!TERRAIN[tile].walk || tile === T.Site || tile === T.Gate || tile === T.StairsUp || tile === T.StairsDown) continue;
        if (this.actorAt(x, y) || this.chestAt(x, y)) continue;
        if (this.level.dark && !this.wasSeen(x, y)) continue;
        if (!this.clearLine(p.x, p.y, x, y)) continue;
        const nearest = foes.length ? Math.min(...foes.map((f) => Math.max(Math.abs(f.x - x), Math.abs(f.y - y)))) : 10;
        const score = nearest * 10 + this.rng.next();
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
    }
    if (!best) return this.say('THERE IS NOWHERE TO BLINK TO.');
    p.mp -= 2;
    this.effects.push({ kind: 'flash', cells: [{ x: p.x, y: p.y }], color: '#aa88ff', start: now() });
    p.x = best.x;
    p.y = best.y;
    if (this.level.kind === 'overworld') this.overworld = { x: p.x, y: p.y };
    this.effects.push({ kind: 'flash', cells: [best], color: '#aa88ff', start: now() });
    this.sounds.push('spell');
    this.say('YOU BLINK AWAY.');
    this.updateVisibility();
    this.endTurn();
  }

  rest(): void {
    const p = this.player;
    if (this.level.kind === 'town') return this.say('FIND THE INN TO REST HERE.');
    if (this.actors.some((a) => a.monster && a.awake && a.asleep === 0 && dist(a, p) < 9)) {
      return this.say('YOU CANNOT REST WITH ENEMIES NEAR.');
    }
    if (this.time - this.lastCamp < 12 * 60) return this.say('YOU ARE NOT TIRED ENOUGH TO SLEEP AGAIN YET.');
    this.lastCamp = this.time;
    this.say('YOU MAKE CAMP AND SLEEP.');
    const risky = this.night || this.level.kind === 'dungeon';
    if (risky && this.rng.chance(0.35) && this.rng.dice(1, 20) + this.stealth() < 12) {
      this.advanceTime(180);
      p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp / 4));
      this.say('SOMETHING FINDS YOU IN THE NIGHT!', true);
      this.spawnAmbush();
      this.sounds.push('hurt');
    } else {
      // A night on the ground mends half your hurts; a bed at an inn mends them all.
      this.advanceTime(8 * 60);
      p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp / 2));
      p.mp = maxMp(p);
      this.say(p.hp >= p.maxHp ? 'YOU WAKE RESTED.' : 'YOU WAKE STIFF AND SORE, BUT BETTER. AN INN BED WOULD MEND THE REST.');
      this.sounds.push('rest');
    }
    this.updateVisibility();
  }

  // ---------- shops, inns and temples ----------

  buy(id: ItemId): void {
    const p = this.player;
    const price = this.shopPrice(id);
    if (p.gold < price) return this.say('YOU CANNOT AFFORD THAT.');
    if (id === 'horse') {
      if (p.horse) return this.say('YOU ALREADY HAVE A HORSE.');
      p.gold -= price;
      // It waits outside this village until you ride out.
      p.horse = { at: this.at ? this.at.siteId : null };
      this.note({ kind: 'bought', text: `BOUGHT A HORSE IN ${this.hereSite().name}`, sub: [] });
      this.sounds.push('coin');
      return this.say(`BOUGHT A HORSE FOR ${price} GOLD. IT WAITS OUTSIDE THE GATE.`);
    }
    p.gold -= price;
    addItem(p, id);
    this.noteBought(id, 1);
    this.sounds.push('coin');
    this.say(`BOUGHT ${ITEMS[id].name} FOR ${price} GOLD.`);
  }

  sell(id: ItemId): void {
    const p = this.player;
    const price = this.sellPrice(id);
    if (price <= 0) return this.say('NOBODY WILL BUY THAT.');
    removeItem(p, id);
    p.gold += price;
    this.sounds.push('coin');
    this.say(`SOLD ${ITEMS[id].name} FOR ${price} GOLD.`);
  }

  /** What the shop here asks: cheaper where the player is liked, dearer where not. */
  shopPrice(id: ItemId): number {
    const winter = this.season === 'winter' ? 1.15 : 1;
    return Math.max(1, Math.round(ITEMS[id].price * buyRate(this.repOf(this.hereSite().id)) * winter));
  }

  /** What the shop here pays for one of the player's things. */
  sellPrice(id: ItemId): number {
    const rate = sellRate(this.repOf(this.hereSite().id)) * (hasPerk(this.player, 'fence') ? 1.25 : 1);
    return Math.floor(ITEMS[id].price * rate);
  }

  shopStock(): ItemId[] {
    return this.shopFrom === 'trader' ? TRADER_STOCK : SHOP_STOCK;
  }

  // =====================================================================
  // Saving
  // =====================================================================

  toSave(): string {
    return JSON.stringify({
      v: SAVE_VERSION,
      seed: this.world.seed,
      player: this.player,
      at: this.at,
      overworld: this.overworld,
      time: this.time,
      turn: this.turn,
      steps: this.steps,
      lastCamp: this.lastCamp,
      flags: this.flags,
      blight: this.blight,
      tips: this.tips,
      journal: this.journal,
      visited: [...this.visited],
      heardOf: [...this.heardOf],
      explored: packBits(this.explored),
      seen: Object.fromEntries([...this.seen].map(([id, bits]) => [id, packBits(bits)])),
      openedChests: [...this.openedChests],
      unlockedDoors: [...this.unlockedDoors],
      removedTraps: [...this.removedTraps],
      seenTraps: [...this.seenTraps],
      pulledLevers: [...this.pulledLevers],
      clearedFloors: [...this.clearedFloors],
      shrineDays: this.shrineDays,
      keywords: [...this.keywords],
      topicNotes: this.topicNotes,
      rep: this.rep,
      offences: this.offences,
      bannedUntil: this.bannedUntil,
      memories: this.memories,
      giftDays: this.giftDays,
      quests: this.quests,
      worldState: this.worldState,
    });
  }

  /** Which of the three save slots this session plays in. */
  static slot = 1;

  /** Slot 1 keeps the old single-save key, so earlier saves turn up there. */
  private static keyFor(slot: number): string {
    return slot === 1 ? SAVE_KEY : `${SAVE_KEY}-${slot}`;
  }

  save(): void {
    try {
      localStorage.setItem(Game.keyFor(Game.slot), this.toSave());
    } catch {
      // Storage can be full or blocked; the game carries on.
    }
  }

  static deleteSave(slot = Game.slot): void {
    try {
      localStorage.removeItem(Game.keyFor(slot));
    } catch {
      // nothing to do
    }
  }

  /** A save from before the world grew (version 1) can't be loaded into the new map. */
  static hasOldSave(slot = Game.slot): boolean {
    try {
      const raw = localStorage.getItem(Game.keyFor(slot));
      return !!raw && (JSON.parse(raw).v ?? 1) < SAVE_VERSION;
    } catch {
      return false;
    }
  }

  static hasSave(slot = Game.slot): boolean {
    try {
      return !!localStorage.getItem(Game.keyFor(slot));
    } catch {
      return false;
    }
  }

  /** What's in a slot, for the title screen: "MARDRIC  L5 WARRIOR  DAY 26", or null if empty. */
  static slotInfo(slot: number): { name: string; line: string; old: boolean } | null {
    try {
      const raw = localStorage.getItem(Game.keyFor(slot));
      if (!raw) return null;
      const s = JSON.parse(raw);
      const old = (s.v ?? 1) < SAVE_VERSION;
      const p = s.player ?? {};
      const day = Math.floor((s.time ?? 0) / 1440) + 1;
      return { name: p.name ?? '?', line: old ? 'FROM AN OLDER WORLD' : `L${p.level} ${String(p.cls).toUpperCase()}  DAY ${day}`, old };
    } catch {
      return null;
    }
  }

  static load(slot = Game.slot): Game | null {
    try {
      const raw = localStorage.getItem(Game.keyFor(slot));
      if (!raw) return null;
      Game.slot = slot;
      return Game.fromSave(raw);
    } catch {
      return null;
    }
  }

  static fromSave(raw: string): Game {
    const s = JSON.parse(raw);
    if ((s.v ?? 1) < SAVE_VERSION) throw new Error('This save is from before the world grew.');
    const p = s.player as Player;
    const g = new Game({ name: p.name, cls: p.cls, scheme: p.scheme, attrs: p.attrs, seed: s.seed });
    g.player = p;
    g.time = s.time;
    g.turn = s.turn;
    g.steps = s.steps;
    g.lastCamp = s.lastCamp ?? -Infinity;
    // Items that no longer exist in the game (like old rations) are dropped.
    p.inventory = p.inventory.filter((stack) => stack.id in ITEMS);
    g.flags = { ...g.flags, ...s.flags };
    g.blight = { ...newBlight(), ...(s.blight ?? {}) };
    // Saves from before tips existed belong to players who know the ropes.
    g.tips = s.tips ?? Object.keys(TIPS);
    g.savedDay = g.day;
    g.journal = (s.journal ?? []).map((e: JournalEntry) => ({ ...e, day: e.day ?? 1 }));
    g.visited = new Set(s.visited ?? []);
    g.heardOf = new Set(s.heardOf ?? []);
    if (s.explored) g.explored = unpackBits(s.explored, g.world.size * g.world.size);
    for (const [id, text] of Object.entries((s.seen ?? {}) as Record<string, string>)) {
      const [, siteId, floor] = id.split(':').map(Number);
      const level = g.getLevel(g.world.sites[siteId], floor);
      g.seen.set(id, unpackBits(text, level.w * level.h));
    }
    g.openedChests = new Set(s.openedChests);
    g.unlockedDoors = new Set(s.unlockedDoors);
    g.removedTraps = new Set(s.removedTraps);
    g.seenTraps = new Set(s.seenTraps ?? []);
    g.pulledLevers = new Set(s.pulledLevers ?? []);
    g.clearedFloors = new Set(s.clearedFloors ?? []);
    g.shrineDays = s.shrineDays;
    g.keywords = new Set(s.keywords ?? []);
    g.topicNotes = s.topicNotes ?? {};
    g.rep = s.rep ?? {};
    g.offences = s.offences ?? {};
    g.bannedUntil = s.bannedUntil ?? {};
    g.memories = s.memories ?? {};
    g.giftDays = s.giftDays ?? {};
    g.quests = s.quests ?? [];
    g.worldState = s.worldState ?? newWorldState(g.world);
    g.overworld = s.overworld;
    g.messages = [];
    g.levelCache.clear();
    const pos = { x: p.x, y: p.y };
    if (s.at) {
      g.enterSite(g.world.sites[s.at.siteId], s.at.floor, 'entry', true);
      // If the place has changed shape since the save (a newer version), start at its way in.
      if (TERRAIN[g.tileAt(pos.x, pos.y)].walk) {
        g.player.x = pos.x;
        g.player.y = pos.y;
      }
    } else {
      g.goOverworld();
    }
    g.updateVisibility();
    g.say(`WELCOME BACK, ${p.name}.`);
    return g;
  }

  // =====================================================================
  // Moving between maps
  // =====================================================================

  private getLevel(site: Site, floor: number): Level {
    const id = `site:${site.id}:${floor}`;
    let level = this.levelCache.get(id);
    if (!level) {
      level = buildLevel(this.world, site, floor);
      // Apply what the player has already changed here.
      for (let i = 0; i < level.tiles.length; i++) {
        if (level.tiles[i] === T.LockedDoor && this.unlockedDoors.has(`${id}:${i % level.w},${Math.floor(i / level.w)}`)) {
          level.tiles[i] = T.DDoor;
        }
      }
      level.traps = level.traps.filter((t) => !this.removedTraps.has(`${id}:${t.x},${t.y}`));
      if (this.pulledLevers.has(id)) openWorks(level);
      if (site.kind === 'village' || site.kind === 'hamlet') {
        level.npcs = [...level.npcs, ...placeGuards(this.world.seed, site, level)];
        level.chests = [...level.chests, ...placeStrongboxes(this.world.seed, site, level)];
        fixChests(level); // a strongbox must never be hemmed in by beds and tables
      }
      this.levelCache.set(id, level);
    }
    return level;
  }

  /**
   * A raided hamlet shows its scars: blackened walls, fallen stones and ash in the streets.
   * Fewer while it recovers. Works on a copy, so the hamlet is whole again once rebuilt.
   */
  private scorched(level: Level, status: 'raided' | 'recovering'): Level {
    const raidDay = this.worldState.raids[level.siteId] ?? 0;
    const rng = new Rng(this.world.seed, 'scorch', level.siteId, raidDay);
    const tiles = level.tiles.slice();
    const heavy = status === 'raided';
    const busy = new Set([...level.npcs, ...level.chests].map((p) => p.y * level.w + p.x));
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const roll = rng.next();
      if (t === T.Wall) {
        if (roll < (heavy ? 0.1 : 0.03)) tiles[i] = T.Rubble;
        else if (roll < (heavy ? 0.45 : 0.15)) tiles[i] = T.Burnt;
      } else if ((t === T.Dirt || t === T.Cobble || t === T.WoodFloor) && !busy.has(i)) {
        if (roll < (heavy ? 0.14 : 0.04)) tiles[i] = T.Ash;
      }
    }
    return { ...level, tiles };
  }

  private setLevel(level: Level): void {
    const scars = level.kind === 'town' ? this.siteStatus(level.siteId) : null;
    if (scars) level = this.scorched(level, scars);
    this.level = level;
    this.actors = [];
    this.effects = [];
    // A raided hamlet is half empty; while it recovers, a few are still missing.
    const status = level.siteId !== undefined && level.kind === 'town' ? this.siteStatus(level.siteId) : null;
    let villagerNo = 0;
    const empty = level.kind === 'town' && this.abandoned(level.siteId);
    for (const n of level.npcs) {
      if (empty) break; // the Blight has driven everyone out
      if (status && (n.role === 'villager' || n.role === 'beggar' || n.role === 'guard')) {
        villagerNo++;
        if (status === 'raided' && (n.role === 'guard' || villagerNo % 2 === 0)) continue;
        if (status === 'recovering' && villagerNo % 3 === 0) continue;
      }
      const name = n.role === 'elder' ? this.world.quest.elderName : n.name;
      this.actors.push({ id: this.nextActorId++, x: n.x, y: n.y, hp: 1, maxHp: 1, name, npc: n, awake: false, asleep: 0, checks: 0 });
    }
    // Villages and hamlets keep a daily routine: start everyone where they'd be now.
    // Once the Blight has spread, towns beyond it shelter those who fled.
    const site = level.kind === 'town' ? this.world.sites[level.siteId] : undefined;
    if (site?.kind === 'village' && this.blight.told.length && !this.isBlighted(site.x, site.y)) {
      const rng = new Rng(this.world.seed, 'refugees', site.id);
      for (let i = 0; i < 2; i++) {
        const name = personName(rng);
        const spot = { x: level.entry.x + (i ? 2 : -2), y: level.entry.y - 2 - i };
        this.actors.push({
          id: this.nextActorId++, ...spot, hp: 1, maxHp: 1, name,
          npc: { ...spot, role: 'villager', name, wander: true }, awake: false, asleep: 0, checks: 0, refugee: true,
        });
      }
    }
    if (level.kind === 'town' && level.siteId !== undefined) {
      const folk = this.actors.filter((a) => a.npc);
      const plans = planRoutines(this.world.seed, level.siteId, level, folk.map((a) => ({ ...a.npc!, name: a.name })));
      folk.forEach((a, i) => { a.routine = plans[i]; });
      this.snapNpcs();
    }
    for (const m of level.monsters) {
      if (this.clearedFloors.has(level.id)) break;
      const hold = level.siteId === this.world.quest.strongholdId;
      if (m.boss && (hold ? this.flags.won : this.flags.killedBoss)) continue;
      const a = this.spawnMonster(m.kind, m.x, m.y, m.boss);
      // In dangerous places a monster brings its pack (the same pack every visit).
      if (!m.boss && level.kind === 'dungeon') {
        const rng = new Rng(this.world.seed, 'pack', level.id, m.x, m.y);
        const more = packSize(m.kind, this.dangerHere(), rng.next()) - 1;
        if (more > 0 && rng.chance(0.6)) for (const c of this.spawnPack(m.kind, m.x, m.y, more, rng)) c.asleep = a.asleep;
      }
      if (m.boss && hold) {
        // The villain in the flesh: far stronger than the shade in the Barrow.
        a.final = true;
        a.tier = 4;
        a.hp = a.maxHp = 130;
      } else if (m.boss) {
        a.name = `SHADE OF ${this.world.quest.villain}`;
      }
    }
    if (level.dark && !this.seen.has(level.id)) this.seen.set(level.id, new Uint8Array(level.w * level.h));
    this.visible = new Uint8Array(level.w * level.h);
  }

  private enterSite(site: Site, floor: number, arrive: 'entry' | 'down', quiet = false): void {
    const level = this.getLevel(site, floor);
    this.at = { siteId: site.id, floor };
    this.setLevel(level);
    const spot = arrive === 'down' && level.downArrival ? level.downArrival : level.entry;
    this.player.x = spot.x;
    this.player.y = spot.y;
    this.player.facing = arrive === 'down' ? 'down' : 'up';
    this.questArrive(site, floor, level);
    this.actArrive(site, floor, level);
    if (level.dark && !quiet) this.tip('dark');
    if (level.dark) this.autoLight();
    this.updateVisibility();
    if (!quiet && !this.visited.has(site.id)) {
      this.visited.add(site.id);
      if (site.kind === 'landmark') {
        const mark = LANDMARKS[this.world.regions[site.region].type as Exclude<RegionType, 'vale'>];
        if (mark) this.say(mark.lore, true);
      }
      this.note({ kind: 'discover', text: `DISCOVERED ${site.name}`, sub: [] });
    }
    if (!quiet) {
      this.sounds.push('door');
      this.say(level.floors > 1 ? `${site.name}. FLOOR ${floor} OF ${level.floors}.` : `YOU ENTER ${site.name}.`);
      if (site.kind === 'chapel' && !this.flags.searchedChapel) this.say('A BROKEN ALTAR STANDS AT THE FAR END.');
      if (site.kind === 'shrine') this.say('A STATUE WATCHES OVER THIS PLACE.');
      const status = this.siteStatus(site.id);
      if (status === 'raided') this.say('THIS PLACE HAS BEEN RAIDED. DOORS HANG OPEN AND THE STREETS ARE EMPTY.');
      if (status === 'recovering') this.say('THE VILLAGERS ARE STILL MENDING THE DAMAGE FROM THE RAID.');
      if (this.abandoned(site.id)) this.say('NOBODY IS HERE. DOORS STAND OPEN ON GREY, DUSTY ROOMS. THE BLIGHT HAS EMPTIED THIS PLACE.', true);
      this.save();
    }
  }

  private goOverworld(): void {
    // Your horse is waiting where you left it.
    const left = this.at?.siteId;
    // Leaving a lair with nothing left alive in it: the lair is cleared.
    const lair = left !== undefined ? lairSites(this.world).find((s) => s.id === left) : undefined;
    if (lair && !this.actors.some((a) => a.monster)) this.clearedFloors.add(this.level.id);
    const floors = lair ? floorsOf(this.world, lair) : 0;
    const emptied = !!lair && Array.from({ length: floors }, (_, i) => `site:${lair.id}:${i + 1}`).every((id) => this.clearedFloors.has(id));
    if (lair && !emptied && floors > 1 && this.clearedFloors.size) this.say('THERE ARE STILL BEASTS ON OTHER FLOORS HERE.');
    this.clearedFloors.clear();
    this.checkedTraps.clear();
    if (lair && (this.worldState.lairs[lair.id] ?? 0) > 0 && emptied) {
      const grateful = clearLair(this.world, this.worldState, lair, this.day);
      for (const s of grateful) this.changeRep(s.id, 1);
      this.note({ kind: 'quest', text: `CLEARED ${lair.name}`, sub: grateful.length ? [`${grateful.map((s) => s.name).join(', ')} WILL BE GLAD.`] : [] });
      this.say(`${lair.name} IS CLEARED. WORD WILL SPREAD.`);
      for (const q of this.quests) {
        if (q.state === 'active' && q.target === lair.id && (q.kind === 'hunt' || q.kind === 'clear')) {
          this.questReturn(q, `${q.giver} IN ${this.world.sites[q.siteId].name} WILL WANT TO HEAR OF THIS.`);
        }
      }
    }
    const horse = this.player.horse;
    if (horse && horse.at !== null && horse.at === left) {
      horse.at = null;
      this.say('YOU MOUNT YOUR HORSE.');
    }
    this.at = null;
    this.setLevel(overworldLevel(this.world));
    this.player.x = this.overworld.x;
    this.player.y = this.overworld.y;
    this.updateVisibility();
    this.markExplored();
  }

  /**
   * A ready-made look at a raid, for seed RAID: the hamlet nearest home was raided this morning,
   * its lair's beasts still roam, and the player starts on the road outside it.
   */
  setupRaidDemo(): void {
    const home = this.villageSite();
    const lairs = lairSites(this.world);
    const nearLair = (s: Site) => Math.min(...lairs.map((l) => Math.hypot(l.x - s.x, l.y - s.y)));
    const hamlet = this.world.sites
      .filter((s) => s.kind === 'hamlet' && nearLair(s) <= 45)
      .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0];
    if (!hamlet) return;
    const lair = lairs.sort((a, b) => Math.hypot(a.x - hamlet.x, a.y - hamlet.y) - Math.hypot(b.x - hamlet.x, b.y - hamlet.y))[0];
    const beasts = MONSTERS[lairBeast(this.world, lair)].plural;
    this.runWorld();
    this.worldState.raids[hamlet.id] = this.day;
    (this.worldState.raidedBy ??= {})[hamlet.id] = lair.id;
    this.worldState.lairs[lair.id] = 7;
    this.worldState.events.push(
      { day: this.day, kind: 'gather', text: `${beasts} GATHER AT ${lair.name}. THE ROADS NEARBY ARE UNSAFE.`, siteId: lair.id },
      { day: this.day, kind: 'raid', text: `${beasts} FROM ${lair.name} RAIDED ${hamlet.name}!`, siteId: hamlet.id },
    );
    this.heardOf.add(hamlet.id);
    this.heardOf.add(lair.id);
    // Stand on open ground right beside the hamlet.
    const S = this.world.size;
    let spot = { x: hamlet.x, y: hamlet.y + 1 };
    search: for (let r = 1; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = hamlet.x + dx, y = hamlet.y + dy;
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        const t = this.world.tiles[y * S + x] as T;
        if (t !== T.Site && walkable(t)) { spot = { x, y }; break search; }
      }
    }
    this.overworld = spot;
    this.goOverworld();
    this.messages = [];
    this.say(`SMOKE RISES FROM ${hamlet.name}. ${beasts} FROM ${lair.name} RAIDED IT THIS MORNING.`, true);
  }

  /** Everything roughly within the play view counts as seen on the overworld. */
  private markExplored(): void {
    if (this.level.kind !== 'overworld') return;
    const S = this.world.size;
    const { x: px, y: py } = this.player;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        if ((dx * dx) / 72 + (dy * dy) / 42 > 1) continue;
        const x = px + dx, y = py + dy;
        if (x >= 0 && y >= 0 && x < S && y < S) this.explored[y * S + x] = 1;
      }
    }
  }

  /**
   * Where the player's quests point right now, each with a short reason for the map:
   * the main quest's next place first, then side jobs. A place with two reasons is listed once.
   */
  questMarks(): { site: Site; why: string; main: boolean }[] {
    const q = this.world.quest;
    const marks: { site: Site; why: string; main: boolean }[] = [];
    const add = (id: number, why: string, main: boolean) => {
      if (id < 0 || marks.some((m) => m.site.id === id)) return;
      marks.push({ site: this.world.sites[id], why, main });
    };
    if (!this.flags.talkedElder) add(q.villageId, `SPEAK TO ${q.elderName}`, true);
    else if (!this.flags.searchedChapel) add(q.chapelId, 'SEARCH THE CHAPEL', true);
    else if (!this.flags.killedBoss) add(q.barrowId, `DEFEAT ${q.villain}`, true);
    else if (!this.flags.questDone) add(q.villageId, `TELL ${q.elderName}`, true);
    else if (!this.flags.won) {
      // Acts II and III: a lieutenant's den once you've heard where it is, else the town to ask in.
      q.lieutenants.forEach((l, i) => {
        if (this.blight.ltDead[i]) return;
        if (this.heardOf.has(l.siteId) || this.visited.has(l.siteId)) add(l.siteId, `SLAY ${l.name}`, true);
        else {
          const town = this.world.sites.find((s) => s.kind === 'village' && s.region === l.region);
          if (town) add(town.id, `ASK ABOUT ${l.name}`, true);
        }
      });
      if (this.signWhole) add(q.strongholdId, `END ${q.villain}`, true);
    }
    // Side jobs: where the job is, then who to tell.
    for (const job of this.quests) {
      if (job.state === 'active') add(job.target, questTitle(this.world, job), false);
      if (job.state === 'return') add(job.siteId, `TELL ${job.giver}`, false);
    }
    return marks;
  }

  /** Places to show on the map: visited, heard of, and quest places the player knows about. */
  knownSites(): { site: Site; visited: boolean; quest: boolean }[] {
    const questIds = new Set(this.questMarks().map((m) => m.site.id));
    return this.world.sites
      .filter((s) => this.visited.has(s.id) || this.heardOf.has(s.id) || questIds.has(s.id))
      .map((site) => ({ site, visited: this.visited.has(site.id), quest: questIds.has(site.id) }));
  }

  private leaveSite(): void {
    this.goOverworld();
    this.tip('world');
    this.sounds.push('door');
    this.say('YOU STEP OUT INTO THE WILDS.');
    this.save();
  }

  /** Effects of stepping onto a tile. Returns true if the map changed. */
  private onEnter(x: number, y: number, tile: T): boolean {
    if (tile === T.Site) {
      const site = this.siteAt(x, y);
      if (!site) return false;
      if (site.kind === 'stronghold' && !this.signWhole && !this.flags.won) {
        const have = (this.flags.killedBoss ? 1 : 0) + this.blight.ltDead.filter(Boolean).length;
        this.heardOf.add(site.id);
        this.say(`THE BLACK GATE BEARS A SIGN IN THREE PARTS: THE ${this.world.quest.relic}, BROKEN. YOU HOLD ${have} OF THE 3. IT WILL NOT OPEN.`, true);
        this.endTurn();
        return true;
      }
      if (site.kind === 'barrow' && !hasItem(this.player, 'barrowkey') && !this.flags.killedBoss) {
        this.say('AN IRON DOOR SEALS THE BARROW. IT NEEDS A KEY.');
        this.endTurn();
        return true;
      }
      const ban = this.bannedUntil[site.id];
      if (ban && this.day < ban) {
        const left = ban - this.day;
        this.say(`YOU ARE BANNED FROM ${site.name} FOR ${left} MORE DAY${left === 1 ? '' : 'S'}.`);
        this.endTurn();
        return true;
      }
      if ((site.kind === 'village' || site.kind === 'hamlet') && this.night && this.repOf(site.id) <= -5) {
        this.say(`THE GATE OF ${site.name} IS BARRED TO YOU AFTER DARK.`);
        this.endTurn();
        return true;
      }
      this.advanceTime(15);
      // A horse waits outside.
      if (this.player.horse && this.player.horse.at === null) this.player.horse.at = site.id;
      this.enterSite(site, 1, 'entry');
      return true;
    }
    if (tile === T.Gate) {
      this.leaveSite();
      return true;
    }
    // Stairs. In a tower the way on is up; everywhere else it is down.
    const onward = this.level.climbs ? T.StairsUp : T.StairsDown;
    const back = this.level.climbs ? T.StairsDown : T.StairsUp;
    if ((tile === back || tile === onward) && this.at) {
      if (!this.actors.some((a) => a.monster)) this.clearedFloors.add(this.level.id);
      const site = this.world.sites[this.at.siteId];
      if (tile === onward) this.enterSite(site, this.at.floor + 1, 'entry');
      else if (this.at.floor <= 1) this.leaveSite();
      else this.enterSite(site, this.at.floor - 1, 'down');
      return true;
    }
    const trap = this.level.traps.find((t) => t.x === x && t.y === y);
    if (trap) this.springTrap(trap);
    this.spotTraps();
    return false;
  }

  // ---------- traps, levers and locks ----------

  private trapKey(t: Trap): string {
    return `${this.level.id}:${t.x},${t.y}`;
  }

  /** Spotted traps on this floor, for drawing. */
  trapsInSight(): Trap[] {
    return this.level.traps.filter((t) => this.seenTraps.has(this.trapKey(t)));
  }

  /**
   * A chance to notice each hidden trap within two steps: Sneak (+5 while sneaking) against
   * the trap. One look per trap per visit, so creeping back and forth doesn't help.
   */
  private spotTraps(): void {
    const p = this.player;
    for (const t of this.level.traps) {
      const key = this.trapKey(t);
      if (this.seenTraps.has(key) || this.checkedTraps.has(key)) continue;
      if (Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) > 2 || !this.isVisible(t.x, t.y)) continue;
      this.checkedTraps.add(key);
      if (this.rng.dice(1, 20) + sneak(p) + (p.sneaking ? 5 : 0) >= t.dc + 2) {
        this.seenTraps.add(key);
        this.say(`YOU SPOT ${TRAP_NAMES[t.kind]} AHEAD. WALK INTO IT TO DISARM IT, OR GO AROUND.`);
        this.sounds.push('click');
      }
    }
  }

  private removeTrap(t: Trap): void {
    this.level.traps = this.level.traps.filter((x) => x !== t);
    this.removedTraps.add(this.trapKey(t));
  }

  /** Stepping on a trap (or fumbling one) sets it off, once. */
  private springTrap(t: Trap): void {
    this.removeTrap(t);
    const depth = this.level.depth;
    this.sounds.push('hurt');
    if (t.kind === 'alarm') {
      for (const a of this.actors) if (a.monster) { a.awake = true; a.asleep = 0; }
      this.say('A WIRE SNAPS AND A BELL CLANGS! EVERYTHING ON THIS FLOOR KNOWS YOU ARE HERE.', true);
      return;
    }
    if (t.kind === 'pit') {
      const dmg = this.rng.dice(1, 6) + depth - 1;
      this.say(`THE FLOOR GIVES WAY! YOU FALL INTO A PIT. ${dmg} DAMAGE. YOU CLIMB OUT.`);
      this.hurtPlayer(dmg);
      if (!this.dead) this.endTurn(); // climbing out takes a turn
      return;
    }
    const dmg = t.kind === 'rocks' ? this.rng.dice(2, 4) + depth : this.rng.dice(1, 6) + depth - 1;
    this.say(t.kind === 'rocks' ? `THE ROOF COMES DOWN! ${dmg} DAMAGE.` : `A DART TRAP! ${dmg} DAMAGE.`);
    this.hurtPlayer(dmg);
  }

  /** Walking into a trap you've spotted: try to disarm it with Lockpick. */
  private disarmTrap(t: Trap): void {
    const total = this.rng.dice(1, 20) + lockpick(this.player);
    if (total >= t.dc) {
      this.removeTrap(t);
      this.say(`YOU DISARM ${TRAP_NAMES[t.kind]}.`);
      this.sounds.push('click');
      this.gainXp(15);
    } else if (total <= t.dc - 5) {
      this.say('YOUR HAND SLIPS!');
      this.springTrap(t);
    } else {
      this.say("YOU CAN'T WORK OUT THE MECHANISM. TRY AGAIN?");
    }
    if (!this.dead) this.endTurn();
  }

  /** Pull a lever: the floor's sealed door grinds open, or its deep water drains away. */
  private pullLever(): void {
    const water = this.level.tiles.includes(T.Water);
    this.pulledLevers.add(this.level.id);
    openWorks(this.level);
    this.sounds.push('door');
    this.say(water
      ? 'YOU HAUL ON THE LEVER. FAR OFF, WATER ROARS AWAY DOWN A DRAIN.'
      : 'YOU HAUL ON THE LEVER. SOMEWHERE IN THE DARK, STONE GRINDS ON STONE.', true);
    this.updateVisibility();
    this.endTurn();
  }

  // =====================================================================
  // Combat
  // =====================================================================

  private spawnMonster(kind: MonsterId, x: number, y: number, boss = false): Actor {
    const m = MONSTERS[kind];
    // Far from the Vale, monsters come in stronger forms: more HP, harder hits.
    const tier = boss ? 0 : monsterTier(this.dangerHere(x, y));
    const hp = Math.max(1, Math.round(this.rng.dice(m.hp[0], m.hp[1], m.hp[2]) * (1 + tier * 0.4)));
    const name = boss ? `${this.world.quest.villain}` : `${TIER_PREFIX[tier]}${m.name}`;
    const a: Actor = { id: this.nextActorId++, x, y, hp, maxHp: hp, name, monster: kind, boss, awake: !!boss, asleep: 0, checks: 0, tier };
    this.actors.push(a);
    return a;
  }

  /** Danger where the player is: on the open map, the spot itself; in a site, the site's spot. */
  dangerHere(x = this.player.x, y = this.player.y): number {
    const spot = this.at ? this.world.sites[this.at.siteId] : { x, y };
    // Blighted land is a step more dangerous than it was.
    return Math.min(8, dangerAt(this.world, spot.x, spot.y) + (this.isBlighted(spot.x, spot.y) && regionAt(this.world, spot.x, spot.y).type !== 'blight' ? 1 : 0));
  }

  /** A monster's numbers, with its tier added: defense, attack, damage, XP and gold. */
  private foe(a: Actor): MonsterInfo {
    const m = MONSTERS[a.monster!];
    const t = a.tier ?? 0;
    if (!t) return m;
    return {
      ...m,
      defense: m.defense + t,
      attack: m.attack + t,
      dmg: [m.dmg[0], m.dmg[1], m.dmg[2] + t],
      xp: Math.round(m.xp * (1 + t * 0.5)),
      gold: m.gold ? [m.gold[0] * (1 + t), m.gold[1] * (1 + t)] : m.gold,
    };
  }

  private meleeAttack(target: Actor, cleaving = false): void {
    const p = this.player;
    const m = this.foe(target);
    const roll = this.rng.dice(1, 20);
    const unseen = !target.awake || target.asleep > 0;
    this.stopSneaking();
    const hit = roll !== 1 && (roll === 20 || roll + attackBonus(p) >= m.defense || target.asleep > 0);
    if (!hit) {
      this.sounds.push('miss');
      this.say(`YOU MISS ${the(target)}.`);
      target.awake = true;
      return;
    }
    const [n, s] = weaponDice(p);
    let dmg = Math.max(1, this.rng.dice(n, s) + mod(p.attrs.str) + damageBonus(p));
    let note = '';
    if (roll === 20) { dmg *= 2; note = ' CRITICAL!'; }
    if (p.cls === 'thief' && unseen) { dmg *= hasPerk(p, 'assassin') ? 3 : 2; note = ' BACKSTAB!'; }
    this.damageMonster(target, dmg, `YOU HIT ${the(target)} FOR ${dmg}.${note}`);
    // CLEAVE: a kill earns a free swing at another foe beside you.
    if (hasPerk(p, 'cleave') && !this.actors.includes(target) && !cleaving) {
      const next = this.actors.find((a) => a.monster && Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) === 1);
      if (next) {
        this.say('CLEAVE!');
        this.meleeAttack(next, true);
      }
    }
  }

  /** Shoot the bow, a spark, a fireball or a fire scroll the way the player faces. */
  private fire(kind: 'bow' | 'spark' | 'fireball' | 'scroll', aim?: Actor): void {
    const p = this.player;
    if (kind === 'bow' && !bestBow(p)) return this.say('YOU HAVE NO BOW.');
    if (kind === 'scroll' && !hasItem(p, 'scroll')) return this.say('YOU HAVE NO SCROLLS.');
    if (kind === 'fireball') {
      if (p.mp < 5) return this.say('NOT ENOUGH MP FOR FIREBALL.');
      p.mp -= 5;
    }
    if (kind === 'scroll') removeItem(p, 'scroll');
    this.stopSneaking();

    // At the chosen target if there is one, otherwise the way the player faces.
    if (aim && this.actors.includes(aim)) this.faceTowards(aim.x, aim.y);
    else aim = undefined;
    const [dx, dy] = DIRS[p.facing];
    const { cells, hit: target } = this.shotPath(aim);
    const color = kind === 'bow' ? '#ddddee' : kind === 'spark' ? '#ee9933' : '#ee4444';
    this.effects.push({ kind: 'bolt', cells, color, start: now() });
    this.sounds.push(kind === 'bow' ? 'shoot' : 'spell');

    if (kind === 'fireball') {
      // It bursts where it stops, burning everything around that spot.
      const at = target ?? cells[cells.length - 1] ?? { x: p.x + dx, y: p.y + dy };
      const burst: { x: number; y: number }[] = [];
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) burst.push({ x: at.x + ox, y: at.y + oy });
      this.effects.push({ kind: 'flash', cells: burst, color: '#ee6622', start: now() });
      const hit = this.actors.filter((a) => a.monster && burst.some((c) => c.x === a.x && c.y === a.y));
      if (!hit.length) this.say('THE FIREBALL BURSTS ON NOTHING.');
      for (const a of hit) {
        const dmg = Math.max(1, this.rng.dice(2, 6) + mod(p.attrs.wis));
        this.damageMonster(a, dmg, `THE BLAST BURNS ${the(a)} FOR ${dmg}.`);
      }
      return this.endTurn();
    }

    const label = kind === 'bow' ? 'ARROW' : kind === 'spark' ? 'SPARK' : 'FIRE';
    if (!target) {
      this.say(`YOUR ${label} FLIES INTO EMPTINESS.`);
      return this.endTurn();
    }
    const m = this.foe(target);
    if (kind === 'scroll') {
      const dmg = this.rng.dice(3, 6);
      this.damageMonster(target, dmg, `FLAMES ENGULF ${the(target)}! ${dmg} DAMAGE.`);
      return this.endTurn();
    }
    const roll = this.rng.dice(1, 20);
    const unaware = !target.awake || target.asleep > 0;
    const bonus = kind === 'bow' ? attackBonus(p, true) : magic(p);
    if (roll === 1 || (roll !== 20 && roll + bonus < m.defense && target.asleep === 0)) {
      this.say(`YOUR ${label} MISSES ${the(target)}.`);
      this.sounds.push('miss');
      target.awake = true;
      return this.endTurn();
    }
    let dmg = kind === 'bow'
      ? Math.max(1, this.rng.dice(1, 6) + damageBonus(p, true))
      : Math.max(1, this.rng.dice(1, hasPerk(p, 'focus') ? 6 : 4) + mod(p.attrs.wis));
    let note = '';
    if (roll === 20) { dmg *= 2; note = ' CRITICAL!'; }
    if (kind === 'bow' && p.cls === 'thief' && unaware) { dmg *= hasPerk(p, 'assassin') ? 3 : 2; note = ' AMBUSH!'; }
    this.damageMonster(target, dmg, `YOUR ${label} HITS ${the(target)} FOR ${dmg}.${note}`);
    this.endTurn();
  }


  private damageMonster(target: Actor, dmg: number, text: string): void {
    target.hp -= dmg;
    target.awake = true;
    target.asleep = 0;
    this.effects.push({ kind: 'flash', cells: [{ x: target.x, y: target.y }], color: '#ffffff', start: now() });
    this.sounds.push('hit');
    if (target.hp > 0) {
      this.say(text);
      if (target.final && !target.phase2 && target.hp <= target.maxHp / 2) this.secondWind(target);
      return;
    }
    const m = this.foe(target);
    this.actors = this.actors.filter((a) => a !== target);
    let loot = '';
    if (m.gold) {
      const gold = this.rng.int(m.gold[0], m.gold[1]);
      if (gold > 0) { this.player.gold += gold; loot = ` +${gold} GOLD.`; }
    }
    this.say(`${text} ${the(target)} DIES.${loot}`);
    if (target.questId && !this.actors.some((x) => x.questId === target.questId)) {
      const q = this.quests.find((t) => t.id === target.questId);
      if (q?.state === 'active') this.questReturn(q, `AMONG THE REMAINS LIES A CRUDE IDOL. PROOF FOR ${q.giver}.`);
    }
    if (!target.boss) this.noteDefeat(target.monster!);
    if (loot) this.noteGold(parseInt(loot.replace(/\D/g, ''), 10));
    this.gainXp(m.xp);
    if (target.lieutenant !== undefined) return this.lieutenantFalls(target);
    if (target.final) return this.villainFalls();
    if (target.boss) {
      const q = this.world.quest;
      this.note({ kind: 'quest', text: `DEFEATED THE SHADE OF ${q.villain}`, sub: [`TOOK THE ${q.relic}.`] });
      this.flags.killedBoss = true;
      addItem(this.player, 'relic');
      this.sounds.push('fanfare');
      this.say(`THE SHADE OF ${q.villain} COMES APART LIKE SMOKE. SOMEWHERE FAR OFF, SOMETHING LAUGHS.`, true);
      this.say(`YOU TAKE THE ${q.relic}. IT IS CRACKED, AND PIECES ARE MISSING. RETURN TO ${q.elderName}.`, true);
      this.save();
    }
  }

  private monsterAttack(a: Actor, arrow = false): void {
    const m = this.foe(a);
    const roll = this.rng.dice(1, 20);
    if (arrow) {
      this.sounds.push('shoot');
      this.effects.push({ kind: 'bolt', cells: [{ x: a.x, y: a.y }, { x: this.player.x, y: this.player.y }], color: '#c8c8c8', start: now() });
    }
    if (roll === 1 || (roll !== 20 && roll + m.attack < defense(this.player))) {
      this.say(arrow ? `${the(a)}'S ARROW FLIES WIDE.` : `${the(a)} MISSES.`);
      return;
    }
    let dmg = Math.max(1, this.rng.dice(m.dmg[0], m.dmg[1], m.dmg[2]));
    if (roll === 20) dmg *= 2;
    this.sounds.push('hurt');
    this.effects.push({ kind: 'flash', cells: [{ x: this.player.x, y: this.player.y }], color: '#ee4444', start: now() });
    this.say(arrow ? `${the(a)}'S ARROW HITS! ${dmg} DAMAGE.` : `${the(a)} ${m.hit}! ${dmg} DAMAGE.`);
    this.hurtPlayer(dmg);
  }

  private hurtPlayer(dmg: number): void {
    const ward = this.player.ward;
    if (ward && ward.points > 0) {
      const soaked = Math.min(ward.points, dmg);
      ward.points -= soaked;
      dmg -= soaked;
      if (ward.points <= 0) {
        this.player.ward = undefined;
        this.say('YOUR WARD SHATTERS.');
      }
      if (dmg <= 0) return;
    }
    this.player.hp -= dmg;
    if (this.player.hp > 0 && this.player.hp <= this.player.maxHp / 3) this.tip('hurt');
    // SECOND WIND: once a day, near death, a warrior rallies.
    const p = this.player;
    if (p.hp > 0 && p.hp < p.maxHp / 4 && hasPerk(p, 'secondwind') && p.secondWindDay !== this.day) {
      p.secondWindDay = this.day;
      const back = Math.floor(p.maxHp / 2);
      p.hp = Math.min(p.maxHp, p.hp + back);
      this.say(`SECOND WIND! +${back} HP.`);
    }
    if (this.player.hp <= 0) this.die();
  }

  private die(): void {
    const p = this.player;
    this.dead = true;
    this.sounds.push('death');
    this.say('YOU HAVE DIED...', true);
    // Hard mode: the tale ends here, and the save goes with it.
    if (p.hard) {
      this.note({ kind: 'death', text: 'FELL IN BATTLE. THE TALE ENDS.', sub: [] });
      this.say(`HERE ENDS THE TALE OF ${p.name}, LEVEL ${p.level} ${CLASSES[p.cls].name}.`, true);
      this.gameOver = true;
      Game.deleteSave();
      return;
    }
    // Wake in the starting village temple, poorer and a day later.
    const lost = Math.ceil(p.gold / 2);
    p.gold -= lost;
    p.hp = p.maxHp;
    p.mp = maxMp(p);
    this.time = (Math.floor(this.time / 1440) + 1) * 1440 + 8 * 60;
    const village = this.villageSite();
    this.overworld = { x: village.x, y: village.y };
    this.enterSite(village, 1, 'entry', true);
    const priest = this.actors.find((a) => a.npc?.role === 'priest');
    if (priest) {
      const spot = this.freeNeighbour(priest.x, priest.y);
      if (spot) { p.x = spot.x; p.y = spot.y; }
    }
    this.say(`...AND WAKE IN THE TEMPLE OF ${village.name}. A DAY HAS PASSED. ${lost} GOLD IS GONE.`, true);
    this.note({ kind: 'death', text: 'FELL IN BATTLE', sub: [`WOKE IN THE TEMPLE OF ${village.name}, ${lost} GOLD POORER.`] });
    this.dead = false;
    this.save();
  }

  private gainXp(n: number): void {
    const p = this.player;
    p.xp += n;
    while (p.level < MAX_LEVEL && p.xp >= XP_TABLE[p.level + 1]) {
      p.level++;
      const gain = Math.max(1, this.rng.dice(1, CLASSES[p.cls].hitDie) + mod(p.attrs.con));
      p.maxHp += gain;
      p.hp += gain;
      p.mp = maxMp(p);
      const due = (p.pending ??= { skills: 0, perks: 0, attrs: 0 });
      due.skills++;
      if (PERK_LEVELS.includes(p.level)) due.perks++;
      if (ATTR_LEVELS.includes(p.level)) due.attrs++;
      this.sounds.push('levelup');
      this.say(`YOU ARE NOW LEVEL ${p.level}! +${gain} HP.`, true);
      this.note({ kind: 'level', text: `REACHED LEVEL ${p.level}`, sub: [] });
      const fresh = p.cls === 'wizard' ? SPELLS.filter((sp) => !sp.tome && sp.level === p.level) : [];
      for (const sp of fresh) this.say(`YOU HAVE LEARNED ${sp.name}. ${sp.desc}`, true);
    }
    this.offerLevelChoices();
  }

  /** Level-up choices still waiting (skill points, perks, attribute points). */
  levelChoicesDue(): boolean {
    const d = this.player.pending;
    return !!d && d.skills + d.perks + d.attrs > 0;
  }

  /**
   * The next level-up choice, if one is due and nothing else is open: a skill to train,
   * then a perk, then an attribute. They can't be skipped.
   */
  offerLevelChoices(): void {
    const p = this.player;
    const due = p.pending;
    if (!due || this.choice || this.dead) return;
    const next = () => this.offerLevelChoices();
    if (due.skills > 0) {
      this.choice = {
        title: `LEVEL ${p.level}: TRAIN A SKILL`,
        mustChoose: true,
        options: SKILLS.map((sk) => ({
          label: sk.name,
          right: `+${trained(p, sk.id)}`,
          desc: sk.desc,
          run: () => {
            due.skills--;
            (p.trained ??= {})[sk.id] = trained(p, sk.id) + 1;
            this.say(`YOU TRAIN ${sk.name}.`);
            next();
          },
        })),
      };
    } else if (due.perks > 0) {
      const open = PERKS[p.cls].filter((pk) => !hasPerk(p, pk.id));
      const offer = new Rng(this.world.seed, 'perks', p.name, p.level).shuffle(open).slice(0, 3);
      this.choice = {
        title: 'CHOOSE A PERK',
        mustChoose: true,
        options: offer.map((pk) => ({
          label: pk.name,
          desc: pk.desc,
          run: () => {
            due.perks--;
            (p.perks ??= []).push(pk.id);
            if (pk.id === 'deepwell') p.mp = maxMp(p);
            this.note({ kind: 'level', text: `TOOK THE ${pk.name} PERK`, sub: [] });
            this.say(`${pk.name}: ${pk.desc}`);
            next();
          },
        })),
      };
      if (!offer.length) { due.perks = 0; next(); }
    } else if (due.attrs > 0) {
      this.choice = {
        title: 'RAISE AN ATTRIBUTE',
        mustChoose: true,
        options: ATTR_NAMES.map((k) => ({
          label: k.toUpperCase(),
          right: `${p.attrs[k]}`,
          desc: { str: 'MELEE HITS AND DAMAGE.', dex: 'DEFENSE, BOWS, SNEAK, LOCKS.', wis: 'MAGIC, MP, HEALING.', con: 'HIT POINTS.' }[k],
          run: () => {
            due.attrs--;
            p.attrs[k]++;
            this.say(`${k.toUpperCase()} RISES TO ${p.attrs[k]}.`);
            next();
          },
        })),
      };
    } else {
      p.pending = undefined;
    }
  }


  // =====================================================================
  // Talking, chests, doors, altars
  // =====================================================================

  /**
   * Talking opens a menu: what this person does (trade, rest, heal...), NEWS or
   * ASK ABOUT, and BYE. The elder skips the menu when the quest has news.
   */
  private talk(a: Actor): void {
    const npc = a.npc!;
    const q = this.world.quest;
    if (a.asleep > 0) return this.say(`${a.name} IS ASLEEP.`);
    if (a.questId) return this.rescued(a);
    this.keywords.add(this.keyOf(a, 'person'));
    if (npc.role === 'elder' && this.elderHasNews()) return this.elderTalk(a);
    const here = this.hereSite();
    const rep = this.repOf(here.id);
    const memory = this.memories[this.keyOf(a)] ?? [];
    const raid = this.raidHere();
    // After a raid it's all anyone can talk about (unless they can't stand you).
    const hello = a.refugee
      ? 'WE WALKED SIX DAYS TO GET HERE. THERE IS NOTHING TO GO BACK TO.'
      : raid && !memory.includes('thief') && rep > -5
        ? this.raidGreeting(a, raid)
        : greeting(this.traitOf(a), rep, memory, q.villain, this.flags.won);
    const opts: Choice['options'] = [];
    switch (npc.role) {
      case 'elder':
        opts.push({ label: 'ASK FOR NEWS', run: () => this.elderTalk(a) });
        break;
      case 'shopkeeper':
        if (this.isWorking(a)) opts.push({ label: 'TRADE', run: () => { this.shopOpen = true; this.shopFrom = 'shop'; this.shopkeeper = a.name; } });
        break;
      case 'trader':
        opts.push(
          { label: 'TRADE', run: () => { this.shopOpen = true; this.shopFrom = 'trader'; this.shopkeeper = a.name; } },
          { label: 'NEWS FROM THE ROAD', run: () => this.gossip(a, 1) },
        );
        break;
      case 'innkeeper': {
        const bed = this.innPrice();
        opts.push(
          { label: 'REST THE NIGHT', right: bed ? `${bed}G` : 'FREE', run: () => this.innRest() },
          { label: 'BUY A DRINK, HEAR NEWS', right: '2G', run: () => this.innRumour(a) },
        );
        break;
      }
      case 'priest':
        if (this.isWorking(a)) opts.push({ label: 'HEAL MY WOUNDS', right: '5G', run: () => this.templeHeal() });
        opts.push(
          { label: 'DONATE TO THE TEMPLE', right: '10G', run: () => this.donate(a) },
          {
            label: 'ASK FOR GUIDANCE',
            run: () => {
              const hint = this.questHint();
              this.noteTalk(a.name, `${a.name} SAID: ${hint}`);
              this.say(`${a.name}: ${hint}`, true);
            },
          },
        );
        break;
      case 'hermit':
        opts.push({ label: 'NEWS', run: () => this.hermitNews(a) });
        break;
      case 'beggar':
        opts.push({ label: 'NEWS', run: () => this.gossip(a) }, { label: 'GIVE A COIN', right: '1G', run: () => this.giveCoin(a) });
        break;
      default:
        opts.push({ label: 'NEWS', run: () => this.gossip(a) });
    }
    // Jobs come first: settling one, then any on offer.
    const hereId = this.at?.siteId ?? -1;
    const jobs: Choice['options'] = [];
    for (const job of this.quests.filter((t) => this.settles(t, a, hereId))) {
      const label = job.kind === 'deliver' ? `GIVE ${job.thing!.replace(/^(A|AN) /, '')}` : `ABOUT ${questTitle(this.world, job)}`;
      jobs.push({ label: label.slice(0, 26), run: () => this.finishQuest(a, job) });
    }
    for (const offer of this.offersHere().filter((o) => o.giver === a.name)) {
      jobs.push({ label: 'NEED ANY HELP?', run: () => this.offerQuest(a, offer) });
    }
    opts.unshift(...jobs);
    opts.push({ label: 'ASK ABOUT...', run: () => this.askMenu(a) });
    opts.push({ label: 'BYE', run: () => {} });
    // Off duty: say so instead of the usual greeting.
    const shut = !this.isWorking(a) && (npc.role === 'shopkeeper' || npc.role === 'priest');
    const raided = this.at && this.siteStatus(this.at.siteId) === 'raided';
    const text = shut
      ? npc.role === 'shopkeeper'
        ? raided ? 'THE RAIDERS TOOK EVERYTHING. COME BACK IN A FEW DAYS.' : 'THE SHOP IS SHUT. COME BACK IN THE MORNING.'
        : 'THE TEMPLE IS CLOSED UNTIL MORNING.'
      : hello;
    // Someone waiting on news of their own.
    const waiting = this.quests.find((t) => t.state === 'active' && t.kind === 'rescue' && t.siteId === hereId && t.giver === a.name);
    const said = waiting ? `ANY NEWS OF MY ${waiting.relation}, ${waiting.who}?` : text;
    this.choice = { title: `${a.name}, ${roleWords(npc.role).replace(/^(THE|A) /, '')}`, text: said, options: opts };
  }

  /** The list of things the player can ask this person about. */
  askable(a: Actor): Keyword[] {
    const here = this.hereSite();
    const people = [...this.keywords].filter((k) => k.startsWith('person:') && k !== this.keyOf(a, 'person'));
    const local = people.filter((k) => k.startsWith(`person:${here.id}:`));
    const elsewhere = people.filter((k) => !k.startsWith(`person:${here.id}:`));
    const quest = (['quest:trouble', 'quest:villain', 'quest:relic', 'quest:lt0', 'quest:lt1'] as Keyword[]).filter((k) => this.keywords.has(k));
    const places = this.world.sites
      .filter((s) => s.id !== here.id && (this.visited.has(s.id) || this.heardOf.has(s.id)))
      .sort((s1, s2) => Math.hypot(s1.x - here.x, s1.y - here.y) - Math.hypot(s2.x - here.x, s2.y - here.y))
      .map((s) => `site:${s.id}`);
    const lore = [...this.keywords].filter((k) => k.startsWith('lore:')).sort();
    const raid = this.raidHere() ? ['raid'] : [];
    return [...raid, 'name', 'job', `site:${here.id}`, ...local, ...quest, ...places, ...lore, ...elsewhere];
  }

  private askMenu(a: Actor, cursor = 0): void {
    const keys = this.askable(a);
    this.choice = {
      title: `ASK ${a.name} ABOUT`,
      cursor,
      options: [
        ...keys.map((k, i) => ({
          label: keywordLabel(this.world, k) ?? k,
          run: () => {
            this.askAbout(a, k);
            this.askMenu(a, i);
          },
        })),
        { label: 'DONE', run: () => {} },
      ],
    };
  }

  /** Ask one person about one thing, and keep what they said. */
  askAbout(a: Actor, k: Keyword): void {
    if (k === 'quest:lt0' || k === 'quest:lt1') {
      // Only folk of the lieutenant's own land know where the den is.
      const i = Number(k.slice(-1));
      const lt = this.world.quest.lieutenants[i];
      const here = this.hereSite();
      const den = this.world.sites[lt.siteId];
      let line: string;
      if (this.blight.ltDead[i]) line = `DEAD, AND GOOD RIDDANCE. THEY SAY IT WAS YOU.`;
      else if (here.region === lt.region) {
        line = `DON'T SAY IT SO LOUD. ${siteTitle(den)}. THAT'S WHERE. ${compass(here, den)} OF HERE, ${distanceWords(here, den)}.`;
        this.heardOf.add(den.id);
        this.noteTalk(a.name, `${a.name} SAID ${lt.name} DENS IN ${siteTitle(den)}, ${compass(here, den)} OF ${here.name}.`);
      } else {
        const town = this.world.sites.find((s) => s.kind === 'village' && s.region === lt.region);
        line = `A NAME FROM ${this.world.regions[lt.region].name}. ${town ? `ASK IN ${town.name}, ${compass(here, town)} OF HERE.` : 'ASK THERE.'}`;
        if (town) this.heardOf.add(town.id);
      }
      this.say(`${a.name}: ${line}`, true);
      return;
    }
    if (k === 'raid') {
      const r = this.raidRumour(a);
      if (r) this.hearRumour(a, r, this.hereSite());
      return;
    }
    const here = this.hereSite();
    const residents: Person[] = this.actors
      .filter((x) => x.npc)
      .map((x) => ({ name: x.name, role: x.npc!.role, siteId: here.id }));
    const answer = ask(
      {
        world: this.world,
        speaker: { name: a.name, role: a.npc!.role, siteId: here.id },
        trait: this.traitOf(a),
        here,
        residents,
        rep: this.repOf(here.id),
        questFlags: this.flags,
      },
      k,
    );
    const spoken = answer.lines.join(' ');
    this.say(`${a.name}: ${spoken}`, true);
    for (const t of answer.teach) this.keywords.add(t);
    for (const site of answer.sites) this.heardOf.add(site.id);
    if (answer.knew && k !== 'name' && k !== 'job') this.noteTopic(k, `${a.name}: ${spoken}`);
    if (answer.chronicle) this.noteTalk(a.name, answer.chronicle);
  }

  /** NEWS from villagers and beggars: a rumour that may teach a new topic. */
  /** NEWS: recent world events (raids, lairs, the seasons) about half the time, else gossip. */
  private gossip(a: Actor, newsChance = 0.5): void {
    const site = this.hereSite();
    if (a.refugee) {
      const lost = this.world.sites.filter((s) => s.kind === 'hamlet' && this.abandoned(s.id));
      const from = lost.length ? new Rng(this.world.seed, 'fled', a.name).pick(lost) : undefined;
      const line = from
        ? `WE CAME FROM ${from.name}. THE GREY TOOK THE FIELDS, THEN THE WELL. THEN THE DOGS WENT STRANGE. WE LEFT THAT NIGHT.`
        : 'THE GREY HAS LIFTED, THEY SAY. WE MEAN TO GO HOME SOON.';
      return this.hearRumour(a, { line, site: from }, site);
    }
    const news = this.raidRumour(a)
      ?? (new Rng(this.world.seed, 'news?', a.name, this.day).chance(newsChance) ? this.newsRumour(a.name) : null);
    const r = news ?? rumour(this.world, a.name, site, this.flags.won);
    this.hearRumour(a, r, site);
  }

  private hearRumour(a: Actor, r: Rumour, site: Site): void {
    this.noteTalk(a.name, rumourNote(a.name, r, site));
    if (r.site) this.heardOf.add(r.site.id);
    if (r.teach) {
      this.keywords.add(r.teach);
      if (!r.teach.startsWith('person:')) this.noteTopic(r.teach, `${a.name}: ${r.line}`);
    }
    this.say(`${a.name}: ${r.line}`, true);
  }

  private hermitNews(a: Actor): void {
    const q = this.world.quest;
    const site = this.hereSite();
    const chapel = this.world.sites[q.chapelId];
    const line = this.flags.questDone
      ? 'THE LAND BREATHES EASIER. REST HERE WHEN YOU NEED TO.'
      : `TOUCH THE STATUE TO BE MENDED, ONCE A DAY. THE OLD CHAPEL LIES ${compass(site, chapel)}.`;
    if (this.flags.questDone) this.noteTalk(a.name);
    else {
      this.noteTalk(a.name, `${a.name} SAID ${whereIs(chapel, site)}`);
      this.heardOf.add(chapel.id);
    }
    this.say(`${a.name}: ${line}`, true);
  }

  private donate(a: Actor): void {
    const p = this.player;
    if (p.gold < 10) return this.say('YOU HAVE NOT GOT 10 GOLD.');
    p.gold -= 10;
    this.sounds.push('coin');
    const key = this.keyOf(a);
    const site = this.hereSite();
    if (this.giftDays[key] === this.day) return this.say(`${a.name}: TWICE IN ONE DAY? THE GODS THANK YOU.`);
    this.giftDays[key] = this.day;
    this.changeRep(site.id, 1);
    this.remember(key, 'donor');
    this.note({ kind: 'gift', text: `GAVE 10 GOLD TO THE TEMPLE OF ${site.name}`, sub: [] });
    this.say(`${a.name}: THE GODS SEE YOUR GIFT. ${site.name} WILL REMEMBER IT.`, true);
  }

  private giveCoin(a: Actor): void {
    const p = this.player;
    if (p.gold < 1) return this.say('YOU HAVE NO COINS.');
    p.gold -= 1;
    this.sounds.push('coin');
    const key = this.keyOf(a);
    // A coin a day buys a little goodwill, but only so much.
    if (this.giftDays[key] !== this.day && this.repOf(this.hereSite().id) < 3) {
      this.changeRep(this.hereSite().id, 1);
    }
    this.giftDays[key] = this.day;
    this.remember(key, 'gift');
    this.say(`${a.name}: BLESS YOU, STRANGER. BLESS YOU.`);
  }

  // ---------- standing and theft ----------

  /** How a settlement feels about the player, -10 (hated) to +10 (hero). */
  repOf(siteId: number): number {
    return this.rep[siteId] ?? 0;
  }

  private changeRep(siteId: number, delta: number): void {
    this.rep[siteId] = Math.max(-10, Math.min(10, this.repOf(siteId) + delta));
  }

  private remember(key: string, fact: string): void {
    const m = (this.memories[key] ??= []);
    if (!m.includes(fact)) m.push(fact);
  }

  /** A bed at the inn: free for a hero, dearer for someone disliked. */
  innPrice(): number {
    const rep = this.repOf(this.hereSite().id);
    return rep >= 7 ? 0 : Math.round(10 * buyRate(rep));
  }

  /** Someone who sees the player at a strongbox, if anyone does. Sneaking helps; night helps more. */
  private witnessTo(chest: Chest): Actor | undefined {
    const dc = this.night ? 8 : 12;
    for (const a of this.actors) {
      if (!a.npc || a.asleep > 0) continue;
      const guard = a.npc.role === 'guard';
      const range = guard ? (this.night ? 5 : 8) : this.night ? 3 : 6;
      if (Math.max(Math.abs(a.x - chest.x), Math.abs(a.y - chest.y)) > range) continue;
      if (!this.clearLine(a.x, a.y, this.player.x, this.player.y)) continue;
      const roll = this.rng.dice(1, 20);
      if (roll === 20) continue;
      if (roll === 1 || roll + this.stealth(a) - (this.night ? 3 : 0) < dc) return a;
    }
    return undefined;
  }

  /** Nothing that blocks sight between two points (walls, closed doors). */
  private clearLine(x0: number, y0: number, x1: number, y1: number): boolean {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 1; i < n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n);
      if (TERRAIN[this.tileAt(x, y)].opaque) return false;
    }
    return true;
  }

  /** First time: a fine. After that: a fine and three days' ban. */
  private caughtStealing(w: Actor): void {
    const site = this.hereSite();
    const p = this.player;
    const times = (this.offences[site.id] ?? 0) + 1;
    this.offences[site.id] = times;
    this.remember(this.keyOf(w), 'thief');
    const fine = Math.min(p.gold, 20);
    p.gold -= fine;
    this.sounds.push('alarm');
    this.say(`${w.name}: THIEF! STOP, THIEF!`, true);
    if (times === 1) {
      this.changeRep(site.id, -2);
      this.note({ kind: 'caught', text: `CAUGHT STEALING IN ${site.name}`, sub: [`${w.name} SAW YOU.`, `PAID A FINE OF ${fine} GOLD.`] });
      this.say(`YOU ARE CAUGHT, AND PAY A FINE OF ${fine} GOLD. ${site.name} WILL NOT FORGET THIS.`, true);
      this.endTurn();
      return;
    }
    this.changeRep(site.id, -3);
    this.bannedUntil[site.id] = this.day + 3;
    this.note({
      kind: 'caught',
      text: `CAUGHT STEALING AGAIN IN ${site.name}`,
      sub: [`${w.name} SAW YOU.`, `PAID A FINE OF ${fine} GOLD.`, 'BANNED FOR 3 DAYS.'],
    });
    this.say(`YOU PAY ${fine} GOLD, AND THEY DRAG YOU TO THE GATE. YOU ARE BANNED FROM ${site.name} FOR 3 DAYS.`, true);
    this.goOverworld();
    this.sounds.push('door');
    this.save();
  }

  // ---------- who's who ----------

  /** The site the player is in (the starting village when on the open map). */
  hereSite(): Site {
    return this.at ? this.world.sites[this.at.siteId] : this.villageSite();
  }

  /** A person's key ("12:MAREN"), or their ASK ABOUT keyword with kind 'person'. */
  private keyOf(a: Actor, kind?: 'person'): string {
    const key = personKey(this.hereSite().id, a.name);
    return kind ? `person:${key}` : key;
  }

  private traitOf(a: Actor) {
    return traitOf(this.world.seed, this.hereSite().id, a.name);
  }

  /** Is this keeper at their post and open for business? (Anyone without a routine always is.) */
  isWorking(a: Actor): boolean {
    if (a.npc?.role === 'shopkeeper' && this.at && this.siteStatus(this.at.siteId) === 'raided') return false;
    const r = a.routine;
    if (!r) return true;
    const post = r.spots[this.watch];
    return r.working.includes(this.watch) && Math.abs(a.x - post.x) + Math.abs(a.y - post.y) <= 1;
  }

  /** Something new to tell: the quest's first meeting, or the relic coming home. */
  private elderHasNews(): boolean {
    return !this.flags.questDone && (!this.flags.talkedElder || this.flags.killedBoss);
  }

  private elderTalk(a: Actor): void {
    const q = this.world.quest;
    const here = this.villageSite();
    const chapel = this.world.sites[q.chapelId];
    const barrow = this.world.sites[q.barrowId];
    const name = a.name;
    const hold = this.world.sites[q.strongholdId];
    if (this.flags.won) {
      return this.say(`${name}: ${q.villain} IS ENDED, AND THE GREY IS LIFTING. THE WHOLE LAND SLEEPS EASY, THANKS TO YOU.`, true);
    }
    if (this.flags.questDone) {
      // Act II and III: where things stand.
      const left = q.lieutenants.filter((_, i) => !this.blight.ltDead[i]);
      if (left.length) {
        return this.say(`${name}: ${left.map((l) => `${l.name} IN ${this.world.regions[l.region].name}`).join(', AND ')}. ASK IN THE TOWNS THERE. EACH HOLDS A SHARD OF THE ${q.relic}.`, true);
      }
      return this.say(`${name}: THE ${q.relic} IS WHOLE. THE ${hold.name} LIES ${compass(here, hold)}, FAR AWAY, IN THE BLIGHT. END IT.`, true);
    }
    if (this.flags.killedBoss) {
      // Act I ends, and the elder tells what the cracked relic means.
      this.flags.questDone = true;
      this.player.gold += 200;
      this.sounds.push('fanfare');
      this.note({ kind: 'quest', text: `SHOWED THE ${q.relic} TO ${name}`, sub: ['WAS REWARDED WITH 200 GOLD.', `LEARNED THAT ${q.villain} LIVES, IN THE BLIGHT.`] });
      // Word spreads: every settlement thinks better of the player, home most of all.
      for (const s2 of this.world.sites) if (s2.kind === 'village' || s2.kind === 'hamlet') this.changeRep(s2.id, 2);
      this.changeRep(q.villageId, 3);
      this.say(`${name}: THE ${q.relic}! THE VALE IS SAFE. TAKE THIS GOLD, AND OUR THANKS. +200 GOLD.`, true);
      this.say(`${name}: BUT LOOK, IT IS BROKEN. WHAT YOU KILLED WAS ONLY A SHADE. ${q.villain} LIVES, FAR OFF IN THE BLIGHT, IN THE ${hold.name}.`, true);
      const lts = q.lieutenants;
      if (lts.length) {
        this.say(`${name}: TWO SERVANTS KEEP THE MISSING SHARDS: ${lts.map((l) => `${l.name} IN ${this.world.regions[l.region].name}`).join(', AND ')}.`, true);
        this.say(`${name}: KEEP THE ${q.relic}. MADE WHOLE, IT OPENS THE BLACK GATE. AND BE QUICK: THE BLIGHT SPREADS WHILE THEY LIVE.`, true);
        lts.forEach((_, i) => this.keywords.add(`quest:lt${i}`));
        this.noteTalk(name, ...lts.map((l) => `${name} SAID ${l.name} IS SOMEWHERE IN ${this.world.regions[l.region].name}.`));
      }
      this.heardOf.add(hold.id);
      this.gainXp(300);
      this.save();
      return;
    }
    if (!this.flags.talkedElder) {
      this.flags.talkedElder = true;
      this.tip('elder');
      this.heardOf.add(chapel.id);
      this.keywords.add('quest:trouble');
      this.noteTalk(
        name,
        `${name} SAID ${q.problem}`,
        `${name} ASKED YOU TO SEARCH THE ALTAR OF THE ${chapel.name}.`,
        `${name} SAID ${whereIs(chapel, here)}`,
      );
      this.sounds.push('quest');
      this.say(`${name}: I AM ELDER OF ${here.name}. THANK THE GODS YOU CAME.`, true);
      this.say(`${name}: ${q.problem} IT BEGAN WHEN THE OLD CHAPEL FELL TO RUIN.`, true);
      this.say(`${name}: THE CHAPEL LIES ${compass(here, chapel)} OF HERE. SEEK ITS ALTAR AND LEARN WHAT YOU CAN.`, true);
      this.save();
      return;
    }
    if (!this.flags.searchedChapel) {
      return this.say(`${name}: THE OLD CHAPEL LIES ${compass(here, chapel)}. SEEK ITS ALTAR.`, true);
    }
    this.noteTalk(name, `${name} SAID ${whereIs(barrow, here)}`);
    this.heardOf.add(barrow.id);
    return this.say(`${name}: ${q.villain}, ${q.villainTitle}... SO THE TALES WERE TRUE. THE BARROW LIES ${compass(here, barrow)}. END THIS.`, true);
  }

  /**
   * What the Journal shows under the current quest objective: where to go and what to do,
   * using what the player has learned so far.
   */
  objectiveHints(): string[] {
    const q = this.world.quest;
    const f = this.flags;
    const village = this.villageSite();
    const chapel = this.world.sites[q.chapelId];
    const barrow = this.world.sites[q.barrowId];
    const fromYou = (site: Site) => {
      if (this.at?.siteId === site.id) return `YOU ARE THERE NOW.`;
      return `FROM HERE IT LIES ${compass(this.overworld, site)}.`;
    };
    if (f.won) return [];
    if (f.questDone) {
      const hints: string[] = [];
      q.lieutenants.forEach((l, i) => {
        if (this.blight.ltDead[i]) return;
        const den = this.world.sites[l.siteId];
        const town = this.world.sites.find((s) => s.kind === 'village' && s.region === l.region);
        hints.push(this.heardOf.has(den.id) || this.visited.has(den.id)
          ? `${l.name}: ${siteTitle(den)}. ${fromYou(den)}`
          : `${l.name}: ASK IN ${town ? town.name : this.world.regions[l.region].name}, IN ${this.world.regions[l.region].name}.`);
      });
      if (!hints.length) {
        const hold = this.world.sites[q.strongholdId];
        hints.push(`THE ${hold.name} IS IN THE BLIGHT.`, fromYou(hold));
      }
      return hints;
    }
    if (!f.talkedElder) return [`${q.elderName} WAITS IN ${village.name}.`, fromYou(village)];
    if (!f.searchedChapel) {
      return [whereIs(chapel, village), 'SEARCH THE ALTAR INSIDE.', fromYou(chapel)];
    }
    if (!f.killedBoss) {
      const hints = [whereIs(barrow, chapel), 'THE IRON KEY FROM THE ALTAR OPENS ITS DOOR.'];
      if (this.visited.has(barrow.id)) hints.push(`${q.villain} WAITS ON THE THIRD AND DEEPEST FLOOR.`);
      hints.push(fromYou(barrow));
      return hints;
    }
    return [`BRING THE ${q.relic} TO ${q.elderName} IN ${village.name}.`, fromYou(village)];
  }

  private questHint(): string {
    const q = this.world.quest;
    const here = this.villageSite();
    if (this.flags.won) return 'GO IN PEACE. THE WORLD IS WIDE.';
    if (this.flags.questDone) return this.signWhole ? `THE ${q.relic} IS WHOLE. THE BLIGHT AWAITS YOU.` : `THE SERVANTS OF ${q.villain} KEEP THE SHARDS. SEEK THEM IN THE FAR TOWNS.`;
    if (!this.flags.talkedElder) return `SPEAK WITH ${q.elderName}, OUR ELDER.`;
    if (!this.flags.searchedChapel) return `THE OLD CHAPEL LIES ${compass(here, this.world.sites[q.chapelId])}. ITS ALTAR KEEPS A SECRET.`;
    if (!this.flags.killedBoss) return `THE BARROW LIES ${compass(here, this.world.sites[q.barrowId])}. CARRY TORCHES. CARRY DRAUGHTS.`;
    return `BRING THE ${q.relic} TO ${q.elderName}.`;
  }

  private innRest(): void {
    const p = this.player;
    const price = this.innPrice();
    if (p.gold < price) return this.say('YOU CANNOT AFFORD A BED.');
    p.gold -= price;
    p.hp = p.maxHp;
    p.mp = maxMp(p);
    const morning = (Math.floor(this.time / 1440) + (this.hour >= 8 ? 1 : 0)) * 1440 + 8 * 60;
    this.time = morning;
    this.sounds.push('rest');
    this.say('YOU SLEEP IN A REAL BED AND WAKE AT DAWN, RESTED.');
    this.save();
  }

  private innRumour(a: Actor): void {
    const p = this.player;
    if (p.gold < 2) return this.say('YOU CANNOT AFFORD A DRINK.');
    p.gold -= 2;
    const site = this.hereSite();
    const news = this.raidRumour(a) ?? this.newsRumour(`inn${a.name}`);
    this.hearRumour(a, news ?? rumour(this.world, `${a.name}${this.day}`, site, this.flags.won), site);
  }

  private templeHeal(): void {
    const p = this.player;
    if (p.hp >= p.maxHp) return this.say('YOU ARE NOT HURT.');
    if (p.gold < 5) return this.say('THE TEMPLE ASKS 5 GOLD.');
    p.gold -= 5;
    p.hp = p.maxHp;
    this.sounds.push('spell');
    this.say('THE PRIEST LAYS HANDS ON YOU. YOUR WOUNDS CLOSE.');
  }

  private openChest(chest: Chest): void {
    const p = this.player;
    if (this.isOpened(chest)) return this.say('THE CHEST IS EMPTY.');
    if (chest.id.startsWith('quest:')) {
      const q = this.quests.find((t) => `quest:${t.id}` === chest.id);
      this.openedChests.add(chest.id);
      this.level = { ...this.level, chests: this.level.chests.filter((c) => c !== chest) };
      if (q) this.questReturn(q, `YOU FIND ${q.thing}! ${q.giver} WILL BE GLAD.`);
      return this.endTurn();
    }
    if (chest.owned && !this.stealOk.has(chest.id)) {
      // Never by accident: ask before the first try at someone's strongbox.
      this.choice = {
        title: 'THIS IS NOT YOURS',
        text: 'THIS STRONGBOX BELONGS TO SOMEONE HERE. TAKING FROM IT IS STEALING.',
        options: [
          { label: 'LEAVE IT', run: () => {} },
          { label: 'STEAL FROM IT', run: () => { this.stealOk.add(chest.id); this.openChest(chest); } },
        ],
      };
      return;
    }
    if (chest.owned) {
      const witness = this.witnessTo(chest);
      if (witness) return this.caughtStealing(witness);
    }
    if (chest.locked && !this.unlockedDoors.has(chest.id) && !chest.owned && hasItem(p, 'key')) {
      removeItem(p, 'key');
      this.unlockedDoors.add(chest.id);
      this.say('THE IRON KEY TURNS, AND SNAPS IN THE LOCK.');
    }
    if (chest.locked && !this.unlockedDoors.has(chest.id)) {
      const roll = this.rng.dice(1, 20);
      if (roll !== 20 && roll + lockpick(p) < chest.dc) {
        this.sounds.push('click');
        this.say('THE LOCK HOLDS. TRY AGAIN?');
        return this.endTurn();
      }
      this.unlockedDoors.add(chest.id);
      this.say('CLICK! THE LOCK OPENS.');
    }
    this.openedChests.add(chest.id);
    const found: string[] = [];
    const things: string[] = [];
    for (const l of chest.loot) {
      if (l.gold) {
        p.gold += l.gold;
        found.push(`${l.gold} GOLD`);
        this.noteGold(l.gold);
      }
      if (l.item) {
        addItem(p, l.item, l.count ?? 1);
        const name = (l.count ?? 1) > 1 ? `${l.count} ${plural(ITEMS[l.item].name)}` : ITEMS[l.item].name;
        found.push(name);
        things.push((l.count ?? 1) > 1 ? name : article(ITEMS[l.item].name));
      }
    }
    if (things.length) this.note({ kind: 'found', text: `FOUND ${things.join(' AND ')}`, sub: [] });
    this.sounds.push('coin');
    this.say(`YOU FIND ${found.join(', ')}.`);
    this.endTurn();
  }

  /** A locked door: a key opens it; otherwise pick it or force it, whichever you're better at. */
  private pickDoor(x: number, y: number): void {
    const p = this.player;
    const open = (text: string) => {
      this.level.tiles[y * this.level.w + x] = T.DDoor;
      this.unlockedDoors.add(`${this.level.id}:${x},${y}`);
      this.sounds.push('door');
      this.say(text);
      this.endTurn();
    };
    if (hasItem(p, 'key')) {
      removeItem(p, 'key');
      return open('THE IRON KEY TURNS, AND SNAPS IN THE LOCK. THE DOOR IS OPEN.');
    }
    const roll = this.rng.dice(1, 20);
    const force = mod(p.attrs.str) + 2 > lockpick(p);
    if (!force) {
      if (roll !== 20 && roll + lockpick(p) < HARD) {
        this.sounds.push('click');
        this.say('THE DOOR IS LOCKED. YOUR PICKING FAILS.');
        return this.endTurn();
      }
      return open('CLICK! THE DOOR SWINGS OPEN.');
    }
    // Shoulder to the door: it works sooner or later, but nothing nearby sleeps through it.
    const heard = this.actors.filter((a) => a.monster && Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) <= 10);
    for (const a of heard) { a.awake = true; a.asleep = 0; }
    if (roll !== 20 && roll + mod(p.attrs.str) + 2 < HARD) {
      this.sounds.push('hit');
      this.say('YOU THROW YOUR SHOULDER AT THE DOOR. IT HOLDS. THE NOISE CARRIES.');
      return this.endTurn();
    }
    open('CRASH! THE DOOR BURSTS OPEN. THE NOISE CARRIES.');
  }

  private useAltar(): void {
    const q = this.world.quest;
    const site = this.at ? this.world.sites[this.at.siteId] : null;
    if (site?.kind !== 'chapel') return this.say('YOU KNEEL AND PRAY A WHILE.');
    if (this.flags.searchedChapel) return this.say('THE ALTAR IS COLD AND SILENT.');
    this.flags.searchedChapel = true;
    this.heardOf.add(q.barrowId);
    this.keywords.add('quest:villain');
    this.keywords.add('quest:relic');
    this.flags.talkedElder = true;
    this.note({
      kind: 'quest',
      text: 'SEARCHED THE ALTAR OF THE OLD CHAPEL',
      sub: [
        `LEARNED OF ${q.villain}, ${q.villainTitle}.`,
        'FOUND THE BARROW KEY.',
        `THE CARVING SAYS ${whereIs(this.world.sites[q.barrowId], site)}`,
      ],
    });
    addItem(this.player, 'barrowkey');
    this.sounds.push('quest');
    this.say(`CARVED IN THE ALTAR: HERE WAS BOUND ${q.villain}, ${q.villainTitle}, THIEF OF THE ${q.relic}.`, true);
    this.say('THE STONE IS CRACKED. WHATEVER WAS BOUND HAS WOKEN.', true);
    this.say(`BENEATH THE STONE LIES AN IRON KEY. THE BARROW LIES ${compass(site, this.world.sites[q.barrowId])}.`, true);
    this.gainXp(50);
    this.save();
  }

  private useStatue(): void {
    const siteId = this.at?.siteId ?? -1;
    if (this.shrineDays[siteId] === this.day) return this.say('THE STATUE IS SILENT. RETURN TOMORROW.');
    this.shrineDays[siteId] = this.day;
    const p = this.player;
    p.hp = p.maxHp;
    p.mp = maxMp(p);
    this.sounds.push('spell');
    this.say("THE STATUE'S EYES GLOW. YOU FEEL WHOLE AGAIN.");
  }

  // =====================================================================
  // The world's turn
  // =====================================================================

  // ---------- the world tick ----------

  /** Bring the world up to today: every day not yet run, in order. */
  runWorld(): void {
    // A new day: the game saves itself at dawn.
    if (this.day > this.savedDay) {
      const first = this.savedDay === 0;
      this.savedDay = this.day;
      if (!first && !this.dead) this.save();
    }
    catchUp(this.world, this.worldState, this.day);
    this.blightNews();
    // Jobs that couldn't wait.
    for (const q of this.quests) {
      if (q.state !== 'active' || q.deadline === undefined || this.day <= q.deadline) continue;
      q.state = 'failed';
      this.say(`TOO LATE: ${questTitle(this.world, q)}. ${questStep(this.world, q)}`, true);
      this.note({ kind: 'quest', text: `FAILED: ${questTitle(this.world, q)}`, sub: [] });
    }
  }

  // ---------- the Blight and the later acts ----------

  /** Which tune fits where the player is now. */
  tune(): 'village' | 'road' | 'night' | 'dungeon' | 'blight' | 'boss' {
    if (this.actors.some((a) => (a.final || a.lieutenant !== undefined) && a.awake)) return 'boss';
    if (this.level.kind === 'dungeon') return 'dungeon';
    if (this.level.kind === 'town') return this.abandoned(this.level.siteId) ? 'blight' : 'village';
    if (this.level.kind === 'overworld') {
      if (this.isBlighted(this.player.x, this.player.y)) return 'blight';
      return this.night ? 'night' : 'road';
    }
    return this.level.dark ? 'dungeon' : this.night ? 'night' : 'road';
  }

  /** Regions under the Blight today. */
  blightedNow(): number[] {
    return blightedRegions(this.world, this.blight, this.day);
  }

  /** Is this spot (or site) in blighted land? */
  isBlighted(x: number, y: number): boolean {
    return this.blightedNow().includes(this.world.regionOf[y * this.world.size + x]);
  }

  /** A hamlet the Blight has emptied. (Towns hold out behind their walls.) */
  abandoned(siteId: number): boolean {
    const s = this.world.sites[siteId];
    return s.kind === 'hamlet' && this.isBlighted(s.x, s.y);
  }

  /** The Blight's clock starts the first time the player sets foot outside the Vale. */
  private checkLeftVale(): void {
    if (this.blight.leftVale !== undefined || this.level.kind !== 'overworld') return;
    if (regionAt(this.world, this.player.x, this.player.y).type !== 'vale') this.blight.leftVale = this.day;
  }

  /** Tell the player, once, when the Blight takes a region or lets one go. */
  private blightNews(): void {
    const now = this.blightedNow();
    const heart = this.world.regions.find((r) => r.type === 'blight')?.id;
    const told = this.blight.told;
    for (const id of now) {
      if (id === heart || told.includes(id)) continue;
      told.push(id);
      const name = this.world.regions[id].name;
      this.worldState.events.push({ day: this.day, kind: 'blight', text: `THE BLIGHT HAS COME TO ${name}. THE HAMLETS THERE STAND EMPTY.` });
      this.say(`A GREY PALL HANGS ON THE HORIZON. THE BLIGHT HAS SPREAD INTO ${name}.`, true);
      this.note({ kind: 'quest', text: `THE BLIGHT SPREAD INTO ${name}`, sub: [] });
    }
    for (const id of [...told]) {
      if (now.includes(id)) continue;
      told.splice(told.indexOf(id), 1);
      const name = this.world.regions[id].name;
      this.worldState.events.push({ day: this.day, kind: 'blight', text: `THE GREY HAS LIFTED FROM ${name}. FOLK ARE GOING HOME.` });
      this.say(`THE GREY HAS LIFTED FROM ${name}.`, true);
    }
  }

  /** Have all three parts of the sign been won: the relic, and both lieutenants' shards? */
  private get signWhole(): boolean {
    return this.flags.killedBoss && this.world.quest.lieutenants.every((_, i) => this.blight.ltDead[i]);
  }

  /** Arriving where a lieutenant dens (deepest floor): there they are. */
  private actArrive(site: Site, floor: number, level: Level): void {
    const q = this.world.quest;
    const i = q.lieutenants.findIndex((l) => l.siteId === site.id);
    if (i < 0 || this.blight.ltDead[i] || floor !== level.floors) return;
    const lt = q.lieutenants[i];
    const rng = new Rng(this.world.seed, 'lieutenant', i);
    const spot = farSpot(level, rng, (x, y) => !!this.actorAt(x, y) || !!this.chestAt(x, y)) ?? level.entry;
    const a = this.spawnMonster(lt.kind, spot.x, spot.y);
    a.name = lt.name;
    a.lieutenant = i;
    a.boss = true; // shrugs off HOLD and SLEEP like any boss
    a.tier = 3;
    a.hp = a.maxHp = 40 + 6 * this.dangerHere();
    a.awake = false;
    this.say(`THE AIR IS WRONG HERE. ${lt.name} IS CLOSE.`, true);
  }

  private lieutenantFalls(a: Actor): void {
    const q = this.world.quest;
    const lt = q.lieutenants[a.lieutenant!];
    this.blight.ltDead[a.lieutenant!] = true;
    addItem(this.player, 'shard');
    const land = this.world.regions[lt.region].name;
    this.sounds.push('fanfare');
    this.note({ kind: 'quest', text: `SLEW ${lt.name}`, sub: [`TOOK A SHARD OF THE ${q.relic}.`, `${land} IS FREE OF THE BLIGHT.`] });
    this.say(`${lt.name} IS DEAD! AMONG THE ASHES LIES A SHARD OF THE ${q.relic}.`, true);
    for (const s of this.world.sites) if (s.region === lt.region && (s.kind === 'village' || s.kind === 'hamlet')) this.changeRep(s.id, 3);
    this.say(this.signWhole
      ? `THE ${q.relic} IS WHOLE. THE GATE OF THE ${this.world.sites[q.strongholdId].name} WILL OPEN TO IT NOW.`
      : `${land} WILL NOT FALL TO THE BLIGHT NOW. ONE LIEUTENANT REMAINS.`, true);
    this.blightNews();
    this.save();
  }

  /** The villain, bloodied, rises again: healed in part, with wights at their side. */
  private secondWind(a: Actor): void {
    a.phase2 = true;
    a.hp = Math.min(a.maxHp, a.hp + Math.round(a.maxHp * 0.25));
    a.tier = (a.tier ?? 0) + 1;
    let raised = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      if (raised >= 2 || !this.canStand(a.x + dx, a.y + dy)) continue;
      this.spawnMonster('wight', a.x + dx, a.y + dy).awake = true;
      raised++;
    }
    this.effects.push({ kind: 'flash', cells: [{ x: a.x, y: a.y }], color: '#aa44ff', start: now() });
    this.say(`${a.name} SPEAKS A WORD THAT HURTS TO HEAR. WOUNDS CLOSE. THE DEAD RISE AT ${a.name}'S SIDE!`, true);
  }

  private villainFalls(): void {
    const q = this.world.quest;
    this.flags.won = true;
    this.blight.wonDay = this.day;
    this.sounds.push('fanfare');
    this.note({ kind: 'quest', text: `DESTROYED ${q.villain}, ${q.villainTitle}`, sub: ['THE BLIGHT BEGINS TO LIFT.'] });
    for (const s of this.world.sites) if (s.kind === 'village' || s.kind === 'hamlet') this.changeRep(s.id, 5);
    this.gainXp(1000);
    this.ending = true;
    this.save();
  }

  // ---------- side quests ----------

  /** The jobs offered here today that the player hasn't taken. */
  offersHere(): SideQuest[] {
    if (!this.at || this.at.floor !== 1) return [];
    const site = this.world.sites[this.at.siteId];
    if (site.kind !== 'village' && site.kind !== 'hamlet') return [];
    if (this.abandoned(site.id)) return [];
    const key = `${site.id}:${this.day}`;
    let offers = this.offerCache.get(key);
    if (!offers) {
      const q = this.world.quest;
      const raider = this.siteStatus(site.id) ? this.worldState.raidedBy?.[site.id] : undefined;
      offers = questOffers({
        world: this.world,
        day: this.day,
        site,
        people: this.getLevel(site, 1).npcs,
        lairs: lairSites(this.world),
        lairStrength: (l) => this.worldState.lairs[l.id] ?? 0,
        raidedBy: raider !== undefined ? this.world.sites[raider] : undefined,
        peopleAt: (s) => this.getLevel(s, 1).npcs,
        reserved: new Set([q.chapelId, q.barrowId, q.strongholdId, ...q.lieutenants.map((l) => l.siteId)]),
      });
      this.offerCache.clear();
      this.offerCache.set(key, offers);
    }
    return offers.filter((o) => !this.quests.some((t) => t.id === o.id));
  }

  /** Whether a person has something for the player: a job to offer, or a job to settle. */
  hasQuestFor(a: Actor): boolean {
    if (!a.npc || !this.at) return false;
    if (a.questId) return true;
    const here = this.at.siteId;
    return this.offersHere().some((o) => o.giver === a.name)
      || this.quests.some((q) => this.settles(q, a, here));
  }

  /** Whether talking to this person finishes the quest. */
  private settles(q: SideQuest, a: Actor, here: number): boolean {
    if (q.kind === 'deliver') return q.state === 'active' && q.target === here && q.who === a.name;
    return q.state === 'return' && q.siteId === here && q.giver === a.name;
  }

  private beastsOf(q: SideQuest): string {
    return MONSTERS[lairBeast(this.world, this.world.sites[q.target])].plural;
  }

  private offerQuest(a: Actor, q: SideQuest): void {
    this.choice = {
      title: `${a.name} ASKS FOR HELP`,
      text: questPitch(this.world, q, q.kind === 'hunt' || q.kind === 'clear' ? this.beastsOf(q) : ''),
      options: [
        { label: 'I WILL DO IT', right: `${q.gold}G`, run: () => this.takeQuest(a, q) },
        { label: 'NOT NOW', run: () => {} },
      ],
    };
  }

  private takeQuest(a: Actor, offer: SideQuest): void {
    const q: SideQuest = { ...offer, taken: this.day };
    const days = deadlineFor(this.world, q);
    if (days !== undefined) q.deadline = this.day + days;
    this.quests.push(q);
    this.heardOf.add(q.target);
    const by = q.deadline !== undefined ? ` BY DAY ${q.deadline}` : '';
    this.note({ kind: 'quest', text: `NEW JOB: ${questTitle(this.world, q)}`, sub: [`FOR ${a.name}. ${questStep(this.world, q)}${by}`] });
    this.say(`${a.name}: THANK YOU. ${q.kind === 'deliver' ? `HERE IS ${q.thing}.` : 'COME BACK TO ME WHEN IT IS DONE.'}`, true);
    this.sounds.push('select');
  }

  /** Done out there: now go back and tell them. */
  private questReturn(q: SideQuest, text: string): void {
    q.state = 'return';
    this.say(text, true);
    this.note({ kind: 'quest', text: questTitle(this.world, q), sub: [text, questStep(this.world, q)] });
    this.sounds.push('fanfare');
  }

  private finishQuest(a: Actor, q: SideQuest): void {
    q.state = 'done';
    this.player.gold += q.gold;
    this.changeRep(q.siteId, q.kind === 'rescue' || q.kind === 'clear' ? 3 : 2);
    this.remember(this.keyOf(a), 'helped');
    this.say(`${a.name}: ${questThanks(q)}`, true);
    this.say(`+${q.gold} GOLD.`);
    this.note({ kind: 'quest', text: `DONE: ${questTitle(this.world, q)}`, sub: [`${q.gold} GOLD FROM ${a.name}.`] });
    this.sounds.push('coin');
    this.gainXp(q.xp);
  }

  /** Arriving somewhere a quest points to: the lost, the heirloom, or what stirs at night. */
  private questArrive(site: Site, floor: number, level: Level): void {
    for (const q of this.quests) {
      if (q.state !== 'active' || q.target !== site.id) continue;
      const rng = new Rng(this.world.seed, 'quest-spot', q.id, floor);
      const busy = (x: number, y: number) => !!this.actorAt(x, y) || !!this.chestAt(x, y);
      if (q.kind === 'rescue' && floor === level.floors) {
        const spot = farSpot(level, rng, busy);
        if (!spot) continue;
        this.actors.push({
          id: this.nextActorId++, x: spot.x, y: spot.y, hp: 1, maxHp: 1, name: q.who!,
          npc: { x: spot.x, y: spot.y, role: 'villager', name: q.who!, wander: false },
          awake: false, asleep: 0, checks: 0, questId: q.id,
        });
      }
      if (q.kind === 'recover' && floor === level.floors) {
        const spot = farSpot(level, rng, busy);
        if (!spot) continue;
        this.level = { ...this.level, chests: [...this.level.chests, { id: `quest:${q.id}`, x: spot.x, y: spot.y, locked: false, dc: 0, loot: [] }] };
      }
      if (q.kind === 'investigate' && floor === 1) {
        if (!this.night) {
          this.say('ALL IS QUIET BY DAY. THE STORIES SPOKE OF NIGHT.');
          continue;
        }
        const depth = dangerAt(this.world, site.x, site.y);
        const kinds = monstersFor(habitatFor(biomeAround(this.world, site)), depth, true);
        const pool = kinds.length ? kinds : monstersFor('dungeon', depth, true);
        let placed = 0;
        for (let r = 3; r <= 7 && placed < 3; r++) {
          for (let dy = -r; dy <= r && placed < 3; dy++) {
            for (let dx = -r; dx <= r && placed < 3; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !rng.chance(0.15)) continue;
              const x = level.entry.x + dx, y = level.entry.y + dy;
              if (x < 0 || y < 0 || x >= level.w || y >= level.h || !this.canStand(x, y) || busy(x, y)) continue;
              const m = this.spawnMonster(rng.pick(pool), x, y);
              m.questId = q.id;
              m.awake = true;
              placed++;
            }
          }
        }
        if (placed) this.say(`${q.thing}! SHAPES MOVE IN THE DARK. THIS IS WHAT THEY SAW.`, true);
      }
    }
  }

  /** Talking to the lost: found! */
  private rescued(a: Actor): void {
    const q = this.quests.find((t) => t.id === a.questId);
    this.actors = this.actors.filter((x) => x !== a);
    if (!q) return;
    this.questReturn(q, `${a.name}: YOU CAME FOR ME? ${q.giver} SENT YOU? I CAN FIND MY WAY HOME FROM HERE. THANK YOU!`);
  }

  get season(): Season {
    return seasonOf(this.world.seed, this.day);
  }

  /** A raided hamlet: 'raided' (empty, shop shut), 'recovering', or null. */
  siteStatus(siteId: number): 'raided' | 'recovering' | null {
    return hamletStatus(this.worldState, siteId, this.day);
  }

  /**
   * The raid on the hamlet the player is in, if it was raided lately:
   * how it stands, which lair did it, what came, and whether the lair has since been cleared.
   */
  raidHere(): { status: 'raided' | 'recovering'; lair?: Site; beasts: string; cleared: boolean } | null {
    if (!this.at) return null;
    const id = this.at.siteId;
    const status = this.siteStatus(id);
    if (!status) return null;
    const lairId = this.worldState.raidedBy?.[id];
    const lair = lairId !== undefined ? this.world.sites[lairId] : undefined;
    const beasts = lair ? MONSTERS[lairBeast(this.world, lair)].plural : 'RAIDERS';
    const raidDay = this.worldState.raids[id];
    const cleared = !!lair && this.worldState.events.some((e) => e.kind === 'cleared' && e.siteId === lair.id && e.day >= raidDay);
    return { status, lair, beasts, cleared };
  }

  /** What villagers say first in a raided hamlet, by temperament. */
  private raidGreeting(a: Actor, r: NonNullable<ReturnType<Game['raidHere']>>): string {
    if (r.cleared && r.lair) {
      const thanks: Record<Trait, string> = {
        kind: `YOU CLEARED ${siteTitle(r.lair)}! WE CAN SLEEP AGAIN.`,
        greedy: `THE ONE WHO CLEARED ${siteTitle(r.lair)}. TRADE'S BETTER ALREADY.`,
        fearful: `ARE THEY REALLY ALL GONE? THANK YOU. THANK YOU.`,
        proud: `YOU DID WHAT WE COULDN'T. WE WON'T FORGET IT.`,
        devout: `THE GODS SENT YOU TO US, I'M SURE OF IT.`,
      };
      return thanks[this.traitOf(a)];
    }
    if (a.npc?.role === 'shopkeeper' && r.status === 'recovering') return "STOCK'S THIN SINCE THE RAID, BUT I'M OPEN.";
    if (a.npc?.role === 'innkeeper') {
      return r.status === 'raided' ? 'THE BEDS ARE STILL HERE. NOT MUCH ELSE IS.' : 'A FEW TRAVELLERS AGAIN. IT HELPS.';
    }
    const raided: Record<Trait, string> = {
      kind: 'THEY TOOK WHAT THEY COULD CARRY. ARE YOU HURT, STRANGER?',
      greedy: `EVERYTHING I HAD, GONE. THOSE ${r.beasts} WILL PAY.`,
      fearful: 'ARE THEY GONE? ARE THEY COMING BACK?',
      proud: "THEY BURNED OUR WALLS. WE'LL BUILD THEM AGAIN.",
      devout: 'THE GODS SPARED OUR LIVES, AT LEAST.',
    };
    const mending: Record<Trait, string> = {
      kind: "WE'RE MENDING. SLOWLY. THANK YOU FOR ASKING.",
      greedy: 'REBUILDING COSTS MONEY. LOTS OF IT.',
      fearful: "I DON'T SLEEP MUCH SINCE THE RAID.",
      proud: 'SEE THOSE WALLS? GOING BACK UP ALREADY.',
      devout: "WE PRAY THEY DON'T RETURN.",
    };
    return (r.status === 'raided' ? raided : mending)[this.traitOf(a)];
  }

  /** The talk of a raided hamlet: what came, from where, and what should be done. */
  private raidRumour(a: Actor): Rumour | null {
    const r = this.raidHere();
    if (!r) return null;
    const here = this.hereSite();
    if (!r.lair) return { line: `RAIDERS CAME IN THE NIGHT. WE NEVER SAW WHERE FROM.` };
    if (r.cleared) return { line: `SINCE ${siteTitle(r.lair)} WAS CLEARED, THE ROADS ARE QUIET. WE OWE YOU.`, site: r.lair };
    const where = `${siteTitle(r.lair)}, ${compass(here, r.lair)} OF HERE, ${distanceWords(here, r.lair)}`;
    const lines = [
      `${r.beasts} CAME FROM ${where}. UNTIL SOMEONE CLEARS IT OUT, THEY'LL BE BACK.`,
      `THEY CAME OUT OF THE DARK, ${r.beasts}, DOZENS OF THEM. THEY NEST AT ${where}.`,
      `THEY TOOK GRAIN, TOOLS, COIN. IF YOU'VE A BLADE, GO TO ${where}.`,
    ];
    return { line: new Rng(this.world.seed, 'raid-talk', a.name).pick(lines), site: r.lair };
  }

  /** Recent news, as a rumour (or null if there's none to tell). */
  private newsRumour(seedText: string): Rumour | null {
    const news = recentEvents(this.worldState, this.day);
    if (!news.length) return null;
    const e = new Rng(this.world.seed, 'news', seedText, this.day).pick(news);
    return { line: e.text, site: e.siteId !== undefined ? this.world.sites[e.siteId] : undefined };
  }

  /** Caravans on the open map: traders appear when near, move along their road, and go. */
  private syncCaravans(): void {
    if (this.level.kind !== 'overworld') return;
    const p = this.player;
    for (const c of caravans(this.world)) {
      const at = caravanAt(c, this.time);
      let actor = this.actors.find((a) => a.caravan === c.id);
      const near = at && Math.max(Math.abs(at.x - p.x), Math.abs(at.y - p.y)) <= 12;
      if (!near) {
        if (actor) this.actors = this.actors.filter((a) => a !== actor);
        continue;
      }
      if (!actor && at) {
        actor = {
          id: this.nextActorId++, x: at.x, y: at.y, hp: 1, maxHp: 1, name: c.name,
          npc: { x: at.x, y: at.y, role: 'trader', name: c.name, wander: false },
          awake: false, asleep: 0, checks: 0, caravan: c.id,
        };
        this.actors.push(actor);
      }
      if (!actor || !at) continue;
      // Moves on along the road, unless someone's standing in the way.
      if ((at.x !== p.x || at.y !== p.y) && !this.actors.some((o) => o !== actor && o.x === at.x && o.y === at.y)) {
        actor.x = at.x;
        actor.y = at.y;
      }
    }
  }

  private endTurn(): void {
    this.turn++;
    const overworld = this.level.kind === 'overworld';
    this.advanceTime(overworld ? 15 : 1);

    if (overworld) {
      this.checkLeftVale();
      this.steps++;
      this.spawnWanderers();
      this.syncCaravans();
      this.markExplored();
    }
    this.runWorld();

    // Slow healing while travelling.
    const every = Math.max(10, 30 - 3 * heal(this.player));
    if (this.turn % every === 0 && this.player.hp < this.player.maxHp ) this.player.hp++;
    // A wizard's MP comes back as they go, faster with more WIS.
    const p = this.player;
    const mpEvery = Math.max(5, 12 - 2 * mod(p.attrs.wis));
    if (p.cls === 'wizard' && p.mp < maxMp(p) && this.turn % (hasPerk(p, 'quickmind') ? Math.ceil(mpEvery / 2) : mpEvery) === 0) p.mp++;
    if (p.ward && --p.ward.turns <= 0) {
      p.ward = undefined;
      this.say('YOUR WARD FADES.');
    }
    if (p.shielded && --p.shielded <= 0) {
      p.shielded = undefined;
      this.say('YOUR SHIELD SPELL FADES.');
    }

    // Light burns down in dark places.
    if (this.level.dark && this.player.light.turns > 0) {
      this.player.light.turns--;
      if (this.player.light.turns === 0) {
        this.say('YOUR LIGHT GOES OUT.');
        this.autoLight();
      }
    }

    this.monstersAct();
    this.updateVisibility();
  }

  private advanceTime(minutes: number): void {
    const wasNight = this.night;
    this.time += minutes;
    if (this.level.kind === 'overworld' || this.level.kind === 'town' || this.level.kind === 'outdoor') {
      if (!wasNight && this.night) this.say('NIGHT FALLS.');
      if (wasNight && !this.night) this.say('DAWN BREAKS.');
    }
  }

  private autoLight(): void {
    const p = this.player;
    if (p.light.turns > 0) return;
    if (hasItem(p, 'torch')) {
      removeItem(p, 'torch');
      p.light = { turns: 400, radius: 5 };
      this.say('IT IS DARK. YOU LIGHT A TORCH.');
    } else {
      p.light = { turns: 0, radius: 2 };
      this.say(p.cls === 'wizard' ? 'IT IS DARK. CAST GLOW TO SEE.' : 'IT IS DARK, AND YOU HAVE NO TORCH.');
    }
  }

  // ---------- daily routines ----------

  /** The time of day for routines: morning, afternoon, evening or night. */
  get watch(): Watch {
    return watchAt(this.time % 1440);
  }

  /** When townsfolk last moved, so a long rest puts them straight where they should be. */
  private npcClock = 0;

  /** Where someone wants to be right now. A guard keeps close to a player the village dislikes. */
  private npcGoal(a: Actor): { x: number; y: number } {
    const r = a.routine!;
    if (this.isFollowing(a)) return { x: this.player.x, y: this.player.y };
    return r.spots[this.watch];
  }

  /**
   * Is this person in the player's way? Anyone in a doorway or gate (or when the player
   * stands in one), and the guard who is following the player. Walking into them swaps places.
   */
  inTheWay(a: Actor): boolean {
    const doorish = (x: number, y: number) => {
      const t = this.tileAt(x, y);
      return t === T.Door || t === T.Gate;
    };
    if (doorish(a.x, a.y) || doorish(this.player.x, this.player.y)) return true;
    return !!a.routine && this.isFollowing(a);
  }

  /** The guard who shadows a player the village dislikes. */
  private isFollowing(a: Actor): boolean {
    if (a.npc?.role !== 'guard' || !this.at || this.repOf(this.at.siteId) > -2) return false;
    return this.actors.find((x) => x.npc?.role === 'guard') === a;
  }

  /** Put everyone where their routine says, at once (on arriving, loading, or after a rest). */
  snapNpcs(): void {
    const taken = new Set<string>([`${this.player.x},${this.player.y}`, `${this.level.entry.x},${this.level.entry.y}`]);
    for (const a of this.actors) {
      if (!a.routine) continue;
      let spot = a.routine.spots[this.watch];
      if (taken.has(`${spot.x},${spot.y}`)) spot = this.freeNear(spot, taken) ?? { x: a.x, y: a.y };
      a.x = spot.x;
      a.y = spot.y;
      taken.add(`${a.x},${a.y}`);
      a.asleep = this.isAsleepNow(a) ? 1 : 0;
    }
    this.npcClock = this.time;
  }

  private isAsleepNow(a: Actor): boolean {
    const r = a.routine;
    if (!r || !r.sleeps || this.watch !== 'night') return false;
    const bed = r.spots.night;
    return a.x === bed.x && a.y === bed.y;
  }

  /** A walkable, empty spot next to (or near) `s`. */
  private freeNear(s: { x: number; y: number }, taken: Set<string>): { x: number; y: number } | undefined {
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = s.x + dx, y = s.y + dy;
        if (taken.has(`${x},${y}`) || !this.canStand(x, y) || this.tileAt(x, y) === T.Gate) continue;
        return { x, y };
      }
    }
    return undefined;
  }

  /** One step of someone's day: walk towards their spot, stroll about it, or sleep. */
  private npcStep(a: Actor): void {
    if (this.time - this.npcClock > 30) return this.snapNpcs();
    this.npcClock = this.time;
    // Never share a tile with the player (say, after waking in the temple).
    if (a.x === this.player.x && a.y === this.player.y) {
      const spot = this.freeNear(a, new Set(this.actors.map((o) => `${o.x},${o.y}`)));
      if (spot) { a.x = spot.x; a.y = spot.y; }
      return;
    }
    const goal = this.npcGoal(a);
    const following = goal.x === this.player.x && goal.y === this.player.y;
    if (a.asleep > 0) {
      if (this.watch === 'night') return;
      a.asleep = 0; // morning: up and about
    }
    const near = Math.abs(a.x - goal.x) + Math.abs(a.y - goal.y);
    if (following && near <= 2) return; // close enough to keep an eye on you
    if (near === 0) {
      if (this.isAsleepNow(a)) a.asleep = 1;
      return;
    }
    if (a.routine!.strolls.includes(this.watch) && near <= 3) {
      if (this.rng.chance(0.2)) this.wander(a);
      return;
    }
    // A guard following you waits outside: never through a door after you.
    const door = (x: number, y: number) => following && this.tileAt(x, y) === T.Door;
    const occupied = (x: number, y: number) =>
      (x === this.player.x && y === this.player.y) || door(x, y) || this.actors.some((o) => o !== a && o.x === x && o.y === y);
    const next = stepTowards(this.level, a, goal, occupied);
    if (next && !occupied(next.x, next.y)) {
      a.x = next.x;
      a.y = next.y;
    }
  }

  private monstersAct(): void {
    const p = this.player;
    for (const a of [...this.actors]) {
      if (this.dead) return;
      if (!this.actors.includes(a)) continue;
      if (a.npc) {
        if (a.routine) this.npcStep(a);
        else if (a.npc.wander && this.rng.chance(0.2)) this.wander(a);
        continue;
      }
      if (a.asleep > 0) { a.asleep--; continue; }
      if (a.held && a.held > 0) { a.held--; continue; }
      const d = dist(a, p);
      if (d > 24 && this.level.kind === 'overworld') {
        this.actors = this.actors.filter((x) => x !== a);
        continue;
      }
      if (!a.awake) {
        // Sneak checks: once when it first gets close, once more when adjacent.
        const due = (d <= 6 && a.checks === 0) || (d <= 1 && a.checks === 1);
        if (due) {
          a.checks++;
          const level = MONSTERS[a.monster!].level;
          if (this.rng.dice(1, 20) + this.stealth(a) < 10 + level) a.awake = true;
        }
        if (!a.awake) {
          if (this.rng.chance(0.3)) this.wander(a);
          continue;
        }
      }
      const way = a.boss ? undefined : MONSTERS[a.monster!].way;
      // Wolves and their like: the first cry brings every beast in earshot.
      if (way === 'calls' && !a.called) {
        a.called = true;
        const woken = this.actors.filter((o) => o !== a && o.monster && !o.awake && o.asleep <= 0 && dist(o, a) <= 8);
        for (const o of woken) { o.awake = true; o.called = true; }
        if (woken.length && this.isVisible(a.x, a.y)) this.say(`${the(a)} HOWLS. SOMETHING ANSWERS.`);
      }
      // Goblins and their like: badly hurt, they run (and fight only if cornered).
      if (way === 'flees' && a.hp <= a.maxHp / 3 && d <= 7) {
        const moved = this.stepAway(a, p.x, p.y);
        if (!moved && d === 1) this.monsterAttack(a);
        continue;
      }
      if (d === 1) {
        this.monsterAttack(a);
        continue;
      }
      // Bandits and their like: an arrow from a few steps off, when they have a clear shot.
      if (way === 'shoots' && d >= 2 && d <= 5 && this.isVisible(a.x, a.y) && this.clearLine(a.x, a.y, p.x, p.y) && this.rng.chance(0.6)) {
        this.monsterAttack(a, true);
        continue;
      }
      if (d < 16) this.stepToward(a, p.x, p.y);
    }
  }

  private canStand(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    if (!TERRAIN[t].walk || t === T.Site || t === T.Gate || t === T.StairsUp || t === T.StairsDown) return false;
    if (x === this.player.x && y === this.player.y) return false;
    if (this.chestAt(x, y)) return false;
    return !this.actorAt(x, y);
  }

  private wander(a: Actor): void {
    const [dx, dy] = DIRS[this.rng.pick<Dir>(['up', 'down', 'left', 'right'])];
    if (this.canStand(a.x + dx, a.y + dy)) {
      if (a.npc && this.tileAt(a.x + dx, a.y + dy) === T.Door) return;
      // Townsfolk keep off the road and out of each other's elbows when they stroll.
      if (a.npc && a.routine) {
        const x = a.x + dx, y = a.y + dy;
        if (this.tileAt(x, y) === T.Cobble) return;
        if (this.actors.some((o) => o !== a && o.npc && Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) <= 1)) return;
      }
      a.x += dx;
      a.y += dy;
    }
  }

  /** One step directly away from a spot, if there's room. */
  private stepAway(a: Actor, fx: number, fy: number): boolean {
    const dx = Math.sign(a.x - fx), dy = Math.sign(a.y - fy);
    const options: [number, number][] = Math.abs(a.x - fx) >= Math.abs(a.y - fy)
      ? [[dx, 0], [0, dy || 1], [0, -(dy || 1)]]
      : [[0, dy], [dx || 1, 0], [-(dx || 1), 0]];
    for (const [ox, oy] of options) {
      if ((ox || oy) && this.canStand(a.x + ox, a.y + oy)) {
        a.x += ox;
        a.y += oy;
        return true;
      }
    }
    return false;
  }

  private stepToward(a: Actor, tx: number, ty: number): void {
    const dx = Math.sign(tx - a.x), dy = Math.sign(ty - a.y);
    const options: [number, number][] = Math.abs(tx - a.x) >= Math.abs(ty - a.y)
      ? [[dx, 0], [0, dy], [0, dy || 1], [0, -(dy || 1)]]
      : [[0, dy], [dx, 0], [dx || 1, 0], [-(dx || 1), 0]];
    for (const [ox, oy] of options) {
      if (ox === 0 && oy === 0) continue;
      if (this.canStand(a.x + ox, a.y + oy)) {
        a.x += ox;
        a.y += oy;
        return;
      }
    }
  }

  /** Wandering monsters on the overworld, picked by terrain, distance and time of day. */
  private spawnWanderers(): void {
    const monsters = this.actors.filter((a) => a.monster).length;
    const cap = this.night ? 5 : 3;
    const p = this.player;
    const centre = this.world.size / 2;
    const fromVale = Math.hypot(p.x - centre, p.y - centre);
    const band = bandsNear(this.world, this.worldState, p.x, p.y);
    const rate = (fromVale < 20 ? 0.025 : dangerAt(this.world, p.x, p.y) >= 5 ? 0.08 : 0.06) + (band ? 0.05 : 0);
    if (monsters >= cap || !this.rng.chance(rate)) return;
    for (let tries = 0; tries < 10; tries++) {
      const angle = this.rng.next() * Math.PI * 2;
      const r = this.rng.int(9, 13);
      const x = Math.round(p.x + Math.cos(angle) * r), y = Math.round(p.y + Math.sin(angle) * r);
      const tile = this.tileAt(x, y);
      if (!this.canStand(x, y) || tile === T.Road) continue;
      const depth = Math.min(5, dangerAt(this.world, x, y)) + (this.night ? 1 : 0);
      // Near a strong lair, its beasts roam the land.
      const kinds = band && this.rng.chance(0.6) ? [lairBeast(this.world, band)] : monstersFor(habitatFor(tile), depth, this.night);
      if (!kinds.length) continue;
      const kind = this.rng.pick(kinds);
      this.spawnMonster(kind, x, y);
      this.spawnPack(kind, x, y, packSize(kind, this.dangerHere(x, y), this.rng.next()) - 1, this.rng);
      return;
    }
  }

  /** Companions for a monster: the rest of its pack, on free ground beside it. */
  private spawnPack(kind: MonsterId, x: number, y: number, more: number, rng: Rng): Actor[] {
    const pack: Actor[] = [];
    for (let i = 0; i < more; i++) {
      const spots = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]
        .map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
        .filter((s) => this.canStand(s.x, s.y) && !this.actorAt(s.x, s.y) && !(s.x === this.player.x && s.y === this.player.y));
      if (!spots.length) break;
      const s = rng.pick(spots);
      pack.push(this.spawnMonster(kind, s.x, s.y));
    }
    return pack;
  }

  private spawnAmbush(): void {
    const p = this.player;
    const spot = this.freeNeighbour(p.x, p.y);
    if (!spot) return;
    const habitat = this.level.kind === 'dungeon' ? 'dungeon' : habitatFor(this.tileAt(p.x, p.y));
    const site = this.at ? this.world.sites[this.at.siteId] : null;
    const depth = site ? depthOf(this.world, site) : 2;
    const kinds = monstersFor(habitat, depth, true);
    if (!kinds.length) return;
    const a = this.spawnMonster(this.rng.pick(kinds), spot.x, spot.y);
    a.awake = true;
    for (const c of this.spawnPack(a.monster!, a.x, a.y, packSize(a.monster!, this.dangerHere(), this.rng.next()) - 1, this.rng)) c.awake = true;
  }

  private freeNeighbour(x: number, y: number): { x: number; y: number } | null {
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      if (this.canStand(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    }
    return null;
  }

  /** How far the player's light reaches in dark places (2 with no torch or spell). */
  lightRadius(): number {
    const base = this.player.light.turns > 0 ? this.player.light.radius : 2;
    return hasPerk(this.player, 'familiar') ? Math.max(4, base) : base;
  }

  /** In dark places, the player sees only as far as their light reaches. */
  updateVisibility(): void {
    if (!this.level.dark) return;
    const p = this.player;
    const { w, h } = this.level;
    const radius = this.lightRadius();
    this.visible.fill(0);
    const seen = this.seen.get(this.level.id)!;
    for (let y = p.y - radius; y <= p.y + radius; y++) {
      for (let x = p.x - radius; x <= p.x + radius; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if ((x - p.x) ** 2 + (y - p.y) ** 2 > radius * radius + 1) continue;
        if (!this.lineOfSight(p.x, p.y, x, y)) continue;
        this.visible[y * w + x] = 1;
        seen[y * w + x] = 1;
      }
    }
  }

  private lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    while (!(x === x1 && y === y1)) {
      if (!(x === x0 && y === y0) && TERRAIN[this.tileAt(x, y)].opaque) return false;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    return true;
  }

  // =====================================================================
  // Journal
  // =====================================================================

  private note(entry: Omit<JournalEntry, 'day'>): void {
    this.journal.push({ ...entry, day: this.day });
    if (this.journal.length > 150) this.journal.shift();
  }

  /** TALKED WITH X IN Y, with what they told you underneath. Things already noted aren't repeated. */
  private noteTalk(who: string, ...details: string[]): void {
    const fresh = details.filter((d) => !this.journal.some((e) => e.who === who && e.sub.includes(d)));
    if (details.length && !fresh.length) return;
    const last = this.journal[this.journal.length - 1];
    if (last?.kind === 'talk' && last.who === who && last.day === this.day) {
      last.sub.push(...fresh);
      return;
    }
    this.note({ kind: 'talk', who, text: `TALKED WITH ${who} IN ${this.placeName()}`, sub: fresh });
  }

  /** Keep what someone said about a topic, for the Journal's Topics page. */
  private noteTopic(k: Keyword, line: string): void {
    const notes = (this.topicNotes[k] ??= []);
    if (notes.includes(line)) return;
    notes.push(line);
    if (notes.length > 6) notes.shift();
  }

  /**
   * Fights are summed up: a run of kills and gold with nothing else in between becomes
   * DEFEATED 3 SKELETONS / DEFEATED 2 GIANT RATS / FOUND 6 GOLD PIECES.
   */
  private fightRun(): JournalEntry[] {
    const run: JournalEntry[] = [];
    for (let i = this.journal.length - 1; i >= 0; i--) {
      const e = this.journal[i];
      if ((e.kind !== 'defeat' && e.kind !== 'gold') || e.day !== this.day) break;
      run.unshift(e);
    }
    return run;
  }

  private noteDefeat(kind: MonsterId): void {
    const m = MONSTERS[kind];
    const run = this.fightRun();
    const same = run.find((e) => e.kind === 'defeat' && e.monster === kind);
    if (same) {
      same.count = (same.count ?? 1) + 1;
      same.text = `DEFEATED ${same.count} ${m.plural}`;
      return;
    }
    const entry: JournalEntry = { kind: 'defeat', day: this.day, monster: kind, count: 1, text: `DEFEATED ${article(m.name)}`, sub: [] };
    const gold = run.find((e) => e.kind === 'gold');
    if (gold) this.journal.splice(this.journal.indexOf(gold), 0, entry); // gold stays last
    else this.note(entry);
  }

  private noteGold(amount: number): void {
    const gold = this.fightRun().find((e) => e.kind === 'gold');
    if (gold) {
      gold.amount = (gold.amount ?? 0) + amount;
      gold.text = `FOUND ${gold.amount} GOLD PIECES`;
      return;
    }
    this.note({ kind: 'gold', amount, text: `FOUND ${amount} GOLD PIECE${amount === 1 ? '' : 'S'}`, sub: [] });
  }

  /** BOUGHT A LONGSWORD FROM MAREN: the same item bought again that day is counted together. */
  private noteBought(id: ItemId, count: number): void {
    const name = ITEMS[id].name;
    const same = this.journal.find((e) => e.kind === 'bought' && e.item === id && e.day === this.day && e.who === this.shopkeeper);
    if (same) {
      same.count = (same.count ?? 1) + count;
      same.text = `BOUGHT ${same.count} ${plural(name)} FROM ${this.shopkeeper}`;
      return;
    }
    const what = count > 1 ? `${count} ${plural(name)}` : article(name);
    this.note({ kind: 'bought', item: id, count, who: this.shopkeeper, text: `BOUGHT ${what} FROM ${this.shopkeeper}`, sub: [] });
  }

  /** The calendar date of a game day, e.g. "12 FROSTFALL 1042". */
  dateOf(day: number): string {
    return dateOf(this.world.seed, day);
  }

  // =====================================================================
  // Messages
  // =====================================================================

  say(text: string, sticky = false): void {
    const lines = wrap(text, 29);
    for (let i = 0; i < lines.length; i += 2) {
      this.messages.push({ lines: lines.slice(i, i + 2), sticky: sticky || lines.length > 2 });
    }
  }
}

// ---------- helpers ----------

/** The guided first morning: each shown once, the first time it matters. */
const TIPS = {
  start: () => 'WALK INTO PEOPLE TO TALK TO THEM. A GOLD ! MEANS THEY HAVE SOMETHING FOR YOU. THE ELDER IS WAITING.',
  elder: () => `BEFORE YOU GO: THE SHOP SELLS TORCHES AND HEALING DRAUGHTS. THE ${named('JOURNAL')} TAB ALWAYS SAYS WHERE TO GO NEXT.`,
  world: () => `THIS IS THE WIDE WORLD. THE ${named('MAP')} TAB SHOWS WHERE YOU HAVE BEEN. ROADS ARE SAFER THAN THE WILDS, AND DAY SAFER THAN NIGHT.`,
  dark: () => `IT IS DARK IN HERE. A TORCH LIGHTS ITSELF IF YOU CARRY ONE. WALK INTO A MONSTER TO STRIKE IT. ${named('ACTIONS')} HAS REST, SNEAK AND LOOK.`,
  hurt: () => `YOU ARE BADLY HURT. DRINK A DRAUGHT FROM THE ${named('ITEMS')} TAB, OR GET AWAY AND REST. AN INN BED HEALS YOU FULLY.`,
};

const TRAP_NAMES: Record<TrapKind, string> = {
  dart: 'A DART TRAP', pit: 'A COVERED PIT', alarm: 'AN ALARM WIRE', rocks: 'LOOSE ROCK OVERHEAD',
};

/** What a pulled lever does to its floor: sealed doors open, deep water drains to shallows. */
function openWorks(level: Level): void {
  for (let i = 0; i < level.tiles.length; i++) {
    const t = level.tiles[i];
    if (t === T.Sealed) level.tiles[i] = T.DDoor;
    else if (t === T.Water) level.tiles[i] = T.Shallows;
    else if (t === T.Lever) level.tiles[i] = T.LeverOff;
  }
}

/** Monsters that BANISH burns. */
const UNDEAD: MonsterId[] = ['skeleton', 'wisp', 'wight', 'boss'];

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function the(a: Actor): string {
  return a.boss ? a.name : `THE ${a.name}`;
}

/** TORCH -> TORCHES, HEAL DRAUGHT -> HEAL DRAUGHTS. */
function plural(name: string): string {
  if (/S$/.test(name)) return name;
  if (/(CH|SH|X)$/.test(name)) return `${name}ES`;
  return `${name}S`;
}

function article(name: string): string {
  return /^[AEIOU]/.test(name) ? `AN ${name}` : `A ${name}`;
}

/** What goes in the journal for a rumour: directions are kept, worked out from where it was heard. */
function rumourNote(who: string, r: Rumour, here: Site): string {
  return r.site ? `${who} SAID ${whereIs(r.site, here)}` : `${who} SAID: ${r.line}`;
}

function roleName(role: string): string {
  return role === 'villager' ? 'A VILLAGER' : role === 'beggar' ? 'A BEGGAR' : `THE ${role.toUpperCase()}`;
}

/** Split text into lines of at most `width` characters, breaking at spaces. */
export function wrap(text: string, width: number): string[] {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}
