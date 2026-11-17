// Dev helper: open the game with ?sheet to see every tile and sprite at 3x.
import type { Art } from '../gfx/art';
import { ICONS } from '../gfx/icons';
import { CHEST_CLOSED, CHEST_OPEN, MONSTER_ART, NPC_ART, playerArt } from '../gfx/sprites';
import { TILE_ART, siteArt } from '../gfx/tiles';
import type { SiteKind } from '../gen/types';
import type { ClassId } from '../game/rules';

export function showSheet(): void {
  const groups: [string, Art[]][] = [
    ['tiles', Object.values(TILE_ART)],
    ['sites', (['village', 'hamlet', 'cave', 'tower', 'chapel', 'shrine', 'ruin', 'barrow'] as SiteKind[]).map(siteArt)],
    ['heroes', (['warrior', 'thief', 'wizard'] as ClassId[]).flatMap((c) =>
      (['down', 'right', 'up'] as const).map((d) => playerArt(c, 1, d).art))],
    ['people', Object.values(NPC_ART)],
    ['monsters', [...Object.values(MONSTER_ART), CHEST_CLOSED, CHEST_OPEN]],
    ['icons', Object.values(ICONS)],
  ];
  document.body.innerHTML = '';
  document.body.style.cssText = 'background:#000;color:#aaa;font:12px monospace;padding:8px';
  for (const [name, arts] of groups) {
    const label = document.createElement('div');
    label.textContent = name;
    document.body.appendChild(label);
    const canvas = document.createElement('canvas');
    canvas.width = arts.length * 52;
    canvas.height = 52;
    canvas.style.imageRendering = 'pixelated';
    const ctx = canvas.getContext('2d')!;
    arts.forEach((a, i) => {
      const scale = 48 / a.size;
      for (let p = 0; p < a.size * a.size; p++) {
        const v = a.pixels[p];
        if (!v) continue;
        ctx.fillStyle = a.colors[v - 1];
        ctx.fillRect(i * 52 + (p % a.size) * scale, Math.floor(p / a.size) * scale, scale, scale);
      }
    });
    document.body.appendChild(canvas);
  }
}
