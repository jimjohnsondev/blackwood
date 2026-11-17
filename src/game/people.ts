// Who the people of the world are, what they know, and what they say when asked.
//
// Everything here is worked out from the seed and the speaker, so the same villager
// always has the same temper and knows the same things. Nothing in this file changes
// the game state: it returns what was said and what the player learned, and game.ts
// applies it.
import { Rng } from '../gen/rng';
import type { NpcRole, Site, World } from '../gen/types';
import { compass, distanceWords } from './dialogue';

// ---------- temper ----------

export type Trait = 'kind' | 'greedy' | 'fearful' | 'proud' | 'devout';
const TRAITS: Trait[] = ['kind', 'greedy', 'fearful', 'proud', 'devout'];

/** A person's temper, fixed by the seed, where they live and their name. */
export function traitOf(seed: string, siteId: number, name: string): Trait {
  return new Rng(seed, 'trait', siteId, name).pick(TRAITS);
}

/** A key that names one person in the whole world. */
export function personKey(siteId: number, name: string): string {
  return `${siteId}:${name}`;
}

// ---------- keywords ----------

/**
 * Things the player can ASK ABOUT. Stored as short ids:
 *   name, job                    always known
 *   site:<id>                    a place the player has been to or heard of
 *   person:<siteId>:<name>       someone the player has met or heard of
 *   quest:trouble|villain|relic  the main quest, as the player learns it
 *   lore:<id>                    things mentioned in gossip
 */
export type Keyword = string;

export type LoreId = 'wolves' | 'mire' | 'peaks' | 'bandits' | 'deadwood' | 'graves' | 'sea' | 'spiders' | 'miller';

export const LORE: Record<LoreId, { label: string; answer: string; nearest?: Site['kind'][] }> = {
  wolves: { label: 'WOLVES', answer: 'THEY HUNT IN PACKS IN THE PINE WOODS. KEEP TO THE ROADS AFTER DARK.' },
  mire: { label: 'THE MIRE', answer: 'THE MIRE SWALLOWS CARTS WHOLE. BOG HAGS LIVE OUT THERE, THEY SAY.' },
  peaks: { label: 'THE RED PEAKS', answer: 'FIRE BURNS UNDER THE RED PEAKS. THE BLIGHT IS STRONGEST THERE.' },
  bandits: { label: 'BANDITS', answer: 'THEY RAID TRAVELLERS BY NIGHT. THE ROADS ARE SAFER BY DAY.' },
  deadwood: { label: 'THE DEAD WOOD', answer: 'IT SPREADS A LITTLE EVERY YEAR, AND NOTHING GROWS BACK.' },
  graves: { label: 'THE GRAVES', answer: 'THE DEAD DO NOT STAY BURIED HERE.', nearest: ['chapel', 'barrow'] },
  sea: { label: 'THE SEA', answer: 'NO SHIP THAT SAILED FOR THE FAR SHORE EVER CAME BACK.' },
  spiders: { label: 'SPIDERS', answer: 'THEY SPIN IN CAVES AND DEEP PINES. FIRE KEEPS THEM BACK.', nearest: ['cave'] },
  miller: { label: 'THE MILLER', answer: 'HE SOLD SPOILED FLOUR, OR SO THE ELDER SAID. NOBODY ARGUED.' },
};

const ROLE_WORDS: Record<NpcRole, string> = {
  elder: 'THE ELDER',
  innkeeper: 'THE INNKEEPER',
  shopkeeper: 'THE SHOPKEEPER',
  priest: 'THE PRIEST',
  villager: 'A VILLAGER',
  beggar: 'A BEGGAR',
  hermit: 'THE HERMIT',
  guard: 'A GUARD',
  trader: 'A TRADER',
};

export function roleWords(role: NpcRole): string {
  return ROLE_WORDS[role];
}

// ---------- the people of a place ----------

export interface Person {
  name: string;
  role: NpcRole;
  siteId: number;
}

