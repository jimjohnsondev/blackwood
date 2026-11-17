// The game's fixed palette, in the spirit of a 12-bit 8-bit machine.
// Tiles and sprites refer to these names so colours stay consistent.

export const C = {
  black: '#000000',
  white: '#ffffff',
  bone: '#ddddee',
  cream: '#eeddcc',
  dim: '#888899',
  grey: '#aaaabb',
  darkgrey: '#666677',
  slate: '#444455',
  navy: '#112244',

  red: '#ee4444',
  crimson: '#dd3333',
  darkred: '#882222',
  gold: '#eebb44',
  orange: '#ee9933',
  amber: '#bb7744',
  brown: '#774422',
  tan: '#bb9955',
  darktan: '#776644',
  wood: '#996633',
  darkwood: '#553311',
  skin: '#eebb99',

  grass: '#225533',
  darkgrass: '#114422',
  green: '#22aa33',
  darkgreen: '#117722',
  lime: '#66cc44',
  olive: '#99aa33',
  darkolive: '#667755',
  hill: '#778855',

  blue: '#3377cc',
  darkblue: '#224499',
  sky: '#4488ee',
  cyan: '#44ccdd',
  teal: '#228888',
  purple: '#aa66ee',
  violet: '#7744aa',
  deadwood: '#998877',
  darkdead: '#665544',
} as const;

export type ColorName = keyof typeof C;

/** Night: same picture, darker and bluer. */
export function nightColor(hex: string): string {
  const [r, g, b] = rgb(hex);
  return toHex(r * 0.5, g * 0.55, Math.min(255, b * 0.8 + 10));
}

/** Winter: greens and browns go pale and frosty, towards snow. */
export function snowColor(hex: string): string {
  const [r, g, b] = rgb(hex);
  const grey = (r + g + b) / 3;
  const v = Math.min(255, grey * 0.5 + 150);
  return toHex(v * 0.92, v * 0.96, Math.min(255, v + 12));
}

/** The Blight: all colour drained to an ashen grey-violet. */
export function blightColor(hex: string): string {
  const [r, g, b] = rgb(hex);
  const v = (r + g + b) / 3;
  return toHex(v * 0.95 + 8, v * 0.82, v * 1.0 + 14);
}

/** Spring: fresh growth, so the greens are brighter and more saturated than summer's. */
export function springColor(hex: string): string {
  const [r, g, b] = rgb(hex);
  if (g <= r || g <= b) return hex; // only the greens change
  const grey = (r + g + b) / 3;
  const sat = (v: number) => grey + (v - grey) * 1.35; // push away from grey
  return toHex(Math.max(0, sat(r)) * 1.15, Math.min(255, sat(g) * 1.15), Math.max(0, sat(b)) * 1.1);
}

/** Autumn: greens turn to rust, amber and brown. */
export function autumnColor(hex: string): string {
  const [r, g, b] = rgb(hex);
  if (g <= r || g <= b) return hex; // only the greens turn
  return toHex(Math.min(255, g * 1.05 + 20), (r + g) * 0.42, b * 0.5);
}

/** Remembered-but-not-visible dungeon tiles: their own colour, darker and a little greyer. */
export function dimColor(hex: string): string {
  const [r, g, b] = rgb(hex);
  const grey = (r + g + b) / 3;
  const mix = (v: number) => (v * 0.7 + grey * 0.3) * 0.42;
  return toHex(mix(r), mix(g), mix(b));
}

/** Torchlight fading towards the edge of the light: a little darker and warmer. */
export function fadeColor(hex: string, amount: number): string {
  const [r, g, b] = rgb(hex);
  return toHex(r * amount * 1.05, g * amount, b * amount * 0.85);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
