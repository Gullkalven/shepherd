import { useLayoutEffect, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAPIBaseURL } from '@/lib/config';
import { clearWorkerLastRoom } from '@/lib/workerLastRoom';
import { persistAdminSession, readAdminSession, ADMIN_SESSION_TTL_MS } from '@/lib/adminSession';
import { usePermissions } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { ChevronLeft } from 'lucide-react';
import { ShepherdLogo } from '@/components/ShepherdLogo';
import { PROJECTS_NAV_REFRESH_EVENT } from '@/lib/runAppLogout';
import { formatNb, useI18n } from '@/lib/i18n';

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
  const { t } = useI18n();
  const navigate = useNavigate();
  const { isAdmin, sessionIsProvisionalAdmin, loading: permLoading } = usePermissions();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [bootReady, setBootReady] = useState(false);

  useLayoutEffect(() => {
    if (readAdminSession()) {
      navigate('/', { replace: true });
      return;
    }
    setBootReady(true);
  }, [navigate]);

  useEffect(() => {
    if (!bootReady || permLoading) return;
    if (isAdmin && !sessionIsProvisionalAdmin) {
      navigate('/', { replace: true });
    }
  }, [bootReady, permLoading, isAdmin, sessionIsProvisionalAdmin, navigate]);

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

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/');
  };

  const submit = async () => {
    const p = password.trim();
    if (p.length < 4) {
      toast.error(t('toastAdminPasswordTooShort'));
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
        toast.error(t('toastAuthFailedGeneric'));
        return;
      }
      if (!data?.access_token) {
        toast.error(t('toastUnexpectedResponse'));
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
      // Drop any worker “last room” from a prior session so post-login nav never follows a stale `/project/1/...` path.
      clearWorkerLastRoom();
      toast.success(t('toastAdminSignedIn'));
      window.dispatchEvent(new CustomEvent(PROJECTS_NAV_REFRESH_EVENT));
      navigate('/', { replace: true });
    } catch {
      toast.error(t('toastNetworkError'));
    } finally {
      setBusy(false);
    }
  };

  if (!bootReady) {
    return (
      <div className="flex h-dvh min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#0b1623] px-4 pt-[env(safe-area-inset-top)] text-slate-100">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F]/50 border-t-sky-400" />
      </div>
    );
  }

  const ttlHours = Math.round(ADMIN_SESSION_TTL_MS / 3600000);

  return (
    <div className="fixed inset-0 flex h-dvh min-h-[100dvh] w-full flex-col items-center justify-center overflow-hidden bg-[#0b1623] px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-slate-100">
      <Button
        type="button"
        variant="ghost"
        className="absolute left-4 top-[max(0.5rem,env(safe-area-inset-top))] z-10 h-10 gap-1 text-slate-200/90 hover:text-white"
        onClick={handleBack}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t('back')}
      </Button>
      <div className="mb-5 flex justify-center">
        <ShepherdLogo className="h-16 w-16 rounded-xl shadow-md" />
      </div>
      <Card className="max-h-full w-full max-w-md overflow-hidden border border-white/10 bg-slate-900/90 p-5 text-slate-100 shadow-xl backdrop-blur-sm sm:p-6">
        <h1 className="text-xl font-black tracking-tight text-white">{t('adminLoginTitle')}</h1>
        <p className="mt-2 text-sm leading-snug text-slate-400">
          {formatNb(t('adminLoginIntro'), { h: ttlHours })}
        </p>

        <label className="mt-6 block text-sm font-medium text-slate-200">
          {t('adminPasswordLabel')}
          <Input
            type="password"
            className="mt-1.5 h-12 border-white/15 bg-slate-800/70 text-base text-slate-100 placeholder:text-slate-500"
            placeholder={t('adminPasswordPlaceholder')}
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
          className="mt-6 h-12 w-full rounded-xl bg-[#1E3A5F] font-semibold text-white hover:bg-[#2a4f7a]"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? t('signingIn') : t('signIn')}
        </Button>
      </Card>
    </div>
  );
}
