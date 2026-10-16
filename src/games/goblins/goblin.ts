import type { Goblin, Look, World } from './types';
import { Rng, pick, randInt } from './rng';
import { goblinName } from './names';

export function makeLook(rng: Rng): Look {
  return {
    skinHue: randInt(rng, 70, 140),
    skinLight: randInt(rng, 34, 52),
    tunicHue: randInt(rng, 0, 359),
    hat: pick(rng, ['none', 'none', 'cap', 'pointy', 'leaf', 'mushroom'] as const),
    hatHue: randInt(rng, 0, 359),
    earSize: 0.8 + rng() * 0.5,
    height: 0.9 + rng() * 0.2,
  };
}

export function makeGoblin(world: World, rng: Rng, x: number, y: number): Goblin {
  const id = world.nextId++;
  const taken = new Set(world.goblins.map((g) => g.name));
  let name = goblinName(rng);
  for (let i = 0; i < 10 && taken.has(name); i++) name = goblinName(rng);
  return {
    id,
    name,
    look: makeLook(rng),
    x,
    y,
    z: world.tiles[Math.round(y)]?.[Math.round(x)]?.elevation ?? 0,
    facing: 1,
    homeId: null,
    needs: {
      hunger: randInt(rng, 55, 90),
      rest: randInt(rng, 60, 95),
      social: randInt(rng, 40, 80),
      fun: randInt(rng, 40, 80),
    },
    mood: 60,
    moodlets: [],
    action: { type: 'idle', targetId: null, dest: null, elapsed: 0, duration: 0, arrived: false },
    path: [],
    carrying: 0,
    thought: 'Settling in.',
    arrivedDay: Math.floor(world.minute / 1440) + 1,
    anim: rng() * 10,
    nextThink: 0,
  };
}
