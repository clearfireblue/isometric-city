/**
 * Goblin Hollow simulation.
 *
 * Goblins are driven by four needs (hunger, rest, social, fun). Each goblin
 * periodically scores the things it could do — eat, sleep, find someone to
 * chat with, go do something nice, or pitch in on village work — and picks
 * the most pressing one. Mood is a blend of needs plus short-lived moodlets
 * ("Ate a warm stew", "Slept on the cold ground") and feeds back into how
 * hard they work and whether new goblins want to move in.
 */
import type { GridPosition } from '@/core/types';
import type {
  Action, ActionType, Building, BuildingKind, Goblin, LeisureKind, LogEntry, NeedKey, World,
} from './types';
import {
  BUILDINGS, FOOD_BASE_CAPACITY, FOOD_PER_LARDER, MINUTES_PER_DAY, STEW_MAX, isLand, placementError,
} from './catalog';
import { findPath, walkable } from './pathfinding';
import { makeRng, pick, Rng } from './rng';
import { makeGoblin } from './goblin';
import { newBuilding } from './worldgen';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const DECAY: Record<NeedKey, number> = { hunger: 0.1, rest: 0.072, social: 0.07, fun: 0.055 };
const WALK_SPEED = 0.17; // tiles per game minute
const MAX_POP = 40;

const GROWTH_RATE: Partial<Record<BuildingKind, number>> = {
  mushroom_patch: 1 / 620,
  berry_bush: 1 / 1000,
};
const HARVEST_YIELD: Partial<Record<BuildingKind, number>> = { mushroom_patch: 6, berry_bush: 9 };

export const NEED_LABEL: Record<NeedKey, string> = {
  hunger: 'Fed', rest: 'Rested', social: 'Company', fun: 'Fun',
};

