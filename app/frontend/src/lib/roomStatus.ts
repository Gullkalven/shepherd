/** Shared room workflow status labels for list and board views */
export const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  not_started: { label: 'Not Started', color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800' },
  in_progress: { label: 'In Progress', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/40' },
  ready_for_inspection: { label: 'Inspection', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-900/40' },
  completed: { label: 'Completed', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/40' },
  blocked: { label: 'Blocked', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/40' },
};
