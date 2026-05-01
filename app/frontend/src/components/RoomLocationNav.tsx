import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type RoomNavSibling = { id: number; room_number: string };

type Props = {
  projectId: string;
  projectName: string;
  floorId: string;
  floorName: string;
  roomNumber: string;
  prevRoom: RoomNavSibling | null;
  nextRoom: RoomNavSibling | null;
  /** Shown when Previous is disabled (tooltips + compact hint). */
  prevUnavailableHint?: string;
  /** Shown when Next is disabled (tooltips + compact hint). */
  nextUnavailableHint?: string;
};

export function RoomLocationNav({
  projectId,
  projectName,
  floorId,
  floorName,
  roomNumber,
  prevRoom,
  nextRoom,
  prevUnavailableHint,
  nextUnavailableHint,
}: Props) {
  const { t } = useI18n();
  const linkCls = cn(
    'text-muted-foreground transition-colors underline-offset-2 hover:text-foreground hover:underline',
    'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
  );

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <nav
        className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground"
        aria-label="Location"
      >
        <Link to="/" className={linkCls}>
          {t('projects')}
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        <Link
          to={`/project/${projectId}`}
          className={cn(linkCls, 'max-w-[42vw] truncate sm:max-w-[14rem]')}
        >
          {projectName.trim() ? projectName : 'Project'}
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        <Link
          to={`/project/${projectId}/floor/${floorId}`}
          className={cn(linkCls, 'max-w-[38vw] truncate sm:max-w-[12rem]')}
        >
          {floorName.trim() ? floorName : 'Floor'}
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        <span
          className="truncate font-semibold text-foreground max-w-[40vw] sm:max-w-[10rem]"
          aria-current="page"
        >
          {roomNumber}
        </span>
      </nav>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm shrink-0">
        {prevRoom ? (
          <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5" asChild>
            <Link
              to={`/project/${projectId}/floor/${floorId}/room/${prevRoom.id}`}
              aria-label={`Previous room, ${prevRoom.room_number}`}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Previous room</span>
              <span className="inline sm:hidden">Prev</span>
            </Link>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-2.5"
            disabled
            title={prevUnavailableHint}
            aria-label={prevUnavailableHint ?? 'No previous room'}
          >
            <ChevronLeft className="h-4 w-4 opacity-50" aria-hidden />
            <span className="hidden sm:inline">Previous room</span>
            <span className="inline sm:hidden">Prev</span>
          </Button>
        )}
        <span className="text-muted-foreground/60 hidden sm:inline" aria-hidden>
          |
        </span>
        {nextRoom ? (
          <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5" asChild>
            <Link
              to={`/project/${projectId}/floor/${floorId}/room/${nextRoom.id}`}
              aria-label={`Next room, ${nextRoom.room_number}`}
            >
              <span className="hidden sm:inline">Next room</span>
              <span className="inline sm:hidden">Next</span>
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-2.5"
            disabled
            title={nextUnavailableHint}
            aria-label={nextUnavailableHint ?? 'No next room'}
          >
            <span className="hidden sm:inline">Next room</span>
            <span className="inline sm:hidden">Next</span>
            <ChevronRight className="h-4 w-4 opacity-50" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
