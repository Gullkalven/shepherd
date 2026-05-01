import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { client, fetchProjectsListAll } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import {
  readWorkerLastRoom,
  workerRoomPath,
  clearWorkerLastRoom,
  type WorkerLastRoom,
} from '@/lib/workerLastRoom';
import { PROJECTS_NAV_REFRESH_EVENT } from '@/lib/runAppLogout';
import { DEV_ROLE_CHANGED_EVENT, isDevRoleSwitcherHost, readDemoLocalStorageUser } from '@/lib/devRole';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChevronRight, FolderOpen, Layers } from 'lucide-react';
import { toast } from 'sonner';

interface ProjectRow {
  id: number;
  name: string;
}

interface FloorRow {
  id: number;
  floor_number: number;
  project_id: number;
  name?: string;
}

interface RoomRow {
  id: number;
  floor_id: number;
  room_number: string;
  status: string;
  updated_at?: string | null;
}

interface TaskRow {
  room_id: number;
  name?: string;
  is_completed?: boolean | null;
}

export type WorkerTodayViewProps = {
  /** Signed-in user present (same gate as parent Index). */
  hasUser: boolean;
};

function isLocalDateToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function taskSubtitle(roomId: number, tasks: TaskRow[]): string {
  const list = tasks.filter((t) => Number(t.room_id) === roomId);
  const total = list.length;
  if (total === 0) return 'Open room';
  const done = list.filter((t) => t.is_completed).length;
  if (done >= total) return `${done}/${total} done`;
  const next = list.find((t) => !t.is_completed);
  const name = next?.name?.trim();
  return name ? `${done}/${total} · ${name}` : `${done}/${total} tasks left`;
}

type EnrichedRoom = {
  projectId: number;
  projectName: string;
  projectOrder: number;
  floorId: number;
  floorNumber: number;
  id: number;
  room_number: string;
  status: string;
  updated_at?: string | null;
};

function sortRooms(a: EnrichedRoom, b: EnrichedRoom): number {
  if (a.projectOrder !== b.projectOrder) return a.projectOrder - b.projectOrder;
  if (a.floorNumber !== b.floorNumber) return a.floorNumber - b.floorNumber;
  const byNum = String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true });
  return byNum !== 0 ? byNum : a.id - b.id;
}

const ACTIONABLE = new Set(['not_started', 'in_progress', 'ready_for_inspection']);

