import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { client } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogForm } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Camera, Trash2, User, Ban, CheckCircle2,
  Image as ImageIcon, X, Plus, Clock, ListPlus, Pencil, Check,
  Lock, Unlock, ChevronDown, AlertTriangle, History,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_PHASE_WORKFLOW,
  normalizeRoomPhase,
  phaseKeys,
  phaseLabel,
  phaseTabReadOnlyForWorker,
  storedChecklistPhase,
  visitMatchesPhase,
  photoMatchesPhase,
  computePhaseChipUi,
  type PhaseWorkflowEntry,
} from '@/lib/roomPhases';
import {
  DEFAULT_AREA_ID,
  hasPersistedAreas,
  normalizeRoomAreas,
  taskBelongsToArea,
  type RoomArea,
} from '@/lib/roomAreas';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not Started', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400' },
  { value: 'ready_for_inspection', label: 'Ready for Inspection', color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400' },
  { value: 'completed', label: 'Completed', color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400' },
  { value: 'blocked', label: 'Blocked', color: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400' },
];

const WORKER_NAME_KEY = 'trello_v2_worker_name';

interface Task {
  id: number;
  name: string;
  is_completed: boolean;
  sort_order: number;
  checked_by?: string;
  checked_at?: string;
  template_id?: number;
  template_item_id?: number;
  is_template_managed?: boolean;
  is_overridden?: boolean;
  phase?: string | null;
  area_id?: string | null;
}

interface Photo {
  id: number;
  object_key: string;
  filename: string;
  caption?: string;
  downloadUrl?: string;
  phase?: string | null;
  created_at?: string | null;
  area_id?: string | null;
}

interface Room {
  id: number;
  room_number: string;
  status: string;
  phase?: string;
  assigned_worker?: string;
  comment?: string;
  blocked_reason?: string;
  is_locked?: boolean;
  /** Admin: per-phase worker lock overrides (true = locked for workers) */
  phase_lock_overrides?: Record<string, boolean> | null;
  workflow_deviations?: unknown;
  /** When set: multiple areas with their own phase / locks; null/absent = legacy single area */
  areas?: unknown;
  floor_id: number;
  project_id: number;
}

type WorkflowDeviation = {
  id: string;
  phase_key: string;
  text: string;
  status: 'open' | 'resolved';
  created_at: string;
  resolved_at?: string;
  area_id?: string;
};

interface Visit {
  id: number;
  room_id: number;
  worker_name: string;
  action?: string;
  visited_at: string;
  phase?: string | null;
  area_id?: string | null;
}

function coercePhaseLockOverrides(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function coerceWorkflowDeviations(raw: unknown): WorkflowDeviation[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkflowDeviation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const phase_key = typeof o.phase_key === 'string' ? o.phase_key : '';
    const text = typeof o.text === 'string' ? o.text.trim() : '';
    const status = o.status === 'resolved' ? 'resolved' : 'open';
    const created_at = typeof o.created_at === 'string' ? o.created_at : '';
    const resolved_at = typeof o.resolved_at === 'string' ? o.resolved_at : undefined;
    const area_id = typeof o.area_id === 'string' && o.area_id.trim() ? o.area_id.trim() : undefined;
    if (!id || !phase_key || !text || !created_at) continue;
    out.push({ id, phase_key, text, status, created_at, resolved_at, area_id });
  }
  return out;
}

function parseActivityTime(s: string | null | undefined): number {
  if (!s) return 0;
  const t = Date.parse(String(s).replace(' ', 'T'));
  return Number.isNaN(t) ? 0 : t;
}

function formatActivityWhen(ts: number): string {
  if (!ts) return '—';
  try {
    const iso = new Date(ts).toISOString();
    const localLike = iso.replace('T', ' ').substring(0, 19);
    return formatVisitDate(localLike);
  } catch {
    return '—';
  }
}

function formatVisitDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

export default function RoomDetail() {
  const { projectId, floorId, roomId } = useParams<{
    projectId: string;
    floorId: string;
    roomId: string;
  }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    canEdit,
    canEditRoom, canDeleteRoom, canChangeStatus, canAddChecklistItem, canDeleteChecklistItem,
    canCheckItem, canUploadPhoto, canDeletePhoto, canMovePhase,
    sectionVisibility,
  } = usePermissions();

  const [project, setProject] = useState<any>(null);
  const [floor, setFloor] = useState<any>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignedWorker, setAssignedWorker] = useState('');
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [blockedReason, setBlockedReason] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showPhotoPreview, setShowPhotoPreview] = useState<string | null>(null);
  const [showDeleteRoomDialog, setShowDeleteRoomDialog] = useState(false);
  const [deletingRoom, setDeletingRoom] = useState(false);

  const [deviations, setDeviations] = useState<WorkflowDeviation[]>([]);
  const [newDeviationText, setNewDeviationText] = useState('');
  const [savingDeviations, setSavingDeviations] = useState(false);

  // Checklist identity state
  const [showCheckNameDialog, setShowCheckNameDialog] = useState(false);
  const [checkWorkerName, setCheckWorkerName] = useState('');
  const [pendingTask, setPendingTask] = useState<Task | null>(null);

  // Add checklist item state
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [addingTask, setAddingTask] = useState(false);

  // Bulk add checklist items state
  const [showBulkAddTasks, setShowBulkAddTasks] = useState(false);
  const [bulkTaskText, setBulkTaskText] = useState('');
  const [bulkAdding, setBulkAdding] = useState(false);

  // Inline edit task name state
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editTaskName, setEditTaskName] = useState('');

  const [phaseTab, setPhaseTab] = useState<string>('demontering');
  const [phaseWorkflow, setPhaseWorkflow] = useState<PhaseWorkflowEntry[]>(DEFAULT_PHASE_WORKFLOW);
  const [activeAreaId, setActiveAreaId] = useState<string>(DEFAULT_AREA_ID);
  const [showManageAreas, setShowManageAreas] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');

  const loadData = useCallback(async () => {
    if (!projectId || !floorId || !roomId) return;
    try {
      const [projRes, floorRes, roomRes, tasksRes, photosRes, visitsRes, wfRes] = await Promise.all([
        client.entities.projects.get({ id: projectId }),
        client.entities.floors.get({ id: floorId }),
        client.entities.rooms.get({ id: roomId }),
        client.entities.tasks.query({ query: { room_id: Number(roomId) }, sort: 'sort_order', limit: 200 }),
        client.entities.room_photos.query({ query: { room_id: Number(roomId) }, sort: '-created_at', limit: 50 }),
        client.entities.room_visits.queryAll({ query: { room_id: Number(roomId) }, sort: '-visited_at', limit: 100 }),
        client.apiCall.invoke({
          url: `/api/v1/projects/${projectId}/workflow`,
          method: 'GET',
          data: {},
        }),
      ]);
      const rawPhases = wfRes?.data?.phases;
      let wf = DEFAULT_PHASE_WORKFLOW;
      if (Array.isArray(rawPhases) && rawPhases.length > 0) {
        const parsed = rawPhases
          .filter((p: { key?: string; label?: string }) => p?.key && p?.label)
          .map((p: { key: string; label: string }) => ({ key: String(p.key), label: String(p.label) }));
        if (parsed.length > 0) wf = parsed;
      }
      setPhaseWorkflow(wf);
      setProject(projRes?.data || null);
      setFloor(floorRes?.data || null);
      const roomData = roomRes?.data;
      if (roomData) {
        setRoom({
          ...roomData,
          phase_lock_overrides: coercePhaseLockOverrides(roomData.phase_lock_overrides),
        });
      } else {
        setRoom(null);
      }
      setAssignedWorker(roomData?.assigned_worker || '');
      setBlockedReason(roomData?.blocked_reason || '');
      setTasks(tasksRes?.data?.items || []);
      setVisits(visitsRes?.data?.items || []);

      const photoItems: Photo[] = photosRes?.data?.items || [];
      const photosWithUrls = await Promise.all(
        photoItems.map(async (p) => {
          try {
            const dlRes = await client.storage.getDownloadUrl({
              bucket_name: 'room-photos',
              object_key: p.object_key,
            });
            return { ...p, downloadUrl: dlRes?.data?.download_url || '' };
          } catch {
            return { ...p, downloadUrl: '' };
          }
        })
      );
      setPhotos(photosWithUrls);
    } catch {
      toast.error('Failed to load room');
    } finally {
      setLoading(false);
    }
  }, [projectId, floorId, roomId]);

  const areasList = useMemo(() => {
    if (!room) return [];
    return normalizeRoomAreas(
      room.areas,
      room.phase,
      coercePhaseLockOverrides(room.phase_lock_overrides),
      phaseWorkflow
    );
  }, [room, phaseWorkflow]);

  const primaryAreaId = areasList[0]?.id ?? DEFAULT_AREA_ID;
  const showAreaTabs = areasList.length > 1;

  const activeArea = useMemo(
    () => areasList.find((a) => a.id === activeAreaId) ?? areasList[0],
    [areasList, activeAreaId]
  );

  const saveAreasToServer = useCallback(
    async (next: RoomArea[]) => {
      if (!room) return;
      const primary = next[0];
      if (!primary) return;
      const phase0 = normalizeRoomPhase(primary.phase ?? room.phase, phaseWorkflow);
      const lock0 = coercePhaseLockOverrides(primary.phase_lock_overrides);
      const hadPersisted = hasPersistedAreas(room.areas);
      const payload: Record<string, unknown> = {
        phase: phase0,
        phase_lock_overrides: Object.keys(lock0).length ? lock0 : {},
      };
      if (next.length > 1) {
        payload.areas = next.map((a) => {
          const o = coercePhaseLockOverrides(a.phase_lock_overrides);
          return {
            id: a.id,
            name: a.name,
            phase: normalizeRoomPhase(a.phase ?? null, phaseWorkflow),
            ...(Object.keys(o).length ? { phase_lock_overrides: o } : {}),
          };
        });
      } else if (hadPersisted) {
        payload.areas = null;
      }
      await client.entities.rooms.update({
        id: String(room.id),
        data: payload as Record<string, unknown>,
      });
      await loadData();
    },
    [room, phaseWorkflow, loadData]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!room) return;
    const list = normalizeRoomAreas(
      room.areas,
      room.phase,
      coercePhaseLockOverrides(room.phase_lock_overrides),
      phaseWorkflow
    );
    const firstId = list[0]?.id ?? DEFAULT_AREA_ID;
    setActiveAreaId((prev) => (list.some((a) => a.id === prev) ? prev : firstId));
  }, [room?.id, room?.areas, room?.phase, room?.phase_lock_overrides, phaseWorkflow]);

  useEffect(() => {
    if (!room || !activeArea) return;
    setPhaseTab(normalizeRoomPhase(activeArea.phase ?? room.phase, phaseWorkflow));
  }, [room?.id, activeAreaId, activeArea?.phase, room?.phase, phaseWorkflow]);

  useEffect(() => {
    if (room) setDeviations(coerceWorkflowDeviations(room.workflow_deviations));
  }, [room?.id, room?.workflow_deviations]);

  useEffect(() => {
    setShowAddTask(false);
  }, [phaseTab, activeAreaId]);

  useEffect(() => {
    const saved = localStorage.getItem(WORKER_NAME_KEY);
    if (saved) setCheckWorkerName(saved);
  }, []);

  const handleToggleRoomLock = async () => {
    if (!room || !canEdit) return;
    const next = !room.is_locked;
    try {
      await client.entities.rooms.update({
        id: String(room.id),
        data: { is_locked: next },
      });
      setRoom({ ...room, is_locked: next });
      toast.success(next ? 'Room locked for workers' : 'Room unlocked');
    } catch {
      toast.error('Failed to update lock');
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!room) return;
    if (newStatus === 'blocked') {
      setShowBlockDialog(true);
      return;
    }
    try {
      await client.entities.rooms.update({
        id: String(room.id),
        data: { status: newStatus, blocked_reason: '' },
      });
      setRoom({ ...room, status: newStatus, blocked_reason: '' });
      toast.success('Status updated');
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleBlockRoom = async () => {
    if (!room) return;
    const reason = blockedReason.trim();
    if (!reason) {
      toast.error('Blocked reason is required');
      return;
    }
    try {
      await client.entities.rooms.update({
        id: String(room.id),
        data: { status: 'blocked', blocked_reason: reason },
      });
      setRoom({ ...room, status: 'blocked', blocked_reason: reason });
      setShowBlockDialog(false);
      toast.success('Room marked as blocked');
    } catch {
      toast.error('Failed to block room');
    }
  };

  const handleTaskClick = (task: Task) => {
    if (!canCheckItem) return;
    if (room?.is_locked && !canEdit) return;
    const savedName = localStorage.getItem(WORKER_NAME_KEY);
    if (savedName) {
      executeToggleTask(task, savedName);
    } else {
      setPendingTask(task);
      setShowCheckNameDialog(true);
    }
  };

  const executeToggleTask = async (task: Task, workerName: string) => {
    try {
      const newCompleted = !task.is_completed;
      const now = new Date();
      const checkedAt = now.toISOString().replace('T', ' ').substring(0, 19);
      await client.entities.tasks.update({
        id: String(task.id),
        data: {
          is_completed: newCompleted,
          checked_by: workerName,
          checked_at: checkedAt,
        },
      });
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, is_completed: newCompleted, checked_by: workerName, checked_at: checkedAt }
            : t
        )
      );
      const action = newCompleted ? 'checked' : 'unchecked';
      toast.success(`${workerName} ${action} "${task.name}"`);
    } catch {
      toast.error('Failed to update task');
    }
  };

  const handleConfirmCheckName = () => {
    if (!checkWorkerName.trim() || !pendingTask) return;
    const name = checkWorkerName.trim();
    localStorage.setItem(WORKER_NAME_KEY, name);
    setShowCheckNameDialog(false);
    executeToggleTask(pendingTask, name);
    setPendingTask(null);
  };

  const handleClearSavedName = () => {
    localStorage.removeItem(WORKER_NAME_KEY);
    setCheckWorkerName('');
    toast.success('Saved name cleared');
  };

  const handleAddTask = async () => {
    if (!newTaskName.trim() || !room) return;
    setAddingTask(true);
    try {
      const maxSort = tasks.length > 0 ? Math.max(...tasks.map((t) => t.sort_order)) : -1;
      const res =       await client.entities.tasks.create({
        data: {
          room_id: room.id,
          name: newTaskName.trim(),
          is_completed: false,
          sort_order: maxSort + 1,
          template_id: null,
          template_item_id: null,
          is_template_managed: false,
          is_overridden: false,
          phase: normalizeRoomPhase(phaseTab, phaseWorkflow),
          ...taskPhotoVisitAreaPayload(),
        },
      });
      const newTask = res?.data;
      if (newTask) {
        setTasks((prev) => [...prev, newTask]);
      }
      setNewTaskName('');
      toast.success('Item added');
    } catch {
      toast.error('Failed to add item');
    } finally {
      setAddingTask(false);
    }
  };

  const handleBulkAddTasks = async () => {
    if (!bulkTaskText.trim() || !room) return;
    setBulkAdding(true);
    try {
      const lines = bulkTaskText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length === 0) return;

      const maxSort = tasks.length > 0 ? Math.max(...tasks.map((t) => t.sort_order)) : -1;
      const newTasks: Task[] = [];

      const batchSize = 5;
      for (let i = 0; i < lines.length; i += batchSize) {
        const batch = lines.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((name, j) =>
            client.entities.tasks.create({
              data: {
                room_id: room.id,
                name,
                is_completed: false,
                sort_order: maxSort + 1 + i + j,
                template_id: null,
                template_item_id: null,
                is_template_managed: false,
                is_overridden: false,
                phase: normalizeRoomPhase(phaseTab, phaseWorkflow),
                ...taskPhotoVisitAreaPayload(),
              },
            })
          )
        );
        results.forEach((r) => {
          if (r?.data) newTasks.push(r.data);
        });
      }

      setTasks((prev) => [...prev, ...newTasks]);
      setBulkTaskText('');
      setShowBulkAddTasks(false);
      toast.success(`${newTasks.length} items added`);
    } catch {
      toast.error('Failed to add items');
    } finally {
      setBulkAdding(false);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    try {
      await client.entities.tasks.delete({ id: String(taskId) });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      toast.success('Item removed');
    } catch {
      toast.error('Failed to remove item');
    }
  };

  const startEditTask = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingTaskId(task.id);
    setEditTaskName(task.name);
  };

  const saveTaskName = async (taskId: number) => {
    if (!editTaskName.trim()) {
      setEditingTaskId(null);
      return;
    }
    try {
      const originalTask = tasks.find((t) => t.id === taskId);
      await client.entities.tasks.update({
        id: String(taskId),
        data: {
          name: editTaskName.trim(),
          is_overridden: originalTask?.is_template_managed ? true : originalTask?.is_overridden,
        },
      });
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, name: editTaskName.trim(), is_overridden: t.is_template_managed ? true : t.is_overridden }
            : t
        )
      );
      toast.success('Item name updated');
    } catch {
      toast.error('Failed to update item name');
    }
    setEditingTaskId(null);
  };

  const cancelEditTask = () => {
    setEditingTaskId(null);
    setEditTaskName('');
  };

  const persistWorkflowDeviations = async (next: WorkflowDeviation[], successMessage?: string) => {
    if (!room) return;
    setSavingDeviations(true);
    try {
      await client.entities.rooms.update({
        id: String(room.id),
        data: { workflow_deviations: next },
      });
      setDeviations(next);
      setRoom({ ...room, workflow_deviations: next });
      if (successMessage) toast.success(successMessage);
    } catch {
      toast.error('Failed to save deviations');
    } finally {
      setSavingDeviations(false);
    }
  };

  const taskPhotoVisitAreaPayload = () => {
    if (!room) return {};
    if (activeAreaId === DEFAULT_AREA_ID && !hasPersistedAreas(room.areas)) return {};
    return { area_id: activeAreaId };
  };

  const handleAddDeviation = async () => {
    if (!room) return;
    const text = newDeviationText.trim();
    if (!text) return;
    const phaseKey = normalizeRoomPhase(phaseTab, phaseWorkflow);
    const stamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const item: WorkflowDeviation = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `d-${Date.now()}`,
      phase_key: phaseKey,
      text,
      status: 'open',
      created_at: stamp,
      ...(showAreaTabs ? { area_id: activeAreaId } : {}),
    };
    await persistWorkflowDeviations([...deviations, item], 'Deviation added');
    setNewDeviationText('');
  };

  const handleToggleDeviationResolved = async (id: string) => {
    if (!canEdit || !room) return;
    const stamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const next = deviations.map((d) => {
      if (d.id !== id) return d;
      if (d.status === 'resolved') {
        return { ...d, status: 'open' as const, resolved_at: undefined };
      }
      return { ...d, status: 'resolved' as const, resolved_at: stamp };
    });
    await persistWorkflowDeviations(next, 'Deviation updated');
  };

  const handleSaveWorker = async () => {
    if (!room) return;
    try {
      await client.entities.rooms.update({
        id: String(room.id),
        data: { assigned_worker: assignedWorker },
      });
      setRoom({ ...room, assigned_worker: assignedWorker });
      toast.success('Worker updated');
    } catch {
      toast.error('Failed to update worker');
    }
  };

  const handleSetMainPhase = async (nextPhase: string) => {
    if (!room || !canMovePhase) return;
    const norm = normalizeRoomPhase(nextPhase, phaseWorkflow);
    const next = areasList.map((a, i) => (i === 0 ? { ...a, phase: norm } : a));
    try {
      await saveAreasToServer(next);
      setPhaseTab(norm);
      toast.success(`Main phase: ${phaseLabel(norm, phaseWorkflow)}`);
    } catch {
      toast.error('Failed to set main phase');
    }
  };

  const handleSetActiveAreaWorkflowPhase = async (nextPhase: string) => {
    if (!room || !canMovePhase || !activeArea) return;
    const norm = normalizeRoomPhase(nextPhase, phaseWorkflow);
    const next = areasList.map((a) => (a.id === activeAreaId ? { ...a, phase: norm } : a));
    try {
      await saveAreasToServer(next);
      setPhaseTab(norm);
      toast.success(`Area phase: ${phaseLabel(norm, phaseWorkflow)}`);
    } catch {
      toast.error('Failed to set area phase');
    }
  };

  const handleTogglePhaseWorkerLock = async (phaseKey: string) => {
    if (!room || !canEdit || !activeArea) return;
    const rp = normalizeRoomPhase(activeArea.phase ?? room.phase, phaseWorkflow);
    const overrides = coercePhaseLockOverrides(
      showAreaTabs || hasPersistedAreas(room.areas)
        ? activeArea.phase_lock_overrides
        : room.phase_lock_overrides
    );
    const workerLocked = phaseTabReadOnlyForWorker(rp, phaseKey, phaseWorkflow, overrides);
    const nextOv: Record<string, boolean> = { ...overrides };
    if (workerLocked) {
      const defaultLocked = phaseTabReadOnlyForWorker(rp, phaseKey, phaseWorkflow, {});
      if (defaultLocked) nextOv[phaseKey] = false;
      else delete nextOv[phaseKey];
    } else {
      nextOv[phaseKey] = true;
    }
    const nextAreas = areasList.map((a) =>
      a.id === activeAreaId ? { ...a, phase_lock_overrides: nextOv } : a
    );
    try {
      await saveAreasToServer(nextAreas);
      const after = phaseTabReadOnlyForWorker(rp, phaseKey, phaseWorkflow, nextOv);
      toast.success(after ? 'Phase locked for workers' : 'Phase open for workers');
    } catch {
      toast.error('Failed to update phase lock');
    }
  };

  const handleAddArea = async () => {
    const name = newAreaName.trim();
    if (!name || !room) return;
    const nid =
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `a-${Date.now()}`;
    const firstKey = phaseWorkflow[0]?.key ?? 'demontering';
    const next: RoomArea[] =
      showAreaTabs || hasPersistedAreas(room.areas)
        ? [...areasList, { id: nid, name, phase: firstKey, phase_lock_overrides: {} }]
        : [
            { ...areasList[0], id: DEFAULT_AREA_ID, name: areasList[0]?.name || 'Main' },
            { id: nid, name, phase: firstKey, phase_lock_overrides: {} },
          ];
    try {
      await saveAreasToServer(next);
      setNewAreaName('');
      setShowManageAreas(false);
      setActiveAreaId(nid);
      toast.success('Area added');
    } catch {
      toast.error('Failed to add area');
    }
  };

  const commitRenameArea = async (id: string, name: string) => {
    const n = name.trim();
    if (!n || !room) return;
    const next = areasList.map((a) => (a.id === id ? { ...a, name: n } : a));
    try {
      await saveAreasToServer(next);
      toast.success('Area renamed');
    } catch {
      toast.error('Failed to rename area');
    }
  };

  const handleDeleteArea = async (delId: string) => {
    if (delId === primaryAreaId) {
      toast.error('Cannot remove the primary area');
      return;
    }
    if (!room) return;
    const next = areasList.filter((a) => a.id !== delId);
    try {
      const relTasks = tasks.filter((t) => String(t.area_id || '').trim() === delId);
      await Promise.all(
        relTasks.map((t) =>
          client.entities.tasks.update({ id: String(t.id), data: { area_id: null } })
        )
      );
      const relPh = photos.filter((p) => String(p.area_id || '').trim() === delId);
      await Promise.all(
        relPh.map((p) =>
          client.entities.room_photos.update({ id: String(p.id), data: { area_id: null } })
        )
      );
      const relV = visits.filter((v) => String(v.area_id || '').trim() === delId);
      await Promise.all(
        relV.map((v) =>
          client.entities.room_visits.update({ id: String(v.id), data: { area_id: null } })
        )
      );
      await saveAreasToServer(next);
      if (activeAreaId === delId) setActiveAreaId(primaryAreaId);
      toast.success('Area removed');
    } catch {
      toast.error('Failed to remove area');
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !room) return;
    setUploading(true);
    try {
      const objectKey = `room-${room.id}/${Date.now()}-${file.name}`;
      const uploadRes = await client.storage.getUploadUrl({
        bucket_name: 'room-photos',
        object_key: objectKey,
      });
      const uploadUrl = uploadRes?.data?.upload_url;
      if (!uploadUrl) throw new Error('No upload URL');

      await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      await client.entities.room_photos.create({
        data: {
          room_id: room.id,
          object_key: objectKey,
          filename: file.name,
          caption: '',
          phase: normalizeRoomPhase(phaseTab, phaseWorkflow),
          ...taskPhotoVisitAreaPayload(),
        },
      });
      toast.success('Photo uploaded');
      loadData();
    } catch {
      toast.error('Failed to upload photo');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeletePhoto = async (photo: Photo) => {
    try {
      await client.entities.room_photos.delete({ id: String(photo.id) });
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      toast.success('Photo deleted');
    } catch {
      toast.error('Failed to delete photo');
    }
  };

  const handleDeleteRoom = async () => {
    if (!room) return;
    setDeletingRoom(true);
    try {
      await client.entities.rooms.delete({ id: String(room.id) });
      toast.success('Room deleted');
      navigate(`/project/${projectId}/floor/${floorId}`);
    } catch {
      toast.error('Failed to delete room');
    } finally {
      setDeletingRoom(false);
      setShowDeleteRoomDialog(false);
    }
  };

  const activityEntries = useMemo(() => {
    if (!room) return [];
    const primary = areasList[0]?.id ?? DEFAULT_AREA_ID;
    const sel = normalizeRoomPhase(phaseTab, phaseWorkflow);
    const rows: { t: number; msg: string }[] = [];
    for (const v of visits) {
      if (!taskBelongsToArea(v.area_id, activeAreaId, primary)) continue;
      if (!visitMatchesPhase(v.phase, sel, phaseWorkflow)) continue;
      const t = parseActivityTime(v.visited_at);
      const tail = v.action?.trim() ? `: ${v.action.trim()}` : ' visited the room';
      rows.push({ t, msg: `${v.worker_name}${tail}` });
    }
    for (const p of photos) {
      if (!taskBelongsToArea(p.area_id, activeAreaId, primary)) continue;
      if (!photoMatchesPhase(p.phase, sel, phaseWorkflow)) continue;
      const t = parseActivityTime(p.created_at ?? null);
      rows.push({
        t,
        msg: `Photo uploaded${p.filename ? `: ${p.filename}` : ''}`,
      });
    }
    for (const task of tasks) {
      if (!taskBelongsToArea(task.area_id, activeAreaId, primary)) continue;
      if (storedChecklistPhase(task.phase, phaseWorkflow) !== sel) continue;
      if (task.is_completed && task.checked_at && task.checked_by) {
        rows.push({
          t: parseActivityTime(task.checked_at),
          msg: `${task.checked_by} checked off “${task.name}”`,
        });
      }
    }
    rows.sort((a, b) => b.t - a.t);
    return rows.filter((r) => r.t > 0).slice(0, 100);
  }, [room, visits, photos, tasks, phaseTab, phaseWorkflow, activeAreaId, areasList]);

  const deviationsForPhase = useMemo(() => {
    const sel = normalizeRoomPhase(phaseTab, phaseWorkflow);
    return deviations.filter((d) => {
      const dArea = d.area_id?.trim() || DEFAULT_AREA_ID;
      return (
        dArea === activeAreaId && normalizeRoomPhase(d.phase_key, phaseWorkflow) === sel
      );
    });
  }, [deviations, phaseTab, phaseWorkflow, activeAreaId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Room not found</p>
      </div>
    );
  }

  const currentStatus = STATUS_OPTIONS.find((s) => s.value === room.status) || STATUS_OPTIONS[0];
  const uniqueWorkers = [...new Set(visits.map((v) => v.worker_name))];
  const savedWorkerName = localStorage.getItem(WORKER_NAME_KEY);
  const editsBlocked = Boolean(room.is_locked) && !canEdit;
  const boardPhaseNorm = normalizeRoomPhase(areasList[0]?.phase ?? room.phase, phaseWorkflow);
  const areaMainPhaseNorm = normalizeRoomPhase(activeArea?.phase ?? room.phase, phaseWorkflow);
  const workflowPhaseKeys = phaseKeys(phaseWorkflow);
  const lockOv = coercePhaseLockOverrides(
    activeArea?.phase_lock_overrides ?? room.phase_lock_overrides
  );
  const selPhase = normalizeRoomPhase(phaseTab, phaseWorkflow);
  const phaseWorkerLocked = phaseTabReadOnlyForWorker(areaMainPhaseNorm, selPhase, phaseWorkflow, lockOv);
  const phaseReadOnly = !canEdit && phaseWorkerLocked;
  const tasksInArea = tasks.filter((t) => taskBelongsToArea(t.area_id, activeAreaId, primaryAreaId));
  const tasksForPhase = tasksInArea.filter((t) => storedChecklistPhase(t.phase, phaseWorkflow) === selPhase);
  const photosForPhase = photos.filter(
    (p) =>
      taskBelongsToArea(p.area_id, activeAreaId, primaryAreaId) &&
      photoMatchesPhase(p.phase, selPhase, phaseWorkflow)
  );
  const completedForPhase = tasksForPhase.filter((t) => t.is_completed).length;
  const totalForPhase = tasksForPhase.length;
  const canInteractChecklist = canCheckItem && !editsBlocked && !phaseReadOnly;
  const canMutateChecklist = canAddChecklistItem && !editsBlocked && !phaseReadOnly;
  const canMutatePhaseMedia = !editsBlocked && !phaseReadOnly;
  const chipUiSel = computePhaseChipUi(selPhase, areaMainPhaseNorm, phaseWorkflow, lockOv, totalForPhase, completedForPhase);

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-background pb-8">
      <div className="px-3 py-3 sm:px-4 sm:py-4 max-w-lg mx-auto space-y-4">
        {/* Room header — clear anchor; admin controls stay quiet */}
        <Card className="border-border/45 bg-background/70 shadow-none p-2.5 sm:p-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-foreground tracking-tight leading-tight sm:text-[1.35rem]">
              Room {room.room_number}
            </h2>
            <p className="mt-2 text-xs text-muted-foreground/85 leading-snug">
              <span>{floor?.name || '—'}</span>
              <span className="text-muted-foreground/35 mx-1.5">·</span>
              {showAreaTabs ? (
                <>
                  <span>{activeArea?.name ?? '—'}</span>
                  <span className="text-muted-foreground/35 mx-1.5">·</span>
                  <span>{phaseLabel(areaMainPhaseNorm, phaseWorkflow)}</span>
                </>
              ) : (
                <span>{phaseLabel(boardPhaseNorm, phaseWorkflow)}</span>
              )}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-t border-border/25 pt-2.5">
            <div className="min-w-0 flex flex-wrap items-center gap-1.5">
              {sectionVisibility.assigned_worker &&
                (canEditRoom ? (
                  <>
                    <span className="text-[10px] text-muted-foreground/70 shrink-0">Assigned</span>
                    <Input
                      placeholder="Worker"
                      value={assignedWorker}
                      onChange={(e) => setAssignedWorker(e.target.value)}
                      className="h-6 max-w-[8.5rem] text-[11px] border-border/40 bg-muted/20 text-foreground/90"
                      disabled={editsBlocked}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[10px] text-muted-foreground/80 hover:text-foreground"
                      onClick={handleSaveWorker}
                      disabled={editsBlocked}
                    >
                      Save
                    </Button>
                  </>
                ) : room.assigned_worker ? (
                  <p className="text-[10px] text-muted-foreground/75">
                    Assigned <span className="text-foreground/85">{room.assigned_worker}</span>
                  </p>
                ) : null)}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-0.5 text-[10px] text-muted-foreground/70 hover:text-foreground px-1.5"
                  onClick={handleToggleRoomLock}
                >
                  {room.is_locked ? (
                    <>
                      <Unlock className="h-3 w-3 opacity-80" />
                      Unlock
                    </>
                  ) : (
                    <>
                      <Lock className="h-3 w-3 opacity-80" />
                      Lock
                    </>
                  )}
                </Button>
              ) : null}
              {sectionVisibility.status &&
                (canChangeStatus ? (
                  <Select value={room.status} onValueChange={handleStatusChange} disabled={editsBlocked}>
                    <SelectTrigger className="h-6 w-[8.5rem] text-[10px] border-border/40 bg-muted/15 text-muted-foreground">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge className={`${currentStatus.color} border-0 text-[10px] font-normal opacity-90`}>{currentStatus.label}</Badge>
                ))}
            </div>
          </div>

          {canMovePhase ? (
            <div className="mt-2 space-y-2 border-t border-border/25 pt-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                <label className="text-[10px] text-muted-foreground/70 shrink-0">Main phase (board)</label>
                <Select value={boardPhaseNorm} onValueChange={handleSetMainPhase} disabled={editsBlocked}>
                  <SelectTrigger className="h-6 text-[11px] border-border/40 bg-muted/15 text-foreground/90">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workflowPhaseKeys.map((k) => (
                      <SelectItem key={k} value={k}>
                        {phaseLabel(k, phaseWorkflow)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {showAreaTabs && activeAreaId !== primaryAreaId ? (
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <label className="text-[10px] text-muted-foreground/70 shrink-0">Area phase</label>
                  <Select
                    value={areaMainPhaseNorm}
                    onValueChange={handleSetActiveAreaWorkflowPhase}
                    disabled={editsBlocked}
                  >
                    <SelectTrigger className="h-6 text-[11px] border-border/40 bg-muted/15 text-foreground/90">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {workflowPhaseKeys.map((k) => (
                        <SelectItem key={k} value={k}>
                          {phaseLabel(k, phaseWorkflow)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          ) : null}

          {canEdit ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/25 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[10px]"
                disabled={editsBlocked}
                onClick={() => setShowManageAreas(true)}
              >
                Areas…
              </Button>
            </div>
          ) : null}

          {editsBlocked ? (
            <div className="mt-2 rounded-md border-l-2 border-muted-foreground/25 bg-muted/15 pl-2 pr-2 py-1 flex items-start gap-1.5">
              <Lock className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-[10px] text-muted-foreground leading-snug">
                Room locked — view only unless you are an admin.
              </p>
            </div>
          ) : null}

          {room.status === 'blocked' && room.blocked_reason ? (
            <div className="mt-2 bg-red-50/80 dark:bg-red-950/35 border border-red-200/60 dark:border-red-900/40 rounded-md px-2 py-1">
              <div className="flex items-center gap-1 text-red-600 dark:text-red-400 text-[10px] font-medium">
                <Ban className="h-3 w-3" />
                Blocked
              </div>
              <p className="text-[11px] text-red-700 dark:text-red-300 mt-0.5 leading-snug">{room.blocked_reason}</p>
            </div>
          ) : null}

          {canDeleteRoom ? (
            <Button
              variant="ghost"
              className="mt-2 h-6 w-full text-[10px] text-muted-foreground/60 hover:text-destructive hover:bg-destructive/5"
              onClick={() => setShowDeleteRoomDialog(true)}
            >
              <Trash2 className="h-3 w-3 mr-1 opacity-70" />
              Delete room
            </Button>
          ) : null}
        </Card>

        {(sectionVisibility.checklist || sectionVisibility.photos) && (
          <div className="w-full space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoUpload}
            />

            {showAreaTabs ? (
              <div className="-mx-1 flex gap-1.5 overflow-x-auto py-2 px-1 snap-x snap-mandatory">
                {areasList.map((a) => {
                  const isSel = a.id === activeAreaId;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setActiveAreaId(a.id)}
                      className={cn(
                        'snap-start shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                        isSel
                          ? 'border-[#1E3A5F] bg-[#1E3A5F]/10 text-foreground dark:border-blue-400 dark:bg-blue-950/40'
                          : 'border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/40'
                      )}
                    >
                      {a.name}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="-mx-1 flex gap-2.5 overflow-x-auto py-3 px-1 snap-x snap-mandatory sm:py-3.5">
              {workflowPhaseKeys.map((key) => {
                const tks = tasksInArea.filter((t) => storedChecklistPhase(t.phase, phaseWorkflow) === key);
                const done = tks.filter((x) => x.is_completed).length;
                const tot = tks.length;
                const ui = computePhaseChipUi(key, areaMainPhaseNorm, phaseWorkflow, lockOv, tot, done);
                const isSel = key === selPhase;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPhaseTab(key)}
                    className={cn(
                      'snap-start flex min-w-[7.75rem] max-w-[10rem] flex-col rounded-lg border px-2 py-2 text-left text-xs transition-shadow sm:min-w-[8.75rem]',
                      isSel &&
                        'ring-2 ring-[#1E3A5F] ring-offset-2 ring-offset-slate-50 shadow-sm dark:ring-blue-400 dark:ring-offset-background',
                      ui.isMain &&
                        'border-amber-400/80 bg-amber-50/95 dark:border-amber-600 dark:bg-amber-950/50',
                      !ui.isMain && ui.status === 'Completed' &&
                        'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30',
                      !ui.isMain && ui.status === 'Locked' &&
                        'border-slate-300 bg-slate-100/80 dark:border-slate-600 dark:bg-slate-900/50',
                      !ui.isMain && ui.status === 'Not started' &&
                        'border-dashed border-slate-200 bg-muted/30 dark:border-slate-700',
                      !ui.isMain && ui.status === 'Open' &&
                        'border-slate-200 bg-background dark:border-slate-700'
                    )}
                  >
                    <span className="font-semibold leading-tight text-slate-800 dark:text-foreground line-clamp-2">
                      {phaseLabel(key, phaseWorkflow)}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span
                        className={cn(
                          'font-medium',
                          ui.status === 'Active' && 'text-amber-900 dark:text-amber-200',
                          ui.status === 'Completed' && 'text-emerald-800 dark:text-emerald-300',
                          ui.status === 'Locked' && 'text-slate-600 dark:text-slate-400'
                        )}
                      >
                        {ui.status}
                      </span>
                      {ui.workerLocked ? <Lock className="h-3 w-3 shrink-0 text-slate-500" aria-hidden /> : null}
                      {ui.progress ? <span className="text-slate-600 dark:text-slate-400">· {ui.progress}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>

            {selPhase !== areaMainPhaseNorm ? (
              <div className="flex flex-col gap-1.5 rounded-md border border-amber-200/70 bg-amber-50/70 px-2.5 py-2 dark:border-amber-900/45 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-amber-950 dark:text-amber-100 leading-snug">
                  Viewing <span className="font-medium">{phaseLabel(selPhase, phaseWorkflow)}</span> — main is{' '}
                  <span className="font-medium">{phaseLabel(areaMainPhaseNorm, phaseWorkflow)}</span>.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 shrink-0 text-xs border-amber-200/80 bg-white/90 hover:bg-amber-100/80 dark:border-amber-800 dark:bg-amber-950 dark:hover:bg-amber-900"
                  onClick={() => setPhaseTab(areaMainPhaseNorm)}
                >
                  Main phase
                </Button>
              </div>
            ) : null}

            {selPhase !== areaMainPhaseNorm && !phaseReadOnly ? (
              <p className="text-[11px] text-muted-foreground rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 leading-snug">
                Not the main phase, but still open for editing.
              </p>
            ) : null}

            {phaseReadOnly ? (
              <div className="rounded-md border-l-2 border-muted-foreground/20 bg-muted/10 pl-2.5 pr-2 py-1.5 dark:bg-muted/15">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Read-only for your role — only an admin can change this phase.
                </p>
              </div>
            ) : null}

            {canEdit ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => handleTogglePhaseWorkerLock(selPhase)}
                >
                  {phaseWorkerLocked ? (
                    <>
                      <Unlock className="h-3 w-3" />
                      Open phase for workers
                    </>
                  ) : (
                    <>
                      <Lock className="h-3 w-3" />
                      Lock phase for workers
                    </>
                  )}
                </Button>
              </div>
            ) : null}

            <div className="space-y-4">
                  {sectionVisibility.checklist && (
                    <Card className="overflow-hidden border-border/55 bg-card shadow-none ring-1 ring-border/40 dark:ring-border/50">
                      <div className="border-b border-border/45 bg-muted/[0.35] dark:bg-muted/20 px-2 py-1.5 sm:px-2.5 sm:py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 pt-0.5">
                            <h3 className="text-[15px] font-semibold tracking-tight text-foreground flex items-center gap-1.5">
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 opacity-85" />
                              Checklist
                            </h3>
                            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/75">
                              <span className="text-muted-foreground">{phaseLabel(selPhase, phaseWorkflow)}</span>
                              {chipUiSel.workerLocked ? (
                                <span className="text-muted-foreground/80">
                                  {' '}
                                  · locked for workers
                                </span>
                              ) : null}
                              {totalForPhase === 0 ? (
                                <span className="text-muted-foreground/70"> · empty</span>
                              ) : null}
                              {totalForPhase > 0 && completedForPhase === totalForPhase ? (
                                <span className="text-muted-foreground/80"> · all done</span>
                              ) : null}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-0.5 shrink-0">
                            <span
                              className="text-base font-semibold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-300"
                              title={`${completedForPhase} of ${totalForPhase} complete`}
                            >
                              {completedForPhase}/{totalForPhase}
                            </span>
                            {canMutateChecklist && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-[10px] border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                onClick={() => setShowBulkAddTasks(true)}
                              >
                                <ListPlus className="h-3 w-3 mr-1" />
                                Bulk
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="p-1.5 sm:p-2 pt-1.5">

                      {savedWorkerName && (
                        <div className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-1.5 py-1 mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground truncate">
                              As <strong className="text-foreground/90">{savedWorkerName}</strong>
                            </span>
                          </div>
                          <button
                            type="button"
                            className="text-[10px] text-muted-foreground hover:text-foreground hover:underline shrink-0"
                            onClick={handleClearSavedName}
                          >
                            Change
                          </button>
                        </div>
                      )}

                      <div className="divide-y divide-border/50 rounded-md border border-border/50 bg-background dark:bg-background/80">
                        {tasksForPhase.length === 0 ? (
                          <p className="py-5 text-center text-sm text-muted-foreground/90">No checklist items for this phase.</p>
                        ) : null}
                        {tasksForPhase.map((task) => (
                          <div
                            key={task.id}
                            className="hover:bg-muted/40 dark:hover:bg-muted/25 active:bg-muted/50 transition-colors group/task"
                          >
                            <div className="flex items-start gap-2.5 min-h-[2.45rem] py-2 px-2 sm:px-2">
                              {editingTaskId === task.id ? (
                                <div className="flex items-center gap-2 flex-1" onClick={(e) => e.stopPropagation()}>
                                  <Input
                                    value={editTaskName}
                                    onChange={(e) => setEditTaskName(e.target.value)}
                                    className="h-9 text-sm flex-1"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveTaskName(task.id);
                                      if (e.key === 'Escape') cancelEditTask();
                                    }}
                                    onBlur={() => saveTaskName(task.id)}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 text-emerald-500 hover:text-emerald-700"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      saveTaskName(task.id);
                                    }}
                                  >
                                    <Check className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-600"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      cancelEditTask();
                                    }}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className={cn(
                                      'flex items-start gap-3 flex-1 text-left min-w-0 rounded-md -m-1 p-1 sm:-m-0.5 sm:p-0.5',
                                      !canInteractChecklist ? 'cursor-default' : ''
                                    )}
                                    onClick={() => handleTaskClick(task)}
                                    disabled={!canInteractChecklist}
                                  >
                                    <Checkbox
                                      checked={task.is_completed}
                                      className="h-6 w-6 rounded-md mt-0.5 shrink-0 pointer-events-none"
                                      onCheckedChange={() => {}}
                                      disabled={!canInteractChecklist}
                                    />
                                    <div className="flex-1 min-w-0 pt-px">
                                      <div className="flex items-center gap-1.5 group/tname">
                                        <span
                                          className={`text-sm leading-snug block ${
                                            task.is_completed
                                              ? 'line-through text-muted-foreground'
                                              : 'text-foreground'
                                          }`}
                                        >
                                          {task.name}
                                        </span>
                                        {canMutateChecklist && (
                                          <button
                                            type="button"
                                            className="opacity-0 group-hover/tname:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-1.5 -m-1 rounded-md min-h-9 min-w-9 inline-flex items-center justify-center hover:bg-muted/70"
                                            onClick={(e) => startEditTask(e, task)}
                                            aria-label="Edit item name"
                                          >
                                            <Pencil className="h-3.5 w-3.5" />
                                          </button>
                                        )}
                                      </div>
                                      {task.checked_by && (
                                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                          <Badge
                                            variant="secondary"
                                            className={`text-[10px] h-5 px-1.5 ${
                                              task.is_completed
                                                ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                                                : 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                                            }`}
                                          >
                                            <User className="h-2.5 w-2.5 mr-0.5" />
                                            {task.checked_by}
                                          </Badge>
                                          {task.checked_at && (
                                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                              <Clock className="h-2.5 w-2.5" />
                                              {formatVisitDate(task.checked_at)}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </button>
                                  {canDeleteChecklistItem && canMutateChecklist && (
                                    <button
                                      type="button"
                                      className="opacity-0 group-hover/task:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-2 -m-1 shrink-0 mt-0.5 min-h-10 min-w-10 flex items-center justify-center rounded-md hover:bg-muted/80"
                                      onClick={() => handleDeleteTask(task.id)}
                                      aria-label="Remove item"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {canMutateChecklist && (
                        <>
                          {showAddTask ? (
                            <div className="mt-2 flex gap-2">
                              <Input
                                placeholder="New checklist item..."
                                value={newTaskName}
                                onChange={(e) => setNewTaskName(e.target.value)}
                                className="h-10 flex-1"
                                autoFocus
                                disabled={addingTask}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && newTaskName.trim()) handleAddTask();
                                  if (e.key === 'Escape') {
                                    setShowAddTask(false);
                                    setNewTaskName('');
                                  }
                                }}
                              />
                              <Button
                                size="sm"
                                className="h-10 bg-emerald-500 hover:bg-emerald-600 text-white"
                                onClick={handleAddTask}
                                disabled={!newTaskName.trim() || addingTask}
                              >
                                {addingTask ? '...' : 'Add'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-10 px-2"
                                onClick={() => {
                                  setShowAddTask(false);
                                  setNewTaskName('');
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="mt-2 w-full flex items-center gap-2 text-sm text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 py-2 px-2.5 rounded-md border border-dashed border-border/70 dark:border-border hover:border-emerald-300/80 dark:hover:border-emerald-700 transition-colors"
                              onClick={() => setShowAddTask(true)}
                            >
                              <Plus className="h-4 w-4" />
                              Add checklist item
                            </button>
                          )}
                        </>
                      )}

                      {totalForPhase > 0 && (
                        <div className="mt-2 bg-muted rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-emerald-500/90 dark:bg-emerald-500/85 h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${(completedForPhase / totalForPhase) * 100}%`,
                            }}
                          />
                        </div>
                      )}
                      </div>
                    </Card>
                  )}

                  {sectionVisibility.photos && (
                    <Collapsible defaultOpen={false} className="rounded-md border border-border/40 bg-muted/[0.07] shadow-none">
                        <CollapsibleTrigger className="group flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/25 rounded-md">
                          <span className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground/90">
                            <Camera className="h-3.5 w-3.5 opacity-70" />
                            Photos
                            <span className="font-normal opacity-80">({photosForPhase.length})</span>
                          </span>
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform group-data-[state=open]:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/40">
                            {canUploadPhoto ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 w-full sm:w-auto text-xs"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading || !canMutatePhaseMedia}
                              >
                                {uploading ? 'Uploading...' : 'Add photo'}
                              </Button>
                            ) : null}
                            {photosForPhase.length === 0 ? (
                              <div className="text-center py-3 text-muted-foreground text-xs">
                                <ImageIcon className="h-6 w-6 mx-auto mb-1.5 opacity-40" />
                                <p>No photos for this phase</p>
                              </div>
                            ) : (
                              <div className="grid grid-cols-3 gap-2">
                                {photosForPhase.map((photo) => (
                                  <div
                                    key={photo.id}
                                    className="relative group aspect-square rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800"
                                  >
                                    {photo.downloadUrl ? (
                                      <img
                                        src={photo.downloadUrl}
                                        alt={photo.filename}
                                        className="w-full h-full object-cover cursor-pointer"
                                        onClick={() => setShowPhotoPreview(photo.downloadUrl || null)}
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center">
                                        <ImageIcon className="h-6 w-6 text-slate-300 dark:text-slate-600" />
                                      </div>
                                    )}
                                    {canDeletePhoto && canMutatePhaseMedia && (
                                      <button
                                        type="button"
                                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => handleDeletePhoto(photo)}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                    </Collapsible>
                  )}

                  <Collapsible defaultOpen={false} className="rounded-md border border-border/40 bg-muted/[0.07] shadow-none">
                      <CollapsibleTrigger className="group flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/25 rounded-md">
                        <span className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground/90">
                          <History className="h-3.5 w-3.5 opacity-70" />
                          Activity
                          <span className="font-normal opacity-80">({activityEntries.length})</span>
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform group-data-[state=open]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-3 pb-3 pt-0 max-h-56 overflow-y-auto space-y-1.5 text-xs border-t border-border/40">
                          {activityEntries.length === 0 ? (
                            <p className="text-muted-foreground py-2 leading-snug">
                              No activity for this phase yet.
                            </p>
                          ) : (
                            activityEntries.map((row, i) => (
                              <div
                                key={`${row.t}-${i}`}
                                className="flex gap-2 border-b border-border/30 pb-1.5 last:border-0 last:pb-0"
                              >
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 w-14">
                                  {formatActivityWhen(row.t)}
                                </span>
                                <span className="text-foreground/85 min-w-0 leading-snug">{row.msg}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </CollapsibleContent>
                  </Collapsible>

                  <Collapsible defaultOpen={false} className="rounded-md border border-border/40 bg-muted/[0.07] shadow-none">
                    <CollapsibleTrigger className="group flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/25 rounded-md">
                      <span className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground/90">
                        <AlertTriangle className="h-3.5 w-3.5 opacity-70 text-amber-600 dark:text-amber-500" />
                        Deviations / notes
                        <span className="font-normal opacity-80">({deviationsForPhase.length})</span>
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-3 pb-3 pt-0 space-y-3 border-t border-border/40">
                        <p className="text-[11px] text-muted-foreground leading-snug pt-2">
                          Issues or missing work — not a chat. This phase only.
                        </p>
                        <div className="space-y-2">
                          {deviationsForPhase.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-0.5">None for this phase.</p>
                          ) : (
                            deviationsForPhase.map((d) => (
                              <div
                                key={d.id}
                                className={cn(
                                  'rounded-md border px-2.5 py-2 text-xs',
                                  d.status === 'resolved'
                                    ? 'border-border/60 bg-muted/20'
                                    : 'border-amber-200/70 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20'
                                )}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <Badge
                                      variant="secondary"
                                      className={cn(
                                        'text-[10px] mb-1 h-5',
                                        d.status === 'resolved'
                                          ? 'bg-muted'
                                          : 'bg-amber-100/90 text-amber-950 dark:bg-amber-900/50 dark:text-amber-100'
                                      )}
                                    >
                                      {d.status === 'resolved' ? 'Resolved' : 'Open'}
                                    </Badge>
                                    <p className="text-foreground leading-snug">{d.text}</p>
                                  </div>
                                  {canEdit && !editsBlocked ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-[11px] shrink-0"
                                      disabled={savingDeviations}
                                      onClick={() => handleToggleDeviationResolved(d.id)}
                                    >
                                      {d.status === 'resolved' ? 'Reopen' : 'Resolve'}
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                        {canInteractChecklist && !editsBlocked ? (
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Input
                              placeholder="Add a deviation…"
                              value={newDeviationText}
                              onChange={(e) => setNewDeviationText(e.target.value)}
                              className="h-9 text-xs"
                              disabled={savingDeviations}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleAddDeviation();
                              }}
                            />
                            <Button
                              type="button"
                              size="sm"
                              className="h-9 sm:w-24 text-xs"
                              disabled={!newDeviationText.trim() || savingDeviations}
                              onClick={() => void handleAddDeviation()}
                            >
                              Add
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
            </div>
          </div>
        )}

      </div>

      <Dialog open={showManageAreas} onOpenChange={setShowManageAreas}>
        <DialogContent className="max-w-md mx-4">
          <DialogHeader>
            <DialogTitle>Room areas</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground mb-2 leading-snug">
            Each area has its own phases and checklist. The first area matches the floor board “main phase”.
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {areasList.map((a) => (
              <div key={a.id} className="flex items-center gap-2 border border-border/50 rounded-md p-2">
                <Input
                  defaultValue={a.name}
                  key={`${a.id}-${a.name}`}
                  className="h-8 text-sm flex-1"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== a.name) void commitRenameArea(a.id, v);
                  }}
                />
                {a.id === primaryAreaId ? (
                  <span className="text-[10px] text-muted-foreground shrink-0 w-14">Primary</span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-destructive shrink-0 px-2"
                    onClick={() => void handleDeleteArea(a.id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3 pt-2 border-t border-border/40">
            <Input
              placeholder="New area name"
              value={newAreaName}
              onChange={(e) => setNewAreaName(e.target.value)}
              className="h-9 text-sm flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAddArea();
              }}
            />
            <Button
              type="button"
              size="sm"
              className="h-9 shrink-0"
              onClick={() => void handleAddArea()}
              disabled={!newAreaName.trim()}
            >
              Add
            </Button>
          </div>
          <DialogFooter className="mt-2">
            <Button type="button" variant="secondary" className="w-full" onClick={() => setShowManageAreas(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block Dialog */}
      <Dialog open={showBlockDialog} onOpenChange={setShowBlockDialog}>
        <DialogContent className="max-w-sm mx-4">
          <DialogForm onSubmit={(e) => { e.preventDefault(); handleBlockRoom(); }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-red-500" />
              Block Room
            </DialogTitle>
          </DialogHeader>
          <Input
            onKeyDown={(e) => { if (e.key === "Escape") setShowBlockDialog(false); }}
            placeholder="Reason (e.g., waiting for plumbing)"
            value={blockedReason}
            onChange={(e) => setBlockedReason(e.target.value)}
            className="h-12"
          />
          <DialogFooter>
            <Button
              type="submit"
              className="w-full bg-red-500 hover:bg-red-600 h-12"
            >
              Mark as Blocked
            </Button>
          </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      {/* Delete Room Dialog */}
      <Dialog open={showDeleteRoomDialog} onOpenChange={(open) => { if (!deletingRoom) setShowDeleteRoomDialog(open); }}>
        <DialogContent className="max-w-sm mx-4">
          <DialogForm onSubmit={(e) => { e.preventDefault(); handleDeleteRoom(); }}>
          <DialogHeader>
            <DialogTitle>Delete room?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete this room and its checklist items, photos, visits, and deviations.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteRoomDialog(false)} disabled={deletingRoom}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={deletingRoom}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {deletingRoom ? 'Deleting...' : 'Delete room'}
            </Button>
          </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      {/* Checklist Identity Dialog */}
      <Dialog open={showCheckNameDialog} onOpenChange={setShowCheckNameDialog}>
        <DialogContent className="max-w-sm mx-4">
          <DialogForm onSubmit={(e) => { e.preventDefault(); handleConfirmCheckName(); }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-emerald-500" />
              Who&apos;s checking?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter your name so we can track who checked this item. Your name will be remembered for future checks.
            </p>
            <Input
              placeholder="e.g., John Smith"
              value={checkWorkerName}
              onChange={(e) => setCheckWorkerName(e.target.value)}
              className="h-12"
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmCheckName(); }}
            />

            {uniqueWorkers.length > 0 && !checkWorkerName && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Known workers:</p>
                <div className="flex flex-wrap gap-1.5">
                  {uniqueWorkers.slice(0, 8).map((name) => (
                    <button
                      key={name}
                      className="text-xs px-2.5 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors"
                      onClick={() => setCheckWorkerName(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!checkWorkerName.trim()}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white h-12"
            >
              Continue
            </Button>
          </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      {/* Bulk Add Tasks Dialog */}
      <Dialog open={showBulkAddTasks} onOpenChange={(open) => { if (!bulkAdding) setShowBulkAddTasks(open); }}>
        <DialogContent className="max-w-sm mx-4">
          <DialogForm onSubmit={(e) => { e.preventDefault(); handleBulkAddTasks(); }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListPlus className="h-5 w-5 text-emerald-500" />
              Bulk Add Checklist Items
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter one item per line. All items will be added to the checklist.
            </p>
            <Textarea
              placeholder={"Cable routing\nInstall wall boxes\nHeating cable installation\nMounting equipment\nTesting\nFinal inspection"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleBulkAddTasks();
                }
              }}
              value={bulkTaskText}
              onChange={(e) => setBulkTaskText(e.target.value)}
              rows={8}
              className="resize-none font-mono text-sm"
              disabled={bulkAdding}
            />
            {bulkTaskText.trim() && (
              <p className="text-xs text-muted-foreground">
                {bulkTaskText.split('\n').filter((l) => l.trim()).length} items will be added
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!bulkTaskText.trim() || bulkAdding}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white h-12"
            >
              {bulkAdding ? 'Adding...' : `Add ${bulkTaskText.split('\n').filter((l) => l.trim()).length || 0} Items`}
            </Button>
          </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      {/* Photo Preview */}
      {showPhotoPreview && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setShowPhotoPreview(null)}
        >
          <button
            className="absolute top-4 right-4 text-white bg-white/20 rounded-full p-2"
            onClick={() => setShowPhotoPreview(null)}
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={showPhotoPreview}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg"
          />
        </div>
      )}
    </div>
  );
}