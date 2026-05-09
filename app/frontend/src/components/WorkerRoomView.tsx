import { RefObject, useEffect, useMemo, useRef, type ChangeEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Camera,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  History,
  Image as ImageIcon,
  Lock,
  User,
  AlertTriangle,
} from 'lucide-react';
import {
  HEATING_CABLE_STAGES,
  HEATING_CABLE_DERIVED_STATUS_LABEL,
  buildHeatingCableGallerySections,
  formatHeatingCablePerformedShort,
  getHeatingCableFocusTarget,
  heatingDocumentationProgress,
  heatingExtraStepRowVisible,
  heatingStageHasAnyData,
  heatingStageIsLocked,
  isHeatingCablePhase,
  isHeatingCableStageComplete,
  type HeatingCableDoc,
  type HeatingCableDerived,
  type HeatingCableStage,
  type HeatingCableStageKey,
} from '@/lib/heatingCable';
import type { PhaseStepStatus, PhaseWorkflowEntry } from '@/lib/roomPhases';
import {
  normalizeRoomPhase,
  phaseKeys,
  phaseLabel,
  phaseTabReadOnlyForWorker,
  phaseTimelineFromStepStatus,
  phaseTimelineState,
} from '@/lib/roomPhases';
import { WORKER_ROOM_DOCUMENTATION_ANCHOR } from '@/lib/workerLastRoom';
import { cn } from '@/lib/utils';
import type { ActivityDisplayRow } from '@/lib/roomActivity';

export type WorkerTask = {
  id: number;
  name: string;
  is_completed: boolean;
  checked_by?: string;
  checked_at?: string;
};

export type WorkerPhoto = {
  id: number;
  filename: string;
  downloadUrl?: string;
  caption?: string | null;
};

export type WorkerDeviation = {
  id: string;
  text: string;
  status: 'open' | 'resolved';
  reported_by?: string;
};

type Props = {
  roomNumber: string;
  areaName: string | null;
  showAreasNav: boolean;
  areasList: { id: string; name: string }[];
  activeAreaId: string;
  onAreaChange: (id: string) => void;

  phaseWorkflow: PhaseWorkflowEntry[];
  /** Resolved per-step statuses for phase chips in the hero */
  phaseStepStatuses: Record<string, PhaseStepStatus>;
  /** Room / area phase pointer for lock rules */
  roomPhasePointer: string;
  phaseLockOverrides?: Record<string, boolean> | null;
  /** Floor-board focus: first in-progress step (hero metrics / default tab target) */
  boardPhaseKey: string;
  /** All steps currently in progress (parallel work); defaults to [boardPhaseKey] when omitted */
  inProgressPhaseKeys?: string[];
  /** Resolved status for the selected phase tab (for messaging) */
  selectedPhaseStepStatus?: PhaseStepStatus;
  /** Selected phase tab (may differ when reviewing history) */
  selectedPhaseKey: string;
  onPhaseSelect: (key: string) => void;

  heatingDerived: HeatingCableDerived;
  currentWorkerUserId?: string | null;

  phaseReadOnly: boolean;
  /** True when this phase tab is locked for the worker (future phase or admin override). */
  phaseTabLocked: boolean;
  editsBlocked: boolean;

  checklistSectionTitle: string;
  showChecklistSection: boolean;
  tasksForSelectedPhase: WorkerTask[];
  canInteractChecklist: boolean;
  onTaskClick: (task: WorkerTask) => void;

  showHeatingModule: boolean;
  heatingCableDoc: HeatingCableDoc;
  canEditHeatingCable: boolean;
  /** Disables inputs only during photo upload or similar blocking work — not during background autosave. */
  heatingCableBlocking: boolean;
  /** Subtle persist feedback for the heating cable module. */
  heatingCableSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  /** Debounce pending before the PATCH runs — same UX weight as `saving`. */
  heatingCableAutosavePending?: boolean;
  /** True when local edits differ from last persisted payload (measurements, notes, photos, etc.). */
  heatingCableDirty: boolean;
  /** Label for the manual save button — contextual vs generic “Save now”. */
  heatingCableManualSaveLabel: string;
  heatingLockedByAdmin: boolean;
  heatingPhotoInputRefs: RefObject<Record<string, HTMLInputElement | null>>;
  onHeatingFieldChange: (
    stageKey: HeatingCableStageKey,
    field: 'resistance_ohm' | 'insulation_mohm' | 'date' | 'note',
    value: string
  ) => void;
  onExtraHeatingFieldChange: (
    index: number,
    field: 'label' | 'resistance_ohm' | 'insulation_mohm' | 'date' | 'note',
    value: string
  ) => void;
  onHeatingStagePhotoChange: (stageId: string, file?: File) => void;
  onSaveHeatingCable: () => void;
  onCompleteHeatingStage: (stageKey: HeatingCableStageKey) => void | Promise<void>;
  onPhotoPreview: (url: string) => void;

  /** Session display name used elsewhere in worker flow. */
  heatingDefaultPerformedBy?: string;
  /** When this value changes (e.g. room id), one-time default seeding runs again for the new context. */
  heatingCableSeedResetKey?: string | number;

  showPhotosSection: boolean;
  canUploadPhoto: boolean;
  canMutatePhaseMedia: boolean;
  uploadingPhoto: boolean;
  /** When true (Varmekabel + heating module), hide the generic “add phase photo” control — uploads belong under stages. */
  hideGenericPhasePhotoUpload?: boolean;
  /** Room photos with signed URLs — resolves heating cable object keys and builds the gallery below stages. */
  resolvedRoomPhotos?: Array<{
    id: number;
    object_key: string;
    filename?: string;
    caption?: string | null;
    downloadUrl?: string;
    created_at?: string | null;
  }>;
  onGeneralPhotoClick: () => void;
  /** Optional: upload a phase photo with checklist context (caption); does not run when checking tasks off. */
  onTaskPhotoClick?: (task: WorkerTask) => void;
  photosForPhase: WorkerPhoto[];
  legacySavedWorkerName?: string;
  onClearSavedWorkerName?: () => void;

  activityEntries: ActivityDisplayRow[];
  formatActivityWhen: (ts: number) => string;

  deviations: WorkerDeviation[];
  newDeviationText: string;
  onNewDeviationChange: (v: string) => void;
  onAddDeviation: () => void;
  canAddDeviation: boolean;
  savingDeviations: boolean;

  blockedReason?: string | null;
  dueLine: string | null;
  duePast: boolean;

  phaseCompleteEligible: boolean;
  /** True when this tab is explicitly locked via phase_lock_overrides (worker handoff or admin). */
  phaseExplicitWorkerLock?: boolean;
  onCompletePhase: () => boolean | Promise<boolean>;
  completingPhase?: boolean;
};

type HeroPhaseChipState = 'complete' | 'active' | 'pending' | 'blocked';

function heroPhaseChipState(st: PhaseStepStatus | undefined): HeroPhaseChipState {
  if (st === 'blocked') return 'blocked';
  if (st === 'complete') return 'complete';
  if (st === 'in_progress') return 'active';
  return 'pending';
}

function heroPhaseStateLabel(s: HeroPhaseChipState): string {
  switch (s) {
    case 'complete':
      return 'Complete';
    case 'active':
      return 'Active';
    case 'blocked':
      return 'Blocked';
    default:
      return 'Pending';
  }
}

