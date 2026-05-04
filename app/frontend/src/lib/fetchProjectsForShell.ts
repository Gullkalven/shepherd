import { client, extractProjectItemsFromListBody, fetchProjectsListAll } from '@/lib/api';
import { isDevRoleSwitcherHost } from '@/lib/devRole';
import { sanitizeProjectListItems, type ProjectRecord } from '@/lib/projectEntity';
import { clearWorkerSession, readWorkerSession } from '@/lib/workerSession';

export type ShellProjectRow = ProjectRecord & { description?: string; created_at?: string };

/**
 * Loads projects via list endpoints only — never `GET /entities/projects/:id` as a list substitute.
 * PIN workers: validates JWT project scope against the list; clears stale PIN storage if missing.
 */
export async function fetchProjectsForShell(options: { isAdmin: boolean }): Promise<{
  projects: ShellProjectRow[];
  clearedStalePinSession: boolean;
}> {
  const devHost = isDevRoleSwitcherHost();
  const useProjectsAll = !devHost && options.isAdmin;
  const ws = readWorkerSession();

  if (ws?.token && ws.projectId != null) {
    const res = await client.entities.projects.query({ sort: '-created_at' });
    const items = sanitizeProjectListItems(
      extractProjectItemsFromListBody(res?.data ?? res) as unknown[]
    );
    const allowed = items.some((p) => p.id === ws.projectId);
    if (!allowed) {
      clearWorkerSession();
      try {
        localStorage.removeItem('token');
      } catch {
        /* ignore */
      }
      return { projects: [], clearedStalePinSession: true };
    }
    return {
      projects: items.filter((p) => p.id === ws.projectId),
      clearedStalePinSession: false,
    };
  }

  const res = useProjectsAll
    ? await fetchProjectsListAll()
    : await client.entities.projects.query({ sort: '-created_at' });
  const items = sanitizeProjectListItems(
    extractProjectItemsFromListBody(res?.data ?? res) as unknown[]
  );
  return { projects: items, clearedStalePinSession: false };
}
