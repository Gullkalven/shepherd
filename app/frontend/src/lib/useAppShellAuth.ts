import { useState, useEffect, useCallback } from 'react';
import { client } from '@/lib/api';
import {
  ensureDemoBearerToken,
  getLocalDevUser,
  isDevRoleSwitcherHost,
  readDemoLocalStorageUser,
} from '@/lib/devRole';
import {
  readWorkerSession,
  WORKER_AUTH_EVENT,
  WORKER_SESSION_STORAGE_KEY,
  revalidateWorkerSessionOnResume,
} from '@/lib/workerSession';
import {
  readAdminSession,
  ADMIN_AUTH_EVENT,
  ADMIN_SESSION_STORAGE_KEY,
  revalidateAdminSessionOnResume,
} from '@/lib/adminSession';
import { useDevPresentationSession } from '@/lib/devPresentationSession';
import {
  bumpAuthMeEpoch,
  getAuthMeEpoch,
  isClientLogoutGateActive,
} from '@/lib/appLogout';
import { APP_LOGOUT_EVENT } from '@/lib/runAppLogout';

function applySessionBearerToken(): void {
  const ws = readWorkerSession();
  const adm = readAdminSession();
  if (ws?.token) {
    try {
      localStorage.setItem('token', ws.token);
    } catch {
      /* ignore */
    }
  } else if (adm?.token) {
    try {
      localStorage.setItem('token', adm.token);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Same sign-in gate as the former Index wrapper: drives the global shell (sidebar vs sign-in).
 * Bearer token: worker PIN session wins over provisional admin if both exist (rare).
 */
export function useAppShellAuth() {
  const { sessionActive } = useDevPresentationSession();
  const [apiUser, setApiUser] = useState<unknown>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    void (async () => {
      applySessionBearerToken();
      const ws = readWorkerSession();
      const adm = readAdminSession();

      const devHost = isDevRoleSwitcherHost();

      if (devHost && ws?.token) {
        const startEpoch = getAuthMeEpoch();
        try {
          const res = await client.auth.me();
          if (startEpoch !== getAuthMeEpoch()) return;
          setApiUser(res?.data ?? null);
        } catch {
          if (startEpoch !== getAuthMeEpoch()) return;
          setApiUser(null);
        } finally {
          setChecking(false);
        }
        return;
      }

      if (devHost && adm?.token) {
        const startEpoch = getAuthMeEpoch();
        try {
          const res = await client.auth.me();
          if (startEpoch !== getAuthMeEpoch()) return;
          setApiUser(res?.data ?? null);
        } catch {
          if (startEpoch !== getAuthMeEpoch()) return;
          setApiUser(null);
        } finally {
          setChecking(false);
        }
        return;
      }

      if (devHost) {
        ensureDemoBearerToken();
        const startEpoch = getAuthMeEpoch();
        try {
          const res = await client.auth.me();
          if (startEpoch !== getAuthMeEpoch()) return;
          if (isClientLogoutGateActive() && !readDemoLocalStorageUser()) return;
          setApiUser(res?.data ?? null);
        } catch {
          if (startEpoch !== getAuthMeEpoch()) return;
          setApiUser(null);
        } finally {
          setChecking(false);
        }
        return;
      }

      ensureDemoBearerToken();

      if (ws?.token) {
        const startEpoch = getAuthMeEpoch();
        try {
          const res = await client.auth.me();
          if (startEpoch !== getAuthMeEpoch()) return;
          setApiUser(res?.data ?? null);
        } catch {
          if (startEpoch !== getAuthMeEpoch()) return;
          setApiUser(null);
        } finally {
          setChecking(false);
        }
        return;
      }

      if (adm?.token) {
        const startEpoch = getAuthMeEpoch();
        try {
          const res = await client.auth.me();
          if (startEpoch !== getAuthMeEpoch()) return;
          setApiUser(res?.data ?? null);
        } catch {
          if (startEpoch !== getAuthMeEpoch()) return;
          setApiUser(null);
        } finally {
          setChecking(false);
        }
        return;
      }

      const demo = readDemoLocalStorageUser();
      setApiUser(demo);
      setChecking(false);
      const startEpoch = getAuthMeEpoch();
      if (isClientLogoutGateActive() && !demo) {
        return;
      }
      void client.auth
        .me()
        .then((res) => {
          if (startEpoch !== getAuthMeEpoch()) return;
          if (isClientLogoutGateActive() && !readDemoLocalStorageUser()) return;
          if (res?.data) setApiUser(res.data);
        })
        .catch(() => {});
    })();
  }, []);

  useEffect(() => {
    const onAppLogout = () => setApiUser(null);
    window.addEventListener(APP_LOGOUT_EVENT, onAppLogout as EventListener);
    return () => window.removeEventListener(APP_LOGOUT_EVENT, onAppLogout as EventListener);
  }, []);

  const refreshFromSessionTokens = useCallback(() => {
    applySessionBearerToken();
    const ws = readWorkerSession();
    const adm = readAdminSession();
    if (!ws?.token && !adm?.token) {
      setApiUser(null);
      setChecking(false);
      return;
    }
    const startEpoch = getAuthMeEpoch();
    setChecking(true);
    void client.auth
      .me()
      .then((res) => {
        if (startEpoch !== getAuthMeEpoch()) return;
        setApiUser(res?.data ?? null);
      })
      .catch(() => {
        if (startEpoch !== getAuthMeEpoch()) return;
        setApiUser(null);
      })
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    window.addEventListener(WORKER_AUTH_EVENT, refreshFromSessionTokens);
    window.addEventListener(ADMIN_AUTH_EVENT, refreshFromSessionTokens);
    return () => {
      window.removeEventListener(WORKER_AUTH_EVENT, refreshFromSessionTokens);
      window.removeEventListener(ADMIN_AUTH_EVENT, refreshFromSessionTokens);
    };
  }, [refreshFromSessionTokens]);

  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState !== 'visible') return;
      const hadW = (() => {
        try {
          return localStorage.getItem(WORKER_SESSION_STORAGE_KEY);
        } catch {
          return null;
        }
      })();
      revalidateWorkerSessionOnResume();
      const stillW = (() => {
        try {
          return localStorage.getItem(WORKER_SESSION_STORAGE_KEY);
        } catch {
          return null;
        }
      })();

      const hadA = (() => {
        try {
          return localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
        } catch {
          return null;
        }
      })();
      revalidateAdminSessionOnResume();
      const stillA = (() => {
        try {
          return localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
        } catch {
          return null;
        }
      })();

      if ((hadW && !stillW) || (hadA && !stillA)) {
        applySessionBearerToken();
        if (!readWorkerSession()?.token && !readAdminSession()?.token) {
          setApiUser(null);
        }
        bumpAuthMeEpoch();
        refreshFromSessionTokens();
      }
    };
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);
    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
    };
  }, [refreshFromSessionTokens]);

  const devHost = isDevRoleSwitcherHost();
  const ws = readWorkerSession();
  const adm = readAdminSession();
  const devSignedIn = sessionActive && !!getLocalDevUser();
  const pinWorker = !!(ws?.token && apiUser);
  const provAdmin = !!(adm?.token && apiUser);

  const isAuth = !!apiUser && (!devHost || pinWorker || provAdmin || devSignedIn);

  return { isAuth, checking, apiUser, setApiUser, devHost, sessionActive };
}
