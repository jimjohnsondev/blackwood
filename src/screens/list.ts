// A scrolling list with a cursor, used by menus, the shop, the Items panel and creation.
import type { Art } from '../gfx/art';
import { C } from '../gfx/palette';
import type { Screen } from '../gfx/screen';

export interface ListItem {
  label: string;
  right?: string;
  icon?: Art;
  color?: string;
}

export class ListView {
  cursor = 0;
  private top = 0;

  constructor(public rows: number) {}

  move(delta: number, count: number): void {
    if (count === 0) return;
    this.cursor = (this.cursor + delta + count) % count;
  }

  clamp(count: number): void {
    if (this.cursor >= count) this.cursor = Math.max(0, count - 1);
  }

  /** Draw items in the box starting at cell (cx, cy), `width` cells wide. */
  draw(s: Screen, items: ListItem[], cx: number, cy: number, width: number): void {
    this.clamp(items.length);
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + this.rows) this.top = this.cursor - this.rows + 1;
    for (let i = 0; i < this.rows; i++) {
      const item = items[this.top + i];
      if (!item) break;
      const y = cy + i;
      const selected = this.top + i === this.cursor;
      if (selected) s.text('>', cx, y, C.gold);
      let x = cx + 2;
      if (item.icon) {
        s.cell(item.icon, x, y);
        x += 2;
      }
      const room = width - (x - cx) - (item.right ? item.right.length + 1 : 0);
      s.text(item.label.slice(0, room), x, y, item.color ?? (selected ? C.cream : C.dim));
      if (item.right) s.text(item.right, cx + width - item.right.length, y, selected ? C.cream : C.dim);
    }
    if (this.top > 0) s.text('-', cx + width - 1, cy - 1, C.dim);
    if (this.top + this.rows < items.length) s.text('+', cx + width - 1, cy + this.rows, C.dim);
  }
}
