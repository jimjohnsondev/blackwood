// What people say. Lines are picked from tables using the seed and the speaker,
// so the same villager tells the same rumour every time.
import { Rng } from '../gen/rng';
import type { Quest, Site, World } from '../gen/types';
import type { Keyword, LoreId } from './people';

/** Gossip lines, and the topic each one teaches the player to ASK ABOUT. */
export const GOSSIP: { line: string; lore?: LoreId }[] = [
  { line: 'THEY HANGED THE MILLER.', lore: 'miller' },
  { line: 'THE WOLVES COME CLOSER EVERY WINTER.', lore: 'wolves' },
  { line: 'NEVER DRINK FROM THE MIRE.', lore: 'mire' },
  { line: 'MY GRANDFATHER SAW THE RED PEAKS SMOKE.', lore: 'peaks' },
  { line: 'BANDITS WORK THE ROADS AFTER DARK.', lore: 'bandits' },
  { line: 'THE DEAD WOOD WAS GREEN ONCE.', lore: 'deadwood' },
  { line: 'A TORCH IS WORTH MORE THAN A SWORD UNDERGROUND.' },
  { line: 'THE PRIEST WILL MEND YOU, FOR A COIN.' },
  { line: 'REST AT AN INN. THE WILDS ARE NO PLACE TO SLEEP.' },
  { line: 'THE GRAVES OUTSIDE TOWN ARE NEWER THAN THEY LOOK.', lore: 'graves' },
  { line: 'THE SEA HAS NO OTHER SHORE. OR SO THEY SAY.', lore: 'sea' },
  { line: 'SPIDERS IN THE PINES. BIG AS DOGS.', lore: 'spiders' },
];


export function compass(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x, dy = to.y - from.y;
  const angle = Math.atan2(-dy, dx) * (180 / Math.PI);
  const dirs = ['EAST', 'NORTH EAST', 'NORTH', 'NORTH WEST', 'WEST', 'SOUTH WEST', 'SOUTH', 'SOUTH EAST'];
  return dirs[(Math.round(angle / 45) + 8) % 8];
}

export function distanceWords(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d < 30) return 'NOT FAR';
  if (d < 70) return "A DAY'S WALK";
  return 'FAR AWAY';
}

export interface Rumour {
  line: string;
  /** The place the rumour gives directions to, if any. */
  site?: Site;
  /** A topic the player can now ASK ABOUT. */
  teach?: Keyword;
}

export function rumour(world: World, speaker: string, here: Site, questDone: boolean): Rumour {
  const rng = new Rng(world.seed, 'rumour', speaker, here.id);
  const q: Quest = world.quest;
  if (questDone && rng.chance(0.4)) return { line: `THEY SAY YOU ENDED ${q.villain}. BLESS YOU.` };
  const roll = rng.next();
  if (roll < 0.45) {
    const others = world.sites.filter((s) => s.id !== here.id && s.kind !== 'village');
    const s = rng.pick(others);
    return { line: `${s.name} LIES ${distanceWords(here, s)}, TO THE ${compass(here, s)}.`, site: s };
  }
  if (roll < 0.65 && !questDone) {
    return rng.pick<Rumour>([
      { line: q.problem, teach: 'quest:trouble' },
      { line: 'LIGHTS ARE SEEN AT THE BARROW AT NIGHT.', teach: 'quest:trouble' },
      { line: 'NOBODY HAS PRAYED AT THE OLD CHAPEL IN YEARS.', teach: 'quest:trouble' },
      { line: 'THE ELDER IS LOOKING FOR SOMEONE BRAVE. OR FOOLISH.', teach: `person:${q.villageId}:${q.elderName}` },
    ]);
  }
  const g = rng.pick(GOSSIP);
  return { line: g.line, teach: g.lore ? `lore:${g.lore}` : undefined };
}
