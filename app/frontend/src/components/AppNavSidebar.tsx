import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, HardHat, LogOut, Moon, Sun } from 'lucide-react';
import { client, fetchProjectsListAll } from '@/lib/api';
import { APP_NAME_PARTS } from '@/lib/branding';
import { usePermissions } from '@/lib/permissions';
import { runAppLogout, PROJECTS_NAV_REFRESH_EVENT, APP_LOGOUT_EVENT } from '@/lib/runAppLogout';
import { DEV_ROLE_CHANGED_EVENT, isDevRoleSwitcherHost } from '@/lib/devRole';
import { useTheme } from '@/lib/theme';
import { useDevPresentationSession } from '@/lib/devPresentationSession';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DevRoleSwitcher from '@/components/DevRoleSwitcher';
import { cn } from '@/lib/utils';

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

export default function AppNavSidebar({
  variant,
  onNavigate,
}: {
  variant: Variant;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const afterNav = () => onNavigate?.();

  const inner = (
    <div className="flex h-full min-h-0 flex-col p-3 pt-4">
      <button
        type="button"
        onClick={() => {
          navigate('/');
          afterNav();
        }}
        className="mb-3 flex items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-slate-200/80 dark:hover:bg-slate-800/80"
      >
        <HardHat className="h-5 w-5 shrink-0 text-amber-500" />
        <span className="text-sm font-black tracking-[0.12em] uppercase">
          {APP_NAME_PARTS.prefix}
          <span className="text-amber-600/90 dark:text-amber-400/90">{APP_NAME_PARTS.dot}</span>
          {APP_NAME_PARTS.suffix}
        </span>
      </button>

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
  const location = useLocation();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
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

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const useProjectsAll = !isDevRoleSwitcherHost();
      const res = useProjectsAll
        ? await fetchProjectsListAll()
        : await client.entities.projects.query({ sort: '-created_at' });
      setProjects((res?.data?.items || []) as ProjectRow[]);
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects, location.pathname]);

  useEffect(() => {
    const onRefresh = () => void loadProjects();
    const onLogout = () => setProjects([]);
    window.addEventListener(PROJECTS_NAV_REFRESH_EVENT, onRefresh);
    window.addEventListener(APP_LOGOUT_EVENT, onLogout);
    return () => {
      window.removeEventListener(PROJECTS_NAV_REFRESH_EVENT, onRefresh);
      window.removeEventListener(APP_LOGOUT_EVENT, onLogout);
    };
  }, [loadProjects]);

  const loadProjectTree = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setFloors([]);
      setRooms([]);
      setTreeLoading(false);
      return;
    }
    setTreeLoading(true);
    try {
      const [projRes, floorsRes, roomsRes] = await Promise.all([
        client.entities.projects.get({ id: projectId }),
        client.entities.floors.query({
          query: { project_id: Number(projectId) },
          sort: 'floor_number',
          limit: 100,
        }),
        client.entities.rooms.query({
          query: { project_id: Number(projectId) },
          limit: 500,
        }),
      ]);
      setProject(projRes?.data ? { id: projRes.data.id, name: projRes.data.name } : null);
      setFloors((floorsRes?.data?.items || []) as FloorRow[]);
      setRooms((roomsRes?.data?.items || []) as RoomRow[]);
    } catch {
      setProject(null);
      setFloors([]);
      setRooms([]);
    } finally {
      setTreeLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadProjectTree();
  }, [loadProjectTree, location.pathname]);

  useEffect(() => {
    const onRoleChange = () => {
      void loadProjects();
      void loadProjectTree();
    };
    window.addEventListener(DEV_ROLE_CHANGED_EVENT, onRoleChange);
    return () => window.removeEventListener(DEV_ROLE_CHANGED_EVENT, onRoleChange);
  }, [loadProjects, loadProjectTree]);

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

  useEffect(() => {
    if (!floorId) setOpenFloors(new Set());
  }, [floorId]);

  const roomsByFloorId = useMemo(() => {
    const m = new Map<number, RoomRow[]>();
    for (const r of rooms) {
      const list = m.get(r.floor_id) ?? [];
      list.push(r);
      m.set(r.floor_id, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true }));
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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <p className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Projects</p>
      <Input
        type="search"
        placeholder={projectId ? 'Search floors & rooms…' : 'Search projects…'}
        value={projectId ? treeSearch : projectSearch}
        onChange={(e) => (projectId ? setTreeSearch(e.target.value) : setProjectSearch(e.target.value))}
        className="h-9 text-sm"
        aria-label={projectId ? 'Search floors and rooms' : 'Search projects'}
      />

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {projectsLoading ? (
          <p className="px-1 text-xs text-muted-foreground">Loading…</p>
        ) : (
          <ul className="space-y-0.5">
            {filteredProjects.map((p) => {
              const isActiveProject = !Number.isNaN(activeProjectId) && activeProjectId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      navigate(`/project/${p.id}`);
                      afterNav();
                    }}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      'hover:bg-slate-200/80 dark:hover:bg-slate-800/80',
                      isActiveProject && 'bg-slate-200 dark:bg-slate-800 font-medium'
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
              <p className="px-1 text-xs text-muted-foreground">Loading floors…</p>
            ) : (
              <>
                <h2 className="px-1 text-sm font-semibold text-foreground truncate" title={project?.name}>
                  {project?.name ?? 'Project'}
                </h2>
                <div className="mt-3 space-y-3">
                  {filteredFloors.length === 0 ? (
                    <p className="px-1 text-xs text-muted-foreground">No matches</p>
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
                              'flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                              'hover:bg-slate-200/80 dark:hover:bg-slate-800/80',
                              isActiveFloor && 'bg-slate-200 dark:bg-slate-800 font-medium'
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
                                        'w-full rounded-md px-2 py-1 text-left text-sm transition-colors',
                                        'hover:bg-slate-200/80 dark:hover:bg-slate-800/80',
                                        isActiveRoom
                                          ? 'bg-[#1E3A5F]/15 text-[#1E3A5F] dark:bg-blue-950/50 dark:text-blue-200 font-medium'
                                          : 'text-muted-foreground'
                                      )}
                                    >
                                      Room {r.room_number}
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
            'mx-1 w-[calc(100%-0.5rem)] rounded-md px-2 py-2 text-left text-sm transition-colors',
            'hover:bg-slate-200/80 dark:hover:bg-slate-800/80',
            location.pathname.startsWith('/admin') && 'bg-slate-200 dark:bg-slate-800 font-medium'
          )}
        >
          Admin settings
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
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full justify-start gap-2 px-2 text-muted-foreground"
          onClick={() => {
            runAppLogout(navigate, endSession);
            afterNav();
          }}
        >
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </div>
    </div>
  );
}
