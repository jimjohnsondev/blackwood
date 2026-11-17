// A* path finding on a grid, used for roads (and nothing that runs every turn).

export function findPath(
  w: number,
  h: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  cost: (x: number, y: number) => number, // Infinity = blocked
  minCost: number,
): { x: number; y: number }[] | null {
  const size = w * h;
  const g = new Float32Array(size).fill(Infinity);
  const came = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const start = from.y * w + from.x;
  const goal = to.y * w + to.x;
  const heap = new MinHeap();
  g[start] = 0;
  heap.push(start, 0);

  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w, cy = (cur / w) | 0;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (closed[n]) continue;
      const step = n === goal ? 1 : cost(nx, ny);
      if (!isFinite(step)) continue;
      const ng = g[cur] + step;
      if (ng < g[n]) {
        g[n] = ng;
        came[n] = cur;
        heap.push(n, ng + (Math.abs(nx - to.x) + Math.abs(ny - to.y)) * minCost);
      }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const path: { x: number; y: number }[] = [];
  for (let c = goal; c !== -1; c = came[c]) path.push({ x: c % w, y: (c / w) | 0 });
  return path.reverse();
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

class MinHeap {
  private items: number[] = [];
  private prios: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, prio: number): void {
    this.items.push(item);
    this.prios.push(prio);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prios[p] <= this.prios[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPrio = this.prios.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.prios[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.items.length && this.prios[l] < this.prios[m]) m = l;
        if (r < this.items.length && this.prios[r] < this.prios[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prios[a], this.prios[b]] = [this.prios[b], this.prios[a]];
  }
}
