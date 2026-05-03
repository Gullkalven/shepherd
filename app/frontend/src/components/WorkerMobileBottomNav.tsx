import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { usePermissions } from '@/lib/permissions';
import { readWorkerLastRoom, workerRoomPath } from '@/lib/workerLastRoom';
import { cn } from '@/lib/utils';

type NavKey = 'today' | 'rooms' | 'docs' | 'me';

const NAV: { key: NavKey; label: string; path: string | null; match: (path: string) => boolean }[] = [
  { key: 'rooms', label: 'Rooms', path: '/worker/rooms', match: (p) => p === '/worker/rooms' },
  { key: 'today', label: 'Today', path: '/', match: (p) => p === '/' },
  { key: 'docs', label: 'Camera / Docs', path: null, match: () => false },
  { key: 'me', label: 'Me', path: '/worker/me', match: (p) => p === '/worker/me' },
];

export default function WorkerMobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isWorker, loading } = usePermissions();
  const pathname = location.pathname;

  if (loading || !isWorker) return null;

  const isActive = (item: (typeof NAV)[number]) => {
    if (item.key === 'docs') {
      return pathname.startsWith('/project/') && pathname.includes('/room/');
    }
    return item.match(pathname);
  };

  const openDocs = () => {
    const last = readWorkerLastRoom();
    if (last) {
      navigate(workerRoomPath(last.projectId, last.floorId, last.roomId, { focusDocumentation: true }));
      return;
    }
    toast.message('Open a room first', {
      description: 'Use Today or Rooms, then Camera / Docs opens documentation in that room.',
    });
    navigate('/');
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-md lg:hidden"
      aria-label="Worker navigation"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around gap-0 px-1">
        {NAV.map((item) => {
          const active = isActive(item);
          const isDocs = item.key === 'docs';
          return (
            <li key={item.key} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => {
                  if (isDocs) {
                    openDocs();
                  } else if (item.path) {
                    navigate(item.path);
                  }
                }}
                className={cn(
                  'flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-center text-[11px] font-semibold leading-snug transition-colors active:bg-muted/60',
                  active
                    ? 'text-[#1E3A5F] dark:text-blue-400'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className="px-0.5">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
