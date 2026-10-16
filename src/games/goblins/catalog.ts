import type { BuildCategory, BuildingKind, Tile, Tool } from './types';

export const TILE_W = 64;
export const TILE_H = 32;
export const ELEV_PX = 14;
export const MAX_ELEVATION = 3;
export const MAP_SIZE = 48;

export const MINUTES_PER_DAY = 1440;
/** game minutes simulated per real second at 1x */
export const MINUTES_PER_SECOND = 6;
export const START_MINUTE = 6 * 60;

export const FOOD_BASE_CAPACITY = 15;
export const FOOD_PER_LARDER = 40;
export const STEW_MAX = 8;

export interface BuildingDef {
  kind: BuildingKind;
  label: string;
  category: BuildCategory;
  blurb: string;
  /** minutes of goblin labour to finish */
  work: number;
  capacity?: number;
  /** contribution to nearby tile beauty */
  beauty: number;
  /** placement rule */
  placement: 'hillside' | 'flat' | 'land';
  blocks?: boolean;
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  burrow: {
    kind: 'burrow', label: 'Burrow', category: 'homes', work: 320, capacity: 3, beauty: 1,
    placement: 'hillside', blurb: 'A snug round-doored home dug into a hillside. Sleeps 3.',
  },
  hut: {
    kind: 'hut', label: 'Thatch Hut', category: 'homes', work: 220, capacity: 2, beauty: 1,
    placement: 'flat', blurb: 'A little thatched hut for the valley floor. Sleeps 2.',
  },
  mushroom_patch: {
    kind: 'mushroom_patch', label: 'Mushroom Patch', category: 'food', work: 40, beauty: 0,
    placement: 'land', blurb: 'Grows a crop of fat red caps every half day or so.',
  },
  berry_bush: {
    kind: 'berry_bush', label: 'Berry Bush', category: 'food', work: 30, beauty: 1,
    placement: 'land', blurb: 'Slow to ripen but generous, and pretty to look at.',
  },
  cookfire: {
    kind: 'cookfire', label: 'Cookfire', category: 'food', work: 90, beauty: 1,
    placement: 'land', blurb: 'Goblins cook stew here and gather round to eat together.',
  },
  larder: {
    kind: 'larder', label: 'Larder Stump', category: 'food', work: 140, beauty: 0,
    placement: 'land', blurb: 'A hollow stump for stashing food. Holds 40 more.',
  },
  lantern: {
    kind: 'lantern', label: 'Lantern', category: 'decor', work: 15, beauty: 2,
    placement: 'land', blurb: 'A warm glow on dark nights. Goblins love to linger near them.',
  },
  flower_bed: {
    kind: 'flower_bed', label: 'Flower Bed', category: 'decor', work: 15, beauty: 3,
    placement: 'land', blurb: 'Brightens the neighbourhood and everyone in it.',
  },
  fence: {
    kind: 'fence', label: 'Picket Fence', category: 'decor', work: 8, beauty: 1,
    placement: 'land', blocks: true, blurb: 'Keeps the path tidy. Goblins walk around it.',
  },
};

export const CATEGORIES: { id: BuildCategory; label: string }[] = [
  { id: 'homes', label: 'Homes' },
  { id: 'food', label: 'Food' },
  { id: 'decor', label: 'Paths & Decor' },
];

export const TOOL_LABEL: Record<Tool, string> = {
  ...Object.fromEntries(Object.values(BUILDINGS).map((b) => [b.kind, b.label])),
  path: 'Dirt Path',
  inspect: 'Inspect',
  clear: 'Clear',
} as Record<Tool, string>;

export function isLand(tile: Tile): boolean {
  return tile.terrain !== 'water' && tile.terrain !== 'ford';
}

/** Returns an error string, or null if the building can go here */
export function placementError(kind: BuildingKind, tile: Tile): string | null {
  const def = BUILDINGS[kind];
  if (!isLand(tile)) return 'Too wet to build here';
  if (tile.buildingId !== null) return 'Something is already here';
  if (tile.feature === 'tree' || tile.feature === 'pine' || tile.feature === 'boulder') {
    return 'Clear the tree or rock first';
  }
  if (def.placement === 'hillside' && tile.elevation < 1) return 'Burrows must be dug into a hill';
  if (def.placement === 'flat' && tile.elevation > 0) return 'Huts need flat valley ground';
  return null;
}
