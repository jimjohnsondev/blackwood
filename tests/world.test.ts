import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/gen/world';
import { buildLevel } from '../src/gen/levels';
import { T, TERRAIN } from '../src/game/terrain';

const SEEDS = ['ASH-4F2K', 'BLACKWOOD', 'QRX-77AB', 'ZZZ-0000', 'MOOR-1'];

function hash(data: Uint8Array): number {
  let h = 2166136261;
  for (const v of data) h = Math.imul(h ^ v, 16777619);
  return h >>> 0;
}

describe('world generation', () => {
  it('is the same every time for the same seed', () => {
    const a = generateWorld('ASH-4F2K');
    const b = generateWorld('ASH-4F2K');
    expect(hash(a.tiles)).toBe(hash(b.tiles));
    expect(a.sites).toEqual(b.sites);
    expect(a.quest).toEqual(b.quest);
  });

  it('differs between seeds', () => {
    expect(hash(generateWorld('A').tiles)).not.toBe(hash(generateWorld('B').tiles));
  });

  for (const seed of SEEDS) {
    it(`${seed}: one continent with the quest sites and every site reachable on foot`, () => {
      const w = generateWorld(seed);
      const S = w.size;
      const kinds = w.sites.map((s) => s.kind);
      // The starting village, plus a town in each of the five regions; one landmark each.
      expect(kinds.filter((k) => k === 'village')).toHaveLength(6);
      expect(kinds.filter((k) => k === 'landmark')).toHaveLength(5);
      for (const r of w.regions.slice(1)) {
        expect(w.sites.some((s) => s.kind === 'village' && s.region === r.id), `${r.name} has a town`).toBe(true);
        expect(w.sites.some((s) => s.kind === 'landmark' && s.region === r.id), `${r.name} has a landmark`).toBe(true);
      }
      expect(kinds).toContain('chapel');
      expect(kinds).toContain('barrow');
      expect(kinds).toContain('shrine');
      expect(w.sites.length).toBeGreaterThanOrEqual(15);

      // Edges are sea.
      for (let i = 0; i < S; i++) {
        expect(w.tiles[i]).toBe(T.Ocean);
        expect(w.tiles[(S - 1) * S + i]).toBe(T.Ocean);
      }

      // Flood from the village over walkable tiles reaches every site.
      const v = w.sites[w.quest.villageId];
      const seen = new Uint8Array(S * S);
      const stack = [v.y * S + v.x];
      seen[stack[0]] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        for (const n of [i - 1, i + 1, i - S, i + S]) {
          if (n < 0 || n >= S * S || seen[n]) continue;
          if (!TERRAIN[w.tiles[n] as T].walk) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      for (const s of w.sites) expect(seen[s.y * S + s.x], `${s.kind} ${s.name}`).toBe(1);
    });

    it(`${seed}: every site map builds, with a walkable entry`, () => {
      const w = generateWorld(seed);
      for (const site of w.sites) {
        const floors = site.kind === 'barrow' ? 3 : 1;
        for (let f = 1; f <= floors; f++) {
          const level = buildLevel(w, site, f);
          const entry = level.tiles[level.entry.y * level.w + level.entry.x] as T;
          expect(TERRAIN[entry].walk, `${site.kind} floor ${f}`).toBe(true);
          if (site.kind === 'village') {
            const roles = level.npcs.map((n) => n.role);
            for (const r of ['elder', 'innkeeper', 'shopkeeper', 'priest']) expect(roles, seed).toContain(r);
          }
          if (site.kind === 'barrow' && f === 3) expect(level.monsters.some((m) => m.boss)).toBe(true);
          if (site.kind === 'chapel') expect(level.tiles.includes(T.Altar)).toBe(true);
        }
      }
    });
  }
});
