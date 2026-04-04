import { client } from '@/lib/api';

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

export function effectiveTaskPhase(
  taskPhase: string | null | undefined,
  roomPhaseWhenUnknown: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
): string {
  if (taskPhase != null && String(taskPhase) !== '') return normalizeRoomPhase(taskPhase, workflow);
  return normalizeRoomPhase(roomPhaseWhenUnknown, workflow);
}

/** After the room’s phase changes: move incomplete checklist items from the old bucket into the new one. */
export async function syncIncompleteTasksPhaseForRoom(
  roomId: number,
  oldPhase: string,
  newPhase: string,
  workflow: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW
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
        const eff = effectiveTaskPhase(t.phase, oldPhase, workflow);
        return eff === oldPhase;
      })
      .map((t) => client.entities.tasks.update({ id: String(t.id), data: { phase: newPhase } }))
  );
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
