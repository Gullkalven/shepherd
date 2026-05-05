import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, HardHat, House, LogOut, Moon, Sun } from 'lucide-react';
import { client } from '@/lib/api';
import { APP_NAME_PARTS } from '@/lib/branding';
import { useProjectList } from '@/contexts/ProjectListContext';
import { usePermissions } from '@/lib/permissions';
import { runAppLogout, PROJECTS_NAV_REFRESH_EVENT } from '@/lib/runAppLogout';
import { DEV_ROLE_CHANGED_EVENT } from '@/lib/devRole';
import { useTheme } from '@/lib/theme';
import { useDevPresentationSession } from '@/lib/devPresentationSession';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DevRoleSwitcher from '@/components/DevRoleSwitcher';
import { cn } from '@/lib/utils';
import { parseProjectRouteParam, unwrapProjectBody } from '@/lib/projectEntity';
import { persistStoredSelectedProjectId, readStoredSelectedProjectId } from '@/lib/selectedProjectStorage';

interface FloorRow {
  id: number;
  floor_number: number;
  name?: string;
}

interface RoomRow {
  id: number;
  floor_id: number;
  room_number: string;
}

interface ProjectRow {
  id: number;
  name: string;
}

function floorLabel(f: FloorRow): string {
  return f.name?.trim() ? f.name : `Floor ${f.floor_number}`;
}

type Variant = 'desktop' | 'sheet';

const LOGO_BUTTON_CLASS =
  'flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left transition-[background-color,box-shadow] duration-200 ease-out hover:bg-slate-200/90 hover:shadow-sm dark:hover:bg-slate-800/90';

function ShepherdLogoButton({ afterNav }: { afterNav: () => void }) {
  const navigate = useNavigate();
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const { ready, allowedProjectIds } = useProjectList();

  return (
    <button
      type="button"
      onClick={() => {
        const stored = readStoredSelectedProjectId();
        const routeParsed = routeProjectId ? parseProjectRouteParam(routeProjectId) : null;

        if (ready) {
          if (stored != null && allowedProjectIds.has(stored)) {
            navigate(`/project/${stored}`);
            afterNav();
            return;
          }
          if (routeParsed !== null && allowedProjectIds.has(routeParsed)) {
            navigate(`/project/${routeParsed}`);
            afterNav();
            return;
          }
        }
        navigate('/');
        afterNav();
      }}
      className={LOGO_BUTTON_CLASS}
    >
      <HardHat className="h-5 w-5 shrink-0 text-amber-500" />
      <span className="text-sm font-black tracking-[0.12em] uppercase">
        {APP_NAME_PARTS.prefix}
        <span className="text-amber-600/90 dark:text-amber-400/90">{APP_NAME_PARTS.dot}</span>
        {APP_NAME_PARTS.suffix}
      </span>
    </button>
  );
}

function DesktopHomeButton({ afterNav }: { afterNav: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === '/';

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'h-8 justify-start gap-2 px-2 text-sm',
        isActive
          ? 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={() => {
        if (isActive) return;
        navigate('/');
        afterNav();
      }}
      aria-current={isActive ? 'page' : undefined}
    >
      <House className="h-4 w-4" />
      <span>Home</span>
    </Button>
  );
}

export default function AppNavSidebar({
  variant,
  onNavigate,
}: {
  variant: Variant;
  onNavigate?: () => void;
}) {
  const afterNav = () => onNavigate?.();

  const inner = (
    <div className="flex h-full min-h-0 flex-col p-3 pt-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <ShepherdLogoButton afterNav={afterNav} />
        {variant === 'desktop' ? <DesktopHomeButton afterNav={afterNav} /> : null}
      </div>

      <NavSections afterNav={afterNav} />

      <SidebarFooter afterNav={afterNav} />
    </div>
  );

  if (variant === 'sheet') {
    return <div className="flex h-full min-h-0 flex-col bg-slate-50 dark:bg-background">{inner}</div>;
  }

  return (
    <aside
      className={cn(
        'hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:z-30',
        'lg:w-56 lg:border-r lg:border-border lg:bg-slate-50 lg:dark:bg-background'
      )}
      aria-label="App navigation"
    >
      {inner}
    </aside>
  );
}

