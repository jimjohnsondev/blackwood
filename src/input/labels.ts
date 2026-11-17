// What to call the buttons on screen: the gamepad's names (A, B, MENU) for touch and
// gamepads, or the keys (SPACE, ESC, ENTER) for someone playing on a keyboard.
// It follows whatever was used last, starting from the kind of screen.

export type Button = 'A' | 'B' | 'MENU' | 'ACTIONS' | 'CAST' | 'MAP' | 'ITEMS' | 'JOURNAL';

const PAD: Record<Button, string> = { A: 'A', B: 'B', MENU: 'MENU', ACTIONS: 'ACTIONS', CAST: 'CAST', MAP: 'MAP', ITEMS: 'ITEMS', JOURNAL: 'JOURNAL' };
const KEYS: Record<Button, string> = { A: 'SPACE', B: 'CTRL', MENU: 'ESC', ACTIONS: 'X', CAST: 'C', MAP: 'M', ITEMS: 'I', JOURNAL: 'J' };

let keys = typeof window !== 'undefined' && !!window.matchMedia && !window.matchMedia('(pointer: coarse)').matches;

/** Called by the input code: a key was pressed (true), or a button was tapped or a pad used (false). */
export function setUsingKeys(on: boolean): void {
  keys = on;
}

export function usingKeys(): boolean {
  return keys;
}

/** The name of a button, as the player knows it: "A" or "SPACE". */
export function btn(b: Button): string {
  return (keys ? KEYS : PAD)[b];
}

/** A line of hints: hint(['A', 'NEXT'], ['B', 'BACK']) gives "A NEXT   B BACK" or "SPACE NEXT   ESC BACK". */
export function hint(...pairs: [Button, string][]): string {
  return pairs.map(([b, what]) => `${btn(b)} ${what}`).join('   ');
}

/** A tab or button name, with its key when on a keyboard: "ACTIONS" or "ACTIONS (X)". */
export function named(b: Button): string {
  return keys && b !== 'A' && b !== 'B' && b !== 'MENU' ? `${b} (${KEYS[b]})` : PAD[b];
}
