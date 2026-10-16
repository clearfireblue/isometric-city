import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import type { World } from './types';

const SAVE_KEY = 'goblin-hollow-save-v1';

export function saveWorld(world: World): boolean {
  try {
    localStorage.setItem(SAVE_KEY, compressToUTF16(JSON.stringify(world)));
    return true;
  } catch {
    return false;
  }
}

export function loadWorld(): World | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const json = decompressFromUTF16(raw);
    if (!json) return null;
    const world = JSON.parse(json) as World;
    if (world.version !== 1 || !Array.isArray(world.tiles)) return null;
    return world;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
