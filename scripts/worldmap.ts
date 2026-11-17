// Dev helper: prints stats for a seed and writes a PPM image of the continent.
import { writeFileSync } from 'node:fs';
import { generateWorld } from '../src/gen/world';
import { buildLevel } from '../src/gen/levels';
import { T } from '../src/game/terrain';

const seed = process.argv[2] ?? 'ASH-4F2K';
const t0 = performance.now();
const w = generateWorld(seed);
const ms = performance.now() - t0;
const counts: Record<string, number> = {};
for (const s of w.sites) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
let land = 0, road = 0;
for (const t of w.tiles) { if (t !== T.Ocean) land++; if (t === T.Road) road++; }
console.log(seed, `${ms.toFixed(0)}ms`, 'sites', w.sites.length, counts, 'land%', (100 * land / w.tiles.length).toFixed(0), 'road', road);
console.log('quest', w.quest.title, '/', w.quest.villainTitle, '/', w.quest.problem);
const colors: Record<number, number[]> = {
  [T.Ocean]: [34, 68, 153], [T.Grass]: [34, 85, 51], [T.Scrub]: [119, 102, 68], [T.Pine]: [17, 119, 34],
  [T.DeadWood]: [153, 136, 119], [T.Mire]: [153, 170, 51], [T.Hills]: [119, 136, 85], [T.Mountain]: [170, 170, 187],
  [T.RedPeak]: [221, 51, 51], [T.Road]: [187, 153, 85], [T.Site]: [255, 255, 0],
};
const S = w.size;
let ppm = `P3\n${S} ${S}\n255\n`;
for (let i = 0; i < S * S; i++) ppm += (colors[w.tiles[i]] ?? [255, 0, 255]).join(' ') + '\n';
writeFileSync(`/tmp/world-${seed}.ppm`, ppm);
let levels = 0;
for (const s of w.sites) {
  const floors = s.kind === 'barrow' ? 3 : 1;
  for (let f = 1; f <= floors; f++) { buildLevel(w, s, f); levels++; }
}
console.log('built', levels, 'levels ok');
