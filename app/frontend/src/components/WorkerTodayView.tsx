import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePermissions } from '@/lib/permissions';
import { resolveWorkerActorLabel } from '@/lib/workerIdentity';
import {
  readWorkerLastRoom,
  workerRoomPath,
  clearWorkerLastRoom,
  WORKER_HOME_FIND_ROOM_HASH,
  type WorkerLastRoom,
} from '@/lib/workerLastRoom';
import { DEV_ROLE_CHANGED_EVENT } from '@/lib/devRole';
import { useWorkerRoomEnrichment, type EnrichedRoom, type TaskRow } from '@/hooks/useWorkerRoomEnrichment';
import { phaseLabel } from '@/lib/roomPhases';
import { persistStoredSelectedProjectId } from '@/lib/selectedProjectStorage';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ChevronRight, Layers } from 'lucide-react';

interface SiteRow {
  id: number;
  name: string;
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
  if (done >= total) return `${done}/${total} marked`;
  return `${done}/${total} open`;
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
    lines.push('Needs handoff');
  } else if (lines.length < 2 && room.status === 'in_progress') {
    lines.push('Same room as before');
  }
  return lines.slice(0, 2);
}

function primaryNextTrustLines(room: EnrichedRoom): string[] {
  switch (room.status) {
    case 'not_started':
      return ['Ready to start'];
    case 'ready_for_inspection':
      return ['Needs handoff'];
    case 'in_progress': {
      const days = calendarDaysAgo(room.updated_at);
      if (days === 0) return ['Worked here today'];
      if (days === 1) return ['Worked here yesterday'];
      return ['In progress'];
    }
    default:
      return ['Ready for work'];
  }
}

function alternateRoomTrustLines(room: EnrichedRoom): string[] {
  switch (room.status) {
    case 'not_started':
      return ['Ready to start'];
    case 'ready_for_inspection':
      return ['Needs handoff'];
    case 'in_progress':
      return ['In progress'];
    default:
      return [roomReasonLabel(room)];
  }
}

const ACTIONABLE = new Set(['not_started', 'in_progress', 'ready_for_inspection']);

