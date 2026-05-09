import { isHeatingCablePhase } from '@/lib/heatingCable';

/** Per-phase workflow step (order + labels + optional tool visibility defaults). */
export type PhaseWorkflowEntry = {
  key: string;
  label: string;
  /** When omitted, checklist UI defaults to on (backward compatible). */
  checklist_enabled?: boolean;
  /** When omitted, defaults from legacy name match (e.g. Varmekabel) until set explicitly. */
  heating_cable_enabled?: boolean;
};

/** Room-level overrides merged on top of project workflow (see `resolvePhaseTools`). */
export type PhaseToolOverride = {
  checklist?: boolean;
  heating_cable?: boolean;
};

export type PhaseToolFlags = {
  checklist: boolean;
  heating_cable: boolean;
};

/** Parse `rooms.phase_tool_overrides` from the API. */
export function coercePhaseToolOverrides(raw: unknown): Record<string, PhaseToolOverride> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, PhaseToolOverride> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || !k.trim()) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const entry: PhaseToolOverride = {};
    if (typeof o.checklist === 'boolean') entry.checklist = o.checklist;
    if (typeof o.heating_cable === 'boolean') entry.heating_cable = o.heating_cable;
    if (Object.keys(entry).length) out[k.trim()] = entry;
  }
  return out;
}

/**
 * Effective tools for one phase: room overrides win, then workflow JSON, then legacy defaults.
 * Historical “Varmekabel” phases keep heating on via `isHeatingCablePhase` when no explicit flag exists.
 */
/** True if project workflow + room overrides enable heating cable anywhere (admin overview / cards). */
export function roomRequiresHeatingCableDocumentation(
  room: { phase_tool_overrides?: unknown },
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): boolean {
  const toolOv = coercePhaseToolOverrides(room.phase_tool_overrides);
  return workflow.some((e) => resolvePhaseTools(e, toolOv[e.key]).heating_cable);
}

export function resolvePhaseTools(
  entry: PhaseWorkflowEntry | undefined,
  roomOverride: PhaseToolOverride | null | undefined
): PhaseToolFlags {
  const checklist =
    roomOverride?.checklist ??
    (entry?.checklist_enabled !== undefined ? entry.checklist_enabled : true);
  let heating_cable = roomOverride?.heating_cable;
  if (heating_cable === undefined) {
    heating_cable =
      entry?.heating_cable_enabled !== undefined
        ? entry.heating_cable_enabled
        : entry
          ? isHeatingCablePhase(entry.key, entry.label)
          : false;
  }
  return { checklist, heating_cable };
}

/** Per workflow-step status (independent of overall room.status). */
export const PHASE_STEP_STATUS_VALUES = ['not_started', 'in_progress', 'complete', 'blocked'] as const;
export type PhaseStepStatus = (typeof PHASE_STEP_STATUS_VALUES)[number];

export function normalizePhaseStepStatus(
  raw: string | null | undefined,
  fallback: PhaseStepStatus = 'not_started'
): PhaseStepStatus {
  const s = raw != null ? String(raw).trim() : '';
  return PHASE_STEP_STATUS_VALUES.includes(s as PhaseStepStatus) ? (s as PhaseStepStatus) : fallback;
}

/**
 * Legacy single-pointer model: exactly one step is in_progress; earlier complete; later not_started.
 */
export function deriveLinearPhaseStatusesFromPointer(
  legacyPhase: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): Record<string, PhaseStepStatus> {
  const keys = phaseKeys(workflow);
  const rn = normalizeRoomPhase(legacyPhase, workflow);
  const ri = keys.indexOf(rn);
  const r = ri >= 0 ? ri : 0;
  const out: Record<string, PhaseStepStatus> = {};
  keys.forEach((k, i) => {
    if (i < r) out[k] = 'complete';
    else if (i === r) out[k] = 'in_progress';
    else out[k] = 'not_started';
  });
  return out;
}

/**
 * Merge persisted map with legacy pointer fallback (when API returns null / unknown keys).
 */
export function resolvePhaseStepStatuses(
  raw: Record<string, unknown> | null | undefined,
  legacyPhase: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): Record<string, PhaseStepStatus> {
  const base = deriveLinearPhaseStatusesFromPointer(legacyPhase, workflow);
  if (!raw || typeof raw !== 'object') return base;
  const keys = phaseKeys(workflow);
  const next = { ...base };
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && PHASE_STEP_STATUS_VALUES.includes(v as PhaseStepStatus)) {
      next[k] = v as PhaseStepStatus;
    }
  }
  return next;
}

/** First in-progress step in workflow order; falls back to legacy pointer when none in progress. */
export function focusPhaseKeyFromStatuses(
  statuses: Record<string, PhaseStepStatus>,
  legacyFallback: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): string {
  for (const k of phaseKeys(workflow)) {
    if (statuses[k] === 'in_progress') return k;
  }
  return normalizeRoomPhase(legacyFallback, workflow);
}

export function inProgressPhaseKeys(
  statuses: Record<string, PhaseStepStatus>,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): string[] {
  return phaseKeys(workflow).filter((k) => statuses[k] === 'in_progress');
}

export function phaseTabLockedFromResolvedStatuses(
  statuses: Record<string, PhaseStepStatus>,
  tabPhase: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW,
  overrides?: Record<string, boolean> | null
): boolean {
  const tn = normalizeRoomPhase(tabPhase, workflow);
  const st = statuses[tn] ?? 'not_started';
  const defaultLocked = st !== 'in_progress';
  const o = overrides?.[tn];
  if (o === true) return true;
  if (o === false) return false;
  return defaultLocked;
}

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