/** What one question needs to know about the world, the speaker and the player. */
export interface AskContext {
  world: World;
  speaker: Person;
  trait: Trait;
  /** The settlement or site the conversation happens in. */
  here: Site;
  /** Everyone who lives here, including the speaker. */
  residents: Person[];
  /** How the place feels about the player, -10 to +10. */
  rep: number;
  questFlags: { talkedElder: boolean; searchedChapel: boolean; killedBoss: boolean; questDone: boolean; won?: boolean };
}

/** What a question got: what was said, and what the player now knows. */
export interface Answer {
  /** Spoken lines, without the speaker's name. */
  lines: string[];
  /** New keywords the answer gave the player. */
  teach: Keyword[];
  /** Places the answer gave directions to. */
  sites: Site[];
  /** Worth keeping in the Journal's day-by-day chronicle (directions, quest news). */
  chronicle?: string;
  /** False when the speaker had nothing useful to say. */
  knew: boolean;
}

const SHRUGS: Record<Trait, string[]> = {
  kind: ['SORRY, I KNOW NOTHING OF THAT.', 'I WISH I COULD HELP YOU THERE.'],
  greedy: ['KNOWLEDGE COSTS. NOT THAT I HAVE ANY.', 'NOTHING I COULD SELL YOU.'],
  fearful: ["DON'T ASK ME THINGS LIKE THAT!", 'I KEEP MY HEAD DOWN. I KNOW NOTHING.'],
  proud: ['THAT IS BENEATH MY NOTICE.', 'WHY WOULD I KNOW THAT?'],
  devout: ['ONLY THE GODS KNOW.', 'PRAY ON IT. I CANNOT SAY.'],
};

const GREETINGS: Record<Trait, string> = {
  kind: 'GOOD DAY TO YOU.',
  greedy: 'GOT COIN?',
  fearful: 'OH! YOU STARTLED ME.',
  proud: 'YES? WHAT IS IT?',
  devout: 'THE GODS KEEP YOU.',
};

const OPINIONS = ['A GOOD SORT.', 'NOT TO BE TRUSTED.', 'HARD, BUT FAIR.', 'TALKS TOO MUCH.', 'KEEPS TO THEMSELVES.', 'OWES ME MONEY.'];

const JOBS: Record<NpcRole, string[]> = {
  elder: ['I SPEAK FOR THIS PLACE. LITTLE GOOD IT DOES.'],
  innkeeper: ['BEDS, ALE AND NEWS. ALL FOR A PRICE.'],
  shopkeeper: ['I SELL WHAT KEEPS YOU ALIVE OUT THERE.'],
  priest: ['I TEND THE TEMPLE, AND THE WOUNDED.'],
  villager: ['I WORK THE FIELDS.', 'I CUT WOOD FOR THE WINTER.', 'I MEND ROOFS AND FENCES.', 'I KEEP GOATS. THEY KEEP ME.', 'I DIG GRAVES. BUSY TIMES.'],
  beggar: ['I BEG. WHAT DOES IT LOOK LIKE?'],
  hermit: ['I KEEP THE SHRINE. THE SHRINE KEEPS ME.'],
  guard: ['I WATCH THE GATE. AND I WATCH YOU.', 'I KEEP THE PEACE. MOSTLY.'],
  trader: ['I CARRY GOODS FROM TOWN TO TOWN.', 'THE ROAD IS MY HOME. THE WAGON IS MY SHOP.'],
};

const SITE_LORE: Record<Site['kind'], string> = {
  stronghold: 'NOBODY WHO WENT THERE CAME BACK TO SAY.',
  village: 'A WALLED VILLAGE. SAFE ENOUGH, IF THEY LIKE YOU.',
  hamlet: 'A HANDFUL OF HOUSES AND A TAVERN.',
  cave: 'BEASTS DEN IN THAT CAVE. AND WORSE, DEEPER IN.',
  tower: 'AN OLD WATCHTOWER. NOBODY WATCHES FROM IT NOW.',
  chapel: 'THE CHAPEL FELL TO RUIN. NOBODY PRAYS THERE NOW.',
  shrine: 'A HOLY PLACE. THE STATUE MENDS THE WEARY.',
  ruin: 'BROKEN STONES. SOME SAY THERE IS COIN UNDER THEM.',
  barrow: 'A BURIAL MOUND. THE DEAD THERE DO NOT REST.',
  landmark: 'A PLACE OF OLD POWER. THEY SAY A TREASURE WAITS THERE, WELL GUARDED.',
};

