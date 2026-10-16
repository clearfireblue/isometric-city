/**
 * Goblin Hollow — world, building and goblin types.
 */
import type { BaseTile, GridPosition } from '@/core/types';

export type Terrain = 'grass' | 'meadow' | 'dirt' | 'rock' | 'water' | 'ford';
export type Feature = 'tree' | 'pine' | 'boulder' | 'shrub' | 'flowers' | null;

export interface Tile extends BaseTile {
  terrain: Terrain;
  /** 0 = valley floor, up to MAX_ELEVATION on the hilltops */
  elevation: number;
  feature: Feature;
  path: boolean;
  /** id of the building occupying the tile, if any */
  buildingId: number | null;
  /** precomputed visual variation 0..1 */
  variant: number;
}

export type BuildingKind =
  | 'burrow'
  | 'hut'
  | 'mushroom_patch'
  | 'berry_bush'
  | 'cookfire'
  | 'larder'
  | 'lantern'
  | 'flower_bed'
  | 'fence';

export type BuildCategory = 'homes' | 'food' | 'decor';

export type Tool = BuildingKind | 'path' | 'inspect' | 'clear';

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  /** 0..1 construction progress; 1 = finished */
  built: number;
  /** growing things: 0..1 ripeness */
  growth: number;
  /** cookfire: portions of stew ready to eat */
  stew: number;
  /** homes: goblin ids living here */
  residents: number[];
  /** goblin id currently doing a job here (harvest / build / cook) */
  reservedBy: number | null;
  name?: string;
}

export type NeedKey = 'hunger' | 'rest' | 'social' | 'fun';
export type Needs = Record<NeedKey, number>;

export interface Moodlet {
  id: string;
  label: string;
  value: number;
  /** game minute this expires */
  until: number;
}

export type ActionType =
  | 'idle'
  | 'wander'
  | 'eat'
  | 'sleep'
  | 'chat'
  | 'leisure'
  | 'build'
  | 'harvest'
  | 'deposit'
  | 'cook'
  | 'sulk';

export type LeisureKind = 'cloudwatch' | 'stream' | 'flowers' | 'lanterns' | 'nap';

export interface Action {
  type: ActionType;
  /** building or goblin id depending on type */
  targetId: number | null;
  /** destination tile */
  dest: GridPosition | null;
  /** minutes spent doing it once arrived */
  elapsed: number;
  /** minutes the activity lasts (or until need satisfied) */
  duration: number;
  arrived: boolean;
  leisure?: LeisureKind;
  /** eat: stew or raw */
  meal?: 'stew' | 'raw';
  /** sleep: whether in own home */
  atHome?: boolean;
}

export interface Look {
  skinHue: number;
  skinLight: number;
  tunicHue: number;
  hat: 'none' | 'cap' | 'pointy' | 'leaf' | 'mushroom';
  hatHue: number;
  earSize: number;
  height: number;
}

export interface Goblin {
  id: number;
  name: string;
  look: Look;
  /** float tile coords */
  x: number;
  y: number;
  /** visual elevation (eased) */
  z: number;
  facing: 1 | -1;
  homeId: number | null;
  needs: Needs;
  mood: number;
  moodlets: Moodlet[];
  action: Action;
  path: GridPosition[];
  carrying: number;
  /** short line shown in the inspector / bubble */
  thought: string;
  arrivedDay: number;
  /** animation phase */
  anim: number;
  /** throttle for re-evaluating what to do */
  nextThink: number;
}

export interface LogEntry {
  id: number;
  minute: number;
  text: string;
  goblinId?: number;
  tone: 'good' | 'neutral' | 'bad';
}

export interface World {
  version: 1;
  seed: number;
  name: string;
  width: number;
  height: number;
  tiles: Tile[][];
  buildings: Building[];
  goblins: Goblin[];
  /** game minutes since the hollow was founded (day 1, 06:00 = 360) */
  minute: number;
  food: number;
  nextId: number;
  log: LogEntry[];
}
