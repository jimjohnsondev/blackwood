// 8x8 icons shown next to items in the Items panel and shops.
import { art, monoOf, type Art } from './art';
import { ITEMS, type ItemId } from '../game/items';

const blade = (c1: string) => art([c1, 'brown'], `
  ......11
  .....111
  ....111.
  .2.111..
  ..211...
  ..22....
  .2..2...
  2.......`);

/** Pictures of the plain items. Better grades and tomes reuse them (see ICONS below). */
const MULTI: Record<string, Art> = {
  dagger: art(['grey', 'brown'], `
    ........
    ......1.
    .....1..
    ....1...
    .2.1....
    ..2.....
    .2.2....
    ........`),
  shortsword: blade('grey'),
  sword: blade('bone'),
  axe: art(['grey', 'brown'], `
    ...111..
    ..1112..
    ...112..
    .....2..
    ....2...
    ...2....
    ..2.....
    .2......`),
  staff: art(['wood', 'cyan'], `
    ......2.
    .....1..
    .....1..
    ....1...
    ....1...
    ...1....
    ...1....
    ..1.....`),
  shortbow: art(['wood', 'bone'], `
    ..11....
    ...21...
    ...2.1..
    ...2..1.
    ...2..1.
    ...2.1..
    ...21...
    ..11....`),
  robes: art(['violet', 'purple'], `
    ..1..1..
    .111111.
    1.1111.1
    ..1221..
    ..1111..
    .111111.
    .111111.
    ........`),
  leather: art(['amber', 'brown'], `
    .11..11.
    .111111.
    11.11.11
    .122221.
    .111111.
    .122221.
    .111111.
    ........`),
  chain: art(['grey', 'darkgrey'], `
    .11..11.
    .111111.
    11.1.111
    .1.1.11.
    .111111.
    .1.1.11.
    .111111.
    ........`),
  shield: art(['grey', 'wood'], `
    .222222.
    .211112.
    .211112.
    .221122.
    ..2112..
    ...22...
    ........
    ........`),
  torch: art(['orange', 'gold', 'brown'], `
    ...1....
    ..121...
    ...1....
    ...3....
    ...3....
    ...3....
    ...3....
    ........`),
  healing: art(['bone', 'red'], `
    ...11...
    ...11...
    ..1..1..
    .122221.
    .122221.
    ..1221..
    ........
    ........`),
  mana: art(['bone', 'sky'], `
    ...11...
    ...11...
    ..1..1..
    .122221.
    .122221.
    ..1221..
    ........
    ........`),
  lockpicks: art(['grey', 'darkgrey'], `
    ........
    .1...1..
    .1...1..
    .1...1..
    .1...11.
    .1......
    .2...2..
    .2...2..`),
  scroll: art(['cream', 'red'], `
    ........
    .111111.
    1.2222.1
    .1....1.
    .1.22.1.
    .1....1.
    1111111.
    ........`),
  tome: art(['brown', 'gold'], `
    ........
    .111111.
    .122221.
    .121121.
    .122221.
    .121121.
    .111111.
    ........`),
  shard: art(['gold'], `
    ........
    ...1....
    ..11....
    ..111...
    .1111...
    .11.1...
    ..1.....
    ........`),
  key: art(['gold'], `
    ........
    .11.....
    1..11111
    .11..1.1
    ........
    ........
    ........
    ........`),
  barrowkey: art(['gold'], `
    ........
    .11.....
    1..11111
    .11..1.1
    ........
    ........
    ........
    ........`),
  relic: art(['gold', 'cream'], `
    ...1....
    ...1....
    .1.2.1..
    ..222...
    1122211.
    ..222...
    .1.2.1..
    ...1....`),
};

/** Single-colour versions, to match the map's 1-bit look. */
const ICON_COLOR: Record<string, string> = {
  dagger: '#a0a0b0', shortsword: '#a0a0b0', sword: '#c0c0c8', axe: '#a0a0b0', staff: '#9a7a50',
  shortbow: '#9a7a50', robes: '#9a88c0', leather: '#a07a50', chain: '#a0a0b0', shield: '#9a7a50',
  torch: '#e08a30', healing: '#c04040', mana: '#5a7ac0', lockpicks: '#a0a0b0',
  scroll: '#d0c8b0', barrowkey: '#c0a040', relic: '#e0c050', tome: '#b08a50',
};

/** Better grades shine: FINE pale, MASTERWORK gold, RUNED blue. */
const TIER_COLOR = ['', '#e0e0e8', '#e0c050', '#70a8e8'];

export const ICONS = Object.fromEntries(
  (Object.keys(ITEMS) as ItemId[]).map((id) => {
    const info = ITEMS[id];
    const base = info.kind === 'tome' ? 'tome' : info.kind === 'mount' ? 'relic' : info.base ?? id;
    const color = info.unique ? '#c070e0' : info.bonus ? TIER_COLOR[info.bonus] : ICON_COLOR[base] ?? '#a0a0b0';
    return [id, monoOf(MULTI[base], color)];
  }),
) as Record<ItemId, Art>;
