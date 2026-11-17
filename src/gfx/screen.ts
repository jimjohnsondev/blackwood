// The 256x192 game screen: 32x24 cells of 8x8 pixels.
// Everything is drawn from cached 8x8 images, so a full redraw is cheap.
import type { Art } from './art';
import { glyph } from './font';
import { C, autumnColor, blightColor, springColor, dimColor, fadeColor, nightColor, snowColor } from './palette';

export const W = 256;
export const H = 192;
export const COLS = 32;
export const ROWS = 24;

/**
 * day = normal colours, night = darker and bluer, dim = remembered dungeon tiles,
 * lit1 / lit2 = the outer rings of torchlight, fading towards the dark.
 */
export type Shade = 'day' | 'night' | 'dim' | 'lit1' | 'lit2' | 'snow' | 'autumn' | 'snownight' | 'autumnnight' | 'spring' | 'springnight' | 'blight' | 'blightnight';

const SHADES: Record<Shade, (c: string) => string> = {
  day: (c) => c,
  night: nightColor,
  dim: dimColor,
  lit1: (c) => fadeColor(c, 0.78),
  lit2: (c) => fadeColor(c, 0.58),
  // The seasons, on open land.
  snow: snowColor,
  autumn: autumnColor,
  spring: springColor,
  blight: blightColor,
  blightnight: (c) => nightColor(blightColor(c)),
  springnight: (c) => nightColor(springColor(c)),
  snownight: (c) => nightColor(snowColor(c)),
  autumnnight: (c) => nightColor(autumnColor(c)),
};

export class Screen {
  readonly ctx: CanvasRenderingContext2D;
  private artCache = new Map<Art, Partial<Record<Shade, HTMLCanvasElement>>>();
  private glyphCache = new Map<string, HTMLCanvasElement>();

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  clear(color: string = C.black): void {
    this.fill(0, 0, W, H, color);
  }

  fill(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  /** Draw a picture (8x8 or 16x16) at pixel position (x, y). */
  art(a: Art, x: number, y: number, shade: Shade = 'day', flip = false): void {
    const img = this.cached(a, shade);
    if (flip) {
      this.ctx.save();
      this.ctx.translate(x + a.size, y);
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(img, 0, 0);
      this.ctx.restore();
    } else {
      this.ctx.drawImage(img, x, y);
    }
  }

  /** Draw a picture enlarged (character previews). */
  artScaled(a: Art, x: number, y: number, scale: number, flip = false): void {
    const img = this.cached(a, 'day');
    const px = a.size * scale;
    this.ctx.save();
    if (flip) {
      this.ctx.translate(x + px, y);
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(img, 0, 0, px, px);
    } else {
      this.ctx.drawImage(img, x, y, px, px);
    }
    this.ctx.restore();
  }

  /** Draw a picture with its top-left at text cell (cx, cy). */
  cell(a: Art, cx: number, cy: number, shade: Shade = 'day', flip = false): void {
    this.art(a, cx * 8, cy * 8, shade, flip);
  }

  /** Draw text on the 32x24 character grid. */
  text(s: string, cx: number, cy: number, color: string = C.cream, bg?: string): void {
    this.textPx(s, cx * 8, cy * 8, color, bg);
  }

  /** Draw text at any pixel position, optionally scaled up (for the title). */
  textPx(s: string, x: number, y: number, color: string, bg?: string, scale = 1): void {
    const str = s.toUpperCase();
    for (let i = 0; i < str.length; i++) {
      const px = x + i * 8 * scale;
      if (bg) this.fill(px, y, 8 * scale, 8 * scale, bg);
      const img = this.glyphImage(str[i], color);
      if (scale === 1) this.ctx.drawImage(img, px, y);
      else this.ctx.drawImage(img, px, y, 8 * scale, 8 * scale);
    }
  }

  /** A box drawn with 1px lines through the middle of the border cells. */
  box(cx: number, cy: number, cw: number, ch: number, line: string, fill: string = C.black): void {
    const x = cx * 8, y = cy * 8, w = cw * 8, h = ch * 8;
    this.fill(x, y, w, h, fill);
    this.ctx.fillStyle = line;
    this.ctx.fillRect(x + 3, y + 3, w - 6, 1);
    this.ctx.fillRect(x + 3, y + h - 4, w - 6, 1);
    this.ctx.fillRect(x + 3, y + 3, 1, h - 6);
    this.ctx.fillRect(x + w - 4, y + 3, 1, h - 6);
  }

  /** A see-through coloured square (hit flashes). */
  tint(x: number, y: number, size: number, color: string, alpha: number): void {
    this.ctx.globalAlpha = alpha;
    this.fill(x, y, size, size, color);
    this.ctx.globalAlpha = 1;
  }

  hline(cy: number, cx0: number, cx1: number, color: string): void {
    this.fill(cx0 * 8, cy * 8 + 3, (cx1 - cx0 + 1) * 8, 1, color);
  }

  private cached(a: Art, shade: Shade): HTMLCanvasElement {
    let entry = this.artCache.get(a);
    if (!entry) {
      entry = {};
      this.artCache.set(a, entry);
    }
    let img = entry[shade];
    if (!img) {
      const map = SHADES[shade];
      img = paint(a.pixels, a.size, a.colors.map(map));
      entry[shade] = img;
    }
    return img;
  }

  private glyphImage(ch: string, color: string): HTMLCanvasElement {
    const key = ch + color;
    let img = this.glyphCache.get(key);
    if (!img) {
      img = paint(glyph(ch), 8, [color]);
      this.glyphCache.set(key, img);
    }
    return img;
  }
}

function paint(pixels: Uint8Array, size: number, colors: string[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < size * size; i++) {
    const v = pixels[i];
    if (!v) continue;
    ctx.fillStyle = colors[v - 1] ?? '#ff00ff';
    ctx.fillRect(i % size, Math.floor(i / size), 1, 1);
  }
  return canvas;
}
