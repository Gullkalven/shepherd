import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { client } from '@/lib/api';
import { Input } from '@/components/ui/input';
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

export default function ProjectNavSidebar() {
  const { projectId, floorId, roomId } = useParams<{
    projectId: string;
    floorId?: string;
    roomId?: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [floors, setFloors] = useState<FloorRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openFloors, setOpenFloors] = useState<Set<number>>(new Set());

  const activeFloorId = floorId ? Number(floorId) : NaN;
  const activeRoomId = roomId ? Number(roomId) : NaN;
  const searchTrim = search.trim().toLowerCase();

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
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
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, location.pathname]);

  useEffect(() => {
    setOpenFloors(new Set());
    setSearch('');
  }, [projectId]);

  useEffect(() => {
    if (!floorId) return;
    const id = Number(floorId);
    if (Number.isNaN(id)) return;
    setOpenFloors((prev) => new Set(prev).add(id));
  }, [floorId, projectId]);

  /** Project overview has no floor in the URL — keep floors collapsed by default there. */
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
    if (!searchTrim) return floors;
    return floors.filter((f) => {
      const fl = floorLabel(f).toLowerCase();
      if (fl.includes(searchTrim)) return true;
      const list = roomsByFloorId.get(f.id) ?? [];
      return list.some((r) => String(r.room_number).toLowerCase().includes(searchTrim));
    });
  }, [floors, roomsByFloorId, searchTrim]);

  const isFloorExpanded = (f: FloorRow) => {
    if (searchTrim) {
      const fl = floorLabel(f).toLowerCase();
      if (fl.includes(searchTrim)) return true;
      const list = roomsByFloorId.get(f.id) ?? [];
      return list.some((r) => String(r.room_number).toLowerCase().includes(searchTrim));
    }
    return openFloors.has(f.id);
  };

  const toggleFloor = (id: number) => {
    if (searchTrim) return;
    setOpenFloors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredRoomsForFloor = (f: FloorRow): RoomRow[] => {
    const list = roomsByFloorId.get(f.id) ?? [];
    if (!searchTrim) return list;
    const fl = floorLabel(f).toLowerCase();
    if (fl.includes(searchTrim)) return list;
    return list.filter((r) => String(r.room_number).toLowerCase().includes(searchTrim));
  };

  if (!projectId) return null;

  return (
    <aside
      className={cn(
        'hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:z-30',
        'lg:w-56 lg:border-r lg:border-border lg:bg-slate-50 lg:dark:bg-background'
      )}
      aria-label="Project navigation"
    >
      <div className="flex h-full min-h-0 flex-col p-3 pt-4">
        <Input
          type="search"
          placeholder="Search floors & rooms…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 text-sm"
          aria-label="Search floors and rooms"
        />

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <>
              <h2 className="px-1 text-sm font-semibold text-foreground truncate" title={project?.name}>
                {project?.name ?? 'Project'}
              </h2>

              <div className="mt-4 space-y-3">
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
                              searchTrim && 'opacity-40'
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
                                    onClick={() =>
                                      navigate(`/project/${projectId}/floor/${f.id}/room/${r.id}`)
                                    }
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
      </div>
    </aside>
  );
}
