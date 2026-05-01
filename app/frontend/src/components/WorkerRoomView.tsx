import { RefObject, useEffect, useMemo, useRef, type ChangeEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Camera,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
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
  formatHeatingCableDatetimeLocalNow,
  getHeatingCableFocusTarget,
  heatingCableDateForDatetimeLocalInput,
  heatingDocumentationProgress,
  heatingExtraStepRowVisible,
  heatingStageHasAnyData,
  isHeatingCableStageComplete,
  type HeatingCableDoc,
  type HeatingCableDerived,
  type HeatingCableStage,
  type HeatingCableStageKey,
} from '@/lib/heatingCable';
import type { PhaseWorkflowEntry } from '@/lib/roomPhases';
import { phaseLabel, phaseTimelineState } from '@/lib/roomPhases';
import { cn } from '@/lib/utils';

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
};

export type WorkerDeviation = {
  id: string;
  text: string;
  status: 'open' | 'resolved';
};

type Props = {
  roomNumber: string;
  areaName: string | null;
  showAreasNav: boolean;
  areasList: { id: string; name: string }[];
  activeAreaId: string;
  onAreaChange: (id: string) => void;

  phaseWorkflow: PhaseWorkflowEntry[];
  /** Current board / active workflow phase for this area */
  boardPhaseKey: string;
  /** Selected phase tab (may differ when reviewing history) */
  selectedPhaseKey: string;
  onPhaseSelect: (key: string) => void;

  /** Hero metrics: tasks for the board phase */
  boardPhaseIncompleteCount: number;
  boardPhaseTotalCount: number;
  boardPhaseShowHeating: boolean;
  /** True when checklist + heating (if applicable) for the board phase are satisfied. */
  boardPhaseWorkReady: boolean;
  heatingDerived: HeatingCableDerived;

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
  savingHeatingCable: boolean;
  heatingLockedByAdmin: boolean;
  heatingPhotoInputRefs: RefObject<Record<string, HTMLInputElement | null>>;
  onHeatingFieldChange: (
    stageKey: HeatingCableStageKey,
    field: 'resistance_ohm' | 'insulation_mohm' | 'date' | 'performed_by' | 'note',
    value: string
  ) => void;
  onExtraHeatingFieldChange: (
    index: number,
    field: 'label' | 'resistance_ohm' | 'insulation_mohm' | 'date' | 'performed_by' | 'note',
    value: string
  ) => void;
  onHeatingStagePhotoChange: (stageId: string, file?: File) => void;
  onSaveHeatingCable: () => void;
  onPhotoPreview: (url: string) => void;

  /** Session display name — seeds empty "Performed by" / date on the active stage only. */
  heatingDefaultPerformedBy?: string;
  /** When this value changes (e.g. room id), one-time default seeding runs again for the new context. */
  heatingCableSeedResetKey?: string | number;

  showPhotosSection: boolean;
  canUploadPhoto: boolean;
  canMutatePhaseMedia: boolean;
  uploadingPhoto: boolean;
  onGeneralPhotoClick: () => void;
  photosForPhase: WorkerPhoto[];
  legacySavedWorkerName?: string;
  onClearSavedWorkerName?: () => void;

  activityEntries: { t: number; msg: string }[];
  formatActivityWhen: (ts: number) => string;

  deviations: WorkerDeviation[];
  newDeviationText: string;
  onNewDeviationChange: (v: string) => void;
  onAddDeviation: () => void;
  canAddDeviation: boolean;
  savingDeviations: boolean;

  roomStatusLabel: string;
  roomStatusClassName: string;
  blockedReason?: string | null;
  dueLine: string | null;
  duePast: boolean;

  phaseCompleteEligible: boolean;
  onCompletePhase: () => void;
  completingPhase?: boolean;
};

function formatVisitDateShort(dateStr: string): string {
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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

/** Registers input with parent map ref; sr-only file control + dashed upload affordance. */
function StyledFilePhotoTrigger(props: {
  registerInput: (el: HTMLInputElement | null) => void;
  disabled?: boolean;
  onFile: (file?: File) => void;
}) {
  const localRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={(el) => {
          localRef.current = el;
          props.registerInput(el);
        }}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        disabled={props.disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          props.onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => localRef.current?.click()}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/15 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:gap-3 sm:py-2.5"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border/40">
          <Camera className="h-4 w-4 text-muted-foreground" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">Add photo</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">Camera or gallery</span>
        </span>
      </button>
    </>
  );
}

