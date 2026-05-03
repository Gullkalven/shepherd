import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Moon, Sun } from 'lucide-react';
import { usePermissions } from '@/lib/permissions';
import { useTheme } from '@/lib/theme';
import { useDevPresentationSession } from '@/lib/devPresentationSession';
import { runAppLogout } from '@/lib/runAppLogout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function WorkerMePage() {
  const navigate = useNavigate();
  const { displayName, isWorker, loading: permLoading } = usePermissions();
  const { theme, toggleTheme } = useTheme();
  const { endSession } = useDevPresentationSession();

  useEffect(() => {
    if (permLoading) return;
    if (!isWorker) navigate('/', { replace: true });
  }, [permLoading, isWorker, navigate]);

  if (permLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 pb-24 dark:bg-background lg:pb-10">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  if (!isWorker) {
    return null;
  }

  const name = displayName?.trim() || 'Worker';

  return (
    <div className="min-h-dvh bg-slate-50 pb-28 dark:bg-background lg:pb-10">
      <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-none lg:px-6 xl:px-8">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Account</p>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-foreground">Me</h1>
          <p className="text-sm text-muted-foreground">Logged in as {name}</p>
        </header>

        <Card className="divide-y divide-border p-0">
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full justify-start gap-3 rounded-none px-4 text-base font-normal"
            onClick={() => toggleTheme()}
          >
            {theme === 'dark' ? <Sun className="h-5 w-5 shrink-0" /> : <Moon className="h-5 w-5 shrink-0" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full justify-start gap-3 rounded-none px-4 text-base font-normal text-destructive hover:text-destructive"
            onClick={() => void runAppLogout(navigate, endSession)}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            Log out
          </Button>
        </Card>
      </div>
    </div>
  );
}
