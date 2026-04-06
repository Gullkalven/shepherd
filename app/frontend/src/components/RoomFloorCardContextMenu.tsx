import type { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { PhaseWorkflowEntry } from '@/lib/roomPhases';

export interface RoomFloorCardContextMenuProps {
  roomId: number;
  /** Room number shown in the menu header, e.g. "101" */
  roomLabel: string;
  selectedRoomIds: number[];
  phaseWorkflow: PhaseWorkflowEntry[];
  canDelete: boolean;
  canChangePhase: boolean;
  canLock: boolean;
  children: ReactNode;
  onOpenRoom: (roomId: number) => void;
  onDeleteRooms: (ids: number[]) => void;
  onPhaseRooms: (ids: number[], phaseKey: string) => void;
  onLockRooms: (ids: number[], locked: boolean) => void;
}

function targetRoomIds(roomId: number, selectedRoomIds: number[]): number[] {
  if (selectedRoomIds.length > 0 && selectedRoomIds.includes(roomId)) {
    return selectedRoomIds;
  }
  return [roomId];
}

export default function RoomFloorCardContextMenu({
  roomId,
  roomLabel,
  selectedRoomIds,
  phaseWorkflow,
  canDelete,
  canChangePhase,
  canLock,
  children,
  onOpenRoom,
  onDeleteRooms,
  onPhaseRooms,
  onLockRooms,
}: RoomFloorCardContextMenuProps) {
  const ids = targetRoomIds(roomId, selectedRoomIds);
  const count = ids.length;
  const scopeLabel = count === 1 ? roomLabel : `${count} items`;

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full rounded-[inherit] [&:focus]:outline-none">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[11rem]">
        <ContextMenuLabel className="text-xs font-normal text-muted-foreground">{scopeLabel}</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onOpenRoom(roomId)}>
          {count > 1 ? 'Open selected' : 'Open'}
        </ContextMenuItem>
        {canChangePhase ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Change active phase</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-[9rem]">
              {phaseWorkflow.map((p) => (
                <ContextMenuItem key={p.key} inset onSelect={() => onPhaseRooms(ids, p.key)}>
                  {p.label}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : null}
        {canLock ? (
          <>
            <ContextMenuItem inset onSelect={() => onLockRooms(ids, true)}>
              Lock
            </ContextMenuItem>
            <ContextMenuItem inset onSelect={() => onLockRooms(ids, false)}>
              Unlock
            </ContextMenuItem>
          </>
        ) : null}
        {canDelete ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              inset
              className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-950 dark:focus:text-red-200"
              onSelect={() => onDeleteRooms(ids)}
            >
              Delete
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
