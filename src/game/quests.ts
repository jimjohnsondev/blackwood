// Side quests: small local jobs made from what is really on the map.
//
// Every settlement offers one to three at a time, posted through talk. The offers change
// every OFFER_DAYS days and come from the seed, the settlement and that span of days, so
// they are the same every time until the player takes one. A taken quest is copied into
// the save, with its giver, target and reward, and moves through these states:
//
//   active  -> go and do the thing
//   return  -> done out there; go back to whoever is owed the news (or the parcel)
//   done    -> rewarded
//   failed  -> too late (a rescue or a delivery past its day)
//
// Six templates, from the design doc:
//   rescue       a dungeon near a settlement + someone's relative lost in it
//   hunt         a growing lair near a settlement
//   clear        a raided hamlet + the lair that raided it
//   recover      a ruin or cave + an heirloom left in it
//   deliver      two settlements + a road between them
//   investigate  a rumour + a site, where something stirs at night
import { Rng } from '../gen/rng';
import type { Level, NpcSpawn, Site, World } from '../gen/types';
import { dangerAt } from '../gen/regions';
import { personName } from '../gen/names';
import { compass, distanceWords } from './dialogue';
import { siteTitle } from './people';
import { T, TERRAIN } from './terrain';

export type QuestKind = 'rescue' | 'hunt' | 'clear' | 'recover' | 'deliver' | 'investigate';
export type QuestState = 'active' | 'return' | 'done' | 'failed';

export interface SideQuest {
  id: string;
  kind: QuestKind;
  /** The settlement that asked, and who asked. */
  siteId: number;
  giver: string;
  /** Where the job is. */
  target: number;
  /** rescue: who is lost. deliver: who to give it to. */
  who?: string;
  /** rescue: how they're related to the giver ("SON"). */
  relation?: string;
  /** recover: the heirloom. deliver: the parcel. investigate: what was seen. */
  thing?: string;
  state: QuestState;
  /** Day taken, and the last day it can be done on (rescue, deliver). */
  taken: number;
  deadline?: number;
  gold: number;
  xp: number;
}

/** Offers change every this many days. */
export const OFFER_DAYS = 10;
/** How far (in tiles) a quest's target may be from the settlement. */
export const QUEST_REACH = 45;

const RELATIONS = ['SON', 'DAUGHTER', 'BROTHER', 'SISTER', 'HUSBAND', 'WIFE'];
const HEIRLOOMS = [
  "MY MOTHER'S RING", 'THE FAMILY SWORD', 'A SILVER LOCKET', "GRANDFATHER'S PIPE", 'THE OLD LEDGER', 'A CARVED BONE FLUTE',
];
const RELICS_FOR_PRIESTS = ['THE TEMPLE BELL', 'THE SILVER CHALICE', 'THE BOOK OF HOURS'];
const PARCELS = ['A BOX OF MEDICINE', 'A SEALED LETTER', 'A SACK OF SEED GRAIN', 'A BUNDLE OF WOOL', 'A JAR OF SALVE'];
const SIGHTINGS = ['LIGHTS', 'CHANTING', 'FIGURES IN HOODS', 'A GREEN FIRE'];

/** Everything the generator needs to know about the world as it is today. */
export interface QuestContext {
  world: World;
  day: number;
  site: Site;
  /** The people of this settlement (its first floor's spawns, with real names). */
  people: NpcSpawn[];
  /** Lairs nearby and how strong they are. */
  lairStrength: (lair: Site) => number;
  lairs: Site[];
  /** The lair that raided this settlement, if it's still raided or recovering. */
  raidedBy?: Site;
  /** Names of people at another settlement, for deliveries. */
  peopleAt: (site: Site) => NpcSpawn[];
  /** Places the main quest uses, kept out of side quests. */
  reserved: Set<number>;
}

