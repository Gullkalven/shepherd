import { getAPIBaseURL } from '@/lib/config';
import { clearAdminSession } from '@/lib/adminSession';
import { clearWorkerSession } from '@/lib/workerSession';
import { clearWorkerLastRoom } from '@/lib/workerLastRoom';
import { queryClient } from '@/lib/queryClient';
import { FLASH_PROJECT_NOT_FOUND_KEY } from '@/lib/projectNotFoundFlash';
import { clearStoredSelectedProjectId } from '@/lib/selectedProjectStorage';

const LOGOUT_GATE_KEY = 'shepherd_logout_gate';

/** @see runAppLogout — same event for session invalidation and explicit logout. */
export const APP_LOGOUT_EVENT = 'shepherd-app-logout';

/** After explicit logout, block `auth.me()` from re-applying a server session until demo sign-in clears this. */
export function setClientLogoutGate(): void {
  try {
    localStorage.setItem(LOGOUT_GATE_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function clearClientLogoutGate(): void {
  try {
    localStorage.removeItem(LOGOUT_GATE_KEY);
  } catch {
    /* ignore */
  }
}

export function isClientLogoutGateActive(): boolean {
  try {
    return localStorage.getItem(LOGOUT_GATE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Bumped on logout so in-flight `auth.me()` handlers ignore stale responses. */
let authMeEpoch = 0;
export function bumpAuthMeEpoch(): void {
  authMeEpoch += 1;
}
export function getAuthMeEpoch(): number {
  return authMeEpoch;
}

/**
 * Clears client-side auth markers used by the app and the Metagptx web SDK.
 * Does not touch the network.
 */
export function clearLocalAuthMarks(): void {
  clearWorkerLastRoom();
  clearWorkerSession();
  clearAdminSession();
  try {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('isLougOutManual');
    sessionStorage.removeItem(FLASH_PROJECT_NOT_FOUND_KEY);
    clearStoredSelectedProjectId();
  } catch {
    /* ignore */
  }
}

/**
 * Call when /auth/me or /admin/roles/me returns 401: drop tokens and sync shell (no logout gate;
 * user can sign in again immediately).
 */
export function invalidateClientSession(): void {
  clearLocalAuthMarks();
  bumpAuthMeEpoch();
  try {
    queryClient.clear();
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(APP_LOGOUT_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * Notifies the backend of logout without using `client.auth.logout()`, which
 * forces `window.location.href = '/'` and bypasses React Router.
 */
export async function logoutRemoteSession(): Promise<void> {
  const base = getAPIBaseURL().replace(/\/$/, '');
  const url = `${base}/api/v1/auth/logout`;
  const init = {
    credentials: 'include' as RequestCredentials,
    headers: { Accept: 'application/json' },
  };
  try {
    let res = await fetch(url, { method: 'POST', ...init });
    if (res.ok) return;
    if (res.status === 405 || res.status === 404) {
      res = await fetch(url, { method: 'GET', ...init });
      if (res.ok) return;
    }
    res = await fetch(url, { method: 'GET', ...init });
  } catch {
    try {
      await fetch(url, { method: 'GET', credentials: 'include' });
    } catch {
      /* offline — local state is still cleared */
    }
  }
}
