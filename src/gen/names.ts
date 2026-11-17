// Names built from syllables: places like ASHMOOR and HOLLOWAY, people like MAREN.
import type { Rng } from './rng';

const PLACE_START = ['ASH', 'HOL', 'GREY', 'BLACK', 'THORN', 'MOR', 'WEST', 'ELM', 'RAVEN', 'COLD',
  'BRAM', 'HAR', 'WYCH', 'FEN', 'STAN', 'OAK', 'DUN', 'MARL', 'CROW', 'SALT'];
const PLACE_END = ['MOOR', 'LOWAY', 'FEN', 'WOOD', 'FORD', 'HOLM', 'STEAD', 'COMBE', 'WICK', 'TON',
  'LEY', 'BURY', 'MERE', 'DALE', 'HALL', 'GATE'];

const PERSON_START = ['MA', 'O', 'BRO', 'VE', 'AL', 'TE', 'GRI', 'HA', 'E', 'WY', 'CA', 'DU', 'RO', 'SE', 'TA', 'JO'];
const PERSON_MID = ['', '', 'R', 'L', 'N', 'D', 'TH', 'S'];
const PERSON_END = ['REN', 'DRAN', 'M', 'SSA', 'DRIC', 'GA', 'WEN', 'NA', 'LIN', 'BERT', 'RIC', 'DA', 'ETH', 'MUND', 'LA', 'NE'];

export function placeName(rng: Rng): string {
  for (;;) {
    const name = rng.pick(PLACE_START) + rng.pick(PLACE_END);
    if (name.length <= 10) return name;
  }
}

export function personName(rng: Rng): string {
  for (;;) {
    const name = rng.pick(PERSON_START) + rng.pick(PERSON_MID) + rng.pick(PERSON_END);
    if (name.length >= 3 && name.length <= 8) return name;
  }
}

/** A site name such as THE OLD CHAPEL OF ELMSTEAD or WOLF CAVE. */
export function siteName(kind: string, rng: Rng): string {
  switch (kind) {
    case 'cave': return rng.pick(['WOLF', 'BONE', 'DRIP', 'GOBLIN', 'ECHO', 'SPIDER', 'BLACK']) + ' CAVE';
    case 'tower': return rng.pick(['WATCH', 'BROKEN', 'GREY', 'SIGNAL', 'OLD']) + ' TOWER';
    case 'ruin': return 'RUINS OF ' + placeName(rng);
    case 'shrine': return 'SHRINE OF ' + personName(rng);
    default: return placeName(rng);
  }
}
