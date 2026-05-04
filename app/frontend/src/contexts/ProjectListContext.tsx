import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchProjectsForShell, type ShellProjectRow } from '@/lib/fetchProjectsForShell';
import { usePermissions } from '@/lib/permissions';
import { PROJECTS_NAV_REFRESH_EVENT } from '@/lib/runAppLogout';
import { bumpAuthMeEpoch } from '@/lib/appLogout';
import { validateStoredProjectAgainstList } from '@/lib/selectedProjectStorage';
import { toast } from 'sonner';

export type ProjectListContextValue = {
  projects: ShellProjectRow[];
  loading: boolean;
  failed: boolean;
  /** Permissions settled and initial list fetch finished (success or failure). */
  ready: boolean;
  allowedProjectIds: ReadonlySet<number>;
  refetch: () => Promise<void>;
};

const defaultValue: ProjectListContextValue = {
  projects: [],
  loading: false,
  failed: false,
  ready: true,
  allowedProjectIds: new Set(),
  refetch: async () => {},
};

const ProjectListContext = createContext<ProjectListContextValue>(defaultValue);

export function ProjectListProvider({ children }: { children: ReactNode }) {
  const { isAdmin, loading: permLoading } = usePermissions();
  const [projects, setProjects] = useState<ShellProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (permLoading) return;
    setLoading(true);
    setFailed(false);
    try {
      const { projects: rows, clearedStalePinSession } = await fetchProjectsForShell({ isAdmin });
      setProjects(rows);
      validateStoredProjectAgainstList(new Set(rows.map((p) => p.id)));
      if (clearedStalePinSession) {
        bumpAuthMeEpoch();
        toast.message('Site worker session ended — project is no longer available. Sign in again.');
      }
    } catch {
      setFailed(true);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, permLoading]);

  useEffect(() => {
    if (permLoading) return;
    void load();
  }, [load, permLoading]);

  useEffect(() => {
    const onRefresh = () => void load();
    window.addEventListener(PROJECTS_NAV_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(PROJECTS_NAV_REFRESH_EVENT, onRefresh);
  }, [load]);

  const allowedProjectIds = useMemo(() => {
    const ids = projects
      .map((p) => Number(p.id))
      .filter((id) => Number.isFinite(id) && Number.isSafeInteger(id) && id >= 1);
    return new Set(ids);
  }, [projects]);

  const ready = !permLoading && !loading;

  const value = useMemo<ProjectListContextValue>(
    () => ({
      projects,
      loading,
      failed,
      ready,
      allowedProjectIds,
      refetch: load,
    }),
    [projects, loading, failed, ready, allowedProjectIds, load]
  );

  return <ProjectListContext.Provider value={value}>{children}</ProjectListContext.Provider>;
}

export function useProjectList(): ProjectListContextValue {
  return useContext(ProjectListContext);
}
