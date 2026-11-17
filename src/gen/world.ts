// The overworld: one 384x384 continent, generated whole from the seed. The Vale sits in
// the middle; five regions (fens, highlands, ashwood, downs and the Blight) lie around it.
import { T, TERRAIN } from '../game/terrain';
import { ValueNoise } from './noise';
import { findPath } from './path';
import { personName, placeName, siteName } from './names';
import { makeQuest } from './quest';
import { Rng } from './rng';
import { LANDMARKS, REGION_BIAS, REGION_WORDS, VALE_RADIUS, type Region, type RegionType } from './regions';
import type { MonsterId } from '../game/monsters';
import type { Site, SiteKind, World } from './types';

export const WORLD_SIZE = 384;
/** The quest sites and the gentlest ground lie within this distance of the start. */
const INNER_VALE = 20;

export function generateWorld(seed: string): World {
  const S = WORLD_SIZE;
  const rng = new Rng(seed, 'overworld');
  const elevation = new ValueNoise(rng);
  const ridges = new ValueNoise(rng);
  const moisture = new ValueNoise(rng);
  const blightNoise = new ValueNoise(rng);
  const warp = new ValueNoise(new Rng(seed, 'region-warp'));
  const tiles = new Uint8Array(S * S);
  const cx = S / 2, cy = S / 2;

  // 0. Regions: five lands around the Vale, at even angles, in a seeded order.
  //    The Blight is always one of them.
  const regionRng = new Rng(seed, 'regions');
  const nameRng0 = new Rng(seed, 'region-names');
  const types = regionRng.shuffle<RegionType>(['fenlands', 'highlands', 'ashwood', 'downs', 'blight']);
  const turn0 = regionRng.next() * Math.PI * 2;
  const regions: Region[] = [{ id: 0, type: 'vale', name: 'THE VALE', x: cx, y: cy }];
  types.forEach((type, i) => {
    const a = turn0 + (i * Math.PI * 2) / 5 + (regionRng.next() - 0.5) * 0.4;
    const r = S * (0.27 + regionRng.next() * 0.06);
    regions.push({
      id: i + 1, type, name: REGION_WORDS[type](placeName(nameRng0)),
      x: Math.round(cx + Math.cos(a) * r), y: Math.round(cy + Math.sin(a) * r),
    });
  });
  const regionOf = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fromVale = Math.hypot(x - cx, y - cy) + (warp.fbm(x / 25, y / 25, 3) - 0.5) * 24;
      if (fromVale < VALE_RADIUS) continue;
      // Nearest region centre, with wobbly borders.
      let best = 1, bestD = Infinity;
      for (let r = 1; r < regions.length; r++) {
        const d = Math.hypot(x - regions[r].x, y - regions[r].y) + (warp.fbm(x / 18 + r * 7, y / 18, 3) - 0.5) * 50;
        if (d < bestD) { bestD = d; best = r; }
      }
      regionOf[y * S + x] = best;
    }
  }

  // 1. Terrain from noise. Elevation is pulled down toward the edges to make one continent,
  //    and each region pulls the other fields its own way.
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x - cx) / cx, ny = (y - cy) / cy;
      const edge = Math.sqrt(nx * nx + ny * ny);
      const fromVale = Math.hypot(x - cx, y - cy);
      const bias = REGION_BIAS[regions[regionOf[y * S + x]].type];
      const e = elevation.fbm(x / 40, y / 40, 5) + 0.47 - edge * edge * 0.8;
      const ridge = ridges.fbm(x / 22, y / 22, 4) + bias.ridge;
      const moist = moisture.fbm(x / 30, y / 30, 4) + bias.moist;
      let blight = blightNoise.fbm(x / 35, y / 35, 3) * 0.6 + (fromVale / (S * 0.5)) * 0.45 - 0.2 + bias.blight;
      if (fromVale < INNER_VALE + 6) blight = Math.min(blight, 0.3);

      let tile: T;
      if (e < 0.5) tile = T.Ocean;
      else if (ridge > 0.68 && e > 0.55 && fromVale > INNER_VALE) tile = blight > 0.6 ? T.RedPeak : T.Mountain;
      else if (ridge > 0.63 && fromVale > INNER_VALE - 6) tile = T.Hills;
      else if (blight > 0.58) tile = moist > 0.55 ? T.Mire : T.DeadWood;
      else if (moist > 0.6) tile = T.Pine;
      else if (moist > 0.52 && blight > 0.42) tile = T.Mire;
      else if (moist < 0.38) tile = T.Scrub;
      else tile = T.Grass;
      tiles[y * S + x] = tile;
    }
  }

  // 2. Keep only the land connected to the middle, so there is exactly one continent.
  const start = nearest(S, cx, cy, (x, y) => tiles[y * S + x] !== T.Ocean && TERRAIN[tiles[y * S + x] as T].walk)!;
  const land = flood(S, start, (i) => tiles[i] !== T.Ocean);
  for (let i = 0; i < S * S; i++) if (!land[i]) tiles[i] = T.Ocean;

  // 3. Everything we place must be reachable on foot from the start.
  const reach = flood(S, start, (i) => TERRAIN[tiles[i] as T].walk);
  const sites: Site[] = [];
  const siteAt = new Map<number, Site>();
  const free = (x: number, y: number, gap: number) =>
    sites.every((s) => Math.abs(s.x - x) + Math.abs(s.y - y) >= gap);

  const addSite = (kind: SiteKind, x: number, y: number, name: string, vale: boolean): Site => {
    const site: Site = { id: sites.length, kind, x, y, name, vale, region: regionOf[y * S + x] };
    sites.push(site);
    siteAt.set(y * S + x, site);
    return site;
  };

  // 4. The Vale: starting village and the three quest sites around it.
  const nameRng = new Rng(seed, 'names');
  const village = addSite('village', start.x, start.y, placeName(nameRng), true);
  const angle = rng.next() * Math.PI * 2;
  const placeNear = (dist: number, turn: number) => {
    const tx = Math.round(start.x + Math.cos(angle + turn) * dist);
    const ty = Math.round(start.y + Math.sin(angle + turn) * dist);
    return nearest(S, tx, ty, (x, y) => reach[y * S + x] === 1 && free(x, y, 6))!;
  };
  const shrinePos = placeNear(13, 0);
  const shrine = addSite('shrine', shrinePos.x, shrinePos.y, 'WAYSIDE SHRINE', true);
  const chapelPos = placeNear(19, (Math.PI * 2) / 3);
  const chapel = addSite('chapel', chapelPos.x, chapelPos.y, 'OLD CHAPEL', true);
  const barrowPos = placeNear(26, (Math.PI * 4) / 3);
  const barrow = addSite('barrow', barrowPos.x, barrowPos.y, 'BARROW', true);

  // 5. Each region gets a town near its middle, and a landmark out towards its far edge.
  const inRegion = (x: number, y: number, r: number) => reach[y * S + x] === 1 && regionOf[y * S + x] === r;
  const towns: Site[] = [];
  for (const region of regions.slice(1)) {
    const spot = nearest(S, region.x, region.y, (x, y) => inRegion(x, y, region.id) && free(x, y, 12), 60);
    if (spot) towns.push(addSite('village', spot.x, spot.y, placeName(nameRng), false));
  }
  for (const region of regions.slice(1)) {
    let best: { x: number; y: number } | null = null, bestD = -1;
    for (let i = 0; i < 400; i++) {
      const x = rng.int(2, S - 3), y = rng.int(2, S - 3);
      if (!inRegion(x, y, region.id) || !free(x, y, 14)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > bestD) { best = { x, y }; bestD = d; }
    }
    if (!best) continue;
    const mark = LANDMARKS[region.type as Exclude<RegionType, 'vale'>];
    addSite('landmark', best.x, best.y, region.type === 'blight' ? `${mark.name} OF ${placeName(nameRng)}` : mark.name, false);
  }

  // 6. Other sites: one chance per 24x24 cell.
  const REGION = 24;
  for (let ry = 0; ry * REGION < S; ry++) {
    for (let rx = 0; rx * REGION < S; rx++) {
      if (!rng.chance(0.55)) continue;
      const px = rx * REGION + rng.int(3, REGION - 4);
      const py = ry * REGION + rng.int(3, REGION - 4);
      if (px >= S || py >= S) continue;
      const spot = nearest(S, px, py, (x, y) => reach[y * S + x] === 1, 5);
      if (!spot) continue;
      if (Math.hypot(spot.x - cx, spot.y - cy) < INNER_VALE + 12) continue;
      if (!free(spot.x, spot.y, 10)) continue;
      const kind = siteKindFor(tiles[spot.y * S + spot.x] as T, rng);
      addSite(kind, spot.x, spot.y, kind === 'hamlet' ? placeName(nameRng) : siteName(kind, nameRng), false);
    }
  }

  // 7. Roads: from the village to each Vale site, then every town, then each hamlet to its
  //    nearest neighbour.
  const roadCost = (x: number, y: number) => {
    const tile = tiles[y * S + x] as T;
    if (siteAt.has(y * S + x)) return Infinity;
    const info = TERRAIN[tile];
    return info.walk ? info.cost : Infinity;
  };
  const lay = (a: Site, b: Site) => {
    const path = findPath(S, S, a, b, roadCost, 0.4);
    if (!path) return;
    for (const p of path) {
      const i = p.y * S + p.x;
      if (!siteAt.has(i)) tiles[i] = T.Road;
    }
  };
  lay(village, shrine);
  lay(village, chapel);
  lay(village, barrow);
  const connected: Site[] = [village];
  for (const t of [...towns].sort((a, b) => dist(a, village) - dist(b, village))) {
    const near = connected.reduce((best, s) => (dist(s, t) < dist(best, t) ? s : best), connected[0]);
    lay(near, t);
    connected.push(t);
  }
  const hamlets = sites.filter((s) => s.kind === 'hamlet');
  hamlets.sort((a, b) => dist(a, village) - dist(b, village));
  for (const h of hamlets) {
    const near = connected.reduce((best, s) => (dist(s, h) < dist(best, h) ? s : best), connected[0]);
    if (dist(near, h) < 110) lay(near, h);
    connected.push(h);
  }

  for (const s of sites) tiles[s.y * S + s.x] = T.Site;

  const quest = makeQuest(new Rng(seed, 'quest'), {
    villageId: village.id,
    shrineId: shrine.id,
    chapelId: chapel.id,
    barrowId: barrow.id,
  });
  barrow.name = `BARROW OF ${quest.villain}`;

  // Acts II and III (their own stream, so nothing above changes).
  // The stronghold stands in the Blight, as far from the Vale as there is room for.
  const blight = regions.find((r) => r.type === 'blight')!;
  const actRng = new Rng(seed, 'acts');
  let hold: { x: number; y: number } | null = null, holdD = -1;
  for (let i = 0; i < 600; i++) {
    const x = actRng.int(2, S - 3), y = actRng.int(2, S - 3);
    if (reach[y * S + x] !== 1 || regionOf[y * S + x] !== blight.id || !free(x, y, 8)) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d > holdD) { hold = { x, y }; holdD = d; }
  }
  if (!hold) hold = nearest(S, blight.x, blight.y, (x, y) => reach[y * S + x] === 1 && free(x, y, 4))!;
  const stronghold = addSite('stronghold', hold.x, hold.y, `HOLD OF ${quest.villain}`, false);
  quest.strongholdId = stronghold.id;
  // Two lieutenants, in two different regions, each in the deepest dungeon to be had there.
  const EPITHETS: Record<string, [string, MonsterId]> = {
    fenlands: ['THE DROWNED', 'hag'], highlands: ['IRONHAND', 'goblin'], ashwood: ['OF THE ASHES', 'wisp'], downs: ['THE BARROW-BORN', 'wight'],
  };
  const lands = actRng.shuffle(regions.filter((r) => r.type !== 'vale' && r.type !== 'blight'));
  for (const land of lands) {
    if (quest.lieutenants.length >= 2) break;
    const dens = sites.filter((s) => s.region === land.id && !s.vale && (s.kind === 'tower' || s.kind === 'cave'));
    const pool = dens.filter((s) => s.kind === 'tower').length ? dens.filter((s) => s.kind === 'tower') : dens;
    if (!pool.length) continue;
    const [epithet, kind] = EPITHETS[land.type] ?? ['THE GREY', 'wight'];
    quest.lieutenants.push({ name: `${personName(actRng)} ${epithet}`, siteId: actRng.pick(pool).id, region: land.id, kind });
  }
  // The Blight spreads to the lieutenants' lands first, then to whatever lies nearest.
  const fromBlight = (r: { x: number; y: number }) => Math.hypot(r.x - blight.x, r.y - blight.y);
  const ltLands = quest.lieutenants.map((l) => l.region);
  quest.blightOrder = [
    ...ltLands,
    ...regions.filter((r) => r.type !== 'vale' && r.type !== 'blight' && !ltLands.includes(r.id)).sort((a, b) => fromBlight(a) - fromBlight(b)).map((r) => r.id),
  ];

  // Some caves are more than caves: old mines in the highlands, drowned temples in the fens.
  // (Their own stream, so the rest of the world is exactly as it was.)
  for (const s of sites) {
    if (s.kind !== 'cave' || s.vale) continue;
    const type = regions[s.region]?.type;
    const rng = new Rng(seed, 'cave-style', s.id);
    if (type === 'highlands') {
      s.style = 'mine';
      s.name = `${placeName(rng)} MINE`;
    } else if (type === 'fenlands') {
      s.style = 'sunken';
      s.name = `SUNKEN TEMPLE OF ${personName(rng)}`;
    }
  }

  return { seed, size: S, tiles, sites, siteAt, quest, regions, regionOf };
}

