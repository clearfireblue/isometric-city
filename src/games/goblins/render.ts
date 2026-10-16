/**
 * Canvas renderer for Goblin Hollow.
 *
 * Everything is drawn in code (no sprite sheets). Tiles are drawn diagonal
 * by diagonal, back to front, and the objects standing on each diagonal
 * (trees, buildings, goblins) are drawn right after their row, so taller
 * hills in front correctly hide goblins walking behind them.
 */
import type { Building, Goblin, Tile, Tool, World } from './types';
import { BUILDINGS, ELEV_PX, TILE_H, TILE_W, placementError } from './catalog';
import { Hollow, buildingById, hourOf, isNight } from './sim';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderState {
  hover: { x: number; y: number } | null;
  tool: Tool;
  selectedGoblin: number | null;
  selectedBuilding: number | null;
  /** real seconds, for animation */
  time: number;
}

const HW = TILE_W / 2;
const HH = TILE_H / 2;

/** world tile coords (+elevation) → unscaled world-pixel coords */
export function project(x: number, y: number, z: number): { px: number; py: number } {
  return { px: (x - y) * HW, py: (x + y) * HH - z * ELEV_PX };
}

export function toScreen(cam: Camera, w: number, h: number, px: number, py: number) {
  return { sx: (px - cam.x) * cam.zoom + w / 2, sy: (py - cam.y) * cam.zoom + h / 2 };
}

export function fromScreen(cam: Camera, w: number, h: number, sx: number, sy: number) {
  return { px: (sx - w / 2) / cam.zoom + cam.x, py: (sy - h / 2) / cam.zoom + cam.y };
}

/** Which tile is under a screen point, accounting for hills. */
export function pickTile(world: World, cam: Camera, w: number, h: number, sx: number, sy: number): { x: number; y: number } | null {
  const { px, py } = fromScreen(cam, w, h, sx, sy);
  let best: Tile | null = null;
  for (let e = 0; e <= 3; e++) {
    const fy = py + e * ELEV_PX;
    const gx = Math.round((px / HW + fy / HH) / 2);
    const gy = Math.round((fy / HH - px / HW) / 2);
    const t = world.tiles[gy]?.[gx];
    if (t && t.elevation === e && (!best || t.x + t.y > best.x + best.y)) best = t;
  }
  if (best) return { x: best.x, y: best.y };
  const gx = Math.round((px / HW + py / HH) / 2);
  const gy = Math.round((py / HH - px / HW) / 2);
  return world.tiles[gy]?.[gx] ? { x: gx, y: gy } : null;
}