/** Wraps native `datetime-local` with spacing for a calendar affordance (still uses OS picker). */
function HeatingDatetimeField(props: {
  id?: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Calendar
        className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={props.id}
        type="datetime-local"
        step={60}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        className={cn(
          'h-11 pl-10 text-sm [color-scheme:light] dark:[color-scheme:dark]',
          '[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-2 [&::-webkit-calendar-picker-indicator]:top-1/2 [&::-webkit-calendar-picker-indicator]:h-5 [&::-webkit-calendar-picker-indicator]:w-5 [&::-webkit-calendar-picker-indicator]:-translate-y-1/2 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70'
        )}
      />
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
  const selectedLabel = phaseLabel(p.selectedPhaseKey, p.phaseWorkflow);
  const boardLabel = phaseLabel(p.boardPhaseKey, p.phaseWorkflow);
  const viewingNonBoard = p.selectedPhaseKey !== p.boardPhaseKey;
  const phaseTimeline = phaseTimelineState(p.boardPhaseKey, p.selectedPhaseKey, p.phaseWorkflow);

  const [nonBoardDetailsExpanded, setNonBoardDetailsExpanded] = useState(false);
  useEffect(() => {
    setNonBoardDetailsExpanded(false);
  }, [p.selectedPhaseKey]);
  const showFullPhaseDetails = !viewingNonBoard || nonBoardDetailsExpanded;
  const boardHeatingDocProgress = p.boardPhaseShowHeating
    ? heatingDocumentationProgress(p.heatingCableDoc)
    : null;
  const selectedHeatingDocProgress = p.showHeatingModule
    ? heatingDocumentationProgress(p.heatingCableDoc)
    : null;
  const heatingStatusLabel: Record<string, string> = {
    not_started: 'Not started',
    partial: 'In progress',
    complete: 'Complete',
    has_deviation_missing: 'Needs attention',
  };

  const workflowKeys = p.phaseWorkflow.map((x) => x.key);

  const focusTarget = useMemo(() => getHeatingCableFocusTarget(p.heatingCableDoc), [p.heatingCableDoc]);
  const focusStageId = useMemo(() => {
    if (!focusTarget) return 'all-complete';
    return focusTarget.kind === 'main' ? focusTarget.key : `extra:${focusTarget.index}`;
  }, [focusTarget]);

  const [heatingOpenOverrides, setHeatingOpenOverrides] = useState<Record<string, boolean>>({});
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

  const heatingSeedKeyRef = useRef<string | null>(null);
  const heatingResetKeyRef = useRef<string | number | undefined>(p.heatingCableSeedResetKey);
  useEffect(() => {
    if (p.heatingCableSeedResetKey !== heatingResetKeyRef.current) {
      heatingResetKeyRef.current = p.heatingCableSeedResetKey;
      heatingSeedKeyRef.current = null;
    }
  }, [p.heatingCableSeedResetKey]);

  useEffect(() => {
    if (!p.canEditHeatingCable || !p.heatingDefaultPerformedBy?.trim()) return;
    const ft = focusTarget;
    if (!ft) return;
    const sk = ft.kind === 'main' ? `main:${ft.key}` : `extra:${ft.index}`;
    if (heatingSeedKeyRef.current === sk) return;
    heatingSeedKeyRef.current = sk;

    const def = p.heatingDefaultPerformedBy.trim();
    const now = formatHeatingCableDatetimeLocalNow();

    if (ft.kind === 'main') {
      const row = p.heatingCableDoc[ft.key] || {};
      if (!row.performed_by?.trim()) p.onHeatingFieldChange(ft.key, 'performed_by', def);
      if (!row.date?.trim()) p.onHeatingFieldChange(ft.key, 'date', now);
    } else {
      const row = p.heatingCableDoc.extra_steps?.[ft.index];
      if (!row?.performed_by?.trim()) p.onExtraHeatingFieldChange(ft.index, 'performed_by', def);
      if (!row?.date?.trim()) p.onExtraHeatingFieldChange(ft.index, 'date', now);
    }
  }, [
    p.canEditHeatingCable,
    p.heatingDefaultPerformedBy,
    focusTarget,
    p.heatingCableDoc,
    p.onHeatingFieldChange,
    p.onExtraHeatingFieldChange,
  ]);

  const focusStageLabel = useMemo(() => {
    if (!focusTarget) return null;
    if (focusTarget.kind === 'main') {
      return HEATING_CABLE_STAGES.find((s) => s.key === focusTarget.key)?.label ?? focusTarget.key;
    }
    const step = p.heatingCableDoc.extra_steps?.[focusTarget.index];
    return step?.label?.trim() || `Extra step ${focusTarget.index + 1}`;
  }, [focusTarget, p.heatingCableDoc.extra_steps]);

  const nonBoardFocus = useMemo(() => {
    if (p.phaseTabLocked && phaseTimeline === 'upcoming') {
      return {
        badge: 'Locked',
        badgeClass:
          'border-amber-300/80 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100',
        description:
          'Upcoming after the current phase. Use View details for the full record, or jump back to focus on today\'s work.',
      };
    }
    if (p.phaseTabLocked) {
      return {
        badge: 'Locked',
        badgeClass:
          'border-slate-300/80 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100',
        description: 'This phase is locked for editing. You can still open details to review history.',
      };
    }
    if (phaseTimeline === 'done') {
      return {
        badge: 'Completed',
        badgeClass:
          'border-emerald-300/80 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-100',
        description:
          'Earlier phase on this room. Open details anytime for checklist entries, documentation, and photos.',
      };
    }
    return {
      badge: 'Upcoming',
      badgeClass:
        'border-blue-300/70 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100',
      description:
        'You may work ahead when ready. Details stay collapsed here so the active phase stays in focus.',
    };
  }, [p.phaseTabLocked, phaseTimeline]);

  const firstIncompleteTaskId = useMemo(() => {
    const t = p.tasksForSelectedPhase.find((x) => !x.is_completed);
    return t?.id ?? null;
  }, [p.tasksForSelectedPhase]);

  const compactSummaryLines = useMemo(() => {
    const lines: string[] = [];
    const tasks = p.tasksForSelectedPhase;
    if (tasks.length > 0) {
      const done = tasks.filter((t) => t.is_completed).length;
      lines.push(`Checklist ${done}/${tasks.length} done`);
    } else {
      lines.push('No checklist items in this phase');
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
    p.showHeatingModule,
    selectedHeatingDocProgress,
    p.showPhotosSection,
    p.photosForPhase.length,
    p.deviations.length,
    p.activityEntries.length,
  ]);

  const heroWorkState = useMemo(() => {
    if (p.blockedReason) {
      return {
        label: 'Blocked',
        className:
          'border-red-400/50 bg-red-50 text-red-950 dark:border-red-900/60 dark:bg-red-950/45 dark:text-red-50',
      };
    }
    if (p.editsBlocked) {
      return {
        label: 'View only',
        className: 'border-border/70 bg-muted/50 text-muted-foreground',
      };
    }
    if (p.phaseCompleteEligible && !p.phaseReadOnly) {
      return {
        label: 'Ready',
        className:
          'border-emerald-400/55 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-50',
      };
    }
    if (p.boardPhaseWorkReady) {
      return {
        label: 'On track',
        className:
          'border-teal-400/45 bg-teal-50/90 text-teal-950 dark:border-teal-800 dark:bg-teal-950/35 dark:text-teal-50',
      };
    }
    return {
      label: 'In progress',
      className: 'border-[#1E3A5F]/25 bg-background/90 text-foreground dark:border-blue-800/50 dark:bg-background/80',
    };
  }, [
    p.blockedReason,
    p.editsBlocked,
    p.phaseCompleteEligible,
    p.phaseReadOnly,
    p.boardPhaseWorkReady,
  ]);

  const nextStepBanner = useMemo(() => {
    if (p.blockedReason) return null;
    if (p.editsBlocked) {
      return {
        tone: 'muted' as const,
        title: 'Next step',
        body: 'This room is view-only - you can review details below.',
      };
    }
    if (viewingNonBoard) {
      return {
        tone: 'neutral' as const,
        title: 'Where you are',
        body: `Today's work is in "${boardLabel}". Jump below when you're ready to continue there.`,
      };
    }
    if (p.phaseCompleteEligible && !p.phaseReadOnly) {
      return {
        tone: 'success' as const,
        title: 'Next step',
        body: 'Complete the phase — your checklist and required documentation are done.',
      };
    }
    const firstIncomplete = p.tasksForSelectedPhase.find((t) => !t.is_completed);
    if (firstIncomplete) {
      return {
        tone: 'primary' as const,
        title: 'Next step',
        body: firstIncomplete.name,
      };
    }
    if (p.boardPhaseShowHeating && !p.boardPhaseWorkReady && focusStageLabel) {
      return {
        tone: 'primary' as const,
        title: 'Next step',
        body: `Heating cable · ${focusStageLabel}`,
      };
    }
    if (p.boardPhaseShowHeating && boardHeatingDocProgress && !p.boardPhaseWorkReady) {
      return {
        tone: 'primary' as const,
        title: 'Next step',
        body: `Finish heating documentation (${boardHeatingDocProgress.complete}/${boardHeatingDocProgress.total} stages done).`,
      };
    }
    return {
      tone: 'muted' as const,
      title: 'Status',
      body: p.boardPhaseWorkReady
        ? 'Required work for this phase is complete - finish below when you are ready.'
        : 'Continue in the checklist and sections below.',
    };
  }, [
    p.blockedReason,
    p.editsBlocked,
    viewingNonBoard,
    boardLabel,
    p.phaseCompleteEligible,
    p.phaseReadOnly,
    p.tasksForSelectedPhase,
    p.boardPhaseShowHeating,
    p.boardPhaseWorkReady,
    focusStageLabel,
    boardHeatingDocProgress,
  ]);

  const heroStatPrimary = useMemo(() => {
    if (p.boardPhaseTotalCount > 0) {
      return {
        label: 'Tasks left',
        value: String(p.boardPhaseIncompleteCount),
        sub:
          p.boardPhaseTotalCount > 0
            ? `${p.boardPhaseTotalCount - p.boardPhaseIncompleteCount}/${p.boardPhaseTotalCount} done`
            : undefined,
      };
    }
    if (p.boardPhaseShowHeating && boardHeatingDocProgress) {
      const left = boardHeatingDocProgress.total - boardHeatingDocProgress.complete;
      return {
        label: 'Doc stages left',
        value: String(Math.max(0, left)),
        sub: `${boardHeatingDocProgress.complete}/${boardHeatingDocProgress.total} complete`,
      };
    }
    return {
      label: 'Tasks left',
      value: '0',
      sub: 'No checklist items',
    };
  }, [p.boardPhaseTotalCount, p.boardPhaseIncompleteCount, p.boardPhaseShowHeating, boardHeatingDocProgress]);

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-3 py-4 sm:space-y-4 sm:px-4 sm:py-5 lg:max-w-xl">
      {/* Room hero — room #, phase, tasks, ready/blocked, next step */}
      <Card className="overflow-hidden border-[#1E3A5F]/20 bg-gradient-to-br from-[#1E3A5F]/[0.09] via-background to-background shadow-md ring-1 ring-black/[0.03] dark:from-blue-950/45 dark:via-background dark:to-background dark:ring-white/[0.06]">
        <div className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <Badge
              className={cn(
                'border-0 text-[10px] font-semibold uppercase tracking-wide sm:text-[10px]',
                p.roomStatusClassName
              )}
            >
              {p.roomStatusLabel}
            </Badge>
            {p.dueLine ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums sm:text-[10px]',
                  p.duePast
                    ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                    : 'text-muted-foreground'
                )}
              >
                <Clock className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                Due {p.dueLine}
                {p.duePast ? <span className="font-semibold"> · Overdue</span> : null}
              </span>
            ) : null}
          </div>

          <div className="space-y-1">
            {p.areaName ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/90">
                {p.areaName}
              </p>
            ) : null}
            <h1 className="text-[2rem] font-bold leading-[1.05] tracking-tight text-foreground sm:text-[2.25rem]">
              {p.roomNumber}
            </h1>
          </div>

          <div className="rounded-xl border border-border/50 bg-background/60 px-3.5 py-3 dark:bg-background/40">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Current phase
            </p>
            <p className="mt-1 text-lg font-semibold leading-snug text-foreground sm:text-xl">{boardLabel}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col justify-between rounded-xl border border-border/50 bg-background/70 px-3.5 py-3 dark:bg-background/50">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {heroStatPrimary.label}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-foreground">
                {heroStatPrimary.value}
              </p>
              {heroStatPrimary.sub ? (
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{heroStatPrimary.sub}</p>
              ) : null}
            </div>
            <div className="flex flex-col justify-between rounded-xl border border-border/50 bg-background/70 px-3.5 py-3 dark:bg-background/50">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Work status
              </p>
              <div className="mt-2 flex flex-1 flex-col justify-center">
                <span
                  className={cn(
                    'inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold',
                    heroWorkState.className
                  )}
                >
                  {heroWorkState.label}
                </span>
                {p.boardPhaseShowHeating ? (
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                    Heating ·{' '}
                    <span className="font-medium text-foreground/90">
                      {p.boardPhaseWorkReady ? 'Done' : heatingStatusLabel[p.heatingDerived.status]}
                    </span>
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {nextStepBanner ? (
            <div
              className={cn(
                'rounded-xl border px-3.5 py-3 sm:px-4 sm:py-3.5',
                nextStepBanner.tone === 'primary' &&
                  'border-[#1E3A5F]/35 bg-[#1E3A5F]/[0.07] dark:border-blue-600/50 dark:bg-blue-950/35',
                nextStepBanner.tone === 'success' &&
                  'border-emerald-400/45 bg-emerald-50/95 dark:border-emerald-700/50 dark:bg-emerald-950/40',
                nextStepBanner.tone === 'neutral' &&
                  'border-border/60 bg-muted/30 dark:bg-muted/20',
                nextStepBanner.tone === 'muted' && 'border-border/50 bg-muted/20'
              )}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                    nextStepBanner.tone === 'primary' &&
                      'bg-[#1E3A5F]/15 text-[#1E3A5F] dark:bg-blue-500/20 dark:text-blue-200',
                    nextStepBanner.tone === 'success' &&
                      'bg-emerald-600/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-100',
                    nextStepBanner.tone === 'neutral' && 'bg-muted text-muted-foreground',
                    nextStepBanner.tone === 'muted' && 'bg-muted/80 text-muted-foreground'
                  )}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p
                    className={cn(
                      'text-[10px] font-bold uppercase tracking-[0.14em]',
                      nextStepBanner.tone === 'primary' && 'text-[#1E3A5F]/90 dark:text-blue-300/90',
                      nextStepBanner.tone === 'success' && 'text-emerald-800 dark:text-emerald-200',
                      nextStepBanner.tone === 'neutral' && 'text-muted-foreground',
                      nextStepBanner.tone === 'muted' && 'text-muted-foreground'
                    )}
                  >
                    {nextStepBanner.title}
                  </p>
                  <p
                    className={cn(
                      'text-[15px] font-semibold leading-snug sm:text-base',
                      nextStepBanner.tone === 'primary' && 'text-foreground',
                      nextStepBanner.tone === 'success' && 'text-emerald-950 dark:text-emerald-50',
                      nextStepBanner.tone === 'neutral' && 'text-foreground/95',
                      nextStepBanner.tone === 'muted' && 'text-muted-foreground'
                    )}
                  >
                    {nextStepBanner.body}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {p.blockedReason ? (
            <div className="flex gap-2 rounded-xl border border-red-300/60 bg-red-50/95 px-3.5 py-3 text-sm text-red-950 dark:border-red-900/55 dark:bg-red-950/45 dark:text-red-50">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                <span className="font-semibold">Blocked</span>
                <p className="mt-1 text-xs leading-relaxed text-red-900/95 dark:text-red-100/90">
                  {p.blockedReason}
                </p>
              </div>
            </div>
          ) : null}

          {p.editsBlocked ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-border/55 bg-muted/25 px-3.5 py-3 text-xs text-muted-foreground">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
              <span className="leading-relaxed">This room is locked for editing.</span>
            </div>
          ) : null}
        </div>
      </Card>

      {/* Area picker — secondary, compact */}
      {p.showAreasNav && p.areasList.length > 0 ? (
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
      ) : null}

      {/* Phase tabs — low visual weight, scroll on narrow viewports */}
      {workflowKeys.length > 1 ? (
        <div className="rounded-lg border border-border/35 bg-muted/5 px-2 py-2 sm:py-1.5">
          <p className="mb-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Phases
          </p>
          <div className="-mx-0.5 overflow-x-auto overscroll-x-contain px-0.5 [-webkit-overflow-scrolling:touch]">
            <div className="flex w-max max-w-none gap-1.5 pb-0.5">
              {workflowKeys.map((key) => {
                const isBoard = key === p.boardPhaseKey;
                const isSel = key === p.selectedPhaseKey;
                return (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      'flex max-w-[14rem] shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:max-w-none sm:py-1.5 sm:text-xs',
                      isSel
                        ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white shadow-sm dark:border-blue-600 dark:bg-blue-700'
                        : 'border-border/30 bg-background/80 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                      !isSel && !isBoard && 'opacity-80'
                    )}
                    onClick={() => p.onPhaseSelect(key)}
                  >
                    {isBoard ? (
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          isSel ? 'bg-amber-300' : 'bg-amber-500/90'
                        )}
                        aria-hidden
                      />
                    ) : null}
                    <span className="truncate">{phaseLabel(key, p.phaseWorkflow)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {viewingNonBoard ? (
        <Card className="overflow-hidden border-[#1E3A5F]/20 bg-muted/20 shadow-sm">
          <div className="p-4 space-y-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Not the active phase
                </p>
                <p className="text-lg font-semibold tracking-tight leading-snug">{selectedLabel}</p>
                <p className="text-sm text-muted-foreground">
                  Current focus: <span className="font-medium text-foreground">{boardLabel}</span>
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
            <p className="text-sm text-muted-foreground leading-snug">{nonBoardFocus.description}</p>
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
                Jump to active phase
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
        <section aria-labelledby="worker-checklist-heading" className="scroll-mt-20">
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
                const showPhasePhotoHere =
                  !task.is_completed &&
                  task.id === firstIncompleteTaskId &&
                  p.showPhotosSection &&
                  p.canUploadPhoto;
                return (
                  <Card
                    key={task.id}
                    className={cn(
                      'transition-colors',
                      task.is_completed
                        ? 'border-border/50 bg-emerald-50/25 shadow-none dark:bg-emerald-950/15'
                        : 'border-border/60 bg-card shadow-sm hover:bg-muted/25'
                    )}
                  >
                    <div className="flex flex-col">
                      <button
                        type="button"
                        className={cn(
                          'flex-1 text-left flex items-start gap-4 rounded-t-lg',
                          'p-4 min-h-[4rem] sm:p-4 sm:min-h-[3.75rem]',
                          !p.canInteractChecklist && 'opacity-60 cursor-not-allowed'
                        )}
                        disabled={!p.canInteractChecklist}
                        onClick={() => p.onTaskClick(task)}
                      >
                        <div className="shrink-0 mt-0.5">
                          {task.is_completed ? (
                            <CheckCircle2
                              className="h-7 w-7 text-emerald-600 dark:text-emerald-400 sm:h-7 sm:w-7"
                              aria-hidden
                            />
                          ) : (
                            <Circle
                              className="h-7 w-7 text-muted-foreground/45 sm:h-7 sm:w-7"
                              aria-hidden
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <p
                            className={cn(
                              'font-medium leading-snug',
                              task.is_completed
                                ? 'text-sm line-through text-muted-foreground'
                                : 'text-base text-foreground'
                            )}
                          >
                            {task.name}
                          </p>
                          {task.checked_by ? (
                            <p className="hidden text-[11px] text-muted-foreground sm:flex items-center gap-1.5">
                              <User className="h-3 w-3" />
                              {task.checked_by}
                              {task.checked_at ? (
                                <>
                                  <span className="opacity-50">·</span>
                                  <Clock className="h-3 w-3" />
                                  {formatVisitDateShort(task.checked_at)}
                                </>
                              ) : null}
                            </p>
                          ) : null}
                        </div>
                      </button>
                      {showPhasePhotoHere ? (
                        <div className="border-t border-border/40 bg-muted/20 px-4 pb-4 pt-3 dark:bg-muted/10 sm:px-6 sm:pb-5">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Photo for this task
                          </p>
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-12 min-h-12 w-full gap-2 text-base font-semibold shadow-sm sm:h-11"
                            disabled={!p.canMutatePhaseMedia || p.uploadingPhoto}
                            onClick={(e) => {
                              e.stopPropagation();
                              p.onGeneralPhotoClick();
                            }}
                          >
                            <Camera className="h-5 w-5 shrink-0" />
                            Add photo
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </Card>
                );
              })
            )}
            {p.tasksForSelectedPhase.length > 0 &&
            p.tasksForSelectedPhase.every((t) => t.is_completed) &&
            p.showPhotosSection &&
            p.canUploadPhoto ? (
              <Card className="border-dashed border-border/60 bg-muted/15 p-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground">Phase documentation</p>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 w-full gap-2 font-medium"
                  disabled={!p.canMutatePhaseMedia || p.uploadingPhoto}
                  onClick={() => p.onGeneralPhotoClick()}
                >
                  <Camera className="h-4 w-4 shrink-0" />
                  Add photo
                </Button>
              </Card>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Heating cable — collapsible stages, defaults on active step */}
      {showFullPhaseDetails && p.showHeatingModule ? (
        <Card className="overflow-hidden border-border/60 shadow-sm">
          <div className="border-b border-border/50 bg-muted/30 px-4 py-3 space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Heating cable</h2>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Open each stage to enter readings and photos. Completed stages stay collapsed so you can scan progress.
            </p>
            {focusStageLabel ? (
              <p className="text-xs font-medium text-amber-900/90 dark:text-amber-100/90 flex items-center gap-1.5">
                <span className="text-muted-foreground font-normal">Next up:</span>
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
              const sid = stage.key;
              const complete = isHeatingCableStageComplete(row);
              const isFocus = focusStageId === sid;
              const open = heatingStageOpen(sid);
              const started = heatingStageHasAnyData(row);
              const badgeLabel = complete ? 'Complete' : isFocus ? 'Now' : started ? 'In progress' : 'Not started';

              return (
                <Collapsible
                  key={sid}
                  open={open}
                  onOpenChange={(o) => setHeatingStageOpen(sid, o)}
                  className="rounded-xl border border-border/60 bg-muted/10 overflow-hidden"
                >
                  <CollapsibleTrigger className="group flex w-full min-h-[52px] cursor-pointer items-start justify-between gap-2 px-3 py-3 text-left hover:bg-muted/25 sm:min-h-0 sm:items-center sm:py-2.5">
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
                          {heatingStageCollapseSummary(row)}
                        </p>
                      ) : null}
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
                            placeholder="Resistance (Ω)"
                            value={row.resistance_ohm || ''}
                            className="h-11 text-sm"
                            disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                            onChange={(e) => p.onHeatingFieldChange(stage.key, 'resistance_ohm', e.target.value)}
                          />
                          <Input
                            placeholder="Insulation (MΩ)"
                            value={row.insulation_mohm || ''}
                            className="h-11 text-sm"
                            disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                            onChange={(e) => p.onHeatingFieldChange(stage.key, 'insulation_mohm', e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Recorded as
                        </p>
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`heat-${sid}-when`} className="text-[11px] font-medium text-muted-foreground">
                              When
                            </Label>
                            <HeatingDatetimeField
                              id={`heat-${sid}-when`}
                              value={heatingCableDateForDatetimeLocalInput(row.date)}
                              disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                              onChange={(v) => p.onHeatingFieldChange(stage.key, 'date', v)}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`heat-${sid}-by`} className="text-[11px] font-medium text-muted-foreground">
                              Performed by
                            </Label>
                            <Input
                              id={`heat-${sid}-by`}
                              placeholder="Name"
                              value={row.performed_by || ''}
                              className="h-11 text-sm"
                              disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                              onChange={(e) => p.onHeatingFieldChange(stage.key, 'performed_by', e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[11px] text-muted-foreground">Note (optional)</span>
                        <Textarea
                          placeholder="Note (optional)"
                          value={row.note || ''}
                          className="text-sm min-h-[56px]"
                          disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                          onChange={(e) => p.onHeatingFieldChange(stage.key, 'note', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Photos
                        </p>
                        <StyledFilePhotoTrigger
                          registerInput={(el) => {
                            p.heatingPhotoInputRefs.current[stage.key] = el;
                          }}
                          disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                          onFile={(file) => p.onHeatingStagePhotoChange(stage.key, file)}
                        />
                        {Array.isArray(row.photos) && row.photos.length > 0 ? (
                          <div className="grid grid-cols-3 gap-2">
                            {row.photos.map((url, pi) => (
                              <button
                                key={`${stage.key}-p-${pi}`}
                                type="button"
                                className="relative aspect-square overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
                                onClick={() => p.onPhotoPreview(url)}
                              >
                                <img src={url} alt="" className="h-full w-full object-cover" />
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
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
              const badgeLabel = complete ? 'Complete' : isFocus ? 'Now' : started ? 'In progress' : 'Not started';

              return (
                <Collapsible
                  key={photoKey}
                  open={open}
                  onOpenChange={(o) => setHeatingStageOpen(panelId, o)}
                  className="rounded-xl border border-border/60 bg-muted/10 overflow-hidden"
                >
                  <CollapsibleTrigger className="group flex w-full min-h-[52px] cursor-pointer items-start justify-between gap-2 px-3 py-3 text-left hover:bg-muted/25 sm:min-h-0 sm:items-center sm:py-2.5">
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
                            placeholder="Resistance (Ω)"
                            value={step.resistance_ohm || ''}
                            className="h-11 text-sm"
                            disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                            onChange={(e) => p.onExtraHeatingFieldChange(idx, 'resistance_ohm', e.target.value)}
                          />
                          <Input
                            placeholder="Insulation (MΩ)"
                            value={step.insulation_mohm || ''}
                            className="h-11 text-sm"
                            disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                            onChange={(e) => p.onExtraHeatingFieldChange(idx, 'insulation_mohm', e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Recorded as
                        </p>
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label
                              htmlFor={`heat-extra-${photoKey}-when`}
                              className="text-[11px] font-medium text-muted-foreground"
                            >
                              When
                            </Label>
                            <HeatingDatetimeField
                              id={`heat-extra-${photoKey}-when`}
                              value={heatingCableDateForDatetimeLocalInput(step.date)}
                              disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                              onChange={(v) => p.onExtraHeatingFieldChange(idx, 'date', v)}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor={`heat-extra-${photoKey}-by`}
                              className="text-[11px] font-medium text-muted-foreground"
                            >
                              Performed by
                            </Label>
                            <Input
                              id={`heat-extra-${photoKey}-by`}
                              placeholder="Name"
                              value={step.performed_by || ''}
                              className="h-11 text-sm"
                              disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                              onChange={(e) => p.onExtraHeatingFieldChange(idx, 'performed_by', e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[11px] text-muted-foreground">Note (optional)</span>
                        <Textarea
                          placeholder="Note (optional)"
                          value={step.note || ''}
                          className="text-sm min-h-[56px]"
                          disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                          onChange={(e) => p.onExtraHeatingFieldChange(idx, 'note', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Photos
                        </p>
                        <StyledFilePhotoTrigger
                          registerInput={(el) => {
                            p.heatingPhotoInputRefs.current[photoKey] = el;
                          }}
                          disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                          onFile={(file) => p.onHeatingStagePhotoChange(photoKey, file)}
                        />
                        {Array.isArray(step.photos) && step.photos.length > 0 ? (
                          <div className="grid grid-cols-3 gap-2">
                            {step.photos.map((url, pi) => (
                              <button
                                key={`${photoKey}-p-${pi}`}
                                type="button"
                                className="relative aspect-square overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
                                onClick={() => p.onPhotoPreview(url)}
                              >
                                <img src={url} alt="" className="h-full w-full object-cover" />
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
            {!p.heatingLockedByAdmin ? (
              <Button
                type="button"
                className="w-full h-12 text-base font-medium"
                disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                onClick={() => p.onSaveHeatingCable()}
              >
                {p.savingHeatingCable ? 'Saving…' : 'Save heating cable documentation'}
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
                Ready to continue
              </p>
              <p className="text-xl font-bold tracking-tight text-emerald-950 dark:text-emerald-50">
                Complete this phase
              </p>
              <p className="text-sm leading-snug text-emerald-900/85 dark:text-emerald-100/85">
                Everything required for {selectedLabel} is done. Confirm to hand off.
              </p>
            </div>
            <Button
              type="button"
              size="lg"
              className="h-14 min-h-14 w-full px-6 text-lg font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md sm:h-12 sm:min-h-12 sm:text-base"
              disabled={p.completingPhase}
              onClick={() => p.onCompletePhase()}
            >
              {p.completingPhase ? 'Saving…' : 'Complete phase'}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Phase photos (compact) */}
      {showFullPhaseDetails && p.showPhotosSection && p.photosForPhase.length > 0 ? (
        <Card className="border-border/50 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Photos this phase
          </p>
          <div className="grid grid-cols-3 gap-2">
            {p.photosForPhase.map((photo) => (
              <button
                key={photo.id}
                type="button"
                className="relative aspect-square rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800"
                onClick={() => photo.downloadUrl && p.onPhotoPreview(photo.downloadUrl)}
              >
                {photo.downloadUrl ? (
                  <img src={photo.downloadUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="h-8 w-8 m-auto text-muted-foreground/40" />
                )}
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Issues & activity — single secondary card */}
      {showFullPhaseDetails ? (
        <Card className="overflow-hidden border-border/30 bg-muted/[0.06] shadow-none">
          <p className="border-b border-border/25 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
            More on this phase
          </p>
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger className="group flex w-full min-h-[44px] cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted/25 sm:min-h-0">
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
                        {d.text}
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
                      key={`${row.t}-${i}`}
                      className="flex gap-2 border-b border-border/25 pb-1.5 last:border-0"
                    >
                      <span className="w-14 shrink-0 whitespace-nowrap text-muted-foreground">
                        {p.formatActivityWhen(row.t)}
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