export default function WorkerTodayView({ hasUser }: WorkerTodayViewProps) {
  const navigate = useNavigate();
  const { displayName } = usePermissions();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [roomsFlat, setRoomsFlat] = useState<EnrichedRoom[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastLocal, setLastLocal] = useState<WorkerLastRoom | null>(() => readWorkerLastRoom());

  const loadTodayData = useCallback(async () => {
    const devHost = isDevRoleSwitcherHost();
    const canLoad = devHost ? hasUser : readDemoLocalStorageUser() !== null || hasUser;
    if (!canLoad) {
      setProjects([]);
      setRoomsFlat([]);
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const useProjectsAll = !devHost;
      const projRes = useProjectsAll
        ? await fetchProjectsListAll()
        : await client.entities.projects.query({ sort: '-created_at' });
      const plist = (projRes?.data?.items || []) as ProjectRow[];
      setProjects(plist);

      const tasksRes = await client.entities.tasks.query({ limit: 5000, sort: 'room_id' });
      setTasks((tasksRes?.data?.items || []) as TaskRow[]);

      const enriched: EnrichedRoom[] = [];
      for (let i = 0; i < plist.length; i++) {
        const p = plist[i];
        const [floorsRes, roomsRes] = await Promise.all([
          client.entities.floors.query({
            query: { project_id: p.id },
            sort: 'floor_number',
            limit: 100,
          }),
          client.entities.rooms.query({
            query: { project_id: p.id },
            limit: 500,
          }),
        ]);
        const floors = (floorsRes?.data?.items || []) as FloorRow[];
        const floorById = new Map(floors.map((f) => [f.id, f]));
        const rlist = (roomsRes?.data?.items || []) as RoomRow[];
        for (const r of rlist) {
          const fl = floorById.get(r.floor_id);
          if (!fl) continue;
          enriched.push({
            projectId: p.id,
            projectName: p.name,
            projectOrder: i,
            floorId: fl.id,
            floorNumber: fl.floor_number,
            id: r.id,
            room_number: r.room_number,
            status: r.status,
            updated_at: r.updated_at,
          });
        }
      }
      enriched.sort(sortRooms);
      setRoomsFlat(enriched);
    } catch {
      toast.error('Could not load Today');
      setProjects([]);
      setRoomsFlat([]);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [hasUser]);

  useEffect(() => {
    void loadTodayData();
  }, [loadTodayData]);

  useEffect(() => {
    const onRefresh = () => void loadTodayData();
    window.addEventListener(PROJECTS_NAV_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(PROJECTS_NAV_REFRESH_EVENT, onRefresh);
  }, [loadTodayData]);

  useEffect(() => {
    const onRole = () => {
      setLastLocal(readWorkerLastRoom());
      void loadTodayData();
    };
    window.addEventListener(DEV_ROLE_CHANGED_EVENT, onRole);
    return () => window.removeEventListener(DEV_ROLE_CHANGED_EVENT, onRole);
  }, [loadTodayData]);

  useEffect(() => {
    setLastLocal(readWorkerLastRoom());
  }, [roomsFlat]);

  const roomById = useMemo(() => new Map(roomsFlat.map((r) => [r.id, r])), [roomsFlat]);

  const resumeRoom = useMemo(() => {
    if (!lastLocal) return null;
    const live = roomById.get(lastLocal.roomId);
    if (!live) {
      return null;
    }
    return {
      ...live,
      label: live.room_number || `Room ${live.id}`,
    };
  }, [lastLocal, roomById]);

  useEffect(() => {
    if (!lastLocal || roomsFlat.length === 0) return;
    if (!roomById.has(lastLocal.roomId)) {
      clearWorkerLastRoom();
      setLastLocal(null);
    }
  }, [lastLocal, roomsFlat.length, roomById]);

  /** First actionable room (used when there is no valid last room). */
  const fallbackReady = useMemo(() => {
    const list = roomsFlat.filter((r) => ACTIONABLE.has(r.status));
    return list.length ? list[0] : null;
  }, [roomsFlat]);

  /** Another actionable room when the primary action is “continue last”. */
  const alternateReady = useMemo(() => {
    if (!resumeRoom) return null;
    const list = roomsFlat.filter((r) => ACTIONABLE.has(r.status) && r.id !== resumeRoom.id);
    return list.length ? list[0] : null;
  }, [roomsFlat, resumeRoom]);

  const blockedRooms = useMemo(() => roomsFlat.filter((r) => r.status === 'blocked').sort(sortRooms), [roomsFlat]);

  const blockedCount = blockedRooms.length;

  const completedTodayCount = useMemo(
    () => roomsFlat.filter((r) => r.status === 'completed' && isLocalDateToday(r.updated_at)).length,
    [roomsFlat]
  );

  const primaryProject = useMemo(() => {
    if (resumeRoom) {
      return projects.find((p) => p.id === resumeRoom.projectId) ?? null;
    }
    if (fallbackReady) {
      return projects.find((p) => p.id === fallbackReady.projectId) ?? null;
    }
    if (projects.length === 1) return projects[0];
    return projects[0] ?? null;
  }, [resumeRoom, fallbackReady, projects]);

  const greeting = displayName?.trim() ? `, ${displayName.trim()}` : '';

  if (loading) {
    return (
      <div className="min-h-dvh bg-slate-50 dark:bg-background flex items-center justify-center pb-8">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  const goRoom = (r: EnrichedRoom) => {
    navigate(workerRoomPath(r.projectId, r.floorId, r.id));
  };

  const primaryRoom = resumeRoom ?? fallbackReady;
  const primaryRoomLabel =
    resumeRoom?.label ?? primaryRoom?.room_number ?? (primaryRoom ? String(primaryRoom.id) : '');

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-background pb-10">
      <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-none lg:px-6 xl:px-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground">Today</h1>
          <p className="text-sm text-muted-foreground">My rooms{greeting}</p>
        </div>

        {projects.length === 0 ? (
          <Card className="p-8 text-center">
            <Layers className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-muted-foreground">No projects yet</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {primaryRoom && (
              <Button
                type="button"
                variant="default"
                onClick={() => goRoom(primaryRoom)}
                className="h-auto min-h-[5.5rem] w-full flex-row items-stretch justify-between gap-4 rounded-2xl bg-[#1E3A5F] px-5 py-5 text-left shadow-lg transition hover:bg-[#2a4f7a] dark:bg-blue-700 dark:hover:bg-blue-600"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <span className="block text-lg font-bold leading-tight text-white">
                    {resumeRoom ? 'Continue Last Room' : 'Next Ready Room'}
                  </span>
                  <span className="block text-base font-semibold text-white/95">Room {primaryRoomLabel}</span>
                  <span className="block text-sm leading-snug text-white/80 line-clamp-2">
                    {primaryRoom ? taskSubtitle(primaryRoom.id, tasks) : ''}
                  </span>
                </div>
                <ChevronRight className="h-7 w-7 shrink-0 self-center text-white/90" aria-hidden />
              </Button>
            )}

            {alternateReady && (
              <Card
                className="shepherd-interactive-card cursor-pointer p-4 transition hover:bg-slate-50/80 dark:hover:bg-slate-900/50"
                onClick={() => goRoom(alternateReady)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Also ready</p>
                    <p className="text-lg font-semibold text-slate-900 dark:text-foreground">
                      Room {alternateReady.room_number}
                    </p>
                    <p className="text-sm text-muted-foreground">Ready for work</p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
                </div>
              </Card>
            )}

            {!resumeRoom && !fallbackReady && (
              <Card className="border-dashed p-5 text-center">
                <p className="text-sm font-medium text-slate-800 dark:text-foreground">No rooms ready right now</p>
                <p className="mt-1 text-sm text-muted-foreground">Check blocked rooms below or open a project.</p>
              </Card>
            )}

            {blockedCount > 0 && (
              <Card
                className="shepherd-interactive-card cursor-pointer border-red-200/80 bg-red-50/50 p-4 dark:border-red-900/50 dark:bg-red-950/25"
                onClick={() => {
                  const first = blockedRooms[0];
                  if (first) goRoom(first);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                      Blocked
                    </p>
                    <p className="text-lg font-semibold text-slate-900 dark:text-foreground">
                      {blockedCount} blocked room{blockedCount === 1 ? '' : 's'}
                    </p>
                    <p className="text-sm text-red-700/90 dark:text-red-300/90">Needs attention</p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
                </div>
              </Card>
            )}

            <Card className="border-dashed bg-white/60 p-4 dark:bg-background/60">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Completed today</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-foreground">
                {completedTodayCount}
              </p>
              <p className="text-sm text-muted-foreground">rooms finished today</p>
            </Card>

            {primaryProject && (
              <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Active project
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 gap-1 px-2 text-xs font-semibold text-[#1E3A5F] dark:text-blue-400"
                    onClick={() => navigate(`/project/${primaryProject.id}`)}
                  >
                    {primaryProject.name}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            <details className="group rounded-lg border border-border/80 bg-background/80">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-muted-foreground transition hover:text-foreground [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-2">
                  Browse projects
                  <ChevronRight className="h-4 w-4 shrink-0 transition group-open:rotate-90" />
                </span>
              </summary>
              <div className="border-t border-border/60 px-2 pb-3 pt-1">
                <div className="space-y-1">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-md px-2 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-foreground dark:hover:bg-slate-800"
                      onClick={() => navigate(`/project/${p.id}`)}
                    >
                      <span className="truncate font-medium">{p.name}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