function sortBrowseRooms(a: EnrichedRoom, b: EnrichedRoom): number {
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

function compactRoomMeta(room: EnrichedRoom): string {
  const phase = room.phase ? phaseLabel(room.phase) : null;
  if (phase) return phase;
  return roomReasonLabel(room);
}

export default function WorkerTodayView({
  hasUser,
  sites,
  sitesLoading,
  sitesLoadFailed,
  onRefreshSites,
}: WorkerTodayViewProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { displayName, sessionIsPinWorker } = usePermissions();
  const [lastLocal, setLastLocal] = useState<WorkerLastRoom | null>(() => readWorkerLastRoom());
  const [roomSearch, setRoomSearch] = useState('');

  const { roomsFlat, tasks, enrichmentLoading, taskSummaryUnavailable } = useWorkerRoomEnrichment(
    sites,
    sitesLoading,
    hasUser
  );

  useEffect(() => {
    const onRole = () => {
      setLastLocal(readWorkerLastRoom());
    };
    window.addEventListener(DEV_ROLE_CHANGED_EVENT, onRole);
    return () => window.removeEventListener(DEV_ROLE_CHANGED_EVENT, onRole);
  }, []);

  useEffect(() => {
    setLastLocal(readWorkerLastRoom());
  }, [roomsFlat]);

  /** Bottom nav “Search” opens `/#find-room` and focuses the room finder. */
  useEffect(() => {
    const h = location.hash.replace(/^#/, '');
    if (h !== WORKER_HOME_FIND_ROOM_HASH) return;
    const id = window.requestAnimationFrame(() => {
      const el = searchInputRef.current;
      if (el) {
        el.focus({ preventScroll: false });
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [location.hash, location.pathname]);

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

  const fallbackReady = useMemo(() => {
    const list = roomsFlat.filter((r) => ACTIONABLE.has(r.status));
    return list.length ? list[0] : null;
  }, [roomsFlat]);

  const alternateReady = useMemo(() => {
    if (!resumeRoom) return null;
    const list = roomsFlat.filter((r) => ACTIONABLE.has(r.status) && r.id !== resumeRoom.id);
    return list.length ? list[0] : null;
  }, [roomsFlat, resumeRoom]);

  const blockedRooms = useMemo(() => roomsFlat.filter((r) => r.status === 'blocked').sort(sortBrowseRooms), [roomsFlat]);

  const blockedCount = blockedRooms.length;

  const actionableRoomCount = useMemo(
    () => roomsFlat.filter((r) => ACTIONABLE.has(r.status)).length,
    [roomsFlat]
  );

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

  const loginLabel =
    resolveWorkerActorLabel(displayName) ||
    (sessionIsPinWorker ? 'Sign in (PIN required)' : 'Set your name on a checklist item');

  const primaryRoom = resumeRoom ?? fallbackReady;
  const primaryRoomLabel =
    resumeRoom?.label ?? primaryRoom?.room_number ?? (primaryRoom ? String(primaryRoom.id) : '');

  const primaryTrustLines = useMemo(() => {
    if (!primaryRoom) return [];
    return resumeRoom ? primaryContinueTrustLines(primaryRoom) : primaryNextTrustLines(primaryRoom);
  }, [primaryRoom, resumeRoom]);

  const searchTrim = roomSearch.trim().toLowerCase();
  const browseRooms = useMemo(() => {
    let list = roomsFlat;
    if (searchTrim) {
      list = list.filter(
        (r) =>
          String(r.room_number).toLowerCase().includes(searchTrim) ||
          r.projectName.toLowerCase().includes(searchTrim)
      );
    }
    return [...list].sort(sortBrowseRooms);
  }, [roomsFlat, searchTrim]);

  /** Extra in-progress rooms for Continue work (excluding primary CTA room). */
  const continueExtras = useMemo(() => {
    const anchorId = primaryRoom?.id;
    const inProg = roomsFlat
      .filter((r) => r.status === 'in_progress' && r.id !== anchorId)
      .sort(sortBrowseRooms)
      .slice(0, 3);
    return inProg;
  }, [roomsFlat, primaryRoom?.id]);

  if (sitesLoading && sites.length === 0) {
    return (
      <div className="flex min-h-dvh min-w-0 max-w-full items-center justify-center overflow-x-hidden bg-slate-50 dark:bg-background lg:pb-10">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  const goRoom = (r: EnrichedRoom) => {
    const focusChecklist = r.status !== 'blocked';
    navigate(workerRoomPath(r.projectId, r.floorId, r.id, { focusChecklist }));
  };

  const showSitesFailure = sitesLoadFailed && sites.length === 0;

  const primaryActionLabel = (() => {
    if (!primaryRoom) return '';
    if (resumeRoom) return 'Continue';
    if (primaryRoom.status === 'not_started') return 'Start';
    if (primaryRoom.status === 'ready_for_inspection') return 'Continue handoff';
    return 'Open room';
  })();

  return (
    <div className="min-h-dvh min-w-0 max-w-full overflow-x-hidden bg-slate-50 pb-4 dark:bg-background lg:pb-10">
      <div className="mx-auto w-full min-w-0 max-w-lg space-y-4 pb-4 pt-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] lg:max-w-none lg:px-6 xl:px-8">
        <header className="space-y-2">
          <p className="text-base font-semibold text-slate-900 dark:text-foreground">
            Logged in as {loginLabel}
          </p>
          {actionableRoomCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              {actionableRoomCount} room{actionableRoomCount === 1 ? '' : 's'} with open work
            </p>
          ) : null}
        </header>

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
            <Layers className="mx-auto mb-3 h-12 w-12 text-slate-300 dark:text-slate-600" />
            <p className="text-muted-foreground">No projects yet</p>
          </Card>
        ) : (
          <div className="space-y-5">
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

            {primaryProject && sites.length > 1 && (
              <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2 text-sm dark:bg-muted/15">
                <span className="text-muted-foreground">Site: </span>
                <span className="font-semibold text-slate-900 dark:text-foreground">{primaryProject.name}</span>
                <details className="group relative mt-2">
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
                        className={`flex w-full min-h-11 items-center justify-between rounded-md px-2 py-2.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
                          p.id === primaryProject.id ? 'bg-slate-100/80 font-medium dark:bg-slate-800/80' : ''
                        }`}
                        onClick={() => {
                          persistStoredSelectedProjectId(p.id);
                          navigate(`/project/${p.id}`);
                        }}
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
              </div>
            )}

            <section className="space-y-3" aria-labelledby="continue-work-heading">
              <h2 id="continue-work-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Continue work
              </h2>
              {enrichmentLoading && <p className="text-xs text-muted-foreground">Loading rooms…</p>}

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
                  className="h-auto min-h-[5.25rem] w-full flex-row items-stretch justify-between gap-4 rounded-2xl bg-[#1E3A5F] px-4 py-4 text-left shadow-lg transition hover:bg-[#2a4f7a] dark:bg-blue-700 dark:hover:bg-blue-600 sm:px-5 sm:py-5"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <span className="block text-lg font-bold leading-tight text-white">
                      Room {primaryRoomLabel}
                    </span>
                    <span className="block text-sm font-medium text-white/90">{compactRoomMeta(primaryRoom)}</span>
                    {primaryTrustLines.length > 0 && (
                      <div className="space-y-0.5 pt-0.5">
                        {primaryTrustLines.map((line, i) => (
                          <span key={`${i}-${line}`} className="block text-sm leading-snug text-white/80">
                            {line}
                          </span>
                        ))}
                      </div>
                    )}
                    <span className="block border-t border-white/15 pt-1.5 text-sm leading-snug text-white/75 line-clamp-2">
                      {taskSubtitle(primaryRoom.id, tasks)}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end justify-center gap-1 self-center">
                    <span className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-bold text-white">{primaryActionLabel}</span>
                    <ChevronRight className="h-6 w-6 text-white/90" aria-hidden />
                  </div>
                </Button>
              )}

              {continueExtras.map((r) => (
                <Card
                  key={r.id}
                  className="shepherd-interactive-card cursor-pointer p-3.5 transition hover:bg-slate-50/90 dark:hover:bg-slate-900/40"
                  onClick={() => goRoom(r)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">In progress</p>
                      <p className="text-base font-semibold text-slate-900 dark:text-foreground">Room {r.room_number}</p>
                      <p className="text-sm text-muted-foreground">{r.projectName}</p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-[#1E3A5F] px-3 py-1.5 text-sm font-bold text-white dark:bg-blue-700">
                      Continue
                    </span>
                  </div>
                </Card>
              ))}

              {!primaryRoom && primaryProject && (
                <Card className="border-dashed p-4">
                  <p className="text-sm text-muted-foreground">
                    No rooms are ready to open yet. Pick a room below or open the site list.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 w-full min-h-11 border-[#1E3A5F]/30 text-[#1E3A5F] hover:bg-slate-50 dark:border-blue-700/50 dark:text-blue-400 dark:hover:bg-slate-900"
                    onClick={() => {
                      persistStoredSelectedProjectId(primaryProject.id);
                      navigate(`/project/${primaryProject.id}`);
                    }}
                  >
                    Open site
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
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Another ready room
                      </p>
                      <p className="text-lg font-semibold text-slate-900 dark:text-foreground">
                        Room {alternateReady.room_number}
                      </p>
                      <div className="space-y-0.5 pt-0.5">
                        {alternateRoomTrustLines(alternateReady).map((line, i) => (
                          <p key={`${i}-${line}`} className="text-sm leading-snug text-muted-foreground">
                            {line}
                          </p>
                        ))}
                      </div>
                    </div>
                    <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
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
                    <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
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
            </section>

            <section
              id="worker-find-room-anchor"
              className="scroll-mt-24 space-y-2"
              aria-labelledby="room-search-heading"
            >
              <h2 id="room-search-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Find a room
              </h2>
              <label className="sr-only" htmlFor="worker-today-room-search">
                Search by room number
              </label>
              <Input
                ref={searchInputRef}
                id="worker-today-room-search"
                type="search"
                placeholder="Room number or site"
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                className="h-12 text-base"
                autoComplete="off"
              />
            </section>

            <section className="space-y-2" aria-labelledby="all-rooms-heading">
              <h2 id="all-rooms-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                All rooms
              </h2>
              <ul className="space-y-2">
                {browseRooms.map((r) => (
                  <li key={`${r.projectId}-${r.id}`}>
                    <Card
                      className="shepherd-interactive-card cursor-pointer p-3.5 transition hover:bg-slate-50/90 dark:hover:bg-slate-900/40"
                      onClick={() => goRoom(r)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-base font-semibold text-slate-900 dark:text-foreground">
                            Room {r.room_number}
                          </p>
                          <p className="text-sm text-muted-foreground">{r.projectName}</p>
                          <p className="text-sm text-muted-foreground">
                            {compactRoomMeta(r)} · {taskSubtitle(r.id, tasks)}
                          </p>
                        </div>
                        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
              {browseRooms.length === 0 && !enrichmentLoading && (
                <p className="text-center text-sm text-muted-foreground">No matching rooms</p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
