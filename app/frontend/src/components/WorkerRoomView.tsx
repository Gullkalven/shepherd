import { RefObject } from 'react';
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
  heatingDocumentationProgress,
  heatingStageHasAnyData,
  type HeatingCableDoc,
  type HeatingCableDerived,
  type HeatingCableStageKey,
} from '@/lib/heatingCable';
import type { PhaseWorkflowEntry } from '@/lib/roomPhases';
import { phaseLabel } from '@/lib/roomPhases';
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

export function WorkerRoomView(p: Props) {
  const selectedLabel = phaseLabel(p.selectedPhaseKey, p.phaseWorkflow);
  const boardLabel = phaseLabel(p.boardPhaseKey, p.phaseWorkflow);
  const viewingNonBoard = p.selectedPhaseKey !== p.boardPhaseKey;
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
        <div className="rounded-lg border border-amber-200/80 bg-amber-50/90 dark:bg-amber-950/35 dark:border-amber-900/50 px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-sm text-amber-950 dark:text-amber-100 leading-snug sm:text-xs">
            Viewing <span className="font-semibold">{selectedLabel}</span>. Current work is{' '}
            <span className="font-semibold">{boardLabel}</span>.
          </p>
          <Button
            type="button"
            size="sm"
            className="h-11 min-h-11 w-full shrink-0 sm:h-9 sm:min-h-0 sm:w-auto"
            variant="secondary"
            onClick={() => p.onPhaseSelect(p.boardPhaseKey)}
          >
            Jump to current
          </Button>
        </div>
      ) : null}

      {/* Complete phase */}
      {p.phaseCompleteEligible && !p.phaseReadOnly ? (
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
      {p.showChecklistSection ? (
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

      {/* Heating cable — large targets */}
      {p.showHeatingModule ? (
        <Card className="overflow-hidden border-border/60 shadow-sm">
          <div className="border-b border-border/50 bg-muted/30 px-4 py-3">
            <h2 className="text-lg font-semibold tracking-tight">Heating cable</h2>
            <p className="hidden text-xs text-muted-foreground mt-0.5 sm:block">
              Fill readings and add proof photos for each stage.
            </p>
            {p.heatingLockedByAdmin ? (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">Locked by admin — view only.</p>
            ) : null}
          </div>
          <div className="p-4 space-y-4">
            {HEATING_CABLE_STAGES.map((stage) => {
              const row = p.heatingCableDoc[stage.key] || {};
              return (
                <div key={stage.key} className="rounded-xl border border-border/60 bg-muted/10 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{stage.label}</p>
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
                      className="min-h-11 h-11 px-4 text-sm gap-1.5 sm:h-10 sm:min-h-10 sm:px-3"
                      disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                      onClick={() => p.heatingPhotoInputRefs.current[stage.key]?.click()}
                    >
                      <Camera className="h-4 w-4" />
                      Add photo
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    <Input
                      type="date"
                      value={row.date || ''}
                      className="h-11 text-sm"
                      disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                      onChange={(e) => p.onHeatingFieldChange(stage.key, 'date', e.target.value)}
                    />
                    <Input
                      placeholder="Performed by"
                      value={row.performed_by || ''}
                      className="h-11 text-sm"
                      disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                      onChange={(e) => p.onHeatingFieldChange(stage.key, 'performed_by', e.target.value)}
                    />
                  </div>
                  <Textarea
                    placeholder="Note (optional)"
                    value={row.note || ''}
                    className="text-sm min-h-[72px]"
                    disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                    onChange={(e) => p.onHeatingFieldChange(stage.key, 'note', e.target.value)}
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
              );
            })}
            {(p.heatingCableDoc.extra_steps || []).map((step, idx) => {
              const sid = step.id || `extra-${idx}`;
              const has = heatingStageHasAnyData(step);
              if (!has && !step.label?.trim()) return null;
              return (
                <div key={sid} className="rounded-xl border border-border/60 bg-muted/10 p-3 space-y-3">
                  <p className="text-sm font-semibold">{step.label?.trim() || `Extra step ${idx + 1}`}</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    <Input
                      type="date"
                      value={step.date || ''}
                      className="h-11 text-sm"
                      disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                      onChange={(e) => p.onExtraHeatingFieldChange(idx, 'date', e.target.value)}
                    />
                    <Input
                      placeholder="Performed by"
                      value={step.performed_by || ''}
                      className="h-11 text-sm"
                      disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                      onChange={(e) => p.onExtraHeatingFieldChange(idx, 'performed_by', e.target.value)}
                    />
                  </div>
                  <Textarea
                    placeholder="Note (optional)"
                    value={step.note || ''}
                    className="text-sm min-h-[72px]"
                    disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                    onChange={(e) => p.onExtraHeatingFieldChange(idx, 'note', e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <input
                      ref={(el) => {
                        p.heatingPhotoInputRefs.current[sid] = el;
                      }}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => p.onHeatingStagePhotoChange(sid, e.target.files?.[0])}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 h-11 px-4 text-sm gap-1.5 sm:h-10 sm:min-h-10 sm:px-3"
                      disabled={!p.canEditHeatingCable || p.savingHeatingCable}
                      onClick={() => p.heatingPhotoInputRefs.current[sid]?.click()}
                    >
                      <Camera className="h-4 w-4" />
                      Add photo
                    </Button>
                  </div>
                </div>
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
      {p.showPhotosSection && p.photosForPhase.length > 0 ? (
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
    </div>
  );
}