/** Timeline hint when per-step statuses are available (worker “another phase” card). */
export function phaseTimelineFromStepStatus(
  stepStatus: PhaseStepStatus,
  tabPhase: string,
  focusPhaseKey: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): 'done' | 'active' | 'upcoming' {
  const tn = normalizeRoomPhase(tabPhase, workflow);
  if (stepStatus === 'complete') return 'done';
  if (stepStatus === 'in_progress')
    return tn === normalizeRoomPhase(focusPhaseKey, workflow) ? 'active' : 'active';
  if (stepStatus === 'blocked') return 'upcoming';
  return 'upcoming';
}

/**
 * Whether workers should be read-only in this phase tab.
 * With optional resolved per-step statuses: only `in_progress` is editable by default.
 * Without resolvedStatuses: legacy rule — phases after the single board phase are locked.
 * Admin overrides: { phaseKey: true } forces locked; { phaseKey: false } forces unlocked.
 */
export function phaseTabReadOnlyForWorker(
  roomPhase: string,
  tabPhase: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW,
  overrides?: Record<string, boolean> | null,
  resolvedStatuses?: Record<string, PhaseStepStatus> | null
): boolean {
  if (resolvedStatuses && Object.keys(resolvedStatuses).length > 0) {
    return phaseTabLockedFromResolvedStatuses(resolvedStatuses, tabPhase, workflow, overrides);
  }
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

/** Compact legend for the room card, e.g. D✓ V● R○ S○ — optional per-step statuses for overlapping work */
export function formatPhaseStrip(
  roomPhase: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW,
  resolvedStatuses?: Record<string, PhaseStepStatus> | null
): string {
  const keys = phaseKeys(workflow);
  if (resolvedStatuses && Object.keys(resolvedStatuses).length > 0) {
    return keys
      .map((key, i) => {
        const L = phaseLabel(key, workflow).trim().charAt(0).toUpperCase() || String(i + 1);
        const st = resolvedStatuses[key] ?? 'not_started';
        if (st === 'complete') return `${L}✓`;
        if (st === 'in_progress') return `${L}●`;
        if (st === 'blocked') return `${L}✖`;
        return `${L}○`;
      })
      .join(' ');
  }
  const rn = normalizeRoomPhase(roomPhase, workflow);
  const ri = keys.indexOf(rn);
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
  status: 'Active' | 'Open' | 'Locked' | 'Completed' | 'Not started' | 'Blocked';
  /** Short progress text for the chip, e.g. "3/7" or "2 missing" */
  progress: string;
  /** Highlight as current floor focus (first in-progress in workflow order) */
  isMain: boolean;
  workerLocked: boolean;
};

/**
 * Labels and progress text for a phase chip in the room workflow bar.
 * Pass resolved per-step statuses plus the floor-board focus key (first in-progress step).
 */
export function computePhaseChipUi(
  phaseKey: string,
  resolvedStatuses: Record<string, PhaseStepStatus>,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW,
  overrides: Record<string, boolean> | null | undefined,
  totalTasks: number,
  completedTasks: number,
  focusPhaseKey: string,
  /** When false, checklist counts do not affect chip progress text (worker checklist hidden for this phase). */
  checklistEnabled = true
): PhaseChipUi {
  const pk = normalizeRoomPhase(phaseKey, workflow);
  const fk = normalizeRoomPhase(focusPhaseKey, workflow);
  const stepStatus = resolvedStatuses[pk] ?? 'not_started';
  const workerLocked = phaseTabLockedFromResolvedStatuses(resolvedStatuses, pk, workflow, overrides);
  const isMain = pk === fk && stepStatus === 'in_progress';

  const tot = checklistEnabled ? totalTasks : 0;
  const done = checklistEnabled ? completedTasks : 0;

  let progress = '';
  if (tot > 0) {
    if (done === tot) {
      progress = `${done}/${tot}`;
    } else if (isMain || stepStatus === 'in_progress') {
      progress = `${done}/${tot}`;
    } else {
      progress = `${tot - done} missing`;
    }
  }

  let status: PhaseChipUi['status'];
  if (stepStatus === 'blocked') {
    status = 'Blocked';
  } else if (stepStatus === 'in_progress') {
    status = 'Active';
  } else if (workerLocked) {
    status = 'Locked';
  } else if (stepStatus === 'complete') {
    status = 'Completed';
  } else if (tot === 0) {
    status = 'Not started';
  } else if (done === tot) {
    status = 'Completed';
  } else {
    status = 'Open';
  }

  return { status, progress, isMain, workerLocked };
}

/** Floor board / kanban: room appears in column P when step P is in progress */
export function roomHasPhaseActiveOnBoard(
  columnPhaseKey: string,
  roomPhase: string | undefined,
  phaseStatuses: Record<string, PhaseStepStatus> | null | undefined,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): boolean {
  const ck = normalizeRoomPhase(columnPhaseKey, workflow);
  const legacy = normalizeRoomPhase(roomPhase, workflow);
  const resolved =
    phaseStatuses && Object.keys(phaseStatuses).length > 0
      ? phaseStatuses
      : deriveLinearPhaseStatusesFromPointer(legacy, workflow);
  return resolved[ck] === 'in_progress';
}