/** The opening line when the player starts a conversation. */
export function greeting(trait: Trait, rep: number, memory: string[], villain: string, questDone: boolean): string {
  if (memory.includes('thief')) return 'YOU AGAIN. I SAW WHAT YOU DID.';
  if (questDone && rep >= 5) return `THE ONE WHO ENDED ${villain}! WELCOME!`;
  if (memory.includes('helped')) return "MY FRIEND! YOU'RE ALWAYS WELCOME HERE.";
  if (memory.includes('donor')) return 'THE GODS REMEMBER YOUR GIFT, FRIEND.';
  if (memory.includes('gift')) return 'BLESS YOU FOR THAT COIN.';
  if (rep >= 5) return 'WELCOME, FRIEND!';
  if (rep <= -5) return 'GET AWAY FROM ME.';
  if (rep <= -2) return 'WHAT DO YOU WANT?';
  return GREETINGS[trait];
}

/** The menu label for a keyword, or null if it no longer means anything. */
export function keywordLabel(world: World, k: Keyword): string | null {
  if (k === 'name') return 'YOUR NAME';
  if (k === 'job') return 'YOUR WORK';
  if (k === 'raid') return 'THE RAID';
  const [kind, a, b] = k.split(':');
  const q = world.quest;
  if (kind === 'site') return world.sites[Number(a)]?.name ?? null;
  if (kind === 'person') return b ?? null;
  if (kind === 'quest' && (a === 'lt0' || a === 'lt1')) return q.lieutenants[Number(a.slice(2))]?.name ?? null;
  if (kind === 'quest') return a === 'trouble' ? 'THE TROUBLE' : a === 'villain' ? q.villain : `THE ${q.relic}`;
  if (kind === 'lore') return LORE[a as LoreId]?.label ?? null;
  return null;
}

