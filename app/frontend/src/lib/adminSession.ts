/**
 * Provisional admin PIN/password session (localStorage).
 * Separate from site worker PIN (`workerSession`). Replace with SSO later.
 *
 * JWT TTL on server is ~180 minutes; client expiry matches so stale sessions re-prompt.
 */

import { WORKER_SESSION_STORAGE_KEY } from '@/lib/workerSession';

export const ADMIN_SESSION_STORAGE_KEY = 'shepherd_admin_session_v1';
export const ADMIN_AUTH_EVENT = 'shepherd-admin-auth-changed';

/** Align with backend ADMIN_PROVISIONAL_TOKEN_MINUTES (3h, within 2–4h requirement). */
export const ADMIN_SESSION_TTL_MS = 180 * 60 * 1000;

export type AdminSessionPayload = {
  token: string;
  loginAt: number;
  expiresAt: number;
};

export type AdminSessionPersistInput = Omit<AdminSessionPayload, 'loginAt' | 'expiresAt'> & {
  loginAt?: number;
  expiresAt?: number;
};

function removeWorkerStorageIfPresent(): void {
  try {
    localStorage.removeItem(WORKER_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function removeTokenIfMatches(sessionToken: string | undefined): void {
  if (!sessionToken) return;
  try {
    const cur = localStorage.getItem('token');
    if (cur === sessionToken) localStorage.removeItem('token');
  } catch {
    /* ignore */
  }
}

function stripAdminStorageAndNotify(sessionToken?: string): void {
  try {
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  removeTokenIfMatches(sessionToken);
  try {
    window.dispatchEvent(new Event(ADMIN_AUTH_EVENT));
  } catch {
    /* ignore */
  }
}

export function readAdminSession(): AdminSessionPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<AdminSessionPayload>;
    const token = typeof o.token === 'string' ? o.token : '';
    if (!token) {
      stripAdminStorageAndNotify(undefined);
      return null;
    }
    const now = Date.now();
    let loginAt = typeof o.loginAt === 'number' ? o.loginAt : NaN;
    let expiresAt = typeof o.expiresAt === 'number' ? o.expiresAt : NaN;
    if (!Number.isFinite(loginAt) || !Number.isFinite(expiresAt)) {
      loginAt = now;
      expiresAt = now + ADMIN_SESSION_TTL_MS;
      try {
        localStorage.setItem(
          ADMIN_SESSION_STORAGE_KEY,
          JSON.stringify({ token, loginAt, expiresAt })
        );
      } catch {
        stripAdminStorageAndNotify(token);
        return null;
      }
    }
    if (now > expiresAt) {
      stripAdminStorageAndNotify(token);
      return null;
    }
    return { token, loginAt, expiresAt };
  } catch {
    return null;
  }
}

export function persistAdminSession(input: AdminSessionPersistInput): void {
  if (typeof window === 'undefined') return;
  removeWorkerStorageIfPresent();
  const loginAt = input.loginAt ?? Date.now();
  const expiresAt = input.expiresAt ?? loginAt + ADMIN_SESSION_TTL_MS;
  const payload: AdminSessionPayload = {
    token: input.token,
    loginAt,
    expiresAt,
  };
  try {
    localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(payload));
    localStorage.setItem('token', payload.token);
    window.dispatchEvent(new Event(ADMIN_AUTH_EVENT));
  } catch {
    /* ignore */
  }
}

export function clearAdminSession(): void {
  if (typeof window === 'undefined') return;
  let sessionToken: string | undefined;
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (raw) {
      const o = JSON.parse(raw) as { token?: string };
      sessionToken = typeof o.token === 'string' ? o.token : undefined;
    }
  } catch {
    /* ignore */
  }
  stripAdminStorageAndNotify(sessionToken);
}

export function revalidateAdminSessionOnResume(): void {
  readAdminSession();
}
