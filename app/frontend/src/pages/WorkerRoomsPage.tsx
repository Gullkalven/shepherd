import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { client, extractProjectItemsFromListBody, fetchProjectsListAll } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import { readWorkerSession } from '@/lib/workerSession';
import { resolveWorkerActorLabel } from '@/lib/workerIdentity';
import { PROJECTS_NAV_REFRESH_EVENT, APP_LOGOUT_EVENT } from '@/lib/runAppLogout';
import {
  DEV_ROLE_CHANGED_EVENT,
  ensureDemoBearerToken,
  getLocalDevUser,
  isDevRoleSwitcherHost,
  readDemoLocalStorageUser,
} from '@/lib/devRole';
import { useDevPresentationSession } from '@/lib/devPresentationSession';
import { getAuthMeEpoch, isClientLogoutGateActive } from '@/lib/appLogout';
import { useWorkerRoomEnrichment, type EnrichedRoom } from '@/hooks/useWorkerRoomEnrichment';
import { workerRoomPath } from '@/lib/workerLastRoom';
import { phaseLabel } from '@/lib/roomPhases';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ChevronRight, Layers } from 'lucide-react';
import { toast } from 'sonner';

interface Project {
  id: number;
  name: string;
}

const ACTIONABLE = new Set(['not_started', 'in_progress', 'ready_for_inspection']);

function progressLine(room: EnrichedRoom, taskDone: number, taskTotal: number): string {
  if (room.status === 'ready_for_inspection') return 'Needs handoff';
  if (room.status === 'blocked') return 'Blocked';
  if (room.status === 'completed') return 'Completed';
  const phase = room.phase ? phaseLabel(room.phase) : null;
  const tasks =
    taskTotal > 0 ? `${taskDone}/${taskTotal} checklist` : phase ? `Stage: ${phase}` : 'Open room';
  return tasks;
}

function sortRoomsWorkerPriority(a: EnrichedRoom, b: EnrichedRoom): number {
  const rank = (s: string) => {
    if (s === 'in_progress') return 0;
    if (s === 'ready_for_inspection') return 1;
    if (s === 'not_started') return 2;
    if (s === 'blocked') return 3;
    if (s === 'completed') return 4;
    return 5;
  };
  const ar = rank(a.status);
  const br = rank(b.status);
  if (ar !== br) return ar - br;
  const at = a.updated_at ? new Date(a.updated_at).getTime() : 0;
  const bt = b.updated_at ? new Date(b.updated_at).getTime() : 0;
  if (at !== bt) return bt - at;
  return String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true });
}