function NavSections({ afterNav }: { afterNav: () => void }) {
  const { projectId, floorId, roomId } = useParams<{
    projectId?: string;
    floorId?: string;
    roomId?: string;
  }>();
  const navigate = useNavigate();
  const { projects, loading: projectsLoading, ready, allowedProjectIds } = useProjectList();
  const [projectSearch, setProjectSearch] = useState('');

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [floors, setFloors] = useState<FloorRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeSearch, setTreeSearch] = useState('');
  const [openFloors, setOpenFloors] = useState<Set<number>>(new Set());

  const activeFloorId = floorId ? Number(floorId) : NaN;
  const activeRoomId = roomId ? Number(roomId) : NaN;
  const treeSearchTrim = treeSearch.trim().toLowerCase();
  const projectSearchTrim = projectSearch.trim().toLowerCase();

  const { t } = useI18n();
  const { isWorker } = usePermissions();

  const loadProjectTree = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setFloors([]);
      setRooms([]);
      setTreeLoading(false);
      return;
    }
    const parsed = parseProjectRouteParam(projectId);
    if (parsed === null) {
      setProject(null);
      setFloors([]);
      setRooms([]);
      setTreeLoading(false);
      return;
    }
    if (!ready || !allowedProjectIds.has(parsed)) {
      setProject(null);
      setFloors([]);
      setRooms([]);
      setTreeLoading(false);
      return;
    }
    setTreeLoading(true);
    try {
      const projRes = await client.entities.projects.get({ id: String(parsed) });
      const row = unwrapProjectBody(projRes?.data);
      if (!row) {
        setProject(null);
        setFloors([]);
        setRooms([]);
        return;
      }
      const resolvedId = row.id;
      const [floorsRes, roomsRes] = await Promise.all([
        client.entities.floors.query({
          query: { project_id: resolvedId },
          sort: 'floor_number',
          limit: 100,
        }),
        client.entities.rooms.query({
          query: { project_id: resolvedId },
          limit: 500,
        }),
      ]);
      setProject({ id: row.id, name: row.name });
      setFloors((floorsRes?.data?.items || []) as FloorRow[]);
      setRooms((roomsRes?.data?.items || []) as RoomRow[]);
    } catch {
      setProject(null);
      setFloors([]);
      setRooms([]);
    } finally {
      setTreeLoading(false);
    }
  }, [projectId, navigate, ready, allowedProjectIds]);

  useEffect(() => {
    void loadProjectTree();
  }, [loadProjectTree]);

  useEffect(() => {
    const onRefresh = () => void loadProjectTree();
    window.addEventListener(PROJECTS_NAV_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(PROJECTS_NAV_REFRESH_EVENT, onRefresh);
  }, [loadProjectTree]);

  useEffect(() => {
    const onRoleChange = () => void loadProjectTree();
    window.addEventListener(DEV_ROLE_CHANGED_EVENT, onRoleChange);
    return () => window.removeEventListener(DEV_ROLE_CHANGED_EVENT, onRoleChange);
  }, [loadProjectTree]);

  useEffect(() => {
    setOpenFloors(new Set());
    setTreeSearch('');
  }, [projectId]);

  useEffect(() => {
    if (!floorId) return;
    const id = Number(floorId);
    if (Number.isNaN(id)) return;
    setOpenFloors((prev) => new Set(prev).add(id));
  }, [floorId, projectId]);

  const roomsByFloorId = useMemo(() => {
    const m = new Map<number, RoomRow[]>();
    for (const r of rooms) {
      const list = m.get(r.floor_id) ?? [];
      list.push(r);
      m.set(r.floor_id, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => {
        const byNum = String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true });
        return byNum !== 0 ? byNum : a.id - b.id;
      });
    }
    return m;
  }, [rooms]);

  const filteredFloors = useMemo(() => {
    if (!treeSearchTrim) return floors;
    return floors.filter((f) => {
      const fl = floorLabel(f).toLowerCase();
      if (fl.includes(treeSearchTrim)) return true;
      const list = roomsByFloorId.get(f.id) ?? [];
      return list.some((r) => String(r.room_number).toLowerCase().includes(treeSearchTrim));
    });
  }, [floors, roomsByFloorId, treeSearchTrim]);

  const isFloorExpanded = (f: FloorRow) => {
    if (treeSearchTrim) {
      const fl = floorLabel(f).toLowerCase();
      if (fl.includes(treeSearchTrim)) return true;
      const list = roomsByFloorId.get(f.id) ?? [];
      return list.some((r) => String(r.room_number).toLowerCase().includes(treeSearchTrim));
    }
    return openFloors.has(f.id);
  };

  const toggleFloor = (id: number) => {
    if (treeSearchTrim) return;
    setOpenFloors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredRoomsForFloor = (f: FloorRow): RoomRow[] => {
    const list = roomsByFloorId.get(f.id) ?? [];
    if (!treeSearchTrim) return list;
    const fl = floorLabel(f).toLowerCase();
    if (fl.includes(treeSearchTrim)) return list;
    return list.filter((r) => String(r.room_number).toLowerCase().includes(treeSearchTrim));
  };

  const filteredProjects = useMemo(() => {
    if (!projectSearchTrim) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(projectSearchTrim));
  }, [projects, projectSearchTrim]);

  const activeProjectId = projectId ? Number(projectId) : NaN;

  const navProjectsTitle = isWorker ? t('sites') : t('projects');
  const searchRootPlaceholder = isWorker ? t('findSite') : t('searchProjects');
  const searchRootAria = isWorker ? t('findSiteAria') : t('searchProjectsAria');
  const searchTreePlaceholder = isWorker ? t('findRoom') : t('searchFloorsAndRooms');
  const searchTreeAria = isWorker ? t('findRoomAria') : t('searchFloorsAndRoomsAria');

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <p className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{navProjectsTitle}</p>
      <Input
        type="search"
        placeholder={projectId ? searchTreePlaceholder : searchRootPlaceholder}
        value={projectId ? treeSearch : projectSearch}
        onChange={(e) => (projectId ? setTreeSearch(e.target.value) : setProjectSearch(e.target.value))}
        className="h-9 text-sm"
        aria-label={projectId ? searchTreeAria : searchRootAria}
      />

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {projectsLoading ? (
          <p className="px-1 text-xs text-muted-foreground">{t('loading')}</p>
        ) : (
          <ul className="space-y-0.5">
            {filteredProjects.map((p) => {
              const isActiveProject = !Number.isNaN(activeProjectId) && activeProjectId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      persistStoredSelectedProjectId(p.id);
                      navigate(`/project/${p.id}`);
                      afterNav();
                    }}
                    className={cn(
                      'w-full cursor-pointer rounded-md border-l-2 py-1.5 pl-[6px] pr-2 text-left text-sm transition-[background-color,box-shadow] duration-200 ease-out',
                      !isActiveProject &&
                        'border-transparent hover:bg-slate-200/90 hover:shadow-sm dark:hover:bg-slate-800/90',
                      isActiveProject &&
                        'border-[#1E3A5F] bg-slate-200 font-semibold shadow-sm ring-1 ring-inset ring-[#1E3A5F]/25 dark:border-blue-400 dark:bg-slate-800 dark:ring-blue-400/30'
                    )}
                  >
                    <span className="truncate">{p.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {projectId && (
          <div className="mt-5 border-t border-border/60 pt-4">
            {treeLoading ? (
              <p className="px-1 text-xs text-muted-foreground">{t('loadingFloors')}</p>
            ) : (
              <>
                <h2 className="px-1 text-sm font-semibold text-foreground truncate" title={project?.name}>
                  {project?.name ?? (isWorker ? t('site') : t('project'))}
                </h2>
                <div className="mt-3 space-y-3">
                  {filteredFloors.length === 0 ? (
                    <p className="px-1 text-xs text-muted-foreground">{t('noMatches')}</p>
                  ) : (
                    filteredFloors.map((f) => {
                      const expanded = isFloorExpanded(f);
                      const floorRooms = filteredRoomsForFloor(f);
                      const isActiveFloor = !Number.isNaN(activeFloorId) && activeFloorId === f.id;

                      return (
                        <div key={f.id} className="rounded-md border-b border-border/50 pb-3 last:border-b-0 last:pb-0">
                          <button
                            type="button"
                            onClick={() => toggleFloor(f.id)}
                            className={cn(
                              'flex w-full cursor-pointer items-center gap-1 rounded-md border-l-2 py-1.5 pl-[6px] pr-2 text-left text-sm transition-[background-color,box-shadow] duration-200 ease-out',
                              !isActiveFloor &&
                                'border-transparent hover:bg-slate-200/90 hover:shadow-sm dark:hover:bg-slate-800/90',
                              isActiveFloor &&
                                'border-[#1E3A5F] bg-slate-200 font-semibold shadow-sm ring-1 ring-inset ring-[#1E3A5F]/25 dark:border-blue-400 dark:bg-slate-800 dark:ring-blue-400/30'
                            )}
                            aria-expanded={expanded}
                          >
                            <ChevronRight
                              className={cn(
                                'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                                expanded && 'rotate-90',
                                treeSearchTrim && 'opacity-40'
                              )}
                            />
                            <span className="min-w-0 truncate">{floorLabel(f)}</span>
                          </button>

                          {expanded && floorRooms.length > 0 && (
                            <ul className="mt-0.5 space-y-0.5 border-l border-border/60 pl-2 ml-3">
                              {floorRooms.map((r) => {
                                const isActiveRoom = !Number.isNaN(activeRoomId) && activeRoomId === r.id;
                                return (
                                  <li key={r.id}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigate(`/project/${projectId}/floor/${f.id}/room/${r.id}`);
                                        afterNav();
                                      }}
                                      className={cn(
                                        'w-full cursor-pointer rounded-md px-2 py-1 text-left text-sm transition-[background-color,box-shadow] duration-200 ease-out',
                                        !isActiveRoom && 'hover:bg-slate-200/90 hover:shadow-sm dark:hover:bg-slate-800/90',
                                        isActiveRoom
                                          ? 'bg-[#1E3A5F]/15 text-[#1E3A5F] shadow-sm ring-1 ring-inset ring-[#1E3A5F]/35 dark:bg-blue-950/55 dark:text-blue-100 dark:ring-blue-400/40 font-semibold'
                                          : 'text-muted-foreground'
                                      )}
                                    >
                                      {r.room_number}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

function SidebarFooter({ afterNav }: { afterNav: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { endSession } = useDevPresentationSession();
  const { canManageUsers } = usePermissions();
  const { t } = useI18n();

  return (
    <div className="mt-auto shrink-0 space-y-2 border-t border-border/60 pt-3">
      {canManageUsers && (
        <button
          type="button"
          onClick={() => {
            navigate('/admin/users');
            afterNav();
          }}
          className={cn(
            'mx-1 w-[calc(100%-0.5rem)] cursor-pointer rounded-md px-2 py-2 text-left text-sm transition-[background-color,box-shadow] duration-200 ease-out',
            !location.pathname.startsWith('/admin') && 'hover:bg-slate-200/90 hover:shadow-sm dark:hover:bg-slate-800/90',
            location.pathname.startsWith('/admin') && 'bg-slate-200 dark:bg-slate-800 font-medium shadow-sm'
          )}
        >
          {t('adminSettings')}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-1 px-1">
        <DevRoleSwitcher />
      </div>
      <div className="flex flex-col gap-1 px-1">
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full justify-start gap-2 px-2 text-muted-foreground"
          onClick={() => {
            toggleTheme();
            afterNav();
          }}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === 'dark' ? t('lightMode') : t('darkMode')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full justify-start gap-2 px-2 text-muted-foreground"
          onClick={() => {
            void runAppLogout(navigate, endSession).finally(() => afterNav());
          }}
        >
          <LogOut className="h-4 w-4" />
          {t('logOut')}
        </Button>
      </div>
    </div>
  );
}
