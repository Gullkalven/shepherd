export type PhaseWorkflowEntry = { key: string; label: string };

export const DEFAULT_PHASE_WORKFLOW: PhaseWorkflowEntry[] = [
  { key: 'demontering', label: 'Demontering' },
  { key: 'varmekabel', label: 'Varmekabel' },
  { key: 'remontering', label: 'Remontering' },
  { key: 'sluttkontroll', label: 'Sluttkontroll' },
];

/** @deprecated Use phaseKeys(DEFAULT_PHASE_WORKFLOW) when a dynamic list is required */
export const ROOM_PHASE_KEYS = DEFAULT_PHASE_WORKFLOW.map((p) => p.key) as readonly string[];

export type RoomPhaseKey = string;

/** Labels for the built-in default workflow only; prefer `phaseLabel(key, workflow)` when using a custom workflow */
export const ROOM_PHASE_LABELS: Record<string, string> = Object.fromEntries(
  DEFAULT_PHASE_WORKFLOW.map((p) => [p.key, p.label])
);

export function phaseKeys(workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW): string[] {
  return workflow.map((p) => p.key);
}

export function phaseLabel(key: string, workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW): string {
  const found = workflow.find((p) => p.key === key);
  return found?.label ?? key;
}

export function normalizeRoomPhase(
  p?: string | null,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): string {
  const first = workflow[0]?.key ?? 'demontering';
  if (!p) return first;
  return workflow.some((x) => x.key === p) ? p : first;
}

export function phaseTimelineState(
  roomPhase: string,
  tabPhase: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): 'done' | 'active' | 'upcoming' {
  const keys = phaseKeys(workflow);
  const ri = keys.indexOf(roomPhase);
  const ti = keys.indexOf(tabPhase);
  if (ti < 0 || ri < 0) return 'upcoming';
  if (ti < ri) return 'done';
  if (ti === ri) return 'active';
  return 'upcoming';
}

/**
 * Whether Montør/Lærling should be read-only in this phase tab.
 * Default: phases after the room's current (board) phase are locked; earlier or equal are open.
 * Admin/BAS overrides: { phaseKey: true } forces locked; { phaseKey: false } forces unlocked
 * (e.g. allow finishing an older phase after the room moved forward, or allow work ahead).
 */
export function phaseTabReadOnlyForWorker(
  roomPhase: string,
  tabPhase: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW,
  overrides?: Record<string, boolean> | null
): boolean {
  const keys = phaseKeys(workflow);
  const rn = normalizeRoomPhase(roomPhase, workflow);
  const tn = normalizeRoomPhase(tabPhase, workflow);
  const ri = keys.indexOf(rn);
  const ti = keys.indexOf(tn);
  const r = ri >= 0 ? ri : 0;
  const t = ti >= 0 ? ti : 0;
  const defaultLocked = t > r;
  const o = overrides?.[tn];
  if (o === true) return true;
  if (o === false) return false;
  return defaultLocked;
}

/** Compact legend for the room card, e.g. D✓ V● R○ S○ */
export function formatPhaseStrip(
  roomPhase: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): string {
  const keys = phaseKeys(workflow);
  const ri = keys.indexOf(roomPhase);
  return keys
    .map((key, i) => {
      const L = phaseLabel(key, workflow).trim().charAt(0).toUpperCase() || String(i + 1);
      if (i < ri) return `${L}✓`;
      if (i === ri) return `${L}●`;
      return `${L}○`;
    })
    .join(' ');
}

/**
 * Which phase bucket a checklist task belongs to.
 * Explicit `task.phase` wins; empty/null means legacy data → first workflow phase (historically all items started there).
 */
export function storedChecklistPhase(
  taskPhase: string | null | undefined,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): string {
  const first = workflow[0]?.key ?? 'demontering';
  if (taskPhase != null && String(taskPhase).trim() !== '') {
    return normalizeRoomPhase(String(taskPhase), workflow);
  }
  return first;
}

