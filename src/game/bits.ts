// Packs 0/1 maps (explored tiles) into short base64 strings for saves.

export function packBits(flags: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(flags.length / 8));
  for (let i = 0; i < flags.length; i++) if (flags[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unpackBits(text: string, length: number): Uint8Array {
  const flags = new Uint8Array(length);
  const s = atob(text);
  for (let i = 0; i < length; i++) {
    if ((s.charCodeAt(i >> 3) >> (i & 7)) & 1) flags[i] = 1;
  }
  return flags;
}
