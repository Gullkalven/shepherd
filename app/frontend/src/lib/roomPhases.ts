import { client } from '@/lib/api';

export const ROOM_PHASE_KEYS = ['demontering', 'varmekabel', 'remontering', 'sluttkontroll'] as const;
export type RoomPhaseKey = (typeof ROOM_PHASE_KEYS)[number];

export const ROOM_PHASE_LABELS: Record<RoomPhaseKey, string> = {
  demontering: 'Demontering',
  varmekabel: 'Varmekabel',
  remontering: 'Remontering',
  sluttkontroll: 'Sluttkontroll',
};

const LETTERS: Record<RoomPhaseKey, string> = {
  demontering: 'D',
  varmekabel: 'V',
  remontering: 'R',
  sluttkontroll: 'S',
};

export function normalizeRoomPhase(p?: string | null): RoomPhaseKey {
  const d: RoomPhaseKey = 'demontering';
  if (!p) return d;
  return (ROOM_PHASE_KEYS as readonly string[]).includes(p) ? (p as RoomPhaseKey) : d;
}

export function phaseTimelineState(roomPhase: RoomPhaseKey, tabPhase: RoomPhaseKey): 'done' | 'active' | 'upcoming' {
  const ri = ROOM_PHASE_KEYS.indexOf(roomPhase);
  const ti = ROOM_PHASE_KEYS.indexOf(tabPhase);
  if (ti < ri) return 'done';
  if (ti === ri) return 'active';
  return 'upcoming';
}

/** Compact legend for the room card, e.g. D✓ V● R○ S○ */
export function formatPhaseStrip(roomPhase: RoomPhaseKey): string {
  const ri = ROOM_PHASE_KEYS.indexOf(roomPhase);
  return ROOM_PHASE_KEYS.map((key, i) => {
    const L = LETTERS[key];
    if (i < ri) return `${L}✓`;
    if (i === ri) return `${L}●`;
    return `${L}○`;
  }).join(' ');
}

export function effectiveTaskPhase(taskPhase: string | null | undefined, roomPhaseWhenUnknown: RoomPhaseKey): RoomPhaseKey {
  if (taskPhase != null && String(taskPhase) !== '') return normalizeRoomPhase(taskPhase);
  return roomPhaseWhenUnknown;
}

/** After the room’s phase changes: move incomplete checklist items from the old bucket into the new one. */
export async function syncIncompleteTasksPhaseForRoom(
  roomId: number,
  oldPhase: RoomPhaseKey,
  newPhase: RoomPhaseKey
): Promise<void> {
  const tasksRes = await client.entities.tasks.query({
    query: { room_id: roomId },
    limit: 500,
    sort: 'sort_order',
  });
  const items = (tasksRes?.data?.items || []) as {
    id: number;
    is_completed?: boolean;
    phase?: string | null;
  }[];
  await Promise.all(
    items
      .filter((t) => {
        if (t.is_completed) return false;
        const eff = effectiveTaskPhase(t.phase, oldPhase);
        return eff === oldPhase;
      })
      .map((t) => client.entities.tasks.update({ id: String(t.id), data: { phase: newPhase } }))
  );
}

export function visitMatchesPhase(visitPhase: string | null | undefined, tabPhase: RoomPhaseKey): boolean {
  if (visitPhase == null || visitPhase === '') return true;
  return normalizeRoomPhase(visitPhase) === tabPhase;
}

export function photoMatchesPhase(photoPhase: string | null | undefined, tabPhase: RoomPhaseKey): boolean {
  if (photoPhase == null || photoPhase === '') return true;
  return normalizeRoomPhase(photoPhase) === tabPhase;
}