/** The quests a settlement offers in the current span of days. Pure. */
export function questOffers(ctx: QuestContext): SideQuest[] {
  const { world, site, day } = ctx;
  const span = Math.floor((day - 1) / OFFER_DAYS);
  const rng = new Rng(world.seed, 'quests', site.id, span);
  const near = (s: Site) => Math.hypot(s.x - site.x, s.y - site.y);
  const within = (s: Site) => s.id !== site.id && !ctx.reserved.has(s.id) && near(s) <= QUEST_REACH;
  const dungeons = world.sites.filter((s) => within(s) && (s.kind === 'cave' || s.kind === 'ruin' || s.kind === 'tower' || s.kind === 'barrow'));
  const lairs = ctx.lairs.filter((l) => within(l) && ctx.lairStrength(l) >= 3);
  const stirring = world.sites.filter((s) => within(s) && (s.kind === 'shrine' || s.kind === 'ruin' || s.kind === 'tower'));
  const towns = world.sites.filter((s) => s.id !== site.id && (s.kind === 'village' || s.kind === 'hamlet') && near(s) <= 90 && near(s) >= 15);

  // Who could ask: anyone with a home here but the elder (busy with the main quest) and the guards.
  const askers = ctx.people.filter((n) => n.role !== 'elder' && n.role !== 'guard' && n.role !== 'beggar');
  const used = new Set<string>();
  const pickGiver = (prefer: string[]): NpcSpawn | undefined => {
    const free = askers.filter((n) => !used.has(n.name));
    const best = free.filter((n) => prefer.includes(n.role));
    const pool = best.length ? best : free;
    if (!pool.length) return undefined;
    const g = rng.pick(pool);
    used.add(g.name);
    return g;
  };

  const kinds: QuestKind[] = [];
  if (ctx.raidedBy && ctx.lairStrength(ctx.raidedBy) > 0) kinds.push('clear');
  const pool = rng.shuffle(['rescue', 'hunt', 'recover', 'deliver', 'investigate'] as QuestKind[]);
  kinds.push(...pool);
  const want = rng.int(1, 3);
  const offers: SideQuest[] = [];
  for (const kind of kinds) {
    if (offers.length >= want) break;
    const q = build(kind);
    if (q) offers.push(q);
  }
  return offers;

  function build(kind: QuestKind): SideQuest | null {
    const id = `${site.id}-${span}-${kind}`;
    const pay = (target: Site, base: number) => {
      const danger = dangerAt(world, target.x, target.y);
      return { gold: base + danger * 10 + rng.int(0, 10), xp: 30 + danger * 25 };
    };
    const base = { id, kind, siteId: site.id, state: 'active' as QuestState, taken: 0 };
    switch (kind) {
      case 'clear': {
        const lair = ctx.raidedBy!;
        const g = pickGiver(['villager', 'innkeeper', 'shopkeeper']);
        if (!g) return null;
        return { ...base, giver: g.name, target: lair.id, ...pay(lair, 40) };
      }
      case 'hunt': {
        if (!lairs.length) return null;
        const lair = lairs.sort((a, b) => near(a) - near(b))[0];
        const g = pickGiver(['villager', 'innkeeper']);
        if (!g) return null;
        return { ...base, giver: g.name, target: lair.id, ...pay(lair, 25) };
      }
      case 'rescue': {
        if (!dungeons.length) return null;
        const where = rng.pick(dungeons);
        const g = pickGiver(['villager']);
        if (!g) return null;
        return { ...base, giver: g.name, target: where.id, who: personName(rng), relation: rng.pick(RELATIONS), ...pay(where, 30) };
      }
      case 'recover': {
        if (!dungeons.length) return null;
        const where = rng.pick(dungeons);
        const g = pickGiver(['priest', 'villager', 'shopkeeper']);
        if (!g) return null;
        const thing = g.role === 'priest' ? rng.pick(RELICS_FOR_PRIESTS) : rng.pick(HEIRLOOMS);
        return { ...base, giver: g.name, target: where.id, thing, ...pay(where, 20) };
      }
      case 'deliver': {
        if (!towns.length) return null;
        const to = rng.pick(towns);
        const them = ctx.peopleAt(to).filter((n) => n.role === 'innkeeper' || n.role === 'shopkeeper' || n.role === 'priest');
        if (!them.length) return null;
        const g = pickGiver(['shopkeeper', 'innkeeper', 'priest', 'villager']);
        if (!g) return null;
        return { ...base, giver: g.name, target: to.id, who: rng.pick(them).name, thing: rng.pick(PARCELS), ...pay(to, 10) };
      }
      case 'investigate': {
        if (!stirring.length) return null;
        const where = rng.pick(stirring);
        const g = pickGiver(['priest', 'innkeeper', 'villager']);
        if (!g) return null;
        return { ...base, giver: g.name, target: where.id, thing: rng.pick(SIGHTINGS), ...pay(where, 25) };
      }
    }
  }
}

/** Days allowed once taken, for the jobs that can't wait. */
export function deadlineFor(world: World, q: SideQuest): number | undefined {
  if (q.kind === 'rescue') return 6;
  if (q.kind === 'deliver') {
    const a = world.sites[q.siteId], b = world.sites[q.target];
    return 3 + Math.floor(Math.hypot(a.x - b.x, a.y - b.y) / 25);
  }
  return undefined;
}

// ---------- words ----------

/** "THE RUINS OF STANWICK, SOUTH OF HERE, NOT FAR" */
function whereFrom(world: World, q: SideQuest): string {
  const from = world.sites[q.siteId], to = world.sites[q.target];
  return `${siteTitle(to)}, ${compass(from, to)} OF HERE, ${distanceWords(from, to)}`;
}