/** Answer a question. Pure: the same speaker always answers the same way. */
export function ask(ctx: AskContext, k: Keyword): Answer {
  const { world, speaker, trait, here } = ctx;
  const q = world.quest;
  const rng = new Rng(world.seed, 'ask', speaker.siteId, speaker.name, k);
  const shrug = (): Answer => ({ lines: [rng.pick(SHRUGS[trait])], teach: [], sites: [], knew: false });
  const said = (lines: string[], extra: Partial<Answer> = {}): Answer => ({ lines, teach: [], sites: [], knew: true, ...extra });

  // A place that dislikes the player keeps its mouth shut.
  if (ctx.rep <= -2 && speaker.role !== 'elder' && k !== 'name') {
    return { lines: ["I'VE NOTHING TO SAY TO YOU."], teach: [], sites: [], knew: false };
  }

  if (k === 'name') {
    const job = speaker.role === 'villager' || speaker.role === 'beggar' ? '' : ` I AM ${roleWords(speaker.role)} HERE.`;
    return said([`I AM ${speaker.name}.${job}`], { teach: [`person:${speaker.siteId}:${speaker.name}`] });
  }
  if (k === 'job') return said([rng.pick(JOBS[speaker.role])]);

  const [kind, a, b] = k.split(':');

  if (kind === 'site') {
    const site = world.sites[Number(a)];
    if (!site) return shrug();
    if (site.id === here.id) return aboutHere(ctx, rng);
    // Keepers, elders and hermits know the land; others mostly know what is near.
    const d = Math.hypot(site.x - here.x, site.y - here.y);
    const wise = ['elder', 'innkeeper', 'hermit', 'priest'].includes(speaker.role);
    let chance = d <= 40 ? 0.85 : d <= 80 ? 0.5 : 0.2;
    if (wise) chance += 0.35;
    if (ctx.rep >= 3) chance += 0.2;
    if (!rng.chance(chance)) return shrug();
    const where = `IT LIES ${distanceWords(here, site)}, TO THE ${compass(here, site)}.`;
    return said([SITE_LORE[site.kind], where], { sites: [site], chronicle: `${speaker.name} SAID ${whereIs(site, here)}` });
  }

  if (kind === 'person') {
    const siteId = Number(a);
    const name = b;
    if (name === speaker.name && siteId === speaker.siteId) return ask(ctx, 'name');
    const them = ctx.residents.find((r) => r.name === name && r.siteId === siteId);
    if (!them) {
      const home = world.sites[siteId];
      if (home && (speaker.role === 'innkeeper' || rng.chance(0.3))) {
        return said([`I HEAR ${name} LIVES IN ${home.name}.`], { sites: [home] });
      }
      return said(['NEVER MET THEM.'], { knew: false });
    }
    const what = them.role === 'villager' ? 'LIVES HERE.' : `IS ${roleWords(them.role)} HERE.`;
    return said([`${name} ${what} ${rng.pick(OPINIONS)}`]);
  }

  if (kind === 'quest') return aboutQuest(ctx, a, rng) ?? shrug();

  if (kind === 'lore') {
    const lore = LORE[a as LoreId];
    if (!lore) return shrug();
    if (trait === 'fearful' && rng.chance(0.5)) return said(["HUSH! DON'T SPEAK OF THAT HERE."], { knew: false });
    const lines = [lore.answer];
    const sites: Site[] = [];
    let chronicle: string | undefined;
    if (lore.nearest) {
      const near = nearestSite(world, here, lore.nearest);
      if (near) {
        lines.push(`TRY ${siteTitle(near)}, ${distanceWords(here, near)} TO THE ${compass(here, near)}.`);
        sites.push(near);
        chronicle = `${speaker.name} SAID ${whereIs(near, here)}`;
      }
    }
    if (a === 'graves') lines.push(`ASK ${q.elderName} ABOUT IT.`);
    return said(lines, { sites, chronicle });
  }
  return shrug();
}

/** "RAVENHALL? A QUIET PLACE. MAREN KEEPS THE SHOP, ODO THE INN." */
function aboutHere(ctx: AskContext, rng: Rng): Answer {
  const { here, residents, speaker } = ctx;
  const keepers = residents.filter((r) => r.name !== speaker.name && r.role !== 'villager' && r.role !== 'beggar');
  const jobs: Record<string, string> = {
    elder: 'SPEAKS FOR US', innkeeper: 'KEEPS THE INN', shopkeeper: 'KEEPS THE SHOP', priest: 'TENDS THE TEMPLE', hermit: 'KEEPS THE SHRINE', guard: 'GUARDS THE GATE', trader: 'TRADES ON THE ROAD',
  };
  const mood = here.kind === 'shrine' ? 'A QUIET, HOLY PLACE.' : rng.pick(['A HARD PLACE, BUT HOME.', 'QUIET, MOSTLY.', 'GRIM THESE DAYS.']);
  const lines = [`${here.name}? ${mood}`];
  if (keepers.length) lines.push(keepers.map((r) => `${r.name} ${jobs[r.role] ?? 'LIVES HERE'}`).join('. ') + '.');
  return { lines, teach: keepers.map((r) => `person:${r.siteId}:${r.name}`), sites: [], knew: true };
}

