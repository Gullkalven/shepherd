import { readAdminSession } from '@/lib/adminSession';
import { readWorkerSession } from '@/lib/workerSession';

/** Copies PIN/admin JWT into `localStorage.token` when present (SDK sends Bearer from localStorage). */
export function syncBearerTokenFromSessions(): void {
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
 * True when we have credentials that justify `GET /api/v1/auth/me` (bearer in storage or PIN/admin JWT).
 * Does not write to storage.
 */
export function hasStoredAuthCredential(): boolean {
  if (readWorkerSession()?.token) return true;
  if (readAdminSession()?.token) return true;
  try {
    const t = localStorage.getItem('token');
    return Boolean(t && String(t).trim());
  } catch {
    return false;
  }
}
