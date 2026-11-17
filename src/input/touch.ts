import { parseAction, type Action } from './actions';
import { setUsingKeys } from './labels';

/**
 * Wire every element with a data-action attribute (tabs, d-pad, A, B, LOOK, MENU).
 * The d-pad repeats while held so the player can walk by holding a direction.
 */
export function listenTouch(send: (a: Action) => void): void {
  // A tap or click on the game screen itself (used to pick a target).
  const canvas = document.querySelector<HTMLCanvasElement>('#screen');
  canvas?.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    send({ kind: 'point', x: ((e.clientX - r.left) / r.width) * 256, y: ((e.clientY - r.top) / r.height) * 192 });
  });

  const buttons = document.querySelectorAll<HTMLElement>('[data-action]');
  buttons.forEach((el) => {
    const action = parseAction(el.dataset.action ?? '');
    if (!action) return;
    const repeats = action.kind === 'dir';
    let timer: number | undefined;

    const stop = () => {
      el.classList.remove('down');
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const repeat = () => {
      send(action);
      timer = window.setTimeout(repeat, 140);
    };

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events (tests, some browsers) have no capturable pointer.
      }
      el.classList.add('down');
      // A tap on the pad means button names; a mouse click on desktop keeps the key names.
      if (e.pointerType !== 'mouse') setUsingKeys(false);
      send(action);
      if (repeats) timer = window.setTimeout(repeat, 320);
    });
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('pointerleave', stop);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keyboard users can still press the HTML buttons with Enter/Space; ignore those
    // because the keyboard handler already covers them.
    el.addEventListener('click', (e) => e.preventDefault());
  });
}

/** A standard gamepad: d-pad, A, B, X / Select = CAST / FIRE, Y = ACTIONS, Start = MENU. Polled each frame. */
export function pollGamepad(send: (a: Action) => void): void {
  const pads = navigator.getGamepads?.() ?? [];
  const pad = pads.find((p) => p);
  if (!pad) return;
  const map: [number, Action][] = [
    [12, { kind: 'dir', dir: 'up' }],
    [13, { kind: 'dir', dir: 'down' }],
    [14, { kind: 'dir', dir: 'left' }],
    [15, { kind: 'dir', dir: 'right' }],
    [0, { kind: 'a' }],
    [1, { kind: 'b' }],
    [8, { kind: 'cast' }],
    [2, { kind: 'cast' }],
    [3, { kind: 'actions' }],
    [9, { kind: 'menu' }],
  ];
  const now = performance.now();
  for (const [index, action] of map) {
    const pressed = pad.buttons[index]?.pressed ?? false;
    const state = padState[index] ?? { down: false, next: 0 };
    if (pressed && (!state.down || (action.kind === 'dir' && now >= state.next))) {
      setUsingKeys(false);
      send(action);
      state.next = now + (state.down ? 140 : 320);
    }
    state.down = pressed;
    padState[index] = state;
  }
}
const padState: Record<number, { down: boolean; next: number }> = {};
