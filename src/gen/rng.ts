// Seeded randomness. Every system draws from its own named stream, e.g.
//   new Rng(seed, 'overworld')   or   new Rng(seed, 'site', 12)
// so adding a feature never changes the randomness of anything else.

/** cyrb128: hashes any string into four 32-bit numbers. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(...keys: (string | number)[]) {
    [this.a, this.b, this.c, this.d] = cyrb128(keys.join('|'));
    for (let i = 0; i < 12; i++) this.next(); // warm up
  }

  /** sfc32: a float in [0, 1). */
  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Whole number from lo to hi, inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }

  /** Roll n dice with the given number of sides, plus a bonus. */
  dice(n: number, sides: number, plus = 0): number {
    let total = plus;
    for (let i = 0; i < n; i++) total += this.int(1, sides);
    return total;
  }

  shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
}

/** A short shareable seed such as ASH-4F2K. */
export function randomSeed(): string {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ23456789';
  const r = () => Math.floor(Math.random() * 1e9);
  let s = '';
  for (let i = 0; i < 3; i++) s += letters[r() % letters.length];
  s += '-';
  for (let i = 0; i < 4; i++) s += chars[r() % chars.length];
  return s;
}
