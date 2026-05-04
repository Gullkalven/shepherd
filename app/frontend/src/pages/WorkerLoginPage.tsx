import { useLayoutEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAPIBaseURL } from '@/lib/config';
import { clearWorkerLastRoom } from '@/lib/workerLastRoom';
import { persistWorkerSession, readWorkerSession, WORKER_SESSION_TTL_MS } from '@/lib/workerSession';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

type LoginResponse = {
  access_token: string;
  project: { id: number; name: string };
  worker: { id: number; name: string; project_id: number };
};

export default function WorkerLoginPage() {
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

  const submit = async () => {
    const pid = Number(projectId.trim());
    if (!Number.isFinite(pid) || pid < 1) {
      toast.error('Enter a valid project number.');
      return;
    }
    if (pin.trim().length < 4) {
      toast.error('PIN must be at least 4 characters.');
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
        toast.error(msg === 'Wrong PIN or inactive worker' ? 'Wrong PIN. Try again.' : msg);
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
      toast.success(`Signed in as ${data.worker.name}`);
      navigate('/worker/rooms', { replace: true });
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  };

  if (!bootReady) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 dark:bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  const ttlHours = Math.round(WORKER_SESSION_TTL_MS / 3600000);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 pb-24 pt-8 dark:bg-background">
      <Card className="w-full max-w-md border-border p-6 shadow-sm">
        <h1 className="text-xl font-black tracking-tight text-[#1E3A5F] dark:text-foreground">
          Site worker sign-in
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the project number from your supervisor and your PIN. After sign-in, this device stays signed in for
          about {ttlHours} hours — you will not need the PIN again until the session expires or you sign out.
        </p>

        <label className="mt-6 block text-sm font-medium text-foreground">
          Project number
          <Input
            inputMode="numeric"
            className="mt-1.5 h-12 text-lg"
            placeholder="From your supervisor"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            autoComplete="off"
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-foreground">
          PIN
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
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>

        <Button type="button" variant="ghost" className="mt-3 w-full" onClick={() => navigate('/')}>
          Back to home
        </Button>
      </Card>
    </div>
  );
}
