import { useEffect, useRef } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { useProjectList } from '@/contexts/ProjectListContext';
import { parseProjectRouteParam } from '@/lib/projectEntity';
import { flashProjectNotFoundOnce } from '@/lib/projectNotFoundFlash';
import { clearStoredSelectedProjectIfMatches } from '@/lib/selectedProjectStorage';
import { clearWorkerLastRoomIfMatchesProject } from '@/lib/workerLastRoom';

/**
 * Blocks project routes until the shared project list is loaded, then only mounts children
 * when `:projectId` exists in that list — avoids `GET /entities/projects/:id` for unknown ids.
 */
export default function ProjectScopedLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { ready, allowedProjectIds, loading } = useProjectList();
  const parsed = parseProjectRouteParam(projectId);
  const lastRedirectKey = useRef<string | null>(null);

  useEffect(() => {
    if (parsed === null) {
      const k = 'bad-param';
      if (lastRedirectKey.current !== k) {
        lastRedirectKey.current = k;
        navigate('/', { replace: true });
      }
      return;
    }

    if (!ready) return;

    if (allowedProjectIds.has(parsed)) {
      lastRedirectKey.current = null;
      return;
    }

    const k = `missing-${parsed}`;
    if (lastRedirectKey.current === k) return;
    lastRedirectKey.current = k;

    clearWorkerLastRoomIfMatchesProject(parsed);
    clearStoredSelectedProjectIfMatches(parsed);
    flashProjectNotFoundOnce();
    navigate('/', { replace: true });
  }, [parsed, ready, allowedProjectIds, navigate]);

  if (parsed === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 dark:bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  if (!ready || loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 dark:bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  if (!allowedProjectIds.has(parsed)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 dark:bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  return <Outlet />;
}
