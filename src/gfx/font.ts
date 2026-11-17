// The 8x8 game font. Glyphs are 6 rows tall, drawn on rows 1-6 of the cell,
// with doubled vertical strokes in the style of 8-bit home computers.
// Only capitals are used: text is upper-cased before drawing.

const GLYPHS: Record<string, string[]> = {
  A: ['...XX...', '..XXXX..', '.XX..XX.', '.XX..XX.', '.XXXXXX.', '.XX..XX.'],
  B: ['.XXXXX..', '.XX..XX.', '.XXXXX..', '.XX..XX.', '.XX..XX.', '.XXXXX..'],
  C: ['..XXXX..', '.XX..XX.', '.XX.....', '.XX.....', '.XX..XX.', '..XXXX..'],
  D: ['.XXXX...', '.XX.XX..', '.XX..XX.', '.XX..XX.', '.XX.XX..', '.XXXX...'],
  E: ['.XXXXXX.', '.XX.....', '.XXXXX..', '.XX.....', '.XX.....', '.XXXXXX.'],
  F: ['.XXXXXX.', '.XX.....', '.XXXXX..', '.XX.....', '.XX.....', '.XX.....'],
  G: ['..XXXXX.', '.XX.....', '.XX.....', '.XX.XXX.', '.XX..XX.', '..XXXXX.'],
  H: ['.XX..XX.', '.XX..XX.', '.XXXXXX.', '.XX..XX.', '.XX..XX.', '.XX..XX.'],
  I: ['..XXXX..', '...XX...', '...XX...', '...XX...', '...XX...', '..XXXX..'],
  J: ['.....XX.', '.....XX.', '.....XX.', '.....XX.', '.XX..XX.', '..XXXX..'],
  K: ['.XX..XX.', '.XX.XX..', '.XXXX...', '.XXXX...', '.XX.XX..', '.XX..XX.'],
  L: ['.XX.....', '.XX.....', '.XX.....', '.XX.....', '.XX.....', '.XXXXXX.'],
  M: ['.XX...XX', '.XXX.XXX', '.XXXXXXX', '.XX.X.XX', '.XX...XX', '.XX...XX'],
  N: ['.XX..XX.', '.XXX.XX.', '.XXXXXX.', '.XXXXXX.', '.XX.XXX.', '.XX..XX.'],
  O: ['..XXXX..', '.XX..XX.', '.XX..XX.', '.XX..XX.', '.XX..XX.', '..XXXX..'],
  P: ['.XXXXX..', '.XX..XX.', '.XX..XX.', '.XXXXX..', '.XX.....', '.XX.....'],
  Q: ['..XXXX..', '.XX..XX.', '.XX..XX.', '.XX..XX.', '.XX.XX..', '..XX.XX.'],
  R: ['.XXXXX..', '.XX..XX.', '.XX..XX.', '.XXXXX..', '.XX.XX..', '.XX..XX.'],
  S: ['..XXXXX.', '.XX.....', '..XXXX..', '.....XX.', '.....XX.', '.XXXXX..'],
  T: ['.XXXXXX.', '...XX...', '...XX...', '...XX...', '...XX...', '...XX...'],
  U: ['.XX..XX.', '.XX..XX.', '.XX..XX.', '.XX..XX.', '.XX..XX.', '..XXXX..'],
  V: ['.XX..XX.', '.XX..XX.', '.XX..XX.', '.XX..XX.', '..XXXX..', '...XX...'],
  W: ['.XX...XX', '.XX...XX', '.XX.X.XX', '.XXXXXXX', '.XXX.XXX', '.XX...XX'],
  X: ['.XX..XX.', '.XX..XX.', '..XXXX..', '..XXXX..', '.XX..XX.', '.XX..XX.'],
  Y: ['.XX..XX.', '.XX..XX.', '..XXXX..', '...XX...', '...XX...', '...XX...'],
  Z: ['.XXXXXX.', '.....XX.', '....XX..', '...XX...', '..XX....', '.XXXXXX.'],
  '0': ['..XXXX..', '.XX..XX.', '.XX.XXX.', '.XXX.XX.', '.XX..XX.', '..XXXX..'],
  '1': ['...XX...', '..XXX...', '...XX...', '...XX...', '...XX...', '.XXXXXX.'],
  '2': ['..XXXX..', '.XX..XX.', '....XX..', '...XX...', '..XX....', '.XXXXXX.'],
  '3': ['.XXXXXX.', '....XX..', '...XXX..', '.....XX.', '.XX..XX.', '..XXXX..'],
  '4': ['....XX..', '...XXX..', '..XXXX..', '.XX.XX..', '.XXXXXX.', '....XX..'],
  '5': ['.XXXXXX.', '.XX.....', '.XXXXX..', '.....XX.', '.XX..XX.', '..XXXX..'],
  '6': ['..XXXX..', '.XX.....', '.XXXXX..', '.XX..XX.', '.XX..XX.', '..XXXX..'],
  '7': ['.XXXXXX.', '.....XX.', '....XX..', '...XX...', '..XX....', '..XX....'],
  '8': ['..XXXX..', '.XX..XX.', '..XXXX..', '.XX..XX.', '.XX..XX.', '..XXXX..'],
  '9': ['..XXXX..', '.XX..XX.', '.XX..XX.', '..XXXXX.', '.....XX.', '..XXXX..'],
  '/': ['.....XX.', '....XX..', '...XX...', '..XX....', '.XX.....', 'XX......'],
  ':': ['........', '...XX...', '...XX...', '........', '...XX...', '...XX...'],
  '>': ['..XX....', '...XX...', '....XX..', '....XX..', '...XX...', '..XX....'],
  '<': ['....XX..', '...XX...', '..XX....', '..XX....', '...XX...', '....XX..'],
  '.': ['........', '........', '........', '........', '...XX...', '...XX...'],
  ',': ['........', '........', '........', '...XX...', '...XX...', '..XX....'],
  "'": ['...XX...', '...XX...', '..XX....', '........', '........', '........'],
  '"': ['.XX.XX..', '.XX.XX..', '.X..X...', '........', '........', '........'],
  '-': ['........', '........', '.XXXXXX.', '........', '........', '........'],
  '+': ['........', '...XX...', '.XXXXXX.', '...XX...', '........', '........'],
  '=': ['........', '.XXXXXX.', '........', '.XXXXXX.', '........', '........'],
  '*': ['........', '.XX..XX.', '..XXXX..', 'XXXXXXXX', '..XXXX..', '.XX..XX.'],
  '%': ['.XX...X.', '.XX..XX.', '....XX..', '...XX...', '..XX..XX', '.XX...XX'],
  '[': ['..XXXX..', '..XX....', '..XX....', '..XX....', '..XX....', '..XXXX..'],
  ']': ['..XXXX..', '....XX..', '....XX..', '....XX..', '....XX..', '..XXXX..'],
  '(': ['....XX..', '...XX...', '...XX...', '...XX...', '...XX...', '....XX..'],
  ')': ['..XX....', '...XX...', '...XX...', '...XX...', '...XX...', '..XX....'],
  '?': ['..XXXX..', '.XX..XX.', '....XX..', '...XX...', '........', '...XX...'],
  '!': ['...XX...', '...XX...', '...XX...', '...XX...', '........', '...XX...'],
  '_': ['........', '........', '........', '........', '........', 'XXXXXXXX'],
  ' ': ['........', '........', '........', '........', '........', '........'],
};

/** 64 on/off pixels per character. '#' is a solid cursor block. */
export const FONT: Record<string, Uint8Array> = {};

for (const [ch, rows] of Object.entries(GLYPHS)) {
  const px = new Uint8Array(64);
  rows.forEach((row, i) => {
    for (let x = 0; x < 8; x++) px[(i + 1) * 8 + x] = row[x] === 'X' ? 1 : 0;
  });
  FONT[ch] = px;
}
FONT['#'] = new Uint8Array(64).fill(1);

export function glyph(ch: string): Uint8Array {
  return FONT[ch] ?? FONT['?'];
}
