import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import {
  readWorkerLastRoom,
  workerRoomPath,
  clearWorkerLastRoom,
  type WorkerLastRoom,
} from '@/lib/workerLastRoom';
import { DEV_ROLE_CHANGED_EVENT, readDemoLocalStorageUser } from '@/lib/devRole';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChevronRight, Layers } from 'lucide-react';

interface SiteRow {
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
  hasUser: boolean;
  /** Same project/site list as the sidebar (`Index.loadProjects`). */
  sites: SiteRow[];
  sitesLoading: boolean;
  sitesLoadFailed: boolean;
  onRefreshSites: () => void;
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

/** Local-calendar days between `iso` (activity time) and today; `0` = same calendar day. */
function calendarDaysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((startOfDay(new Date()) - startOfDay(d)) / (24 * 60 * 60 * 1000));
}

function roomReasonLabel(room: EnrichedRoom): string {
  switch (room.status) {
    case 'blocked':
      return 'Blocked';
    case 'ready_for_inspection':
      return 'Needs handoff';
    case 'not_started':
      return 'Ready to start';
    case 'completed':
      return 'Completed';
    case 'in_progress': {
      const days = calendarDaysAgo(room.updated_at);
      if (days === 0) return 'Last worked on today';
      if (days === 1) return 'Last worked on yesterday';
      if (days != null && days > 1 && days <= 30) return `Last worked on ${days} days ago`;
      return 'In progress';
    }
    default:
      return 'Ready for work';
  }
}

/** Short lines under room cards explaining why this room is highlighted (trust / clarity). */
function primaryContinueTrustLines(room: EnrichedRoom): string[] {
  const lines: string[] = [];
  const days = calendarDaysAgo(room.updated_at);
  if (days === 0) lines.push('Worked here today');
  else if (days === 1) lines.push('Worked here yesterday');
  else if (days != null && days >= 2 && days <= 30) lines.push(`Last activity ${days} days ago`);
  else lines.push('Your last opened room');

  if (room.status === 'ready_for_inspection') {
    lines.push('Priority today');
  } else if (lines.length < 2 && room.status === 'in_progress') {
    lines.push('Pick up where you left off');
  }
  return lines.slice(0, 2);
}

function primaryNextTrustLines(room: EnrichedRoom): string[] {
  switch (room.status) {
    case 'not_started':
      return ['Ready to start', 'Waiting for you'];
    case 'ready_for_inspection':
      return ['Needs handoff', 'Priority today'];
    case 'in_progress': {
      const days = calendarDaysAgo(room.updated_at);
      if (days === 0) return ['Worked here today', 'Waiting for you'];
      if (days === 1) return ['Worked here yesterday', 'Waiting for you'];
      return ['In progress', 'Waiting for you'];
    }
    default:
      return ['Ready for work', 'Waiting for you'];
  }
}

function alternateRoomTrustLines(room: EnrichedRoom): string[] {
  switch (room.status) {
    case 'not_started':
      return ['Ready to start', 'Waiting for you'];
    case 'ready_for_inspection':
      return ['Needs handoff', 'Waiting for you'];
    case 'in_progress':
      return ['In progress', 'Next when you are ready'];
    default:
      return [roomReasonLabel(room)];
  }
}

const ACTIONABLE = new Set(['not_started', 'in_progress', 'ready_for_inspection']);

/** Backend rejects higher limits with 422 (see FloorDetail / routers/tasks.py). */
const TASKS_QUERY_LIMIT = 2000;

