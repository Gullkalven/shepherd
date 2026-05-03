import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Moon, Sun } from 'lucide-react';
import { usePermissions } from '@/lib/permissions';
import { useTheme } from '@/lib/theme';
import { useI18n } from '@/lib/i18n';
import { useDevPresentationSession } from '@/lib/devPresentationSession';
import { runAppLogout, runWorkerSwitch } from '@/lib/runAppLogout';
import { readWorkerSession, WORKER_SESSION_TTL_MS } from '@/lib/workerSession';
import { resolveWorkerActorLabel } from '@/lib/workerIdentity';
import { isDevRoleSwitcherHost } from '@/lib/devRole';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import DevRoleSwitcher from '@/components/DevRoleSwitcher';

export default function WorkerMePage() {
  const navigate = useNavigate();
  const { displayName, isWorker, loading: permLoading, sessionIsPinWorker } = usePermissions();
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { endSession } = useDevPresentationSession();

  useEffect(() => {
    if (permLoading) return;
    if (!isWorker) navigate('/', { replace: true });
  }, [permLoading, isWorker, navigate]);

  if (permLoading) {
    return (
      <div className="flex min-h-dvh min-w-0 max-w-full items-center justify-center overflow-x-hidden bg-slate-50 pb-24 dark:bg-background lg:pb-10">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  if (!isWorker) {
    return null;
  }

  const name = resolveWorkerActorLabel(displayName) || 'Worker';
  const pinSession = sessionIsPinWorker ? readWorkerSession() : null;
  const sessionEndsLabel =
    pinSession?.expiresAt != null
      ? new Date(pinSession.expiresAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
      : null;

  return (
    <div className="min-h-dvh min-w-0 max-w-full overflow-x-hidden bg-slate-50 pb-28 dark:bg-background lg:pb-10">
      <div className="mx-auto w-full min-w-0 max-w-lg space-y-4 pb-4 pt-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] lg:max-w-none lg:px-6 xl:px-8">
        <header className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-foreground">{t('workerNavSettings')}</h1>
          <p className="text-sm text-muted-foreground">Logged in as {name}</p>
          {sessionIsPinWorker ? null : (
            <p className="text-xs text-muted-foreground">
              Session: <strong className="text-foreground">App account</strong> (not site worker PIN).
            </p>
          )}
        </header>

        {isDevRoleSwitcherHost() ? (
          <Card className="p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Switch user</p>
            <DevRoleSwitcher />
          </Card>
        ) : null}

        {sessionIsPinWorker ? (
          <Card className="space-y-3 p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Site worker (PIN)</p>
              {sessionEndsLabel ? (
                <p className="mt-1 text-xs text-muted-foreground leading-snug">
                  Session ends {sessionEndsLabel}. Provisional login lasts about {Math.round(WORKER_SESSION_TTL_MS / 3600000)}{' '}
                  hours on this device — use PIN again after that, or sign out below.
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground leading-snug">
                  Provisional PIN session on this device (about {Math.round(WORKER_SESSION_TTL_MS / 3600000)} hours).
                </p>
              )}
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={() => runWorkerSwitch(navigate)}>
              Switch worker
            </Button>
          </Card>
        ) : null}

        <Card className="divide-y divide-border p-0">
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full justify-start gap-3 rounded-none px-4 text-base font-normal"
            onClick={() => toggleTheme()}
          >
            {theme === 'dark' ? <Sun className="h-5 w-5 shrink-0" /> : <Moon className="h-5 w-5 shrink-0" />}
            {theme === 'dark' ? t('lightMode') : t('darkMode')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full justify-start gap-3 rounded-none px-4 text-base font-normal text-destructive hover:text-destructive"
            onClick={() =>
              sessionIsPinWorker ? runWorkerSwitch(navigate) : void runAppLogout(navigate, endSession)
            }
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {sessionIsPinWorker ? 'Log out' : t('logOut')}
          </Button>
        </Card>
      </div>
    </div>
  );
}
