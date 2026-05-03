import { useNavigate, useLocation } from 'react-router-dom';
import { House, DoorOpen, Search, Cog } from 'lucide-react';
import { usePermissions } from '@/lib/permissions';
import { readWorkerLastRoom, workerRoomPath, WORKER_HOME_FIND_ROOM_HASH } from '@/lib/workerLastRoom';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type NavKey = 'home' | 'currentRoom' | 'findRoom' | 'settings';

export default function WorkerMobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isWorker, loading } = usePermissions();
  const { t } = useI18n();
  const pathname = location.pathname;
  const hash = location.hash.replace(/^#/, '');

  if (loading || !isWorker) return null;

  const last = readWorkerLastRoom();
  const currentRoomPath = last
    ? `/project/${last.projectId}/floor/${last.floorId}/room/${last.roomId}`
    : null;

  const roomLabelShort = (() => {
    if (!last) return t('workerNavWork');
    const n = last.roomNumber?.trim();
    if (n) return n.length > 8 ? `${n.slice(0, 7)}…` : n;
    return t('workerNavWork');
  })();

  const isHomeActive = pathname === '/' && hash !== WORKER_HOME_FIND_ROOM_HASH;
  const isSearchActive = pathname === '/' && hash === WORKER_HOME_FIND_ROOM_HASH;
  const isRoomActive = Boolean(currentRoomPath && pathname === currentRoomPath);
  const isSettingsActive = pathname === '/worker/settings';

  const goCurrentRoom = () => {
    if (!last) {
      navigate('/');
      return;
    }
    navigate(workerRoomPath(last.projectId, last.floorId, last.roomId, { focusChecklist: true }));
  };

  const goFindRoom = () => {
    navigate({ pathname: '/', hash: WORKER_HOME_FIND_ROOM_HASH });
  };

  const items: {
    key: NavKey;
    label: string;
    icon: typeof House;
    active: boolean;
    onClick: () => void;
  }[] = [
    {
      key: 'home',
      label: t('workerNavHome'),
      icon: House,
      active: isHomeActive,
      onClick: () => navigate('/'),
    },
    {
      key: 'currentRoom',
      label: roomLabelShort,
      icon: DoorOpen,
      active: isRoomActive,
      onClick: goCurrentRoom,
    },
    {
      key: 'findRoom',
      label: t('workerNavSearch'),
      icon: Search,
      active: isSearchActive,
      onClick: goFindRoom,
    },
    {
      key: 'settings',
      label: t('workerNavSettings'),
      icon: Cog,
      active: isSettingsActive,
      onClick: () => navigate('/worker/settings'),
    },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-md lg:hidden"
      aria-label="Worker navigation"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around gap-0.5 px-1">
        {items.map(({ key, label, icon: Icon, active, onClick }) => (
          <li key={key} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onClick}
              className={cn(
                'flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-center transition-colors active:bg-muted/60',
                active
                  ? 'bg-[#1E3A5F]/10 text-[#1E3A5F] dark:bg-blue-950/50 dark:text-blue-300'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon
                className={cn('h-6 w-6 shrink-0', active && 'text-[#1E3A5F] dark:text-blue-400')}
                aria-hidden
                strokeWidth={active ? 2.5 : 2}
              />
              <span className="max-w-full truncate px-0.5 text-[10px] font-semibold leading-tight">{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