function formatVisitDateShort(dateStr: string): string {
  try {
    const raw = String(dateStr).trim().replace(' ', 'T');
    const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}Z`;
    const d = new Date(normalized);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function heatingPhotoRefKeys(stageId: string) {
  return { gallery: `${stageId}:gallery`, camera: `${stageId}:camera` } as const;
}

/** Gallery (no `capture`) + camera — lets mobile users pick library or shoot new. */
function HeatingStagePhotoPicker(props: {
  registerInput: (suffix: 'gallery' | 'camera', el: HTMLInputElement | null) => void;
  disabled?: boolean;
  onFile: (file?: File) => void;
}) {
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    props.onFile(e.target.files?.[0]);
    e.target.value = '';
  };
  return (
    <>
      <input
        ref={(el) => {
          galleryRef.current = el;
          props.registerInput('gallery', el);
        }}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        disabled={props.disabled}
        onChange={onPick}
      />
      <input
        ref={(el) => {
          cameraRef.current = el;
          props.registerInput('camera', el);
        }}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        disabled={props.disabled}
        onChange={onPick}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 w-full flex-col gap-1 px-2 py-2.5 text-center text-sm font-normal leading-snug whitespace-normal sm:flex-row sm:gap-2 sm:py-2.5"
          disabled={props.disabled}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="max-w-full">Take photo</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 w-full flex-col gap-1 px-2 py-2.5 text-center text-sm font-normal leading-snug whitespace-normal sm:flex-row sm:gap-2 sm:py-2.5"
          disabled={props.disabled}
          onClick={() => galleryRef.current?.click()}
        >
          <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="max-w-full">Choose from gallery</span>
        </Button>
      </div>
    </>
  );
}

/** Compact "Performed: 2 May 23:06" with optional admin-only edit affordance. */
function HeatingPerformedRow(props: {
  storedDate: string | undefined;
}) {
  const display = formatHeatingCablePerformedShort(props.storedDate);

  return (
    <div className="min-w-0 max-w-full">
      <div className="flex min-w-0 max-w-full flex-col gap-1 text-sm leading-snug sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1.5 sm:gap-y-1">
        <span className="text-muted-foreground">Performed:</span>
        <span className="min-w-0 max-w-full break-words font-semibold tabular-nums text-foreground">{display || '—'}</span>
      </div>
    </div>
  );
}

function heatingStageCollapseSummary(stage: HeatingCableStage): string {
  const parts: string[] = [];
  if (stage.resistance_ohm?.trim()) parts.push(`${stage.resistance_ohm.trim()} Ω`);
  if (stage.insulation_mohm?.trim()) parts.push(`${stage.insulation_mohm.trim()} MΩ`);
  const when = stage.date?.trim();
  if (when) {
    const raw = /^\d{4}-\d{2}-\d{2}$/.test(when) ? `${when}T12:00` : when.replace(' ', 'T');
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) {
      parts.push(
        new Date(t).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      );
    } else {
      parts.push(when);
    }
  }
  if (stage.performed_by?.trim()) parts.push(stage.performed_by.trim());
  if (parts.length === 0) return 'No readings yet';
  return parts.join(' · ');
}

export function WorkerRoomView(p: Props) {
  const heatingStepConfirmBlockedReason = (
    stageKey: HeatingCableStageKey,
    stage: HeatingCableStage,
    canAccessStage: boolean
  ): string | null => {
    if (!canAccessStage) return 'Fullforrige trinn før du bekrefter dette.';
    if (!stage.resistance_ohm?.trim()) return 'Fyll inn motstand før bekreftelse.';
    if (!stage.insulation_mohm?.trim()) return 'Fyll inn isolasjon før bekreftelse.';
    if (!p.currentWorkerUserId?.trim()) return 'You must be logged in as a Site Worker to confirm this step.';
    if (stageKey === 'after_cable_laid') {
      const hasPhoto = Array.isArray(stage.photos) && stage.photos.some((x) => typeof x === 'string' && x.trim());
      if (!hasPhoto) return 'Legg til minst ett bilde før bekreftelse av dette trinnet.';
    }
    return null;
  };

  const selectedLabel = phaseLabel(p.selectedPhaseKey, p.phaseWorkflow);
  const inProgressKeys =
    p.inProgressPhaseKeys && p.inProgressPhaseKeys.length > 0
      ? p.inProgressPhaseKeys
      : [p.boardPhaseKey];
  const viewingNonBoard = !inProgressKeys.includes(p.selectedPhaseKey);
  const phaseTimeline =
    p.selectedPhaseStepStatus != null
      ? phaseTimelineFromStepStatus(
          p.selectedPhaseStepStatus,
          p.selectedPhaseKey,
          p.boardPhaseKey,
          p.phaseWorkflow
        )
      : phaseTimelineState(p.boardPhaseKey, p.selectedPhaseKey, p.phaseWorkflow);

  const [nonBoardDetailsExpanded, setNonBoardDetailsExpanded] = useState(false);
  const [phaseHandoffDialogOpen, setPhaseHandoffDialogOpen] = useState(false);
  const sawCompletingPhaseRef = useRef(false);
  useEffect(() => {
    setNonBoardDetailsExpanded(false);
    setPhaseHandoffDialogOpen(false);
  }, [p.selectedPhaseKey]);
  useEffect(() => {
    if (p.completingPhase) {
      sawCompletingPhaseRef.current = true;
    } else if (sawCompletingPhaseRef.current && phaseHandoffDialogOpen) {
      setPhaseHandoffDialogOpen(false);
      sawCompletingPhaseRef.current = false;
    }
  }, [p.completingPhase, phaseHandoffDialogOpen]);

  const nextPhaseLabelAfterHandoff = useMemo(() => {
    const keys = phaseKeys(p.phaseWorkflow);
    const cur = normalizeRoomPhase(p.selectedPhaseKey, p.phaseWorkflow);
    const i = keys.indexOf(cur);
    if (i < 0 || i >= keys.length - 1) return null;
    return phaseLabel(keys[i + 1], p.phaseWorkflow);
  }, [p.phaseWorkflow, p.selectedPhaseKey]);
  const showFullPhaseDetails = !viewingNonBoard || nonBoardDetailsExpanded;
  const selectedHeatingDocProgress = p.showHeatingModule
    ? heatingDocumentationProgress(p.heatingCableDoc)
    : null;
  const workflowKeys = p.phaseWorkflow.map((x) => x.key);

  const focusTarget = useMemo(() => getHeatingCableFocusTarget(p.heatingCableDoc), [p.heatingCableDoc]);
  const focusStageId = useMemo(() => {
    if (!focusTarget) return 'all-complete';
    return focusTarget.kind === 'main' ? focusTarget.key : `extra:${focusTarget.index}`;
  }, [focusTarget]);

  const [heatingOpenOverrides, setHeatingOpenOverrides] = useState<Record<string, boolean>>({});
  const [confirmStageKey, setConfirmStageKey] = useState<HeatingCableStageKey | null>(null);
  useEffect(() => {
    if (focusStageId !== 'all-complete') {
      setHeatingOpenOverrides((prev) => ({ ...prev, [focusStageId]: true }));
    }
  }, [focusStageId]);

  const heatingStageOpen = (id: string) => {
    if (heatingOpenOverrides[id] !== undefined) return heatingOpenOverrides[id];
    return id === focusStageId;
  };
  const setHeatingStageOpen = (id: string, open: boolean) => {
    setHeatingOpenOverrides((prev) => ({ ...prev, [id]: open }));
  };


  const focusStageLabel = useMemo(() => {
    if (!focusTarget) return null;
    if (focusTarget.kind === 'main') {
      return HEATING_CABLE_STAGES.find((s) => s.key === focusTarget.key)?.label ?? focusTarget.key;
    }
    const step = p.heatingCableDoc.extra_steps?.[focusTarget.index];
    return step?.label?.trim() || `Extra step ${focusTarget.index + 1}`;
  }, [focusTarget, p.heatingCableDoc.extra_steps]);

  const heatingCablePhasePrimary =
    p.showHeatingModule && isHeatingCablePhase(p.selectedPhaseKey, selectedLabel);
  const heatingCableSaveBusy =
    p.heatingCableSaveStatus === 'saving' || Boolean(p.heatingCableAutosavePending);

  const heatingGallerySections = useMemo(
    () =>
      p.showHeatingModule
        ? buildHeatingCableGallerySections(p.heatingCableDoc, p.resolvedRoomPhotos ?? [])
        : [],
    [p.showHeatingModule, p.heatingCableDoc, p.resolvedRoomPhotos]
  );

  const nonBoardFocus = useMemo(() => {
    const st = p.selectedPhaseStepStatus;
    const forcedLock = p.phaseExplicitWorkerLock === true;
    if (forcedLock && st === 'in_progress' && p.phaseTabLocked) {
      return {
        badge: 'Handed off',
        badgeClass:
          'border-emerald-400/75 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-50',
        description: 'Locked after worker signoff — review only until an admin unlocks.',
      };
    }
    if (st === 'blocked' && !p.phaseTabLocked) {
      return {
        badge: 'Blocked',
        badgeClass:
          'border-orange-300/80 bg-orange-50 text-orange-950 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-50',
        description: 'Waiting on a status update — details below are read-only.',
      };
    }
    if (p.phaseTabLocked && (st === 'not_started' || st === 'complete' || phaseTimeline === 'upcoming')) {
      return {
        badge: 'Locked',
        badgeClass:
          'border-amber-300/80 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100',
        description: 'Waiting for access.',
      };
    }
    if (p.phaseTabLocked) {
      return {
        badge: 'Locked',
        badgeClass:
          'border-slate-300/80 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100',
        description: 'View only for this phase.',
      };
    }
    if (st === 'complete' || phaseTimeline === 'done') {
      return {
        badge: 'Completed',
        badgeClass:
          'border-emerald-300/80 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-100',
        description: 'Recorded for reference.',
      };
    }
    if (st === 'not_started') {
      return {
        badge: 'Not started',
        badgeClass:
          'border-blue-300/70 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100',
        description: 'Current work is on another phase.',
      };
    }
    return {
      badge: 'In progress',
      badgeClass:
        'border-teal-300/75 bg-teal-50 text-teal-950 dark:border-teal-800 dark:bg-teal-950/35 dark:text-teal-50',
      description: null as string | null,
    };
  }, [p.phaseTabLocked, phaseTimeline, p.selectedPhaseStepStatus, p.phaseExplicitWorkerLock]);

  const compactSummaryLines = useMemo(() => {
    const lines: string[] = [];
    const tasks = p.tasksForSelectedPhase;
    if (p.showChecklistSection) {
      if (tasks.length > 0) {
        const done = tasks.filter((t) => t.is_completed).length;
        lines.push(`Checklist ${done}/${tasks.length} marked`);
      } else {
        lines.push('No checklist items in this phase');
      }
    }
    if (p.showHeatingModule && selectedHeatingDocProgress) {
      lines.push(`Heating documentation ${selectedHeatingDocProgress.complete}/${selectedHeatingDocProgress.total}`);
    }
    if (p.showPhotosSection && p.photosForPhase.length > 0) {
      const n = p.photosForPhase.length;
      lines.push(`${n} phase photo${n === 1 ? '' : 's'}`);
    }
    if (p.deviations.length > 0) {
      const n = p.deviations.length;
      lines.push(`${n} reported issue${n === 1 ? '' : 's'}`);
    }
    if (p.activityEntries.length > 0) {
      lines.push(`${p.activityEntries.length} activity entr${p.activityEntries.length === 1 ? 'y' : 'ies'}`);
    }
    return lines;
  }, [
    p.tasksForSelectedPhase,
    p.showChecklistSection,
    p.showHeatingModule,
    selectedHeatingDocProgress,
    p.showPhotosSection,
    p.photosForPhase.length,
    p.deviations.length,
    p.activityEntries.length,
  ]);

  const workerDecisionStatus = useMemo(() => {
    if (p.blockedReason) {
      return {
        label: 'Blocked',
        className:
          'border-red-400/60 bg-red-50 text-red-950 dark:border-red-900/60 dark:bg-red-950/45 dark:text-red-50',
      };
    }
    if (p.phaseExplicitWorkerLock && p.phaseTabLocked) {
      return {
        label: 'Handed off',
        className:
          'border-emerald-500/50 bg-emerald-50 text-emerald-950 dark:border-emerald-700/55 dark:bg-emerald-950/45 dark:text-emerald-50',
      };
    }
    if (p.phaseCompleteEligible && !p.phaseReadOnly) {
      return {
        label: 'Ready',
        className:
          'border-emerald-400/55 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-50',
      };
    }
    return {
      label: 'In progress',
      className:
        'border-[#1E3A5F]/30 bg-[#1E3A5F]/[0.08] text-[#0f2744] dark:border-blue-800/50 dark:bg-blue-950/35 dark:text-blue-50',
    };
  }, [p.blockedReason, p.phaseCompleteEligible, p.phaseReadOnly, p.phaseExplicitWorkerLock, p.phaseTabLocked]);

  const openDeviationsCount = useMemo(
    () => p.deviations.filter((d) => d.status === 'open').length,
    [p.deviations]
  );

  const heroStatPrimary = useMemo(() => {
    const checklistTotal = p.showChecklistSection ? p.tasksForSelectedPhase.length : 0;
    const checklistDone = p.showChecklistSection
      ? p.tasksForSelectedPhase.filter((t) => t.is_completed).length
      : 0;
    const checklistIncomplete = Math.max(0, checklistTotal - checklistDone);

    if (checklistTotal > 0) {
      return {
        label: 'Open work',
        value: String(checklistIncomplete),
        sub: `${checklistDone}/${checklistTotal} done`,
      };
    }
    if (p.showHeatingModule && selectedHeatingDocProgress) {
      const left = selectedHeatingDocProgress.total - selectedHeatingDocProgress.complete;
      return {
        label: 'Open work',
        value: String(Math.max(0, left)),
        sub: `${selectedHeatingDocProgress.complete}/${selectedHeatingDocProgress.total} documented`,
      };
    }
    return {
      label: 'Open work',
      value: '0',
      sub: 'Nothing queued this phase',
    };
  }, [p.showChecklistSection, p.tasksForSelectedPhase, p.showHeatingModule, selectedHeatingDocProgress]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-lg space-y-3 py-3 sm:space-y-4 sm:py-4 lg:max-w-xl">
      {/* Room hero — decision-critical: room, status, due, open work, phases */}
      <Card className="overflow-hidden border-[#1E3A5F]/20 bg-gradient-to-br from-[#1E3A5F]/[0.09] via-background to-background shadow-md ring-1 ring-black/[0.03] dark:from-blue-950/45 dark:via-background dark:to-background dark:ring-white/[0.06]">
        <div className="space-y-3 p-4 sm:space-y-3.5 sm:p-5">
          <div className="flex flex-col gap-3 min-[400px]:flex-row min-[400px]:items-start min-[400px]:justify-between min-[400px]:gap-4">
            <div className="min-w-0 space-y-0.5">
              {p.areaName ? (
                <p className="text-[11px] font-medium leading-tight text-muted-foreground">{p.areaName}</p>
              ) : null}
              <h1 className="text-[1.85rem] font-bold leading-[1.08] tracking-tight text-foreground sm:text-[2.1rem]">
                {p.roomNumber}
              </h1>
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2 min-[400px]:items-end min-[400px]:text-right">
              <span
                className={cn(
                  'inline-flex w-fit max-w-full items-center justify-center rounded-full border px-3 py-1 text-[11px] font-semibold leading-tight min-[400px]:self-end sm:text-xs',
                  workerDecisionStatus.className
                )}
              >
                {workerDecisionStatus.label}
              </span>
              {p.dueLine ? (
                <span
                  className={cn(
                    'inline-flex w-fit max-w-full items-center gap-1.5 rounded-lg border border-border/40 bg-background/80 px-2.5 py-1.5 text-xs font-semibold tabular-nums shadow-sm min-[400px]:self-end dark:bg-background/40',
                    p.duePast && 'border-red-400/40 bg-red-500/[0.08] text-red-800 dark:text-red-300'
                  )}
                >
                  <Calendar className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                  <span>
                    Due {p.dueLine}
                    {p.duePast ? <span className="font-bold"> · Overdue</span> : null}
                  </span>
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-2.5 dark:bg-background/50 sm:px-3.5 sm:py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {heroStatPrimary.label}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">
              {heroStatPrimary.value}
            </p>
            {heroStatPrimary.sub ? (
              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground sm:text-xs">{heroStatPrimary.sub}</p>
            ) : null}
          </div>

          {workflowKeys.length > 1 ? (
            <div className="min-w-0 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Phases
              </p>
              <div className="min-w-0 max-w-full">
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {workflowKeys.map((key) => {
                    const st = heroPhaseChipState(p.phaseStepStatuses[key]);
                    const stateLabel = heroPhaseStateLabel(st);
                    const sel = key === p.selectedPhaseKey;
                    const locked = phaseTabReadOnlyForWorker(
                      p.roomPhasePointer,
                      key,
                      p.phaseWorkflow,
                      p.phaseLockOverrides ?? null,
                      p.phaseStepStatuses
                    );
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => p.onPhaseSelect(key)}
                        className={cn(
                          'flex min-w-0 max-w-[10.5rem] flex-[1_1_7.5rem] flex-col items-start gap-0.5 rounded-xl border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          sel &&
                            'border-[#1E3A5F] bg-[#1E3A5F] text-white shadow-sm ring-1 ring-[#1E3A5F]/20 dark:border-blue-600 dark:bg-blue-700 dark:ring-blue-500/30',
                          !sel && st === 'complete' && 'border-emerald-300/70 bg-emerald-50/50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100',
                          !sel && st === 'active' && 'border-[#1E3A5F]/35 bg-[#1E3A5F]/[0.08] text-foreground dark:border-blue-800/50 dark:bg-blue-950/35',
                          !sel && st === 'blocked' && 'border-orange-400/70 bg-orange-50/90 text-orange-950 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-50',
                          !sel && st === 'pending' && 'border-border/45 bg-background/80 text-muted-foreground',
                          locked && !sel && 'opacity-[0.72]'
                        )}
                      >
                        <span
                          className={cn(
                            'w-full truncate text-[11px] font-semibold leading-tight sm:text-xs',
                            sel && 'text-white'
                          )}
                        >
                          {phaseLabel(key, p.phaseWorkflow)}
                        </span>
                        <span
                          className={cn(
                            'text-[9px] font-semibold uppercase tracking-[0.08em]',
                            sel ? 'text-white/85' : 'text-muted-foreground',
                            !sel && st === 'blocked' && 'text-orange-900/90 dark:text-orange-100',
                            !sel && st === 'complete' && 'text-emerald-800 dark:text-emerald-200'
                          )}
                        >
                          {stateLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {(p.blockedReason || openDeviationsCount > 0) && (
            <div
              className={cn(
                'space-y-2 rounded-xl border px-3.5 py-3',
                p.blockedReason
                  ? 'border-red-400/55 bg-red-50/95 dark:border-red-900/55 dark:bg-red-950/40'
                  : 'border-amber-400/35 bg-amber-50/90 dark:border-amber-900/50 dark:bg-amber-950/30'
              )}
            >
              <p
                className={cn(
                  'text-[10px] font-semibold uppercase tracking-[0.12em]',
                  p.blockedReason
                    ? 'text-red-950 dark:text-red-200'
                    : 'text-amber-950 dark:text-amber-200'
                )}
              >
                Blockers
              </p>
              {p.blockedReason ? (
                <div
                  className={cn(
                    'flex gap-2 text-sm',
                    p.blockedReason
                      ? 'text-red-950 dark:text-red-50'
                      : 'text-amber-950 dark:text-amber-50'
                  )}
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p className="min-w-0 leading-relaxed">{p.blockedReason}</p>
                </div>
              ) : null}
              {openDeviationsCount > 0 ? (
                <p
                  className={cn(
                    'text-sm font-medium',
                    p.blockedReason
                      ? 'text-red-900 dark:text-red-100'
                      : 'text-amber-950 dark:text-amber-100'
                  )}
                >
                  {openDeviationsCount} open issue{openDeviationsCount === 1 ? '' : 's'}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </Card>

      {/* Area picker — secondary */}
      {p.showAreasNav && p.areasList.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-border/20 bg-muted/[0.03] px-2 py-2">
          <span className="w-full text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/75 px-0.5">
            Area
          </span>
          <div className="flex flex-wrap gap-1.5">
            {p.areasList.map((a) => (
              <button
                key={a.id}
                type="button"
                className={cn(
                  'min-h-9 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  a.id === p.activeAreaId
                    ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white shadow-sm dark:border-blue-600 dark:bg-blue-700'
                    : 'border-border/40 bg-background/60 text-muted-foreground hover:border-border/70 hover:bg-muted/30 hover:text-foreground'
                )}
                onClick={() => p.onAreaChange(a.id)}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {p.phaseExplicitWorkerLock && p.phaseTabLocked ? (
        <Card className="overflow-hidden border-emerald-400/45 bg-emerald-50/85 shadow-sm dark:border-emerald-700/45 dark:bg-emerald-950/35">
          <div className="flex gap-3 p-4 sm:p-4">
            <Lock
              className="h-5 w-5 shrink-0 text-emerald-800 dark:text-emerald-200 mt-0.5"
              aria-hidden
            />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-50">Phase handed off</p>
              <p className="text-sm leading-snug text-emerald-900/88 dark:text-emerald-100/85">
                Locked after worker signoff. Checklist, documentation, photos, and notes for this phase are read-only
                until an admin unlocks editing.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {viewingNonBoard ? (
        <Card className="overflow-hidden border-[#1E3A5F]/20 bg-muted/20 shadow-sm">
          <div className="p-4 space-y-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Another phase
                </p>
                <p className="text-lg font-semibold tracking-tight leading-snug">{selectedLabel}</p>
                <p className="text-sm text-muted-foreground">
                  In progress:{' '}
                  <span className="font-medium text-foreground">
                    {inProgressKeys.map((k) => phaseLabel(k, p.phaseWorkflow)).join(', ')}
                  </span>
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn('shrink-0 border font-semibold sm:text-xs', nonBoardFocus.badgeClass)}
              >
                <span className="inline-flex items-center gap-1">
                  {p.phaseTabLocked ? (
                    <Lock className="h-3 w-3 shrink-0" aria-hidden />
                  ) : phaseTimeline === 'done' ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />
                  ) : (
                    <Clock className="h-3 w-3 shrink-0" aria-hidden />
                  )}
                  {nonBoardFocus.badge}
                </span>
              </Badge>
            </div>
            {nonBoardFocus.description ? (
              <p className="text-sm text-muted-foreground leading-snug">{nonBoardFocus.description}</p>
            ) : null}
            {!nonBoardDetailsExpanded ? (
              <ul className="rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 text-sm space-y-1">
                {compactSummaryLines.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span className="text-muted-foreground">·</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                type="button"
                className="h-11 min-h-11 w-full bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 dark:bg-blue-700 dark:hover:bg-blue-700/90 sm:h-10 sm:min-h-10 sm:w-auto sm:flex-1"
                onClick={() => p.onPhaseSelect(p.boardPhaseKey)}
              >
                Move to current phase
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 min-h-11 w-full border-border/60 sm:h-10 sm:min-h-10 sm:w-auto sm:flex-1"
                onClick={() => setNonBoardDetailsExpanded((v) => !v)}
              >
                {nonBoardDetailsExpanded ? 'Hide details' : 'View details'}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Checklist — large action rows (before heating so checklist stays above long forms) */}
      {showFullPhaseDetails && p.showChecklistSection ? (
        <section
          id={WORKER_ROOM_DOCUMENTATION_ANCHOR}
          aria-labelledby="worker-checklist-heading"
          className="scroll-mt-20"
        >
          <div className="mb-3 flex items-center justify-between gap-2 px-0.5">
            <h2
              id="worker-checklist-heading"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/85"
            >
              {p.checklistSectionTitle}
            </h2>
            <span className="text-[11px] tabular-nums font-medium text-muted-foreground/85">
              {p.showHeatingModule && p.tasksForSelectedPhase.length === 0 && selectedHeatingDocProgress
                ? `Documentation ${selectedHeatingDocProgress.complete}/${selectedHeatingDocProgress.total}`
                : `${p.tasksForSelectedPhase.filter((t) => t.is_completed).length}/${p.tasksForSelectedPhase.length}`}
            </span>
          </div>
          {p.legacySavedWorkerName ? (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-3 text-sm sm:py-2 sm:text-xs">
              <span className="text-muted-foreground truncate">
                Using saved name <strong className="text-foreground">{p.legacySavedWorkerName}</strong>
              </span>
              {p.onClearSavedWorkerName ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground underline text-sm shrink-0 min-h-10 min-w-[3rem] px-2 sm:min-h-0 sm:text-xs"
                  onClick={p.onClearSavedWorkerName}
                >
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2.5">
            {p.tasksForSelectedPhase.length === 0 ? (
              <Card className="p-6 text-center text-muted-foreground text-sm">No tasks for this phase.</Card>
            ) : (
              p.tasksForSelectedPhase.map((task) => {
                const showTaskPhotoAction =
                  Boolean(p.onTaskPhotoClick) && p.showPhotosSection && p.canUploadPhoto;
                return (
                  <Card
                    key={task.id}
                    className={cn(
                      'overflow-hidden transition-[background-color,border-color,box-shadow] duration-300 ease-out',
                      task.is_completed
                        ? 'border-border/50 bg-emerald-50/25 shadow-none ring-1 ring-emerald-500/[0.12] ring-inset dark:bg-emerald-950/15 dark:ring-emerald-400/15'
                        : 'border-border/60 bg-card shadow-sm hover:bg-muted/25'
                    )}
                  >
                    <div
                      className={cn(
                        'flex items-stretch',
                        showTaskPhotoAction && 'min-h-[3.25rem] sm:min-h-[3rem]'
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          'flex flex-1 items-start gap-3 text-left sm:gap-4',
                          'px-3 py-3 sm:px-4 sm:py-3',
                          showTaskPhotoAction
                            ? 'rounded-none rounded-l-xl'
                            : 'min-h-[3.25rem] rounded-xl sm:min-h-[3rem]',
                          !p.canInteractChecklist && 'cursor-not-allowed opacity-60'
                        )}
                        disabled={!p.canInteractChecklist}
                        onClick={() => p.onTaskClick(task)}
                      >
                        <div className="mt-0.5 shrink-0">
                          {task.is_completed ? (
                            <CheckCircle2
                              className="h-6 w-6 text-emerald-600 dark:text-emerald-400 sm:h-7 sm:w-7"
                              aria-hidden
                            />
                          ) : (
                            <Circle
                              className="h-6 w-6 text-muted-foreground/45 transition-colors duration-300 sm:h-7 sm:w-7"
                              aria-hidden
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p
                            className={cn(
                              'leading-snug font-medium',
                              task.is_completed
                                ? 'text-sm text-muted-foreground line-through'
                                : 'text-base text-foreground'
                            )}
                          >
                            {task.name}
                          </p>
                          {task.is_completed && task.checked_by ? (
                            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <User className="h-3 w-3 shrink-0" aria-hidden />
                              <span className="font-medium text-emerald-800/90 dark:text-emerald-300/90">
                                Completed
                              </span>
                              <span className="opacity-60">·</span>
                              <span>{task.checked_by}</span>
                              {task.checked_at ? (
                                <>
                                  <span className="opacity-50">·</span>
                                  <Clock className="h-3 w-3 shrink-0" aria-hidden />
                                  {formatVisitDateShort(task.checked_at)}
                                </>
                              ) : null}
                            </p>
                          ) : !task.is_completed && task.checked_by ? (
                            <p className="flex items-center gap-1.5 text-[11px] text-amber-900/85 dark:text-amber-100/85">
                              <User className="h-3 w-3 shrink-0" aria-hidden />
                              <span>Unchecked by</span>
                              <span className="font-medium">{task.checked_by}</span>
                              {task.checked_at ? (
                                <>
                                  <span className="opacity-50">·</span>
                                  <Clock className="h-3 w-3 shrink-0" aria-hidden />
                                  {formatVisitDateShort(task.checked_at)}
                                </>
                              ) : null}
                            </p>
                          ) : null}
                        </div>
                      </button>
                      {showTaskPhotoAction ? (
                        <button
                          type="button"
                          className="flex w-[3.25rem] shrink-0 flex-col items-center justify-center rounded-r-xl border-l border-border/40 bg-muted/10 px-1 transition-colors hover:bg-muted/25 disabled:pointer-events-none disabled:opacity-50 sm:w-14"
                          aria-label={`Add photo for ${task.name}`}
                          disabled={!p.canMutatePhaseMedia || p.uploadingPhoto}
                          onClick={(e) => {
                            e.stopPropagation();
                            p.onTaskPhotoClick?.(task);
                          }}
                        >
                          <Camera className="h-5 w-5 text-muted-foreground" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  </Card>
                );
              })
            )}
            {p.showPhotosSection && p.canUploadPhoto && !p.hideGenericPhasePhotoUpload ? (
              <Collapsible defaultOpen={false} className="rounded-xl border border-dashed border-border/55 bg-muted/10">
                <CollapsibleTrigger className="group flex w-full min-h-11 items-center justify-between gap-2 px-3 py-2.5 text-left sm:min-h-0 sm:px-4 sm:py-3">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">Other phase photos</span>
                    <span className="text-xs text-muted-foreground leading-snug">
                      Optional documentation for this workflow step — not used for heating cable stage records.
                    </span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t border-border/40 px-3 pb-4 pt-2 sm:px-4">
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-11 w-full gap-2 font-medium"
                      disabled={!p.canMutatePhaseMedia || p.uploadingPhoto}
                      onClick={() => p.onGeneralPhotoClick()}
                    >
                      <Camera className="h-4 w-4 shrink-0" />
                      {p.uploadingPhoto ? 'Uploading…' : 'Add photo'}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Heating cable — collapsible stages, defaults on active step */}
      {showFullPhaseDetails && p.showHeatingModule ? (
        <Card id="worker-heating-block" className="scroll-mt-20 overflow-hidden border-border/60 shadow-sm">
          <div className="border-b border-border/50 bg-muted/30 px-4 py-3 space-y-1.5">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <h2 className="text-base font-semibold tracking-tight sm:text-lg">Heating cable</h2>
              {(() => {
                const passiveComplete =
                  p.heatingDerived.status === 'complete' ? 'Documentation complete' : 'All changes saved';
                let statusText: string | null = null;
                if (heatingCableSaveBusy) statusText = 'Saving';
                else if (p.heatingCableSaveStatus === 'error') statusText = 'Failed';
                else if (p.heatingCableSaveStatus === 'saved') statusText = 'Saved';
                else if (
                  !p.heatingCableDirty ||
                  !p.canEditHeatingCable ||
                  p.heatingLockedByAdmin ||
                  p.phaseReadOnly
                ) {
                  statusText = passiveComplete;
                }
                if (!statusText) return null;
                return (
                  <span
                    className={cn(
                      'text-[11px] font-medium tabular-nums shrink-0 pt-0.5',
                      heatingCableSaveBusy && 'text-muted-foreground',
                      p.heatingCableSaveStatus === 'saved' && 'text-emerald-700 dark:text-emerald-400',
                      p.heatingCableSaveStatus === 'error' && 'text-destructive',
                      !heatingCableSaveBusy && p.heatingCableSaveStatus === 'idle' && 'text-muted-foreground/70'
                    )}
                    aria-live="polite"
                  >
                    {statusText}
                  </span>
                );
              })()}
            </div>
            {focusStageLabel ? (
              <p className="text-xs font-medium text-amber-900/90 dark:text-amber-100/90 flex items-center gap-1.5">
                <span className="text-muted-foreground font-normal">Current stage:</span>
                <span>{focusStageLabel}</span>
              </p>
            ) : (
              <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200">All stages documented.</p>
            )}
            {p.heatingLockedByAdmin ? (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">Locked by admin — view only.</p>
            ) : null}
          </div>
          <div className="p-4 space-y-3">
            {HEATING_CABLE_STAGES.map((stage) => {
              const row = p.heatingCableDoc[stage.key] || {};
              const stageIndex = HEATING_CABLE_STAGES.findIndex((x) => x.key === stage.key);
              const previousLocked =
                stageIndex <= 0
                  ? true
                  : heatingStageIsLocked(p.heatingCableDoc[HEATING_CABLE_STAGES[stageIndex - 1].key]);
              const canAccessStage = stageIndex === 0 || previousLocked;
              const isLocked = heatingStageIsLocked(row);
              const stageReadOnly = !p.canEditHeatingCable || p.heatingCableBlocking || isLocked || !canAccessStage;
              const sid = stage.key;
              const complete = isHeatingCableStageComplete(row, stage.key);
              const confirmBlockedReason = heatingStepConfirmBlockedReason(stage.key, row, canAccessStage);
              const isFocus = focusStageId === sid;
              const open = heatingStageOpen(sid);
              const started = heatingStageHasAnyData(row);
              const badgeLabel = isLocked
                ? 'Locked'
                : !canAccessStage
                  ? 'Locked'
                  : complete
                    ? 'Complete'
                    : isFocus
                      ? 'Open'
                      : started
                        ? 'In progress'
                        : 'Not started';

              return (
                <Collapsible
                  key={sid}
                  open={open}
                  onOpenChange={(o) => {
                    setHeatingStageOpen(sid, o);
                  }}
                  className="rounded-xl border border-border/60 bg-muted/10 overflow-hidden"
                >
                  <CollapsibleTrigger className="group flex w-full min-h-[52px] cursor-pointer items-start justify-between gap-2 px-3 py-3 text-left hover:bg-muted/25 sm:min-h-0 sm:items-center sm:py-2.5">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          {complete ? (
                            <CheckCircle2
                              className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                              aria-hidden
                            />
                          ) : (
                            <Circle
                              className={cn(
                                'h-5 w-5 shrink-0',
                                isFocus ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/50'
                              )}
                              aria-hidden
                            />
                          )}
                          <span className="text-sm font-semibold truncate">{stage.label}</span>
                          <Badge
                            variant="secondary"
                            className={cn(
                              'text-[10px] shrink-0 font-medium sm:text-[11px]',
                              (complete || isLocked) &&
                                'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
                              !complete &&
                                isFocus &&
                                'bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100 ring-1 ring-amber-400/80'
                            )}
                          >
                            {badgeLabel}
                          </Badge>
                        </div>
                        {!open ? (
                          <p className="text-xs text-muted-foreground leading-snug pl-7 sm:pl-0 line-clamp-2">
                            {heatingStageCollapseSummary(row)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 mt-0.5 sm:mt-0" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-3 border-t border-border/40 px-3 pb-3 pt-3">
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Measurements
                        </p>
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            placeholder="Resistance (Ω)"
                            value={row.resistance_ohm || ''}
                            className="h-11 text-base sm:text-sm"
                            disabled={stageReadOnly}
                            onChange={(e) => p.onHeatingFieldChange(stage.key, 'resistance_ohm', e.target.value)}
                          />
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            placeholder="Insulation (MΩ)"
                            value={row.insulation_mohm || ''}
                            className="h-11 text-base sm:text-sm"
                            disabled={stageReadOnly}
                            onChange={(e) => p.onHeatingFieldChange(stage.key, 'insulation_mohm', e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Recorded as
                        </p>
                        <HeatingPerformedRow
                          storedDate={row.date}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-[11px] text-muted-foreground">Note (optional)</span>
                        <Textarea
                          placeholder="Note (optional)"
                          value={row.note || ''}
                          className="text-base sm:text-sm min-h-[56px]"
                          disabled={stageReadOnly}
                          onChange={(e) => p.onHeatingFieldChange(stage.key, 'note', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Documentation photo for this stage
                          </p>
                          <p className="text-[11px] text-muted-foreground leading-snug">
                            Saved photos appear in the heating cable gallery below.
                          </p>
                        </div>
                        <HeatingStagePhotoPicker
                          registerInput={(suffix, el) => {
                            const map = heatingPhotoRefKeys(sid);
                            p.heatingPhotoInputRefs.current[map[suffix]] = el;
                          }}
                          disabled={stageReadOnly}
                          onFile={(file) => p.onHeatingStagePhotoChange(stage.key, file)}
                        />
                      </div>
                      {isLocked ? (
                        <div className="rounded-md border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/35 dark:text-emerald-100">
                          <p>
                            <span className="text-muted-foreground">Completed by: </span>
                            {row.completed_by_name?.trim() || row.completed_by?.trim() || 'Unknown'}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Time: </span>
                            {row.completed_at?.trim() ? formatVisitDateShort(row.completed_at) : 'unknown time'}
                          </p>
                        </div>
                      ) : !canAccessStage ? (
                        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-100">
                          Complete and lock the previous step before editing this step.
                        </div>
                      ) : null}
                      {!isLocked && canAccessStage ? (
                        <div className="space-y-2 rounded-md border border-border/60 bg-background/70 px-3 py-2.5">
                          <p className="text-[11px] text-muted-foreground leading-snug">
                            Navnet ditt logges automatisk når du bekrefter dette trinnet.
                          </p>
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-10 w-full"
                            disabled={stageReadOnly || Boolean(confirmBlockedReason)}
                            onClick={() => setConfirmStageKey(stage.key)}
                          >
                            Confirm step
                          </Button>
                          {confirmBlockedReason ? (
                            <p className="text-[11px] text-muted-foreground leading-snug">{confirmBlockedReason}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
            {(p.heatingCableDoc.extra_steps || []).map((step, idx) => {
              const photoKey = step.id || `extra-${idx}`;
              const visible = heatingExtraStepRowVisible(step);
              if (!visible) return null;
              const panelId = `extra:${idx}`;
              const complete = isHeatingCableStageComplete(step);
              const isFocus = focusStageId === panelId;
              const open = heatingStageOpen(panelId);
              const started = heatingStageHasAnyData(step);
              const badgeLabel = complete ? 'Complete' : isFocus ? 'Open' : started ? 'In progress' : 'Not started';

              return (
                <Collapsible
                  key={photoKey}
                  open={open}
                  onOpenChange={(o) => {
                    setHeatingStageOpen(panelId, o);
                  }}
                  className="rounded-xl border border-border/60 bg-muted/10 overflow-hidden"
                >
                  <CollapsibleTrigger className="group flex w-full min-h-[52px] cursor-pointer items-start justify-between gap-2 px-3 py-3 text-left hover:bg-muted/25 sm:min-h-0 sm:items-center sm:py-2.5">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          {complete ? (
                            <CheckCircle2
                              className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                              aria-hidden
                            />
                          ) : (
                            <Circle
                              className={cn(
                                'h-5 w-5 shrink-0',
                                isFocus ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/50'
                              )}
                              aria-hidden
                            />
                          )}
                          <span className="text-sm font-semibold truncate">
                            {step.label?.trim() || `Extra step ${idx + 1}`}
                          </span>
                          <Badge
                            variant="secondary"
                            className={cn(
                              'text-[10px] shrink-0 font-medium sm:text-[11px]',
                              complete &&
                                'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
                              !complete &&
                                isFocus &&
                                'bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100 ring-1 ring-amber-400/80'
                            )}
                          >
                            {badgeLabel}
                          </Badge>
                        </div>
                        {!open ? (
                          <p className="text-xs text-muted-foreground leading-snug pl-7 sm:pl-0 line-clamp-2">
                            {heatingStageCollapseSummary(step)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 mt-0.5 sm:mt-0" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-3 border-t border-border/40 px-3 pb-3 pt-3">
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Measurements
                        </p>
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            placeholder="Resistance (Ω)"
                            value={step.resistance_ohm || ''}
                            className="h-11 text-base sm:text-sm"
                            disabled={!p.canEditHeatingCable || p.heatingCableBlocking}
                            onChange={(e) => p.onExtraHeatingFieldChange(idx, 'resistance_ohm', e.target.value)}
                          />
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            placeholder="Insulation (MΩ)"
                            value={step.insulation_mohm || ''}
                            className="h-11 text-base sm:text-sm"
                            disabled={!p.canEditHeatingCable || p.heatingCableBlocking}
                            onChange={(e) => p.onExtraHeatingFieldChange(idx, 'insulation_mohm', e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Recorded as
                        </p>
                        <HeatingPerformedRow
                          storedDate={step.date}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-[11px] text-muted-foreground">Note (optional)</span>
                        <Textarea
                          placeholder="Note (optional)"
                          value={step.note || ''}
                          className="text-base sm:text-sm min-h-[56px]"
                          disabled={!p.canEditHeatingCable || p.heatingCableBlocking}
                          onChange={(e) => p.onExtraHeatingFieldChange(idx, 'note', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Documentation photo for this stage
                          </p>
                          <p className="text-[11px] text-muted-foreground leading-snug">
                            Saved photos appear in the heating cable gallery below.
                          </p>
                        </div>
                        <HeatingStagePhotoPicker
                          registerInput={(suffix, el) => {
                            const map = heatingPhotoRefKeys(photoKey);
                            p.heatingPhotoInputRefs.current[map[suffix]] = el;
                          }}
                          disabled={!p.canEditHeatingCable || p.heatingCableBlocking}
                          onFile={(file) => p.onHeatingStagePhotoChange(photoKey, file)}
                        />
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
            {heatingGallerySections.length > 0 ? (
              <div className="space-y-4 rounded-xl border border-border/55 bg-muted/[0.06] px-3 py-4 sm:px-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-foreground">Heating cable photos</p>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Grouped by stage. Tap a thumbnail to view the full image.
                  </p>
                </div>
                <div className="space-y-5">
                  {heatingGallerySections.map((sec) => (
                    <div key={sec.stageId} className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {sec.label}
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {sec.items.map((item) => (
                          <button
                            key={`${sec.stageId}-${item.objectKey}`}
                            type="button"
                            className="relative aspect-square overflow-hidden rounded-lg bg-slate-100 ring-1 ring-border/40 dark:bg-slate-800"
                            disabled={!item.displayUrl}
                            onClick={() => item.displayUrl && p.onPhotoPreview(item.displayUrl)}
                          >
                            {item.displayUrl ? (
                              <img src={item.displayUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <ImageIcon className="m-auto h-8 w-8 text-muted-foreground/35" aria-hidden />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {p.canEditHeatingCable &&
            !p.heatingLockedByAdmin &&
            !p.phaseReadOnly &&
            ((p.heatingCableDirty && !heatingCableSaveBusy) || p.heatingCableSaveStatus === 'error') ? (
              <Button
                type="button"
                variant="ghost"
                className="w-full h-10 text-xs font-medium text-muted-foreground hover:text-foreground"
                disabled={p.heatingCableBlocking || heatingCableSaveBusy}
                onClick={() => p.onSaveHeatingCable()}
              >
                {p.heatingCableSaveStatus === 'error' ? 'Retry save' : p.heatingCableManualSaveLabel}
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Complete phase — primary CTA after required work (checklist + heating) */}
      {showFullPhaseDetails && p.phaseCompleteEligible && !p.phaseReadOnly ? (
        <Card
          id="worker-complete-phase"
          className="scroll-mt-20 overflow-hidden border-2 border-emerald-500/50 bg-gradient-to-b from-emerald-50/90 to-emerald-50/40 shadow-lg dark:from-emerald-950/50 dark:to-emerald-950/25 dark:border-emerald-600/45"
        >
          <div className="space-y-4 p-5 sm:p-6">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800/90 dark:text-emerald-200/90">
                Mark progress
              </p>
              <p className="text-xl font-bold tracking-tight text-emerald-950 dark:text-emerald-50">
                Phase ready for handoff
              </p>
              <p className="text-sm leading-snug text-emerald-900/85 dark:text-emerald-100/85">
                Required work for {selectedLabel} is documented. Hand off when it matches the site.
              </p>
            </div>
            <Button
              type="button"
              size="lg"
              className="h-14 min-h-14 w-full px-6 text-lg font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md sm:h-12 sm:min-h-12 sm:text-base"
              disabled={p.completingPhase}
              onClick={() => setPhaseHandoffDialogOpen(true)}
            >
              Mark phase complete
            </Button>
          </div>
        </Card>
      ) : null}

      <Dialog
        open={phaseHandoffDialogOpen}
        onOpenChange={(open) => {
          if (!open && p.completingPhase) return;
          setPhaseHandoffDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-md gap-4 px-5 pb-6 pt-6 max-sm:fixed max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:max-h-[min(88dvh,560px)] max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 max-sm:overflow-y-auto sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%]">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="text-xl leading-snug">Confirm phase handoff</DialogTitle>
            <DialogDescription className="text-left text-base leading-relaxed text-muted-foreground">
              You are confirming that work for{' '}
              <span className="font-medium text-foreground">{selectedLabel}</span> is complete and correct
              on site.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2.5 text-sm leading-snug text-foreground/90">
            <li className="flex gap-2.5">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                This phase will lock—you won't change checklist or heating documentation here anymore.
              </span>
            </li>
            <li className="flex gap-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <span>
                {nextPhaseLabelAfterHandoff ? (
                  <>
                    Handoff is recorded for admin review. The board moves forward to{' '}
                    <span className="font-medium text-foreground">{nextPhaseLabelAfterHandoff}</span> when
                    the project advances.
                  </>
                ) : (
                  <>
                    Handoff is recorded for admin review. This was the last workflow step for this room.
                  </>
                )}
              </span>
            </li>
          </ul>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={p.completingPhase}
              onClick={() => setPhaseHandoffDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
              disabled={p.completingPhase}
              onClick={() => {
                void (async () => {
                  const next = await Promise.resolve(p.onCompletePhase());
                  if (next) setPhaseHandoffDialogOpen(false);
                })();
              }}
            >
              {p.completingPhase ? 'Recording…' : 'Confirm handoff'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmStageKey !== null} onOpenChange={(open) => !open && setConfirmStageKey(null)}>
        <DialogContent className="max-w-md gap-4 px-5 pb-6 pt-6">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="text-xl leading-snug">Confirm step</DialogTitle>
            <DialogDescription className="text-left text-base leading-relaxed text-muted-foreground">
              Are you sure you want to confirm this step? The server will stamp the current time and signed-in worker.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setConfirmStageKey(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
              disabled={p.heatingCableBlocking}
              onClick={() => {
                if (!confirmStageKey) return;
                void p.onCompleteHeatingStage(confirmStageKey);
                setConfirmStageKey(null);
              }}
            >
              {p.heatingCableBlocking ? 'Confirming...' : 'Confirm step'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase photos — collapsed by default (excludes heating stage uploads when Varmekabel is primary) */}
      {showFullPhaseDetails && p.showPhotosSection && p.photosForPhase.length > 0 ? (
        <Collapsible defaultOpen={false} className="rounded-xl border border-border/40 bg-card shadow-sm">
          <CollapsibleTrigger className="group flex w-full min-h-11 items-center justify-between gap-2 px-3 py-2.5 text-left sm:min-h-0 sm:px-4 sm:py-3">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {heatingCablePhasePrimary ? 'Other photos this phase' : 'Photos this phase'}
              </span>
              <span className="text-sm font-medium text-foreground">
                {p.photosForPhase.length} photo{p.photosForPhase.length === 1 ? '' : 's'}
              </span>
              {heatingCablePhasePrimary ? (
                <span className="text-xs text-muted-foreground leading-snug pt-0.5">
                  Read-only summary of general uploads for this step — heating cable documentation lives in the gallery
                  above.
                </span>
              ) : null}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border/35 px-3 pb-3 pt-2 sm:px-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {p.photosForPhase.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    className="flex gap-2 rounded-lg border border-border/35 bg-muted/10 p-2 text-left hover:bg-muted/20"
                    onClick={() => photo.downloadUrl && p.onPhotoPreview(photo.downloadUrl)}
                  >
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                      {photo.downloadUrl ? (
                        <img src={photo.downloadUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="m-auto h-6 w-6 text-muted-foreground/40" />
                      )}
                    </div>
                    <span className="min-w-0 flex-1 text-[11px] text-muted-foreground leading-snug">
                      {photo.caption?.trim()
                        ? photo.caption.trim()
                        : photo.filename
                          ? photo.filename
                          : 'Phase photo'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {/* Issues & activity — secondary */}
      {showFullPhaseDetails ? (
        <Card className="overflow-hidden border-border/20 bg-muted/[0.04] shadow-none">
          <p className="border-b border-border/20 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            More on this phase
          </p>
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger
              id="worker-report-issue"
              className="group flex w-full min-h-[44px] cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted/25 sm:min-h-0"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600/90" />
                <span className="leading-snug">Report issue</span>
                {p.deviations.length > 0 ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {p.deviations.length}
                  </Badge>
                ) : null}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-2 border-t border-border/25 px-3 pb-3 pt-2">
                {p.deviations.length > 0 ? (
                  <ul className="space-y-2">
                    {p.deviations.map((d) => (
                      <li
                        key={d.id}
                        className={cn(
                          'rounded-md border px-2.5 py-2 text-sm',
                          d.status === 'resolved'
                            ? 'border-border/60 bg-muted/20'
                            : 'border-amber-200/70 bg-amber-50/50 dark:bg-amber-950/25'
                        )}
                      >
                        <span className="block leading-snug">{d.text}</span>
                        {d.reported_by?.trim() ? (
                          <span className="mt-1 block text-[11px] text-muted-foreground">
                            Reported by {d.reported_by.trim()}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No issues logged for this phase.</p>
                )}
                {p.canAddDeviation ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch pt-1">
                    <Input
                      placeholder="Describe the issue…"
                      value={p.newDeviationText}
                      onChange={(e) => p.onNewDeviationChange(e.target.value)}
                      className="h-12 min-h-12 text-base sm:h-11 sm:min-h-11 sm:text-sm"
                      disabled={p.savingDeviations}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') p.onAddDeviation();
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-12 min-h-12 w-full shrink-0 sm:h-11 sm:min-h-11 sm:w-auto"
                      disabled={!p.newDeviationText.trim() || p.savingDeviations}
                      onClick={() => p.onAddDeviation()}
                    >
                      Add
                    </Button>
                  </div>
                ) : null}
              </div>
            </CollapsibleContent>
          </Collapsible>
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger className="group flex w-full min-h-[44px] cursor-pointer items-center justify-between gap-3 border-t border-border/25 px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted/25 sm:min-h-0">
              <span className="flex items-center gap-2.5">
                <History className="h-4 w-4 shrink-0 opacity-80" />
                Activity
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="max-h-48 space-y-1.5 overflow-y-auto border-t border-border/25 px-3 pb-3 pt-2 text-xs">
                {p.activityEntries.length === 0 ? (
                  <p className="text-muted-foreground py-1">Nothing logged for this phase yet.</p>
                ) : (
                  p.activityEntries.map((row, i) => (
                    <div
                      key={row.rowKey}
                      className="flex gap-2 border-b border-border/25 pb-1.5 last:border-0"
                    >
                      <span className="w-14 shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
                        <span className="inline-flex flex-col items-end gap-0.5 leading-tight">
                          <span>{p.formatActivityWhen(row.t)}</span>
                          {i === 0 ? (
                            <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/75">
                              Latest
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="min-w-0 leading-snug">{row.msg}</span>
                    </div>
                  ))
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      ) : null}
    </div>
  );
}