export default function WorkerTodayView({
  hasUser,
  sites,
  sitesLoading,
  sitesLoadFailed,
  onRefreshSites,
}: WorkerTodayViewProps) {
  const navigate = useNavigate();
  const { displayName } = usePermissions();
  const [roomsFlat, setRoomsFlat] = useState<EnrichedRoom[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  /** Tasks + floors/rooms for Today cards (sites come from parent Index). */
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  const [taskSummaryUnavailable, setTaskSummaryUnavailable] = useState(false);
  const [lastLocal, setLastLocal] = useState<WorkerLastRoom | null>(() => readWorkerLastRoom());
  const enrichmentSeq = useRef(0);

  const loadEnrichment = useCallback(async () => {
    const demoOrUser = readDemoLocalStorageUser() !== null || hasUser;
    if (!demoOrUser) {
      setRoomsFlat([]);
      setTasks([]);
      setTaskSummaryUnavailable(false);
      setEnrichmentLoading(false);
      return;
    }

    if (sitesLoading || sites.length === 0) {
      setRoomsFlat([]);
      setTasks([]);
      setTaskSummaryUnavailable(false);
      setEnrichmentLoading(false);
      return;
    }

    const seq = ++enrichmentSeq.current;
    setEnrichmentLoading(true);
    setTaskSummaryUnavailable(false);

    try {
      try {
        const tasksRes = await client.entities.tasks.query({
          limit: TASKS_QUERY_LIMIT,
          sort: 'room_id',
        });
        if (seq !== enrichmentSeq.current) return;
        setTasks((tasksRes?.data?.items || []) as TaskRow[]);
      } catch (err) {
        console.error('[WorkerToday] tasks summary failed', err);
        if (seq !== enrichmentSeq.current) return;
        setTasks([]);
        setTaskSummaryUnavailable(true);
      }

      const enriched: EnrichedRoom[] = [];
      const plist = sites;
      for (let i = 0; i < plist.length; i++) {
        const p = plist[i];
        try {
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
        } catch (err) {
          console.error('[WorkerToday] floors/rooms for project failed', p.id, err);
        }
      }
      if (seq !== enrichmentSeq.current) return;
      enriched.sort(sortRooms);
      setRoomsFlat(enriched);
    } finally {
      if (seq === enrichmentSeq.current) {
        setEnrichmentLoading(false);
      }
    }
  }, [hasUser, sites, sitesLoading]);

  useEffect(() => {
    void loadEnrichment();
  }, [loadEnrichment]);

  useEffect(() => {
    const onRole = () => {
      setLastLocal(readWorkerLastRoom());
      void loadEnrichment();
    };
    window.addEventListener(DEV_ROLE_CHANGED_EVENT, onRole);
    return () => window.removeEventListener(DEV_ROLE_CHANGED_EVENT, onRole);
  }, [loadEnrichment]);

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
      return sites.find((p) => p.id === resumeRoom.projectId) ?? null;
    }
    if (fallbackReady) {
      return sites.find((p) => p.id === fallbackReady.projectId) ?? null;
    }
    if (sites.length === 1) return sites[0];
    return sites[0] ?? null;
  }, [resumeRoom, fallbackReady, sites]);

  const greeting = displayName?.trim() ? `, ${displayName.trim()}` : '';

  const primaryRoom = resumeRoom ?? fallbackReady;
  const primaryRoomLabel =
    resumeRoom?.label ?? primaryRoom?.room_number ?? (primaryRoom ? String(primaryRoom.id) : '');

  const primaryTrustLines = useMemo(() => {
    if (!primaryRoom) return [];
    return resumeRoom ? primaryContinueTrustLines(primaryRoom) : primaryNextTrustLines(primaryRoom);
  }, [primaryRoom, resumeRoom]);

  /** Initial sites list; avoid empty-state flash before Index finishes first fetch. */
  if (sitesLoading && sites.length === 0) {
    return (
      <div className="min-h-dvh bg-slate-50 dark:bg-background flex items-center justify-center pb-8">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  const goRoom = (r: EnrichedRoom) => {
    const focusChecklist = r.status !== 'blocked';
    navigate(workerRoomPath(r.projectId, r.floorId, r.id, { focusChecklist }));
  };

  const showSitesFailure = sitesLoadFailed && sites.length === 0;

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-background pb-10">
      <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-none lg:px-6 xl:px-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground">Today</h1>
          <p className="text-sm text-muted-foreground">My rooms{greeting}</p>
        </div>

        {showSitesFailure ? (
          <Card className="border-amber-200/80 bg-amber-50/40 p-6 text-center dark:border-amber-900/40 dark:bg-amber-950/20">
            <p className="text-sm font-medium text-slate-900 dark:text-foreground">Couldn&apos;t load projects</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check your connection and try again. Your session is still active.
            </p>
            <Button
              type="button"
              className="mt-4 bg-[#1E3A5F] hover:bg-[#2a4f7a] dark:bg-blue-700 dark:hover:bg-blue-600"
              onClick={() => onRefreshSites()}
            >
              Retry
            </Button>
          </Card>
        ) : sites.length === 0 ? (
          <Card className="p-8 text-center">
            <Layers className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-muted-foreground">No projects yet</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {sitesLoadFailed && sites.length > 0 && (
              <Card className="border-dashed border-amber-200/70 bg-amber-50/30 p-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100/90">
                Project list may be out of date (last refresh failed).{' '}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  onClick={() => onRefreshSites()}
                >
                  Refresh
                </button>
              </Card>
            )}

            {/* lg+: site context before actions. Compact: primary room actions first so they stay above the fold. */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 max-lg:order-2 lg:order-1">
                {primaryProject && (
                  <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2 lg:py-2.5 dark:bg-muted/15">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 text-sm leading-snug">
                        <span className="text-muted-foreground">Current site:</span>{' '}
                        <span className="font-semibold text-slate-900 dark:text-foreground">{primaryProject.name}</span>
                      </p>
                      {sites.length > 1 ? (
                        <details className="group relative shrink-0">
                          <summary className="cursor-pointer list-none text-xs font-semibold text-[#1E3A5F] underline-offset-2 hover:underline dark:text-blue-400 [&::-webkit-details-marker]:hidden">
                            <span className="inline-flex items-center gap-0.5">
                              Other sites
                              <ChevronRight className="h-3.5 w-3.5 transition group-open:rotate-90" aria-hidden />
                            </span>
                          </summary>
                          <div className="mt-2 space-y-0.5 border-t border-border/60 pt-2">
                            {sites.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
                                  p.id === primaryProject.id ? 'bg-slate-100/80 font-medium dark:bg-slate-800/80' : ''
                                }`}
                                onClick={() => navigate(`/project/${p.id}`)}
                              >
                                <span className="truncate">{p.name}</span>
                                {p.id === primaryProject.id ? (
                                  <span className="shrink-0 text-[10px] font-medium uppercase text-muted-foreground">
                                    Current
                                  </span>
                                ) : (
                                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                )}
                              </button>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 max-lg:order-1 lg:order-2">
                {enrichmentLoading && (
                  <p className="text-xs text-muted-foreground">Loading today&apos;s rooms…</p>
                )}

                {taskSummaryUnavailable && (
                  <Card className="border-dashed border-amber-200/70 bg-amber-50/30 p-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100/90">
                    Checklist progress couldn&apos;t be loaded. You can still open rooms below.
                  </Card>
                )}
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
                      {primaryTrustLines.length > 0 && (
                        <div className="space-y-0.5 pt-0.5">
                          {primaryTrustLines.map((line, i) => (
                            <span key={`${i}-${line}`} className="block text-sm leading-snug text-white/80">
                              {line}
                            </span>
                          ))}
                        </div>
                      )}
                      <span className="block text-sm leading-snug text-white/75 line-clamp-2 border-t border-white/15 pt-1.5 mt-0.5">
                        {primaryRoom ? taskSubtitle(primaryRoom.id, tasks) : ''}
                      </span>
                    </div>
                    <ChevronRight className="h-7 w-7 shrink-0 self-center text-white/90" aria-hidden />
                  </Button>
                )}

                {!primaryRoom && primaryProject && (
                  <Card className="border-dashed p-4">
                    <p className="text-sm text-muted-foreground">
                      No rooms are ready to open from Today yet. Open the project to pick a floor or room.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 w-full border-[#1E3A5F]/30 text-[#1E3A5F] hover:bg-slate-50 dark:border-blue-700/50 dark:text-blue-400 dark:hover:bg-slate-900"
                      onClick={() => navigate(`/project/${primaryProject.id}`)}
                    >
                      Open project
                    </Button>
                  </Card>
                )}

                {alternateReady && (
                  <Card
                    className="shepherd-interactive-card cursor-pointer p-4 transition hover:bg-slate-50/80 dark:hover:bg-slate-900/50"
                    onClick={() => goRoom(alternateReady)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Another room ready</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-foreground">
                          Room {alternateReady.room_number}
                        </p>
                        <div className="space-y-0.5 pt-0.5">
                          {alternateRoomTrustLines(alternateReady).map((line, i) => (
                            <p key={`${i}-${line}`} className="text-sm text-muted-foreground leading-snug">
                              {line}
                            </p>
                          ))}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
                    </div>
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
                        <p className="text-sm text-red-700/90 dark:text-red-300/90">Open to see why</p>
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
                    </div>
                  </Card>
                )}

                <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border/70 bg-white/50 px-3 py-2.5 dark:bg-background/50">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Finished today
                  </span>
                  <span className="text-2xl font-bold tabular-nums leading-none text-slate-900 dark:text-foreground">
                    {completedTodayCount}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
