/**
 * Provisional site-worker (PIN) session — localStorage only, replaceable by real auth later.
 *
 * Stores a bearer token for API calls plus metadata. Session length is enforced client-side
 * (expiresAt); the backend JWT may have its own lifetime.
 */

export const WORKER_SESSION_STORAGE_KEY = 'shepherd_worker_session_v1';
export const WORKER_AUTH_EVENT = 'shepherd-worker-auth-changed';

/** Default session length (18h, between 12–24h). */
export const WORKER_SESSION_TTL_MS = 18 * 60 * 60 * 1000;

export type WorkerSessionPayload = {
  /** Bearer JWT for API requests — required until replaced by proper auth. */
  token: string;
  projectId: number;
  /** Display only — not used for authorization. */
  projectName: string;
  workerId: number;
  name: string;
  loginAt: number;
  expiresAt: number;
};

export type WorkerSessionPersistInput = Omit<WorkerSessionPayload, 'loginAt' | 'expiresAt'> & {
  loginAt?: number;
  expiresAt?: number;
};

function removeTokenIfMatches(sessionToken: string | undefined): void {
  if (!sessionToken) return;
  try {
    const cur = localStorage.getItem('token');
    if (cur === sessionToken) {
      localStorage.removeItem('token');
    }
  } catch {
    /* ignore */
  }
}

function stripWorkerStorageAndNotify(sessionToken?: string): void {
  try {
    localStorage.removeItem(WORKER_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  removeTokenIfMatches(sessionToken);
  try {
    window.dispatchEvent(new Event(WORKER_AUTH_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * Returns null if missing, malformed, or expired. Clears storage and matching token when expired.
 */
export function readWorkerSession(): WorkerSessionPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(WORKER_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<WorkerSessionPayload> & Record<string, unknown>;
    const token = typeof o.token === 'string' ? o.token : '';
    if (!token || typeof o.projectId !== 'number' || typeof o.name !== 'string' || !o.name.trim()) {
      stripWorkerStorageAndNotify(token || undefined);
      return null;
    }

    const now = Date.now();
    let loginAt = typeof o.loginAt === 'number' ? o.loginAt : NaN;
    let expiresAt = typeof o.expiresAt === 'number' ? o.expiresAt : NaN;

    // Migrate older payloads without TTL metadata — grant a full window from first read after upgrade.
    if (!Number.isFinite(loginAt) || !Number.isFinite(expiresAt)) {
      loginAt = now;
      expiresAt = now + WORKER_SESSION_TTL_MS;
      try {
        localStorage.setItem(
          WORKER_SESSION_STORAGE_KEY,
          JSON.stringify({
            ...o,
            token,
            projectId: o.projectId,
            projectName: typeof o.projectName === 'string' ? o.projectName : '',
            workerId: typeof o.workerId === 'number' ? o.workerId : 0,
            name: String(o.name),
            loginAt,
            expiresAt,
          })
        );
      } catch {
        stripWorkerStorageAndNotify(token);
        return null;
      }
    }

    if (now > expiresAt) {
      stripWorkerStorageAndNotify(token);
      return null;
    }

    return {
      token,
      projectId: o.projectId,
      projectName: typeof o.projectName === 'string' ? o.projectName : '',
      workerId: typeof o.workerId === 'number' ? o.workerId : 0,
      name: String(o.name),
      loginAt,
      expiresAt,
    };
  } catch {
    return null;
  }
}

/** Persist after successful PIN login. Sets loginAt/expiresAt unless overridden (e.g. tests). */
export function persistWorkerSession(input: WorkerSessionPersistInput): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('shepherd_admin_session_v1');
  } catch {
    /* ignore — provisional admin session must not coexist with worker bearer */
  }
  const loginAt = input.loginAt ?? Date.now();
  const expiresAt = input.expiresAt ?? loginAt + WORKER_SESSION_TTL_MS;
  const payload: WorkerSessionPayload = {
    token: input.token,
    projectId: input.projectId,
    projectName: input.projectName,
    workerId: input.workerId,
    name: input.name,
    loginAt,
    expiresAt,
  };
  try {
    localStorage.setItem(WORKER_SESSION_STORAGE_KEY, JSON.stringify(payload));
    localStorage.setItem('token', payload.token);
    window.dispatchEvent(new Event(WORKER_AUTH_EVENT));
  } catch {
    /* ignore */
  }
}

/** Clears PIN worker storage and removes localStorage `token` only if it matches this session. */
export function clearWorkerSession(): void {
  if (typeof window === 'undefined') return;
  let sessionToken: string | undefined;
  try {
    const raw = localStorage.getItem(WORKER_SESSION_STORAGE_KEY);
    if (raw) {
      const o = JSON.parse(raw) as { token?: string };
      sessionToken = typeof o.token === 'string' ? o.token : undefined;
    }
  } catch {
    /* ignore */
  }
  stripWorkerStorageAndNotify(sessionToken);
}

export function hasWorkerPinSession(): boolean {
  return readWorkerSession() !== null;
}

/** Re-check TTL after visibility/focus resume (clears storage if expired). */
export function revalidateWorkerSessionOnResume(): void {
  readWorkerSession();
}
