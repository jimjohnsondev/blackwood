// Every kind of map tile and what it does. Drawing lives in gfx/tiles.ts.

export enum T {
  // overworld
  Ocean, Grass, Scrub, Pine, DeadWood, Mire, Hills, Mountain, RedPeak, Road, Site,
  // villages and small sites
  Dirt, Cobble, Wall, WoodFloor, Door, Gate, Table, Counter, Bed, Altar, Well,
  BareTree, Grave, Torch, Statue, Water, Rubble,
  // dungeons and caves
  DFloor, DWall, CaveFloor, CaveWall, StairsDown, StairsUp, DDoor, LockedDoor,
  // nothing (outside a dungeon)
  Void,
  // a raided village
  Burnt, Ash,
  // dungeon workings: mine cart track, a lever (ready, then pulled), a sealed door, shallow water
  Track, Lever, LeverOff, Sealed, Shallows,
}

export interface TerrainInfo {
  name: string;
  walk: boolean;
  /** Blocks line of sight in dark places. */
  opaque: boolean;
  /** Travel cost for road-building on the overworld. */
  cost: number;
  /** What LOOK says. */
  look: string;
}

const t = (name: string, walk: boolean, opaque: boolean, cost: number, look: string): TerrainInfo => ({
  name, walk, opaque, cost, look,
});

export const TERRAIN: Record<T, TerrainInfo> = {
  [T.Ocean]: t('SEA', false, false, 999, 'COLD GREY WATER, AS FAR AS YOU CAN SEE.'),
  [T.Grass]: t('GRASSLAND', true, false, 1, 'OPEN GRASS, BENT BY THE WIND.'),
  [T.Scrub]: t('SCRUB', true, false, 1, 'DRY SCRUB AND THORN.'),
  [T.Pine]: t('PINE FOREST', true, false, 2, 'DARK PINES, CLOSE TOGETHER.'),
  [T.DeadWood]: t('DEAD WOOD', true, false, 2, 'GREY TREES, LONG DEAD. NOTHING SINGS HERE.'),
  [T.Mire]: t('MIRE', true, false, 3, 'BLACK WATER AND REEDS. IT SUCKS AT YOUR BOOTS.'),
  [T.Hills]: t('HILLS', true, false, 3, 'ROLLING HILLS OF HEATHER AND STONE.'),
  [T.Mountain]: t('MOUNTAINS', false, true, 999, 'SHEER GREY PEAKS. NO WAY THROUGH.'),
  [T.RedPeak]: t('RED PEAKS', false, true, 999, 'RED ROCK, WARM TO THE TOUCH.'),
  [T.Road]: t('ROAD', true, false, 0.4, 'AN OLD ROAD OF WORN STONES.'),
  [T.Site]: t('SITE', true, false, 1, ''),

  [T.Dirt]: t('GROUND', true, false, 1, 'PACKED EARTH.'),
  [T.Cobble]: t('STREET', true, false, 1, 'A COBBLED STREET.'),
  [T.Wall]: t('WALL', false, true, 999, 'A WALL OF ROUGH STONE.'),
  [T.WoodFloor]: t('FLOOR', true, false, 1, 'CREAKING BOARDS.'),
  [T.Door]: t('DOOR', true, true, 1, 'A DOOR.'),
  [T.Gate]: t('GATE', true, false, 1, 'THE GATE. THE ROAD LIES BEYOND.'),
  [T.Table]: t('TABLE', false, false, 999, 'A SCARRED WOODEN TABLE.'),
  [T.Counter]: t('COUNTER', false, false, 999, 'A SHOP COUNTER.'),
  [T.Bed]: t('BED', false, false, 999, 'A STRAW BED.'),
  [T.Altar]: t('ALTAR', false, false, 999, 'AN ALTAR OF BLACK STONE.'),
  [T.Well]: t('WELL', false, false, 999, 'A DEEP WELL. YOU HEAR WATER FAR BELOW.'),
  [T.BareTree]: t('TREE', false, false, 999, 'A BARE TREE.'),
  [T.Grave]: t('GRAVE', true, false, 1, 'A GRAVE. THE NAME HAS WORN AWAY.'),
  [T.Torch]: t('TORCH', false, false, 999, 'A TORCH ON A POLE.'),
  [T.Statue]: t('STATUE', false, false, 999, 'A WEATHERED STATUE OF A ROBED FIGURE.'),
  [T.Water]: t('WATER', false, false, 999, 'STILL WATER.'),
  [T.Rubble]: t('RUBBLE', false, false, 999, 'FALLEN STONES.'),

  [T.DFloor]: t('FLOOR', true, false, 1, 'COLD FLAGSTONES.'),
  [T.DWall]: t('WALL', false, true, 999, 'DAMP STONE.'),
  [T.CaveFloor]: t('CAVE FLOOR', true, false, 1, 'LOOSE GRAVEL AND BONES.'),
  [T.CaveWall]: t('ROCK', false, true, 999, 'BARE ROCK.'),
  [T.StairsDown]: t('STAIRS DOWN', true, false, 1, 'STAIRS LEADING DOWN INTO DARKNESS.'),
  [T.StairsUp]: t('STAIRS UP', true, false, 1, 'STAIRS LEADING UP.'),
  [T.DDoor]: t('DOOR', true, true, 1, 'A HEAVY DOOR.'),
  [T.LockedDoor]: t('LOCKED DOOR', false, true, 999, 'A LOCKED DOOR.'),
  [T.Void]: t('DARKNESS', false, true, 999, 'NOTHING.'),
  [T.Burnt]: t('BURNT WALL', false, true, 999, 'BLACKENED STONE. IT STILL SMELLS OF SMOKE.'),
  [T.Ash]: t('ASHES', true, false, 1, 'ASH AND CINDERS, STILL WARM.'),
  [T.Track]: t('CART TRACK', true, false, 1, 'RUSTED RAILS FOR ORE CARTS.'),
  [T.Lever]: t('LEVER', false, false, 999, 'AN IRON LEVER, STIFF WITH AGE. IT COULD STILL BE PULLED.'),
  [T.LeverOff]: t('LEVER', false, false, 999, 'THE LEVER HAS BEEN PULLED.'),
  [T.Sealed]: t('SEALED DOOR', false, true, 999, 'A SLAB OF STONE WITH NO HANDLE AND NO LOCK. SOMETHING ELSE MUST OPEN IT.'),
  [T.Shallows]: t('SHALLOW WATER', true, false, 2, 'COLD WATER TO THE KNEE. WADING IS SLOW.'),
};

export function walkable(tile: T): boolean {
  return TERRAIN[tile].walk;
}
