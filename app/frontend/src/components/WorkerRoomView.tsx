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
  projectName: string;
  floorName: string;
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
  const heatingStatusLabel: Record<string, string> = {
    not_started: 'Not started',
    partial: 'In progress',
    complete: 'Complete',
    has_deviation_missing: 'Needs attention',
  };

  const workflowKeys = p.phaseWorkflow.map((x) => x.key);

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-3 py-3 sm:px-4 sm:py-4 lg:max-w-xl">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label="Location">
        <span className="font-medium text-foreground/90 truncate max-w-[40vw]">{p.projectName || 'Project'}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
        <span className="truncate max-w-[35vw]">{p.floorName || 'Floor'}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
        <span className="text-foreground font-semibold truncate">{p.roomNumber}</span>
        {p.areaName ? (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
            <span className="truncate text-foreground/85">{p.areaName}</span>
          </>
        ) : null}
      </nav>

      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn('border-0 text-xs font-medium', p.roomStatusClassName)}>{p.roomStatusLabel}</Badge>
        {p.dueLine ? (
          <span
            className={cn(
              'text-xs font-medium flex items-center gap-1',
              p.duePast ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
            )}
          >
            Due {p.dueLine}
            {p.duePast ? ' · overdue' : ''}
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
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/90">Now</p>
            <h1 className="text-2xl sm:text-[1.65rem] font-bold tracking-tight text-foreground leading-tight">
              {p.roomNumber}
            </h1>
            <p className="text-base font-semibold text-[#1E3A5F] dark:text-blue-300">{boardLabel}</p>
          </div>

          <div className="rounded-xl bg-background/80 dark:bg-background/60 border border-border/50 px-3 py-2.5 space-y-1.5">
            {p.boardPhaseTotalCount > 0 ? (
              <p className="text-sm text-foreground">
                <span className="tabular-nums font-semibold">{p.boardPhaseIncompleteCount}</span>
                <span className="text-muted-foreground">
                  {' '}
                  checklist {p.boardPhaseIncompleteCount === 1 ? 'task' : 'tasks'} left
                </span>
                <span className="text-muted-foreground/80 text-xs"> · </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {p.boardPhaseTotalCount - p.boardPhaseIncompleteCount}/{p.boardPhaseTotalCount} done
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No checklist items in this phase.</p>
            )}
            {p.boardPhaseShowHeating ? (
              <p className="text-sm flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Heating cable</span>
                <Badge variant="secondary" className="text-[11px] font-medium">
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
                'h-10 px-4 text-sm rounded-lg',
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
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Phases</p>
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
                    'h-9 text-xs rounded-full',
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
          <p className="text-xs text-amber-950 dark:text-amber-100 leading-snug">
            Viewing <span className="font-semibold">{selectedLabel}</span>. Current work is{' '}
            <span className="font-semibold">{boardLabel}</span>.
          </p>
          <Button
            type="button"
            size="sm"
            className="h-9 shrink-0"
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
              <p className="text-xs text-emerald-800/90 dark:text-emerald-200/90 mt-0.5">
                Required work for {selectedLabel} is done. Record this so the team knows.
              </p>
            </div>
            <Button
              type="button"
              className="h-12 px-6 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
              disabled={p.completingPhase}
              onClick={() => p.onCompletePhase()}
            >
              {p.completingPhase ? 'Saving…' : 'Complete phase'}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Heating cable — large targets */}
      {p.showHeatingModule ? (
        <Card className="overflow-hidden border-border/60 shadow-sm">
          <div className="border-b border-border/50 bg-muted/30 px-4 py-3">
            <h2 className="text-lg font-semibold tracking-tight">Heating cable</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
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
                      className="h-10 px-3 text-sm gap-1.5"
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
                      className="h-10 px-3 text-sm gap-1.5"
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

      {/* Checklist — large action rows */}
      {p.showChecklistSection ? (
      <section aria-labelledby="worker-checklist-heading">
        <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
          <h2 id="worker-checklist-heading" className="text-lg font-semibold tracking-tight">
            {p.checklistSectionTitle}
          </h2>
          <span className="text-sm tabular-nums text-muted-foreground font-medium">
            {p.tasksForSelectedPhase.filter((t) => t.is_completed).length}/{p.tasksForSelectedPhase.length}
          </span>
        </div>
        {p.legacySavedWorkerName ? (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs">
            <span className="text-muted-foreground truncate">
              Using saved name <strong className="text-foreground">{p.legacySavedWorkerName}</strong>
            </span>
            {p.onClearSavedWorkerName ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground underline text-xs shrink-0"
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
                      'flex-1 text-left p-4 flex items-start gap-4 min-h-[4rem] rounded-lg sm:rounded-r-none',
                      !p.canInteractChecklist && 'opacity-60 cursor-not-allowed'
                    )}
                    disabled={!p.canInteractChecklist}
                    onClick={() => p.onTaskClick(task)}
                  >
                    <div className="shrink-0 mt-0.5">
                      {task.is_completed ? (
                        <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" aria-hidden />
                      ) : (
                        <Circle className="h-8 w-8 text-muted-foreground/50" aria-hidden />
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
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
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
                    <div className="flex items-center px-4 pb-4 sm:p-4 sm:border-l border-border/40 sm:min-w-[7.5rem]">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 w-full sm:w-auto text-sm gap-1.5"
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

      {/* Phase photos (compact) */}
      {p.showPhotosSection && p.photosForPhase.length > 0 ? (
        <Card className="p-3 border-border/50">
          <p className="text-xs font-medium text-muted-foreground mb-2">Photos this phase</p>
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
        <CollapsibleTrigger className="group flex w-full items-center justify-between px-3 py-3 text-left hover:bg-muted/25 rounded-lg">
          <span className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Report issue
            {p.deviations.length > 0 ? (
              <Badge variant="secondary" className="text-[10px]">
                {p.deviations.length}
              </Badge>
            ) : null}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
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
              <div className="flex flex-col gap-2 sm:flex-row pt-2">
                <Input
                  placeholder="Describe the issue…"
                  value={p.newDeviationText}
                  onChange={(e) => p.onNewDeviationChange(e.target.value)}
                  className="h-11 text-sm"
                  disabled={p.savingDeviations}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') p.onAddDeviation();
                  }}
                />
                <Button
                  type="button"
                  className="h-11 shrink-0"
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
        <CollapsibleTrigger className="group flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted/20 rounded-lg">
          <span className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Activity
          </span>
          <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
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
