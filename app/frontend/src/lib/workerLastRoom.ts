const STORAGE_KEY = 'shepherd_worker_last_room';

/** Fired after `persistWorkerLastRoom` writes — lets Worker UI (e.g. bottom nav) re-read storage immediately. */
export const WORKER_LAST_ROOM_PERSISTED_EVENT = 'shepherd-worker-last-room-persisted';

/** Hash on `/` — bottom nav Search focuses the worker home room finder (see `WorkerTodayView`). */
export const WORKER_HOME_FIND_ROOM_HASH = 'find-room';

/** Match `/project/:projectId/floor/:floorId/room/:roomId` (no trailing segment). */
export function parseWorkerRoomPath(pathname: string): {
  projectId: number;
  floorId: number;
  roomId: number;
} | null {
  const m = pathname.match(/^\/project\/(\d+)\/floor\/(\d+)\/room\/(\d+)$/);
  if (!m) return null;
  const projectId = Number(m[1]);
  const floorId = Number(m[2]);
  const roomId = Number(m[3]);
  if (!Number.isFinite(projectId) || !Number.isFinite(floorId) || !Number.isFinite(roomId)) return null;
  return { projectId, floorId, roomId };
}

export type WorkerLastRoom = {
  projectId: number;
  floorId: number;
  roomId: number;
  roomNumber?: string;
  savedAt: string;
};

/** Matches `id` on the checklist heading in `WorkerRoomView` — scroll target after navigation from Today. */
export const WORKER_ROOM_CHECKLIST_ANCHOR = 'worker-checklist-heading';

/** Scroll target for documentation / photos (checklist & uploads section). */
export const WORKER_ROOM_DOCUMENTATION_ANCHOR = 'worker-documentation';
export const WORKER_ROOM_PHASE_HASH_PREFIX = 'phase-';

export function workerRoomPath(
  projectId: number,
  floorId: number,
  roomId: number,
  options?: { focusChecklist?: boolean; focusDocumentation?: boolean; phaseKey?: string }
): string {
  const base = `/project/${projectId}/floor/${floorId}/room/${roomId}`;
  if (options?.phaseKey) return `${base}#${WORKER_ROOM_PHASE_HASH_PREFIX}${encodeURIComponent(options.phaseKey)}`;
  if (options?.focusDocumentation) return `${base}#${WORKER_ROOM_DOCUMENTATION_ANCHOR}`;
  if (options?.focusChecklist) return `${base}#${WORKER_ROOM_CHECKLIST_ANCHOR}`;
  return base;
}

export function readWorkerLastRoom(): WorkerLastRoom | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<WorkerLastRoom>;
    const projectId = Number(o.projectId);
    const floorId = Number(o.floorId);
    const roomId = Number(o.roomId);
    if (!Number.isFinite(projectId) || !Number.isFinite(floorId) || !Number.isFinite(roomId)) return null;
    return {
      projectId,
      floorId,
      roomId,
      roomNumber: typeof o.roomNumber === 'string' ? o.roomNumber : undefined,
      savedAt: typeof o.savedAt === 'string' ? o.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function persistWorkerLastRoom(entry: {
  projectId: number;
  floorId: number;
  roomId: number;
  roomNumber?: string;
}): void {
  try {
    const payload: WorkerLastRoom = {
      ...entry,
      savedAt: new Date().toISOString(),
    };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
    globalThis.window?.dispatchEvent(new CustomEvent(WORKER_LAST_ROOM_PERSISTED_EVENT));
  } catch {
    /* ignore */
  }
}

export function clearWorkerLastRoom(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Clears saved room shortcut if it pointed at this project (stale id after delete or 404). */
export function clearWorkerLastRoomIfMatchesProject(projectId: number): void {
  const last = readWorkerLastRoom();
  if (last && last.projectId === projectId) {
    clearWorkerLastRoom();
  }
}
