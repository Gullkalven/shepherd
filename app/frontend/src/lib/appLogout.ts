import { getAPIBaseURL } from '@/lib/config';

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
