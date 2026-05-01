const STORAGE_KEY = 'shepherd_worker_last_room';

export type WorkerLastRoom = {
  projectId: number;
  floorId: number;
  roomId: number;
  roomNumber?: string;
  savedAt: string;
};

/** Matches `id` on the checklist heading in `WorkerRoomView` — scroll target after navigation from Today. */
export const WORKER_ROOM_CHECKLIST_ANCHOR = 'worker-checklist-heading';

export function workerRoomPath(
  projectId: number,
  floorId: number,
  roomId: number,
  options?: { focusChecklist?: boolean }
): string {
  const base = `/project/${projectId}/floor/${floorId}/room/${roomId}`;
  return options?.focusChecklist ? `${base}#${WORKER_ROOM_CHECKLIST_ANCHOR}` : base;
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
