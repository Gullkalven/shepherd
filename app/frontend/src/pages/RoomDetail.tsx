import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  client,
  confirmHeatingCableStep,
  patchHeatingCableExtraSteps,
  patchHeatingCableStep,
  postWorkerPhaseHandoff,
  unlockHeatingCableStep,
} from '@/lib/api';
import {
  persistWorkerLastRoom,
  WORKER_ROOM_CHECKLIST_ANCHOR,
  WORKER_ROOM_DOCUMENTATION_ANCHOR,
  WORKER_ROOM_PHASE_HASH_PREFIX,
  clearWorkerLastRoomIfMatchesProject,
} from '@/lib/workerLastRoom';
import { usePermissions } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogForm } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Camera, Trash2, User, Ban, CheckCircle2,
  Image as ImageIcon, X, Plus, Clock, ListPlus, Pencil, Check,
  Lock, Unlock, ChevronDown, AlertTriangle, History, Calendar, Circle, EllipsisVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFailureMessage, devLogApiFailure, httpStatusFromError } from '@/lib/apiErrors';
import { flashProjectNotFoundOnce } from '@/lib/projectNotFoundFlash';
import { parseProjectRouteParam } from '@/lib/projectEntity';
import { clearStoredSelectedProjectIfMatches } from '@/lib/selectedProjectStorage';
import {
  DEFAULT_PHASE_WORKFLOW,
  deriveLinearPhaseStatusesFromPointer,
  resolvePhaseStepStatuses,
  focusPhaseKeyFromStatuses,
  inProgressPhaseKeys,
  normalizeRoomPhase,
  phaseKeys,
  phaseLabel,
  phaseTabReadOnlyForWorker,
  phaseTimelineFromStepStatus,
  storedChecklistPhase,
  photoMatchesPhase,
  coercePhaseToolOverrides,
  computePhaseChipUi,
  resolvePhaseTools,
  type PhaseStepStatus,
  type PhaseToolOverride,
  type PhaseWorkflowEntry,
} from '@/lib/roomPhases';
import {
  DEFAULT_AREA_ID,
  hasPersistedAreas,
  normalizeRoomAreas,
  taskBelongsToArea,
  type RoomArea,
} from '@/lib/roomAreas';
import { buildActivityRows } from '@/lib/roomActivity';
import { compressImageForUpload } from '@/lib/compressImageForUpload';
import { cn } from '@/lib/utils';
import { useDesktopAutoFocus } from '@/lib/useDesktopAutoFocus';
import { readWorkerSession } from '@/lib/workerSession';
import { resolveWorkerActorLabel, LEGACY_WORKER_DISPLAY_NAME_KEY } from '@/lib/workerIdentity';
import { useI18n } from '@/lib/i18n';
import { WorkerRoomView } from '@/components/WorkerRoomView';
import { ImageWithFallback } from '@/components/ImageWithFallback';
import { RoomLocationNav, type RoomNavSibling } from '@/components/RoomLocationNav';
import { resolveDisplayImageUrl } from '@/lib/imageUrls';
import {
  HEATING_CABLE_STAGES,
  HEATING_CABLE_DERIVED_STATUS_LABEL,
  heatingCableDateForDateInput,
  normalizeHeatingCableDoc,
  deriveHeatingCableStatus,
  isHeatingCableStageComplete,
  heatingStageIsLocked,
  formatHeatingCableDateTimeReadable,
  heatingStageHasAnyData,
  heatingCableStageCaption,
  buildHeatingCableGallerySections,
  isHeatingCablePhase,
  parseHeatingCableStageFromCaption,
  resolveHeatingCablePhotoDownloadUrl,
  type HeatingCableDoc,
  type HeatingCableStage,
  type HeatingCableStageKey,
} from '@/lib/heatingCable';

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not Started', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400' },
  { value: 'ready_for_inspection', label: 'Ready for Inspection', color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400' },
  { value: 'completed', label: 'Completed', color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400' },
  { value: 'blocked', label: 'Blocked', color: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400' },
];

const HEATING_AUTOSAVE_DEBOUNCE_MS = 900;
const HEATING_SAVE_UI_IDLE_MS = 2600;

function heatingTraceEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('SHEPHERD_HEATING_TRACE') === '1';
  } catch {
    return false;
  }
}

function heatingTrace(...args: unknown[]) {
  if (!heatingTraceEnabled()) return;
  console.debug('[HeatingTrace]', ...args);
}

function buildHeatingCablePayload(
  doc: HeatingCableDoc,
  displayName: string | null | undefined
): HeatingCableDoc {
  const performerFallback = resolveWorkerActorLabel(displayName);
  const normalizedWithWorker: HeatingCableDoc = {
    ...doc,
  };
  for (const stage of HEATING_CABLE_STAGES) {
    const row = normalizedWithWorker[stage.key] || {};
    const hasAnyValue =
      Boolean(row.resistance_ohm?.trim()) ||
      Boolean(row.insulation_mohm?.trim()) ||
      Boolean(row.date?.trim()) ||
      Boolean(row.note?.trim());
    if (hasAnyValue && !row.performed_by?.trim() && performerFallback) {
      normalizedWithWorker[stage.key] = {
        ...row,
        performed_by: performerFallback,
      };
    }
  }
  if (Array.isArray(normalizedWithWorker.extra_steps) && performerFallback) {
    normalizedWithWorker.extra_steps = normalizedWithWorker.extra_steps.map((row) => {
      const hasAnyValue =
        Boolean(row.resistance_ohm?.trim()) ||
        Boolean(row.insulation_mohm?.trim()) ||
        Boolean(row.date?.trim()) ||
        Boolean(row.note?.trim());
      if (hasAnyValue && !row.performed_by?.trim()) {
        return { ...row, performed_by: performerFallback };
      }
      return row;
    });
  }
  return {
    ...normalizedWithWorker,
    updated_at: new Date().toISOString(),
  };
}

function stripMainStageForLockedOrder(stageRaw: HeatingCableStage | undefined): HeatingCableStage {
  const stage = stageRaw || {};
  return {
    ...stage,
    resistance_ohm: '',
    insulation_mohm: '',
    date: '',
    performed_by: '',
    note: '',
    photos: [],
    images: [],
  };
}

function normalizeMainStageOrderForWorker(doc: HeatingCableDoc): HeatingCableDoc {
  const out: HeatingCableDoc = { ...doc };
  const before = out.before_installation || {};
  const after = out.after_cable_laid || {};
  const final = out.after_screed_final || {};
  const beforeLocked = before.step_status === 'locked';
  const afterLocked = after.step_status === 'locked';
  if (!beforeLocked && !afterLocked) out.after_cable_laid = stripMainStageForLockedOrder(after);
  if ((!beforeLocked || !afterLocked) && final.step_status !== 'locked') {
    out.after_screed_final = stripMainStageForLockedOrder(final);
  }
  return out;
}

function firstIncompleteMainHeatingStageKey(doc: HeatingCableDoc): HeatingCableStageKey {
  for (const stage of HEATING_CABLE_STAGES) {
    if (!isHeatingCableStageComplete(doc[stage.key], stage.key)) return stage.key;
  }
  return 'after_screed_final';
}

/** Compare docs for drift detection — ignores `updated_at` only. */
function heatingCableContentFingerprint(doc: HeatingCableDoc): string {
  const { updated_at: _u, ...rest } = doc;
  return JSON.stringify(normalizeHeatingCableDoc(rest));
}

/** Fingerprint of what would be persisted — matches autosave payload semantics (performer fallback, etc.). */
function heatingCablePersistFingerprint(
  doc: HeatingCableDoc,
  displayName: string | null | undefined
): string {
  return heatingCableContentFingerprint(buildHeatingCablePayload(doc, displayName));
}

function mergeHeatingModulePhotoIntoDoc(
  prev: HeatingCableDoc,
  stageId: string,
  objectKey: string
): HeatingCableDoc {
  const out: HeatingCableDoc = { ...prev };
  const addToStage = (stage: HeatingCableStage | undefined) => {
    const row = stage || {};
    const photos = Array.isArray(row.photos) ? [...row.photos, objectKey] : [objectKey];
    return { ...row, photos };
  };
  if (stageId === 'before_installation') out.before_installation = addToStage(prev.before_installation);
  else if (stageId === 'after_cable_laid') out.after_cable_laid = addToStage(prev.after_cable_laid);
  else if (stageId === 'after_screed_final') out.after_screed_final = addToStage(prev.after_screed_final);
  else {
    const extra = Array.isArray(prev.extra_steps) ? [...prev.extra_steps] : [];
    const idx = extra.findIndex((s) => (s.id || '') === stageId);
    if (idx >= 0) {
      const row = extra[idx] || {};
      const photos = Array.isArray(row.photos) ? [...row.photos, objectKey] : [objectKey];
      extra[idx] = { ...row, photos };
      out.extra_steps = extra;
    }
  }
  return out;
}

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
  deadline_at?: string | null;
  /** Admin: optional checklist card title per workflow phase key */
  checklist_labels?: unknown;
  /** Heating cable documentation payload */
  heating_cable_doc?: unknown;
  /** Per workflow-step status map; null/absent = derive from legacy `phase` pointer */
  phase_statuses?: Record<string, string> | null;
  /** Optional overrides merged with project workflow for checklist/heating visibility */
  phase_tool_overrides?: Record<string, PhaseToolOverride> | unknown | null;
  /** Per-phase worker assignment map where key=phase and value=project worker id */
  phase_assigned_worker_ids?: Record<string, number> | unknown | null;
  /** Append-only audit log from API */
  activity_log?: unknown;
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
  /** Display name of user who marked the issue resolved */
  resolved_by?: string;
  area_id?: string;
  reported_by?: string;
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

interface ProjectWorker {
  id: number;
  name: string;
  active: boolean;
}

function coerceChecklistLabels(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || !k.trim()) continue;
    if (typeof v !== 'string' || !v.trim()) continue;
    out[k.trim()] = v.trim();
  }
  return out;
}

function coercePhaseLockOverrides(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function coercePhaseAssignedWorkerIds(raw: unknown): Record<string, number> {
  let source: unknown = raw;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
    const key = String(k || '').trim();
    if (!key) continue;
    const id = Number(v);
    if (Number.isFinite(id) && id > 0) out[key] = id;
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
    const resolved_by =
      typeof o.resolved_by === 'string' && o.resolved_by.trim() ? o.resolved_by.trim() : undefined;
    const area_id = typeof o.area_id === 'string' && o.area_id.trim() ? o.area_id.trim() : undefined;
    const reported_by =
      typeof o.reported_by === 'string' && o.reported_by.trim() ? o.reported_by.trim() : undefined;
    if (!id || !phase_key || !text || !created_at) continue;
    out.push({ id, phase_key, text, status, created_at, resolved_at, resolved_by, area_id, reported_by });
  }
  return out;
}