function aboutQuest(ctx: AskContext, which: string, rng: Rng): Answer | null {
  const { world, speaker, trait } = ctx;
  const q = world.quest;
  const f = ctx.questFlags;
  const elder = speaker.role === 'elder';
  const wise = elder || speaker.role === 'priest' || speaker.role === 'hermit';
  const said = (lines: string[], teach: Keyword[] = [], chronicle?: string): Answer => ({ lines, teach, sites: [], knew: true, chronicle });
  if (which === 'trouble') {
    if (f.won) return said([`THAT IS OVER NOW, THANKS TO YOU.`]);
    if (f.questDone) return said(['THE VALE IS QUIET AGAIN. BUT THEY SAY IT IS WORSE THAN EVER OUT IN THE FAR LANDS.']);
    if (elder) return said([q.problem, f.talkedElder ? 'YOU KNOW WHAT MUST BE DONE.' : 'I NEED SOMEONE BRAVE.']);
    if (trait === 'fearful') return said(["DON'T SPEAK OF IT! NOT AFTER DARK!"]);
    const elderKey = `person:${world.quest.villageId}:${q.elderName}`;
    return said([q.problem, rng.pick([`${q.elderName} WANTS IT STOPPED.`, 'NOBODY KNOWS WHY.', 'IT GETS WORSE EVERY WEEK.'])], [elderKey]);
  }
  if (which === 'villain') {
    if (f.won) return said([`${q.villain} IS GONE. LET THE NAME BE FORGOTTEN.`]);
    if (f.killedBoss) return said([`ONLY A SHADE DIED IN THE BARROW. ${q.villain} SITS IN THE BLIGHT STILL.`]);
    if (wise) return said([`${q.villain}, ${q.villainTitle}.`, 'THEY BURIED THAT NAME IN THE BARROW LONG AGO.'], ['quest:relic']);
    return said([trait === 'fearful' ? 'NEVER SAY THAT NAME!' : 'AN OLD NAME. A BAD ONE.']);
  }
  if (which === 'relic') {
    if (f.won) return said([`THE ${q.relic} DID ITS WORK. KEEP IT WELL.`]);
    if (f.questDone) return said([`BROKEN IN THREE. THE SERVANTS OF ${q.villain} KEEP THE OTHER PIECES.`]);
    if (wise) return said([`THE ${q.relic} GAVE ${q.villain} POWER.`, `TAKE IT, AND THE POWER IS BROKEN.`]);
    return null;
  }
  return null;
}

function nearestSite(world: World, from: Site, kinds: Site['kind'][]): Site | undefined {
  let best: Site | undefined, bestD = Infinity;
  for (const s of world.sites) {
    if (!kinds.includes(s.kind) || s.id === from.id) continue;
    const d = Math.hypot(s.x - from.x, s.y - from.y);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

/** "THE OLD CHAPEL LIES NORTH EAST OF RAVENHALL, NOT FAR." */
export function whereIs(site: Site, from: Site): string {
  return `${siteTitle(site)} LIES ${compass(from, site)} OF ${siteTitle(from)}, ${distanceWords(from, site)}.`;
}

export function siteTitle(site: Site): string {
  return /^(OLD |WAYSIDE |BARROW OF |SHRINE OF |RUINS OF |SUNKEN |HOLD OF )/.test(site.name) ? `THE ${site.name}` : site.name;
}

// ---------- standing ----------

/** How a place feels about the player, in words. */
export function standingWord(rep: number): string {
  if (rep <= -5) return 'HATED';
  if (rep <= -2) return 'DISLIKED';
  if (rep < 2) return 'STRANGER';
  if (rep < 5) return 'LIKED';
  if (rep < 8) return 'HONOURED';
  return 'HERO';
}

/** What the player pays for things here, as a multiple of the list price. */
export function buyRate(rep: number): number {
  if (rep >= 5) return 0.8;
  if (rep >= 2) return 0.9;
  if (rep <= -5) return 1.5;
  if (rep <= -2) return 1.25;
  return 1;
}

/** What shops here pay for the player's things, as a share of the list price. */
export function sellRate(rep: number): number {
  if (rep >= 5) return 0.6;
  if (rep >= 2) return 0.55;
  if (rep <= -2) return 0.35;
  return 0.5;
}