export function pickGoblin(world: World, cam: Camera, w: number, h: number, sx: number, sy: number): Goblin | null {
  let best: Goblin | null = null;
  let bestD = 22 * Math.max(0.7, cam.zoom);
  for (const g of world.goblins) {
    if (hiddenIndoors(world, g)) continue;
    const { px, py } = project(g.x, g.y, g.z);
    const s = toScreen(cam, w, h, px, py - 10);
    const d = Math.hypot(s.sx - sx, s.sy - sy);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

function hiddenIndoors(world: World, g: Goblin): boolean {
  return g.action.type === 'sleep' && g.action.arrived && !!g.action.atHome && g.path.length === 0;
}

// ---------------------------------------------------------------------------
// palette helpers
// ---------------------------------------------------------------------------

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h}, ${s}%, ${l}%, ${a})`;

function groundColor(t: Tile, time: number): string {
  const v = (t.variant - 0.5) * 6;
  const lift = t.elevation * 3;
  switch (t.terrain) {
    case 'water':
      return hsl(198, 55, 42 + Math.sin(time * 1.5 + t.x * 0.7 + t.y * 0.4) * 2.5);
    case 'ford':
      return hsl(192, 45, 52);
    case 'rock':
      return hsl(90, 6, 52 + v + lift);
    case 'meadow':
      return hsl(82, 48, 47 + v + lift);
    case 'dirt':
      return hsl(32, 35, 40 + v);
    default:
      return hsl(98, 40, 38 + v + lift);
  }
}

function darkness(minute: number): { dark: number; tint: string } {
  const h = hourOf(minute);
  if (h >= 7 && h < 18) return { dark: 0, tint: '' };
  if (h >= 18 && h < 21) {
    const t = (h - 18) / 3;
    return { dark: t * 0.58, tint: `rgba(255,140,60,${0.12 * Math.sin(t * Math.PI)})` };
  }
  if (h >= 5 && h < 7) {
    const t = 1 - (h - 5) / 2;
    return { dark: t * 0.58, tint: `rgba(255,170,120,${0.1 * Math.sin(t * Math.PI)})` };
  }
  return { dark: 0.58, tint: '' };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class Renderer {
  private lightCanvas: HTMLCanvasElement | null = null;

  draw(ctx: CanvasRenderingContext2D, hollow: Hollow, cam: Camera, W: number, H: number, rs: RenderState) {
    const world = hollow.world;
    const N = world.width;
    const night = darkness(world.minute);

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, night.dark > 0.3 ? '#141a33' : '#a9d3e8');
    sky.addColorStop(1, night.dark > 0.3 ? '#232846' : '#e9e2c4');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    // visible bounds in world pixels
    const left = cam.x - W / 2 / cam.zoom - TILE_W;
    const right = cam.x + W / 2 / cam.zoom + TILE_W;
    const top = cam.y - H / 2 / cam.zoom - TILE_H * 3;
    const bottom = cam.y + H / 2 / cam.zoom + TILE_H * 4;

    // bucket objects by diagonal
    const buckets: (() => void)[][] = Array.from({ length: 2 * N }, () => []);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const t = world.tiles[y][x];
        if (t.feature) buckets[x + y].push(() => this.drawFeature(ctx, t, rs.time));
      }
    }
    for (const b of world.buildings) {
      buckets[b.x + b.y].push(() => this.drawBuilding(ctx, world, b, rs));
    }
    const sorted = [...world.goblins].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const g of sorted) {
      if (hiddenIndoors(world, g)) continue;
      const d = Math.min(2 * N - 2, Math.max(0, Math.round(g.x) + Math.round(g.y)));
      buckets[d].push(() => this.drawGoblin(ctx, g, rs, world));
    }

    for (let d = 0; d <= 2 * (N - 1); d++) {
      const x0 = Math.max(0, d - (N - 1));
      const x1 = Math.min(d, N - 1);
      for (let x = x0; x <= x1; x++) {
        const y = d - x;
        const t = world.tiles[y][x];
        const { px, py } = project(x, y, t.elevation);
        if (px < left || px > right || py < top || py > bottom + ELEV_PX * 4) continue;
        this.drawTile(ctx, world, t, px, py, rs.time);
      }
      if (rs.hover && rs.hover.x + rs.hover.y === d) this.drawHover(ctx, world, rs);
      for (const fn of buckets[d]) fn();
    }

    ctx.restore();

    // night & lighting
    if (night.dark > 0.01) this.drawLighting(ctx, world, cam, W, H, night.dark, rs.time);
    if (night.tint) {
      ctx.fillStyle = night.tint;
      ctx.fillRect(0, 0, W, H);
    }

    // labels on top of everything (selected goblin)
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    const sel = world.goblins.find((g) => g.id === rs.selectedGoblin);
    if (sel && !hiddenIndoors(world, sel)) this.drawNameTag(ctx, sel, cam.zoom);
    ctx.restore();
  }

  // ----- tiles -------------------------------------------------------------

  private drawTile(ctx: CanvasRenderingContext2D, world: World, t: Tile, px: number, py: number, time: number) {
    const cx = px;
    const cy = py;
    // side faces where the neighbour in front is lower (or the map edge)
    const front = [
      { n: world.tiles[t.y + 1]?.[t.x], side: 'left' as const },
      { n: world.tiles[t.y]?.[t.x + 1], side: 'right' as const },
    ];
    for (const { n, side } of front) {
      const nElev = n ? (n.terrain === 'water' ? -0.25 : n.elevation) : -1.2;
      const drop = (t.elevation - nElev) * ELEV_PX;
      if (drop <= 0) continue;
      const rocky = t.terrain === 'rock' || t.elevation >= 3;
      const base = t.terrain === 'water' ? hsl(198, 50, 30) : rocky ? hsl(30, 8, 40) : hsl(28, 38, 30);
      const light = t.terrain === 'water' ? hsl(198, 50, 36) : rocky ? hsl(30, 8, 48) : hsl(28, 38, 37);
      ctx.fillStyle = side === 'left' ? base : light;
      ctx.beginPath();
      if (side === 'left') {
        ctx.moveTo(cx - HW, cy);
        ctx.lineTo(cx, cy + HH);
        ctx.lineTo(cx, cy + HH + drop);
        ctx.lineTo(cx - HW, cy + drop);
      } else {
        ctx.moveTo(cx, cy + HH);
        ctx.lineTo(cx + HW, cy);
        ctx.lineTo(cx + HW, cy + drop);
        ctx.lineTo(cx, cy + HH + drop);
      }
      ctx.closePath();
      ctx.fill();
      // a grassy lip on the cliff top
      if (t.terrain !== 'water' && t.terrain !== 'rock' && t.terrain !== 'ford') {
        ctx.strokeStyle = hsl(98, 40, 30);
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (side === 'left') {
          ctx.moveTo(cx - HW, cy + 1);
          ctx.lineTo(cx, cy + HH + 1);
        } else {
          ctx.moveTo(cx, cy + HH + 1);
          ctx.lineTo(cx + HW, cy + 1);
        }
        ctx.stroke();
      }
    }

    // top
    ctx.fillStyle = groundColor(t, time);
    ctx.beginPath();
    ctx.moveTo(cx, cy - HH);
    ctx.lineTo(cx + HW, cy);
    ctx.lineTo(cx, cy + HH);
    ctx.lineTo(cx - HW, cy);
    ctx.closePath();
    ctx.fill();
    // faint seam to read the grid
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (t.terrain === 'water') {
      const s = Math.sin(time * 2 + t.x + t.y * 1.3);
      ctx.strokeStyle = `rgba(255,255,255,${0.18 + s * 0.08})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - 10 + s * 3, cy - 2);
      ctx.lineTo(cx + 2 + s * 3, cy - 2);
      ctx.moveTo(cx - 2 - s * 2, cy + 5);
      ctx.lineTo(cx + 10 - s * 2, cy + 5);
      ctx.stroke();
    } else if (t.terrain === 'ford') {
      ctx.fillStyle = hsl(30, 8, 62);
      for (const [ox, oy] of [[-12, -1], [0, 3], [12, -2], [-4, -7], [6, 8]]) {
        ctx.beginPath();
        ctx.ellipse(cx + ox, cy + oy, 4, 2.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (t.terrain === 'grass' || t.terrain === 'meadow') {
      // grass tufts
      ctx.strokeStyle = hsl(98, 45, t.terrain === 'meadow' ? 36 : 30, 0.6);
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const r1 = ((t.variant * 997 * (i + 1)) % 1) - 0.5;
        const r2 = ((t.variant * 571 * (i + 3)) % 1) - 0.5;
        const gx = cx + r1 * TILE_W * 0.55;
        const gy = cy + r2 * TILE_H * 0.55;
        ctx.beginPath();
        ctx.moveTo(gx - 1.5, gy);
        ctx.lineTo(gx - 2.5, gy - 3);
        ctx.moveTo(gx + 1.5, gy);
        ctx.lineTo(gx + 2.5, gy - 3);
        ctx.stroke();
      }
    }

    if (t.path) this.drawPath(ctx, world, t, cx, cy);
  }

  private drawPath(ctx: CanvasRenderingContext2D, world: World, t: Tile, cx: number, cy: number) {
    ctx.fillStyle = hsl(33, 38, 52);
    const k = 0.42;
    ctx.beginPath();
    ctx.moveTo(cx, cy - HH * k);
    ctx.lineTo(cx + HW * k, cy);
    ctx.lineTo(cx, cy + HH * k);
    ctx.lineTo(cx - HW * k, cy);
    ctx.closePath();
    ctx.fill();
    // connect to neighbours: strips toward edge midpoints
    const dirs: [number, number, number, number][] = [
      [1, 0, HW / 2, HH / 2],
      [-1, 0, -HW / 2, -HH / 2],
      [0, 1, -HW / 2, HH / 2],
      [0, -1, HW / 2, -HH / 2],
    ];
    for (const [dx, dy, ex, ey] of dirs) {
      const n = world.tiles[t.y + dy]?.[t.x + dx];
      if (!n || !n.path) continue;
      const ox = -ey * 0.75;
      const oy = ex * 0.25;
      ctx.beginPath();
      ctx.moveTo(cx + ox, cy + oy);
      ctx.lineTo(cx + ex + ox, cy + ey + oy);
      ctx.lineTo(cx + ex - ox, cy + ey - oy);
      ctx.lineTo(cx - ox, cy - oy);
      ctx.closePath();
      ctx.fill();
    }
    // pebbles
    ctx.fillStyle = hsl(33, 20, 62);
    ctx.fillRect(cx - 4 + t.variant * 6, cy - 2, 2, 1.5);
    ctx.fillRect(cx + 3 - t.variant * 5, cy + 3, 1.5, 1.5);
  }

  private drawHover(ctx: CanvasRenderingContext2D, world: World, rs: RenderState) {
    const hv = rs.hover!;
    const t = world.tiles[hv.y]?.[hv.x];
    if (!t) return;
    const { px, py } = project(t.x, t.y, t.elevation);
    let ok = true;
    if (rs.tool !== 'inspect' && rs.tool !== 'clear' && rs.tool !== 'path') ok = placementError(rs.tool, t) === null;
    if (rs.tool === 'path') ok = t.terrain !== 'water' && !['tree', 'pine', 'boulder'].includes(t.feature ?? '');
    const color = rs.tool === 'clear' ? '255,170,90' : ok ? '255,240,180' : '255,90,80';
    ctx.fillStyle = `rgba(${color},0.22)`;
    ctx.strokeStyle = `rgba(${color},0.9)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py - HH);
    ctx.lineTo(px + HW, py);
    ctx.lineTo(px, py + HH);
    ctx.lineTo(px - HW, py);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (ok && rs.tool in BUILDINGS && t.buildingId === null) {
      ctx.globalAlpha = 0.55;
      this.drawBuildingShape(ctx, { id: -1, kind: rs.tool as Building['kind'], x: t.x, y: t.y, built: 1, growth: 0.7, stew: 0, residents: [], reservedBy: null }, px, py, rs.time, false, world);
      ctx.globalAlpha = 1;
    }
  }

  // ----- features ------------------------------------------------------------

  private drawFeature(ctx: CanvasRenderingContext2D, t: Tile, time: number) {
    const { px, py } = project(t.x, t.y, t.elevation);
    const v = t.variant;
    const sway = Math.sin(time * 0.8 + t.x * 0.3 + t.y * 0.2) * 1.2;
    switch (t.feature) {
      case 'tree': {
        const s = 0.85 + v * 0.35;
        shadow(ctx, px, py + 2, 14 * s, 6 * s);
        ctx.fillStyle = hsl(25, 35, 28);
        ctx.fillRect(px - 2.5 * s, py - 16 * s, 5 * s, 17 * s);
        const leaf = (dx: number, dy: number, r: number, l: number) => {
          ctx.fillStyle = hsl(105 + v * 20, 38, l);
          ctx.beginPath();
          ctx.arc(px + dx * s + sway * (dy < -30 ? 1 : 0.5), py + dy * s, r * s, 0, Math.PI * 2);
          ctx.fill();
        };
        leaf(-7, -22, 10, 26);
        leaf(7, -23, 10, 28);
        leaf(0, -31, 11, 32);
        leaf(-3, -35, 6, 38);
        break;
      }
      case 'pine': {
        const s = 0.85 + v * 0.4;
        shadow(ctx, px, py + 2, 11 * s, 5 * s);
        ctx.fillStyle = hsl(25, 35, 25);
        ctx.fillRect(px - 2 * s, py - 8 * s, 4 * s, 9 * s);
        for (let i = 0; i < 3; i++) {
          const w = (13 - i * 3) * s;
          const yb = py - (6 + i * 9) * s;
          ctx.fillStyle = hsl(150, 30, 22 + i * 4);
          ctx.beginPath();
          ctx.moveTo(px - w + sway * 0.3 * i, yb);
          ctx.lineTo(px + w + sway * 0.3 * i, yb);
          ctx.lineTo(px + sway * 0.5 * i, yb - 14 * s);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case 'shrub': {
        shadow(ctx, px, py + 1, 9, 4);
        ctx.fillStyle = hsl(100, 35, 30);
        ctx.beginPath();
        ctx.ellipse(px - 3, py - 4, 7, 5.5, 0, 0, Math.PI * 2);
        ctx.ellipse(px + 4, py - 5, 6, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hsl(100, 35, 38);
        ctx.beginPath();
        ctx.ellipse(px, py - 8, 5, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'boulder': {
        shadow(ctx, px, py + 2, 12, 5);
        ctx.fillStyle = hsl(35, 6, 50);
        ctx.beginPath();
        ctx.moveTo(px - 11, py);
        ctx.quadraticCurveTo(px - 12, py - 12, px - 2, py - 14);
        ctx.quadraticCurveTo(px + 11, py - 13, px + 11, py - 1);
        ctx.quadraticCurveTo(px, py + 4, px - 11, py);
        ctx.fill();
        ctx.fillStyle = hsl(35, 6, 62);
        ctx.beginPath();
        ctx.ellipse(px - 2, py - 10, 5, 2.5, -0.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'flowers': {
        const hues = [350, 45, 280, 200, 20];
        for (let i = 0; i < 6; i++) {
          const fx = px + (((v * 733 * (i + 1)) % 1) - 0.5) * 34;
          const fy = py + (((v * 389 * (i + 2)) % 1) - 0.5) * 16;
          ctx.strokeStyle = hsl(100, 40, 28);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx, fy - 4);
          ctx.stroke();
          ctx.fillStyle = hsl(hues[(i + Math.floor(v * 5)) % hues.length], 75, 66);
          ctx.beginPath();
          ctx.arc(fx, fy - 5, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }
  }

  // ----- buildings -----------------------------------------------------------

  private drawBuilding(ctx: CanvasRenderingContext2D, world: World, b: Building, rs: RenderState) {
    const t = world.tiles[b.y][b.x];
    const { px, py } = project(b.x, b.y, t.elevation);
    const selected = rs.selectedBuilding === b.id;
    if (selected) {
      ctx.strokeStyle = 'rgba(255,230,140,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py - HH);
      ctx.lineTo(px + HW, py);
      ctx.lineTo(px, py + HH);
      ctx.lineTo(px - HW, py);
      ctx.closePath();
      ctx.stroke();
    }
    if (b.built < 1) {
      ctx.globalAlpha = 0.35 + b.built * 0.5;
      this.drawBuildingShape(ctx, b, px, py, rs.time, false, world);
      ctx.globalAlpha = 1;
      // stakes & progress bar
      ctx.strokeStyle = hsl(30, 40, 35);
      ctx.lineWidth = 1.5;
      for (const [sx, sy] of [[-HW * 0.6, 0], [HW * 0.6, 0], [0, -HH * 0.6], [0, HH * 0.6]]) {
        ctx.beginPath();
        ctx.moveTo(px + sx, py + sy);
        ctx.lineTo(px + sx, py + sy - 7);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(30,20,10,0.6)';
      ctx.fillRect(px - 14, py + 6, 28, 4);
      ctx.fillStyle = '#f2c46d';
      ctx.fillRect(px - 14, py + 6, 28 * b.built, 4);
      return;
    }
    this.drawBuildingShape(ctx, b, px, py, rs.time, isNight(world.minute), world);
  }

  private drawBuildingShape(ctx: CanvasRenderingContext2D, b: Building, px: number, py: number, time: number, night: boolean, world: World) {
    switch (b.kind) {
      case 'burrow': {
        shadow(ctx, px, py + 3, 22, 8);
        // earthen mound
        ctx.fillStyle = hsl(28, 35, 32);
        ctx.beginPath();
        ctx.ellipse(px, py - 2, 24, 18, 0, Math.PI, 0);
        ctx.lineTo(px + 24, py + 2);
        ctx.quadraticCurveTo(px, py + 10, px - 24, py + 2);
        ctx.closePath();
        ctx.fill();
        // grass cap
        ctx.fillStyle = hsl(98, 40, 40);
        ctx.beginPath();
        ctx.ellipse(px, py - 12, 21, 9, 0, Math.PI, 0);
        ctx.quadraticCurveTo(px + 14, py - 6, px, py - 8);
        ctx.quadraticCurveTo(px - 14, py - 6, px - 21, py - 12);
        ctx.fill();
        // round door
        ctx.fillStyle = hsl(30, 25, 22);
        ctx.beginPath();
        ctx.arc(px - 3, py - 1, 9, Math.PI, 0);
        ctx.lineTo(px + 6, py + 3);
        ctx.lineTo(px - 12, py + 3);
        ctx.fill();
        ctx.fillStyle = hsl(140, 35, 30);
        ctx.beginPath();
        ctx.arc(px - 3, py - 1, 7, Math.PI, 0);
        ctx.lineTo(px + 4, py + 3);
        ctx.lineTo(px - 10, py + 3);
        ctx.fill();
        ctx.fillStyle = '#e8c35a';
        ctx.beginPath();
        ctx.arc(px + 1, py - 1, 1.2, 0, Math.PI * 2);
        ctx.fill();
        // window
        const lit = night && b.residents.length > 0;
        ctx.fillStyle = lit ? '#ffd982' : hsl(200, 20, 25);
        ctx.beginPath();
        ctx.arc(px + 12, py - 6, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hsl(30, 25, 22);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // chimney pipe with smoke
        ctx.fillStyle = hsl(20, 10, 35);
        ctx.fillRect(px + 9, py - 24, 4, 8);
        if (b.residents.length > 0) smoke(ctx, px + 11, py - 25, time, 0.5);
        break;
      }
      case 'hut': {
        shadow(ctx, px, py + 3, 18, 7);
        // walls
        ctx.fillStyle = hsl(32, 30, 55);
        ctx.beginPath();
        ctx.ellipse(px, py, 14, 7, 0, 0, Math.PI);
        ctx.lineTo(px - 14, py - 14);
        ctx.lineTo(px + 14, py - 14);
        ctx.lineTo(px + 14, py);
        ctx.fill();
        ctx.fillStyle = hsl(32, 30, 45);
        ctx.fillRect(px - 14, py - 14, 6, 14);
        // door
        ctx.fillStyle = hsl(25, 35, 26);
        ctx.beginPath();
        ctx.moveTo(px - 4, py + 6);
        ctx.lineTo(px - 4, py - 4);
        ctx.quadraticCurveTo(px + 1, py - 10, px + 6, py - 4);
        ctx.lineTo(px + 6, py + 6);
        ctx.fill();
        const lit = night && b.residents.length > 0;
        ctx.fillStyle = lit ? '#ffd982' : hsl(200, 20, 28);
        ctx.fillRect(px + 8, py - 9, 4, 4);
        // thatch roof
        ctx.fillStyle = hsl(42, 55, 52);
        ctx.beginPath();
        ctx.moveTo(px - 19, py - 12);
        ctx.quadraticCurveTo(px, py - 4, px + 19, py - 12);
        ctx.lineTo(px + 1, py - 38);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = hsl(40, 45, 40);
        ctx.lineWidth = 1;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(px + 1, py - 36);
          ctx.lineTo(px + i * 8, py - 9 + Math.abs(i) * -1.5);
          ctx.stroke();
        }
        if (b.residents.length > 0) smoke(ctx, px + 2, py - 38, time, 0.35);
        break;
      }
      case 'mushroom_patch': {
        // tilled plot
        ctx.fillStyle = hsl(28, 35, 28);
        ctx.beginPath();
        ctx.moveTo(px, py - HH * 0.7);
        ctx.lineTo(px + HW * 0.7, py);
        ctx.lineTo(px, py + HH * 0.7);
        ctx.lineTo(px - HW * 0.7, py);
        ctx.closePath();
        ctx.fill();
        const count = Math.ceil(b.growth * 7);
        const spots = [[-12, -1], [-4, -5], [5, -4], [12, 0], [-6, 4], [3, 5], [0, 0]];
        for (let i = 0; i < count; i++) {
          const [ox, oy] = spots[i];
          const s = 0.5 + b.growth * 0.6;
          ctx.fillStyle = '#efe6d2';
          ctx.fillRect(px + ox - 1.2 * s, py + oy - 5 * s, 2.4 * s, 5 * s);
          ctx.fillStyle = hsl(4, 70, 48);
          ctx.beginPath();
          ctx.ellipse(px + ox, py + oy - 5 * s, 4.5 * s, 3.2 * s, 0, Math.PI, 0);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillRect(px + ox - 1.5 * s, py + oy - 7 * s, 1.2, 1.2);
        }
        if (b.growth >= 1) sparkle(ctx, px, py - 14, time);
        break;
      }
      case 'berry_bush': {
        shadow(ctx, px, py + 2, 13, 5);
        ctx.fillStyle = hsl(120, 32, 28);
        ctx.beginPath();
        ctx.ellipse(px - 5, py - 7, 9, 7.5, 0, 0, Math.PI * 2);
        ctx.ellipse(px + 6, py - 8, 8, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hsl(120, 32, 36);
        ctx.beginPath();
        ctx.ellipse(px, py - 13, 8, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        const n = Math.floor(b.growth * 9);
        for (let i = 0; i < n; i++) {
          const a = i * 2.4;
          ctx.fillStyle = hsl(250 + (i % 3) * 30, 55, 45);
          ctx.beginPath();
          ctx.arc(px + Math.cos(a) * 9, py - 9 + Math.sin(a) * 5, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        if (b.growth >= 1) sparkle(ctx, px, py - 22, time);
        break;
      }
      case 'cookfire': {
        // stones
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.fillStyle = hsl(30, 6, 45 + (i % 2) * 8);
          ctx.beginPath();
          ctx.ellipse(px + Math.cos(a) * 11, py + Math.sin(a) * 5.5, 3.5, 2.4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // logs
        ctx.strokeStyle = hsl(25, 35, 25);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px - 6, py + 2);
        ctx.lineTo(px + 6, py - 2);
        ctx.moveTo(px - 6, py - 2);
        ctx.lineTo(px + 6, py + 2);
        ctx.stroke();
        // flames
        const f = Math.sin(time * 9) * 1.5;
        ctx.fillStyle = 'rgba(255,140,40,0.9)';
        ctx.beginPath();
        ctx.moveTo(px - 6, py);
        ctx.quadraticCurveTo(px - 4, py - 12 - f, px, py - 15 + f);
        ctx.quadraticCurveTo(px + 4, py - 10 + f, px + 6, py);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,220,90,0.95)';
        ctx.beginPath();
        ctx.moveTo(px - 3, py);
        ctx.quadraticCurveTo(px - 1, py - 7 + f, px, py - 9);
        ctx.quadraticCurveTo(px + 2, py - 6, px + 3, py);
        ctx.fill();
        // tripod & pot
        ctx.strokeStyle = hsl(25, 20, 22);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px - 12, py + 3);
        ctx.lineTo(px, py - 22);
        ctx.lineTo(px + 12, py + 3);
        ctx.moveTo(px, py - 22);
        ctx.lineTo(px, py - 15);
        ctx.stroke();
        ctx.fillStyle = hsl(0, 0, 18);
        ctx.beginPath();
        ctx.ellipse(px, py - 10, 7, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
        if (b.stew > 0) {
          ctx.fillStyle = hsl(30, 55, 40);
          ctx.beginPath();
          ctx.ellipse(px, py - 13.5, 5.5, 1.8, 0, 0, Math.PI * 2);
          ctx.fill();
          smoke(ctx, px, py - 16, time, 0.35, '230,230,230');
        }
        break;
      }
      case 'larder': {
        shadow(ctx, px, py + 3, 16, 6);
        ctx.fillStyle = hsl(25, 35, 30);
        ctx.beginPath();
        ctx.ellipse(px, py, 13, 6.5, 0, 0, Math.PI);
        ctx.lineTo(px - 13, py - 18);
        ctx.lineTo(px + 13, py - 18);
        ctx.closePath();
        ctx.fill();
        // bark lines
        ctx.strokeStyle = hsl(25, 35, 22);
        ctx.lineWidth = 1;
        for (const ox of [-9, -3, 8]) {
          ctx.beginPath();
          ctx.moveTo(px + ox, py - 17);
          ctx.lineTo(px + ox + 1, py + 3);
          ctx.stroke();
        }
        // top with rings
        ctx.fillStyle = hsl(35, 45, 58);
        ctx.beginPath();
        ctx.ellipse(px, py - 18, 13, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hsl(30, 40, 45);
        ctx.beginPath();
        ctx.ellipse(px, py - 18, 8, 4, 0, 0, Math.PI * 2);
        ctx.ellipse(px, py - 18, 3.5, 1.8, 0, 0, Math.PI * 2);
        ctx.stroke();
        // little door
        ctx.fillStyle = hsl(140, 30, 28);
        ctx.beginPath();
        ctx.arc(px + 3, py - 3, 4.5, Math.PI, 0);
        ctx.lineTo(px + 7.5, py + 4);
        ctx.lineTo(px - 1.5, py + 4);
        ctx.fill();
        // sacks according to stores
        const fill = Math.min(3, Math.ceil(world.food / 15));
        for (let i = 0; i < fill; i++) {
          ctx.fillStyle = hsl(40, 35, 62 - i * 4);
          ctx.beginPath();
          ctx.ellipse(px - 15 + i * 5, py + 4 - i, 3.5, 4.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // moss
        ctx.fillStyle = hsl(98, 40, 36);
        ctx.beginPath();
        ctx.ellipse(px - 9, py - 19, 5, 2.4, 0.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'lantern': {
        shadow(ctx, px, py + 1, 5, 2);
        ctx.strokeStyle = hsl(25, 30, 22);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px, py - 26);
        ctx.lineTo(px + 7, py - 26);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + 7, py - 26);
        ctx.lineTo(px + 7, py - 23);
        ctx.stroke();
        ctx.fillStyle = night ? '#ffd56e' : '#f4e1a6';
        ctx.fillRect(px + 4, py - 23, 6, 8);
        ctx.strokeStyle = hsl(25, 30, 22);
        ctx.strokeRect(px + 4, py - 23, 6, 8);
        break;
      }
      case 'flower_bed': {
        ctx.fillStyle = hsl(28, 40, 30);
        ctx.strokeStyle = hsl(28, 40, 45);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py - HH * 0.6);
        ctx.lineTo(px + HW * 0.6, py);
        ctx.lineTo(px, py + HH * 0.6);
        ctx.lineTo(px - HW * 0.6, py);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        const hues = [350, 45, 290, 20, 200, 330];
        for (let i = 0; i < 9; i++) {
          const fx = px + ((i % 3) - 1) * 9 + ((Math.floor(i / 3) - 1) * -6);
          const fy = py + (Math.floor(i / 3) - 1) * 4 + ((i % 3) - 1) * 2 - 1;
          ctx.fillStyle = hsl(110, 40, 30);
          ctx.fillRect(fx - 0.5, fy - 4, 1, 4);
          ctx.fillStyle = hsl(hues[i % hues.length], 80, 66);
          ctx.beginPath();
          ctx.arc(fx, fy - 5, 2.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffe9a0';
          ctx.fillRect(fx - 0.5, fy - 5.5, 1, 1);
        }
        break;
      }
      case 'fence': {
        ctx.strokeStyle = hsl(32, 35, 62);
        ctx.fillStyle = hsl(32, 35, 68);
        ctx.lineWidth = 1.6;
        const posts: [number, number][] = [[-HW * 0.8, 0], [-HW * 0.4, -HH * 0.4], [0, -HH * 0.8], [HW * 0.4, -HH * 0.4], [HW * 0.8, 0]];
        ctx.beginPath();
        ctx.moveTo(px + posts[0][0], py + posts[0][1] - 4);
        for (const [ox, oy] of posts) ctx.lineTo(px + ox, py + oy - 4);
        ctx.moveTo(px + posts[0][0], py + posts[0][1] - 8);
        for (const [ox, oy] of posts) ctx.lineTo(px + ox, py + oy - 8);
        ctx.stroke();
        for (const [ox, oy] of posts) {
          ctx.fillRect(px + ox - 1.5, py + oy - 11, 3, 11);
          ctx.beginPath();
          ctx.moveTo(px + ox - 1.5, py + oy - 11);
          ctx.lineTo(px + ox, py + oy - 13);
          ctx.lineTo(px + ox + 1.5, py + oy - 11);
          ctx.fill();
        }
        break;
      }
    }
  }

  // ----- goblins ---------------------------------------------------------------

  private drawGoblin(ctx: CanvasRenderingContext2D, g: Goblin, rs: RenderState, world: World) {
    const { px, py } = project(g.x, g.y, g.z);
    const L = g.look;
    const s = L.height;
    const a = g.action;
    const moving = g.path.length > 0;
    const asleep = a.type === 'sleep' && a.arrived;
    const skin = hsl(L.skinHue, 42, L.skinLight);
    const skinDark = hsl(L.skinHue, 42, L.skinLight - 10);
    const tunic = hsl(L.tunicHue, 38, 42);
    const t = rs.time + g.id * 0.37;
    const bob = moving ? Math.abs(Math.sin(t * 9)) * 1.6 : Math.sin(t * 1.6) * 0.4;

    if (rs.selectedGoblin === g.id) {
      ctx.strokeStyle = 'rgba(255,225,120,0.95)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(px, py, 10, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    shadow(ctx, px, py, 6.5, 2.8);

    if (asleep) {
      // curled up on the ground
      ctx.fillStyle = tunic;
      ctx.beginPath();
      ctx.ellipse(px, py - 3, 8, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(px + 7 * g.facing, py - 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = 'bold 7px sans-serif';
      const z = (t * 0.8) % 1;
      ctx.globalAlpha = 1 - z;
      ctx.fillText('z', px + 9, py - 10 - z * 10);
      ctx.globalAlpha = 1;
      return;
    }

    const f = g.facing;
    const base = py - bob;
    const sitting = a.arrived && (a.type === 'leisure' || a.type === 'sulk' || a.type === 'eat');
    const legLen = sitting ? 1 : 5;
    // legs
    ctx.strokeStyle = hsl(25, 25, 22);
    ctx.lineWidth = 2;
    const step = moving ? Math.sin(t * 9) * 2 : 0;
    ctx.beginPath();
    ctx.moveTo(px - 2, base - legLen);
    ctx.lineTo(px - 2 + step, base);
    ctx.moveTo(px + 2, base - legLen);
    ctx.lineTo(px + 2 - step, base);
    ctx.stroke();
    // body / tunic
    const bodyTop = base - legLen - 10 * s;
    ctx.fillStyle = tunic;
    ctx.beginPath();
    ctx.moveTo(px - 4.5, base - legLen);
    ctx.lineTo(px - 3.5, bodyTop + 2);
    ctx.quadraticCurveTo(px, bodyTop - 1, px + 3.5, bodyTop + 2);
    ctx.lineTo(px + 4.5, base - legLen);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = hsl(30, 35, 30);
    ctx.fillRect(px - 4.3, base - legLen - 4, 8.6, 1.4);
    // arms
    ctx.strokeStyle = skin;
    ctx.lineWidth = 1.8;
    const working = a.arrived && (a.type === 'build' || a.type === 'harvest' || a.type === 'cook');
    const wave = working ? Math.sin(t * 10) * 3 : a.type === 'chat' && a.arrived ? Math.sin(t * 4) * 2 : 0;
    ctx.beginPath();
    ctx.moveTo(px - 3.5, bodyTop + 3);
    ctx.lineTo(px - 6, bodyTop + 8 + (f < 0 ? wave : 0));
    ctx.moveTo(px + 3.5, bodyTop + 3);
    ctx.lineTo(px + 6 + (working ? 1 : 0), bodyTop + 8 + (f > 0 ? wave : 0));
    ctx.stroke();
    // carried basket
    if (g.carrying > 0) {
      ctx.fillStyle = hsl(35, 50, 45);
      ctx.fillRect(px + 4 * f - 3, bodyTop + 6, 6, 4);
      ctx.fillStyle = hsl(4, 70, 50);
      ctx.beginPath();
      ctx.arc(px + 4 * f, bodyTop + 6, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // head
    const hy = bodyTop - 5 * s;
    const hr = 5.2 * s;
    const ear = 5.5 * L.earSize;
    ctx.fillStyle = skinDark;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(px + side * hr * 0.7, hy - 1.5);
      ctx.lineTo(px + side * (hr + ear), hy - 3 - ear * 0.35);
      ctx.lineTo(px + side * hr * 0.6, hy + 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(px, hy, hr, 0, Math.PI * 2);
    ctx.fill();
    // face
    const blink = Math.sin(t * 0.9) > 0.97;
    const eyeX = 1.8 * f;
    ctx.fillStyle = '#1b1a14';
    if (blink || a.type === 'sulk') {
      ctx.fillRect(px - 2.4 + eyeX, hy - 0.5, 1.8, 0.8);
      ctx.fillRect(px + 0.8 + eyeX, hy - 0.5, 1.8, 0.8);
    } else {
      ctx.fillStyle = '#fff6c8';
      ctx.fillRect(px - 2.6 + eyeX, hy - 1.4, 2, 2);
      ctx.fillRect(px + 0.8 + eyeX, hy - 1.4, 2, 2);
      ctx.fillStyle = '#1b1a14';
      ctx.fillRect(px - 2 + eyeX + f * 0.4, hy - 0.9, 1, 1.2);
      ctx.fillRect(px + 1.4 + eyeX + f * 0.4, hy - 0.9, 1, 1.2);
    }
    // nose
    ctx.fillStyle = skinDark;
    ctx.beginPath();
    ctx.ellipse(px + 2.6 * f, hy + 1.2, 1.6, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // mouth: smile scales with mood
    ctx.strokeStyle = '#2a1d14';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    const smile = (g.mood - 45) / 55;
    ctx.moveTo(px - 1.2 + f, hy + 3);
    ctx.quadraticCurveTo(px + f * 0.5, hy + 3 + smile * 1.6, px + 1.8 + f, hy + 3);
    ctx.stroke();
    // hat
    const hatC = hsl(L.hatHue, 45, 40);
    switch (L.hat) {
      case 'cap':
        ctx.fillStyle = hatC;
        ctx.beginPath();
        ctx.arc(px, hy - 1.5, hr * 0.95, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(px + (f > 0 ? 0 : -6), hy - 2, 6, 1.6);
        break;
      case 'pointy':
        ctx.fillStyle = hatC;
        ctx.beginPath();
        ctx.moveTo(px - hr, hy - 2);
        ctx.lineTo(px + hr, hy - 2);
        ctx.lineTo(px - 4 * f, hy - 15);
        ctx.closePath();
        ctx.fill();
        break;
      case 'leaf':
        ctx.fillStyle = hsl(110, 45, 38);
        ctx.beginPath();
        ctx.ellipse(px + 1, hy - hr, 5, 2.2, -0.5 * f, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hsl(110, 45, 25);
        ctx.beginPath();
        ctx.moveTo(px - 2, hy - hr + 1.5);
        ctx.lineTo(px + 4, hy - hr - 1.5);
        ctx.stroke();
        break;
      case 'mushroom':
        ctx.fillStyle = hsl(4, 65, 48);
        ctx.beginPath();
        ctx.ellipse(px, hy - 3.5, hr + 2.5, 4.5, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(px - 3, hy - 6, 1.5, 1.5);
        ctx.fillRect(px + 2, hy - 5, 1.5, 1.5);
        break;
      default:
        // tuft of hair
        ctx.strokeStyle = hsl(30, 30, 20);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, hy - hr + 0.5);
        ctx.lineTo(px - 1.5, hy - hr - 2.5);
        ctx.moveTo(px + 0.5, hy - hr + 0.5);
        ctx.lineTo(px + 2, hy - hr - 2);
        ctx.stroke();
    }

    // little activity bubble
    const icon = activityIcon(g);
    if (icon) {
      const bx = px + 9 * f;
      const by = hy - 12;
      ctx.fillStyle = 'rgba(255,250,235,0.92)';
      ctx.beginPath();
      ctx.ellipse(bx, by, 6.5, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = icon.color;
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon.text, bx, by + 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    void world;
  }

  private drawNameTag(ctx: CanvasRenderingContext2D, g: Goblin, zoom: number) {
    const { px, py } = project(g.x, g.y, g.z);
    const label = g.name;
    const fs = 11 / Math.max(0.8, zoom);
    ctx.font = `700 ${fs}px 'Nunito Variable', sans-serif`;
    const w = ctx.measureText(label).width + 10 / zoom;
    const y = py - 42;
    ctx.fillStyle = 'rgba(40,30,20,0.85)';
    roundRect(ctx, px - w / 2, y - fs, w, fs * 1.5, 4 / zoom);
    ctx.fill();
    ctx.fillStyle = '#fbe9c3';
    ctx.textAlign = 'center';
    ctx.fillText(label, px, y);
    ctx.textAlign = 'left';
  }

  // ----- lighting -------------------------------------------------------------

  private drawLighting(ctx: CanvasRenderingContext2D, world: World, cam: Camera, W: number, H: number, dark: number, time: number) {
    if (!this.lightCanvas) this.lightCanvas = document.createElement('canvas');
    const lc = this.lightCanvas;
    if (lc.width !== W || lc.height !== H) {
      lc.width = W;
      lc.height = H;
    }
    const l = lc.getContext('2d')!;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, W, H);
    l.fillStyle = `rgba(12,16,48,${dark})`;
    l.fillRect(0, 0, W, H);
    l.globalCompositeOperation = 'destination-out';
    const lights: { x: number; y: number; r: number; warm: number }[] = [];
    for (const b of world.buildings) {
      if (b.built < 1) continue;
      const e = world.tiles[b.y][b.x].elevation;
      const { px, py } = project(b.x, b.y, e);
      const flick = 1 + Math.sin(time * 7 + b.id) * 0.04;
      if (b.kind === 'lantern') lights.push({ x: px + 7, y: py - 19, r: 95 * flick, warm: 1 });
      else if (b.kind === 'cookfire') lights.push({ x: px, y: py - 6, r: 120 * flick, warm: 1 });
      else if ((b.kind === 'burrow' || b.kind === 'hut') && b.residents.length > 0) lights.push({ x: px + 10, y: py - 6, r: 38, warm: 0.6 });
    }
    for (const lt of lights) {
      const s = toScreen(cam, W, H, lt.x, lt.y);
      const r = lt.r * cam.zoom;
      if (s.sx < -r || s.sy < -r || s.sx > W + r || s.sy > H + r) continue;
      const grad = l.createRadialGradient(s.sx, s.sy, 0, s.sx, s.sy, r);
      grad.addColorStop(0, 'rgba(0,0,0,0.95)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.5)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = grad;
      l.beginPath();
      l.arc(s.sx, s.sy, r, 0, Math.PI * 2);
      l.fill();
    }
    ctx.drawImage(lc, 0, 0);
    // warm glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const lt of lights) {
      const s = toScreen(cam, W, H, lt.x, lt.y);
      const r = lt.r * 0.7 * cam.zoom;
      const grad = ctx.createRadialGradient(s.sx, s.sy, 0, s.sx, s.sy, r);
      grad.addColorStop(0, `rgba(255,160,60,${0.42 * lt.warm * dark})`);
      grad.addColorStop(1, 'rgba(255,170,70,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // fireflies over meadows and water at night
    if (dark > 0.35) {
      for (let i = 0; i < 40; i++) {
        const fx = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const fy = (Math.sin(i * 78.233) * 12345.678) % 1;
        const tx = Math.abs(fx) * world.width;
        const ty = world.height * 0.45 + Math.abs(fy) * world.height * 0.55;
        const { px, py } = project(tx + Math.sin(time * 0.5 + i) * 0.6, ty + Math.cos(time * 0.4 + i) * 0.6, 0.6);
        const s = toScreen(cam, W, H, px, py);
        const glow = (Math.sin(time * 2 + i * 1.7) + 1) / 2;
        ctx.fillStyle = `rgba(220,255,140,${glow * 0.8})`;
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, 1.6 * cam.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// small drawing helpers
// ---------------------------------------------------------------------------

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.fillStyle = 'rgba(20,30,10,0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function smoke(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, alpha: number, rgb = '200,200,200') {
  for (let i = 0; i < 3; i++) {
    const p = (time * 0.4 + i / 3) % 1;
    ctx.fillStyle = `rgba(${rgb},${alpha * (1 - p)})`;
    ctx.beginPath();
    ctx.arc(x + Math.sin(p * 6 + i) * 3 + p * 4, y - p * 18, 2 + p * 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
  const a = (Math.sin(time * 4) + 1) / 2;
  ctx.fillStyle = `rgba(255,245,180,${0.4 + a * 0.6})`;
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x + 1.2, y - 1.2);
  ctx.lineTo(x + 4, y);
  ctx.lineTo(x + 1.2, y + 1.2);
  ctx.lineTo(x, y + 4);
  ctx.lineTo(x - 1.2, y + 1.2);
  ctx.lineTo(x - 4, y);
  ctx.lineTo(x - 1.2, y - 1.2);
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function activityIcon(g: Goblin): { text: string; color: string } | null {
  const a = g.action;
  if (a.arrived) {
    switch (a.type) {
      case 'chat': return { text: '…', color: '#6b4f2c' };
      case 'leisure': return { text: '♪', color: '#3f7a4a' };
      case 'eat': return { text: '◡', color: '#a0522d' };
      case 'sulk': return { text: '~', color: '#5b6aa0' };
      case 'cook': return { text: '♨', color: '#c2552b' };
      default: break;
    }
  }
  if (g.needs.hunger < 20) return { text: '!', color: '#c0392b' };
  if (g.needs.rest < 15) return { text: 'z', color: '#5b6aa0' };
  return null;
}

export { buildingById };
