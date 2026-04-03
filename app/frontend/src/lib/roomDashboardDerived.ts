export type ChecklistSummaryMap = Record<number, { completed: number; total: number }>;

export type DashboardStatusKind = 'blocked' | 'completed' | 'in_progress' | 'not_started';

/** Checklist progress first; blocked always wins. */
export function deriveRoomDashboardStatus(
  isBlocked: boolean,
  total: number,
  completed: number
): DashboardStatusKind {
  if (isBlocked) return 'blocked';
  if (total === 0) return 'not_started';
  if (completed >= total) return 'completed';
  if (completed === 0) return 'not_started';
  return 'in_progress';
}
