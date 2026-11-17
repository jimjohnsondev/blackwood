// Typing on a phone: a hidden text field that brings up the phone's own keyboard.
// It mirrors the text being typed (a name or a seed), so letters, backspace and
// autocorrect all just work, and pressing the keyboard's Go/Enter key moves on.
import type { Action } from './actions';

export interface TextScene {
  typing?(): boolean;
  text?(): string;
  setText?(value: string): void;
}

export function listenTextEntry(scene: () => TextScene, send: (a: Action) => void): void {
  const field = document.createElement('input');
  field.type = 'text';
  field.id = 'type-field';
  field.autocomplete = 'off';
  field.autocapitalize = 'characters';
  field.spellcheck = false;
  field.setAttribute('autocorrect', 'off');
  field.setAttribute('enterkeyhint', 'next');
  field.setAttribute('aria-label', 'Type here');
  document.body.appendChild(field);

  const typing = () => scene().typing?.() ?? false;
  const open = () => {
    field.value = scene().text?.() ?? '';
    field.focus({ preventScroll: true });
  };

  // Tapping the screen while a name or seed is wanted opens the keyboard.
  const screen = document.querySelector('#screen');
  screen?.addEventListener('pointerdown', () => {
    if (typing()) open();
  });
  // A tap's late mouse events would otherwise move focus off the field and close the keyboard.
  screen?.addEventListener('mousedown', (e) => {
    if (typing()) e.preventDefault();
  });
  screen?.addEventListener('click', () => {
    if (typing() && document.activeElement !== field) open();
  });
  // Pressing A or a button that lands on a typing step opens it too (it's still a tap).
  document.addEventListener('pointerup', () => {
    if (typing() && document.activeElement !== field) open();
    else if (typing()) field.value = scene().text?.() ?? ''; // e.g. UP picked another name
    if (!typing() && document.activeElement === field) field.blur();
  });

  field.addEventListener('input', () => {
    scene().setText?.(field.value.toUpperCase());
    field.value = scene().text?.() ?? '';
  });
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      field.blur();
      send({ kind: 'a' });
    }
  });
}
