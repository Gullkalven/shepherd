import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
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
import { taskCountsForFloorBoard } from '@/lib/roomAreas';
import { useI18n } from '@/lib/i18n';
import ProjectWorkersPanel from '@/components/ProjectWorkersPanel';
import { useDesktopAutoFocus } from '@/lib/useDesktopAutoFocus';
import { apiFailureMessage, devLogApiFailure, httpStatusFromError } from '@/lib/apiErrors';
import { shepherdDebug } from '@/lib/shepherdDebug';
import {
  parseProjectRouteParam,
  unwrapProjectBody,
  type ProjectRecord,
} from '@/lib/projectEntity';
import { clearWorkerLastRoomIfMatchesProject } from '@/lib/workerLastRoom';
import { flashProjectNotFoundOnce } from '@/lib/projectNotFoundFlash';

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
  room_number: string;
  assigned_worker?: string;
  updated_at?: string | null;
  phase?: string;
  areas?: unknown;
  heating_cable_doc?: unknown;
}

interface ProjectTaskRow {
  room_id: number;
  phase?: string | null;
  is_completed?: boolean | null;
  area_id?: string | null;
}

type Project = ProjectRecord;

export default function ProjectDetail() {
  const desktopAutoFocus = useDesktopAutoFocus();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { canCreateFloor, canDeleteFloor, canEdit, isWorker, isAdmin } = usePermissions();
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
  /** Non-404 failure — show retry without pretending the project exists. */
  const [loadError, setLoadError] = useState(false);
  const { t } = useI18n();

  // Inline edit state for project name
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [editProjectNameVal, setEditProjectNameVal] = useState('');

  // Inline edit state for floor names
  const [editingFloorId, setEditingFloorId] = useState<number | null>(null);
  const [editFloorName, setEditFloorName] = useState('');

  const reloadProjectState = useCallback(async () => {
    const parsed = parseProjectRouteParam(projectId);
    if (parsed === null) {
      toast.error('Invalid project link.');
      navigate('/', { replace: true });
      throw new Error('invalid project route');
    }

    const projRes = await client.entities.projects.get({ id: String(parsed) });
    const row = unwrapProjectBody(projRes?.data);
    if (!row) {
      devLogApiFailure('ProjectDetail.unwrapProject', new Error('missing project payload'));
      throw Object.assign(new Error('Projects not found'), { response: { status: 404 } });
    }

    const resolvedId = row.id;
    const [floorsRes, roomsRes, tasksRes] = await Promise.all([
      client.entities.floors.query({
        query: { project_id: resolvedId },
        sort: 'floor_number',
        limit: 100,
      }),
      client.entities.rooms.query({
        query: { project_id: resolvedId },
        limit: 500,
      }),
      client.entities.tasks.query({ limit: 2000, sort: 'room_id' }),
    ]);

    let wf: PhaseWorkflowEntry[] = DEFAULT_PHASE_WORKFLOW;
    try {
      const wfRes = await client.apiCall.invoke({
        url: `/api/v1/projects/${resolvedId}/workflow`,
        method: 'GET',
        data: {},
      });
      const rawPhases = wfRes?.data?.phases;
      if (Array.isArray(rawPhases) && rawPhases.length > 0) {
        const parsedPhases = rawPhases
          .filter((p: { key?: string; label?: string }) => p?.key && p?.label)
          .map((p: { key: string; label: string }) => ({ key: String(p.key), label: String(p.label) }));
        if (parsedPhases.length > 0) wf = parsedPhases;
      }
    } catch (wfErr) {
      devLogApiFailure('ProjectDetail.workflow', wfErr);
    }

    setProject({ id: resolvedId, name: row.name });
    setFloors(floorsRes?.data?.items || []);
    const roomItems: Room[] = roomsRes?.data?.items || [];
    setAllRooms(roomItems);
    setProjectTasks((tasksRes?.data?.items || []) as ProjectTaskRow[]);
    setPhaseWorkflow(wf);
    if (import.meta.env.DEV) {
      shepherdDebug('ProjectDetail.loaded', { routeParam: projectId, resolvedId });
    }
  }, [projectId, navigate]);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setLoadError(false);
    try {
      await reloadProjectState();
    } catch (err) {
      devLogApiFailure('ProjectDetail.loadData', err);
      const st = httpStatusFromError(err);
      const msg = apiFailureMessage(err) ?? 'Failed to load project';
      if (st === 404) {
        const pid = parseProjectRouteParam(projectId);
        if (pid !== null) clearWorkerLastRoomIfMatchesProject(pid);
        flashProjectNotFoundOnce();
        navigate('/', { replace: true });
        return;
      }
      toast.error(msg);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [projectId, reloadProjectState, navigate]);

  useEffect(() => {
    setFloors([]);
    setAllRooms([]);
    setProjectTasks([]);
    setPhaseWorkflow(DEFAULT_PHASE_WORKFLOW);
    setProject(null);
    setLoadError(false);
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateFloor = async () => {
    if (!floorNumber.trim() || !project?.id) return;
    setCreating(true);
    try {
      await client.entities.floors.create({
        data: {
          project_id: project.id,
          floor_number: Number(floorNumber),
          name: floorName.trim() || `Floor ${floorNumber}`,
        },
      });
      setShowCreate(false);
      setFloorNumber('');
      setFloorName('');
      try {
        await reloadProjectState();
        toast.success('Floor added');
      } catch (reloadErr) {
        devLogApiFailure('ProjectDetail.reloadAfterFloorCreate', reloadErr);
        toast.error(
          apiFailureMessage(reloadErr) ??
            'Floor was saved but the project could not be refreshed. Try reloading the page.'
        );
      }
    } catch (err) {
      devLogApiFailure('ProjectDetail.createFloor', err);
      toast.error(apiFailureMessage(err) ?? 'Failed to create floor');
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
    const tasksForBoard = tasksInProject.filter((t) => {
      const roomRow = allRooms.find((r) => r.id === Number(t.room_id));
      if (!roomRow) return false;
      return taskCountsForFloorBoard(t.area_id, roomRow.areas);
    });
    for (const floor of floors) {
      const floorRooms = allRooms.filter((r) => r.floor_id === floor.id);
      const floorRoomIds = new Set(floorRooms.map((r) => r.id));
      const floorTasks = tasksForBoard.filter((t) => floorRoomIds.has(Number(t.room_id)));
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

  if (loadError) {
    return (
      <div className="min-h-dvh bg-slate-50 dark:bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full space-y-4 p-6 text-center">
          <p className="text-muted-foreground">Could not load this project.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button type="button" className="h-11 rounded-xl" onClick={() => void loadData()}>
              Retry
            </Button>
            <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => navigate('/')}>
              All projects
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  const routeProjectPath = `/project/${project.id}`;

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-background pb-8">
      <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-none lg:px-6 xl:px-8">
        {/* Dashboard — admin/BAS only (hidden for workers on site). */}
        {!isWorker && (
          <>
            <Button
              variant="outline"
              className="w-full justify-between h-12 rounded-xl"
              onClick={() => setShowDashboard(!showDashboard)}
            >
              <span className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#1E3A5F] dark:text-blue-400" />
                {t('dashboard')}
              </span>
              <ChevronRight className={`h-4 w-4 transition-transform ${showDashboard ? 'rotate-90' : ''}`} />
            </Button>

            {showDashboard && (
              <Card className="p-4">
                <DashboardStats rooms={allRooms} />
              </Card>
            )}
          </>
        )}

        {/* Project Name (editable) */}
        <div className="flex items-center gap-2 group/projname">
          {editingProjectName ? (
            <div className="flex items-center gap-2 flex-1">
              <Input
                value={editProjectNameVal}
                onChange={(e) => setEditProjectNameVal(e.target.value)}
                className="h-9 text-lg font-bold"
                {...(desktopAutoFocus ? { autoFocus: true } : {})}
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

        {isAdmin ? <ProjectWorkersPanel projectId={project.id} /> : null}

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
          <Card className="p-8 text-center space-y-4">
            <Layers className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-muted-foreground">No floors yet</p>
            {canCreateFloor && (
              <>
                <p className="text-sm text-muted-foreground">
                  Add a floor, then open it to create rooms and checklist tasks.
                </p>
                <Button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="bg-[#1E3A5F] hover:bg-[#2a4f7a] dark:bg-blue-600 dark:hover:bg-blue-700 h-10 rounded-xl"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add floor
                </Button>
              </>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {floors.map((floor) => {
              const counts = getRoomCountsForFloor(floor.id);
              return (
                <Card
                  key={floor.id}
                  className="p-4 shepherd-interactive-card"
                  onClick={() =>
                    editingFloorId !== floor.id && navigate(`${routeProjectPath}/floor/${floor.id}`)
                  }
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      {editingFloorId === floor.id ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Input
                            value={editFloorName}
                            onChange={(e) => setEditFloorName(e.target.value)}
                            className="h-9 text-base sm:text-sm font-semibold"
                            {...(desktopAutoFocus ? { autoFocus: true } : {})}
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