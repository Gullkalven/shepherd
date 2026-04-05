import { normalizeRoomPhase, type PhaseWorkflowEntry } from '@/lib/roomPhases';

/** Synthetic id for legacy rooms with no `areas` JSON in the API */
export const DEFAULT_AREA_ID = '__default';

export type RoomArea = {
  id: string;
  name: string;
  phase?: string | null;
  phase_lock_overrides?: Record<string, boolean> | null;
};

function coerceOverrides(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export function hasPersistedAreas(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return parseStoredAreas(raw).length > 0;
}

function parseStoredAreas(raw: unknown): RoomArea[] {
  if (!Array.isArray(raw)) return [];
  const out: RoomArea[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!id || !name) continue;
    out.push({
      id,
      name,
      phase: typeof o.phase === 'string' ? o.phase : o.phase === null ? null : undefined,
      phase_lock_overrides: coerceOverrides(o.phase_lock_overrides),
    });
  }
  return out;
}

/**
 * Effective areas for UI: either stored JSON or one virtual "Main" area (backward compatible).
 */
export function normalizeRoomAreas(
  areasRaw: unknown,
  roomPhase: string | null | undefined,
  roomLockOverrides: Record<string, boolean> | null | undefined,
  workflow: PhaseWorkflowEntry[]
): RoomArea[] {
  const stored = parseStoredAreas(areasRaw);
  if (stored.length > 0) return stored;
  return [
    {
      id: DEFAULT_AREA_ID,
      name: 'Main',
      phase: normalizeRoomPhase(roomPhase ?? null, workflow),
      phase_lock_overrides: roomLockOverrides && Object.keys(roomLockOverrides).length ? { ...roomLockOverrides } : {},
    },
  ];
}

export function taskBelongsToArea(
  taskAreaId: string | null | undefined,
  activeAreaId: string,
  primaryAreaId: string
): boolean {
  const tid = taskAreaId != null && String(taskAreaId).trim() !== '' ? String(taskAreaId).trim() : null;
  if (!tid) return activeAreaId === primaryAreaId;
  return tid === activeAreaId;
}

/** Floor/project summaries: only primary (first) area tasks, so extra areas do not double-count. */
export function taskCountsForFloorBoard(
  taskAreaId: string | null | undefined,
  roomAreasRaw: unknown
): boolean {
  const stored = parseStoredAreas(roomAreasRaw);
  if (stored.length <= 1) return true;
  const primaryId = stored[0].id;
  const tid = taskAreaId != null && String(taskAreaId).trim() !== '' ? String(taskAreaId).trim() : null;
  return !tid || tid === primaryId;
}