export type FloorPhaseProgressEntry = {
  key: string;
  /** Rooms that have at least one checklist item in this phase and all of them are completed */
  completedRooms: number;
  /** All rooms on the floor (same for every phase) */
  totalRooms: number;
};

type RoomRowForProgress = { id: number; phase?: string | null };
type TaskRowForProgress = {
  room_id: number;
  phase?: string | null;
  is_completed?: boolean | null;
};

/**
 * Per-phase floor progress from checklists (not from board position alone).
 * A room counts toward "completed" for phase P only if it has at least one task in P and every task in P is done.
 * Rooms with no tasks in P do not add to completed (shows how many rooms actually finished that stage’s checklist).
 */
export function computeFloorPhaseProgress(
  rooms: RoomRowForProgress[],
  tasks: TaskRowForProgress[],
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): FloorPhaseProgressEntry[] {
  const keys = phaseKeys(workflow);
  const totalRooms = rooms.length;
  const byRoom = new Map<number, TaskRowForProgress[]>();
  for (const t of tasks) {
    const rid = Number(t.room_id);
    if (Number.isNaN(rid)) continue;
    if (!byRoom.has(rid)) byRoom.set(rid, []);
    byRoom.get(rid)!.push(t);
  }

  return keys.map((phaseKey) => {
    let completedRooms = 0;
    for (const room of rooms) {
      const roomTasks = byRoom.get(room.id) ?? [];
      const inPhase = roomTasks.filter((t) => storedChecklistPhase(t.phase, workflow) === phaseKey);
      if (inPhase.length === 0) continue;
      if (inPhase.every((t) => Boolean(t.is_completed))) completedRooms += 1;
    }
    return { key: phaseKey, completedRooms, totalRooms };
  });
}

export function visitMatchesPhase(
  visitPhase: string | null | undefined,
  tabPhase: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): boolean {
  if (visitPhase == null || visitPhase === '') return true;
  return normalizeRoomPhase(visitPhase, workflow) === tabPhase;
}

export function photoMatchesPhase(
  photoPhase: string | null | undefined,
  tabPhase: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): boolean {
  if (photoPhase == null || photoPhase === '') return true;
  return normalizeRoomPhase(photoPhase, workflow) === tabPhase;
}

export type PhaseChipUi = {
  status: 'Active' | 'Open' | 'Locked' | 'Completed' | 'Not started';
  /** Short progress text for the chip, e.g. "3/7" or "2 missing" */
  progress: string;
  isMain: boolean;
  workerLocked: boolean;
};

/**
 * Labels and progress text for a phase chip in the room workflow bar.
 * "Active" is always the floor-board main phase; lock is indicated separately on the chip.
 */
export function computePhaseChipUi(
  phaseKey: string,
  roomPhase: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW,
  overrides: Record<string, boolean> | null | undefined,
  totalTasks: number,
  completedTasks: number
): PhaseChipUi {
  const rp = normalizeRoomPhase(roomPhase, workflow);
  const pk = normalizeRoomPhase(phaseKey, workflow);
  const workerLocked = phaseTabReadOnlyForWorker(rp, pk, workflow, overrides);
  const isMain = pk === rp;

  let progress = '';
  if (totalTasks > 0) {
    if (completedTasks === totalTasks) {
      progress = `${completedTasks}/${totalTasks}`;
    } else if (isMain) {
      progress = `${completedTasks}/${totalTasks}`;
    } else {
      progress = `${totalTasks - completedTasks} missing`;
    }
  }

  let status: PhaseChipUi['status'];
  if (isMain) {
    status = 'Active';
  } else if (workerLocked) {
    status = 'Locked';
  } else if (totalTasks === 0) {
    status = 'Not started';
  } else if (completedTasks === totalTasks) {
    status = 'Completed';
  } else {
    status = 'Open';
  }

  return { status, progress, isMain, workerLocked };
}