/** What the giver says when asked for work. */
export function questPitch(world: World, q: SideQuest, beasts: string): string {
  const where = whereFrom(world, q);
  const to = world.sites[q.target];
  switch (q.kind) {
    case 'clear':
      return `THE ${beasts} THAT BURNED US CAME FROM ${where}. KILL THEM ALL, OR THEY'LL COME AGAIN.`;
    case 'hunt':
      return `${beasts} FROM ${where} ARE TAKING OUR SHEEP. CLEAR THE PLACE OUT AND I'LL MAKE IT WORTH YOUR WHILE.`;
    case 'rescue':
      return `MY ${q.relation} ${q.who} WENT INTO ${where}, AND HASN'T COME BACK. PLEASE. EVERY DAY COUNTS.`;
    case 'recover':
      return `${q.thing} WAS LOST IN ${where}. IT'S DOWN IN THE DEEPEST PART. BRING IT BACK TO ME?`;
    case 'deliver':
      return `${q.thing} FOR ${q.who} IN ${to.name}. ${compass(world.sites[q.siteId], to)} OF HERE, ${distanceWords(world.sites[q.siteId], to)}. IT MUST GET THERE QUICKLY.`;
    case 'investigate':
      return `${q.thing} SEEN AT ${where}, BUT ONLY AT NIGHT. GO AND SEE WHAT IT IS. CAREFULLY.`;
  }
}

/** A short title for the journal: "RESCUE MAREN". */
export function questTitle(world: World, q: SideQuest): string {
  const to = world.sites[q.target];
  switch (q.kind) {
    case 'clear': return `AVENGE ${world.sites[q.siteId].name}`;
    case 'hunt': return `CLEAR ${to.name}`;
    case 'rescue': return `RESCUE ${q.who}`;
    case 'recover': return `RECOVER ${q.thing!.replace(/^(A|AN|THE|MY) /, '')}`;
    case 'deliver': return `DELIVER TO ${q.who}`;
    case 'investigate': return `${q.thing} AT ${to.name}`;
  }
}

/** What to do next, for the journal. */
export function questStep(world: World, q: SideQuest): string {
  const home = world.sites[q.siteId], to = world.sites[q.target];
  if (q.state === 'done') return 'DONE.';
  if (q.state === 'failed') return q.kind === 'rescue' ? `TOO LATE. ${q.who} WAS FOUND DEAD.` : 'TOO LATE.';
  if (q.state === 'return') return `TELL ${q.giver} IN ${home.name}.`;
  switch (q.kind) {
    case 'clear':
    case 'hunt': return `KILL EVERY BEAST IN ${siteTitle(to)}.`;
    case 'rescue': return `FIND ${q.who} IN ${siteTitle(to)}.`;
    case 'recover': return `SEARCH THE DEEPEST PART OF ${siteTitle(to)}.`;
    case 'deliver': return `TAKE ${q.thing} TO ${q.who} IN ${to.name}.`;
    case 'investigate': return `GO TO ${siteTitle(to)} AT NIGHT.`;
  }
}

/** What the giver says when the job is done. */
export function questThanks(q: SideQuest): string {
  switch (q.kind) {
    case 'clear': return 'THEN WE CAN REBUILD IN PEACE. TAKE THIS, WITH ALL OUR THANKS.';
    case 'hunt': return 'NO MORE LOST SHEEP! HERE, AS PROMISED.';
    case 'rescue': return `${q.who} IS HOME! I'LL NEVER FORGET THIS. PLEASE, TAKE THIS.`;
    case 'recover': return `${q.thing}! I NEVER THOUGHT I'D SEE IT AGAIN. THANK YOU.`;
    case 'deliver': return `FROM ${q.giver}? AND IN GOOD TIME. HERE, FOR YOUR TROUBLE.`;
    case 'investigate': return 'AN IDOL? SO SOMEONE WORSHIPS THERE. I SHALL WARN THE OTHERS. THANK YOU.';
  }
}

// ---------- placing things in dungeons ----------

/**
 * A floor spot far from the entry that the player can actually walk to:
 * where the lost are found and heirlooms lie.
 */
export function farSpot(level: Level, rng: Rng, taken: (x: number, y: number) => boolean): { x: number; y: number } | null {
  const { w, h } = level;
  const dist = new Int32Array(w * h).fill(-1);
  const queue = [level.entry.y * w + level.entry.x];
  dist[queue[0]] = 0;
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    const x = at % w, y = Math.floor(at / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (dist[n] >= 0 || !TERRAIN[level.tiles[n] as T].walk) continue;
      dist[n] = dist[at] + 1;
      queue.push(n);
    }
  }
  const max = Math.max(...dist);
  const plain = (t: T) => t !== T.StairsDown && t !== T.StairsUp && t !== T.Door && t !== T.DDoor && t !== T.Gate;
  const far = queue.filter((i) => dist[i] >= max * 0.6 && plain(level.tiles[i] as T) && !taken(i % w, Math.floor(i / w)));
  if (!far.length) return null;
  // Prefer open floor to a corridor, where a chest or a person would be in the way.
  const roomy = far.filter((i) => {
    let open = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dist[i + dy * w + dx] >= 0) open++;
    return open >= 7;
  });
  const i = rng.pick(roomy.length ? roomy : far);
  return { x: i % w, y: Math.floor(i / w) };
}
