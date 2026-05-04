/** Persists last-opened project from overview (validated against API list). Never defaults to a numeric id. */

const STORAGE_KEY = 'shepherd_selected_project_id_v1';

export function readStoredSelectedProjectId(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw || !/^\d+$/.test(raw.trim())) return null;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 1) return null;
    return n;
  } catch {
    return null;
  }
}

export function persistStoredSelectedProjectId(projectId: number): void {
  if (!Number.isSafeInteger(projectId) || projectId < 1) return;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(projectId));
  } catch {
    /* ignore */
  }
}

export function clearStoredSelectedProjectId(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Clear persisted selection only when it matches a bad route id (e.g. deleted project). */
export function clearStoredSelectedProjectIfMatches(projectId: number): void {
  const stored = readStoredSelectedProjectId();
  if (stored === projectId) {
    clearStoredSelectedProjectId();
  }
}

/** Drop stored id if it is not in the current server-backed list. */
export function validateStoredProjectAgainstList(allowedIds: ReadonlySet<number>): void {
  const stored = readStoredSelectedProjectId();
  if (stored != null && !allowedIds.has(stored)) {
    clearStoredSelectedProjectId();
  }
}
