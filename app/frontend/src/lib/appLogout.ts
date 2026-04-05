import { getAPIBaseURL } from '@/lib/config';

const LOGOUT_GATE_KEY = 'shepherd_logout_gate';

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
  try {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('isLougOutManual');
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
  try {
    await fetch(`${base}/api/v1/auth/logout`, {
      method: 'GET',
      credentials: 'include',
    });
  } catch {
    /* offline / CORS — local state is still cleared */
  }
}