export default function WorkerRoomsPage() {
  const navigate = useNavigate();
  const { displayName, isWorker, loading: permLoading, sessionIsPinWorker } = usePermissions();
  const { sessionActive } = useDevPresentationSession();

  const [user, setUser] = useState<unknown>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsLoadFailed, setProjectsLoadFailed] = useState(false);
  const [roomSearch, setRoomSearch] = useState('');

  const checkAuth = useCallback(async () => {
    ensureDemoBearerToken();
    const devHost = isDevRoleSwitcherHost();
    if (devHost) {
      const stored = getLocalDevUser();
      setUser(sessionActive && stored ? stored : null);
      return;
    }
    const demo = readDemoLocalStorageUser();
    setUser(demo);
    if (isClientLogoutGateActive() && !demo) {
      return;
    }
    const startEpoch = getAuthMeEpoch();
    void client.auth
      .me()
      .then((res) => {
        if (startEpoch !== getAuthMeEpoch()) return;
        if (isClientLogoutGateActive() && !readDemoLocalStorageUser()) return;
        if (res?.data) setUser(res.data);
      })
      .catch(() => {});
  }, [sessionActive]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (permLoading) return;
    if (!isWorker) navigate('/', { replace: true });
  }, [permLoading, isWorker, navigate]);

  useEffect(() => {
    if (permLoading) return;
    if (!sessionIsPinWorker) return;
    if (!readWorkerSession()?.token) navigate('/worker/login', { replace: true });
  }, [permLoading, sessionIsPinWorker, navigate]);

  const loadProjects = useCallback(async () => {
    const devHost = isDevRoleSwitcherHost();
    const useProjectsAll = !devHost;
    const ws = readWorkerSession();
    const pinProjectId = ws?.token && ws.projectId ? ws.projectId : null;
    const canLoad = devHost ? !!user : readDemoLocalStorageUser() !== null || !!user;
    if (!canLoad) {
      setProjectsLoading(false);
      setProjectsLoadFailed(false);
      return;
    }
    setProjectsLoading(true);
    setProjectsLoadFailed(false);
    try {
      if (pinProjectId) {
        const res = await client.entities.projects.get({ id: String(pinProjectId) });
        const row = res?.data;
        setProjects(row ? [{ id: row.id, name: row.name }] : []);
      } else {
        const res = useProjectsAll
          ? await fetchProjectsListAll()
          : await client.entities.projects.query({ sort: '-created_at' });
        const items = extractProjectItemsFromListBody(res?.data ?? res) as Project[];
        setProjects(items);
      }
    } catch {
      setProjectsLoadFailed(true);
      toast.error('Failed to load projects');
    } finally {
      setProjectsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    const onNavRefresh = () => void loadProjects();
    window.addEventListener(PROJECTS_NAV_REFRESH_EVENT, onNavRefresh);
    return () => window.removeEventListener(PROJECTS_NAV_REFRESH_EVENT, onNavRefresh);
  }, [loadProjects]);

  useEffect(() => {
    const onAppLogout = () => {
      setUser(null);
      setProjects([]);
      setProjectsLoading(false);
    };
    window.addEventListener(APP_LOGOUT_EVENT, onAppLogout as EventListener);
    return () => window.removeEventListener(APP_LOGOUT_EVENT, onAppLogout as EventListener);
  }, []);

  useEffect(() => {
    const onRole = () => void checkAuth();
    window.addEventListener(DEV_ROLE_CHANGED_EVENT, onRole);
    return () => window.removeEventListener(DEV_ROLE_CHANGED_EVENT, onRole);
  }, [checkAuth]);

  const hasUser =
    isDevRoleSwitcherHost() ? !!user && sessionActive : readDemoLocalStorageUser() !== null || !!user;

  const { roomsFlat, tasks, enrichmentLoading, taskSummaryUnavailable } = useWorkerRoomEnrichment(
    projects,
    projectsLoading,
    hasUser
  );

  const taskSummaryByRoom = useMemo(() => {
    const m = new Map<number, { done: number; total: number }>();
    for (const t of tasks) {
      const rid = Number(t.room_id);
      const cur = m.get(rid) ?? { done: 0, total: 0 };
      cur.total += 1;
      if (t.is_completed) cur.done += 1;
      m.set(rid, cur);
    }
    return m;
  }, [tasks]);

  const searchTrim = roomSearch.trim().toLowerCase();

  const filteredRooms = useMemo(() => {
    let list = roomsFlat;
    if (searchTrim) {
      list = list.filter(
        (r) =>
          String(r.room_number).toLowerCase().includes(searchTrim) ||
          r.projectName.toLowerCase().includes(searchTrim)
      );
    }
    return [...list].sort(sortRoomsWorkerPriority);
  }, [roomsFlat, searchTrim]);

  const goRoom = (r: EnrichedRoom) => {
    const focusChecklist = r.status !== 'blocked';
    navigate(workerRoomPath(r.projectId, r.floorId, r.id, { focusChecklist }));
  };

  if (permLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 pb-24 dark:bg-background lg:pb-10">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  if (!isWorker) {
    return null;
  }

  if (projectsLoading && projects.length === 0) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 pb-24 dark:bg-background lg:pb-10">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  const greeting = resolveWorkerActorLabel(displayName) || 'Worker';

  return (
    <div className="min-h-dvh bg-slate-50 pb-28 dark:bg-background lg:pb-10">
      <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-none lg:px-6 xl:px-8">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rooms</p>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-foreground">All rooms</h1>
          <p className="text-sm text-muted-foreground">Logged in as {greeting}</p>
        </header>

        {projectsLoadFailed && projects.length === 0 ? (
          <Card className="border-amber-200/80 bg-amber-50/40 p-6 text-center dark:border-amber-900/40 dark:bg-amber-950/20">
            <p className="text-sm font-medium text-slate-900 dark:text-foreground">Couldn&apos;t load sites</p>
            <Button type="button" className="mt-4" onClick={() => void loadProjects()}>
              Retry
            </Button>
          </Card>
        ) : projects.length === 0 ? (
          <Card className="p-8 text-center">
            <Layers className="mx-auto mb-3 h-12 w-12 text-slate-300 dark:text-slate-600" />
            <p className="text-muted-foreground">No sites yet</p>
          </Card>
        ) : (
          <>
            <div className="space-y-2">
              <label className="sr-only" htmlFor="worker-room-search-all">
                Search by room number
              </label>
              <Input
                id="worker-room-search-all"
                type="search"
                placeholder="Search room number or site"
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                className="h-12 text-base"
                autoComplete="off"
              />
            </div>

            {enrichmentLoading && <p className="text-xs text-muted-foreground">Loading rooms…</p>}
            {taskSummaryUnavailable && (
              <Card className="border-dashed border-amber-200/70 bg-amber-50/30 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/20">
                Checklist counts unavailable — room list still works.
              </Card>
            )}

            <div className="space-y-2">
              {filteredRooms.map((r) => {
                const ts = taskSummaryByRoom.get(r.id);
                const done = ts?.done ?? 0;
                const total = ts?.total ?? 0;
                return (
                  <Card
                    key={`${r.projectId}-${r.id}`}
                    className="shepherd-interactive-card cursor-pointer p-3.5 transition hover:bg-slate-50/90 dark:hover:bg-slate-900/40"
                    onClick={() => goRoom(r)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-lg font-semibold text-slate-900 dark:text-foreground">
                            Room {r.room_number}
                          </span>
                          {ACTIONABLE.has(r.status) ? (
                            <span className="rounded-full bg-[#1E3A5F]/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#1E3A5F] dark:bg-blue-950/50 dark:text-blue-200">
                              {r.status === 'in_progress'
                                ? 'In progress'
                                : r.status === 'ready_for_inspection'
                                  ? 'Handoff'
                                  : 'Start'}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm text-muted-foreground">{r.projectName}</p>
                        <p className="text-sm text-muted-foreground">{progressLine(r, done, total)}</p>
                      </div>
                      <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    </div>
                  </Card>
                );
              })}
            </div>

            {filteredRooms.length === 0 && !enrichmentLoading && (
              <Card className="p-6 text-center text-sm text-muted-foreground">No matching rooms</Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
