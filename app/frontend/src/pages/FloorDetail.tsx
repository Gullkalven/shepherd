import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import PhaseBoard, { type ChecklistSummaryMap } from '@/components/PhaseBoard';
import RoomDashboardCard from '@/components/RoomDashboardCard';
import RoomFloorCardContextMenu from '@/components/RoomFloorCardContextMenu';
import {
  computeFloorPhaseProgress,
  DEFAULT_PHASE_WORKFLOW,
  formatPhaseStrip,
  normalizeRoomPhase,
  phaseLabel,
  storedChecklistPhase,
  type FloorPhaseProgressEntry,
  type PhaseWorkflowEntry,
} from '@/lib/roomPhases';
import { taskCountsForFloorBoard } from '@/lib/roomAreas';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogForm } from '@/components/ui/dialog';
import {
  Plus,
  DoorOpen,
  LayoutGrid,
  Columns3,
  Zap,
  Pencil,
  Check,
  X,
  Ban,
  Trash2,
  ListOrdered,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
interface Room {
  id: number;
  room_number: string;
  status: string;
  phase?: string;
  assigned_worker?: string;
  comment?: string;
  blocked_reason?: string;
  updated_at?: string;
  is_locked?: boolean;
  areas?: unknown;
}

interface ChecklistTemplate {
  id: number;
  name: string;
}

interface ChecklistTemplateItem {
  id: number;
  template_id: number;
  name: string;
  sort_order?: number;
}

export default function FloorDetail() {
  const { projectId, floorId } = useParams<{ projectId: string; floorId: string }>();
  const navigate = useNavigate();
  const { canCreateRoom, canDeleteRoom, canChangeStatus, canMovePhase, canEdit } = usePermissions();
  const [project, setProject] = useState<any>(null);
  const [floor, setFloor] = useState<any>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [showCreate, setShowCreate] = useState(false);
  const [roomNumber, setRoomNumber] = useState('');
  const [assignedWorker, setAssignedWorker] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  // Inline edit floor name
  const [editingFloorName, setEditingFloorName] = useState(false);
  const [editFloorNameVal, setEditFloorNameVal] = useState('');

  // Bulk generate state
  const [showBulkCreate, setShowBulkCreate] = useState(false);
  const [bulkPrefix, setBulkPrefix] = useState('');
  const [bulkStart, setBulkStart] = useState('1');
  const [bulkCount, setBulkCount] = useState('10');
  const [bulkWorker, setBulkWorker] = useState('');
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [pendingBlockedRoomId, setPendingBlockedRoomId] = useState<number | null>(null);
  const [blockedReason, setBlockedReason] = useState('');
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  /** Per-phase checklist template id (string for <select>); only phases with a selection get tasks. */
  const [phaseTemplateSelections, setPhaseTemplateSelections] = useState<Record<string, string>>({});
  const [bulkPhaseTemplateSelections, setBulkPhaseTemplateSelections] = useState<Record<string, string>>({});
  const [quickFillAllPhases, setQuickFillAllPhases] = useState('');
  const [bulkQuickFillAllPhases, setBulkQuickFillAllPhases] = useState('');
  const [showTemplatesDialog, setShowTemplatesDialog] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string>('');
  const [templateName, setTemplateName] = useState('');
  const [templateItemsText, setTemplateItemsText] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<number[]>([]);
  const [checklistByRoomId, setChecklistByRoomId] = useState<ChecklistSummaryMap>({});
  const [phaseWorkflow, setPhaseWorkflow] = useState<PhaseWorkflowEntry[]>(DEFAULT_PHASE_WORKFLOW);
  const [floorPhaseProgress, setFloorPhaseProgress] = useState<FloorPhaseProgressEntry[]>([]);
  const [showWorkflowDialog, setShowWorkflowDialog] = useState(false);
  const [workflowDraft, setWorkflowDraft] = useState<PhaseWorkflowEntry[]>([]);
  const [savingWorkflow, setSavingWorkflow] = useState(false);

  const loadData = useCallback(async () => {
    if (!projectId || !floorId) return;
    try {
      const [projRes, floorRes, roomsRes, wfRes] = await Promise.all([
        client.entities.projects.get({ id: projectId }),
        client.entities.floors.get({ id: floorId }),
        client.entities.rooms.query({ query: { floor_id: Number(floorId) }, sort: 'room_number', limit: 500 }),
        client.apiCall.invoke({
          url: `/api/v1/projects/${projectId}/workflow`,
          method: 'GET',
          data: {},
        }),
      ]);
      setProject(projRes?.data || null);
      setFloor(floorRes?.data || null);
      const rawPhases = wfRes?.data?.phases;
      let summaryWorkflow = DEFAULT_PHASE_WORKFLOW;
      if (Array.isArray(rawPhases) && rawPhases.length > 0) {
        const parsed: PhaseWorkflowEntry[] = rawPhases
          .filter((p: { key?: string; label?: string }) => p?.key && p?.label)
          .map((p: { key: string; label: string }) => ({ key: String(p.key), label: String(p.label) }));
        if (parsed.length > 0) summaryWorkflow = parsed;
      }
      setPhaseWorkflow(summaryWorkflow);
      const roomItems: Room[] = roomsRes?.data?.items || [];
      setRooms(roomItems);

      const roomIds = new Set(roomItems.map((r) => r.id));
      const summary: ChecklistSummaryMap = {};
      for (const id of roomIds) {
        summary[id] = { completed: 0, total: 0 };
      }
      let taskItems: { room_id: number; phase?: string | null; is_completed?: boolean; area_id?: string | null }[] =
        [];
      if (roomIds.size > 0) {
        // Backend caps task list limit at 2000 (see routers/tasks.py); higher values return 422.
        const tasksRes = await client.entities.tasks.query({ limit: 2000, sort: 'room_id' });
        const rawTasks = tasksRes?.data?.items || [];
        taskItems = rawTasks.filter((t: { room_id: number; area_id?: string | null }) => {
          const rid = t.room_id as number;
          if (!roomIds.has(rid)) return false;
          const roomRow = roomItems.find((r) => r.id === rid);
          if (!roomRow) return false;
          return taskCountsForFloorBoard(t.area_id, roomRow.areas);
        });
        for (const t of taskItems) {
          const rid = t.room_id as number;
          if (!summary[rid]) continue;
          const roomRow = roomItems.find((r) => r.id === rid);
          const roomPhase = normalizeRoomPhase(roomRow?.phase, summaryWorkflow);
          const taskPhase = storedChecklistPhase(t.phase as string | null | undefined, summaryWorkflow);
          if (taskPhase !== roomPhase) continue;
          summary[rid].total += 1;
          if (t.is_completed) summary[rid].completed += 1;
        }
      }
      setChecklistByRoomId(summary);
      setFloorPhaseProgress(computeFloorPhaseProgress(roomItems, taskItems, summaryWorkflow));
    } catch {
      toast.error('Failed to load floor data');
      setFloorPhaseProgress([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, floorId]);

  const loadTemplates = useCallback(async () => {
    try {
      const templatesRes = await client.apiCall.invoke({
        url: '/api/v1/entities/checklist_templates',
        method: 'GET',
        data: {},
      });
      setTemplates(templatesRes?.data?.items || []);
    } catch {
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    loadData();
    loadTemplates();
  }, [loadData, loadTemplates]);

  useEffect(() => {
    setPhaseTemplateSelections((prev) => {
      const next: Record<string, string> = {};
      for (const p of phaseWorkflow) {
        next[p.key] = prev[p.key] ?? '';
      }
      return next;
    });
    setBulkPhaseTemplateSelections((prev) => {
      const next: Record<string, string> = {};
      for (const p of phaseWorkflow) {
        next[p.key] = prev[p.key] ?? '';
      }
      return next;
    });
  }, [phaseWorkflow]);

  const getTemplateItems = async (templateId?: number): Promise<ChecklistTemplateItem[]> => {
    if (!templateId) return [];
    const itemsRes = await client.apiCall.invoke({
      url: '/api/v1/entities/checklist_template_items',
      method: 'GET',
      params: { query: JSON.stringify({ template_id: templateId }), sort: 'sort_order', limit: 500 },
      data: {},
    });
    const items: ChecklistTemplateItem[] = itemsRes?.data?.items || [];
    return items
      .filter((i) => Number(i.template_id) === Number(templateId))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  };

  const createRoomWithTasks = async (
    roomNum: string,
    worker: string,
    templatesByPhase: Record<string, number | undefined>
  ) => {
    const roomRes = await client.entities.rooms.create({
      data: {
        floor_id: Number(floorId),
        project_id: Number(projectId),
        room_number: roomNum,
        status: 'not_started',
        phase: phaseWorkflow[0]?.key ?? 'demontering',
        assigned_worker: worker,
        comment: '',
        blocked_reason: '',
      },
    });
    const newRoom = roomRes?.data;
    if (newRoom?.id) {
      // Defensive guard: ensure new rooms only keep tasks from explicitly selected template(s).
      // If anything else seeded tasks, remove them first.
      const existingTasksRes = await client.entities.tasks.query({
        query: { room_id: Number(newRoom.id) },
        limit: 500,
      });
      const existingTasks = existingTasksRes?.data?.items || [];
      if (existingTasks.length > 0) {
        await Promise.all(
          existingTasks.map((task: { id: number }) =>
            client.entities.tasks.delete({ id: String(task.id) })
          )
        );
      }

      const creates: Promise<unknown>[] = [];
      for (const phaseEntry of phaseWorkflow) {
        const phaseKey = phaseEntry.key;
        const templateId = templatesByPhase[phaseKey];
        if (!templateId) continue;

        const templateItems = await getTemplateItems(templateId);
        for (let i = 0; i < templateItems.length; i++) {
          const item = templateItems[i];
          creates.push(
            client.entities.tasks.create({
              data: {
                room_id: newRoom.id,
                name: item.name,
                is_completed: false,
                sort_order: i,
                template_id: templateId,
                template_item_id: item.id,
                is_template_managed: true,
                is_overridden: false,
                phase: phaseKey,
              },
            })
          );
        }
      }
      await Promise.all(creates);
    }
    return newRoom;
  };

  const templatesByPhaseFromSelections = (selections: Record<string, string>) => {
    const out: Record<string, number | undefined> = {};
    for (const p of phaseWorkflow) {
      const raw = selections[p.key]?.trim();
      out[p.key] = raw ? Number(raw) : undefined;
    }
    return out;
  };

  const handleCreateRoom = async () => {
    if (!roomNumber.trim()) return;
    setCreating(true);
    try {
      await createRoomWithTasks(
        roomNumber.trim(),
        assignedWorker.trim(),
        templatesByPhaseFromSelections(phaseTemplateSelections)
      );
      toast.success('Room created');
      setShowCreate(false);
      setRoomNumber('');
      setAssignedWorker('');
      setPhaseTemplateSelections((prev) => {
        const cleared: Record<string, string> = {};
        for (const p of phaseWorkflow) cleared[p.key] = '';
        return cleared;
      });
      setQuickFillAllPhases('');
      loadData();
    } catch {
      toast.error('Failed to create room');
    } finally {
      setCreating(false);
    }
  };

  const handleBulkCreate = async () => {
    const start = parseInt(bulkStart) || 1;
    const count = Math.min(parseInt(bulkCount) || 10, 200);
    if (count <= 0) return;

    setBulkCreating(true);
    setBulkProgress(0);
    setBulkTotal(count);

    let created = 0;
    let failed = 0;

    const batchSize = 5;
    for (let i = 0; i < count; i += batchSize) {
      const batch = [];
      for (let j = i; j < Math.min(i + batchSize, count); j++) {
        const num = start + j;
        const roomNum = bulkPrefix ? `${bulkPrefix}${String(num).padStart(2, '0')}` : String(num);
        batch.push(
          createRoomWithTasks(
            roomNum,
            bulkWorker.trim(),
            templatesByPhaseFromSelections(bulkPhaseTemplateSelections)
          )
            .then(() => { created++; })
            .catch(() => { failed++; })
        );
      }
      await Promise.all(batch);
      setBulkProgress(Math.min(i + batchSize, count));
    }

    setBulkCreating(false);
    setShowBulkCreate(false);
    setBulkPrefix('');
    setBulkStart('1');
    setBulkCount('10');
    setBulkWorker('');
    setBulkPhaseTemplateSelections((prev) => {
      const cleared: Record<string, string> = {};
      for (const p of phaseWorkflow) cleared[p.key] = '';
      return cleared;
    });
    setBulkQuickFillAllPhases('');
    setBulkProgress(0);
    setBulkTotal(0);

    if (failed > 0) {
      toast.warning(`Created ${created} rooms, ${failed} failed`);
    } else {
      toast.success(`${created} rooms created with checklists!`);
    }
    loadData();
  };

  const startEditFloorName = () => {
    if (!floor) return;
    setEditingFloorName(true);
    setEditFloorNameVal(floor.name || `Floor ${floor.floor_number}`);
  };

  const saveFloorName = async () => {
    if (!floor || !editFloorNameVal.trim()) {
      setEditingFloorName(false);
      return;
    }
    try {
      await client.entities.floors.update({
        id: String(floor.id),
        data: { name: editFloorNameVal.trim() },
      });
      setFloor({ ...floor, name: editFloorNameVal.trim() });
      toast.success('Floor name updated');
    } catch {
      toast.error('Failed to update floor name');
    }
    setEditingFloorName(false);
  };

  const handleStatusChange = async (roomId: number, newStatus: string) => {
    if (newStatus === 'blocked') {
      setPendingBlockedRoomId(roomId);
      setBlockedReason('');
      setShowBlockDialog(true);
      return;
    }
    try {
      await client.entities.rooms.update({
        id: String(roomId),
        data: { status: newStatus, blocked_reason: '' },
      });
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, status: newStatus, blocked_reason: '' } : r))
      );
      toast.success('Status updated');
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handlePhaseChange = async (roomId: number, newPhase: string) => {
    const room = rooms.find((r) => r.id === roomId);
    const oldPhase = normalizeRoomPhase(room?.phase, phaseWorkflow);
    const nextPhase = normalizeRoomPhase(newPhase, phaseWorkflow);
    if (oldPhase === nextPhase) return;
    try {
      await client.entities.rooms.update({
        id: String(roomId),
        data: { phase: nextPhase },
      });
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, phase: nextPhase } : r))
      );
      toast.success('Phase updated');
      await loadData();
    } catch {
      toast.error('Failed to update phase');
    }
  };

  const handleConfirmBlockedStatus = async () => {
    if (!pendingBlockedRoomId) return;
    const reason = blockedReason.trim();
    if (!reason) {
      toast.error('Blocked reason is required');
      return;
    }
    try {
      await client.entities.rooms.update({
        id: String(pendingBlockedRoomId),
        data: { status: 'blocked', blocked_reason: reason },
      });
      setRooms((prev) =>
        prev.map((r) => (r.id === pendingBlockedRoomId ? { ...r, status: 'blocked', blocked_reason: reason } : r))
      );
      setShowBlockDialog(false);
      setPendingBlockedRoomId(null);
      setBlockedReason('');
      toast.success('Room marked as blocked');
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleDeleteRoom = async (e: React.MouseEvent, roomId: number) => {
    e.stopPropagation();
    if (!confirm('Delete this room and its checklist, photos, and visit log?')) return;
    try {
      await client.entities.rooms.delete({ id: String(roomId) });
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
      toast.success('Room deleted');
    } catch {
      toast.error('Failed to delete room');
    }
  };

  const toggleRoomSelection = (roomId: number) => {
    setSelectedRoomIds((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]
    );
  };

  const clearSelection = () => {
    setSelectedRoomIds([]);
  };

  const selectAllVisibleRooms = () => {
    setSelectedRoomIds(rooms.map((r) => r.id));
  };

  const allVisibleRoomsSelected =
    rooms.length > 0 && rooms.every((r) => selectedRoomIds.includes(r.id));

  const handleBulkDelete = async () => {
    if (!canDeleteRoom || selectedRoomIds.length === 0) return;
    if (!confirm(`Delete ${selectedRoomIds.length} selected room(s)?`)) return;
    let deleted = 0;
    let failed = 0;
    for (const roomId of selectedRoomIds) {
      try {
        await client.entities.rooms.delete({ id: String(roomId) });
        deleted++;
      } catch {
        failed++;
      }
    }
    if (deleted > 0) {
      setRooms((prev) => prev.filter((r) => !selectedRoomIds.includes(r.id)));
    }
    setSelectedRoomIds([]);
    setSelectionMode(false);
    if (failed > 0) {
      toast.warning(`Deleted ${deleted} rooms, ${failed} failed`);
    } else {
      toast.success(`Deleted ${deleted} rooms`);
    }
  };

  const handleContextOpenRoom = useCallback(
    (roomId: number) => {
      if (!projectId || !floorId) return;
      navigate(`/project/${projectId}/floor/${floorId}/room/${roomId}`);
    },
    [projectId, floorId, navigate]
  );

  const handleContextDeleteRooms = async (ids: number[]) => {
    if (!canDeleteRoom || ids.length === 0) return;
    const n = ids.length;
    if (!confirm(`Delete ${n} room(s) and their checklists, photos, and visit logs?`)) return;
    let deleted = 0;
    let failed = 0;
    for (const roomId of ids) {
      try {
        await client.entities.rooms.delete({ id: String(roomId) });
        deleted++;
      } catch {
        failed++;
      }
    }
    if (deleted > 0) {
      setRooms((prev) => prev.filter((r) => !ids.includes(r.id)));
      setSelectedRoomIds((prev) => prev.filter((id) => !ids.includes(id)));
    }
    if (failed > 0) {
      toast.warning(`Deleted ${deleted} rooms, ${failed} failed`);
    } else {
      toast.success(`Deleted ${deleted} room(s)`);
    }
  };

  const handleContextPhaseRooms = async (ids: number[], phaseKey: string) => {
    if (!canMovePhase || ids.length === 0) return;
    const nextPhase = normalizeRoomPhase(phaseKey, phaseWorkflow);
    const succeeded: number[] = [];
    let skipped = 0;
    let failed = 0;
    for (const roomId of ids) {
      const row = rooms.find((r) => r.id === roomId);
      const oldPhase = normalizeRoomPhase(row?.phase, phaseWorkflow);
      if (oldPhase === nextPhase) {
        skipped++;
        continue;
      }
      try {
        await client.entities.rooms.update({
          id: String(roomId),
          data: { phase: nextPhase },
        });
        succeeded.push(roomId);
      } catch {
        failed++;
      }
    }
    if (succeeded.length > 0) {
      setRooms((prev) =>
        prev.map((r) => (succeeded.includes(r.id) ? { ...r, phase: nextPhase } : r))
      );
      await loadData();
    }
    if (failed > 0) {
      toast.warning(`Updated phase for ${succeeded.length} rooms, ${failed} failed`);
    } else if (succeeded.length > 0) {
      toast.success(`Updated phase for ${succeeded.length} room(s)`);
    } else if (skipped > 0 && failed === 0) {
      toast.info('Already in that phase');
    }
  };

  const handleContextLockRooms = async (ids: number[], locked: boolean) => {
    if (!canEdit || ids.length === 0) return;
    const succeeded: number[] = [];
    let failed = 0;
    for (const roomId of ids) {
      try {
        await client.entities.rooms.update({
          id: String(roomId),
          data: { is_locked: locked },
        });
        succeeded.push(roomId);
      } catch {
        failed++;
      }
    }
    if (succeeded.length > 0) {
      setRooms((prev) =>
        prev.map((r) => (succeeded.includes(r.id) ? { ...r, is_locked: locked } : r))
      );
    }
    if (failed > 0) {
      toast.warning(`${locked ? 'Locked' : 'Unlocked'} ${succeeded.length} rooms, ${failed} failed`);
    } else if (succeeded.length > 0) {
      toast.success(locked ? `Locked ${succeeded.length} room(s)` : `Unlocked ${succeeded.length} room(s)`);
    }
  };

  const roomContextMenuProps = {
    selectedRoomIds,
    phaseWorkflow,
    canDelete: canDeleteRoom,
    canChangePhase: canMovePhase,
    canLock: canEdit,
    onOpenRoom: handleContextOpenRoom,
    onDeleteRooms: handleContextDeleteRooms,
    onPhaseRooms: handleContextPhaseRooms,
    onLockRooms: handleContextLockRooms,
  };

  const loadTemplateForEdit = async (templateId: string) => {
    setEditingTemplateId(templateId);
    const selected = templates.find((t) => String(t.id) === templateId);
    setTemplateName(selected?.name || '');
    if (!templateId) {
      setTemplateItemsText('');
      return;
    }
    try {
      const itemsRes = await client.apiCall.invoke({
        url: '/api/v1/entities/checklist_template_items',
        method: 'GET',
        params: { query: JSON.stringify({ template_id: Number(templateId) }), sort: 'sort_order', limit: 500 },
        data: {},
      });
      const items: ChecklistTemplateItem[] = itemsRes?.data?.items || [];
      const selectedItems = items
        .filter((i) => Number(i.template_id) === Number(templateId))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setTemplateItemsText(selectedItems.map((i) => i.name).join('\n'));
    } catch {
      setTemplateItemsText('');
    }
  };

  const handleSaveTemplate = async () => {
    const name = templateName.trim();
    const itemNames = templateItemsText.split('\n').map((i) => i.trim()).filter(Boolean);
    if (!name || itemNames.length === 0) {
      toast.error('Template name and at least one item are required');
      return;
    }

    setSavingTemplate(true);
    try {
      let templateId = editingTemplateId ? Number(editingTemplateId) : 0;
      if (templateId) {
        await client.apiCall.invoke({
          url: `/api/v1/entities/checklist_templates/${templateId}`,
          method: 'PUT',
          data: { name },
        });
        await client.apiCall.invoke({
          url: `/api/v1/entities/checklist_template_items/by-template/${templateId}`,
          method: 'DELETE',
          data: {},
        });
      } else {
        const created = await client.apiCall.invoke({
          url: '/api/v1/entities/checklist_templates',
          method: 'POST',
          data: { name },
        });
        templateId = created?.data?.id;
      }

      await Promise.all(
        itemNames.map((itemName, idx) =>
          client.apiCall.invoke({
            url: '/api/v1/entities/checklist_template_items',
            method: 'POST',
            data: { template_id: templateId, name: itemName, sort_order: idx },
          })
        )
      );

      toast.success('Template saved');
      setEditingTemplateId('');
      setTemplateName('');
      setTemplateItemsText('');
      await loadTemplates();
    } catch {
      toast.error('Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSyncTemplate = async () => {
    if (!editingTemplateId) {
      toast.error('Select a template first');
      return;
    }
    try {
      const res = await client.apiCall.invoke({
        url: `/api/v1/entities/checklist_templates/${editingTemplateId}/sync-rooms`,
        method: 'POST',
        data: {},
      });
      const summary = res?.data;
      toast.success(
        `Synced rooms: +${summary?.added ?? 0} updated ${summary?.updated ?? 0} removed ${summary?.removed ?? 0}`
      );
    } catch {
      toast.error('Failed to sync rooms from template');
    }
  };

  const openWorkflowDialog = () => {
    setWorkflowDraft(phaseWorkflow.map((p) => ({ ...p })));
    setShowWorkflowDialog(true);
  };

  const moveWorkflowDraft = (index: number, dir: -1 | 1) => {
    setWorkflowDraft((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const updateWorkflowDraftLabel = (index: number, label: string) => {
    setWorkflowDraft((prev) => prev.map((p, i) => (i === index ? { ...p, label } : p)));
  };

  const removeWorkflowDraftPhase = (index: number) => {
    setWorkflowDraft((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const addWorkflowDraftPhase = () => {
    setWorkflowDraft((prev) => {
      const keys = new Set(prev.map((p) => p.key));
      let k = `phase_${Date.now()}`;
      while (keys.has(k)) k = `${k}_x`;
      return [...prev, { key: k, label: 'New phase' }];
    });
  };

  const handleSaveWorkflow = async () => {
    if (!projectId) return;
    const trimmed = workflowDraft.map((p) => ({
      key: p.key.trim(),
      label: p.label.trim(),
    }));
    if (trimmed.some((p) => !p.key || !p.label)) {
      toast.error('Each phase needs an internal key and a display name');
      return;
    }
    setSavingWorkflow(true);
    try {
      await client.apiCall.invoke({
        url: `/api/v1/projects/${projectId}/workflow`,
        method: 'PUT',
        data: { phases: trimmed },
      });
      setPhaseWorkflow(trimmed);
      setShowWorkflowDialog(false);
      toast.success('Workflow saved');
      await loadData();
    } catch (e: unknown) {
      const err = e as { data?: { detail?: string }; response?: { data?: { detail?: string } }; message?: string };
      const detail = err?.data?.detail || err?.response?.data?.detail || err?.message || 'Failed to save workflow';
      toast.error(typeof detail === 'string' ? detail : 'Failed to save workflow');
    } finally {
      setSavingWorkflow(false);
    }
  };

  const getBulkPreview = () => {
    const start = parseInt(bulkStart) || 1;
    const count = Math.min(parseInt(bulkCount) || 0, 200);
    if (count <= 0) return '';
    const first = bulkPrefix ? `${bulkPrefix}${String(start).padStart(2, '0')}` : String(start);
    const last = bulkPrefix
      ? `${bulkPrefix}${String(start + count - 1).padStart(2, '0')}`
      : String(start + count - 1);
    if (count === 1) return first;
    if (count <= 3) {
      const nums = [];
      for (let i = 0; i < count; i++) {
        const n = start + i;
        nums.push(bulkPrefix ? `${bulkPrefix}${String(n).padStart(2, '0')}` : String(n));
      }
      return nums.join(', ');
    }
    return `${first}, ${bulkPrefix ? `${bulkPrefix}${String(start + 1).padStart(2, '0')}` : String(start + 1)}, ... ${last}`;
  };

  if (loading) {
    return (
      <div className="h-dvh bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 dark:bg-background">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 space-y-4">
          <div className="mx-auto w-full max-w-lg space-y-4 px-4 pb-4 pt-4 lg:mx-0 lg:max-w-none lg:px-6 xl:px-8">
        {/* Floor Name (editable) */}
        <div className="flex items-center gap-2 group/flname">
          {editingFloorName ? (
            <div className="flex items-center gap-2 flex-1">
              <Input
                value={editFloorNameVal}
                onChange={(e) => setEditFloorNameVal(e.target.value)}
                className="h-9 text-lg font-bold"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveFloorName();
                  if (e.key === 'Escape') setEditingFloorName(false);
                }}
                onBlur={() => saveFloorName()}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-emerald-500 hover:text-emerald-700"
                onMouseDown={(e) => { e.preventDefault(); saveFloorName(); }}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-600"
                onMouseDown={(e) => { e.preventDefault(); setEditingFloorName(false); }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-slate-800 dark:text-foreground">
                {floor?.name || `Floor ${floor?.floor_number}`}
              </h2>
              {canEdit && (
                <button
                  className="opacity-0 group-hover/flname:opacity-100 transition-opacity text-slate-400 hover:text-blue-500 p-0.5"
                  onClick={startEditFloorName}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        {/* View Toggle + Add */}
        <div className="flex items-center justify-between">
          <div className="flex bg-slate-200 dark:bg-slate-800 rounded-lg p-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={`rounded-md h-8 px-3 transition-[background-color,box-shadow] duration-200 ease-out ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-slate-700 shadow-sm'
                  : 'hover:bg-white/70 dark:hover:bg-slate-700/60'
              }`}
              onClick={() => setViewMode('list')}
            >
              <LayoutGrid className="h-4 w-4 mr-1" />
              List
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`rounded-md h-8 px-3 transition-[background-color,box-shadow] duration-200 ease-out ${
                viewMode === 'kanban'
                  ? 'bg-white dark:bg-slate-700 shadow-sm'
                  : 'hover:bg-white/70 dark:hover:bg-slate-700/60'
              }`}
              onClick={() => setViewMode('kanban')}
            >
              <Columns3 className="h-4 w-4 mr-1" />
              Kanban
            </Button>
          </div>
          {canCreateRoom && (
            <div className="flex gap-2">
              <Button
                variant={selectionMode ? 'default' : 'outline'}
                onClick={() => {
                  if (selectionMode) {
                    setSelectionMode(false);
                    setSelectedRoomIds([]);
                  } else {
                    setSelectionMode(true);
                  }
                }}
                className="h-10 rounded-xl"
              >
                Select
              </Button>
              {canEdit && (
                <Button
                  variant="outline"
                  onClick={openWorkflowDialog}
                  className="h-10 rounded-xl"
                >
                  <ListOrdered className="h-4 w-4 mr-1" />
                  Phases
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setShowTemplatesDialog(true)}
                className="h-10 rounded-xl"
              >
                Templates
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowBulkCreate(true)}
                className="h-10 rounded-xl border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950"
              >
                <Zap className="h-4 w-4 mr-1" />
                Bulk
              </Button>
              <Button
                onClick={() => setShowCreate(true)}
                className="bg-[#1E3A5F] hover:bg-[#2a4f7a] dark:bg-blue-600 dark:hover:bg-blue-700 h-10 rounded-xl"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          )}
        </div>

        {/* Room count + per-phase checklist progress (rooms with that phase’s items 100% done / all rooms) */}
        {rooms.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{rooms.length} rooms on this floor</p>
            {floorPhaseProgress.length > 0 && (
              <div
                className="flex flex-wrap gap-x-3 gap-y-2 rounded-lg border border-slate-200/90 bg-white/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50"
                aria-label="Floor progress by work phase"
                title="Per phase: rooms where every checklist item in that phase is done, out of all rooms on this floor. Rooms with no items in a phase yet are not counted as done for that phase."
              >
                {floorPhaseProgress.map((row) => {
                  const pct = row.totalRooms > 0 ? Math.round((row.completedRooms / row.totalRooms) * 100) : 0;
                  return (
                    <div
                      key={row.key}
                      className="flex min-w-[7.5rem] flex-1 basis-[calc(50%-0.375rem)] items-center gap-2 sm:basis-0 sm:flex-initial"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                            {phaseLabel(row.key, phaseWorkflow)}
                          </span>
                          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                            {row.completedRooms}/{row.totalRooms}
                          </span>
                        </div>
                        <Progress value={pct} className="mt-1 h-1.5" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {selectionMode && (
          <Card className="p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-muted-foreground">
                {selectedRoomIds.length === 1
                  ? '1 room selected'
                  : `${selectedRoomIds.length} rooms selected`}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllVisibleRooms}
                  disabled={rooms.length === 0 || allVisibleRoomsSelected}
                >
                  Select all
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearSelection}
                  disabled={selectedRoomIds.length === 0}
                >
                  Deselect all
                </Button>
                {canDeleteRoom && (
                  <Button
                    size="sm"
                    className="bg-red-500 hover:bg-red-600 text-white"
                    disabled={selectedRoomIds.length === 0}
                    onClick={handleBulkDelete}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete selected
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        </div>
        </div>

        {/* Room Views — list grid expands on md+; kanban uses full width (horizontal columns) */}
        {rooms.length === 0 ? (
          <div className="mx-auto w-full max-w-lg shrink-0 px-4 pb-4 lg:mx-0 lg:max-w-none lg:px-6 xl:px-8">
            <Card className="p-8 text-center">
              <DoorOpen className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-muted-foreground mb-2">No rooms yet</p>
              {canCreateRoom && (
                <p className="text-sm text-muted-foreground">
                  Use <strong>Bulk</strong> to generate many rooms at once
                </p>
              )}
            </Card>
          </div>
        ) : viewMode === 'kanban' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-4 lg:px-6 xl:px-8">
            <PhaseBoard
              rooms={rooms}
              checklistByRoomId={checklistByRoomId}
              phases={phaseWorkflow}
              floorLabel={
                floor?.name ||
                (floor?.floor_number != null ? `Floor ${floor.floor_number}` : undefined)
              }
              onRoomClick={(id) => navigate(`/project/${projectId}/floor/${floorId}/room/${id}`)}
              onPhaseChange={canMovePhase ? handlePhaseChange : undefined}
              selectionMode={selectionMode}
              selectedRoomIds={selectedRoomIds}
              onToggleSelect={toggleRoomSelection}
              roomContextMenu={roomContextMenuProps}
            />
          </div>
        ) : (
          <div className="mx-auto min-h-0 w-full max-w-lg flex-1 overflow-y-auto px-4 pb-4 lg:mx-0 lg:max-w-none lg:px-6 xl:px-8">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-3 lg:grid-cols-3 lg:gap-3 xl:grid-cols-4">
              {rooms.map((room) => {
                const summary = checklistByRoomId[room.id];
                const completed = summary?.completed ?? 0;
                const total = summary?.total ?? 0;
                const rp = normalizeRoomPhase(room.phase, phaseWorkflow);
                return (
                  <RoomFloorCardContextMenu
                    key={room.id}
                    roomId={room.id}
                    roomLabel={room.room_number}
                    {...roomContextMenuProps}
                  >
                    <RoomDashboardCard
                      roomNumber={room.room_number}
                      floorLabel={
                        floor?.name ||
                        (floor?.floor_number != null ? `Floor ${floor.floor_number}` : undefined)
                      }
                      phaseLabel={phaseLabel(rp, phaseWorkflow)}
                      phaseStrip={formatPhaseStrip(rp, phaseWorkflow)}
                      completed={completed}
                      total={total}
                      blocked={room.status === 'blocked'}
                      contentLocked={Boolean(room.is_locked)}
                      blockedReason={room.blocked_reason}
                      assignedWorker={room.assigned_worker}
                      updatedAt={room.updated_at}
                      onClick={() =>
                        selectionMode
                          ? toggleRoomSelection(room.id)
                          : navigate(`/project/${projectId}/floor/${floorId}/room/${room.id}`)
                      }
                      selectionMode={selectionMode}
                      selected={selectedRoomIds.includes(room.id)}
                      trailing={
                        canDeleteRoom ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                            onClick={(e) => handleDeleteRoom(e, room.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : undefined
                      }
                    />
                  </RoomFloorCardContextMenu>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Single Room Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md max-h-[min(90vh,640px)] overflow-y-auto mx-4">
          <DialogForm onSubmit={(e) => { e.preventDefault(); handleCreateRoom(); }}>
          <DialogHeader>
            <DialogTitle>Add Room</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Room number (e.g., 101, 102)"
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              className="h-12"
            />
            <Input
              placeholder="Assigned worker (optional)"
              value={assignedWorker}
              onChange={(e) => setAssignedWorker(e.target.value)}
              className="h-12"
            />
            <div className="space-y-1.5 rounded-md border border-input bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">Checklist by phase</p>
              <p className="text-xs text-muted-foreground">
                Pick a template per phase. Phases left empty get no checklist yet.
              </p>
              <select
                value={quickFillAllPhases}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  setPhaseTemplateSelections((prev) => {
                    const next = { ...prev };
                    for (const p of phaseWorkflow) next[p.key] = v;
                    return next;
                  });
                  setQuickFillAllPhases('');
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Apply one template to all phases…</option>
                {templates.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))}
              </select>
              <div className="space-y-2 pt-1">
                {phaseWorkflow.map((p) => (
                  <div key={p.key} className="space-y-1">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {phaseLabel(p.key, phaseWorkflow)}
                    </label>
                    <select
                      value={phaseTemplateSelections[p.key] ?? ''}
                      onChange={(e) =>
                        setPhaseTemplateSelections((prev) => ({
                          ...prev,
                          [p.key]: e.target.value,
                        }))
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">No checklist for this phase</option>
                      {templates.map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!roomNumber.trim() || creating}
              className="w-full bg-[#1E3A5F] hover:bg-[#2a4f7a] dark:bg-blue-600 dark:hover:bg-blue-700 h-12"
            >
              {creating ? 'Creating...' : 'Add Room'}
            </Button>
          </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      {/* Bulk Generate Dialog */}
      <Dialog open={showBulkCreate} onOpenChange={(open) => { if (!bulkCreating) setShowBulkCreate(open); }}>
        <DialogContent className="max-w-sm mx-4">
          <DialogForm onSubmit={(e) => { e.preventDefault(); handleBulkCreate(); }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              Bulk Generate Rooms
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                Room Prefix (optional)
              </label>
              <Input
                placeholder="e.g., 1 → rooms 101, 102..."
                value={bulkPrefix}
                onChange={(e) => setBulkPrefix(e.target.value)}
                className="h-12"
                disabled={bulkCreating}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Leave empty for simple numbering (1, 2, 3...)
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                  Start Number
                </label>
                <Input
                  type="number"
                  min="1"
                  placeholder="1"
                  value={bulkStart}
                  onChange={(e) => setBulkStart(e.target.value)}
                  className="h-12"
                  disabled={bulkCreating}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                  How Many
                </label>
                <Input
                  type="number"
                  min="1"
                  max="200"
                  placeholder="80"
                  value={bulkCount}
                  onChange={(e) => setBulkCount(e.target.value)}
                  className="h-12"
                  disabled={bulkCreating}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                Assign Worker (optional)
              </label>
              <Input
                placeholder="Worker name for all rooms"
                value={bulkWorker}
                onChange={(e) => setBulkWorker(e.target.value)}
                className="h-12"
                disabled={bulkCreating}
              />
            </div>
            <div className="space-y-1.5 rounded-md border border-input bg-muted/30 p-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block">
                Checklist by phase
              </label>
              <p className="text-xs text-muted-foreground">
                Same choices apply to every generated room. Use “all phases” to fill every dropdown at once.
              </p>
              <select
                value={bulkQuickFillAllPhases}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  setBulkPhaseTemplateSelections((prev) => {
                    const next = { ...prev };
                    for (const p of phaseWorkflow) next[p.key] = v;
                    return next;
                  });
                  setBulkQuickFillAllPhases('');
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={bulkCreating}
              >
                <option value="">Apply one template to all phases…</option>
                {templates.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))}
              </select>
              <div className="space-y-2 pt-1 max-h-48 overflow-y-auto">
                {phaseWorkflow.map((p) => (
                  <div key={p.key} className="space-y-1">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {phaseLabel(p.key, phaseWorkflow)}
                    </label>
                    <select
                      value={bulkPhaseTemplateSelections[p.key] ?? ''}
                      onChange={(e) =>
                        setBulkPhaseTemplateSelections((prev) => ({
                          ...prev,
                          [p.key]: e.target.value,
                        }))
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      disabled={bulkCreating}
                    >
                      <option value="">No checklist for this phase</option>
                      {templates.map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Preview */}
            {getBulkPreview() && (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 border dark:border-slate-700">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Preview</p>
                <p className="text-sm font-mono text-slate-700 dark:text-slate-300">{getBulkPreview()}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Each phase gets its own checklist lines from the template you chose for that phase.
                </p>
              </div>
            )}

            {/* Progress during creation */}
            {bulkCreating && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Creating rooms...</span>
                  <span className="font-bold text-[#1E3A5F] dark:text-blue-400">{bulkProgress}/{bulkTotal}</span>
                </div>
                <Progress value={bulkTotal > 0 ? (bulkProgress / bulkTotal) * 100 : 0} className="h-3" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={bulkCreating || (parseInt(bulkCount) || 0) <= 0}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white h-12 font-bold"
            >
              {bulkCreating ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                  Generating {bulkProgress}/{bulkTotal}...
                </span>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  Generate {Math.min(parseInt(bulkCount) || 0, 200)} Rooms
                </>
              )}
            </Button>
          </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      {/* Blocked Reason Dialog */}
      <Dialog open={showBlockDialog} onOpenChange={setShowBlockDialog}>
        <DialogContent className="max-w-sm mx-4">
          <DialogForm onSubmit={(e) => { e.preventDefault(); handleConfirmBlockedStatus(); }}>
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

      {/* Checklist Templates Dialog */}
      <Dialog open={showTemplatesDialog} onOpenChange={setShowTemplatesDialog}>
        <DialogContent className="max-w-lg mx-4">
          <DialogForm onSubmit={(e) => { e.preventDefault(); handleSaveTemplate(); }}>
          <DialogHeader>
            <DialogTitle>Checklist Templates</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <select
              value={editingTemplateId}
              onChange={(e) => loadTemplateForEdit(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">New template</option>
              {templates.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
            </select>
            <Input
              placeholder="Template name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="h-10"
            />
            <textarea
              value={templateItemsText}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSaveTemplate();
                }
              }}
              onChange={(e) => setTemplateItemsText(e.target.value)}
              rows={10}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder={"Cable routing\nInstall wall boxes\nHeating cable installation"}
            />
            <p className="text-xs text-muted-foreground">One checklist item per line.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleSyncTemplate} disabled={!editingTemplateId || savingTemplate}>
              Update rooms from template
            </Button>
            <Button type="submit" disabled={savingTemplate}>
              {savingTemplate ? 'Saving...' : 'Save Template'}
            </Button>
          </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      {/* Project workflow phases — admin only */}
      <Dialog open={showWorkflowDialog} onOpenChange={setShowWorkflowDialog}>
        <DialogContent className="max-w-lg mx-4 max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListOrdered className="h-5 w-5 text-slate-500" />
              Project phases
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Change the order and names shown to the team. Internal keys stay fixed so existing data stays linked;
            you can add phases or remove unused ones. Workers still use the simple board and room screens — only
            Admins see this screen.
          </p>
          <div className="space-y-2">
            {workflowDraft.map((row, index) => (
              <div
                key={row.key}
                className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center"
              >
                <div className="flex-1 space-y-1 min-w-0">
                  <Input
                    value={row.label}
                    onChange={(e) => updateWorkflowDraftLabel(index, e.target.value)}
                    placeholder="Phase name"
                    className="h-9"
                  />
                  <p className="text-[10px] font-mono text-muted-foreground truncate" title={row.key}>
                    key: {row.key}
                  </p>
                </div>
                <div className="flex flex-row gap-1 shrink-0 sm:flex-col">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => moveWorkflowDraft(index, -1)}
                    disabled={index === 0}
                    aria-label="Move phase up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => moveWorkflowDraft(index, 1)}
                    disabled={index >= workflowDraft.length - 1}
                    aria-label="Move phase down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 text-red-600"
                    onClick={() => removeWorkflowDraftPhase(index)}
                    disabled={workflowDraft.length <= 1}
                    aria-label="Remove phase"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" className="w-full" onClick={addWorkflowDraftPhase}>
            <Plus className="h-4 w-4 mr-1" />
            Add phase
          </Button>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => setShowWorkflowDialog(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={savingWorkflow} onClick={() => void handleSaveWorkflow()}>
              {savingWorkflow ? 'Saving…' : 'Save phases'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}