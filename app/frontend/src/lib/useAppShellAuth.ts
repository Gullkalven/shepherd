import { useState, useEffect } from 'react';
import { client } from '@/lib/api';
import {
  ensureDemoBearerToken,
  getLocalDevUser,
  isDevRoleSwitcherHost,
  readDemoLocalStorageUser,
} from '@/lib/devRole';
import { useDevPresentationSession } from '@/lib/devPresentationSession';
import { APP_LOGOUT_EVENT } from '@/lib/runAppLogout';

/**
 * Same sign-in gate as the former Index wrapper: drives the global shell (sidebar vs sign-in).
 */
export function useAppShellAuth() {
  const { sessionActive } = useDevPresentationSession();
  const [apiUser, setApiUser] = useState<unknown>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (isDevRoleSwitcherHost()) {
      void (async () => {
        ensureDemoBearerToken();
        try {
          const res = await client.auth.me();
          setApiUser(res?.data ?? null);
        } catch {
          setApiUser(null);
        } finally {
          setChecking(false);
        }
      })();
      return;
    }

    ensureDemoBearerToken();
    setApiUser(readDemoLocalStorageUser());
    setChecking(false);
    void client.auth
      .me()
      .then((res) => {
        if (res?.data) setApiUser(res.data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onAppLogout = () => setApiUser(null);
    window.addEventListener(APP_LOGOUT_EVENT, onAppLogout as EventListener);
    return () => window.removeEventListener(APP_LOGOUT_EVENT, onAppLogout as EventListener);
  }, []);

  const devSignedIn = sessionActive && !!getLocalDevUser();
  const devHost = isDevRoleSwitcherHost();
  const isAuth = devHost ? devSignedIn : !!apiUser;

  return { isAuth, checking, apiUser, setApiUser, devHost, sessionActive };
}
