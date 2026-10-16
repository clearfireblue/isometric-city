import type { GridPosition } from '@/core/types';
import type { World } from './types';
import { BUILDINGS } from './catalog';

const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export function walkable(world: World, x: number, y: number): boolean {
  const t = world.tiles[y]?.[x];
  if (!t) return false;
  if (t.terrain === 'water') return false;
  if (t.feature === 'boulder') return false;
  if (t.buildingId !== null) {
    const b = world.buildings.find((bb) => bb.id === t.buildingId);
    if (b && b.built >= 1 && BUILDINGS[b.kind].blocks) return false;
  }
  return true;
}

function stepCost(world: World, fx: number, fy: number, tx: number, ty: number, base: number): number {
  const a = world.tiles[fy][fx];
  const b = world.tiles[ty][tx];
  const climb = Math.abs(a.elevation - b.elevation);
  if (climb > 1) return Infinity;
  let mult = 1;
  if (b.path) mult = 0.55;
  else if (b.terrain === 'ford') mult = 2.4;
  else if (b.feature === 'tree' || b.feature === 'pine' || b.feature === 'shrub') mult = 1.4;
  return base * mult + climb * 0.7;
}

class MinHeap {
  private items: { k: number; v: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(v: number, k: number) {
    const a = this.items;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0].v;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A* over tiles. Returns the list of tiles to walk through (excluding the
 * start), or null if unreachable. If `adjacentOk`, reaching any tile next to
 * the goal counts (used for blocking buildings like fences).
 */
export function findPath(
  world: World,
  from: GridPosition,
  to: GridPosition,
  adjacentOk = false,
): GridPosition[] | null {
  const W = world.width;
  const H = world.height;
  const sx = Math.round(from.x);
  const sy = Math.round(from.y);
  if (sx === to.x && sy === to.y) return [];
  const start = sy * W + sx;
  const goal = to.y * W + to.x;
  const g = new Float32Array(W * H).fill(Infinity);
  const came = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const open = new MinHeap();
  g[start] = 0;
  open.push(start, 0);
  const h = (i: number) => {
    const x = i % W;
    const y = (i / W) | 0;
    const dx = Math.abs(x - to.x);
    const dy = Math.abs(y - to.y);
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * 0.55;
  };
  const goalWalkable = walkable(world, to.x, to.y);
  let found = -1;
  let iterations = 0;
  while (open.size > 0 && iterations++ < 6000) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % W;
    const cy = (cur / W) | 0;
    if (cur === goal || (adjacentOk && Math.max(Math.abs(cx - to.x), Math.abs(cy - to.y)) <= 1)) {
      found = cur;
      break;
    }
    for (const [dx, dy, base] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const isGoal = ni === goal;
      if (!walkable(world, nx, ny) && !(isGoal && !goalWalkable && !adjacentOk)) continue;
      // no cutting corners around obstacles
      if (dx !== 0 && dy !== 0 && (!walkable(world, cx + dx, cy) || !walkable(world, cx, cy + dy))) continue;
      const c = stepCost(world, cx, cy, nx, ny, base);
      if (!isFinite(c)) continue;
      const ng = g[cur] + c;
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        open.push(ni, ng + h(ni));
      }
    }
  }
  if (found < 0) return null;
  const path: GridPosition[] = [];
  let c = found;
  while (c !== start && c >= 0) {
    path.push({ x: c % W, y: (c / W) | 0 });
    c = came[c];
  }
  path.reverse();
  return path;
}
