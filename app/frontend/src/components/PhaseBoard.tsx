import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { User, AlertTriangle } from 'lucide-react';
import { STATUS_CONFIG } from '@/lib/roomStatus';

export interface RoomPhaseCard {
  id: number;
  room_number: string;
  phase?: string;
  status: string;
  assigned_worker?: string;
  blocked_reason?: string;
}

export type ChecklistSummaryMap = Record<number, { completed: number; total: number }>;

interface PhaseBoardProps {
  rooms: RoomPhaseCard[];
  checklistByRoomId?: ChecklistSummaryMap;
  onRoomClick: (roomId: number) => void;
  onPhaseChange?: (roomId: number, newPhase: string) => void;
  selectionMode?: boolean;
  selectedRoomIds?: number[];
  onToggleSelect?: (roomId: number) => void;
}

const PHASES = [
  { key: 'demontering', label: 'Demontering' },
  { key: 'varmekabel', label: 'Varmekabel' },
  { key: 'remontering', label: 'Remontering' },
  { key: 'sluttkontroll', label: 'Sluttkontroll' },
];

export default function PhaseBoard({
  rooms,
  checklistByRoomId,
  onRoomClick,
  onPhaseChange,
  selectionMode = false,
  selectedRoomIds = [],
  onToggleSelect,
}: PhaseBoardProps) {
  const handleDragStart = (e: React.DragEvent, roomId: number) => {
    e.dataTransfer.setData('roomId', roomId.toString());
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, phase: string) => {
    e.preventDefault();
    if (!onPhaseChange) return;
    const roomId = parseInt(e.dataTransfer.getData('roomId'));
    if (roomId) onPhaseChange(roomId, phase);
  };

  return (
    <div className="flex flex-row flex-nowrap gap-4 overflow-x-auto overflow-y-visible pb-4 snap-x snap-mandatory [-webkit-overflow-scrolling:touch]">
      {PHASES.map((phase) => {
        const phaseRooms = rooms.filter((r) => (r.phase || 'demontering') === phase.key);
        return (
          <div
            key={phase.key}
            className="flex-shrink-0 snap-start w-[min(20rem,calc(100vw-2rem))] sm:w-[21rem]"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, phase.key)}
          >
            <div className="rounded-t-lg px-3 py-2 bg-slate-100 dark:bg-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">{phase.label}</span>
                <Badge variant="secondary" className="ml-auto text-[10px] h-5">
                  {phaseRooms.length}
                </Badge>
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-b-lg p-2 min-h-[200px] space-y-2">
              {phaseRooms.map((room) => {
                const summary = checklistByRoomId?.[room.id];
                const total = summary?.total ?? 0;
                const completed = summary?.completed ?? 0;
                const checklistLine =
                  total > 0 ? `${completed}/${total}` : '—';
                const checklistOk = total > 0 && completed >= total;
                const openChecklist = total > 0 ? Math.max(0, total - completed) : 0;
                const statusCfg = STATUS_CONFIG[room.status] || STATUS_CONFIG.not_started;
                const blocked = room.status === 'blocked';
                const roomDone = room.status === 'completed' && (total === 0 || checklistOk);

                return (
                  <Card
                    key={room.id}
                    className={`p-2.5 cursor-pointer hover:shadow-md transition-shadow active:scale-[0.98] border-l-4 ${
                      roomDone
                        ? 'border-l-emerald-500'
                        : blocked
                          ? 'border-l-red-500'
                          : 'border-l-transparent'
                    }`}
                    draggable={!!onPhaseChange && !selectionMode}
                    onDragStart={onPhaseChange ? (e) => handleDragStart(e, room.id) : undefined}
                    onClick={() => (selectionMode ? onToggleSelect?.(room.id) : onRoomClick(room.id))}
                  >
                    {selectionMode && (
                      <div className="mb-1">
                        <Checkbox checked={selectedRoomIds.includes(room.id)} />
                      </div>
                    )}
                    <div className="font-bold text-base leading-tight">Room {room.room_number}</div>
                    <div
                      className={`mt-1 text-sm font-semibold tabular-nums ${
                        checklistOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {checklistLine}
                      {total > 0 && (
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">sjekkliste</span>
                      )}
                    </div>
                    <div className="mt-1.5">
                      <Badge className={`${statusCfg.bg} ${statusCfg.color} text-[10px] border-0 h-5`}>
                        {statusCfg.label}
                      </Badge>
                    </div>
                    {(blocked || openChecklist > 0) && (
                      <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                        {blocked && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded-md bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5"
                            title={room.blocked_reason || 'Blocked'}
                          >
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            1
                          </span>
                        )}
                        {!blocked && openChecklist > 0 && (
                          <span
                            className="rounded-md bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5"
                            title="Open checklist items"
                          >
                            {openChecklist}
                          </span>
                        )}
                      </div>
                    )}
                    {room.assigned_worker && (
                      <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
                        <User className="h-3 w-3 shrink-0" />
                        <span className="truncate">{room.assigned_worker}</span>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
