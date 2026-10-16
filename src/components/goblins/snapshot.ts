import type { BuildingKind, LogEntry, Look, Moodlet, NeedKey } from '@/games/goblins/types';
import { BUILDINGS } from '@/games/goblins/catalog';
import {
  Hollow, averageMood, buildingById, clockLabel, dayOf, foodCapacity, freeBeds, isNight, totalStew,
} from '@/games/goblins/sim';

export interface GoblinRow {
  id: number;
  name: string;
  mood: number;
  thought: string;
  action: string;
  homeless: boolean;
  look: Look;
}

export interface GoblinDetail extends GoblinRow {
  needs: Record<NeedKey, number>;
  moodlets: Moodlet[];
  homeLabel: string | null;
  arrivedDay: number;
  carrying: number;
}

export interface BuildingDetail {
  id: number;
  kind: BuildingKind;
  label: string;
  name?: string;
  built: number;
  growth: number;
  stew: number;
  residents: { id: number; name: string }[];
  capacity?: number;
  worker: string | null;
}

export interface Snapshot {
  name: string;
  day: number;
  clock: string;
  night: boolean;
  food: number;
  foodCap: number;
  stew: number;
  beds: number;
  mood: number;
  goblins: GoblinRow[];
  goblin: GoblinDetail | null;
  building: BuildingDetail | null;
  log: LogEntry[];
}

export function takeSnapshot(h: Hollow, selectedGoblin: number | null, selectedBuilding: number | null): Snapshot {
  const w = h.world;
  const rows: GoblinRow[] = w.goblins.map((g) => ({
    id: g.id,
    name: g.name,
    mood: g.mood,
    thought: g.thought,
    action: g.action.type,
    homeless: g.homeId === null,
    look: g.look,
  }));
  const g = w.goblins.find((gg) => gg.id === selectedGoblin);
  let goblin: GoblinDetail | null = null;
  if (g) {
    const home = buildingById(w, g.homeId);
    goblin = {
      ...rows.find((r) => r.id === g.id)!,
      needs: { ...g.needs },
      moodlets: g.moodlets.filter((m) => m.until > w.minute).map((m) => ({ ...m })),
      homeLabel: home ? `${BUILDINGS[home.kind].label} (${home.x}, ${home.y})` : null,
      arrivedDay: g.arrivedDay,
      carrying: g.carrying,
    };
  }
  const b = buildingById(w, selectedBuilding);
  const building: BuildingDetail | null = b
    ? {
        id: b.id,
        kind: b.kind,
        label: BUILDINGS[b.kind].label,
        name: b.name,
        built: b.built,
        growth: b.growth,
        stew: b.stew,
        residents: b.residents.map((id) => ({ id, name: w.goblins.find((gg) => gg.id === id)?.name ?? '?' })),
        capacity: BUILDINGS[b.kind].capacity,
        worker: b.reservedBy !== null ? w.goblins.find((gg) => gg.id === b.reservedBy)?.name ?? null : null,
      }
    : null;
  return {
    name: w.name,
    day: dayOf(w.minute),
    clock: clockLabel(w.minute),
    night: isNight(w.minute),
    food: Math.floor(w.food),
    foodCap: foodCapacity(w),
    stew: totalStew(w),
    beds: freeBeds(w),
    mood: averageMood(w),
    goblins: rows,
    goblin,
    building,
    log: w.log.slice(-5),
  };
}
