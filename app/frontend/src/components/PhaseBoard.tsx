import RoomDashboardCard from '@/components/RoomDashboardCard';
export type { ChecklistSummaryMap } from '@/lib/roomDashboardDerived';
import {
  DEFAULT_PHASE_WORKFLOW,
  formatPhaseStrip,
  normalizeRoomPhase,
  type PhaseWorkflowEntry,
} from '@/lib/roomPhases';

export interface RoomPhaseCard {
  id: number;
  room_number: string;
  phase?: string;
  status: string;
  assigned_worker?: string;
  blocked_reason?: string;
  updated_at?: string | null;
  is_locked?: boolean;
}

interface PhaseBoardProps {
  rooms: RoomPhaseCard[];
  checklistByRoomId?: ChecklistSummaryMap;
  /** Shown on every card (e.g. floor name) */
  floorLabel?: string;
  /** Ordered phases for this project (keys must match `room.phase` values) */
  phases?: PhaseWorkflowEntry[];
  onRoomClick: (roomId: number) => void;
  onPhaseChange?: (roomId: number, newPhase: string) => void;
  selectionMode?: boolean;
  selectedRoomIds?: number[];
  onToggleSelect?: (roomId: number) => void;
}

export default function PhaseBoard({
  rooms,
  checklistByRoomId,
  floorLabel,
  phases = DEFAULT_PHASE_WORKFLOW,
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
      {phases.map((phase) => {
        const defaultKey = phases[0]?.key ?? 'demontering';
        const phaseRooms = rooms.filter((r) => (r.phase || defaultKey) === phase.key);
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
                <span className="ml-auto text-[10px] font-semibold tabular-nums rounded-md bg-white/80 dark:bg-slate-700 px-1.5 py-0.5">
                  {phaseRooms.length}
                </span>
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-b-lg p-2 min-h-[200px] space-y-2">
              {phaseRooms.map((room) => {
                const summary = checklistByRoomId?.[room.id];
                const total = summary?.total ?? 0;
                const completed = summary?.completed ?? 0;
                const blocked = room.status === 'blocked';

                const rp = normalizeRoomPhase(room.phase, phases);
                return (
                  <RoomDashboardCard
                    key={room.id}
                    roomNumber={room.room_number}
                    floorLabel={floorLabel}
                    phaseStrip={formatPhaseStrip(rp, phases)}
                    completed={completed}
                    total={total}
                    blocked={blocked}
                    contentLocked={Boolean(room.is_locked)}
                    blockedReason={room.blocked_reason}
                    assignedWorker={room.assigned_worker}
                    updatedAt={room.updated_at}
                    onClick={() => (selectionMode ? onToggleSelect?.(room.id) : onRoomClick(room.id))}
                    selectionMode={selectionMode}
                    selected={selectedRoomIds.includes(room.id)}
                    draggable={!!onPhaseChange && !selectionMode}
                    onDragStart={onPhaseChange ? (e) => handleDragStart(e, room.id) : undefined}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
