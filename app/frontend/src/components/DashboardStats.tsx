import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Clock, AlertTriangle, Ban, LayoutGrid } from 'lucide-react';
import {
  deriveHeatingCableStatus,
  HEATING_CABLE_STAGES,
  normalizeHeatingCableDoc,
  type HeatingCableRoomStatus,
} from '@/lib/heatingCable';
import type { PhaseWorkflowEntry } from '@/lib/roomPhases';
import { roomRequiresHeatingCableDocumentation } from '@/lib/roomPhases';
import { formatDistanceToNow } from 'date-fns';
import { Link } from 'react-router-dom';

interface Room {
  id: number;
  floor_id: number;
  status: string;
  room_number?: string;
  updated_at?: string | null;
  assigned_worker?: string;
  heating_cable_doc?: unknown;
  phase_tool_overrides?: unknown;
}

interface DashboardStatsProps {
  rooms: Room[];
  phaseWorkflow: PhaseWorkflowEntry[];
  /** Route param for deep links to rooms */
  projectId: string;
}

function formatAgo(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '—';
  }
}

const STATUS_SORT: Record<HeatingCableRoomStatus, number> = {
  has_deviation_missing: 0,
  not_started: 1,
  partial: 2,
  complete: 3,
};

/** Aligns with the four pilot buckets (same wording as summary cards). */
const HEATING_ADMIN_STATUS_LABEL: Record<HeatingCableRoomStatus, string> = {
  not_started: 'Missing documentation',
  partial: 'Partially documented',
  complete: 'Complete',
  has_deviation_missing: 'Issues / deviations',
};

export default function DashboardStats({ rooms, phaseWorkflow, projectId }: DashboardStatsProps) {
  const total = rooms.length;
  const completed = rooms.filter((r) => r.status === 'completed').length;
  const inProgress = rooms.filter((r) => r.status === 'in_progress').length;
  const blocked = rooms.filter((r) => r.status === 'blocked').length;
  const readyForInspection = rooms.filter((r) => r.status === 'ready_for_inspection').length;
  const notStarted = rooms.filter((r) => r.status === 'not_started').length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const heatingRooms = rooms.filter((r) => roomRequiresHeatingCableDocumentation(r, phaseWorkflow));

  const heatingRows = heatingRooms
    .map((room) => {
      const derived = deriveHeatingCableStatus(room.heating_cable_doc);
      const doc = normalizeHeatingCableDoc(room.heating_cable_doc);
      const missingLabels = derived.missingStages.map(
        (k) => HEATING_CABLE_STAGES.find((s) => s.key === k)?.label || k
      );
      const lastIso = derived.lastUpdated || room.updated_at || null;
      const recordedBy = [derived.performedBy?.trim(), room.assigned_worker?.trim()]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(' · ');
      return {
        roomId: room.id,
        floorId: room.floor_id,
        roomName: room.room_number || `Room ${room.id}`,
        status: derived.status,
        isLocked: doc.locked_by_admin === true,
        missingStages: missingLabels.join(', '),
        lastUpdated: lastIso,
        recordedBy,
      };
    })
    .sort((a, b) => {
      const da = STATUS_SORT[a.status] ?? 9;
      const db = STATUS_SORT[b.status] ?? 9;
      if (da !== db) return da - db;
      return a.roomName.localeCompare(b.roomName, undefined, { numeric: true });
    });

  const heatingTotal = heatingRows.length;
  const heatingComplete = heatingRows.filter((r) => r.status === 'complete').length;
  const heatingPartial = heatingRows.filter((r) => r.status === 'partial').length;
  const heatingMissingDoc = heatingRows.filter((r) => r.status === 'not_started').length;
  const heatingIssues = heatingRows.filter((r) => r.status === 'has_deviation_missing').length;

  const heatingStatusPill: Record<HeatingCableRoomStatus, string> = {
    not_started: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    partial: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
    complete: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
    has_deviation_missing: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100',
  };

  const stats = [
    { label: 'Total', value: total, icon: LayoutGrid, color: 'text-slate-600', bg: 'bg-slate-100' },
    { label: 'Completed', value: completed, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100' },
    { label: 'In Progress', value: inProgress, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-100' },
    { label: 'Inspection', value: readyForInspection, icon: AlertTriangle, color: 'text-blue-600', bg: 'bg-blue-100' },
    { label: 'Blocked', value: blocked, icon: Ban, color: 'text-red-600', bg: 'bg-red-100' },
  ];

  const roomLink = (roomId: number, floorId: number) =>
    projectId.trim()
      ? `/project/${projectId}/floor/${floorId}/room/${roomId}`
      : undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-2 text-center">
            <div className={`mx-auto w-8 h-8 rounded-full ${stat.bg} flex items-center justify-center mb-1`}>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </div>
            <div className="text-lg font-bold">{stat.value}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">{stat.label}</div>
          </Card>
        ))}
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Overall Progress</span>
          <span className="font-bold text-emerald-600">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-3" />
      </div>
      <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Heating cable documentation</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            Rooms where the workflow includes heating cable. Status reflects the three measurement stages (and visible
            extra steps).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Card className="p-2 text-center">
            <div className="text-lg font-bold">{heatingTotal}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">Rooms in scope</div>
          </Card>
          <Card className="p-2 text-center">
            <div className="text-lg font-bold text-emerald-600">{heatingComplete}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">Complete</div>
          </Card>
          <Card className="p-2 text-center">
            <div className="text-lg font-bold text-amber-600">{heatingPartial}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">Partially documented</div>
          </Card>
          <Card className="p-2 text-center">
            <div className="text-lg font-bold text-slate-600">{heatingMissingDoc}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">Missing documentation</div>
          </Card>
          <Card className="p-2 text-center">
            <div className="text-lg font-bold text-red-600">{heatingIssues}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">Issues / deviations</div>
          </Card>
        </div>
        <div className="overflow-x-auto rounded-md border border-border/50 bg-background/80">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/60 bg-muted/30">
                <th className="py-2 px-2 font-medium">Room</th>
                <th className="py-2 px-2 font-medium">Status</th>
                <th className="py-2 px-2 font-medium">Missing stages</th>
                <th className="py-2 px-2 font-medium whitespace-nowrap">Last updated</th>
                <th className="py-2 px-2 font-medium">Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {heatingRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 px-2 text-center text-muted-foreground">
                    No rooms require heating cable documentation for this project workflow.
                  </td>
                </tr>
              ) : (
                heatingRows.map((row) => {
                  const href = roomLink(row.roomId, row.floorId);
                  const label = HEATING_ADMIN_STATUS_LABEL[row.status];
                  return (
                    <tr key={row.roomId} className="border-b border-border/40 last:border-0">
                      <td className="py-2 px-2 font-medium text-foreground">
                        {href ? (
                          <Link to={href} className="text-[#1E3A5F] hover:underline dark:text-blue-400">
                            {row.roomName}
                          </Link>
                        ) : (
                          row.roomName
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <span className="inline-flex flex-wrap items-center gap-1">
                          <span
                            className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${heatingStatusPill[row.status]}`}
                          >
                            {label}
                          </span>
                          {row.isLocked ? (
                            <span className="text-[10px] text-muted-foreground border border-border/60 rounded px-1 py-px">
                              Locked
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground max-w-[180px]">
                        {row.missingStages ? (
                          <span className="line-clamp-2" title={row.missingStages}>
                            {row.missingStages}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{formatAgo(row.lastUpdated)}</td>
                      <td className="py-2 px-2 text-foreground/90">{row.recordedBy || '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
