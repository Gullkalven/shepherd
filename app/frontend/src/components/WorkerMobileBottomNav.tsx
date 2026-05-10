import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { House, DoorOpen, Cog } from 'lucide-react';
import { usePermissions } from '@/lib/permissions';
import {
  readWorkerLastRoom,
  workerRoomPath,
  WORKER_LAST_ROOM_PERSISTED_EVENT,
  parseWorkerRoomPath,
} from '@/lib/workerLastRoom';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type NavKey = 'home' | 'currentRoom' | 'settings';

function truncateRoomLabel(s: string, max = 8): string {
  const x = s.trim();
  if (!x) return '';
  return x.length > max ? `${x.slice(0, max - 1)}…` : x;
}

export default function WorkerMobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isWorker, loading } = usePermissions();
  const { t } = useI18n();
  const pathname = location.pathname;

  /** Re-render when last-room storage updates (same route, new room data). */
  const [, setStorageEpoch] = useState(0);
  useEffect(() => {
    const onPersist = () => setStorageEpoch((n) => n + 1);
    window.addEventListener(WORKER_LAST_ROOM_PERSISTED_EVENT, onPersist);
    return () => window.removeEventListener(WORKER_LAST_ROOM_PERSISTED_EVENT, onPersist);
  }, []);

  const roomRoute = useMemo(() => parseWorkerRoomPath(pathname), [pathname]);
  const last = readWorkerLastRoom();

  const idsMatch = Boolean(
    roomRoute &&
      last &&
      last.projectId === roomRoute.projectId &&
      last.floorId === roomRoute.floorId &&
      last.roomId === roomRoute.roomId
  );

  const roomLabelShort = useMemo(() => {
    if (roomRoute) {
      if (idsMatch && last?.roomNumber?.trim()) {
        return truncateRoomLabel(last.roomNumber);
      }
      return t('workerNavRoom');
    }
    if (!last) return t('workerNavWork');
    const n = last.roomNumber?.trim();
    if (n) return truncateRoomLabel(n);
    return t('workerNavWork');
  }, [roomRoute, idsMatch, last, t]);

  const isHomeActive = pathname === '/';
  const isRoomActive = Boolean(roomRoute);
  const isSettingsActive = pathname === '/worker/settings';

  const goCurrentRoom = () => {
    const snap = readWorkerLastRoom();
    if (!snap) {
      navigate('/');
      return;
    }
    navigate(workerRoomPath(snap.projectId, snap.floorId, snap.roomId, { focusChecklist: true }));
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
      key: 'settings',
      label: t('workerNavSettings'),
      icon: Cog,
      active: isSettingsActive,
      onClick: () => navigate('/worker/settings'),
    },
  ];

  if (loading || !isWorker) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 box-border w-full min-w-0 max-w-full border-t border-border bg-background/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] backdrop-blur-md lg:hidden"
      aria-label={t('ariaWorkerNav')}
    >
      <ul className="mx-auto flex w-full min-w-0 max-w-lg items-stretch justify-evenly gap-2 sm:gap-3">
        {items.map(({ key, label, icon: Icon, active, onClick }) => (
          <li key={key} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onClick}
              className={cn(
                'flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-center transition-colors active:bg-muted/60',
                active
                  ? 'bg-[#1E3A5F]/10 text-[#1E3A5F] dark:bg-blue-950/50 dark:text-blue-300'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon
                className={cn('h-7 w-7 shrink-0', active && 'text-[#1E3A5F] dark:text-blue-400')}
                aria-hidden
                strokeWidth={active ? 2.5 : 2}
              />
              <span className="max-w-full truncate px-0.5 text-[11px] font-semibold leading-tight">{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
