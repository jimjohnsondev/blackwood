// The Vale's calendar: twelve months of thirty days. Each world starts on a
// different date, picked from the seed.
import { Rng } from '../gen/rng';

export const MONTHS = [
  'DEEPWINTER', 'ICEMELT', 'RAINTIDE', 'SEEDFALL', 'BLOOMING', 'MIDSUMMER',
  'HIGHSUN', 'REAPING', 'LEAFFALL', 'FROSTFALL', 'DARKMOON', 'YEARSEND',
];
const DAYS_IN_MONTH = 30;

/** "12 FROSTFALL 1042" for the given game day (day 1 = the day the journey began). */
export function dateOf(seed: string, day: number): string {
  const rng = new Rng(seed, 'calendar');
  const startYear = rng.int(900, 1299);
  const startDayOfYear = rng.int(0, MONTHS.length * DAYS_IN_MONTH - 1);
  const total = startDayOfYear + (day - 1);
  const yearLength = MONTHS.length * DAYS_IN_MONTH;
  const year = startYear + Math.floor(total / yearLength);
  const dayOfYear = total % yearLength;
  const month = MONTHS[Math.floor(dayOfYear / DAYS_IN_MONTH)];
  return `${(dayOfYear % DAYS_IN_MONTH) + 1} ${month} ${year}`;
}

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
const SEASON_OF_MONTH: Season[] = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];

/** The season on a game day, from the month. */
export function seasonOf(seed: string, day: number): Season {
  const rng = new Rng(seed, 'calendar');
  rng.int(900, 1299);
  const startDayOfYear = rng.int(0, MONTHS.length * DAYS_IN_MONTH - 1);
  const dayOfYear = (startDayOfYear + (day - 1)) % (MONTHS.length * DAYS_IN_MONTH);
  return SEASON_OF_MONTH[Math.floor(dayOfYear / DAYS_IN_MONTH)];
}