function siteKindFor(tile: T, rng: Rng): SiteKind {
  switch (tile) {
    case T.Grass:
    case T.Road:
      return rng.pick<SiteKind>(['hamlet', 'hamlet', 'hamlet', 'ruin', 'shrine']);
    case T.Scrub:
      return rng.pick<SiteKind>(['hamlet', 'hamlet', 'ruin', 'tower']);
    case T.Pine:
      return rng.pick<SiteKind>(['cave', 'ruin', 'shrine', 'hamlet']);
    case T.Hills:
      return rng.pick<SiteKind>(['cave', 'cave', 'tower', 'hamlet']);
    case T.Mire:
      return rng.pick<SiteKind>(['shrine', 'ruin', 'cave']);
    case T.DeadWood:
      return rng.pick<SiteKind>(['ruin', 'tower', 'cave']);
    default:
      return 'ruin';
  }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Closest tile (spiral search) that passes the test. */
function nearest(S: number, x0: number, y0: number, ok: (x: number, y: number) => boolean, maxR = S): { x: number; y: number } | null {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx, y = y0 + dy;
        if (x < 1 || y < 1 || x >= S - 1 || y >= S - 1) continue;
        if (ok(x, y)) return { x, y };
      }
    }
  }
  return null;
}

/** Flood fill from a start tile; returns 1 for every tile reached. */
function flood(S: number, start: { x: number; y: number }, pass: (i: number) => boolean): Uint8Array {
  const seen = new Uint8Array(S * S);
  const stack = [start.y * S + start.x];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % S, y = (i / S) | 0;
    const next = [x > 0 ? i - 1 : -1, x < S - 1 ? i + 1 : -1, y > 0 ? i - S : -1, y < S - 1 ? i + S : -1];
    for (const n of next) {
      if (n >= 0 && !seen[n] && pass(n)) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return seen;
}
