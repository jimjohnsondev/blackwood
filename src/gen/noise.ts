// Smooth value noise for terrain. noise2(x, y) returns 0..1.
import { Rng } from './rng';

export class ValueNoise {
  private perm: Uint8Array;
  private values: Float32Array;

  constructor(rng: Rng) {
    this.perm = new Uint8Array(512);
    this.values = new Float32Array(256);
    const p = rng.shuffle(Array.from({ length: 256 }, (_, i) => i));
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) this.values[i] = rng.next();
  }

  private lattice(ix: number, iy: number): number {
    return this.values[this.perm[(this.perm[ix & 255] + iy) & 511] & 255];
  }

  noise2(x: number, y: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = this.lattice(ix, iy);
    const b = this.lattice(ix + 1, iy);
    const c = this.lattice(ix, iy + 1);
    const d = this.lattice(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  /** Several octaves layered together for natural-looking shapes. */
  fbm(x: number, y: number, octaves = 4): number {
    let total = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise2(x * freq, y * freq) * amp;
      max += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return total / max;
  }
}
