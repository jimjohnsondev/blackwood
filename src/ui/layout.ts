// Fills in the pixel-art control images and keeps the game screen at a crisp,
// whole-number scale of real device pixels.
import type { Tab } from '../input/actions';

import tabMapOn from './img/tab-map-on.png';
import tabMapOff from './img/tab-map-off.png';
import tabItemsOn from './img/tab-items-on.png';
import tabItemsOff from './img/tab-items-off.png';
import tabStatsOn from './img/tab-stats-on.png';
import tabStatsOff from './img/tab-stats-off.png';
import tabJournalOn from './img/tab-journal-on.png';
import tabJournalOff from './img/tab-journal-off.png';
import dpad from './img/dpad.png';
import btnA from './img/btn-a.png';
import btnB from './img/btn-b.png';
import pillLook from './img/pill-look.png';
import pillCast from './img/pill-cast.png';
import pillFire from './img/pill-fire.png';
import pillMenu from './img/pill-menu.png';
import pillActions from './img/pill-actions.png';

const TAB_IMAGES: Record<Tab, { on: string; off: string }> = {
  map: { on: tabMapOn, off: tabMapOff },
  items: { on: tabItemsOn, off: tabItemsOff },
  stats: { on: tabStatsOn, off: tabStatsOff },
  journal: { on: tabJournalOn, off: tabJournalOff },
};

export function setupLayout(canvas: HTMLCanvasElement): void {
  setImg('#dpad-img', dpad);
  setImg('#btn-a img', btnA);
  setImg('#btn-b img', btnB);
  setImg('#btn-cast img', pillLook);
  setImg('#btn-menu img', pillMenu);
  setImg('#btn-actions img', pillActions);
  setActiveTab('map');

  const fit = () => fitCanvas(canvas);
  window.addEventListener('resize', fit);
  fit();
}

let currentTab: Tab | null = null;
export function setActiveTab(tab: Tab): void {
  if (tab === currentTab) return;
  currentTab = tab;
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((btn) => {
    const t = btn.dataset.action!.slice(4) as Tab;
    const img = btn.querySelector('img')!;
    img.src = t === tab ? TAB_IMAGES[t].on : TAB_IMAGES[t].off;
    btn.setAttribute('aria-pressed', String(t === tab));
  });
}

/** The class button reads CAST for a wizard, FIRE with a bow or scroll, LOOK otherwise. */
export type CastLabel = 'cast' | 'fire' | 'look';
let currentCast: CastLabel | null = null;
export function setCastLabel(label: CastLabel): void {
  if (label === currentCast) return;
  currentCast = label;
  setImg('#btn-cast img', label === 'cast' ? pillCast : label === 'fire' ? pillFire : pillLook);
  document.querySelector('#btn-cast')?.setAttribute('aria-label', label);
}

function setImg(selector: string, src: string): void {
  const img = document.querySelector<HTMLImageElement>(selector);
  if (img) img.src = src;
}

/** Largest whole-number scale (in device pixels) that fits the space. */
function fitCanvas(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const desktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const maxW = Math.min(window.innerWidth, desktop ? 1200 : 560) - 6;
  const maxH = desktop ? window.innerHeight - 150 : window.innerHeight * 0.5; // room for the tabs and the button row
  let scale = Math.floor(Math.min((maxW * dpr) / 256, (maxH * dpr) / 192));
  if (scale < 1) scale = 1;
  canvas.style.width = `${(256 * scale) / dpr}px`;
  canvas.style.height = `${(192 * scale) / dpr}px`;
}
