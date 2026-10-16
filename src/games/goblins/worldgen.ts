import type { Building, BuildingKind, Tile, World } from './types';
import { MAP_SIZE, MAX_ELEVATION, START_MINUTE } from './catalog';
import { chance, fbm, hash2, makeRng, randInt } from './rng';
import { hollowName } from './names';
import { makeGoblin } from './goblin';

export const STARTING_GOBLINS = 5;

export function newBuilding(world: World, kind: BuildingKind, x: number, y: number, built = 0): Building {
  const b: Building = {
    id: world.nextId++,
    kind,
    x,
    y,
    built,
    growth: kind === 'mushroom_patch' || kind === 'berry_bush' ? 0.3 : 0,
    stew: 0,
    residents: [],
    reservedBy: null,
  };
  world.buildings.push(b);
  const tile = world.tiles[y][x];
  tile.buildingId = b.id;
  tile.feature = null;
  return b;
}

/**
 * Hillside generator: hills rise toward the back of the map (top of the
 * screen), a stream meanders through the valley floor in front, woods and
 * meadows are scattered by noise.
 */
export function generateWorld(seed: number): World {
  const rng = makeRng(seed);
  const size = MAP_SIZE;
  const tiles: Tile[][] = [];

  for (let y = 0; y < size; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < size; x++) {
      const back = 1 - (x + y) / (2 * (size - 1)); // 1 at the back corner
      const n = fbm(x / 11, y / 11, seed, 4);
      const raw = back * 0.62 + n * 0.5;
      const elevation = Math.max(0, Math.min(MAX_ELEVATION, Math.floor((raw - 0.5) / 0.1)));
      row.push({
        x,
        y,
        terrain: 'grass',
        elevation,
        feature: null,
        path: false,
        buildingId: null,
        variant: hash2(x, y, seed),
      });
    }
    tiles.push(row);
  }

  // Smooth cliffs: neighbours differ by at most 1 level
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const t = tiles[y][x];
        let minN = Infinity;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = tiles[y + dy]?.[x + dx];
          if (n) minN = Math.min(minN, n.elevation);
        }
        if (t.elevation > minN + 1) t.elevation = minN + 1;
      }
    }
  }

  // Stream across the valley floor
  let sy = Math.floor(size * (0.7 + rng() * 0.12));
  const fords = [randInt(rng, 8, 18), randInt(rng, 26, 40)];
  const wet = (x: number, y: number, ford: boolean) => {
    const t = tiles[y]?.[x];
    if (!t) return;
    t.elevation = 0;
    t.terrain = ford ? 'ford' : 'water';
  };
  for (let x = 0; x < size; x++) {
    const prev = sy;
    const drift = fbm(x / 6, 0.5, seed + 7, 2) - 0.5;
    sy += drift > 0.08 ? 1 : drift < -0.08 ? -1 : 0;
    sy = Math.max(Math.floor(size * 0.55), Math.min(size - 4, sy));
    const ford = fords.includes(x);
    const width = fbm(x / 5, 9.5, seed + 3, 2) > 0.55 ? 2 : 1;
    // keep the channel connected when it shifts
    for (let y = Math.min(prev, sy); y <= Math.max(prev, sy); y++) wet(x, y, ford);
    for (let w = 0; w < width; w++) wet(x, sy + w, ford);
    for (const dy of [-1, width]) {
      const t = tiles[sy + dy]?.[x];
      if (t && t.terrain === 'grass') t.elevation = 0;
    }
  }

  // Terrain flavour and features
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = tiles[y][x];
      if (t.terrain === 'water' || t.terrain === 'ford') continue;
      const forest = fbm(x / 7, y / 7, seed + 31, 3);
      const meadow = fbm(x / 9, y / 9, seed + 57, 3);
      if (t.elevation === MAX_ELEVATION && fbm(x / 4, y / 4, seed + 13, 2) > 0.55) t.terrain = 'rock';
      else if (t.elevation === 0 && meadow > 0.6) t.terrain = 'meadow';

      if (t.terrain === 'rock') {
        if (chance(rng, 0.18)) t.feature = 'boulder';
      } else if (forest > 0.63) {
        t.feature = t.elevation >= 2 ? 'pine' : chance(rng, 0.25) ? 'pine' : 'tree';
        if (chance(rng, 0.25)) t.feature = chance(rng, 0.5) ? 'shrub' : t.feature;
      } else if (t.terrain === 'meadow' && chance(rng, 0.35)) {
        t.feature = 'flowers';
      } else if (t.elevation >= 1 && chance(rng, 0.04)) {
        t.feature = 'boulder';
      } else if (chance(rng, 0.03)) {
        t.feature = 'shrub';
      } else if (chance(rng, 0.015)) {
        t.feature = 'tree';
      }
    }
  }

  const world: World = {
    version: 1,
    seed,
    name: hollowName(rng),
    width: size,
    height: size,
    tiles,
    buildings: [],
    goblins: [],
    minute: START_MINUTE,
    food: 18,
    nextId: 1,
    log: [],
  };

  // Founding clearing: a flat dry spot near the foot of the hills
  const center = findClearing(world);
  for (let y = center.y - 3; y <= center.y + 3; y++) {
    for (let x = center.x - 3; x <= center.x + 3; x++) {
      const t = tiles[y]?.[x];
      if (t && t.feature !== 'flowers') t.feature = null;
    }
  }
  const stump = newBuilding(world, 'larder', center.x - 1, center.y, 1);
  stump.name = 'Old Stump';
  const fire = newBuilding(world, 'cookfire', center.x + 1, center.y + 1, 1);
  fire.stew = 4;
  newBuilding(world, 'mushroom_patch', center.x - 2, center.y + 2, 1).growth = 0.8;

  for (let i = 0; i < STARTING_GOBLINS; i++) {
    const g = makeGoblin(world, rng, center.x + (rng() - 0.5) * 3, center.y + (rng() - 0.5) * 3);
    world.goblins.push(g);
  }
  world.log.push({
    id: world.nextId++,
    minute: world.minute,
    text: `${STARTING_GOBLINS} goblins arrived at ${world.name} with a pot, a stump and big plans.`,
    tone: 'good',
  });
  return world;
}

function findClearing(world: World): { x: number; y: number } {
  const { tiles, width } = world;
  let best = { x: Math.floor(width / 2), y: Math.floor(width / 2), score: -Infinity };
  for (let y = 6; y < width - 6; y++) {
    for (let x = 6; x < width - 6; x++) {
      let ok = true;
      let hillsNear = 0;
      for (let dy = -3; dy <= 3 && ok; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const t = tiles[y + dy][x + dx];
          if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2 && (t.elevation !== 0 || t.terrain === 'water' || t.terrain === 'ford')) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          if (tiles[y + dy]?.[x + dx]?.elevation >= 1) hillsNear++;
        }
      }
      const centrality = -Math.hypot(x - width / 2, y - width / 2) * 0.6;
      const score = Math.min(hillsNear, 40) + centrality;
      if (score > best.score) best = { x, y, score };
    }
  }
  return best;
}