function parseTimestampMs(s: string | null | undefined): number {
  if (!s) return 0;
  const raw = String(s).trim().replace(' ', 'T');
  if (!raw) return 0;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}Z`;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? 0 : t;
}

function parseActivityTime(s: string | null | undefined): number {
  return parseTimestampMs(s);
}

function formatActivityWhen(ts: number): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function formatDeadlineDisplay(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return null;
  }
}

function isDeadlinePast(iso?: string | null): boolean {
  if (!iso) return false;
  try {
    const end = new Date(iso);
    if (Number.isNaN(end.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const e = new Date(end);
    e.setHours(0, 0, 0, 0);
    return e < today;
  } catch {
    return false;
  }
}

function formatVisitDate(dateStr: string): string {
  try {
    const t = parseTimestampMs(dateStr);
    if (!t) return dateStr;
    const d = new Date(t);
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
  const desktopAutoFocus = useDesktopAutoFocus();
  const { projectId, floorId, roomId } = useParams<{
    projectId: string;
    floorId: string;
    roomId: string;
  }>();
  const location = useLocation();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    isAdmin,
    isWorker,
    canEdit,
    canEditRoom, canDeleteRoom, canChangeStatus, canAddChecklistItem, canDeleteChecklistItem,
    canCheckItem, canUploadPhoto, canDeletePhoto, canMovePhase,
    sectionVisibility,
    displayName,
    currentUserId,
    loading: permissionsLoading,
    sessionIsPinWorker,
  } = usePermissions();

  const [project, setProject] = useState<any>(null);
  const [floor, setFloor] = useState<any>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectWorkers, setProjectWorkers] = useState<ProjectWorker[]>([]);
  const [assigningPhaseKey, setAssigningPhaseKey] = useState<string | null>(null);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [blockedReason, setBlockedReason] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showPhotoPreview, setShowPhotoPreview] = useState<string | null>(null);
  const [showDeleteRoomDialog, setShowDeleteRoomDialog] = useState(false);
  const [deletingRoom, setDeletingRoom] = useState(false);
  const { t } = useI18n();
  const defaultChecklistTitle = t('checklist');

  const [deviations, setDeviations] = useState<WorkflowDeviation[]>([]);
  const [newDeviationText, setNewDeviationText] = useState('');
  const [savingDeviations, setSavingDeviations] = useState(false);

  // Checklist identity state (dialog only when profile + legacy name are both unavailable)
  const [showCheckNameDialog, setShowCheckNameDialog] = useState(false);
  const [checkWorkerName, setCheckWorkerName] = useState('');
  const [pendingTask, setPendingTask] = useState<Task | null>(null);
  /** Bumps when legacy localStorage worker name changes so the optional banner re-reads storage. */
  const [workerFallbackRevision, setWorkerFallbackRevision] = useState(0);

  const legacySavedWorkerName = useMemo(() => {
    void workerFallbackRevision;
    if (displayName?.trim()) return '';
    if (readWorkerSession()?.name?.trim()) return '';
    try {
      return localStorage.getItem(LEGACY_WORKER_DISPLAY_NAME_KEY)?.trim() || '';
    } catch {
      return '';
    }
  }, [displayName, workerFallbackRevision]);

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
  const [deadlineDraft, setDeadlineDraft] = useState('');
  const [savingDeadline, setSavingDeadline] = useState(false);
  const [editingChecklistTitle, setEditingChecklistTitle] = useState(false);
  const [checklistTitleDraft, setChecklistTitleDraft] = useState('');
  const [savingChecklistTitle, setSavingChecklistTitle] = useState(false);
  const [heatingCableDoc, setHeatingCableDoc] = useState<HeatingCableDoc>({});
  /** True while a heating-cable photo is uploading/processing or admin lock toggles — inputs stay responsive during autosave. */
  const [heatingCableBlocking, setHeatingCableBlocking] = useState(false);
  const [heatingCableSaveUi, setHeatingCableSaveUi] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /** Debounce timer active — show the same subtle feedback as an in-flight save. */
  const [heatingCableAutosavePending, setHeatingCableAutosavePending] = useState(false);
  /** Last persisted heating doc fingerprint (`buildHeatingCablePayload` semantics). */
  const [heatingCableSyncedFp, setHeatingCableSyncedFp] = useState('');
  const heatingCableDocRef = useRef<HeatingCableDoc>({});
  const heatingAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heatingAutosaveStepRef = useRef<HeatingCableStageKey>('before_installation');
  /** Which main stage was last edited — used when admin saves manually off the autosave timer. */
  const lastHeatingEditMainStageRef = useRef<HeatingCableStageKey>('before_installation');
  const heatingSaveUiIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipHeatingDocSyncRef = useRef(false);
  const heatingPhotoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  /** Prevents duplicate checklist toggles (nested control + double activation) from stacking toasts/API calls. */
  const checklistToggleInFlightRef = useRef<Set<number>>(new Set());
  const [completingWorkerPhase, setCompletingWorkerPhase] = useState(false);
  const [phaseToolsSaving, setPhaseToolsSaving] = useState(false);
  const [floorRoomsOrdered, setFloorRoomsOrdered] = useState<RoomNavSibling[]>([]);

  const loadData = useCallback(async () => {
    if (!projectId || !floorId || !roomId) return;
    try {
      const [projRes, floorRes, roomRes, tasksRes, photosRes, visitsRes, wfRes, floorRoomsRes] =
        await Promise.all([
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
          client.entities.rooms.query({
            query: { floor_id: Number(floorId) },
            sort: 'room_number',
            limit: 500,
          }),
        ]);
      const rawPhases = wfRes?.data?.phases;
      let wf = DEFAULT_PHASE_WORKFLOW;
      if (Array.isArray(rawPhases) && rawPhases.length > 0) {
        const parsed = rawPhases
          .filter((p: { key?: string; label?: string }) => p?.key && p?.label)
          .map((p: Record<string, unknown>) => ({
            key: String(p.key),
            label: String(p.label),
            checklist_enabled: typeof p.checklist_enabled === 'boolean' ? p.checklist_enabled : undefined,
            heating_cable_enabled:
              typeof p.heating_cable_enabled === 'boolean' ? p.heating_cable_enabled : undefined,
          }));
        if (parsed.length > 0) wf = parsed;
      }
      setPhaseWorkflow(wf);
      setProject(projRes?.data || null);
      setFloor(floorRes?.data || null);
      const roomData = roomRes?.data;
      console.log('[HeatingCable][API room payload]', roomData?.heating_cable_doc);
      if (roomData) {
        setRoom({
          ...roomData,
          phase_lock_overrides: coercePhaseLockOverrides(roomData.phase_lock_overrides),
          phase_assigned_worker_ids: coercePhaseAssignedWorkerIds(roomData.phase_assigned_worker_ids),
        });
      } else {
        setRoom(null);
      }
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
            return { ...p, downloadUrl: resolveDisplayImageUrl(dlRes?.data?.download_url || '') };
          } catch {
            return { ...p, downloadUrl: '' };
          }
        })
      );
      setPhotos(photosWithUrls);

      const floorItems = (floorRoomsRes?.data?.items || []) as RoomNavSibling[];
      floorItems.sort((a, b) => {
        const byNum = String(a.room_number).localeCompare(String(b.room_number), undefined, {
          numeric: true,
        });
        return byNum !== 0 ? byNum : a.id - b.id;
      });
      setFloorRoomsOrdered(floorItems);
    } catch (err) {
      if (httpStatusFromError(err) === 404 && projectId) {
        const pid = parseProjectRouteParam(projectId);
        if (pid !== null) {
          clearWorkerLastRoomIfMatchesProject(pid);
          clearStoredSelectedProjectIfMatches(pid);
        }
        flashProjectNotFoundOnce();
        navigate('/', { replace: true });
        return;
      }
      toast.error('Failed to load');
      setFloorRoomsOrdered([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, floorId, roomId, navigate]);

  const refreshRoom = useCallback(async () => {
    if (!roomId) return;
    try {
      const roomRes = await client.entities.rooms.get({ id: roomId });
      const roomData = roomRes?.data as Room | undefined;
      if (roomData) {
        setRoom({
          ...roomData,
          phase_lock_overrides: coercePhaseLockOverrides(roomData.phase_lock_overrides),
          phase_assigned_worker_ids: coercePhaseAssignedWorkerIds(roomData.phase_assigned_worker_ids),
        });
      }
    } catch {
      /* ignore */
    }
  }, [roomId]);

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
  const persistedAreas = Boolean(room && hasPersistedAreas(room.areas));
  /** Custom areas are in use (any non-empty `areas` JSON) */
  const showAreasNav = persistedAreas;
  const multiArea = areasList.length > 1;

  const activeArea = useMemo(
    () => areasList.find((a) => a.id === activeAreaId) ?? areasList[0],
    [areasList, activeAreaId]
  );

  const legacyPhasePointer = useMemo(
    () =>
      room
        ? normalizeRoomPhase(activeArea?.phase ?? room.phase, phaseWorkflow)
        : normalizeRoomPhase(null, phaseWorkflow),
    [room, activeArea?.phase, phaseWorkflow]
  );

  const resolvedPhaseStatuses = useMemo(() => {
    if (!room)
      return deriveLinearPhaseStatusesFromPointer(normalizeRoomPhase(null, phaseWorkflow), phaseWorkflow);
    return resolvePhaseStepStatuses(
      room.phase_statuses as Record<string, unknown> | undefined,
      legacyPhasePointer,
      phaseWorkflow
    );
  }, [room, room?.phase_statuses, legacyPhasePointer, phaseWorkflow]);

  const focusPhaseKey = useMemo(
    () => focusPhaseKeyFromStatuses(resolvedPhaseStatuses, legacyPhasePointer, phaseWorkflow),
    [resolvedPhaseStatuses, legacyPhasePointer, phaseWorkflow]
  );

  const inProgressKeys = useMemo(
    () => inProgressPhaseKeys(resolvedPhaseStatuses, phaseWorkflow),
    [resolvedPhaseStatuses, phaseWorkflow]
  );

  const saveAreasToServer = useCallback(
    async (next: RoomArea[], opts?: { phaseStatuses?: Record<string, PhaseStepStatus> }) => {
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
      if (opts?.phaseStatuses) {
        payload.phase_statuses = opts.phaseStatuses;
      }
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
    if (permissionsLoading) return;
    if (!sessionIsPinWorker) return;
    if (!readWorkerSession()?.token) navigate('/worker/login', { replace: true });
  }, [permissionsLoading, sessionIsPinWorker, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!projectId || !isAdmin) {
      setProjectWorkers([]);
      return;
    }
    let cancelled = false;
    const loadWorkers = async () => {
      try {
        console.debug('[RoomDetail] fetching project workers', { projectId });
        const res = await client.apiCall.invoke({
          url: `/api/v1/projects/${projectId}/workers`,
          method: 'GET',
          data: {},
        });
        if (cancelled) return;
        const rows = Array.isArray(res?.data) ? (res.data as ProjectWorker[]) : [];
        console.debug('[RoomDetail] project workers fetched', { projectId, count: rows.length });
        setProjectWorkers(rows.filter((w) => w.active));
      } catch {
        if (!cancelled) setProjectWorkers([]);
      }
    };
    void loadWorkers();
    return () => {
      cancelled = true;
    };
  }, [projectId, isAdmin]);

  /** Persist before paint so worker bottom nav can read updated last-room label on room switches. */
  useLayoutEffect(() => {
    if (permissionsLoading || !isWorker) return;
    if (!room || !projectId || !floorId || !roomId) return;
    persistWorkerLastRoom({
      projectId: Number(projectId),
      floorId: Number(floorId),
      roomId: Number(roomId),
      roomNumber: room.room_number,
    });
  }, [permissionsLoading, isWorker, room, projectId, floorId, roomId]);

  /** Mobile: always land at top for a room route (hash checklist scroll is desktop-only below). */
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 1023.98px)').matches) return;
    const scroller = document.querySelector('[data-worker-main-scroll]');
    if (scroller instanceof HTMLElement) {
      scroller.scrollTop = 0;
      return;
    }
    window.scrollTo(0, 0);
  }, [projectId, floorId, roomId]);

  /** After opening a room from Today (`#worker-checklist-heading`), land on checklist instead of only the location chrome. */
  useEffect(() => {
    if (permissionsLoading || !isWorker || loading || !room) return;
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023.98px)').matches) return;
    if (location.hash !== `#${WORKER_ROOM_CHECKLIST_ANCHOR}`) return;
    const id = requestAnimationFrame(() => {
      const smooth =
        typeof window !== 'undefined' &&
        !window.matchMedia('(max-width: 1023.98px)').matches &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById(WORKER_ROOM_CHECKLIST_ANCHOR)?.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'start',
      });
    });
    return () => cancelAnimationFrame(id);
  }, [permissionsLoading, isWorker, loading, room?.id, location.hash]);

  /** Bottom nav “Camera / Docs” — scroll to checklist/documentation section. */
  useEffect(() => {
    if (permissionsLoading || !isWorker || loading || !room) return;
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023.98px)').matches) return;
    if (location.hash !== `#${WORKER_ROOM_DOCUMENTATION_ANCHOR}`) return;
    const id = requestAnimationFrame(() => {
      const smooth =
        typeof window !== 'undefined' &&
        !window.matchMedia('(max-width: 1023.98px)').matches &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById(WORKER_ROOM_DOCUMENTATION_ANCHOR)?.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'start',
      });
    });
    return () => cancelAnimationFrame(id);
  }, [permissionsLoading, isWorker, loading, room?.id, location.hash]);

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
    if (!room) return;
    const hash = (location.hash || '').replace(/^#/, '');
    if (!hash.startsWith(WORKER_ROOM_PHASE_HASH_PREFIX)) return;
    const phaseKeyRaw = hash.slice(WORKER_ROOM_PHASE_HASH_PREFIX.length);
    if (!phaseKeyRaw) return;
    const phaseKey = normalizeRoomPhase(decodeURIComponent(phaseKeyRaw), phaseWorkflow);
    setPhaseTab(phaseKey);
  }, [room?.id, location.hash, phaseWorkflow]);

  useEffect(() => {
    if (room) setDeviations(coerceWorkflowDeviations(room.workflow_deviations));
  }, [room?.id, room?.workflow_deviations]);

  useEffect(() => {
    heatingCableDocRef.current = heatingCableDoc;
  }, [heatingCableDoc]);

  useEffect(() => {
    if (!room) return;
    if (skipHeatingDocSyncRef.current) {
      skipHeatingDocSyncRef.current = false;
      return;
    }
    const n = normalizeHeatingCableDoc(room.heating_cable_doc);
    heatingTrace('room load -> normalized heating_cable_doc', {
      roomId: room.id,
      raw: room.heating_cable_doc,
      normalized: n,
    });
    setHeatingCableDoc(n);
    setHeatingCableSyncedFp(heatingCablePersistFingerprint(n, displayName));
  }, [room?.id, room?.heating_cable_doc, displayName]);

  useEffect(() => {
    return () => {
      if (heatingAutosaveTimerRef.current) clearTimeout(heatingAutosaveTimerRef.current);
      if (heatingSaveUiIdleTimerRef.current) clearTimeout(heatingSaveUiIdleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setShowAddTask(false);
  }, [phaseTab, activeAreaId]);

  useEffect(() => {
    setEditingChecklistTitle(false);
  }, [phaseTab]);

  useEffect(() => {
    if (!room?.deadline_at) {
      setDeadlineDraft('');
      return;
    }
    try {
      const d = new Date(room.deadline_at);
      if (Number.isNaN(d.getTime())) {
        setDeadlineDraft('');
        return;
      }
      setDeadlineDraft(d.toISOString().slice(0, 10));
    } catch {
      setDeadlineDraft('');
    }
  }, [room?.deadline_at]);

  useEffect(() => {
    const saved = localStorage.getItem(LEGACY_WORKER_DISPLAY_NAME_KEY);
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
      toast.success(next ? 'Locked for workers' : 'Unlocked');
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
    const label = resolveWorkerActorLabel(displayName);
    if (label) {
      executeToggleTask(task, label);
      return;
    }
    if (permissionsLoading) return;
    if (sessionIsPinWorker) {
      toast.error('Sign in as a site worker (PIN) to check items.');
      navigate('/worker/login', { replace: true });
      return;
    }
    setPendingTask(task);
    setCheckWorkerName(localStorage.getItem(LEGACY_WORKER_DISPLAY_NAME_KEY) || '');
    setShowCheckNameDialog(true);
  };

  const executeToggleTask = async (task: Task, workerName: string) => {
    if (checklistToggleInFlightRef.current.has(task.id)) return;
    checklistToggleInFlightRef.current.add(task.id);
    try {
      const newCompleted = !task.is_completed;
      const now = new Date();
      const checkedAt = now.toISOString().replace('T', ' ').substring(0, 19);
      const res = await client.entities.tasks.update({
        id: String(task.id),
        data: {
          is_completed: newCompleted,
          checked_by: workerName,
          checked_at: checkedAt,
        },
      });
      const updated = res?.data as Task | undefined;
      const finalCompleted =
        typeof updated?.is_completed === 'boolean' ? updated.is_completed : newCompleted;
      const finalCheckedBy =
        typeof updated?.checked_by === 'string' && updated.checked_by.trim()
          ? updated.checked_by.trim()
          : workerName;
      const finalCheckedAt =
        typeof updated?.checked_at === 'string' && updated.checked_at.trim()
          ? updated.checked_at.trim()
          : checkedAt;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                is_completed: finalCompleted,
                checked_by: finalCheckedBy,
                checked_at: finalCheckedAt,
              }
            : t
        )
      );
      await refreshRoom();
      const verb = finalCompleted ? 'checked' : 'unchecked';
      toast.success(`${workerName} ${verb} "${task.name}"`, {
        id: `checklist-toggle-${task.id}`,
      });
    } catch {
      toast.error('Failed to update task');
    } finally {
      checklistToggleInFlightRef.current.delete(task.id);
    }
  };

  const handleConfirmCheckName = () => {
    if (!checkWorkerName.trim() || !pendingTask) return;
    const name = checkWorkerName.trim();
    localStorage.setItem(LEGACY_WORKER_DISPLAY_NAME_KEY, name);
    setWorkerFallbackRevision((r) => r + 1);
    setShowCheckNameDialog(false);
    executeToggleTask(pendingTask, name);
    setPendingTask(null);
  };

  const handleClearSavedName = () => {
    localStorage.removeItem(LEGACY_WORKER_DISPLAY_NAME_KEY);
    setCheckWorkerName('');
    setWorkerFallbackRevision((r) => r + 1);
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
      await refreshRoom();
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
      await refreshRoom();
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
      await refreshRoom();
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
      await refreshRoom();
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
      await refreshRoom();
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
    const reporter = resolveWorkerActorLabel(displayName);
    if (!reporter.trim()) {
      if (sessionIsPinWorker) {
        toast.error('Sign in as a site worker (PIN) to report issues.');
        navigate('/worker/login', { replace: true });
      } else {
        toast.error('Enter your name first — tap a checklist item once to set your name.');
      }
      return;
    }
    const phaseKey = normalizeRoomPhase(phaseTab, phaseWorkflow);
    const stamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const item: WorkflowDeviation = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `d-${Date.now()}`,
      phase_key: phaseKey,
      text,
      status: 'open',
      created_at: stamp,
      reported_by: reporter,
      ...(showAreasNav ? { area_id: activeAreaId } : {}),
    };
    await persistWorkflowDeviations([...deviations, item], 'Deviation added');
    setNewDeviationText('');
  };

  const handleAssignPhaseWorker = async (phaseKey: string, workerId: number | null) => {
    if (!room || !canEdit) return;
    const key = normalizeRoomPhase(phaseKey, phaseWorkflow);
    const current = coercePhaseAssignedWorkerIds(room.phase_assigned_worker_ids);
    const next = { ...current };
    if (workerId == null) delete next[key];
    else next[key] = workerId;
    setAssigningPhaseKey(key);
    try {
      const updateRes = await client.entities.rooms.update({
        id: String(room.id),
        data: { phase_assigned_worker_ids: next },
      });
      const updatedRoom = updateRes?.data as Room | undefined;
      if (updatedRoom) {
        setRoom({
          ...updatedRoom,
          phase_lock_overrides: coercePhaseLockOverrides(updatedRoom.phase_lock_overrides),
          phase_assigned_worker_ids: coercePhaseAssignedWorkerIds(updatedRoom.phase_assigned_worker_ids),
        });
      } else {
        setRoom({ ...room, phase_assigned_worker_ids: next });
      }
      await refreshRoom();
      toast.success(workerId == null ? 'Phase assignment cleared' : 'Worker assigned to phase');
    } catch {
      toast.error('Failed to assign worker to phase');
    } finally {
      setAssigningPhaseKey(null);
    }
  };

  const handleSetMainPhase = async (nextPhase: string) => {
    if (!room || !canMovePhase) return;
    const norm = normalizeRoomPhase(nextPhase, phaseWorkflow);
    const next = areasList.map((a, i) => (i === 0 ? { ...a, phase: norm } : a));
    const linear = deriveLinearPhaseStatusesFromPointer(norm, phaseWorkflow);
    try {
      await saveAreasToServer(next, { phaseStatuses: linear });
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
    const linear = deriveLinearPhaseStatusesFromPointer(norm, phaseWorkflow);
    try {
      await saveAreasToServer(next, { phaseStatuses: linear });
      setPhaseTab(norm);
      toast.success(`Area phase: ${phaseLabel(norm, phaseWorkflow)}`);
    } catch {
      toast.error('Failed to set area phase');
    }
  };

  const handlePhaseStepStatusChange = async (stepKey: string, value: PhaseStepStatus) => {
    if (!room || !canEdit) return;
    const normKey = normalizeRoomPhase(stepKey, phaseWorkflow);
    const next = { ...resolvedPhaseStatuses, [normKey]: value };
    try {
      await client.entities.rooms.update({
        id: String(room.id),
        data: { phase_statuses: next as Record<string, string> },
      });
      await loadData();
      toast.success('Phase status updated');
    } catch {
      toast.error('Failed to update phase status');
    }
  };

  const handleTogglePhaseWorkerLock = async (phaseKey: string) => {
    if (!room || !canEdit || !activeArea) return;
    const rp = normalizeRoomPhase(activeArea.phase ?? room.phase, phaseWorkflow);
    const overrides = coercePhaseLockOverrides(
      persistedAreas ? activeArea.phase_lock_overrides : room.phase_lock_overrides
    );
    const workerLocked = phaseTabReadOnlyForWorker(
      rp,
      phaseKey,
      phaseWorkflow,
      overrides,
      resolvedPhaseStatuses
    );
    const nextOv: Record<string, boolean> = { ...overrides };
    if (workerLocked) {
      const defaultLocked = phaseTabReadOnlyForWorker(rp, phaseKey, phaseWorkflow, {}, resolvedPhaseStatuses);
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
      const after = phaseTabReadOnlyForWorker(
        rp,
        phaseKey,
        phaseWorkflow,
        nextOv,
        resolvedPhaseStatuses
      );
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
      persistedAreas
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
      const prepared = await compressImageForUpload(file);
      const safeFilename = prepared.name.replace(/[^A-Za-z0-9._-]/g, '-');
      const objectKey = `${Date.now()}-${safeFilename}`;
      const uploadRes = await client.storage.getUploadUrl({
        bucket_name: 'room-photos',
        object_key: objectKey,
      });
      const uploadUrl = uploadRes?.data?.upload_url;
      if (!uploadUrl) throw new Error('No upload URL');
      const token = localStorage.getItem('token');
      const isApiUploadTarget = (() => {
        try {
          const u = new URL(uploadUrl, window.location.origin);
          return u.origin === window.location.origin && u.pathname.startsWith('/api/');
        } catch {
          return false;
        }
      })();

      if (isApiUploadTarget) {
        const formData = new FormData();
        formData.append('file', prepared, prepared.name);
        const authHeaders: Record<string, string> = {};
        if (token) authHeaders.Authorization = `Bearer ${token}`;
        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          body: formData,
          headers: authHeaders,
        });
        if (!uploadResponse.ok) throw new Error(`Upload failed (${uploadResponse.status})`);
      } else {
        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: prepared,
          headers: { 'Content-Type': prepared.type },
        });
        if (!uploadResponse.ok) throw new Error(`Upload failed (${uploadResponse.status})`);
      }

      const actorLabel = resolveWorkerActorLabel(displayName);
      const caption = actorLabel ? `Uploaded by ${actorLabel}` : '';

      await client.entities.room_photos.create({
        data: {
          room_id: room.id,
          object_key: objectKey,
          filename: prepared.name,
          caption,
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
      await refreshRoom();
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
      toast.success('Deleted');
      navigate(`/project/${projectId}/floor/${floorId}`);
    } catch {
      toast.error('Failed to delete');
    } finally {
      setDeletingRoom(false);
      setShowDeleteRoomDialog(false);
    }
  };

  const handleWorkerPhaseComplete = async (): Promise<boolean> => {
    if (!room) return false;
    const workerName = resolveWorkerActorLabel(displayName);
    if (!workerName.trim()) {
      if (sessionIsPinWorker) {
        toast.error('Sign in as a site worker (PIN) to record handoff.');
        navigate('/worker/login', { replace: true });
      } else {
        toast.error('Enter your name to record handoff.');
        setShowCheckNameDialog(true);
      }
      return false;
    }
    const phaseKey = normalizeRoomPhase(phaseTab, phaseWorkflow);
    const areaPayload =
      activeAreaId === DEFAULT_AREA_ID && !hasPersistedAreas(room.areas)
        ? {}
        : { area_id: activeAreaId };
    setCompletingWorkerPhase(true);
    try {
      await postWorkerPhaseHandoff(room.id, {
        phase: phaseKey,
        worker_name: workerName,
        ...areaPayload,
      });
      toast.success('Phase handed off and locked for editing.');
      await loadData();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not complete handoff';
      toast.error(msg);
      return false;
    } finally {
      setCompletingWorkerPhase(false);
    }
  };

  const handleSaveDeadline = async () => {
    if (!room || !canEdit) return;
    setSavingDeadline(true);
    try {
      const d = deadlineDraft.trim();
      const iso = d === '' ? null : `${d}T12:00:00.000Z`;
      await client.entities.rooms.update({
        id: String(room.id),
        data: { deadline_at: iso } as Record<string, unknown>,
      });
      setRoom({ ...room, deadline_at: iso });
      await refreshRoom();
      toast.success(iso ? 'Deadline saved' : 'Deadline cleared');
    } catch {
      toast.error('Failed to save deadline');
    } finally {
      setSavingDeadline(false);
    }
  };

  const handleClearDeadline = async () => {
    if (!room || !canEdit) return;
    setSavingDeadline(true);
    try {
      await client.entities.rooms.update({
        id: String(room.id),
        data: { deadline_at: null } as Record<string, unknown>,
      });
      setDeadlineDraft('');
      setRoom({ ...room, deadline_at: null });
      await refreshRoom();
      toast.success('Deadline cleared');
    } catch {
      toast.error('Failed to clear deadline');
    } finally {
      setSavingDeadline(false);
    }
  };

  const persistPhaseToolToggle = useCallback(
    async (phaseKey: string, partial: PhaseToolOverride) => {
      if (!room?.id || !canEdit) return;
      setPhaseToolsSaving(true);
      try {
        const cur = coercePhaseToolOverrides(room.phase_tool_overrides);
        const merged: PhaseToolOverride = { ...cur[phaseKey], ...partial };
        const next = { ...cur, [phaseKey]: merged };
        await client.entities.rooms.update({
          id: String(room.id),
          data: { phase_tool_overrides: next } as Record<string, unknown>,
        });
        setRoom((prev) => (prev ? { ...prev, phase_tool_overrides: next } : null));
        await refreshRoom();
      } catch {
        toast.error('Failed to save phase tools');
      } finally {
        setPhaseToolsSaving(false);
      }
    },
    [room, canEdit, refreshRoom]
  );

  const commitChecklistSectionTitle = useCallback(async () => {
    if (!room || !canEdit) return;
    const phaseKey = normalizeRoomPhase(phaseTab, phaseWorkflow);
    const prev = coerceChecklistLabels(room.checklist_labels);
    const displayed = prev[phaseKey]?.trim() || defaultChecklistTitle;
    const trimmedTitle = checklistTitleDraft.trim();
    if (trimmedTitle === displayed) {
      setEditingChecklistTitle(false);
      return;
    }
    const next = { ...prev };
    if (!trimmedTitle || trimmedTitle === defaultChecklistTitle) delete next[phaseKey];
    else next[phaseKey] = trimmedTitle;
    setSavingChecklistTitle(true);
    try {
      await client.entities.rooms.update({
        id: String(room.id),
        data: {
          checklist_labels: Object.keys(next).length > 0 ? next : null,
        } as Record<string, unknown>,
      });
      setRoom({ ...room, checklist_labels: next });
      await refreshRoom();
      toast.success('Title updated');
    } catch {
      toast.error('Failed to save title');
    } finally {
      setSavingChecklistTitle(false);
      setEditingChecklistTitle(false);
    }
  }, [room, canEdit, checklistTitleDraft, phaseTab, phaseWorkflow, defaultChecklistTitle, refreshRoom]);

  const persistHeatingCableDoc = useCallback(
    async (stepKey: HeatingCableStageKey, options?: { overrideDoc?: HeatingCableDoc; manual?: boolean }) => {
      if (!room) return false;
      const manualToast = options?.manual ?? false;
      const source = options?.overrideDoc ?? heatingCableDocRef.current;

      if (heatingSaveUiIdleTimerRef.current) {
        clearTimeout(heatingSaveUiIdleTimerRef.current);
        heatingSaveUiIdleTimerRef.current = null;
      }
      setHeatingCableSaveUi('saving');

      try {
        const payloadDoc = normalizeMainStageOrderForWorker(buildHeatingCablePayload(source, displayName));
        const finalLocked = payloadDoc.after_screed_final?.step_status === 'locked';

        if (finalLocked && stepKey === 'after_screed_final') {
          const extras = (payloadDoc.extra_steps ?? []) as Record<string, unknown>[];
          if (import.meta.env.DEV) {
            console.debug('[HeatingCable] save extra steps', {
              roomId: room.id,
              endpoint: `/api/v1/rooms/${room.id}/heating-cable/extra-steps`,
              count: extras.length,
            });
          }
          const res = await patchHeatingCableExtraSteps(room.id, extras);
          const persisted = normalizeHeatingCableDoc(res?.heating_cable_doc);
          skipHeatingDocSyncRef.current = true;
          setHeatingCableDoc(persisted);
          setRoom((prev) => (prev ? { ...prev, heating_cable_doc: persisted } : null));
          setHeatingCableSyncedFp(heatingCablePersistFingerprint(persisted, displayName));
          await refreshRoom();
          setHeatingCableSaveUi('saved');
          heatingSaveUiIdleTimerRef.current = setTimeout(() => {
            setHeatingCableSaveUi('idle');
            heatingSaveUiIdleTimerRef.current = null;
          }, HEATING_SAVE_UI_IDLE_MS);
          if (manualToast) toast.success('Heating cable documentation saved');
          return true;
        }

        const stage = payloadDoc[stepKey] || {};
        const stepPayload: {
          resistance: string;
          insulation: string;
          performed_at: string;
          note: string;
          photos: string[];
          extra_steps?: Record<string, unknown>[];
        } = {
          resistance: stage.resistance_ohm || '',
          insulation: stage.insulation_mohm || '',
          performed_at: stage.date || '',
          note: stage.note || '',
          photos: Array.isArray(stage.photos) ? stage.photos : [],
        };
        if (Array.isArray(payloadDoc.extra_steps)) {
          stepPayload.extra_steps = payloadDoc.extra_steps as Record<string, unknown>[];
        }
        if (import.meta.env.DEV) {
          console.debug('[HeatingCable] save', {
            activeStepKey: firstIncompleteMainHeatingStageKey(heatingCableDocRef.current),
            stepBeingSaved: stepKey,
            endpoint: `/api/v1/rooms/${room.id}/heating-cable/${stepKey}`,
            payloadKeys: Object.keys(stepPayload),
            after_cable_laid_present: Object.prototype.hasOwnProperty.call(stepPayload, 'after_cable_laid'),
            payload: stepPayload,
          });
        }
        const res = await patchHeatingCableStep(room.id, stepKey, stepPayload);
        const persisted = normalizeHeatingCableDoc(res?.heating_cable_doc);
        skipHeatingDocSyncRef.current = true;
        setHeatingCableDoc(persisted);
        setRoom((prev) => (prev ? { ...prev, heating_cable_doc: persisted } : null));
        setHeatingCableSyncedFp(heatingCablePersistFingerprint(persisted, displayName));
        await refreshRoom();
        setHeatingCableSaveUi('saved');
        heatingSaveUiIdleTimerRef.current = setTimeout(() => {
          setHeatingCableSaveUi('idle');
          heatingSaveUiIdleTimerRef.current = null;
        }, HEATING_SAVE_UI_IDLE_MS);
        if (manualToast) toast.success('Heating cable documentation saved');
        return true;
      } catch (err) {
        setHeatingCableSaveUi('error');
        devLogApiFailure(`heating_cable.${stepKey}.save`, err);
        const reason = apiFailureMessage(err);
        if (reason) {
          console.error('[HeatingCable] Save failed:', reason);
        }
        if (manualToast) toast.error(reason ? `Failed to save: ${reason}` : 'Failed to save heating cable documentation');
        return false;
      } finally {
        setHeatingCableAutosavePending(false);
      }
    },
    [room, displayName, refreshRoom]
  );

  const flushPendingHeatingAutosave = useCallback(() => {
    if (!heatingAutosaveTimerRef.current) return;
    clearTimeout(heatingAutosaveTimerRef.current);
    heatingAutosaveTimerRef.current = null;
    void persistHeatingCableDoc(heatingAutosaveStepRef.current);
  }, [persistHeatingCableDoc]);

  const scheduleHeatingAutosave = useCallback((stepKey: HeatingCableStageKey) => {
    if (heatingAutosaveTimerRef.current) clearTimeout(heatingAutosaveTimerRef.current);
    heatingAutosaveStepRef.current = stepKey;
    setHeatingCableAutosavePending(true);
    heatingAutosaveTimerRef.current = setTimeout(() => {
      heatingAutosaveTimerRef.current = null;
      void persistHeatingCableDoc(heatingAutosaveStepRef.current);
    }, HEATING_AUTOSAVE_DEBOUNCE_MS);
  }, [persistHeatingCableDoc]);

  const saveHeatingCableDoc = useCallback(async () => {
    if (!room) return;
    if (heatingAutosaveTimerRef.current) {
      clearTimeout(heatingAutosaveTimerRef.current);
      heatingAutosaveTimerRef.current = null;
      await persistHeatingCableDoc(heatingAutosaveStepRef.current, { manual: true });
      return;
    }
    const target = isAdmin
      ? lastHeatingEditMainStageRef.current
      : firstIncompleteMainHeatingStageKey(heatingCableDocRef.current);
    await persistHeatingCableDoc(target, { manual: true });
  }, [room, persistHeatingCableDoc, isAdmin]);

  useEffect(() => {
    const onLeave = () => {
      if (document.visibilityState === 'hidden') flushPendingHeatingAutosave();
    };
    const onPageHide = () => flushPendingHeatingAutosave();
    document.addEventListener('visibilitychange', onLeave);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onLeave);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flushPendingHeatingAutosave]);

  const updateHeatingStageField = (
    stageKey: HeatingCableStageKey,
    field: 'resistance_ohm' | 'insulation_mohm' | 'date' | 'note',
    value: string
  ) => {
    const idx = HEATING_CABLE_STAGES.findIndex((s) => s.key === stageKey);
    const prevLocked =
      idx <= 0
        ? true
        : heatingCableDocRef.current[HEATING_CABLE_STAGES[idx - 1].key]?.step_status === 'locked';
    const curLocked = heatingCableDocRef.current[stageKey]?.step_status === 'locked';
    if (!isAdmin) {
      if (!prevLocked || curLocked) return;
    }
    lastHeatingEditMainStageRef.current = stageKey;
    setHeatingCableDoc((prev) => {
      const row: HeatingCableStage = {
        ...(prev[stageKey] || {}),
        [field]: value,
      };
      heatingTrace('worker local stage change', {
        roomId: room?.id,
        stageKey,
        field,
        value,
        nextStage: row,
      });
      return {
        ...prev,
        [stageKey]: row,
      };
    });
    scheduleHeatingAutosave(stageKey);
  };

  const addExtraHeatingStep = () => {
    lastHeatingEditMainStageRef.current = 'after_screed_final';
    setHeatingCableDoc((prev) => {
      const extra = Array.isArray(prev.extra_steps) ? [...prev.extra_steps] : [];
      extra.push({
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `hc-${Date.now()}`,
        label: '',
        resistance_ohm: '',
        insulation_mohm: '',
        date: '',
        performed_by: '',
        note: '',
        photos: [],
      });
      return { ...prev, extra_steps: extra };
    });
    scheduleHeatingAutosave('after_screed_final');
  };

  const updateExtraHeatingStepField = (
    stepIndex: number,
    field: 'label' | 'resistance_ohm' | 'insulation_mohm' | 'date' | 'note',
    value: string
  ) => {
    lastHeatingEditMainStageRef.current = 'after_screed_final';
    if (stepIndex >= 0) {
      const prevLocked = heatingCableDocRef.current.after_screed_final?.step_status === 'locked';
      if (!prevLocked) return;
    }
    setHeatingCableDoc((prev) => {
      const extra = Array.isArray(prev.extra_steps) ? [...prev.extra_steps] : [];
      const step: HeatingCableStage = { ...(extra[stepIndex] || {}), [field]: value };
      extra[stepIndex] = step;
      return { ...prev, extra_steps: extra };
    });
    scheduleHeatingAutosave('after_screed_final');
  };

  const removeExtraHeatingStep = (stepIndex: number) => {
    lastHeatingEditMainStageRef.current = 'after_screed_final';
    setHeatingCableDoc((prev) => {
      const extra = Array.isArray(prev.extra_steps) ? [...prev.extra_steps] : [];
      extra.splice(stepIndex, 1);
      return { ...prev, extra_steps: extra };
    });
    scheduleHeatingAutosave('after_screed_final');
  };

  const uploadHeatingModulePhoto = async (stageId: string, file: File) => {
    if (!room) return;
    const prepared = await compressImageForUpload(file);
    const safeFilename = prepared.name.replace(/[^A-Za-z0-9._-]/g, '-');
    const objectKey = `${Date.now()}-${safeFilename}`;
    const uploadRes = await client.storage.getUploadUrl({
      bucket_name: 'room-photos',
      object_key: objectKey,
    });
    const uploadUrl = uploadRes?.data?.upload_url;
    if (!uploadUrl) throw new Error('No upload URL');
    const token = localStorage.getItem('token');
    const isApiUploadTarget = (() => {
      try {
        const u = new URL(uploadUrl, window.location.origin);
        return u.origin === window.location.origin && u.pathname.startsWith('/api/');
      } catch {
        return false;
      }
    })();
    if (isApiUploadTarget) {
      const formData = new FormData();
      formData.append('file', prepared, prepared.name);
      const authHeaders: Record<string, string> = {};
      if (token) authHeaders.Authorization = `Bearer ${token}`;
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
        headers: authHeaders,
      });
      if (!uploadResponse.ok) throw new Error(`Upload failed (${uploadResponse.status})`);
    } else {
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: prepared,
        headers: { 'Content-Type': prepared.type },
      });
      if (!uploadResponse.ok) throw new Error(`Upload failed (${uploadResponse.status})`);
    }
    const actorLabel = resolveWorkerActorLabel(displayName);
    const heatCap = heatingCableStageCaption(stageId);
    const heatCaption =
      [heatCap, actorLabel ? `Uploaded by ${actorLabel}` : ''].filter(Boolean).join(' · ') || '';

    await client.entities.room_photos.create({
      data: {
        room_id: room.id,
        object_key: objectKey,
        filename: prepared.name,
        caption: heatCaption,
        phase: normalizeRoomPhase(phaseTab, phaseWorkflow),
        ...taskPhotoVisitAreaPayload(),
      },
    });
    const nextDoc = mergeHeatingModulePhotoIntoDoc(heatingCableDocRef.current, stageId, objectKey);
    setHeatingCableDoc(nextDoc);
    const persistKey: HeatingCableStageKey =
      stageId === 'before_installation' || stageId === 'after_cable_laid' || stageId === 'after_screed_final'
        ? stageId
        : 'after_screed_final';
    await persistHeatingCableDoc(persistKey, { overrideDoc: nextDoc });
    await loadData();
  };

  const handleHeatingStagePhotoInput = async (stageId: string, file?: File) => {
    if (!file || !room) return;
    if (
      stageId !== 'before_installation' &&
      stageId !== 'after_cable_laid' &&
      stageId !== 'after_screed_final'
    ) {
      if (heatingCableDocRef.current.after_screed_final?.step_status !== 'locked') return;
    } else {
      const idx = HEATING_CABLE_STAGES.findIndex((s) => s.key === stageId);
      const prevLocked =
        idx <= 0
          ? true
          : heatingCableDocRef.current[HEATING_CABLE_STAGES[idx - 1].key]?.step_status === 'locked';
      const curLocked = heatingCableDocRef.current[stageId]?.step_status === 'locked';
      if (!isAdmin) {
        if (!prevLocked || curLocked) return;
      }
      lastHeatingEditMainStageRef.current = stageId as HeatingCableStageKey;
    }
    setHeatingCableBlocking(true);
    try {
      await uploadHeatingModulePhoto(stageId, file);
      toast.success('Heating module photo uploaded');
    } catch {
      toast.error('Failed to upload heating module photo');
    } finally {
      setHeatingCableBlocking(false);
      const galleryKey = `${stageId}:gallery`;
      const cameraKey = `${stageId}:camera`;
      const g = heatingPhotoInputRefs.current[galleryKey];
      const c = heatingPhotoInputRefs.current[cameraKey];
      if (g) g.value = '';
      if (c) c.value = '';
      const legacy = heatingPhotoInputRefs.current[stageId];
      if (legacy) legacy.value = '';
    }
  };

  const completeHeatingStage = useCallback(
    async (stageKey: HeatingCableStageKey) => {
      if (!room) return;
      const idx = HEATING_CABLE_STAGES.findIndex((s) => s.key === stageKey);
      const prevLocked =
        idx <= 0
          ? true
          : heatingCableDocRef.current[HEATING_CABLE_STAGES[idx - 1].key]?.step_status === 'locked';
      if (!prevLocked) {
        toast.error('Complete the previous step first.');
        return;
      }
      const current = heatingCableDocRef.current[stageKey] || {};
      if (current.step_status === 'locked') {
        toast.error('This step is already locked.');
        return;
      }
      if (!current.resistance_ohm?.trim() || !current.insulation_mohm?.trim()) {
        toast.error('Fill all required fields before completing this step.');
        return;
      }
      if (stageKey === 'after_cable_laid' && !(Array.isArray(current.photos) && current.photos.some((x) => !!x?.trim()))) {
        toast.error('Add at least one photo before completing "After cable laid".');
        return;
      }
      const workerUserId = (currentUserId || '').trim();
      const isAuthorisedActor = isAdmin || sessionIsPinWorker;
      if (!workerUserId || !isAuthorisedActor) {
        toast.error('You must be logged in as a Site Worker to confirm this step.');
        return;
      }
      if (import.meta.env.DEV) {
        console.debug('[HeatingCable] confirm', {
          activeStepKey: firstIncompleteMainHeatingStageKey(heatingCableDocRef.current),
          stepBeingConfirmed: stageKey,
          endpoint: `/api/v1/rooms/${room.id}/heating-cable/${stageKey}/confirm`,
          payloadKeys: [],
          after_cable_laid_present: false,
          payload: {},
        });
      }
      setHeatingCableBlocking(true);
      try {
        const res = await confirmHeatingCableStep(room.id, stageKey);
        const persisted = normalizeHeatingCableDoc(res?.heating_cable_doc);
        skipHeatingDocSyncRef.current = true;
        setHeatingCableDoc(persisted);
        setRoom((prev) => (prev ? { ...prev, heating_cable_doc: persisted } : null));
        setHeatingCableSyncedFp(heatingCablePersistFingerprint(persisted, displayName));
        await refreshRoom();
        toast.success('Step completed and locked');
      } catch (err) {
        devLogApiFailure('confirm heating cable step', err);
        toast.error(apiFailureMessage(err) ?? 'Failed to confirm heating cable step');
      } finally {
        setHeatingCableBlocking(false);
      }
    },
    [room, currentUserId, displayName, refreshRoom, isAdmin, sessionIsPinWorker]
  );

  const unlockHeatingCableStage = useCallback(
    async (stageKey: HeatingCableStageKey) => {
      if (!room || !isAdmin) return;
      setHeatingCableBlocking(true);
      try {
        const res = await unlockHeatingCableStep(room.id, stageKey);
        const persisted = normalizeHeatingCableDoc(res?.heating_cable_doc);
        skipHeatingDocSyncRef.current = true;
        setHeatingCableDoc(persisted);
        setRoom((prev) => (prev ? { ...prev, heating_cable_doc: persisted } : null));
        setHeatingCableSyncedFp(heatingCablePersistFingerprint(persisted, displayName));
        await refreshRoom();
        toast.success('Step unlocked. Workers can edit until it is confirmed again.');
      } catch (err) {
        devLogApiFailure('unlock heating cable step', err);
        toast.error(apiFailureMessage(err) ?? 'Failed to unlock step');
      } finally {
        setHeatingCableBlocking(false);
      }
    },
    [room, isAdmin, displayName, refreshRoom]
  );

  const toggleHeatingCableLock = async () => {
    if (!room || !canEdit) return;
    setHeatingCableBlocking(true);
    try {
      const payload: HeatingCableDoc = {
        ...heatingCableDoc,
        locked_by_admin: !(heatingCableDoc.locked_by_admin === true),
        updated_at: new Date().toISOString(),
      };
      await client.entities.rooms.update({
        id: String(room.id),
        data: { heating_cable_doc: payload } as Record<string, unknown>,
      });
      skipHeatingDocSyncRef.current = true;
      setHeatingCableDoc(payload);
      setHeatingCableSyncedFp(heatingCablePersistFingerprint(payload, displayName));
      setRoom({ ...room, heating_cable_doc: payload });
      toast.success(payload.locked_by_admin ? 'Heating cable section locked' : 'Heating cable section unlocked');
    } catch {
      toast.error('Failed to update heating cable lock');
    } finally {
      setHeatingCableBlocking(false);
    }
  };

  const activityEntries = useMemo(() => {
    if (!room) return [];
    const primary = areasList[0]?.id ?? DEFAULT_AREA_ID;
    return buildActivityRows({
      activityLog: room.activity_log,
      visits,
      photos,
      phaseTab,
      phaseWorkflow,
      activeAreaId,
      areasPrimaryId: primary,
      parseActivityTime,
    });
  }, [room, visits, photos, phaseTab, phaseWorkflow, activeAreaId, areasList]);

  const deviationsForPhase = useMemo(() => {
    const sel = normalizeRoomPhase(phaseTab, phaseWorkflow);
    return deviations.filter((d) => {
      const dArea = d.area_id?.trim() || DEFAULT_AREA_ID;
      return (
        dArea === activeAreaId && normalizeRoomPhase(d.phase_key, phaseWorkflow) === sel
      );
    });
  }, [deviations, phaseTab, phaseWorkflow, activeAreaId]);

  const openDeviationsForPhase = useMemo(
    () => deviationsForPhase.filter((d) => d.status === 'open'),
    [deviationsForPhase]
  );
  const resolvedDeviationsForPhase = useMemo(
    () => deviationsForPhase.filter((d) => d.status === 'resolved'),
    [deviationsForPhase]
  );

  const heatingCableDirty = useMemo(
    () =>
      heatingCableSyncedFp !== '' &&
      heatingCablePersistFingerprint(heatingCableDoc, displayName) !== heatingCableSyncedFp,
    [heatingCableDoc, heatingCableSyncedFp, displayName]
  );

  const heatingCableManualSaveLabel = useMemo(
    () =>
      deriveHeatingCableStatus(heatingCableDoc).status === 'complete'
        ? 'Save changes'
        : 'Save documentation',
    [heatingCableDoc]
  );

  const heatingCableSaveBusy = useMemo(
    () => heatingCableAutosavePending || heatingCableSaveUi === 'saving',
    [heatingCableAutosavePending, heatingCableSaveUi]
  );

  if (loading || permissionsLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Not found</p>
      </div>
    );
  }

  const normalizedRoomStatus =
    typeof room.status === 'string' && room.status.trim() !== '' ? room.status.trim() : 'not_started';
  const currentStatus =
    STATUS_OPTIONS.find((s) => s.value === normalizedRoomStatus) || STATUS_OPTIONS[0];
  const uniqueWorkers = [...new Set(visits.map((v) => v.worker_name))];
  const editsBlocked = Boolean(room.is_locked) && !canEdit;
  const boardPhaseNorm = normalizeRoomPhase(areasList[0]?.phase ?? room.phase, phaseWorkflow);
  const areaMainPhaseNorm = normalizeRoomPhase(activeArea?.phase ?? room.phase, phaseWorkflow);
  const workflowPhaseKeys = phaseKeys(phaseWorkflow);
  const lockOv = coercePhaseLockOverrides(
    activeArea?.phase_lock_overrides ?? room.phase_lock_overrides
  );
  const selPhase = normalizeRoomPhase(phaseTab, phaseWorkflow);
  const phaseWorkerLocked = phaseTabReadOnlyForWorker(
    areaMainPhaseNorm,
    selPhase,
    phaseWorkflow,
    lockOv,
    resolvedPhaseStatuses
  );
  const phaseReadOnly = !canEdit && phaseWorkerLocked;
  const phaseToolOverrides = coercePhaseToolOverrides(room.phase_tool_overrides);
  const phaseWfEntry = (k: string) => phaseWorkflow.find((p) => p.key === k);
  const toolsSel = resolvePhaseTools(phaseWfEntry(selPhase), phaseToolOverrides[selPhase]);
  const heatingCablePhasePrimaryDocs =
    toolsSel.heating_cable && isHeatingCablePhase(selPhase, phaseLabel(selPhase, phaseWorkflow));
  const tasksInArea = tasks.filter((t) => taskBelongsToArea(t.area_id, activeAreaId, primaryAreaId));
  const tasksForPhase = tasksInArea.filter((t) => storedChecklistPhase(t.phase, phaseWorkflow) === selPhase);
  const photosForPhase = photos.filter(
    (p) =>
      taskBelongsToArea(p.area_id, activeAreaId, primaryAreaId) &&
      photoMatchesPhase(p.phase, selPhase, phaseWorkflow) &&
      !(heatingCablePhasePrimaryDocs && parseHeatingCableStageFromCaption(p.caption))
  );
  const completedForPhase = tasksForPhase.filter((t) => t.is_completed).length;
  const totalForPhase = tasksForPhase.length;
  const completedTaskNamesForPhase = tasksForPhase.filter((t) => t.is_completed).map((t) => t.name);
  const canInteractChecklist = canCheckItem && !editsBlocked && !phaseReadOnly;
  const canResolveIssue = (canEdit || canInteractChecklist) && !editsBlocked;

  const handleMarkIssueResolved = async (id: string) => {
    if (!room || !canResolveIssue) return;
    const resolver = resolveWorkerActorLabel(displayName);
    if (!resolver.trim()) {
      toast.error('Set your name before resolving issues.');
      return;
    }
    const stamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const next = deviations.map((d) => {
      if (d.id !== id) return d;
      if (d.status === 'resolved') return d;
      return {
        ...d,
        status: 'resolved' as const,
        resolved_at: stamp,
        resolved_by: resolver,
      };
    });
    await persistWorkflowDeviations(next, 'Issue marked as resolved');
  };

  const handleReopenIssue = async (id: string) => {
    if (!room || !canEdit || editsBlocked) return;
    const next = deviations.map((d) => {
      if (d.id !== id) return d;
      return {
        ...d,
        status: 'open' as const,
        resolved_at: undefined,
        resolved_by: undefined,
      };
    });
    await persistWorkflowDeviations(next, 'Issue reopened');
  };

  const canMutateChecklist = canAddChecklistItem && !editsBlocked && !phaseReadOnly;
  const canMutatePhaseMedia = !editsBlocked && !phaseReadOnly;
  const chipUiSel = computePhaseChipUi(
    selPhase,
    resolvedPhaseStatuses,
    phaseWorkflow,
    lockOv,
    totalForPhase,
    completedForPhase,
    focusPhaseKey,
    toolsSel.checklist
  );
  const checklistLabelsMap = coerceChecklistLabels(room.checklist_labels);
  const checklistSectionTitle =
    checklistLabelsMap[selPhase]?.trim() || defaultChecklistTitle;
  const dueLine = formatDeadlineDisplay(room.deadline_at ?? null);
  const duePast = isDeadlinePast(room.deadline_at ?? null);
  const heatingDerived = deriveHeatingCableStatus(heatingCableDoc);
  const heatingLockedByAdmin = heatingCableDoc.locked_by_admin === true;
  const heatingStageGalleryById = new Map(
    buildHeatingCableGallerySections(heatingCableDoc, photos).map((sec) => [sec.stageId, sec.items])
  );
  const canEditHeatingCable =
    !editsBlocked && (!heatingLockedByAdmin || canEdit) && (canEdit || !phaseReadOnly);
  const selectedPhaseLabel = phaseLabel(selPhase, phaseWorkflow);
  const showHeatingCableModule = toolsSel.heating_cable;
  const selectedPhaseWorkReady =
    (!toolsSel.checklist || totalForPhase === 0 || completedForPhase === totalForPhase) &&
    (!toolsSel.heating_cable || heatingDerived.status === 'complete');
  const workerPhaseCompleteEligible =
    resolvedPhaseStatuses[selPhase] === 'in_progress' &&
    !editsBlocked &&
    !phaseReadOnly &&
    selectedPhaseWorkReady;

  const floorNavLabel =
    floor?.name?.trim()
      ? floor.name
      : floor?.floor_number != null
        ? `Floor ${floor.floor_number}`
        : 'Floor';

  // Use URL room id so prev/next match the route immediately after clicking Next/Prev; `room` lags until fetch completes.
  const navRoomIdNum = roomId != null && roomId !== '' ? Number(roomId) : NaN;
  const navRoomIdValid = Number.isFinite(navRoomIdNum);
  const roomOrderIdx = navRoomIdValid ? floorRoomsOrdered.findIndex((r) => r.id === navRoomIdNum) : -1;
  const prevNavRoom = roomOrderIdx > 0 ? floorRoomsOrdered[roomOrderIdx - 1] : null;
  const nextNavRoom =
    roomOrderIdx >= 0 && roomOrderIdx < floorRoomsOrdered.length - 1
      ? floorRoomsOrdered[roomOrderIdx + 1]
      : null;

  const prevNavUnavailableHint = prevNavRoom
    ? undefined
    : floorRoomsOrdered.length === 0
      ? 'Room list unavailable'
      : !navRoomIdValid || roomOrderIdx < 0
        ? 'Cannot determine position on this floor'
        : 'First room on this floor';
  const nextNavUnavailableHint = nextNavRoom
    ? undefined
    : floorRoomsOrdered.length === 0
      ? 'Room list unavailable'
      : !navRoomIdValid || roomOrderIdx < 0
        ? 'Cannot determine position on this floor'
        : 'Last room on this floor';

  return (
    <div className="min-h-dvh min-w-0 max-w-full bg-slate-50 dark:bg-background pb-8">
      <div className="mx-auto w-full min-w-0 max-w-lg space-y-4 py-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:py-4 lg:mx-0 lg:max-w-none lg:pl-6 lg:pr-6 xl:pl-8 xl:pr-8">
        {projectId && floorId ? (
          <RoomLocationNav
            projectId={projectId}
            projectName={typeof project?.name === 'string' ? project.name : ''}
            floorId={floorId}
            floorName={floorNavLabel}
            roomNumber={room.room_number}
            prevRoom={prevNavRoom}
            nextRoom={nextNavRoom}
            prevUnavailableHint={prevNavUnavailableHint}
            nextUnavailableHint={nextNavUnavailableHint}
          />
        ) : null}
        {!isAdmin ? (
          <>
            {(sectionVisibility.checklist || sectionVisibility.photos) && (
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhotoUpload}
              />
            )}
            <WorkerRoomView
              roomNumber={room.room_number}
              areaName={showAreasNav ? activeArea?.name ?? null : null}
              showAreasNav={showAreasNav}
              areasList={areasList.map((a) => ({ id: a.id, name: a.name }))}
              activeAreaId={activeAreaId}
              onAreaChange={setActiveAreaId}
              phaseWorkflow={phaseWorkflow}
              phaseStepStatuses={resolvedPhaseStatuses}
              roomPhasePointer={areaMainPhaseNorm}
              phaseLockOverrides={lockOv}
              boardPhaseKey={focusPhaseKey}
              inProgressPhaseKeys={inProgressKeys}
              selectedPhaseStepStatus={resolvedPhaseStatuses[selPhase] ?? 'not_started'}
              selectedPhaseKey={selPhase}
              onPhaseSelect={setPhaseTab}
              heatingDerived={heatingDerived}
              currentWorkerUserId={currentUserId}
              phaseReadOnly={phaseReadOnly}
              phaseTabLocked={phaseWorkerLocked}
              editsBlocked={editsBlocked}
              checklistSectionTitle={checklistSectionTitle}
              showChecklistSection={sectionVisibility.checklist && toolsSel.checklist}
              tasksForSelectedPhase={tasksForPhase}
              canInteractChecklist={canInteractChecklist}
              onTaskClick={handleTaskClick}
              showHeatingModule={showHeatingCableModule}
              heatingCableDoc={heatingCableDoc}
              canEditHeatingCable={canEditHeatingCable}
              heatingCableBlocking={heatingCableBlocking}
              heatingCableSaveStatus={heatingCableSaveUi}
              heatingCableAutosavePending={heatingCableAutosavePending}
              heatingCableDirty={heatingCableDirty}
              heatingCableManualSaveLabel={heatingCableManualSaveLabel}
              heatingLockedByAdmin={heatingLockedByAdmin}
              heatingPhotoInputRefs={heatingPhotoInputRefs}
              onHeatingFieldChange={updateHeatingStageField}
              onExtraHeatingFieldChange={updateExtraHeatingStepField}
              onHeatingStagePhotoChange={(stageId, file) => void handleHeatingStagePhotoInput(stageId, file)}
              onSaveHeatingCable={() => void saveHeatingCableDoc()}
              onCompleteHeatingStage={(stageKey) => void completeHeatingStage(stageKey)}
              onPhotoPreview={(url) => setShowPhotoPreview(url)}
              showPhotosSection={sectionVisibility.photos}
              canUploadPhoto={canUploadPhoto}
              canMutatePhaseMedia={canMutatePhaseMedia}
              uploadingPhoto={uploading}
              hideGenericPhasePhotoUpload={heatingCablePhasePrimaryDocs}
              resolvedRoomPhotos={photos}
              onGeneralPhotoClick={() => {
                fileInputRef.current?.click();
              }}
              photosForPhase={photosForPhase}
              legacySavedWorkerName={legacySavedWorkerName || undefined}
              onClearSavedWorkerName={legacySavedWorkerName ? handleClearSavedName : undefined}
              activityEntries={activityEntries}
              formatActivityWhen={formatActivityWhen}
              deviations={openDeviationsForPhase.map((d) => ({
                id: d.id,
                text: d.text,
                status: d.status,
                reported_by: d.reported_by,
              }))}
              resolvedDeviations={resolvedDeviationsForPhase.map((d) => ({
                id: d.id,
                text: d.text,
                status: d.status,
                reported_by: d.reported_by,
                resolved_at: d.resolved_at,
                resolved_by: d.resolved_by,
              }))}
              onResolveDeviation={(id) => void handleMarkIssueResolved(id)}
              canResolveIssue={canResolveIssue}
              formatResolvedAt={(s) => formatActivityWhen(parseTimestampMs(s))}
              newDeviationText={newDeviationText}
              onNewDeviationChange={setNewDeviationText}
              onAddDeviation={() => void handleAddDeviation()}
              canAddDeviation={canInteractChecklist && !editsBlocked}
              savingDeviations={savingDeviations}
              blockedReason={room.status === 'blocked' ? room.blocked_reason : null}
              dueLine={dueLine}
              duePast={duePast}
              phaseCompleteEligible={workerPhaseCompleteEligible}
              phaseExplicitWorkerLock={lockOv[selPhase] === true}
              onCompletePhase={() => handleWorkerPhaseComplete()}
              completingPhase={completingWorkerPhase}
              heatingDefaultPerformedBy={resolveWorkerActorLabel(displayName)}
              heatingCableSeedResetKey={room.id}
            />
          </>
        ) : (
          <>
        <Card className="border-border/45 bg-background/70 shadow-none p-2.5 sm:p-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-foreground tracking-tight leading-tight sm:text-[1.35rem]">
              {room.room_number}
            </h2>
            <p className="mt-2 text-xs text-muted-foreground/85 leading-snug">
              <span>{floor?.name || '—'}</span>
              <span className="text-muted-foreground/35 mx-1.5">·</span>
              {showAreasNav ? (
                <>
                  <span>{activeArea?.name ?? '—'}</span>
                  <span className="text-muted-foreground/35 mx-1.5">·</span>
                  <span>{phaseLabel(areaMainPhaseNorm, phaseWorkflow)}</span>
                </>
              ) : (
                <span>{phaseLabel(boardPhaseNorm, phaseWorkflow)}</span>
              )}
            </p>
            {dueLine ? (
              <p
                className={cn(
                  'mt-1.5 flex items-center gap-1 text-[11px] font-medium',
                  duePast ? 'text-red-700 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'
                )}
              >
                <Calendar className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                <span>Due {dueLine}</span>
                {duePast ? (
                  <span className="text-[10px] font-normal opacity-90">(overdue)</span>
                ) : null}
              </p>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-t border-border/25 pt-2.5">
            <div className="min-w-0" />
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

          {canEdit && !editsBlocked ? (
            <div className="mt-3 border-t border-border/25 pt-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-muted-foreground/80 shrink-0">{t('deadline')}</span>
                <Input
                  type="date"
                  value={deadlineDraft}
                  onChange={(e) => setDeadlineDraft(e.target.value)}
                  className="h-7 max-w-[11rem] text-[11px] border-border/40 bg-muted/15"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 text-[10px]"
                  disabled={savingDeadline}
                  onClick={() => void handleSaveDeadline()}
                >
                  {savingDeadline ? '…' : 'Apply'}
                </Button>
                {room.deadline_at ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px] text-muted-foreground"
                    disabled={savingDeadline}
                    onClick={() => void handleClearDeadline()}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {editsBlocked ? (
            <div className="mt-2 rounded-md border-l-2 border-muted-foreground/25 bg-muted/15 pl-2 pr-2 py-1 flex items-start gap-1.5">
              <Lock className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-[10px] text-muted-foreground leading-snug">
                Locked — view only unless you are an admin.
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
            <div className="mt-3 border-t border-border/30 pt-3">
              <Button
                variant="ghost"
                className="h-7 w-full text-[10px] text-muted-foreground/60 hover:text-destructive hover:bg-destructive/5"
                onClick={() => setShowDeleteRoomDialog(true)}
              >
                <Trash2 className="h-3 w-3 mr-1 opacity-70" />
                {t('delete')}
              </Button>
            </div>
          ) : null}
        </Card>

        {canEdit && !editsBlocked ? (
          <Card className="border-border/45 bg-background/70 shadow-none p-2.5 sm:p-3">
            <p className="text-[11px] font-semibold text-foreground">Phase tools (this room)</p>
            <p className="text-[10px] text-muted-foreground mt-1 mb-2 leading-snug">
              Per-phase checklist and heating cable visibility for workers. Project defaults apply unless you override
              here; hiding a tool does not remove saved data.
            </p>
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {phaseWorkflow.map((pe) => {
                const eff = resolvePhaseTools(pe, phaseToolOverrides[pe.key]);
                return (
                  <div
                    key={pe.key}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/35 pb-2 last:border-0 last:pb-0"
                  >
                    <span className="text-[11px] font-medium text-foreground w-full sm:w-36 shrink-0">
                      {phaseLabel(pe.key, phaseWorkflow)}
                    </span>
                    <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-input"
                        checked={eff.checklist}
                        disabled={phaseToolsSaving}
                        onChange={(e) => void persistPhaseToolToggle(pe.key, { checklist: e.target.checked })}
                      />
                      Checklist
                    </label>
                    <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-input"
                        checked={eff.heating_cable}
                        disabled={phaseToolsSaving}
                        onChange={(e) =>
                          void persistPhaseToolToggle(pe.key, { heating_cable: e.target.checked })
                        }
                      />
                      Heating cable
                    </label>
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}

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

            {canMovePhase ? (
              <div className="rounded-lg border border-border/55 bg-muted/12 px-2.5 py-2.5 space-y-2.5 dark:bg-muted/10">
                <p className="text-[10px] text-muted-foreground leading-snug">
                  The <span className="font-medium text-foreground/85">amber</span> tab matches the floor board. Phase
                  tabs below stay in workflow order — you are selecting which phase to work in.
                </p>
                <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
                  <span className="text-[10px] font-medium text-muted-foreground/85 shrink-0 sm:min-w-[5.5rem]">
                    Board phase
                  </span>
                  <Select value={boardPhaseNorm} onValueChange={handleSetMainPhase} disabled={editsBlocked}>
                    <SelectTrigger className="h-7 flex-1 min-w-[8rem] max-w-xs text-[11px] border-border/45 bg-background/80 text-foreground/90">
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
                {multiArea && activeAreaId !== primaryAreaId ? (
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
                    <span className="text-[10px] font-medium text-muted-foreground/85 shrink-0 sm:min-w-[5.5rem]">
                      Area phase
                    </span>
                    <Select
                      value={areaMainPhaseNorm}
                      onValueChange={handleSetActiveAreaWorkflowPhase}
                      disabled={editsBlocked}
                    >
                      <SelectTrigger className="h-7 flex-1 min-w-[8rem] max-w-xs text-[11px] border-border/45 bg-background/80 text-foreground/90">
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
                <div className="flex flex-col gap-1.5 border-t border-border/35 pt-2.5 mt-2">
                  <span className="text-[10px] font-medium text-muted-foreground/85">
                    Workflow step status
                  </span>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Several steps may be <span className="font-medium text-foreground/90">In progress</span> together.
                    The board-phase control above keeps a simple linear progression when you need it.
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {workflowPhaseKeys.map((k) => (
                      <div key={k} className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                        <span className="text-[10px] text-muted-foreground truncate sm:min-w-[5rem] sm:max-w-[8rem]">
                          {phaseLabel(k, phaseWorkflow)}
                        </span>
                        <Select
                          value={resolvedPhaseStatuses[k] ?? 'not_started'}
                          onValueChange={(v) => void handlePhaseStepStatusChange(k, v as PhaseStepStatus)}
                          disabled={editsBlocked}
                        >
                          <SelectTrigger className="h-7 w-full sm:max-w-[9rem] text-[10px] border-border/45 bg-background/80">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="not_started">Not started</SelectItem>
                            <SelectItem value="in_progress">In progress</SelectItem>
                            <SelectItem value="complete">Complete</SelectItem>
                            <SelectItem value="blocked">Blocked</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
                {canEdit && !persistedAreas ? (
                  <div className="pt-1 border-t border-border/35">
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      disabled={editsBlocked}
                      onClick={() => setShowManageAreas(true)}
                    >
                      Use multiple areas
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {showAreasNav ? (
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2 px-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/90">Areas</span>
                </div>
                <div className="-mx-1 flex flex-wrap items-stretch gap-2 px-1 py-0.5">
                  <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto snap-x snap-mandatory pb-0.5">
                    {areasList.map((a) => {
                      const isSel = a.id === activeAreaId;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setActiveAreaId(a.id)}
                          className={cn(
                            'snap-start shrink-0 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors',
                            isSel
                              ? 'border-[#1E3A5F] bg-[#1E3A5F]/8 text-foreground shadow-sm dark:border-blue-400 dark:bg-blue-950/35'
                              : 'border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40'
                          )}
                        >
                          {a.name}
                        </button>
                      );
                    })}
                  </div>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 self-center text-[10px] border-dashed border-border/60"
                      disabled={editsBlocked}
                      onClick={() => setShowManageAreas(true)}
                    >
                      Manage
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="-mx-1 flex gap-2.5 overflow-x-auto py-3 px-1 snap-x snap-mandatory sm:py-3.5">
              {workflowPhaseKeys.map((key) => {
                const tks = tasksInArea.filter((t) => storedChecklistPhase(t.phase, phaseWorkflow) === key);
                const done = tks.filter((x) => x.is_completed).length;
                const tot = tks.length;
                const chipTools = resolvePhaseTools(phaseWfEntry(key), phaseToolOverrides[key]);
                const ui = computePhaseChipUi(
                  key,
                  resolvedPhaseStatuses,
                  phaseWorkflow,
                  lockOv,
                  tot,
                  done,
                  focusPhaseKey,
                  chipTools.checklist
                );
                const isSel = key === selPhase;
                const tabLockedForWorkers = phaseTabReadOnlyForWorker(
                  areaMainPhaseNorm,
                  key,
                  phaseWorkflow,
                  lockOv,
                  resolvedPhaseStatuses
                );
                const phaseAssignments = coercePhaseAssignedWorkerIds(room.phase_assigned_worker_ids);
                const assignedWorkerId = phaseAssignments[key];
                const assignedWorker = projectWorkers.find((w) => w.id === assignedWorkerId);
                return (
                  <div
                    key={key}
                    className={cn(
                      'snap-start relative min-w-[7.75rem] max-w-[10rem] sm:min-w-[8.75rem]',
                      isSel &&
                        'rounded-lg ring-2 ring-[#1E3A5F] ring-offset-2 ring-offset-slate-50 shadow-sm dark:ring-blue-400 dark:ring-offset-background'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setPhaseTab(key)}
                      className={cn(
                        'flex h-full w-full flex-col rounded-lg border px-2 py-2 pr-7 text-left text-xs transition-shadow',
                        ui.isMain &&
                          'border-amber-400/80 bg-amber-50/95 dark:border-amber-600 dark:bg-amber-950/50',
                        !ui.isMain && ui.status === 'Completed' &&
                          'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30',
                        !ui.isMain && ui.status === 'Locked' &&
                          'border-slate-300 bg-slate-100/80 dark:border-slate-600 dark:bg-slate-900/50',
                        !ui.isMain && ui.status === 'Not started' &&
                          'border-dashed border-slate-200 bg-muted/30 dark:border-slate-700',
                        !ui.isMain && ui.status === 'Open' &&
                          'border-slate-200 bg-background dark:border-slate-700',
                        !ui.isMain && ui.status === 'Blocked' &&
                          'border-orange-300 bg-orange-50/80 dark:border-orange-900 dark:bg-orange-950/40'
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
                      {assignedWorker ? (
                        <span className="mt-1 text-[10px] text-slate-600 dark:text-slate-300 truncate">
                          {assignedWorker.name}
                        </span>
                      ) : null}
                    </button>
                    {canEdit && !editsBlocked ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              'absolute top-1 right-1 z-10 rounded-md border p-1 shadow-sm transition-colors',
                              tabLockedForWorkers
                                ? 'border-amber-200/80 bg-amber-50/95 hover:bg-amber-100/90 dark:border-amber-800 dark:bg-amber-950/60'
                                : 'border-border/50 bg-background/95 hover:bg-muted/70 dark:bg-background/90'
                            )}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            aria-label={`Phase actions for ${phaseLabel(key, phaseWorkflow)}`}
                          >
                            <EllipsisVertical className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuLabel>Assign worker</DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => void handleAssignPhaseWorker(key, null)}
                            disabled={assigningPhaseKey === key}
                          >
                            Unassigned
                          </DropdownMenuItem>
                          {projectWorkers.map((worker) => (
                            <DropdownMenuItem
                              key={worker.id}
                              onClick={() => void handleAssignPhaseWorker(key, worker.id)}
                              disabled={assigningPhaseKey === key}
                            >
                              {worker.name}
                              {assignedWorkerId === worker.id ? ' (current)' : ''}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => void handleTogglePhaseWorkerLock(key)}>
                            {tabLockedForWorkers ? 'Open for workers' : 'Lock for workers'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {selPhase !== areaMainPhaseNorm ? (
              <div className="flex flex-col gap-1.5 rounded-md border border-amber-200/70 bg-amber-50/70 px-2.5 py-2 dark:border-amber-900/45 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-amber-950 dark:text-amber-100 leading-snug">
                  Viewing <span className="font-medium">{phaseLabel(selPhase, phaseWorkflow)}</span> — board phase is{' '}
                  <span className="font-medium">{phaseLabel(areaMainPhaseNorm, phaseWorkflow)}</span>.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 shrink-0 text-xs border-amber-200/80 bg-white/90 hover:bg-amber-100/80 dark:border-amber-800 dark:bg-amber-950 dark:hover:bg-amber-900"
                  onClick={() => setPhaseTab(areaMainPhaseNorm)}
                >
                  Go to board phase
                </Button>
              </div>
            ) : null}

            {selPhase !== areaMainPhaseNorm && !phaseReadOnly ? (
              <p className="text-[11px] text-muted-foreground rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 leading-snug">
                Not the board phase tab, but still open for editing if your role allows it.
              </p>
            ) : null}

            {phaseReadOnly ? (
              <Card className="overflow-hidden border-slate-300/70 bg-slate-50/90 shadow-none ring-1 ring-slate-200/80 dark:border-slate-600 dark:bg-slate-900/45 dark:ring-slate-700/80">
                <div className="border-b border-border/45 bg-muted/[0.35] px-3 py-2.5 sm:px-3.5">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 rounded-md border border-slate-300/80 bg-background/90 p-1.5 dark:border-slate-600">
                      <Lock className="h-4 w-4 text-slate-600 dark:text-slate-300" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{selectedPhaseLabel}</h3>
                        <Badge
                          variant="secondary"
                          className="text-[10px] font-medium border-slate-300/80 bg-white/90 text-slate-800 dark:border-slate-600 dark:bg-slate-950/60 dark:text-slate-100"
                        >
                          {chipUiSel.workerLocked ? 'Locked — view only' : 'Read-only'}
                        </Badge>
                        {chipUiSel.status !== 'Active' ? (
                          <span className="text-[10px] font-medium text-muted-foreground">{chipUiSel.status}</span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        This phase is closed for editing on your account. Historical work stays visible below.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="space-y-2 px-3 py-2.5 sm:px-3.5 text-[11px] leading-snug">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {toolsSel.checklist ? (
                    <span className="text-muted-foreground">
                      Checklist:{' '}
                      <span className="font-medium text-foreground tabular-nums">
                        {completedForPhase}/{totalForPhase}
                      </span>{' '}
                      done
                    </span>
                    ) : null}
                    {sectionVisibility.photos ? (
                      <span className="text-muted-foreground">
                        Photos:{' '}
                        <span className="font-medium text-foreground tabular-nums">{photosForPhase.length}</span>
                      </span>
                    ) : null}
                    {showHeatingCableModule ? (
                      <span className="text-muted-foreground">
                        Cable docs:{' '}
                        <span className="font-medium text-foreground">{HEATING_CABLE_DERIVED_STATUS_LABEL[heatingDerived.status]}</span>
                      </span>
                    ) : null}
                  </div>
                  {toolsSel.checklist && completedTaskNamesForPhase.length > 0 ? (
                    <div className="rounded-md border border-border/50 bg-background/60 px-2 py-1.5 dark:bg-background/40">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/90">
                        Completed items
                      </p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-foreground/90">
                        {tasksForPhase
                          .filter((t) => t.is_completed)
                          .slice(0, 8)
                          .map((task) => (
                            <li key={task.id}>{task.name}</li>
                          ))}
                      </ul>
                      {completedTaskNamesForPhase.length > 8 ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          +{completedTaskNamesForPhase.length - 8} more
                        </p>
                      ) : null}
                    </div>
                  ) : toolsSel.checklist && totalForPhase > 0 ? (
                    <p className="text-[11px] text-muted-foreground">No checklist items marked complete in this phase.</p>
                  ) : null}
                  <p className="border-t border-border/35 pt-2 text-[10px] text-muted-foreground leading-relaxed">
                    Unlocking, workflow moves, and corrections require an <span className="font-medium text-foreground/90">Admin</span>{' '}
                    — contact them if something needs to change here.
                  </p>
                </div>
              </Card>
            ) : null}

            <div className="flex flex-col gap-4">
                  {showHeatingCableModule ? (
                  <div className={cn('min-w-0', phaseReadOnly ? 'order-2' : 'order-1')}>
                  {phaseReadOnly ? (
                  <Card className="overflow-hidden border-border/55 bg-card shadow-none ring-1 ring-border/40 dark:ring-border/50">
                    <div className="border-b border-border/45 bg-muted/[0.35] dark:bg-muted/20 px-2 py-2 sm:px-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
                          Heating cable documentation
                        </h3>
                        <Badge variant="secondary" className="text-[10px]">
                          {HEATING_CABLE_DERIVED_STATUS_LABEL[heatingDerived.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                        Recorded measurements and module photos — view only for your role.
                      </p>
                    </div>
                    <div className="p-2 space-y-3">
                      {HEATING_CABLE_STAGES.map((stage) => {
                        const row = heatingCableDoc[stage.key] || {};
                        const completedBy = row.completed_by_name?.trim() || row.completed_by?.trim() || row.performed_by?.trim() || '';
                        const completedAt = row.completed_at?.trim() || '';
                        const stagePhotos = heatingStageGalleryById.get(stage.key) || [];
                        const has =
                          heatingStageHasAnyData(row) ||
                          Boolean(completedAt) ||
                          Boolean(completedBy) ||
                          stagePhotos.length > 0;
                        return (
                          <div key={stage.key} className="rounded-md border border-border/50 p-2 space-y-2">
                            <p className="text-xs font-semibold text-foreground">{stage.label}</p>
                            {!has ? (
                              <p className="text-[11px] text-muted-foreground">No measurements or photos recorded.</p>
                            ) : (
                              <>
                                <div className="space-y-1.5 text-[11px] leading-snug">
                                  {completedAt ? (
                                    <p>
                                      <span className="text-muted-foreground">Completed at: </span>
                                      <span className="text-foreground">{formatHeatingCableDateTimeReadable(completedAt)}</span>
                                    </p>
                                  ) : null}
                                  {completedBy ? (
                                    <p>
                                      <span className="text-muted-foreground">Completed by: </span>
                                      <span className="text-foreground">{completedBy}</span>
                                    </p>
                                  ) : null}
                                  {row.resistance_ohm ? (
                                    <p>
                                      <span className="text-muted-foreground">Resistance: </span>
                                      <span className="text-foreground">{row.resistance_ohm} Ω</span>
                                    </p>
                                  ) : null}
                                  {row.insulation_mohm ? (
                                    <p>
                                      <span className="text-muted-foreground">Insulation: </span>
                                      <span className="text-foreground">{row.insulation_mohm} MΩ</span>
                                    </p>
                                  ) : null}
                                  {row.date ? (
                                    <p>
                                      <span className="text-muted-foreground">Date: </span>
                                      <span className="text-foreground">{formatHeatingCableDateTimeReadable(row.date)}</span>
                                    </p>
                                  ) : null}
                                  {row.performed_by ? (
                                    <p>
                                      <span className="text-muted-foreground">Performed by: </span>
                                      <span className="text-foreground">{row.performed_by}</span>
                                    </p>
                                  ) : null}
                                </div>
                                {row.note ? (
                                  <p className="text-[11px] text-foreground/90 whitespace-pre-wrap leading-snug rounded-md bg-muted/25 px-2 py-1.5">
                                    {row.note}
                                  </p>
                                ) : null}
                                {stagePhotos.length > 0 ? (
                                  <div className="grid grid-cols-3 gap-2">
                                    {stagePhotos.map((item, pi) => {
                                      const src = item.displayUrl || resolveHeatingCablePhotoDownloadUrl(item.objectKey, photos);
                                      return (
                                      <button
                                        key={`${stage.key}-p-${pi}`}
                                        type="button"
                                        className="relative aspect-square overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
                                        onClick={() => src && setShowPhotoPreview(src)}
                                      >
                                        <ImageWithFallback
                                          src={src}
                                          alt=""
                                          className="h-full w-full object-cover"
                                        />
                                      </button>
                                    );})}
                                  </div>
                                ) : null}
                              </>
                            )}
                          </div>
                        );
                      })}
                      {(heatingCableDoc.extra_steps || []).map((step, idx) => {
                        const sid = step.id || `extra-${idx}`;
                        const completedBy =
                          step.completed_by_name?.trim() || step.completed_by?.trim() || step.performed_by?.trim() || '';
                        const completedAt = step.completed_at?.trim() || '';
                        const stagePhotos = heatingStageGalleryById.get(sid) || [];
                        const has =
                          heatingStageHasAnyData(step) ||
                          Boolean(completedAt) ||
                          Boolean(completedBy) ||
                          stagePhotos.length > 0;
                        return (
                          <div key={sid} className="rounded-md border border-border/50 p-2 space-y-2">
                            <p className="text-xs font-semibold text-foreground">
                              {step.label?.trim() ? step.label : `Extra step ${idx + 1}`}
                            </p>
                            {!has ? (
                              <p className="text-[11px] text-muted-foreground">No measurements or photos recorded.</p>
                            ) : (
                              <>
                                <div className="space-y-1.5 text-[11px] leading-snug">
                                  {completedAt ? (
                                    <p>
                                      <span className="text-muted-foreground">Completed at: </span>
                                      <span className="text-foreground">{formatHeatingCableDateTimeReadable(completedAt)}</span>
                                    </p>
                                  ) : null}
                                  {completedBy ? (
                                    <p>
                                      <span className="text-muted-foreground">Completed by: </span>
                                      <span className="text-foreground">{completedBy}</span>
                                    </p>
                                  ) : null}
                                  {step.resistance_ohm ? (
                                    <p>
                                      <span className="text-muted-foreground">Resistance: </span>
                                      <span className="text-foreground">{step.resistance_ohm} Ω</span>
                                    </p>
                                  ) : null}
                                  {step.insulation_mohm ? (
                                    <p>
                                      <span className="text-muted-foreground">Insulation: </span>
                                      <span className="text-foreground">{step.insulation_mohm} MΩ</span>
                                    </p>
                                  ) : null}
                                  {step.date ? (
                                    <p>
                                      <span className="text-muted-foreground">Date: </span>
                                      <span className="text-foreground">{formatHeatingCableDateTimeReadable(step.date)}</span>
                                    </p>
                                  ) : null}
                                  {step.performed_by ? (
                                    <p>
                                      <span className="text-muted-foreground">Performed by: </span>
                                      <span className="text-foreground">{step.performed_by}</span>
                                    </p>
                                  ) : null}
                                </div>
                                {step.note ? (
                                  <p className="text-[11px] text-foreground/90 whitespace-pre-wrap leading-snug rounded-md bg-muted/25 px-2 py-1.5">
                                    {step.note}
                                  </p>
                                ) : null}
                                {stagePhotos.length > 0 ? (
                                  <div className="grid grid-cols-3 gap-2">
                                    {stagePhotos.map((item, pi) => {
                                      const src = item.displayUrl || resolveHeatingCablePhotoDownloadUrl(item.objectKey, photos);
                                      return (
                                      <button
                                        key={`${sid}-p-${pi}`}
                                        type="button"
                                        className="relative aspect-square overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
                                        onClick={() => src && setShowPhotoPreview(src)}
                                      >
                                        <ImageWithFallback src={src} alt="" className="h-full w-full object-cover" />
                                      </button>
                                    );})}
                                  </div>
                                ) : null}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                  ) : (
                  <Card className="overflow-hidden border-border/55 bg-card shadow-none ring-1 ring-border/40 dark:ring-border/50">
                    <div className="border-b border-border/45 bg-muted/[0.35] dark:bg-muted/20 px-2 py-2 sm:px-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
                          Heating Cable Documentation
                        </h3>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px]">
                            {HEATING_CABLE_DERIVED_STATUS_LABEL[heatingDerived.status]}
                          </Badge>
                          {canEdit ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 text-[10px]"
                              onClick={() => void toggleHeatingCableLock()}
                              disabled={heatingCableBlocking}
                            >
                              {heatingLockedByAdmin ? 'Unlock' : 'Lock'}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                        Fill all three measurement stages for complete documentation.
                      </p>
                      {canEditHeatingCable && !heatingLockedByAdmin ? (
                        <p
                          className={cn(
                            'mt-1 text-[11px] font-medium tabular-nums',
                            heatingCableSaveBusy && 'text-muted-foreground',
                            heatingCableSaveUi === 'saved' && 'text-emerald-700 dark:text-emerald-400',
                            heatingCableSaveUi === 'error' && 'text-destructive',
                            !heatingCableSaveBusy && heatingCableSaveUi === 'idle' && 'text-muted-foreground/70'
                          )}
                          aria-live="polite"
                        >
                          {heatingCableSaveBusy
                            ? 'Saving'
                            : heatingCableSaveUi === 'saved'
                              ? 'Saved'
                              : heatingCableSaveUi === 'error'
                                ? 'Failed'
                                : !heatingCableDirty
                                  ? heatingDerived.status === 'complete'
                                    ? 'Documentation complete'
                                    : 'All changes saved'
                                  : null}
                        </p>
                      ) : null}
                      {heatingLockedByAdmin ? (
                        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400 leading-snug">
                          Locked by admin. Workers can view, admins can still correct.
                        </p>
                      ) : null}
                    </div>
                    <div className="p-2 space-y-3">
                      {HEATING_CABLE_STAGES.map((stage) => {
                        const row = heatingCableDoc[stage.key] || {};
                        const completedBy =
                          row.completed_by_name?.trim() || row.completed_by?.trim() || row.performed_by?.trim() || '';
                        const completedAt = row.completed_at?.trim() || '';
                        const stagePhotos = heatingStageGalleryById.get(stage.key) || [];
                        return (
                          <div key={stage.key} className="rounded-md border border-border/50 p-2 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-foreground">{stage.label}</p>
                              {canEdit && heatingStageIsLocked(row) ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[10px] shrink-0"
                                  disabled={heatingCableBlocking}
                                  onClick={() => void unlockHeatingCableStage(stage.key)}
                                >
                                  Unlock step
                                </Button>
                              ) : null}
                            </div>
                            {(completedAt || completedBy) && (
                              <div className="space-y-1 text-[11px] leading-snug">
                                {completedAt ? (
                                  <p>
                                    <span className="text-muted-foreground">Completed at: </span>
                                    <span className="text-foreground">{formatHeatingCableDateTimeReadable(completedAt)}</span>
                                  </p>
                                ) : null}
                                {completedBy ? (
                                  <p>
                                    <span className="text-muted-foreground">Completed by: </span>
                                    <span className="text-foreground">{completedBy}</span>
                                  </p>
                                ) : null}
                              </div>
                            )}
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div className="space-y-1.5">
                                <Label
                                  htmlFor={`hc-room-${stage.key}-r`}
                                  className="text-xs font-medium leading-snug text-foreground sm:text-[13px]"
                                >
                                  Resistance{' '}
                                  <span className="font-normal text-muted-foreground">(Ω)</span>
                                </Label>
                                <Input
                                  id={`hc-room-${stage.key}-r`}
                                  type="number"
                                  inputMode="decimal"
                                  step="any"
                                  value={row.resistance_ohm || ''}
                                  disabled={!canEditHeatingCable || heatingCableBlocking}
                                  aria-label="Resistance (Ω)"
                                  onChange={(e) =>
                                    updateHeatingStageField(stage.key, 'resistance_ohm', e.target.value)
                                  }
                                  className="h-9 sm:h-8 text-base sm:text-xs"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label
                                  htmlFor={`hc-room-${stage.key}-i`}
                                  className="text-xs font-medium leading-snug text-foreground sm:text-[13px]"
                                >
                                  Insulation{' '}
                                  <span className="font-normal text-muted-foreground">(MΩ)</span>
                                </Label>
                                <Input
                                  id={`hc-room-${stage.key}-i`}
                                  type="number"
                                  inputMode="decimal"
                                  step="any"
                                  value={row.insulation_mohm || ''}
                                  disabled={!canEditHeatingCable || heatingCableBlocking}
                                  aria-label="Insulation (MΩ)"
                                  onChange={(e) =>
                                    updateHeatingStageField(stage.key, 'insulation_mohm', e.target.value)
                                  }
                                  className="h-9 sm:h-8 text-base sm:text-xs"
                                />
                              </div>
                              <Input
                                type="date"
                                value={heatingCableDateForDateInput(row.date)}
                                disabled={!canEditHeatingCable || heatingCableBlocking}
                                onChange={(e) => updateHeatingStageField(stage.key, 'date', e.target.value)}
                                className="h-9 sm:h-8 text-base sm:text-xs sm:col-span-2"
                              />
                            </div>
                            <Textarea
                              placeholder="Optional note / deviation"
                              value={row.note || ''}
                              disabled={!canEditHeatingCable || heatingCableBlocking}
                              onChange={(e) => updateHeatingStageField(stage.key, 'note', e.target.value)}
                              rows={2}
                              className="text-base sm:text-xs"
                            />
                            {stagePhotos.length > 0 ? (
                              <div className="space-y-1.5">
                                <p className="text-[10px] text-muted-foreground">Stage photos</p>
                                <div className="grid grid-cols-3 gap-2">
                                  {stagePhotos.map((item, pi) => {
                                    const src =
                                      item.displayUrl || resolveHeatingCablePhotoDownloadUrl(item.objectKey, photos);
                                    if (!src) return null;
                                    return (
                                      <button
                                        key={`${stage.key}-editable-p-${pi}`}
                                        type="button"
                                        className="relative aspect-square overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
                                        onClick={() => setShowPhotoPreview(src)}
                                      >
                                        <ImageWithFallback src={src} alt="" className="h-full w-full object-cover" />
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                              <input
                                ref={(el) => {
                                  heatingPhotoInputRefs.current[`${stage.key}:gallery`] = el;
                                }}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => void handleHeatingStagePhotoInput(stage.key, e.target.files?.[0])}
                              />
                              <input
                                ref={(el) => {
                                  heatingPhotoInputRefs.current[`${stage.key}:camera`] = el;
                                }}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={(e) => void handleHeatingStagePhotoInput(stage.key, e.target.files?.[0])}
                              />
                              <div className="flex flex-1 flex-wrap gap-1.5 min-w-0">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[10px] shrink-0"
                                  disabled={!canEditHeatingCable || heatingCableBlocking}
                                  onClick={() => heatingPhotoInputRefs.current[`${stage.key}:camera`]?.click()}
                                >
                                  Take photo
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[10px] shrink-0"
                                  disabled={!canEditHeatingCable || heatingCableBlocking}
                                  onClick={() => heatingPhotoInputRefs.current[`${stage.key}:gallery`]?.click()}
                                >
                                  Gallery
                                </Button>
                              </div>
                              <span className="text-[10px] text-muted-foreground sm:ml-auto">
                                {Array.isArray(row.photos) ? row.photos.length : 0} stage photo
                                {Array.isArray(row.photos) && row.photos.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {(heatingCableDoc.extra_steps || []).map((step, idx) => {
                        const sid = step.id || `extra-${idx}`;
                        const completedBy =
                          step.completed_by_name?.trim() || step.completed_by?.trim() || step.performed_by?.trim() || '';
                        const completedAt = step.completed_at?.trim() || '';
                        const stagePhotos = heatingStageGalleryById.get(sid) || [];
                        return (
                          <div key={sid} className="rounded-md border border-border/50 p-2 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <Input
                                placeholder="Extra step name (e.g. Before connecting thermostat)"
                                value={step.label || ''}
                                disabled={!canEditHeatingCable || heatingCableBlocking}
                                onChange={(e) => updateExtraHeatingStepField(idx, 'label', e.target.value)}
                                className="h-9 sm:h-8 text-base sm:text-xs"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 text-[10px]"
                                disabled={!canEditHeatingCable || heatingCableBlocking}
                                onClick={() => removeExtraHeatingStep(idx)}
                              >
                                Remove
                              </Button>
                            </div>
                            {(completedAt || completedBy) && (
                              <div className="space-y-1 text-[11px] leading-snug">
                                {completedAt ? (
                                  <p>
                                    <span className="text-muted-foreground">Completed at: </span>
                                    <span className="text-foreground">{formatHeatingCableDateTimeReadable(completedAt)}</span>
                                  </p>
                                ) : null}
                                {completedBy ? (
                                  <p>
                                    <span className="text-muted-foreground">Completed by: </span>
                                    <span className="text-foreground">{completedBy}</span>
                                  </p>
                                ) : null}
                              </div>
                            )}
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div className="space-y-1.5">
                                <Label
                                  htmlFor={`hc-room-extra-${idx}-r`}
                                  className="text-xs font-medium leading-snug text-foreground sm:text-[13px]"
                                >
                                  Resistance{' '}
                                  <span className="font-normal text-muted-foreground">(Ω)</span>
                                </Label>
                                <Input
                                  id={`hc-room-extra-${idx}-r`}
                                  type="number"
                                  inputMode="decimal"
                                  step="any"
                                  value={step.resistance_ohm || ''}
                                  disabled={!canEditHeatingCable || heatingCableBlocking}
                                  aria-label="Resistance (Ω)"
                                  onChange={(e) => updateExtraHeatingStepField(idx, 'resistance_ohm', e.target.value)}
                                  className="h-9 sm:h-8 text-base sm:text-xs"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label
                                  htmlFor={`hc-room-extra-${idx}-i`}
                                  className="text-xs font-medium leading-snug text-foreground sm:text-[13px]"
                                >
                                  Insulation{' '}
                                  <span className="font-normal text-muted-foreground">(MΩ)</span>
                                </Label>
                                <Input
                                  id={`hc-room-extra-${idx}-i`}
                                  type="number"
                                  inputMode="decimal"
                                  step="any"
                                  value={step.insulation_mohm || ''}
                                  disabled={!canEditHeatingCable || heatingCableBlocking}
                                  aria-label="Insulation (MΩ)"
                                  onChange={(e) => updateExtraHeatingStepField(idx, 'insulation_mohm', e.target.value)}
                                  className="h-9 sm:h-8 text-base sm:text-xs"
                                />
                              </div>
                              <Input
                                type="date"
                                value={heatingCableDateForDateInput(step.date)}
                                disabled={!canEditHeatingCable || heatingCableBlocking}
                                onChange={(e) => updateExtraHeatingStepField(idx, 'date', e.target.value)}
                                className="h-9 sm:h-8 text-base sm:text-xs sm:col-span-2"
                              />
                            </div>
                            <Textarea
                              placeholder="Optional note / deviation"
                              value={step.note || ''}
                              disabled={!canEditHeatingCable || heatingCableBlocking}
                              onChange={(e) => updateExtraHeatingStepField(idx, 'note', e.target.value)}
                              rows={2}
                              className="text-base sm:text-xs"
                            />
                            {stagePhotos.length > 0 ? (
                              <div className="space-y-1.5">
                                <p className="text-[10px] text-muted-foreground">Stage photos</p>
                                <div className="grid grid-cols-3 gap-2">
                                  {stagePhotos.map((item, pi) => {
                                    const src =
                                      item.displayUrl || resolveHeatingCablePhotoDownloadUrl(item.objectKey, photos);
                                    if (!src) return null;
                                    return (
                                      <button
                                        key={`${sid}-editable-p-${pi}`}
                                        type="button"
                                        className="relative aspect-square overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
                                        onClick={() => setShowPhotoPreview(src)}
                                      >
                                        <ImageWithFallback src={src} alt="" className="h-full w-full object-cover" />
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                              <input
                                ref={(el) => {
                                  heatingPhotoInputRefs.current[`${sid}:gallery`] = el;
                                }}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => void handleHeatingStagePhotoInput(sid, e.target.files?.[0])}
                              />
                              <input
                                ref={(el) => {
                                  heatingPhotoInputRefs.current[`${sid}:camera`] = el;
                                }}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={(e) => void handleHeatingStagePhotoInput(sid, e.target.files?.[0])}
                              />
                              <div className="flex flex-1 flex-wrap gap-1.5 min-w-0">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[10px] shrink-0"
                                  disabled={!canEditHeatingCable || heatingCableBlocking}
                                  onClick={() => heatingPhotoInputRefs.current[`${sid}:camera`]?.click()}
                                >
                                  Take photo
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[10px] shrink-0"
                                  disabled={!canEditHeatingCable || heatingCableBlocking}
                                  onClick={() => heatingPhotoInputRefs.current[`${sid}:gallery`]?.click()}
                                >
                                  Gallery
                                </Button>
                              </div>
                              <span className="text-[10px] text-muted-foreground sm:ml-auto">
                                {Array.isArray(step.photos) ? step.photos.length : 0} stage photo
                                {Array.isArray(step.photos) && step.photos.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 sm:h-8 text-base sm:text-xs"
                          onClick={addExtraHeatingStep}
                          disabled={!canEditHeatingCable || heatingCableBlocking}
                        >
                          Add extra step
                        </Button>
                        <p className="text-[11px] text-muted-foreground">
                          Missing stages:{' '}
                          {heatingDerived.missingStages.length > 0
                            ? heatingDerived.missingStages
                                .map((k) => HEATING_CABLE_STAGES.find((s) => s.key === k)?.label || k)
                                .join(', ')
                            : 'None'}
                        </p>
                        {canEditHeatingCable &&
                        !heatingLockedByAdmin &&
                        !phaseReadOnly &&
                        ((heatingCableDirty && !heatingCableSaveBusy) ||
                          heatingCableSaveUi === 'error') ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 sm:h-7 text-[11px] text-muted-foreground hover:text-foreground px-2"
                            onClick={() => void saveHeatingCableDoc()}
                            disabled={
                              !canEditHeatingCable || heatingCableBlocking || heatingCableSaveBusy
                            }
                          >
                            {heatingCableSaveUi === 'error' ? 'Retry save' : heatingCableManualSaveLabel}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </Card>
                  )}
                  </div>
                  ) : null}

                  {sectionVisibility.checklist && (
                    <div
                      className={cn(
                        'min-w-0',
                        phaseReadOnly ? 'order-3' : 'order-2'
                      )}
                    >
                    {phaseReadOnly ? (
                    <Card className="overflow-hidden border-border/55 bg-card shadow-none ring-1 ring-border/40 dark:ring-border/50">
                      <div className="border-b border-border/45 bg-muted/[0.35] dark:bg-muted/20 px-2 py-1.5 sm:px-2.5 sm:py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 pt-0.5">
                            <h3 className="text-[15px] font-semibold tracking-tight text-foreground flex flex-wrap items-center gap-1.5">
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 opacity-85" />
                              <span className="min-w-0">{checklistSectionTitle}</span>
                            </h3>
                            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/75">
                              <span className="text-muted-foreground">{phaseLabel(selPhase, phaseWorkflow)}</span>
                              <span className="text-muted-foreground/85"> · checklist history — view only</span>
                            </p>
                          </div>
                          <span
                            className="text-base font-semibold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-300 shrink-0"
                            title={`${completedForPhase} of ${totalForPhase} complete`}
                          >
                            {completedForPhase}/{totalForPhase}
                          </span>
                        </div>
                      </div>
                      <div className="p-1.5 sm:p-2 pt-1.5">
                        <div className="divide-y divide-border/50 rounded-md border border-border/50 bg-background dark:bg-background/80">
                          {tasksForPhase.length === 0 ? (
                            <p className="py-5 text-center text-sm text-muted-foreground/90">
                              No checklist items for this phase.
                            </p>
                          ) : null}
                          {tasksForPhase.map((task) => (
                            <div key={task.id} className="flex items-start gap-2.5 min-h-[2.45rem] py-2 px-2 sm:px-2">
                              {task.is_completed ? (
                                <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                              ) : (
                                <Circle className="h-5 w-5 shrink-0 mt-0.5 text-muted-foreground/45" aria-hidden />
                              )}
                              <div className="flex-1 min-w-0 pt-px">
                                <span
                                  className={`text-sm leading-snug block ${
                                    task.is_completed ? 'line-through text-muted-foreground' : 'text-foreground'
                                  }`}
                                >
                                  {task.name}
                                </span>
                                {task.is_completed && task.checked_by ? (
                                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] h-5 px-1.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                                    >
                                      <User className="h-2.5 w-2.5 mr-0.5" />
                                      Completed · {task.checked_by}
                                    </Badge>
                                    {task.checked_at ? (
                                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                        <Clock className="h-2.5 w-2.5" />
                                        {formatVisitDate(task.checked_at)}
                                      </span>
                                    ) : null}
                                  </div>
                                ) : !task.is_completed && task.checked_by ? (
                                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] h-5 px-1.5 bg-orange-50 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200"
                                    >
                                      <User className="h-2.5 w-2.5 mr-0.5" />
                                      Unchecked by {task.checked_by}
                                    </Badge>
                                    {task.checked_at ? (
                                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                        <Clock className="h-2.5 w-2.5" />
                                        {formatVisitDate(task.checked_at)}
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </Card>
                    ) : (
                    <Card className="overflow-hidden border-border/55 bg-card shadow-none ring-1 ring-border/40 dark:ring-border/50">
                      <div className="border-b border-border/45 bg-muted/[0.35] dark:bg-muted/20 px-2 py-1.5 sm:px-2.5 sm:py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 pt-0.5">
                            <h3 className="text-[15px] font-semibold tracking-tight text-foreground flex flex-wrap items-center gap-1.5">
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 opacity-85" />
                              {editingChecklistTitle ? (
                                <div
                                  className="flex flex-1 min-w-0 items-center gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Input
                                    value={checklistTitleDraft}
                                    onChange={(e) => setChecklistTitleDraft(e.target.value)}
                                    className="h-8 text-base sm:text-sm flex-1 min-w-0"
                                    {...(desktopAutoFocus ? { autoFocus: true } : {})}
                                    disabled={savingChecklistTitle}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') void commitChecklistSectionTitle();
                                      if (e.key === 'Escape') setEditingChecklistTitle(false);
                                    }}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    disabled={savingChecklistTitle}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => void commitChecklistSectionTitle()}
                                  >
                                    <Check className="h-4 w-4 text-emerald-600" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  <span className="min-w-0">{checklistSectionTitle}</span>
                                  {canEdit && !editsBlocked ? (
                                    <button
                                      type="button"
                                      className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                                      aria-label="Rename checklist section"
                                      onClick={() => {
                                        setChecklistTitleDraft(checklistSectionTitle);
                                        setEditingChecklistTitle(true);
                                      }}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                  ) : null}
                                </>
                              )}
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

                      {legacySavedWorkerName ? (
                        <div className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-1.5 py-1 mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground truncate">
                              Using saved name <strong className="text-foreground/90">{legacySavedWorkerName}</strong>
                            </span>
                          </div>
                          <button
                            type="button"
                            className="text-[10px] text-muted-foreground hover:text-foreground hover:underline shrink-0"
                            onClick={handleClearSavedName}
                          >
                            Clear
                          </button>
                        </div>
                      ) : null}

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
                                    className="h-9 text-base sm:text-sm flex-1"
                                    {...(desktopAutoFocus ? { autoFocus: true } : {})}
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
                                    <div
                                      className="mt-0.5 shrink-0 pointer-events-none"
                                      aria-hidden
                                    >
                                      {task.is_completed ? (
                                        <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                                      ) : (
                                        <Circle className="h-6 w-6 text-muted-foreground/45" />
                                      )}
                                    </div>
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
                                      {task.is_completed && task.checked_by ? (
                                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                          <Badge
                                            variant="secondary"
                                            className="text-[10px] h-5 px-1.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                                          >
                                            <User className="h-2.5 w-2.5 mr-0.5" />
                                            Completed · {task.checked_by}
                                          </Badge>
                                          {task.checked_at ? (
                                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                              <Clock className="h-2.5 w-2.5" />
                                              {formatVisitDate(task.checked_at)}
                                            </span>
                                          ) : null}
                                        </div>
                                      ) : !task.is_completed && task.checked_by ? (
                                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                          <Badge
                                            variant="secondary"
                                            className="text-[10px] h-5 px-1.5 bg-orange-50 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200"
                                          >
                                            <User className="h-2.5 w-2.5 mr-0.5" />
                                            Unchecked by {task.checked_by}
                                          </Badge>
                                          {task.checked_at ? (
                                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                              <Clock className="h-2.5 w-2.5" />
                                              {formatVisitDate(task.checked_at)}
                                            </span>
                                          ) : null}
                                        </div>
                                      ) : null}
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
                                {...(desktopAutoFocus ? { autoFocus: true } : {})}
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
                    </div>
                  )}

                  {sectionVisibility.photos && (
                    <div
                      className={cn(
                        'min-w-0',
                        phaseReadOnly ? 'order-1' : 'order-3'
                      )}
                    >
                    <Collapsible defaultOpen={phaseReadOnly} className="rounded-md border border-border/40 bg-muted/[0.07] shadow-none">
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
                                {uploading ? 'Uploading...' : t('uploadPhoto')}
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
                                      <ImageWithFallback
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
                    </div>
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
                        <div className="px-3 pb-3 pt-0 max-h-56 overflow-y-auto space-y-2 text-xs border-t border-border/40">
                          {activityEntries.length === 0 ? (
                            <p className="text-muted-foreground py-2 leading-snug">
                              No activity for this phase yet.
                            </p>
                          ) : (
                            activityEntries.map((row, i) => (
                              <div
                                key={row.rowKey}
                                className="rounded-md border border-border/30 bg-muted/[0.06] px-2.5 py-2"
                              >
                                <div className="flex flex-col gap-1">
                                  <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
                                    {i === 0 ? (
                                      <Badge
                                        variant="secondary"
                                        className="h-5 shrink-0 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide"
                                      >
                                        Latest
                                      </Badge>
                                    ) : null}
                                    <span className="min-w-0 flex-1 leading-snug text-foreground/90">
                                      {row.msg}
                                    </span>
                                  </div>
                                  <time
                                    className="text-[10px] leading-snug text-muted-foreground tabular-nums"
                                    dateTime={new Date(row.t).toISOString()}
                                  >
                                    {formatActivityWhen(row.t)}
                                  </time>
                                </div>
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
                        <span className="font-normal opacity-80">
                          ({openDeviationsForPhase.length} open
                          {resolvedDeviationsForPhase.length > 0
                            ? ` · ${resolvedDeviationsForPhase.length} resolved`
                            : ''}
                          )
                        </span>
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-3 pb-3 pt-0 space-y-3 border-t border-border/40">
                        <p className="text-[11px] text-muted-foreground leading-snug pt-2">
                          Issues or missing work — not a chat. This phase only.
                        </p>
                        <div className="space-y-2">
                          {openDeviationsForPhase.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-0.5">No open issues for this phase.</p>
                          ) : (
                            openDeviationsForPhase.map((d) => (
                              <div
                                key={d.id}
                                className="rounded-md border border-amber-200/70 bg-amber-50/40 px-2.5 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/20"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] mb-1 h-5 bg-amber-100/90 text-amber-950 dark:bg-amber-900/50 dark:text-amber-100"
                                    >
                                      Open
                                    </Badge>
                                    <p className="text-foreground leading-snug">{d.text}</p>
                                    {d.reported_by?.trim() ? (
                                      <p className="mt-1 text-[10px] text-muted-foreground">
                                        Reported by {d.reported_by.trim()}
                                      </p>
                                    ) : null}
                                  </div>
                                  {canResolveIssue ? (
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      className="h-7 text-[11px] shrink-0"
                                      disabled={savingDeviations}
                                      onClick={() => void handleMarkIssueResolved(d.id)}
                                    >
                                      Mark as resolved
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                        {resolvedDeviationsForPhase.length > 0 ? (
                          <Collapsible defaultOpen={false} className="rounded-md border border-border/35 bg-muted/[0.04]">
                            <CollapsibleTrigger className="group flex w-full items-center justify-between px-2.5 py-2 text-left hover:bg-muted/20 rounded-md">
                              <span className="text-[11px] font-medium text-muted-foreground">
                                Resolved ({resolvedDeviationsForPhase.length})
                              </span>
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform group-data-[state=open]:rotate-180" />
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="space-y-2 border-t border-border/30 px-2.5 pb-2.5 pt-2">
                                {resolvedDeviationsForPhase.map((d) => (
                                  <div
                                    key={d.id}
                                    className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-xs"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-foreground leading-snug">{d.text}</p>
                                        {d.reported_by?.trim() ? (
                                          <p className="mt-1 text-[10px] text-muted-foreground">
                                            Reported by {d.reported_by.trim()}
                                          </p>
                                        ) : null}
                                        {d.resolved_by?.trim() ? (
                                          <p className="mt-1 text-[10px] text-muted-foreground">
                                            Resolved by {d.resolved_by.trim()}
                                            {d.resolved_at
                                              ? ` · ${formatActivityWhen(parseTimestampMs(d.resolved_at))}`
                                              : ''}
                                          </p>
                                        ) : d.resolved_at ? (
                                          <p className="mt-1 text-[10px] text-muted-foreground">
                                            {formatActivityWhen(parseTimestampMs(d.resolved_at))}
                                          </p>
                                        ) : null}
                                      </div>
                                      {canEdit && !editsBlocked ? (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 text-[11px] shrink-0"
                                          disabled={savingDeviations}
                                          onClick={() => void handleReopenIssue(d.id)}
                                        >
                                          Reopen
                                        </Button>
                                      ) : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        ) : null}
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
          </>
        )}

      </div>

      <Dialog open={showManageAreas} onOpenChange={setShowManageAreas}>
        <DialogContent className="max-w-md mx-4">
          <DialogHeader>
            <DialogTitle>Areas</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground mb-2 leading-snug">
            Each area has its own phases and checklist. The first area sets the board phase for this item.
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
              Block
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
          <DialogForm onSubmit={(e) => { e.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle>Delete this item?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete this item and its checklist, photos, visits, and notes.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowDeleteRoomDialog(false)} disabled={deletingRoom}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={deletingRoom}
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={() => void handleDeleteRoom()}
            >
              {deletingRoom ? 'Deleting...' : t('delete')}
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
              Site work must record who performed actions. Enter your name once on this device (saved locally), sign in with your supervisor&apos;s site worker PIN, or set your name on your account profile.
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
          <ImageWithFallback
            src={showPhotoPreview}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg"
            fallbackClassName="h-40 w-40 rounded-lg bg-white/10"
            iconClassName="h-10 w-10 text-white/70"
          />
        </div>
      )}
    </div>
  );
}