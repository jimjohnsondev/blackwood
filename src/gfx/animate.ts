// Animation for the sprites, made from the single drawn picture of each one.
//
// Every 16x16 sprite gets three extra frames, worked out from its pixels:
//   breathe  the body sinks one pixel onto its feet (an idle bob)
//   stepL    the left foot lifts one pixel
//   stepR    the right foot lifts one pixel
// and creatures that fly get a hover frame (the whole sprite one pixel up).
// Frames are made once per picture and kept.
import type { Art } from './art';

export type Frame = 'still' | 'breathe' | 'stepL' | 'stepR' | 'hover';

const made = new WeakMap<Art, Map<Frame, Art>>();

/** The picture for one frame of animation. */
export function frameOf(base: Art, frame: Frame): Art {
  if (frame === 'still' || base.size !== 16) return base;
  let frames = made.get(base);
  if (!frames) {
    frames = new Map();
    made.set(base, frames);
  }
  let a = frames.get(frame);
  if (!a) {
    a = build(base, frame);
    frames.set(frame, a);
  }
  return a;
}

function build(base: Art, frame: Frame): Art {
  const n = base.size;
  const src = base.pixels;
  const out = new Uint8Array(n * n);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? 0 : src[y * n + x]);
  // The lowest row with anything in it: where the feet are.
  let bottom = n - 1;
  while (bottom > 0 && !src.subarray(bottom * n, bottom * n + n).some(Boolean)) bottom--;
  // Left and right halves split at the middle of what's drawn, not the middle of the grid.
  let minX = n, maxX = 0;
  for (let i = 0; i < src.length; i++) if (src[i]) { minX = Math.min(minX, i % n); maxX = Math.max(maxX, i % n); }
  const mid = (minX + maxX + 1) / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v: number;
      switch (frame) {
        case 'hover':
          v = at(x, y + 1);
          break;
        case 'breathe':
          // Feet (the last two rows) stay put; everything above sinks a pixel.
          v = y >= bottom - 1 ? at(x, y) : at(x, y - 1);
          break;
        default: {
          // One foot (the last three rows on one side) lifts a pixel.
          const lifting = frame === 'stepL' ? x < mid : x >= mid;
          v = lifting && y >= bottom - 2 ? (y === bottom ? 0 : at(x, y + 1)) : at(x, y);
        }
      }
      out[y * n + x] = v;
    }
  }
  return { size: n, pixels: out, colors: base.colors };
}

/**
 * Keeps track of who moved and when, so walkers step and the rest breathe.
 * Call `see` each frame with an id and position; `frame` says which picture to draw.
 */
export class Animator {
  private last = new Map<string, { x: number; y: number; movedAt: number; steps: number }>();

  /** Which frame to show for something at (x, y) right now. `flies` hovers instead of stepping. */
  frame(id: string, x: number, y: number, now: number, flies = false): Frame {
    let t = this.last.get(id);
    if (!t) {
      t = { x, y, movedAt: -1e9, steps: 0 };
      this.last.set(id, t);
    }
    if (t.x !== x || t.y !== y) {
      t.x = x;
      t.y = y;
      t.movedAt = now;
      t.steps++;
    }
    // Each one keeps its own rhythm, so a crowd doesn't bob in step.
    let phase = 0;
    for (let i = 0; i < id.length; i++) phase = (phase * 31 + id.charCodeAt(i)) % 997;
    if (flies) return Math.floor((now + phase * 3) / 400) % 2 ? 'hover' : 'still';
    if (now - t.movedAt < 260) return t.steps % 2 ? 'stepL' : 'stepR';
    return Math.floor((now + phase * 7) / 650) % 2 ? 'breathe' : 'still';
  }

  /** Forget everyone (on a new level), so nobody "steps" across the whole map. */
  clear(): void {
    this.last.clear();
  }
}
