import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { PermissionProvider, usePermissions } from '@/lib/permissions';
import Header from '@/components/Header';
import PhaseBoard, { type ChecklistSummaryMap } from '@/components/PhaseBoard';
import RoomDashboardCard from '@/components/RoomDashboardCard';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogForm } from '@/components/ui/dialog';
import { Plus, DoorOpen, LayoutGrid, Columns3, Zap, Pencil, Check, X, Ban, Trash2 } from 'lucide-react';
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

function FloorDetailContent() {
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
  const [singleTemplateId, setSingleTemplateId] = useState<string>('');
  const [bulkTemplateId, setBulkTemplateId] = useState<string>('');
  const [showTemplatesDialog, setShowTemplatesDialog] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string>('');
  const [templateName, setTemplateName] = useState('');
  const [templateItemsText, setTemplateItemsText] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<number[]>([]);
  const [checklistByRoomId, setChecklistByRoomId] = useState<ChecklistSummaryMap>({});

  const loadData = useCallback(async () => {
    if (!projectId || !floorId) return;
    try {
      const [projRes, floorRes, roomsRes] = await Promise.all([
        client.entities.projects.get({ id: projectId }),
        client.entities.floors.get({ id: floorId }),
        client.entities.rooms.query({ query: { floor_id: Number(floorId) }, sort: 'room_number', limit: 500 }),
      ]);
      setProject(projRes?.data || null);
      setFloor(floorRes?.data || null);
      const roomItems: Room[] = roomsRes?.data?.items || [];
      setRooms(roomItems);

      const roomIds = new Set(roomItems.map((r) => r.id));
      const summary: ChecklistSummaryMap = {};
      for (const id of roomIds) {
        summary[id] = { completed: 0, total: 0 };
      }
      if (roomIds.size > 0) {
        // Backend caps task list limit at 2000 (see routers/tasks.py); higher values return 422.
        const tasksRes = await client.entities.tasks.query({ limit: 2000, sort: 'room_id' });
        const taskItems = tasksRes?.data?.items || [];
        for (const t of taskItems) {
          const rid = t.room_id as number;
          if (!roomIds.has(rid) || !summary[rid]) continue;
          summary[rid].total += 1;
          if (t.is_completed) summary[rid].completed += 1;
        }
      }
      setChecklistByRoomId(summary);
    } catch {
      toast.error('Failed to load floor data');
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

  const createRoomWithTasks = async (roomNum: string, worker: string, templateId?: number) => {
    const roomRes = await client.entities.rooms.create({
      data: {
        floor_id: Number(floorId),
        project_id: Number(projectId),
        room_number: roomNum,
        status: 'not_started',
        phase: 'demontering',
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

      const templateItems = await getTemplateItems(templateId);
      await Promise.all(
        templateItems.map((item, i) =>
          client.entities.tasks.create({
            data: {
              room_id: newRoom.id,
              name: item.name,
              is_completed: false,
              sort_order: i,
              template_id: templateId ?? null,
              template_item_id: item.id,
              is_template_managed: true,
              is_overridden: false,
            },
          })
        )
      );
    }
    return newRoom;
  };

  const handleCreateRoom = async () => {
    if (!roomNumber.trim()) return;
    setCreating(true);
    try {
      await createRoomWithTasks(
        roomNumber.trim(),
        assignedWorker.trim(),
        singleTemplateId ? Number(singleTemplateId) : undefined
      );
      toast.success('Room created with checklist');
      setShowCreate(false);
      setRoomNumber('');
      setAssignedWorker('');
      setSingleTemplateId('');
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
          createRoomWithTasks(roomNum, bulkWorker.trim(), bulkTemplateId ? Number(bulkTemplateId) : undefined)
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
    setBulkTemplateId('');
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
    const currentPhase = room?.phase || 'demontering';
    if (currentPhase === newPhase) return;
    try {
      await client.entities.rooms.update({
        id: String(roomId),
        data: { phase: newPhase },
      });
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, phase: newPhase } : r))
      );
      toast.success('Phase updated');
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
          { label: project?.name || 'Project', path: `/project/${projectId}` },
          { label: floor?.name || `Floor ${floor?.floor_number}` },
        ]}
      />
      <div className="space-y-4 pb-4">
        <div className="px-4 pt-4 max-w-lg mx-auto space-y-4">
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
              className={`rounded-md h-8 px-3 ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`}
              onClick={() => setViewMode('list')}
            >
              <LayoutGrid className="h-4 w-4 mr-1" />
              List
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`rounded-md h-8 px-3 ${viewMode === 'kanban' ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`}
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

        {/* Room count */}
        {rooms.length > 0 && (
          <p className="text-sm text-muted-foreground">{rooms.length} rooms on this floor</p>
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

        {/* Room Views — list/empty stay narrow; kanban uses full width (Trello-style on desktop) */}
        {rooms.length === 0 ? (
          <div className="px-4 max-w-lg mx-auto">
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
          <div className="w-full min-w-0 px-4">
            <PhaseBoard
              rooms={rooms}
              checklistByRoomId={checklistByRoomId}
              floorLabel={
                floor?.name ||
                (floor?.floor_number != null ? `Floor ${floor.floor_number}` : undefined)
              }
              onRoomClick={(id) => navigate(`/project/${projectId}/floor/${floorId}/room/${id}`)}
              onPhaseChange={canMovePhase ? handlePhaseChange : undefined}
              selectionMode={selectionMode}
              selectedRoomIds={selectedRoomIds}
              onToggleSelect={toggleRoomSelection}
            />
          </div>
        ) : (
          <div className="px-4 max-w-lg mx-auto space-y-2">
            {rooms.map((room) => {
              const summary = checklistByRoomId[room.id];
              const completed = summary?.completed ?? 0;
              const total = summary?.total ?? 0;
              return (
                <RoomDashboardCard
                  key={room.id}
                  roomNumber={room.room_number}
                  floorLabel={
                    floor?.name ||
                    (floor?.floor_number != null ? `Floor ${floor.floor_number}` : undefined)
                  }
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
              );
            })}
          </div>
        )}
      </div>

      {/* Single Room Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm mx-4">
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
            <select
              value={singleTemplateId}
              onChange={(e) => setSingleTemplateId(e.target.value)}
              className="h-12 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">No template (no checklist items)</option>
              {templates.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
            </select>
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
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                Checklist Template
              </label>
              <select
                value={bulkTemplateId}
                onChange={(e) => setBulkTemplateId(e.target.value)}
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={bulkCreating}
              >
                <option value="">No template (no checklist items)</option>
                {templates.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Preview */}
            {getBulkPreview() && (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 border dark:border-slate-700">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Preview</p>
                <p className="text-sm font-mono text-slate-700 dark:text-slate-300">{getBulkPreview()}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Checklist items are created only from the selected template.
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
    </div>
  );
}

export default function FloorDetail() {
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
      <FloorDetailContent />
    </PermissionProvider>
  );
}