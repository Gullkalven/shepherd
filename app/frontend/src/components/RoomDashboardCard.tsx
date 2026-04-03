import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { User, AlertTriangle, Clock, Lock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { deriveRoomDashboardStatus, type DashboardStatusKind } from '@/lib/roomDashboardDerived';

const STATUS_LABELS: Record<DashboardStatusKind, string> = {
  blocked: 'Blocked',
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

const CARD_SHELL: Record<DashboardStatusKind, string> = {
  blocked:
    'border-l-[6px] border-l-red-600 bg-red-50/95 dark:bg-red-950/35 border-red-200/80 dark:border-red-900',
  not_started:
    'border-l-[6px] border-l-slate-400 bg-slate-100/90 dark:bg-slate-900/55 border-slate-200 dark:border-slate-700',
  in_progress:
    'border-l-[6px] border-l-amber-500 bg-amber-50/95 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800',
  completed:
    'border-l-[6px] border-l-emerald-600 bg-emerald-50/95 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800',
};

const PROGRESS_FILL: Record<DashboardStatusKind, string> = {
  blocked: 'bg-red-500',
  not_started: 'bg-slate-400',
  in_progress: 'bg-amber-500',
  completed: 'bg-emerald-600',
};

const STATUS_PILL: Record<DashboardStatusKind, string> = {
  blocked: 'bg-red-600 text-white',
  not_started: 'bg-slate-600/90 text-white dark:bg-slate-600',
  in_progress: 'bg-amber-500 text-amber-950 dark:text-amber-950',
  completed: 'bg-emerald-600 text-white',
};

function formatUpdatedAt(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return null;
  }
}

interface RoomDashboardCardProps {
  roomNumber: string;
  floorLabel?: string;
  completed: number;
  total: number;
  blocked: boolean;
  /** Content locked by admin/BAS — workers can view only */
  contentLocked?: boolean;
  blockedReason?: string;
  assignedWorker?: string;
  updatedAt?: string | null;
  onClick: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  /** Extra controls (e.g. list delete); clicks do not open the room */
  trailing?: React.ReactNode;
  className?: string;
}

export default function RoomDashboardCard({
  roomNumber,
  floorLabel,
  completed,
  total,
  blocked,
  contentLocked = false,
  blockedReason,
  assignedWorker,
  updatedAt,
  onClick,
  selectionMode = false,
  selected = false,
  draggable = false,
  onDragStart,
  trailing,
  className,
}: RoomDashboardCardProps) {
  const kind = deriveRoomDashboardStatus(blocked, total, completed);
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const remaining = total > 0 ? Math.max(0, total - completed) : 0;
  const progressLine = total > 0 ? `${completed} / ${total}` : '—';
  const updatedLabel = formatUpdatedAt(updatedAt);

  return (
    <Card
      className={cn(
        'cursor-pointer border py-2 px-2.5 shadow-sm transition-shadow hover:shadow-md active:scale-[0.99]',
        CARD_SHELL[kind],
        className
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
    >
      <div className="flex gap-2 items-start">
        <div className="min-w-0 flex-1 space-y-1.5">
          {selectionMode && (
            <div className="mb-0.5">
              <Checkbox checked={selected} className="pointer-events-none" />
            </div>
          )}

          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-2xl font-bold leading-none tracking-tight text-slate-900 dark:text-slate-50 tabular-nums">
                {roomNumber}
              </div>
              {floorLabel ? (
                <div className="mt-0.5 text-[11px] font-medium text-muted-foreground truncate">
                  {floorLabel}
                </div>
              ) : null}
            </div>
            {contentLocked || blocked ? (
              <div className="shrink-0 flex items-center gap-1">
                {contentLocked ? (
                  <span
                    className="inline-flex items-center justify-center rounded-md bg-amber-600 text-white p-1"
                    title="Locked — view only for workers"
                    aria-label="Locked"
                  >
                    <Lock className="h-4 w-4" />
                  </span>
                ) : null}
                {blocked ? (
                  <span
                    className="inline-flex items-center justify-center rounded-md bg-red-600 text-white p-1"
                    title={blockedReason || 'Blocked'}
                    aria-label="Blocked"
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-2 mb-0.5">
              <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                {progressLine}
              </span>
              {total > 0 ? (
                <span className="text-[10px] font-medium text-muted-foreground tabular-nums">{pct}%</span>
              ) : null}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className={cn('h-full rounded-full transition-[width]', PROGRESS_FILL[kind])}
                style={{ width: `${total > 0 ? pct : 0}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold',
                STATUS_PILL[kind]
              )}
            >
              {STATUS_LABELS[kind]}
            </span>
            {!blocked && remaining > 0 ? (
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                {remaining} {remaining === 1 ? 'item' : 'items'} remaining
              </span>
            ) : null}
          </div>

          {assignedWorker ? (
            <div className="flex items-center gap-1 text-[11px] text-slate-700 dark:text-slate-300">
              <User className="h-3 w-3 shrink-0 opacity-70" />
              <span className="truncate font-medium">{assignedWorker}</span>
            </div>
          ) : null}

          {updatedLabel ? (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <span>Updated {updatedLabel}</span>
            </div>
          ) : null}
        </div>

        {trailing ? (
          <div className="shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
            {trailing}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
