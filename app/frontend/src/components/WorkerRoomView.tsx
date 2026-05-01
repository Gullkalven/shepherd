import { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Camera,
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

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-3 py-3 sm:px-4 sm:py-4 lg:max-w-xl">
      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={cn('border-0 text-sm font-medium sm:text-xs', p.roomStatusClassName)}
        >
          {p.roomStatusLabel}
        </Badge>
        {p.dueLine ? (
          <span
            className={cn(
              'text-sm font-medium flex items-center gap-1 sm:text-xs',
              p.duePast ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
            )}
          >
            Due {p.dueLine}
            {p.duePast ? (
              <>
                <span className="max-sm:hidden"> · overdue</span>
                <span className="sm:hidden"> · late</span>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
      {p.blockedReason ? (
        <div className="rounded-lg border border-red-200/70 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-800 dark:text-red-200">
          <span className="font-semibold">Blocked</span>
          <p className="mt-1 text-xs leading-snug">{p.blockedReason}</p>
        </div>
      ) : null}

      {p.editsBlocked ? (
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 flex items-start gap-2 text-sm">
          <Lock className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
          <p className="text-muted-foreground leading-snug">This room is locked for editing.</p>
        </div>
      ) : null}

      {/* Current phase hero */}
      <Card className="border-[#1E3A5F]/25 bg-gradient-to-br from-[#1E3A5F]/[0.07] to-transparent dark:from-blue-950/40 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 space-y-3">
          <div className="space-y-1">
            <p className="hidden text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/90 sm:block">
              Now
            </p>
            <h1 className="text-2xl sm:text-[1.65rem] font-bold tracking-tight text-foreground leading-tight">
              {p.roomNumber}
            </h1>
            <p className="text-base font-semibold text-[#1E3A5F] dark:text-blue-300">{boardLabel}</p>
          </div>

          <div className="rounded-xl bg-background/80 dark:bg-background/60 border border-border/50 px-3 py-2.5 space-y-1.5">
            {p.boardPhaseShowHeating && boardHeatingDocProgress ? (
              <p className="text-base text-foreground sm:text-sm">
                <span className="font-semibold">Documentation</span>{' '}
                <span className="tabular-nums font-semibold">
                  {boardHeatingDocProgress.complete}/{boardHeatingDocProgress.total}
                </span>
                <span className="text-muted-foreground"> complete</span>
              </p>
            ) : p.boardPhaseTotalCount > 0 ? (
              <p className="text-base text-foreground sm:text-sm">
                <span className="tabular-nums font-semibold">{p.boardPhaseIncompleteCount}</span>
                <span className="text-muted-foreground">
                  {' '}
                  checklist {p.boardPhaseIncompleteCount === 1 ? 'task' : 'tasks'} left
                </span>
                <span className="text-muted-foreground/80 text-xs max-sm:hidden"> · </span>
                <span className="text-xs text-muted-foreground tabular-nums max-sm:hidden">
                  {p.boardPhaseTotalCount - p.boardPhaseIncompleteCount}/{p.boardPhaseTotalCount} done
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No checklist items in this phase.</p>
            )}
            {p.boardPhaseShowHeating && p.boardPhaseTotalCount > 0 ? (
              <p className="text-sm text-muted-foreground tabular-nums">
                Checklist {p.boardPhaseTotalCount - p.boardPhaseIncompleteCount}/{p.boardPhaseTotalCount} done
              </p>
            ) : null}
            {p.boardPhaseShowHeating ? (
              <p className="text-sm flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Heating cable</span>
                <Badge variant="secondary" className="text-xs font-medium sm:text-[11px]">
                  {heatingStatusLabel[p.heatingDerived.status]}
                </Badge>
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Area picker */}
      {p.showAreasNav && p.areasList.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {p.areasList.map((a) => (
            <Button
              key={a.id}
              type="button"
              variant={a.id === p.activeAreaId ? 'default' : 'outline'}
              size="sm"
              className={cn(
                'min-h-11 h-11 px-4 text-sm rounded-lg sm:min-h-10 sm:h-10',
                a.id === p.activeAreaId && 'bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 dark:bg-blue-700'
              )}
              onClick={() => p.onAreaChange(a.id)}
            >
              {a.name}
            </Button>
          ))}
        </div>
      ) : null}

      {/* Phase navigation (current board highlighted) */}
      {workflowKeys.length > 1 ? (
        <div className="space-y-2">
          <p className="hidden text-[11px] font-medium text-muted-foreground uppercase tracking-wide sm:block">
            Phases
          </p>
          <div className="flex flex-wrap gap-2">
            {workflowKeys.map((key) => {
              const isBoard = key === p.boardPhaseKey;
              const isSel = key === p.selectedPhaseKey;
              return (
                <Button
                  key={key}
                  type="button"
                  variant={isSel ? 'secondary' : 'outline'}
                  size="sm"
                  className={cn(
                    'min-h-11 h-11 rounded-full px-4 text-sm sm:min-h-9 sm:h-9 sm:px-3 sm:text-xs',
                    isBoard && 'ring-2 ring-amber-400/80 ring-offset-2 ring-offset-background',
                    !isSel && !isBoard && 'opacity-80'
                  )}
                  onClick={() => p.onPhaseSelect(key)}
                >
                  {phaseLabel(key, p.phaseWorkflow)}
                </Button>
              );
            })}
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
                variant={nonBoardDetailsExpanded ? 'outline' : 'default'}
                className={cn(
                  'h-11 min-h-11 w-full sm:h-10 sm:min-h-10 sm:w-auto sm:flex-1',
                  !nonBoardDetailsExpanded &&
                    'bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 dark:bg-blue-700 dark:hover:bg-blue-700/90'
                )}
                onClick={() => setNonBoardDetailsExpanded((v) => !v)}
              >
                {nonBoardDetailsExpanded ? 'Hide details' : 'View details'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-11 min-h-11 w-full sm:h-10 sm:min-h-10 sm:w-auto sm:flex-1"
                onClick={() => p.onPhaseSelect(p.boardPhaseKey)}
              >
                Jump to active phase
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Complete phase */}
      {showFullPhaseDetails && p.phaseCompleteEligible && !p.phaseReadOnly ? (
        <Card className="border-emerald-200/80 bg-emerald-50/50 dark:bg-emerald-950/25 dark:border-emerald-900/50 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="font-semibold text-emerald-900 dark:text-emerald-100">Ready for handoff</p>
              <p className="hidden text-xs text-emerald-800/90 dark:text-emerald-200/90 mt-0.5 sm:block">
                Required work for {selectedLabel} is done. Record this so the team knows.
              </p>
            </div>
            <Button
              type="button"
              className="h-12 min-h-12 w-full px-6 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 sm:w-auto"
              disabled={p.completingPhase}
              onClick={() => p.onCompletePhase()}
            >
              {p.completingPhase ? 'Saving…' : 'Complete phase'}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Checklist — large action rows (before heating so checklist stays above long forms) */}
      {showFullPhaseDetails && p.showChecklistSection ? (
        <section aria-labelledby="worker-checklist-heading">
          <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
            <h2 id="worker-checklist-heading" className="text-lg font-semibold tracking-tight">
              {p.checklistSectionTitle}
            </h2>
            <span className="text-sm tabular-nums text-muted-foreground font-medium">
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

          <div className="space-y-2">
            {p.tasksForSelectedPhase.length === 0 ? (
              <Card className="p-6 text-center text-muted-foreground text-sm">No tasks for this phase.</Card>
            ) : (
              p.tasksForSelectedPhase.map((task) => (
                <Card
                  key={task.id}
                  className={cn(
                    'border-border/60 shadow-sm transition-colors',
                    task.is_completed ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : 'bg-card hover:bg-muted/30'
                  )}
                >
                  <div className="flex flex-col sm:flex-row sm:items-stretch gap-0 sm:gap-2">
                    <button
                      type="button"
                      className={cn(
                        'flex-1 text-left p-5 flex items-start gap-4 min-h-[4.75rem] rounded-lg sm:p-4 sm:min-h-[4rem] sm:rounded-r-none',
                        !p.canInteractChecklist && 'opacity-60 cursor-not-allowed'
                      )}
                      disabled={!p.canInteractChecklist}
                      onClick={() => p.onTaskClick(task)}
                    >
                      <div className="shrink-0 mt-0.5">
                        {task.is_completed ? (
                          <CheckCircle2 className="h-9 w-9 text-emerald-600 dark:text-emerald-400 sm:h-8 sm:w-8" aria-hidden />
                        ) : (
                          <Circle className="h-9 w-9 text-muted-foreground/50 sm:h-8 sm:w-8" aria-hidden />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <p
                          className={cn(
                            'text-base font-medium leading-snug',
                            task.is_completed ? 'line-through text-muted-foreground' : 'text-foreground'
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
                    {p.showPhotosSection && p.canUploadPhoto ? (
                      <div className="flex items-center px-4 pb-4 pt-0 sm:pt-4 sm:p-4 sm:border-l border-border/40 sm:min-w-[7.5rem]">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-12 min-h-12 w-full sm:h-11 sm:min-h-0 sm:w-auto text-sm gap-1.5"
                          disabled={!p.canMutatePhaseMedia || p.uploadingPhoto}
                          onClick={() => p.onGeneralPhotoClick()}
                        >
                          <Camera className="h-4 w-4" />
                          Add photo
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </Card>
              ))
            )}
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
                          <div className="space-y-1">
                            <span className="text-[11px] text-muted-foreground">When</span>
                            <Input
                              type="datetime-local"
                              step={60}
                              value={heatingCableDateForDatetimeLocalInput(row.date)}
                              className="h-11 text-sm"
                              disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                              onChange={(e) => p.onHeatingFieldChange(stage.key, 'date', e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[11px] text-muted-foreground">Performed by</span>
                            <Input
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
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Photos
                        </p>
                        <input
                          ref={(el) => {
                            p.heatingPhotoInputRefs.current[stage.key] = el;
                          }}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => p.onHeatingStagePhotoChange(stage.key, e.target.files?.[0])}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11 h-11 w-full sm:w-auto px-4 text-sm gap-1.5 sm:h-10 sm:min-h-10 sm:px-3"
                          disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                          onClick={() => p.heatingPhotoInputRefs.current[stage.key]?.click()}
                        >
                          <Camera className="h-4 w-4" />
                          Add photo
                        </Button>
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
                          <div className="space-y-1">
                            <span className="text-[11px] text-muted-foreground">When</span>
                            <Input
                              type="datetime-local"
                              step={60}
                              value={heatingCableDateForDatetimeLocalInput(step.date)}
                              className="h-11 text-sm"
                              disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                              onChange={(e) => p.onExtraHeatingFieldChange(idx, 'date', e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[11px] text-muted-foreground">Performed by</span>
                            <Input
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
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Photos
                        </p>
                        <input
                          ref={(el) => {
                            p.heatingPhotoInputRefs.current[photoKey] = el;
                          }}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => p.onHeatingStagePhotoChange(photoKey, e.target.files?.[0])}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11 h-11 w-full sm:w-auto px-4 text-sm gap-1.5 sm:h-10 sm:min-h-10 sm:px-3"
                          disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                          onClick={() => p.heatingPhotoInputRefs.current[photoKey]?.click()}
                        >
                          <Camera className="h-4 w-4" />
                          Add photo
                        </Button>
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

      {/* Phase photos (compact) */}
      {showFullPhaseDetails && p.showPhotosSection && p.photosForPhase.length > 0 ? (
        <Card className="p-3 border-border/50">
          <p className="mb-2 hidden text-xs font-medium text-muted-foreground sm:block">Photos this phase</p>
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

      {/* Deviations */}
      {showFullPhaseDetails ? (
      <Collapsible defaultOpen className="rounded-lg border border-border/50 bg-muted/15">
        <CollapsibleTrigger className="group flex w-full min-h-[48px] cursor-pointer items-center justify-between gap-3 px-4 py-4 text-left hover:bg-muted/25 rounded-lg sm:min-h-0 sm:px-3 sm:py-3">
          <span className="flex min-w-0 flex-1 items-center gap-3 text-base font-medium sm:gap-2 sm:text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 sm:h-4 sm:w-4" />
            <span className="leading-snug">Report issue</span>
            {p.deviations.length > 0 ? (
              <Badge variant="secondary" className="text-xs sm:text-[10px]">
                {p.deviations.length}
              </Badge>
            ) : null}
          </span>
          <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 sm:h-4 sm:w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/40">
            {p.deviations.length > 0 ? (
              <ul className="space-y-2 pt-2">
                {p.deviations.map((d) => (
                  <li
                    key={d.id}
                    className={cn(
                      'rounded-md border px-2.5 py-2 text-sm',
                      d.status === 'resolved' ? 'border-border/60 bg-muted/20' : 'border-amber-200/70 bg-amber-50/50 dark:bg-amber-950/25'
                    )}
                  >
                    {d.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground pt-2">No issues logged for this phase.</p>
            )}
            {p.canAddDeviation ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch pt-2">
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
      ) : null}

      {showFullPhaseDetails ? (
      <Collapsible className="rounded-lg border border-border/50 bg-muted/10">
        <CollapsibleTrigger className="group flex w-full min-h-[48px] cursor-pointer items-center justify-between gap-3 px-4 py-4 text-left text-base text-muted-foreground hover:bg-muted/20 rounded-lg sm:min-h-0 sm:px-3 sm:py-2.5 sm:text-sm">
          <span className="flex items-center gap-3 sm:gap-2">
            <History className="h-5 w-5 sm:h-4 sm:w-4" />
            Activity
          </span>
          <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-data-[state=open]:rotate-180 sm:h-4 sm:w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 max-h-48 overflow-y-auto space-y-1.5 text-xs border-t border-border/40 pt-2">
            {p.activityEntries.length === 0 ? (
              <p className="text-muted-foreground py-1">Nothing logged for this phase yet.</p>
            ) : (
              p.activityEntries.map((row, i) => (
                <div key={`${row.t}-${i}`} className="flex gap-2 border-b border-border/30 pb-1.5 last:border-0">
                  <span className="text-muted-foreground whitespace-nowrap shrink-0 w-14">
                    {p.formatActivityWhen(row.t)}
                  </span>
                  <span className="min-w-0 leading-snug">{row.msg}</span>
                </div>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
      ) : null}
    </div>
  );
}
