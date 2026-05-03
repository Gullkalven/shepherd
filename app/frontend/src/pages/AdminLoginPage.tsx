import { useLayoutEffect, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAPIBaseURL } from '@/lib/config';
import { persistAdminSession, readAdminSession, ADMIN_SESSION_TTL_MS } from '@/lib/adminSession';
import { usePermissions } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

type LoginResponse = {
  access_token: string;
  expires_in_minutes?: number;
  detail?: string;
};

/**
 * Provisional admin PIN — separate from site worker PIN. Replace with SSO later.
 * Credentials are verified server-side; nothing secret is embedded in the client bundle.
 */
export default function AdminLoginPage() {
  const navigate = useNavigate();
  const { isAdmin, sessionIsProvisionalAdmin, loading: permLoading } = usePermissions();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [bootReady, setBootReady] = useState(false);

  useLayoutEffect(() => {
    if (readAdminSession()) {
      navigate('/admin/users', { replace: true });
      return;
    }
    setBootReady(true);
  }, [navigate]);

  useEffect(() => {
    if (!bootReady || permLoading) return;
    if (isAdmin && !sessionIsProvisionalAdmin) {
      navigate('/admin/users', { replace: true });
    }
  }, [bootReady, permLoading, isAdmin, sessionIsProvisionalAdmin, navigate]);

  const submit = async () => {
    const p = password.trim();
    if (p.length < 4) {
      toast.error('Enter the admin password (at least 4 characters).');
      return;
    }
    setBusy(true);
    try {
      const base = getAPIBaseURL().replace(/\/$/, '');
      const res = await fetch(`${base}/api/v1/admin/provisional/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: p }),
      });
      const data = (await res.json().catch(() => null)) as LoginResponse;
      if (!res.ok) {
        const msg = typeof data?.detail === 'string' ? data.detail : 'Could not sign in';
        toast.error(msg === 'Invalid admin credentials' ? 'Wrong password. Try again.' : msg);
        return;
      }
      if (!data?.access_token) {
        toast.error('Unexpected response from server');
        return;
      }
      const ttlMs =
        typeof data.expires_in_minutes === 'number' && data.expires_in_minutes > 0
          ? data.expires_in_minutes * 60 * 1000
          : ADMIN_SESSION_TTL_MS;
      const loginAt = Date.now();
      persistAdminSession({
        token: data.access_token,
        loginAt,
        expiresAt: loginAt + ttlMs,
      });
      toast.success('Admin session started');
      navigate('/admin/users', { replace: true });
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

  const ttlHours = Math.round(ADMIN_SESSION_TTL_MS / 3600000);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 pb-16 pt-10 dark:bg-background">
      <Card className="w-full max-w-md border-border p-6 shadow-sm">
        <h1 className="text-xl font-black tracking-tight text-[#1E3A5F] dark:text-foreground">
          Administrator sign-in
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Provisional PIN login for operators — separate from site worker PIN. This session stays on this device for
          about {ttlHours} hours or until you log out. Replace with proper SSO when ready.
        </p>

        <label className="mt-6 block text-sm font-medium text-foreground">
          Admin password
          <Input
            type="password"
            className="mt-1.5 h-12 text-base"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </label>

        <Button
          type="button"
          className="mt-6 h-12 w-full rounded-xl bg-[#1E3A5F] font-semibold hover:bg-[#2a4f7a] dark:bg-blue-600 dark:hover:bg-blue-700"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? 'Signing in…' : 'Sign in as admin'}
        </Button>
      </Card>
    </div>
  );
}
