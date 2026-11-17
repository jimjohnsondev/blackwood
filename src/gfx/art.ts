// Pixel art is written as square text grids: 16x16 for the map, 8x8 for item icons.
//   '.'               = transparent
//   '#'               = the first colour (single-colour art)
//   '1'..'9', 'a'..'f' = the 1st..15th colour in the list
// Example (a 16x16 grid has 16 rows of 16 characters):
//   art(['green', 'brown'], `
//     .......1........
//     ......111.......
//     ...`)

import { C, type ColorName } from './palette';

export interface Art {
  /** Width and height in pixels (8 or 16). */
  size: number;
  /** size*size colour indexes, row by row; 0 = transparent. */
  pixels: Uint8Array;
  /** Hex colours for indexes 1..n. */
  colors: string[];
}

export function art(colors: (ColorName | string)[], grid: string): Art {
  const rows = grid
    .trim()
    .split('\n')
    .map((r) => r.trim());
  const size = rows.length;
  if ((size !== 8 && size !== 16) || rows.some((r) => r.length !== size)) {
    const bad = rows.map((r, i) => `${i}: ${r} (${r.length})`).filter((_, i) => rows[i].length !== size);
    throw new Error(`Art must be 8x8 or 16x16, got ${size} rows:\n${bad.join('\n')}\n${grid}`);
  }
  const pixels = new Uint8Array(size * size);
  rows.forEach((row, y) => {
    for (let x = 0; x < size; x++) {
      const ch = row[x];
      pixels[y * size + x] = ch === '.' ? 0 : ch === '#' ? 1 : parseInt(ch, 16);
    }
  });
  return { size, pixels, colors: colors.map(hex) };
}

/** Same pixels, different colours (used for monster, NPC and player variants). */
export function recolor(base: Art, colors: (ColorName | string)[]): Art {
  return { size: base.size, pixels: base.pixels, colors: colors.map(hex) };
}

/** Single-colour art: '#' pixels drawn in one colour, everything else see-through. */
export function mono(color: ColorName | string, grid: string): Art {
  return art([color], grid);
}

/** The same picture in a single colour. */
export function monoOf(base: Art, color: ColorName | string): Art {
  return { size: base.size, pixels: base.pixels.map((v) => (v ? 1 : 0)), colors: [hex(color)] };
}

function hex(name: ColorName | string): string {
  return name.startsWith('#') ? name : C[name as ColorName];
}
