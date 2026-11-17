import type { Action } from './actions';
import { setUsingKeys } from './labels';

/**
 * Keyboard controls:
 *   arrows move, Space or Enter = A, Ctrl = B, Esc = MENU, L = LOOK,
 *   M / I / S / J = Map, Items, Stats, Journal.
 * When `typing()` is true (entering a name or seed), letters and digits are typed instead.
 */
export function listenKeyboard(send: (a: Action) => void, typing: () => boolean): void {
  window.addEventListener('keydown', (e) => {
    // Ctrl on its own is B; Ctrl with another key is left to the browser (Ctrl+R and so on).
    if (e.key === 'Control' && !e.repeat) {
      e.preventDefault();
      setUsingKeys(true);
      send({ kind: 'b' });
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const action = keyToAction(e, typing());
    // The phone-keyboard text field handles its own letters, backspace and Enter.
    if (e.target instanceof HTMLInputElement && action && (action.kind === 'char' || action.kind === 'backspace' || e.key === 'Enter' || e.key === ' ')) return;
    if (action) {
      e.preventDefault();
      setUsingKeys(true);
      send(action);
    }
  });
}

function keyToAction(e: KeyboardEvent, typing: boolean): Action | null {
  switch (e.key) {
    case 'ArrowUp': return { kind: 'dir', dir: 'up' };
    case 'ArrowDown': return { kind: 'dir', dir: 'down' };
    case 'ArrowLeft': return { kind: 'dir', dir: 'left' };
    case 'ArrowRight': return { kind: 'dir', dir: 'right' };
    case ' ': return { kind: 'a' };
    case 'Enter': return { kind: 'a' };
    // While typing a name or seed, Esc steps back; otherwise it opens the menu.
    case 'Escape': return typing ? { kind: 'b' } : { kind: 'menu' };
    case 'Backspace': return typing ? { kind: 'backspace' } : { kind: 'b' };
  }
  const k = e.key.length === 1 ? e.key.toUpperCase() : '';
  if (!k) return null;
  if (typing) {
    if (/[A-Z0-9-]/.test(k)) return { kind: 'char', ch: k };
    return null;
  }
  switch (k) {
    case 'L': return { kind: 'look' };
    case 'C': return { kind: 'cast' };
    case 'X': return { kind: 'actions' };
    case 'F': return { kind: 'cast' };
    case 'M': return { kind: 'tab', tab: 'map' };
    case 'I': return { kind: 'tab', tab: 'items' };
    case 'S': return { kind: 'tab', tab: 'stats' };
    case 'J': return { kind: 'tab', tab: 'journal' };
  }
  return null;
}
