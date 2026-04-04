import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { PermissionProvider, usePermissions } from '@/lib/permissions';
import Header from '@/components/Header';
import DashboardStats from '@/components/DashboardStats';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogForm } from '@/components/ui/dialog';
import { Plus, Layers, Trash2, BarChart3, ChevronRight, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  computeFloorPhaseProgress,
  DEFAULT_PHASE_WORKFLOW,
  type FloorPhaseProgressEntry,
  type PhaseWorkflowEntry,
} from '@/lib/roomPhases';

/** Compact labels for default phases; other keys use first letter */
function phaseProgressLetter(key: string): string {
  const m: Record<string, string> = {
    demontering: 'D',
    varmekabel: 'V',
    remontering: 'R',
    sluttkontroll: 'S',
  };
  return m[key] ?? (key.charAt(0) || '?').toUpperCase();
}

interface Floor {
  id: number;
  floor_number: number;
  name?: string;
}

interface Room {
  id: number;
  status: string;
  floor_id: number;
  phase?: string;
}

interface ProjectTaskRow {
  room_id: number;
  phase?: string | null;
  is_completed?: boolean | null;
}

interface Project {
  id: number;
  name: string;
}

function ProjectDetailContent() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { canCreateFloor, canDeleteFloor, canEdit } = usePermissions();
  const [project, setProject] = useState<Project | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [projectTasks, setProjectTasks] = useState<ProjectTaskRow[]>([]);
  const [phaseWorkflow, setPhaseWorkflow] = useState<PhaseWorkflowEntry[]>(DEFAULT_PHASE_WORKFLOW);
  const [showCreate, setShowCreate] = useState(false);
  const [floorNumber, setFloorNumber] = useState('');
  const [floorName, setFloorName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [loading, setLoading] = useState(true);

  // Inline edit state for project name
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [editProjectNameVal, setEditProjectNameVal] = useState('');

  // Inline edit state for floor names
  const [editingFloorId, setEditingFloorId] = useState<number | null>(null);
  const [editFloorName, setEditFloorName] = useState('');

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      const [projRes, floorsRes, roomsRes, tasksRes, wfRes] = await Promise.all([
        client.entities.projects.get({ id: projectId }),
        client.entities.floors.query({ query: { project_id: Number(projectId) }, sort: 'floor_number', limit: 100 }),
        client.entities.rooms.query({ query: { project_id: Number(projectId) }, limit: 500 }),
        client.entities.tasks.query({ limit: 2000, sort: 'room_id' }),
        client.apiCall.invoke({
          url: `/api/v1/projects/${projectId}/workflow`,
          method: 'GET',
          data: {},
        }),
      ]);
      setProject(projRes?.data || null);
      setFloors(floorsRes?.data?.items || []);
      const roomItems: Room[] = roomsRes?.data?.items || [];
      setAllRooms(roomItems);
      setProjectTasks((tasksRes?.data?.items || []) as ProjectTaskRow[]);
      const rawPhases = wfRes?.data?.phases;
      let wf: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW;
      if (Array.isArray(rawPhases) && rawPhases.length > 0) {
        const parsed = rawPhases
          .filter((p: { key?: string; label?: string }) => p?.key && p?.label)
          .map((p: { key: string; label: string }) => ({ key: String(p.key), label: String(p.label) }));
        if (parsed.length > 0) wf = parsed;
      }
      setPhaseWorkflow(wf);
    } catch {
      toast.error('Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateFloor = async () => {
    if (!floorNumber.trim()) return;
    setCreating(true);
    try {
      await client.entities.floors.create({
        data: {
          project_id: Number(projectId),
          floor_number: Number(floorNumber),
          name: floorName.trim() || `Floor ${floorNumber}`,
        },
      });
      toast.success('Floor added');
      setShowCreate(false);
      setFloorNumber('');
      setFloorName('');
      loadData();
    } catch {
      toast.error('Failed to create floor');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteFloor = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm('Delete this floor and all its rooms?')) return;
    try {
      const floorRooms = allRooms.filter((r) => r.floor_id === id);
      for (const room of floorRooms) {
        await client.entities.rooms.delete({ id: String(room.id) });
      }
      await client.entities.floors.delete({ id: String(id) });
      toast.success('Floor deleted');
      loadData();
    } catch {
      toast.error('Failed to delete floor');
    }
  };

  const getRoomCountsForFloor = (floorId: number) => {
    const floorRooms = allRooms.filter((r) => r.floor_id === floorId);
    const completed = floorRooms.filter((r) => r.status === 'completed').length;
    return { total: floorRooms.length, completed };
  };

  const floorPhaseProgressByFloorId = useMemo(() => {
    const map = new Map<number, FloorPhaseProgressEntry[]>();
    const projectRoomIds = new Set(allRooms.map((r) => r.id));
    const tasksInProject = projectTasks.filter((t) => projectRoomIds.has(Number(t.room_id)));
    for (const floor of floors) {
      const floorRooms = allRooms.filter((r) => r.floor_id === floor.id);
      const floorRoomIds = new Set(floorRooms.map((r) => r.id));
      const floorTasks = tasksInProject.filter((t) => floorRoomIds.has(Number(t.room_id)));
      map.set(floor.id, computeFloorPhaseProgress(floorRooms, floorTasks, phaseWorkflow));
    }
    return map;
  }, [floors, allRooms, projectTasks, phaseWorkflow]);

  const startEditProjectName = () => {
    if (!project) return;
    setEditingProjectName(true);
    setEditProjectNameVal(project.name);
  };

  const saveProjectName = async () => {
    if (!project || !editProjectNameVal.trim()) {
      setEditingProjectName(false);
      return;
    }
    try {
      await client.entities.projects.update({
        id: String(project.id),
        data: { name: editProjectNameVal.trim() },
      });
      setProject({ ...project, name: editProjectNameVal.trim() });
      toast.success('Project name updated');
    } catch {
      toast.error('Failed to update project name');
    }
    setEditingProjectName(false);
  };

  const startEditFloor = (e: React.MouseEvent, floor: Floor) => {
    e.stopPropagation();
    setEditingFloorId(floor.id);
    setEditFloorName(floor.name || `Floor ${floor.floor_number}`);
  };

  const saveFloorName = async (floorId: number) => {
    if (!editFloorName.trim()) {
      setEditingFloorId(null);
      return;
    }
    try {
      await client.entities.floors.update({
        id: String(floorId),
        data: { name: editFloorName.trim() },
      });
      setFloors((prev) =>
        prev.map((f) => (f.id === floorId ? { ...f, name: editFloorName.trim() } : f))
      );
      toast.success('Floor name updated');
    } catch {
      toast.error('Failed to update floor name');
    }
    setEditingFloorId(null);
  };

  const cancelEditFloor = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingFloorId(null);
    setEditFloorName('');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-background">
      <Header
        breadcrumbs={[
          { label: 'Projects', path: '/' },
          { label: project?.name || 'Project' },
        ]}
      />
      <div className="p-4 max-w-lg mx-auto space-y-4">
        {/* Dashboard Toggle */}
        <Button
          variant="outline"
          className="w-full justify-between h-12 rounded-xl"
          onClick={() => setShowDashboard(!showDashboard)}
        >
          <span className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#1E3A5F] dark:text-blue-400" />
            Foreman Dashboard
          </span>
          <ChevronRight className={`h-4 w-4 transition-transform ${showDashboard ? 'rotate-90' : ''}`} />
        </Button>

        {showDashboard && (
          <Card className="p-4">
            <DashboardStats rooms={allRooms} />
          </Card>
        )}

        {/* Project Name (editable) */}
        <div className="flex items-center gap-2 group/projname">
          {editingProjectName ? (
            <div className="flex items-center gap-2 flex-1">
              <Input
                value={editProjectNameVal}
                onChange={(e) => setEditProjectNameVal(e.target.value)}
                className="h-9 text-lg font-bold"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveProjectName();
                  if (e.key === 'Escape') setEditingProjectName(false);
                }}
                onBlur={() => saveProjectName()}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-emerald-500 hover:text-emerald-700"
                onMouseDown={(e) => { e.preventDefault(); saveProjectName(); }}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-600"
                onMouseDown={(e) => { e.preventDefault(); setEditingProjectName(false); }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-slate-800 dark:text-foreground">{project?.name || 'Project'}</h2>
              {canEdit && (
                <button
                  className="opacity-0 group-hover/projname:opacity-100 transition-opacity text-slate-400 hover:text-blue-500 p-0.5"
                  onClick={startEditProjectName}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        {/* Floors */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800 dark:text-foreground">Floors</h2>
          {canCreateFloor && (
            <Button
              onClick={() => setShowCreate(true)}
              className="bg-[#1E3A5F] hover:bg-[#2a4f7a] dark:bg-blue-600 dark:hover:bg-blue-700 h-10 rounded-xl"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Floor
            </Button>
          )}
        </div>

        {floors.length === 0 ? (
          <Card className="p-8 text-center">
            <Layers className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-muted-foreground">No floors yet</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {floors.map((floor) => {
              const counts = getRoomCountsForFloor(floor.id);
              return (
                <Card
                  key={floor.id}
                  className="p-4 cursor-pointer hover:shadow-md transition-shadow active:scale-[0.99]"
                  onClick={() => editingFloorId !== floor.id && navigate(`/project/${projectId}/floor/${floor.id}`)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      {editingFloorId === floor.id ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Input
                            value={editFloorName}
                            onChange={(e) => setEditFloorName(e.target.value)}
                            className="h-9 text-sm font-semibold"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveFloorName(floor.id);
                              if (e.key === 'Escape') cancelEditFloor();
                            }}
                            onBlur={() => saveFloorName(floor.id)}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-emerald-500 hover:text-emerald-700"
                            onMouseDown={(e) => { e.preventDefault(); saveFloorName(floor.id); }}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-600"
                            onMouseDown={(e) => { e.preventDefault(); cancelEditFloor(); }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 group/flname">
                          <h3 className="font-semibold text-slate-800 dark:text-foreground">
                            {floor.name || `Floor ${floor.floor_number}`}
                          </h3>
                          {canEdit && (
                            <button
                              className="opacity-0 group-hover/flname:opacity-100 transition-opacity text-slate-400 hover:text-blue-500 p-0.5"
                              onClick={(e) => startEditFloor(e, floor)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                      {editingFloorId !== floor.id && (
                        <>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {counts.total} rooms · {counts.completed} completed
                          </p>
                          {(floorPhaseProgressByFloorId.get(floor.id) ?? []).length > 0 && (
                            <p
                              className="mt-1 text-xs leading-snug text-muted-foreground tabular-nums"
                              title="Checklist progress per phase: rooms with all items in that phase done / rooms on floor"
                            >
                              {(floorPhaseProgressByFloorId.get(floor.id) ?? []).map((row) => (
                                <span key={row.key} className="mr-2 inline-block">
                                  {phaseProgressLetter(row.key)}: {row.completedRooms}/{row.totalRooms}
                                </span>
                              ))}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    {editingFloorId !== floor.id && (
                      <div className="flex items-center gap-1">
                        {canDeleteFloor && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                            onClick={(e) => handleDeleteFloor(e, floor.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                        <ChevronRight className="h-5 w-5 text-slate-400 dark:text-slate-500" />
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm mx-4">
          <DialogForm onSubmit={(e) => { e.preventDefault(); handleCreateFloor(); }}>
            <DialogHeader>
              <DialogTitle>Add Floor</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                type="number"
                placeholder="Floor number (e.g., 1, 2, 3)"
                value={floorNumber}
                onChange={(e) => setFloorNumber(e.target.value)}
                className="h-12"
              />
              <Input
                placeholder="Floor name (optional)"
                value={floorName}
                onChange={(e) => setFloorName(e.target.value)}
                className="h-12"
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={!floorNumber.trim() || creating}
                className="w-full bg-[#1E3A5F] hover:bg-[#2a4f7a] dark:bg-blue-600 dark:hover:bg-blue-700 h-12"
              >
                {creating ? 'Adding...' : 'Add Floor'}
              </Button>
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ProjectDetail() {
  const [isAuth, setIsAuth] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await client.auth.me();
        setIsAuth(!!res?.data);
      } catch {
        setIsAuth(false);
      } finally {
        setChecking(false);
      }
    };
    check();
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <PermissionProvider isAuthenticated={isAuth}>
      <ProjectDetailContent />
    </PermissionProvider>
  );
}