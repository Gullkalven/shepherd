import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Clock, AlertTriangle, Ban, LayoutGrid } from 'lucide-react';
import { deriveHeatingCableStatus, HEATING_CABLE_STAGES, normalizeHeatingCableDoc } from '@/lib/heatingCable';
import { formatDistanceToNow } from 'date-fns';

interface Room {
  id: number;
  status: string;
  room_number?: string;
  updated_at?: string | null;
  assigned_worker?: string;
  heating_cable_doc?: unknown;
}

interface DashboardStatsProps {
  rooms: Room[];
}

function formatAgo(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '—';
  }
}

export default function DashboardStats({ rooms }: DashboardStatsProps) {
  const total = rooms.length;
  const completed = rooms.filter((r) => r.status === 'completed').length;
  const inProgress = rooms.filter((r) => r.status === 'in_progress').length;
  const blocked = rooms.filter((r) => r.status === 'blocked').length;
  const readyForInspection = rooms.filter((r) => r.status === 'ready_for_inspection').length;
  const notStarted = rooms.filter((r) => r.status === 'not_started').length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const heatingRows = rooms.map((room) => {
    const derived = deriveHeatingCableStatus(room.heating_cable_doc);
    const doc = normalizeHeatingCableDoc(room.heating_cable_doc);
    return {
      roomId: room.id,
      roomName: room.room_number || `Room ${room.id}`,
      status: derived.status,
      isLocked: doc.locked_by_admin === true,
      missingStages: derived.missingStages
        .map((k) => HEATING_CABLE_STAGES.find((s) => s.key === k)?.label || k)
        .join(', '),
      lastUpdated: derived.lastUpdated || room.updated_at || null,
      performedBy: derived.performedBy || room.assigned_worker || '',
      hasMissingValues: derived.hasMissingValues,
      hasDeviation: derived.hasDeviation,
    };
  });
  const heatingTotal = heatingRows.length;
  const heatingComplete = heatingRows.filter((r) => r.status === 'complete').length;
  const heatingPartial = heatingRows.filter((r) => r.status === 'partial').length;
  const heatingMissing = heatingRows.filter((r) => r.hasMissingValues).length;
  const heatingDeviation = heatingRows.filter((r) => r.hasDeviation).length;
  const heatingStatusLabel: Record<string, string> = {
    not_started: 'Not started',
    partial: 'Partial',
    complete: 'Complete',
    has_deviation_missing: 'Deviation/missing',
  };
  const heatingStatusPill: Record<string, string> = {
    not_started: 'bg-slate-100 text-slate-700',
    partial: 'bg-amber-100 text-amber-800',
    complete: 'bg-emerald-100 text-emerald-800',
    has_deviation_missing: 'bg-red-100 text-red-800',
  };

  const stats = [
    { label: 'Total', value: total, icon: LayoutGrid, color: 'text-slate-600', bg: 'bg-slate-100' },
    { label: 'Completed', value: completed, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100' },
    { label: 'In Progress', value: inProgress, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-100' },
    { label: 'Inspection', value: readyForInspection, icon: AlertTriangle, color: 'text-blue-600', bg: 'bg-blue-100' },
    { label: 'Blocked', value: blocked, icon: Ban, color: 'text-red-600', bg: 'bg-red-100' },
  ];

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
        <p className="text-sm font-semibold text-foreground">Heating Cable Documentation</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Card className="p-2 text-center">
            <div className="text-lg font-bold">{heatingTotal}</div>
            <div className="text-[10px] text-muted-foreground">Total rooms</div>
          </Card>
          <Card className="p-2 text-center">
            <div className="text-lg font-bold text-emerald-600">{heatingComplete}</div>
            <div className="text-[10px] text-muted-foreground">Complete</div>
          </Card>
          <Card className="p-2 text-center">
            <div className="text-lg font-bold text-amber-600">{heatingPartial}</div>
            <div className="text-[10px] text-muted-foreground">Partial</div>
          </Card>
          <Card className="p-2 text-center">
            <div className="text-lg font-bold text-orange-600">{heatingMissing}</div>
            <div className="text-[10px] text-muted-foreground">Missing values</div>
          </Card>
          <Card className="p-2 text-center">
            <div className="text-lg font-bold text-red-600">{heatingDeviation}</div>
            <div className="text-[10px] text-muted-foreground">Deviations</div>
          </Card>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/60">
                <th className="py-1 pr-2 font-medium">Room/work-unit</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                <th className="py-1 pr-2 font-medium">Locked</th>
                <th className="py-1 pr-2 font-medium">Missing stages</th>
                <th className="py-1 pr-2 font-medium">Last updated</th>
                <th className="py-1 font-medium">Performed by</th>
              </tr>
            </thead>
            <tbody>
              {heatingRows.map((row) => (
                <tr key={row.roomId} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 pr-2 font-medium text-foreground">{row.roomName}</td>
                  <td className="py-1.5 pr-2">
                    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${heatingStatusPill[row.status]}`}>
                      {heatingStatusLabel[row.status]}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2">
                    {row.isLocked ? (
                      <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-900">
                        Locked
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-muted-foreground">{row.missingStages || '—'}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground">
                    {formatAgo(row.lastUpdated)}
                  </td>
                  <td className="py-1.5">{row.performedBy || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}