import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CheckCircle2, ChevronDown, Clock, AlertTriangle, Ban, LayoutGrid } from 'lucide-react';
import {
  deriveHeatingCableStatus,
  HEATING_CABLE_STAGES,
  normalizeHeatingCableDoc,
  type HeatingCableRoomStatus,
} from '@/lib/heatingCable';
import type { PhaseWorkflowEntry } from '@/lib/roomPhases';
import { normalizeRoomPhase, phaseLabel, roomRequiresHeatingCableDocumentation } from '@/lib/roomPhases';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

interface FloorInfo {
  id: number;
  floor_number: number;
  name?: string;
}

interface Room {
  id: number;
  floor_id: number;
  status: string;
  room_number?: string;
  updated_at?: string | null;
  assigned_worker?: string;
  heating_cable_doc?: unknown;
  phase_tool_overrides?: unknown;
  phase?: string;
}

interface DashboardStatsProps {
  rooms: Room[];
  floors: FloorInfo[];
  phaseWorkflow: PhaseWorkflowEntry[];
  /** Route param for deep links to rooms */
  projectId: string;
}

/** Norwegian / European style: 09.05.2026 14:32 */
function formatDashboardDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return format(d, 'dd.MM.yyyy HH:mm');
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

type HeatingCableFilter = 'all' | 'complete' | 'incomplete' | 'missing_doc' | 'issues';

function passesHeatingFilter(status: HeatingCableRoomStatus, filter: HeatingCableFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'complete':
      return status === 'complete';
    case 'incomplete':
      return status !== 'complete';
    case 'missing_doc':
      return status === 'not_started';
    case 'issues':
      return status === 'has_deviation_missing';
    default:
      return true;
  }
}

type HeatingRow = {
  roomId: number;
  floorId: number;
  phaseKey: string;
  phaseLabel: string;
  roomName: string;
  status: HeatingCableRoomStatus;
  isLocked: boolean;
  missingStages: string;
  lastUpdated: string | null;
  recordedBy: string;
};

function workflowPhaseOrder(key: string, workflow: PhaseWorkflowEntry[]): number {
  const i = workflow.findIndex((p) => p.key === key);
  return i >= 0 ? i : 999;
}

