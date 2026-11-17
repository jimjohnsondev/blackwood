import { caravanAt, caravans } from './sim/caravans';
// Boot: set up the page, the screen and input, then run the current scene every frame.
import { unlock } from './audio/sound';
import { showSheet } from './dev/sheet';
import { Screen } from './gfx/screen';
import type { Action } from './input/actions';
import { listenKeyboard } from './input/keyboard';
import { listenTouch, pollGamepad } from './input/touch';
import { listenTextEntry } from './input/textentry';
import type { App, Scene } from './screens/scene';
import { TitleScene } from './screens/title';
import { setActiveTab, setCastLabel, setupLayout } from './ui/layout';

// Add ?sheet to the URL to see every tile and sprite instead of the game.
if (location.search.includes('sheet')) showSheet();
else boot();

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
  setupLayout(canvas);
  const screen = new Screen(canvas);

  const app: App & { scene: Scene } = {
    scene: null as unknown as Scene,
    go(scene: Scene) {
      this.scene = scene;
    },
  };
  app.go(new TitleScene(app));

  // Add ?debug to the URL to reach the running game from the browser console as `blackwood`.
  if (location.search.includes('debug')) (window as unknown as { blackwood: unknown }).blackwood = Object.assign(app, { caravans, caravanAt });

  const send = (action: Action): void => {
    unlock();
    try {
      app.scene.input(action);
    } catch (err) {
      showError(err);
    }
  };

  listenKeyboard(send, () => app.scene.typing?.() ?? false);
  listenTouch(send);
  listenTextEntry(() => app.scene, send);

  // Ask for the next frame first, so one bad frame can never stop the game for good.
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    try {
      pollGamepad(send);
      app.scene.draw(screen, now);
      setActiveTab(app.scene.tab?.() ?? 'map');
      setCastLabel(app.scene.castLabel?.() ?? 'look');
    } catch (err) {
      showError(err);
    }
  };
  requestAnimationFrame(frame);
}

/**
 * If something goes wrong, keep playing but say so in a small box over the page,
 * so a screenshot shows what broke. Each different error is shown once.
 */
const shown = new Set<string>();
function showError(err: unknown): void {
  const text = err instanceof Error ? `${err.message}\n${(err.stack ?? '').split('\n').slice(1, 4).join('\n')}` : String(err);
  console.error(err);
  if (shown.has(text)) return;
  shown.add(text);
  const box = document.createElement('pre');
  box.textContent = `SOMETHING WENT WRONG (TAP TO CLOSE)\n${text}`;
  box.style.cssText =
    'position:fixed;left:8px;right:8px;top:8px;z-index:99;margin:0;padding:8px;white-space:pre-wrap;' +
    'font:11px monospace;color:#fff;background:#802020;border:2px solid #fff;';
  box.addEventListener('click', () => box.remove());
  document.body.appendChild(box);
}

// Installed as an app, the game works offline: a service worker keeps a copy.
// (Only for the normal build on a web server; the single-file build has nothing to cache.)
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && import.meta.env.MODE !== 'single') {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
