// Every input, from keyboard, touch or gamepad, becomes one of these actions.

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Tab = 'map' | 'items' | 'stats' | 'journal';

export type Action =
  | { kind: 'dir'; dir: Dir }
  | { kind: 'a' }
  | { kind: 'b' }
  | { kind: 'look' }
  | { kind: 'cast' }   // the CAST / FIRE button
  | { kind: 'actions' }   // the ACTIONS button: sneak, look, wait, rest
  | { kind: 'point'; x: number; y: number }   // a tap on the game screen, in screen pixels (256x192)
  | { kind: 'menu' }
  | { kind: 'tab'; tab: Tab }
  | { kind: 'char'; ch: string }   // typed letter (names and seeds)
  | { kind: 'backspace' };

export const DIRS: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** Turn a data-action attribute ("up", "a", "tab:items") into an Action. */
export function parseAction(name: string): Action | null {
  if (name === 'up' || name === 'down' || name === 'left' || name === 'right') return { kind: 'dir', dir: name };
  if (name === 'a') return { kind: 'a' };
  if (name === 'b') return { kind: 'b' };
  if (name === 'look') return { kind: 'look' };
  if (name === 'cast') return { kind: 'cast' };
  if (name === 'actions') return { kind: 'actions' };
  if (name === 'menu') return { kind: 'menu' };
  if (name.startsWith('tab:')) return { kind: 'tab', tab: name.slice(4) as Tab };
  return null;
}
