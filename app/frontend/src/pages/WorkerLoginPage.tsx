import { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAPIBaseURL } from '@/lib/config';
import { clearWorkerLastRoom } from '@/lib/workerLastRoom';
import { persistWorkerSession, readWorkerSession, WORKER_SESSION_TTL_MS } from '@/lib/workerSession';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { ShepherdLogo } from '@/components/ShepherdLogo';
import { formatNb, useI18n } from '@/lib/i18n';

type LoginResponse = {
  access_token: string;
  project: { id: number; name: string };
  worker: { id: number; name: string; project_id: number };
};

export default function WorkerLoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inferredProject = params.get('project');
  const [projectId, setProjectId] = useState(inferredProject || '');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  /** Avoid flashing PIN form when a non-expired session already exists on this device. */
  const [bootReady, setBootReady] = useState(false);

  useLayoutEffect(() => {
    if (readWorkerSession()) {
      navigate('/worker/rooms', { replace: true });
      return;
    }
    setBootReady(true);
  }, [navigate]);

  useEffect(() => {
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    const previousThemeColor = themeColorMeta?.getAttribute('content');
    document.documentElement.classList.add('login-screen-lock');
    themeColorMeta?.setAttribute('content', '#0b1623');
    return () => {
      document.documentElement.classList.remove('login-screen-lock');
      if (previousThemeColor) {
        themeColorMeta?.setAttribute('content', previousThemeColor);
      }
    };
  }, []);

  const submit = async () => {
    const pid = Number(projectId.trim());
    if (!Number.isFinite(pid) || pid < 1) {
      toast.error(t('toastInvalidProject'));
      return;
    }
    if (pin.trim().length < 4) {
      toast.error(t('toastPinTooShort'));
      return;
    }
    setBusy(true);
    try {
      const base = getAPIBaseURL().replace(/\/$/, '');
      const res = await fetch(`${base}/api/v1/worker/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: pid, pin: pin.trim() }),
      });
      const data = (await res.json().catch(() => null)) as LoginResponse & { detail?: string };
      if (!res.ok) {
        const msg = typeof data?.detail === 'string' ? data.detail : 'Could not sign in';
        toast.error(msg === 'Wrong PIN or inactive worker' ? t('toastWrongPin') : msg);
        return;
      }
      persistWorkerSession({
        token: data.access_token,
        projectId: data.project.id,
        projectName: data.project.name,
        workerId: data.worker.id,
        name: data.worker.name,
      });
      // Do not resume a last-opened room from a previous site/session (avoids wrong `/project/...` targets).
      clearWorkerLastRoom();
      toast.success(formatNb(t('toastSignedInAs'), { name: data.worker.name }));
      navigate('/worker/rooms', { replace: true });
    } catch {
      toast.error(t('toastNetworkError'));
    } finally {
      setBusy(false);
    }
  };

  if (!bootReady) {
    return (
      <div className="flex h-dvh min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#0b1623] px-4 pt-[env(safe-area-inset-top)] text-slate-100">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  const ttlHours = Math.round(WORKER_SESSION_TTL_MS / 3600000);

  return (
    <div className="fixed inset-0 flex h-dvh min-h-[100dvh] w-full flex-col items-center justify-center overflow-hidden bg-[#0b1623] px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-slate-100">
      <div className="mb-5 flex justify-center">
        <ShepherdLogo className="h-16 w-16 rounded-xl shadow-md" />
      </div>
      <Card className="max-h-full w-full max-w-md overflow-hidden border-border p-5 shadow-sm sm:p-6">
        <h1 className="text-xl font-black tracking-tight text-[#1E3A5F] dark:text-foreground">{t('workerLoginTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {formatNb(t('workerLoginIntro'), { h: ttlHours })}
        </p>

        <label className="mt-6 block text-sm font-medium text-foreground">
          {t('projectNumber')}
          <Input
            inputMode="numeric"
            className="mt-1.5 h-12 text-lg"
            placeholder={t('projectNumberPlaceholder')}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            autoComplete="off"
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-foreground">
          {t('pinLabel')}
          <Input
            type="password"
            inputMode="numeric"
            className="mt-1.5 h-14 text-center text-2xl tracking-[0.35em]"
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoComplete="one-time-code"
          />
        </label>

        <Button
          type="button"
          className="mt-6 h-12 w-full text-base font-semibold"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? t('signingIn') : t('signIn')}
        </Button>

        <Button type="button" variant="ghost" className="mt-3 w-full" onClick={() => navigate('/')}>
          {t('backToHome')}
        </Button>
      </Card>
    </div>
  );
}