const LEISURE_TEXT: Record<LeisureKind, { doing: string; moodlet: string }> = {
  cloudwatch: { doing: 'Watching the clouds from the hilltop', moodlet: 'Watched the clouds roll by' },
  stream: { doing: 'Dangling toes in the stream', moodlet: 'Paddled in the stream' },
  flowers: { doing: 'Sniffing the flowers', moodlet: 'Stopped to smell the flowers' },
  lanterns: { doing: 'Basking in the lantern glow', moodlet: 'Lingered in the lantern light' },
  nap: { doing: 'Napping in the grass', moodlet: 'Had a lovely nap in the sun' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function hourOf(minute: number): number {
  return (minute % MINUTES_PER_DAY) / 60;
}
export function dayOf(minute: number): number {
  return Math.floor(minute / MINUTES_PER_DAY) + 1;
}
export function isNight(minute: number): boolean {
  const h = hourOf(minute);
  return h >= 21 || h < 5.5;
}
export function clockLabel(minute: number): string {
  const h = Math.floor(hourOf(minute));
  const m = Math.floor(minute % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

const indexCache = new WeakMap<Building[], Map<number, Building>>();
export function buildingById(world: World, id: number | null): Building | undefined {
  if (id === null) return undefined;
  let idx = indexCache.get(world.buildings);
  if (!idx) {
    idx = new Map(world.buildings.map((b) => [b.id, b]));
    indexCache.set(world.buildings, idx);
  }
  return idx.get(id);
}
export function goblinById(world: World, id: number | null): Goblin | undefined {
  return id === null ? undefined : world.goblins.find((g) => g.id === id);
}

export function foodCapacity(world: World): number {
  return FOOD_BASE_CAPACITY + FOOD_PER_LARDER * world.buildings.filter((b) => b.kind === 'larder' && b.built >= 1).length;
}

export function totalStew(world: World): number {
  return world.buildings.reduce((s, b) => s + (b.kind === 'cookfire' ? b.stew : 0), 0);
}

export function freeBeds(world: World): number {
  return world.buildings.reduce((s, b) => {
    const cap = BUILDINGS[b.kind].capacity;
    return cap && b.built >= 1 ? s + cap - b.residents.length : s;
  }, 0);
}

export function moodLabel(mood: number): string {
  if (mood < 20) return 'Miserable';
  if (mood < 40) return 'Glum';
  if (mood < 60) return 'Content';
  if (mood < 80) return 'Happy';
  return 'Delighted';
}

export function averageMood(world: World): number {
  if (world.goblins.length === 0) return 0;
  return world.goblins.reduce((s, g) => s + g.mood, 0) / world.goblins.length;
}

/** Beauty of the area around a tile (flowers, decor, trees, paths). */
export function beautyAt(world: World, cx: number, cy: number, r = 2): number {
  let sum = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const t = world.tiles[y]?.[x];
      if (!t) continue;
      if (t.feature === 'flowers') sum += 1;
      else if (t.feature === 'tree' || t.feature === 'pine') sum += 0.4;
      if (t.path) sum += 0.3;
      if (t.terrain === 'water') sum += 0.3;
      const b = buildingById(world, t.buildingId);
      if (b && b.built >= 1) sum += BUILDINGS[b.kind].beauty;
    }
  }
  return sum;
}

function log(world: World, text: string, tone: LogEntry['tone'] = 'neutral', goblinId?: number) {
  world.log.push({ id: world.nextId++, minute: world.minute, text, tone, goblinId });
  if (world.log.length > 200) world.log.splice(0, world.log.length - 200);
}

function addMoodlet(g: Goblin, world: World, id: string, label: string, value: number, hours: number) {
  const existing = g.moodlets.find((m) => m.id === id);
  const until = world.minute + hours * 60;
  if (existing) {
    existing.until = until;
    existing.value = value;
    existing.label = label;
  } else {
    g.moodlets.push({ id, label, value, until });
  }
}

function removeMoodlet(g: Goblin, id: string) {
  g.moodlets = g.moodlets.filter((m) => m.id !== id);
}

function idleAction(): Action {
  return { type: 'idle', targetId: null, dest: null, elapsed: 0, duration: 0, arrived: false };
}

function tileOf(g: Goblin): GridPosition {
  return { x: Math.round(g.x), y: Math.round(g.y) };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class Hollow {
  world: World;
  private rng: Rng;
  /** bumps whenever the map changes, so the renderer can rebuild caches */
  mapVersion = 0;

  constructor(world: World) {
    this.world = world;
    this.rng = makeRng((world.seed ^ Math.floor(world.minute)) >>> 0);
  }

  // ----- player actions ----------------------------------------------------

  place(kind: BuildingKind, x: number, y: number): string | null {
    const tile = this.world.tiles[y]?.[x];
    if (!tile) return 'Off the map';
    const err = placementError(kind, tile);
    if (err) return err;
    if (tile.feature === 'shrub' || tile.feature === 'flowers') tile.feature = null;
    const b = newBuilding(this.world, kind, x, y, 0);
    this.world.buildings = [...this.world.buildings.filter((bb) => bb !== b), b];
    this.mapVersion++;
    return null;
  }

  paintPath(x: number, y: number): string | null {
    const tile = this.world.tiles[y]?.[x];
    if (!tile) return 'Off the map';
    if (!isLand(tile) && tile.terrain !== 'ford') return 'Paths cannot cross deep water';
    if (tile.feature === 'tree' || tile.feature === 'pine' || tile.feature === 'boulder') return 'Clear the tree or rock first';
    if (tile.path) return null;
    tile.path = true;
    if (tile.feature) tile.feature = null;
    this.mapVersion++;
    return null;
  }

  clear(x: number, y: number): string | null {
    const tile = this.world.tiles[y]?.[x];
    if (!tile) return 'Off the map';
    const b = buildingById(this.world, tile.buildingId);
    if (b) {
      if (b.name === 'Old Stump') return 'The Old Stump is too beloved to remove';
      for (const gid of b.residents) {
        const g = goblinById(this.world, gid);
        if (g) {
          g.homeId = null;
          addMoodlet(g, this.world, 'lost_home', 'Their home was torn down', -10, 24);
        }
      }
      for (const g of this.world.goblins) {
        if (g.action.targetId === b.id) this.interrupt(g);
      }
      this.world.buildings = this.world.buildings.filter((bb) => bb.id !== b.id);
      tile.buildingId = null;
      this.mapVersion++;
      return null;
    }
    if (tile.feature) {
      tile.feature = null;
      this.mapVersion++;
      return null;
    }
    if (tile.path) {
      tile.path = false;
      this.mapVersion++;
      return null;
    }
    return 'Nothing to clear';
  }

  // ----- main loop ---------------------------------------------------------

  /** Advance the simulation by `dt` game minutes. */
  update(dt: number) {
    const w = this.world;
    const prevHour = Math.floor(w.minute / 60);
    w.minute += dt;
    const hourTicked = Math.floor(w.minute / 60) !== prevHour;

    for (const b of w.buildings) {
      const rate = GROWTH_RATE[b.kind];
      if (rate && b.built >= 1) b.growth = Math.min(1, b.growth + rate * dt);
    }

    for (const g of w.goblins) this.updateGoblin(g, dt);

    if (hourTicked) this.hourly();
  }

  private hourly() {
    const w = this.world;
    const hour = Math.floor(hourOf(w.minute));
    this.assignHomes();
    for (const g of w.goblins) {
      g.moodlets = g.moodlets.filter((m) => m.until > w.minute);
      if (g.homeId === null) addMoodlet(g, w, 'homeless', 'Has no home to call their own', -6, 2);
      else {
        removeMoodlet(g, 'homeless');
        const home = buildingById(w, g.homeId);
        if (home) {
          const beauty = beautyAt(w, home.x, home.y, 2);
          if (beauty >= 6) addMoodlet(g, w, 'pretty', 'Lives somewhere lovely', Math.min(8, Math.round(beauty / 2)), 2);
          else removeMoodlet(g, 'pretty');
        }
      }
    }
    if (hour === 7) this.maybeImmigrate();
  }

  private assignHomes() {
    const w = this.world;
    const homes = w.buildings
      .filter((b) => BUILDINGS[b.kind].capacity && b.built >= 1)
      .sort((a, b) => (a.kind === 'burrow' ? -1 : 0) - (b.kind === 'burrow' ? -1 : 0));
    for (const g of w.goblins) {
      if (g.homeId !== null) continue;
      const home = homes.find((h) => h.residents.length < (BUILDINGS[h.kind].capacity ?? 0));
      if (!home) break;
      home.residents.push(g.id);
      g.homeId = home.id;
      addMoodlet(g, w, 'new_home', `Moved into a cosy ${BUILDINGS[home.kind].label.toLowerCase()}`, 8, 24);
      removeMoodlet(g, 'homeless');
      log(w, `${g.name} moved into a ${BUILDINGS[home.kind].label.toLowerCase()}.`, 'good', g.id);
    }
  }

  private maybeImmigrate() {
    const w = this.world;
    if (w.goblins.length >= MAX_POP) return;
    if (freeBeds(w) <= 0) return;
    if (averageMood(w) < 50) return;
    if (w.food + totalStew(w) < 6) return;
    // find a walkable edge tile on the valley side
    for (let tries = 0; tries < 40; tries++) {
      const edge = Math.floor(this.rng() * w.width);
      const side = this.rng() < 0.5;
      const x = side ? w.width - 1 : edge;
      const y = side ? edge : w.height - 1;
      if (!walkable(w, x, y) || w.tiles[y][x].terrain === 'ford') continue;
      const g = makeGoblin(w, this.rng, x, y);
      g.thought = 'Following the smell of stew…';
      w.goblins.push(g);
      const reasons = ['drawn by the smell of stew', 'following the lantern light', 'hearing tales of a friendly hollow', 'chasing a runaway frog', 'looking for somewhere cosy'];
      log(w, `${g.name} wandered in, ${pick(this.rng, reasons)}.`, 'good', g.id);
      return;
    }
  }

  // ----- per goblin ----------------------------------------------------------

  private updateGoblin(g: Goblin, dt: number) {
    const w = this.world;
    const a = g.action;
    g.anim += dt;

    // needs decay (slower while asleep)
    const asleep = a.type === 'sleep' && a.arrived;
    for (const k of Object.keys(DECAY) as NeedKey[]) {
      let rate = DECAY[k];
      if (asleep && k !== 'rest') rate *= 0.4;
      if (k === 'rest' && asleep) continue;
      g.needs[k] = clamp(g.needs[k] - rate * dt);
    }

    this.updateMood(g, dt);

    // walk
    if (g.path.length > 0) {
      this.walk(g, dt);
    } else if (a.dest && !a.arrived) {
      a.arrived = true;
      this.onArrive(g);
    }

    if (a.arrived) this.perform(g, dt);

    // ease visual elevation toward the ground under us
    const t = w.tiles[Math.round(g.y)]?.[Math.round(g.x)];
    if (t) g.z += (t.elevation - g.z) * Math.min(1, dt * 0.6);

    // urgent interruptions
    if (a.type !== 'sleep' && a.type !== 'eat' && (g.needs.hunger < 12 || g.needs.rest < 8)) {
      if (w.minute >= g.nextThink) this.interrupt(g);
    }

    if (g.action.type === 'idle' && w.minute >= g.nextThink) this.think(g);
  }

  private updateMood(g: Goblin, dt: number) {
    const w = this.world;
    const n = g.needs;
    // state moodlets
    const flags: [boolean, string, string, number][] = [
      [n.hunger < 6, 'starving', 'Ravenous', -15],
      [n.rest < 6, 'exhausted', 'Dead on their feet', -10],
      [n.social < 15, 'lonely', 'Feeling lonely', -6],
      [n.fun < 15, 'bored', 'Bored stiff', -4],
    ];
    for (const [on, id, label, v] of flags) {
      if (on) addMoodlet(g, w, id, label, v, 0.5);
    }
    const needsAvg = n.hunger * 0.3 + n.rest * 0.3 + n.social * 0.2 + n.fun * 0.2;
    const moodletSum = g.moodlets.reduce((s, m) => (m.until > w.minute ? s + m.value : s), 0);
    const target = clamp(needsAvg * 0.72 + 4 + moodletSum);
    g.mood += (target - g.mood) * Math.min(1, dt * 0.03);
  }

  private walk(g: Goblin, dt: number) {
    const w = this.world;
    let budget = dt;
    while (budget > 0 && g.path.length > 0) {
      const next = g.path[0];
      const tile = w.tiles[next.y][next.x];
      let speed = WALK_SPEED * (0.85 + g.mood / 400);
      if (tile.path) speed *= 1.6;
      if (tile.terrain === 'ford') speed *= 0.5;
      if (!walkable(w, next.x, next.y) && g.path.length > 1) {
        // something got built in the way — re-path
        this.repath(g);
        return;
      }
      const dx = next.x - g.x;
      const dy = next.y - g.y;
      const d = Math.hypot(dx, dy);
      const step = speed * budget;
      if ((dx - dy) !== 0) g.facing = dx - dy > 0 ? 1 : -1;
      if (d <= step) {
        g.x = next.x;
        g.y = next.y;
        g.path.shift();
        budget -= d / speed;
      } else {
        g.x += (dx / d) * step;
        g.y += (dy / d) * step;
        budget = 0;
      }
    }
  }

  private repath(g: Goblin) {
    const a = g.action;
    if (!a.dest) {
      g.path = [];
      return;
    }
    const p = findPath(this.world, tileOf(g), a.dest, a.type === 'build');
    if (p === null) this.interrupt(g);
    else g.path = p;
  }

  private goTo(g: Goblin, type: ActionType, dest: GridPosition, opts: Partial<Action> = {}): boolean {
    const p = findPath(this.world, tileOf(g), dest);
    if (p === null) return false;
    g.path = p;
    g.action = {
      type, targetId: null, dest, elapsed: 0, duration: 0, arrived: false, ...opts,
    };
    return true;
  }

  interrupt(g: Goblin) {
    const b = buildingById(this.world, g.action.targetId);
    if (b && b.reservedBy === g.id) b.reservedBy = null;
    if (g.action.type === 'chat') {
      const other = goblinById(this.world, g.action.targetId);
      if (other && other.action.type === 'chat' && other.action.targetId === g.id) {
        other.action = idleAction();
        other.path = [];
      }
    }
    g.action = idleAction();
    g.path = [];
    g.nextThink = this.world.minute;
  }

  private finish(g: Goblin, pause = 3) {
    const b = buildingById(this.world, g.action.targetId);
    if (b && b.reservedBy === g.id) b.reservedBy = null;
    g.action = idleAction();
    g.path = [];
    g.nextThink = this.world.minute + pause * this.rng();
  }

  // ----- deciding ------------------------------------------------------------

  private think(g: Goblin) {
    const w = this.world;
    const n = g.needs;
    const night = isNight(w.minute);
    const hour = hourOf(w.minute);
    const jitter = () => (this.rng() - 0.5) * 12;

    const options: [number, () => boolean][] = [];

    // sleep
    let sleepScore = (100 - n.rest) * 0.45;
    if (n.rest < 25) sleepScore = 92;
    else if (night && n.rest < 85) sleepScore = 75 + (85 - n.rest) * 0.3;
    else if (!night && n.rest > 30) sleepScore *= 0.3;
    options.push([sleepScore + jitter(), () => this.startSleep(g)]);

    // eat
    let eatScore = (100 - n.hunger) * 0.4;
    if (n.hunger < 30) eatScore = 88 + (30 - n.hunger);
    const mealTime = [7.5, 12.5, 18.5].some((m) => Math.abs(hour - m) < 1);
    if (mealTime && n.hunger < 75) eatScore += 25;
    options.push([eatScore + jitter(), () => this.startEat(g)]);

    // sulk when miserable
    if (g.mood < 22) options.push([62 + jitter(), () => this.startSulk(g)]);

    // work
    const workScore = night ? 8 : 42 + (g.mood - 50) * 0.3;
    options.push([workScore + jitter(), () => this.startWork(g)]);

    // social & fun
    options.push([(100 - n.social) * 0.65 + jitter(), () => this.startChat(g)]);
    options.push([(100 - n.fun) * 0.6 + jitter(), () => this.startLeisure(g)]);

    options.sort((a, b) => b[0] - a[0]);
    for (const [, start] of options) {
      if (start()) return;
    }
    this.startWander(g);
  }

  private startSleep(g: Goblin): boolean {
    const w = this.world;
    const home = buildingById(w, g.homeId);
    if (home && home.built >= 1 && this.goTo(g, 'sleep', { x: home.x, y: home.y }, { targetId: home.id, atHome: true })) {
      g.thought = 'Heading home for a good kip';
      return true;
    }
    // sleep rough near the fire or wherever
    const fire = this.nearest(g, (b) => b.kind === 'cookfire' && b.built >= 1);
    const spot = fire ? this.freeNeighbour(fire.x, fire.y, 2) : tileOf(g);
    if (spot && this.goTo(g, 'sleep', spot, { atHome: false })) {
      g.thought = home ? 'Too tired to walk home' : isNight(w.minute) ? 'Curling up under the stars (no home yet)' : 'Dozing off in the grass (no home yet)';
      return true;
    }
    return false;
  }

  private startEat(g: Goblin): boolean {
    const w = this.world;
    const fire = this.nearest(g, (b) => b.kind === 'cookfire' && b.built >= 1 && b.stew > 0);
    if (fire) {
      const spot = this.freeNeighbour(fire.x, fire.y, 1) ?? { x: fire.x, y: fire.y };
      if (this.goTo(g, 'eat', spot, { targetId: fire.id, meal: 'stew', duration: 25 })) {
        g.thought = 'Off for a bowl of stew';
        return true;
      }
    }
    if (w.food >= 1) {
      const store = this.nearest(g, (b) => (b.kind === 'larder' || b.kind === 'cookfire') && b.built >= 1);
      if (store) {
        const spot = this.freeNeighbour(store.x, store.y, 1) ?? { x: store.x, y: store.y };
        if (this.goTo(g, 'eat', spot, { targetId: store.id, meal: 'raw', duration: 20 })) {
          g.thought = 'Grabbing a snack from the stores';
          return true;
        }
      }
    }
    // forage when the stores are empty
    if (g.needs.hunger < 45) {
      const spot = this.randomTileNear(g.x, g.y, 6, (t) => isLand(t) && (t.feature === 'shrub' || t.terrain === 'meadow' || t.feature === 'tree'));
      if (spot && this.goTo(g, 'eat', spot, { meal: undefined, duration: 35 })) {
        g.thought = 'Rummaging for grubs and berries — the stores are bare';
        return true;
      }
    }
    return false;
  }

  private startSulk(g: Goblin): boolean {
    const spot = this.randomTileNear(g.x, g.y, 7, (t) => isLand(t) && t.buildingId === null);
    if (!spot) return false;
    if (!this.goTo(g, 'sulk', spot, { duration: 50 })) return false;
    g.thought = 'Wants to be left alone for a bit';
    return true;
  }

  private startWork(g: Goblin): boolean {
    const w = this.world;
    const free = (b: Building) => b.reservedBy === null || b.reservedBy === g.id;
    const fires = (b: Building) => b.kind === 'cookfire' && b.built >= 1 && free(b);

    // deliver anything we're carrying first
    if (g.carrying > 0) return this.startDeposit(g);

    // keep a pot going if stew is low
    const lowFire = this.nearest(g, (b) => fires(b) && b.stew < 3 && w.food >= 3);
    if (lowFire && this.reserveAndGo(g, lowFire, 'cook', 30, 'Stirring a fresh pot of stew')) return true;

    const ripe = this.nearest(g, (b) => (b.kind === 'mushroom_patch' || b.kind === 'berry_bush') && b.built >= 1 && b.growth >= 1 && free(b));
    if (ripe && w.food < foodCapacity(w) && this.reserveAndGo(g, ripe, 'harvest', 20, `Picking ${ripe.kind === 'berry_bush' ? 'berries' : 'mushrooms'}`)) return true;

    const site = this.nearest(g, (b) => b.built < 1 && free(b));
    if (site && this.reserveAndGo(g, site, 'build', 9999, `Building a ${BUILDINGS[site.kind].label.toLowerCase()}`)) return true;

    const anyFire = this.nearest(g, (b) => fires(b) && b.stew < STEW_MAX - 3 && w.food >= 6);
    if (anyFire && this.reserveAndGo(g, anyFire, 'cook', 30, 'Cooking up extra stew')) return true;

    return false;
  }

  private reserveAndGo(g: Goblin, b: Building, type: ActionType, duration: number, thought: string): boolean {
    const blocks = BUILDINGS[b.kind].blocks && b.built >= 1;
    const dest = blocks ? this.freeNeighbour(b.x, b.y, 1) : { x: b.x, y: b.y };
    if (!dest) return false;
    if (!this.goTo(g, type, dest, { targetId: b.id, duration })) return false;
    b.reservedBy = g.id;
    g.thought = thought;
    return true;
  }

  private startDeposit(g: Goblin): boolean {
    const store = this.nearest(g, (b) => b.kind === 'larder' && b.built >= 1)
      ?? this.nearest(g, (b) => b.kind === 'cookfire' && b.built >= 1);
    if (!store) {
      this.world.food = Math.min(foodCapacity(this.world), this.world.food + g.carrying);
      g.carrying = 0;
      return false;
    }
    const spot = this.freeNeighbour(store.x, store.y, 1) ?? { x: store.x, y: store.y };
    if (!this.goTo(g, 'deposit', spot, { targetId: store.id })) return false;
    g.thought = 'Hauling food to the stores';
    return true;
  }

  private startChat(g: Goblin): boolean {
    const w = this.world;
    if (w.goblins.length < 2) return false;
    const candidates = w.goblins
      .filter((o) => o.id !== g.id && ['idle', 'wander', 'leisure'].includes(o.action.type) && o.needs.social < 95)
      .map((o) => ({ o, d: dist(g.x, g.y, o.x, o.y) }))
      .filter(({ d }) => d < 16)
      .sort((a, b) => a.d - b.d);
    if (candidates.length === 0) return false;
    const { o } = candidates[Math.floor(this.rng() * Math.min(3, candidates.length))];
    if (!this.goTo(g, 'chat', tileOf(o), { targetId: o.id, duration: 30 + this.rng() * 20 })) return false;
    g.thought = `Off to have a natter with ${o.name.split(' ')[0]}`;
    return true;
  }

  private startLeisure(g: Goblin): boolean {
    const w = this.world;
    const night = isNight(w.minute);
    const kinds: LeisureKind[] = night ? ['lanterns', 'stream'] : ['cloudwatch', 'stream', 'flowers', 'nap', 'flowers'];
    for (let i = 0; i < 4; i++) {
      const kind = pick(this.rng, kinds);
      const spot = this.leisureSpot(g, kind);
      if (spot && this.goTo(g, 'leisure', spot, { leisure: kind, duration: 40 + this.rng() * 30 })) {
        g.thought = LEISURE_TEXT[kind].doing;
        return true;
      }
    }
    return false;
  }

  private leisureSpot(g: Goblin, kind: LeisureKind): GridPosition | null {
    const w = this.world;
    switch (kind) {
      case 'cloudwatch':
        return this.randomTileNear(g.x, g.y, 18, (t) => t.elevation >= 2 && t.feature !== 'boulder' && t.buildingId === null);
      case 'stream':
        return this.randomTileNear(g.x, g.y, 16, (t) =>
          isLand(t) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w.tiles[t.y + dy]?.[t.x + dx]?.terrain === 'water'));
      case 'flowers': {
        const bed = this.nearest(g, (b) => b.kind === 'flower_bed' && b.built >= 1);
        if (bed && dist(g.x, g.y, bed.x, bed.y) < 18 && this.rng() < 0.6) return this.freeNeighbour(bed.x, bed.y, 1);
        return this.randomTileNear(g.x, g.y, 14, (t) => t.feature === 'flowers');
      }
      case 'lanterns': {
        const lantern = this.nearest(g, (b) => b.kind === 'lantern' && b.built >= 1);
        return lantern && dist(g.x, g.y, lantern.x, lantern.y) < 20 ? this.freeNeighbour(lantern.x, lantern.y, 1) : null;
      }
      case 'nap':
        return this.randomTileNear(g.x, g.y, 8, (t) => (t.terrain === 'grass' || t.terrain === 'meadow') && t.buildingId === null && !t.feature);
    }
  }

  private startWander(g: Goblin) {
    const spot = this.randomTileNear(g.x, g.y, 4, (t) => isLand(t));
    if (spot && this.goTo(g, 'wander', spot, { duration: 5 + this.rng() * 10 })) {
      g.thought = pick(this.rng, ['Pottering about', 'Humming a little tune', 'Kicking a pebble along', 'Looking for something to do']);
    } else {
      g.nextThink = this.world.minute + 10;
    }
  }

  // ----- doing ---------------------------------------------------------------

  private onArrive(g: Goblin) {
    const w = this.world;
    const a = g.action;
    if (a.type === 'chat') {
      const other = goblinById(w, a.targetId);
      if (!other || dist(g.x, g.y, other.x, other.y) > 1.8 || !['idle', 'wander', 'leisure', 'chat'].includes(other.action.type)) {
        // they wandered off; try to catch up once more or give up
        if (other && dist(g.x, g.y, other.x, other.y) < 16 && a.elapsed === 0 && ['idle', 'wander', 'leisure'].includes(other.action.type)) {
          a.elapsed = 0.01;
          a.arrived = false;
          a.dest = tileOf(other);
          const p = findPath(w, tileOf(g), a.dest);
          if (p) {
            g.path = p;
            return;
          }
        }
        this.finish(g);
        return;
      }
      if (other.action.type !== 'chat') {
        const ob = buildingById(w, other.action.targetId);
        if (ob && ob.reservedBy === other.id) ob.reservedBy = null;
        other.action = { type: 'chat', targetId: g.id, dest: tileOf(other), elapsed: 0, duration: a.duration, arrived: true };
        other.path = [];
        other.thought = `Having a natter with ${g.name.split(' ')[0]}`;
      }
      g.facing = other.x - other.y > g.x - g.y ? 1 : -1;
      other.facing = (g.facing * -1) as 1 | -1;
      g.thought = `Having a natter with ${other.name.split(' ')[0]}`;
      a.elapsed = 0;
    }
    if (a.type === 'eat') {
      const b = buildingById(w, a.targetId);
      if (a.meal === 'stew' && (!b || b.stew <= 0)) {
        // stew ran out — fall back to raw if there is any
        if (w.food > 0) a.meal = 'raw';
        else {
          this.finish(g, 1);
          return;
        }
      }
      if (a.meal === 'stew' && b) b.stew -= 1;
      if (a.meal === 'raw') {
        if (w.food < 1) {
          this.finish(g, 1);
          return;
        }
        w.food -= 1;
      }
    }
    if (a.type === 'sleep' && a.atHome) g.thought = 'Snoring softly';
    if (a.type === 'sleep' && !a.atHome) g.thought = 'Snoozing on the cold ground';
  }

  private perform(g: Goblin, dt: number) {
    const w = this.world;
    const a = g.action;
    a.elapsed += dt;
    const workRate = 0.6 + g.mood / 140; // 0.6 .. ~1.3

    switch (a.type) {
      case 'sleep': {
        g.needs.rest = clamp(g.needs.rest + (a.atHome ? 0.3 : 0.17) * dt);
        const day = !isNight(w.minute);
        if (g.needs.rest >= 99 || (day && g.needs.rest > 70) || g.needs.hunger < 10) {
          if (a.atHome) addMoodlet(g, w, 'slept', 'Slept snug in their own bed', 5, 12);
          else addMoodlet(g, w, 'slept', 'Slept on the cold ground', -8, 12);
          this.finish(g);
        }
        break;
      }
      case 'eat': {
        const gain = a.meal === 'stew' ? 75 : a.meal === 'raw' ? 48 : 32;
        g.needs.hunger = clamp(g.needs.hunger + (gain / a.duration) * dt);
        if (a.meal === 'stew') {
          const company = w.goblins.filter((o) => o !== g && o.action.type === 'eat' && o.action.arrived && dist(o.x, o.y, g.x, g.y) < 2.5).length;
          if (company > 0) g.needs.social = clamp(g.needs.social + 0.5 * dt);
        }
        if (a.elapsed >= a.duration) {
          if (a.meal === 'stew') {
            addMoodlet(g, w, 'meal', 'Ate a warm bowl of stew', 6, 8);
            const company = w.goblins.some((o) => o !== g && o.action.type === 'eat' && dist(o.x, o.y, g.x, g.y) < 2.5);
            if (company) addMoodlet(g, w, 'shared_meal', 'Shared a meal around the fire', 4, 8);
          } else if (a.meal === 'raw') addMoodlet(g, w, 'meal', 'Ate cold rations', -2, 6);
          else addMoodlet(g, w, 'meal', 'Had to forage for grubs', -6, 8);
          this.finish(g);
        }
        break;
      }
      case 'chat': {
        const other = goblinById(w, a.targetId);
        if (!other || other.action.type !== 'chat' || other.action.targetId !== g.id) {
          this.finish(g);
          break;
        }
        g.needs.social = clamp(g.needs.social + 1.5 * dt);
        g.needs.fun = clamp(g.needs.fun + 0.3 * dt);
        if (a.elapsed >= a.duration) {
          const first = other.name.split(' ')[0];
          addMoodlet(g, w, `chat:${other.id}`, `Had a lovely chat with ${first}`, 3, 4);
          addMoodlet(other, w, `chat:${g.id}`, `Had a lovely chat with ${g.name.split(' ')[0]}`, 3, 4);
          // keep chat moodlets from stacking too high
          const chats = g.moodlets.filter((m) => m.id.startsWith('chat:'));
          if (chats.length > 3) g.moodlets = g.moodlets.filter((m) => m !== chats[0]);
          if (this.rng() < 0.06) {
            const topics = ['the best way to cook a toadstool', 'whether frogs have opinions', 'a very suspicious cloud', 'the old days before the hollow', 'which hill is the comfiest', 'a dream about a giant mushroom'];
            log(w, `${g.name.split(' ')[0]} and ${first} talked for ages about ${pick(this.rng, topics)}.`, 'good', g.id);
          }
          other.action = idleAction();
          other.nextThink = w.minute + 2;
          this.finish(g);
        }
        break;
      }
      case 'leisure': {
        g.needs.fun = clamp(g.needs.fun + 1.25 * dt);
        if (a.leisure === 'nap') g.needs.rest = clamp(g.needs.rest + 0.12 * dt);
        if (a.elapsed >= a.duration || g.needs.fun >= 100) {
          if (a.leisure) addMoodlet(g, w, 'leisure', LEISURE_TEXT[a.leisure].moodlet, 4, 6);
          this.finish(g);
        }
        break;
      }
      case 'sulk': {
        g.needs.fun = clamp(g.needs.fun + 0.3 * dt);
        if (a.elapsed >= a.duration) {
          addMoodlet(g, w, 'sulk', 'Had a good sulk and feels a bit better', 4, 4);
          this.finish(g);
        }
        break;
      }
      case 'wander': {
        if (a.elapsed >= a.duration) this.finish(g);
        break;
      }
      case 'build': {
        const b = buildingById(w, a.targetId);
        if (!b) {
          this.finish(g);
          break;
        }
        b.built = Math.min(1, b.built + (workRate * dt) / BUILDINGS[b.kind].work);
        if (b.built >= 1) {
          b.reservedBy = null;
          this.mapVersion++;
          if (b.kind !== 'fence') log(w, `${g.name.split(' ')[0]} finished building a ${BUILDINGS[b.kind].label.toLowerCase()}.`, 'good', g.id);
          addMoodlet(g, w, 'built', 'Proud of a job well done', 3, 6);
          if (BUILDINGS[b.kind].capacity) this.assignHomes();
          this.finish(g);
        } else if (g.needs.hunger < 25 || g.needs.rest < 20 || a.elapsed > 120) {
          this.finish(g); // take a break, come back later
        }
        break;
      }
      case 'harvest': {
        const b = buildingById(w, a.targetId);
        if (!b || b.growth < 1) {
          this.finish(g);
          break;
        }
        if (a.elapsed >= a.duration / workRate) {
          b.growth = 0;
          g.carrying = HARVEST_YIELD[b.kind] ?? 4;
          this.finish(g, 0);
          this.startDeposit(g);
        }
        break;
      }
      case 'deposit': {
        const cap = foodCapacity(w);
        const before = w.food;
        w.food = Math.min(cap, w.food + g.carrying);
        if (w.food === cap && before + g.carrying > cap && this.rng() < 0.2) {
          log(w, 'The stores are full to bursting — another larder stump would help.', 'neutral');
        }
        g.carrying = 0;
        this.finish(g);
        break;
      }
      case 'cook': {
        const b = buildingById(w, a.targetId);
        if (!b || w.food < 3) {
          this.finish(g);
          break;
        }
        if (a.elapsed >= a.duration / workRate) {
          w.food -= 3;
          const firstPot = totalStew(w) === 0 && w.minute < 360 + 1440 * 2;
          b.stew = Math.min(STEW_MAX, b.stew + 5);
          if (firstPot) log(w, `${g.name.split(' ')[0]} cooked the hollow's first pot of stew. It smells wonderful.`, 'good', g.id);
          addMoodlet(g, w, 'cooked', 'Cooked something delicious', 3, 6);
          this.finish(g);
        }
        break;
      }
      default:
        break;
    }
  }

  // ----- spatial helpers -------------------------------------------------------

  private nearest(g: Goblin, pred: (b: Building) => boolean): Building | undefined {
    let best: Building | undefined;
    let bestD = Infinity;
    for (const b of this.world.buildings) {
      if (!pred(b)) continue;
      const d = dist(g.x, g.y, b.x, b.y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private freeNeighbour(x: number, y: number, r: number): GridPosition | null {
    const w = this.world;
    const opts: GridPosition[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dy === 0) continue;
        const t = w.tiles[y + dy]?.[x + dx];
        if (t && walkable(w, t.x, t.y) && isLand(t) && t.buildingId === null) opts.push({ x: t.x, y: t.y });
      }
    }
    return opts.length ? opts[Math.floor(this.rng() * opts.length)] : null;
  }

  private randomTileNear(cx: number, cy: number, r: number, pred: (t: World['tiles'][0][0]) => boolean): GridPosition | null {
    const w = this.world;
    for (let i = 0; i < 30; i++) {
      const x = Math.round(cx + (this.rng() * 2 - 1) * r);
      const y = Math.round(cy + (this.rng() * 2 - 1) * r);
      const t = w.tiles[y]?.[x];
      if (t && walkable(w, x, y) && pred(t)) return { x, y };
    }
    return null;
  }
}
