// The one main quest, filled in from the seed.
import { personName } from './names';
import type { Rng } from './rng';
import type { Quest } from './types';

const VILLAINS = ['THE BARROW KING', 'THE BOG WITCH', 'THE HOLLOW PRIEST', 'THE PALE LORD'];
const RELICS = ['BELL', 'CROWN', 'LANTERN', 'CHALICE'];
const PROBLEMS = [
  'THE DEAD WALK THE MIRE AT NIGHT.',
  'CHILDREN VANISH FROM THEIR BEDS.',
  'THE WELLS RUN BLACK AND BITTER.',
  'THE CROPS ROT IN THE FIELDS.',
];

export function makeQuest(
  rng: Rng,
  ids: { villageId: number; shrineId: number; chapelId: number; barrowId: number },
): Quest {
  const villain = personName(rng);
  const relic = rng.pick(RELICS);
  return {
    title: `THE ${relic} OF ${villain}`,
    villain,
    villainTitle: rng.pick(VILLAINS),
    relic,
    problem: rng.pick(PROBLEMS),
    elderName: personName(rng),
    lieutenants: [],
    strongholdId: -1,
    blightOrder: [],
    ...ids,
  };
}