export default function DashboardStats({ rooms, floors, phaseWorkflow, projectId }: DashboardStatsProps) {
  const [heatingFilter, setHeatingFilter] = useState<HeatingCableFilter>('all');

  const total = rooms.length;
  const completed = rooms.filter((r) => r.status === 'completed').length;
  const inProgress = rooms.filter((r) => r.status === 'in_progress').length;
  const blocked = rooms.filter((r) => r.status === 'blocked').length;
  const readyForInspection = rooms.filter((r) => r.status === 'ready_for_inspection').length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const heatingRows = useMemo(() => {
    const heatingRooms = rooms.filter((r) => roomRequiresHeatingCableDocumentation(r, phaseWorkflow));
    return heatingRooms
      .map((room): HeatingRow => {
        const derived = deriveHeatingCableStatus(room.heating_cable_doc);
        const doc = normalizeHeatingCableDoc(room.heating_cable_doc);
        const missingLabels = derived.missingStages.map(
          (k) => HEATING_CABLE_STAGES.find((s) => s.key === k)?.label || k
        );
        const lastIso = derived.lastUpdated || room.updated_at || null;
        const pk = normalizeRoomPhase(room.phase, phaseWorkflow);
        const recordedBy = [derived.performedBy?.trim(), room.assigned_worker?.trim()]
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(' · ');
        return {
          roomId: room.id,
          floorId: room.floor_id,
          phaseKey: pk,
          phaseLabel: phaseLabel(pk, phaseWorkflow),
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
  }, [rooms, phaseWorkflow]);

  const filteredHeatingRows = useMemo(
    () => heatingRows.filter((r) => passesHeatingFilter(r.status, heatingFilter)),
    [heatingRows, heatingFilter]
  );

  const heatingTotal = heatingRows.length;
  const heatingComplete = heatingRows.filter((r) => r.status === 'complete').length;
  const heatingPartial = heatingRows.filter((r) => r.status === 'partial').length;
  const heatingMissingDoc = heatingRows.filter((r) => r.status === 'not_started').length;
  const heatingIssues = heatingRows.filter((r) => r.status === 'has_deviation_missing').length;

  const floorLabelById = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of floors) {
      m.set(f.id, f.name?.trim() || `Floor ${f.floor_number}`);
    }
    return m;
  }, [floors]);

  const sortedFloorIds = useMemo(() => [...floors].sort((a, b) => a.floor_number - b.floor_number).map((f) => f.id), [
    floors,
  ]);

  const floorGroups = useMemo(() => {
    const byFloor = new Map<number, HeatingRow[]>();
    for (const row of filteredHeatingRows) {
      const list = byFloor.get(row.floorId) ?? [];
      list.push(row);
      byFloor.set(row.floorId, list);
    }

    const orderedFloors: { floorId: number; label: string; rows: HeatingRow[] }[] = [];

    for (const fid of sortedFloorIds) {
      const rows = byFloor.get(fid);
      if (rows?.length) {
        orderedFloors.push({
          floorId: fid,
          label: floorLabelById.get(fid) ?? `Floor ${fid}`,
          rows,
        });
        byFloor.delete(fid);
      }
    }

    for (const [floorId, rows] of byFloor) {
      orderedFloors.push({
        floorId,
        label: floorLabelById.get(floorId) ?? `Unknown floor (${floorId})`,
        rows,
      });
    }

    return orderedFloors.map((g) => {
      const sortedRows = [...g.rows].sort((a, b) => {
        const pa = workflowPhaseOrder(a.phaseKey, phaseWorkflow);
        const pb = workflowPhaseOrder(b.phaseKey, phaseWorkflow);
        if (pa !== pb) return pa - pb;
        return a.roomName.localeCompare(b.roomName, undefined, { numeric: true });
      });

      const completeCt = sortedRows.filter((r) => r.status === 'complete').length;
      const incompleteCt = sortedRows.filter((r) => r.status !== 'complete').length;
      const missingCt = sortedRows.filter((r) => r.status === 'not_started').length;
      const issuesCt = sortedRows.filter((r) => r.status === 'has_deviation_missing').length;
      const phaseKeys = new Set(sortedRows.map((r) => r.phaseKey));
      const showPhaseSections = phaseKeys.size > 1;

      const phaseSections: { phaseLabel: string; rows: HeatingRow[] }[] = [];
      if (showPhaseSections) {
        const byPhase = new Map<string, HeatingRow[]>();
        for (const r of sortedRows) {
          const list = byPhase.get(r.phaseKey) ?? [];
          list.push(r);
          byPhase.set(r.phaseKey, list);
        }
        const phaseKeysSorted = [...byPhase.keys()].sort(
          (a, b) => workflowPhaseOrder(a, phaseWorkflow) - workflowPhaseOrder(b, phaseWorkflow)
        );
        for (const pk of phaseKeysSorted) {
          const pr = byPhase.get(pk);
          if (!pr?.length) continue;
          pr.sort((a, b) => a.roomName.localeCompare(b.roomName, undefined, { numeric: true }));
          phaseSections.push({
            phaseLabel: phaseLabel(pk, phaseWorkflow),
            rows: pr,
          });
        }
      }

      return {
        ...g,
        rows: sortedRows,
        summary: {
          total: sortedRows.length,
          complete: completeCt,
          incomplete: incompleteCt,
          missingDoc: missingCt,
          issues: issuesCt,
        },
        showPhaseSections,
        phaseSections: showPhaseSections ? phaseSections : [{ phaseLabel: '', rows: sortedRows }],
      };
    });
  }, [filteredHeatingRows, sortedFloorIds, floorLabelById, phaseWorkflow]);

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
    projectId.trim() ? `/project/${projectId}/floor/${floorId}/room/${roomId}` : undefined;

  const renderRow = (row: HeatingRow) => {
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
        <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
          {formatDashboardDateTime(row.lastUpdated)}
        </td>
        <td className="py-2 px-2 text-foreground/90">{row.recordedBy || '—'}</td>
      </tr>
    );
  };

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

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[11px] font-medium text-muted-foreground shrink-0">Filter rooms</span>
          <ToggleGroup
            type="single"
            value={heatingFilter}
            onValueChange={(v) => {
              if (v) setHeatingFilter(v as HeatingCableFilter);
            }}
            variant="outline"
            size="sm"
            className="flex flex-wrap justify-start gap-1"
          >
            <ToggleGroupItem value="all" aria-label="All rooms" className="text-[11px] px-2 h-8">
              All
            </ToggleGroupItem>
            <ToggleGroupItem value="complete" aria-label="Complete rooms" className="text-[11px] px-2 h-8">
              Complete
            </ToggleGroupItem>
            <ToggleGroupItem value="incomplete" aria-label="Incomplete rooms" className="text-[11px] px-2 h-8">
              Incomplete
            </ToggleGroupItem>
            <ToggleGroupItem value="missing_doc" aria-label="Missing documentation" className="text-[11px] px-2 h-8">
              Missing doc
            </ToggleGroupItem>
            <ToggleGroupItem value="issues" aria-label="Issues and deviations" className="text-[11px] px-2 h-8">
              Issues
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {heatingRows.length === 0 ? (
          <div className="rounded-md border border-border/50 bg-background/80 py-6 px-2 text-center text-[13px] text-muted-foreground">
            No rooms require heating cable documentation for this project workflow.
          </div>
        ) : filteredHeatingRows.length === 0 ? (
          <div className="rounded-md border border-border/50 bg-background/80 py-6 px-2 text-center text-[13px] text-muted-foreground">
            No rooms match this filter.
          </div>
        ) : (
          <div className="space-y-2">
            {floorGroups.map((group) => {
              const { summary } = group;
              const summaryParts = [
                `${summary.total} room${summary.total === 1 ? '' : 's'}`,
                `${summary.complete} complete`,
                `${summary.incomplete} incomplete`,
              ];
              if (summary.missingDoc > 0) summaryParts.push(`${summary.missingDoc} missing doc`);
              if (summary.issues > 0) summaryParts.push(`${summary.issues} issues`);

              return (
                <Collapsible key={group.floorId} defaultOpen className="rounded-md border border-border/50 bg-background/80">
                  <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-muted/40 rounded-t-md border-b border-transparent [&[data-state=open]]:border-border/50 [&[data-state=open]>svg]:rotate-180">
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
                    <span className="min-w-0 flex-1 font-semibold text-foreground truncate">{group.label}</span>
                    <span className="hidden sm:inline text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                      {summaryParts.join(' · ')}
                    </span>
                  </CollapsibleTrigger>
                  <div className="sm:hidden px-3 pb-2 pt-0 text-[11px] text-muted-foreground leading-snug border-b border-border/40">
                    {summaryParts.join(' · ')}
                  </div>
                  <CollapsibleContent>
                    <div className="overflow-x-auto">
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
                        {group.phaseSections.map((sec, idx) => (
                          <tbody key={`${sec.phaseLabel}-${idx}`}>
                            {group.showPhaseSections ? (
                              <tr className="bg-muted/25 border-b border-border/40">
                                <td
                                  colSpan={5}
                                  className="py-1.5 px-2 text-[11px] font-medium text-muted-foreground"
                                >
                                  Phase · {sec.phaseLabel}
                                </td>
                              </tr>
                            ) : null}
                            {sec.rows.map((row) => renderRow(row))}
                          </tbody>
                        ))}
                      </table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
