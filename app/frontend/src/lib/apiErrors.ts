/** HTTP status from axios-style errors (undefined if missing). */
export function httpStatusFromError(err: unknown): number | undefined {
  const ax = err as { response?: { status?: number } };
  const n = ax.response?.status;
  return typeof n === 'number' ? n : undefined;
}

/**
 * Map axios-like errors to short UI messages. Never includes tokens or secrets.
 */
export function apiFailureMessage(err: unknown): string | undefined {
  const ax = err as {
    response?: { status?: number; data?: { detail?: unknown; message?: unknown } };
    message?: string;
  };
  const data = ax.response?.data;
  const detail = data?.detail ?? data?.message;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const s = detail.map((x) => String(x)).join(', ');
    if (s.trim()) return s;
  }
  const st = ax.response?.status;
  if (typeof st === 'number') {
    if (st === 401) return 'Sign-in required or session expired.';
    if (st === 403) return 'You do not have permission for this action.';
    if (st === 404) return 'Not found.';
    if (st >= 500) return 'Server error. Try again later.';
  }
  const msg = typeof ax.message === 'string' ? ax.message.trim() : '';
  if (msg && !msg.startsWith('HTTP ')) return msg;
  return undefined;
}

/** Logs status, method, URL, and JSON body in development only (no Authorization header). */
export function devLogApiFailure(context: string, err: unknown): void {
  if (!import.meta.env.DEV) return;
  const ax = err as {
    response?: { status?: number; data?: unknown };
    config?: { url?: string; baseURL?: string; method?: string };
    message?: string;
  };
  const cfg = ax.config;
  const url = `${cfg?.baseURL ?? ''}${cfg?.url ?? ''}`;
  console.warn(`[Shepherd API] ${context}`, {
    status: ax.response?.status,
    method: cfg?.method,
    url: url || '(unknown)',
    body: ax.response?.data,
    message: ax.message,
  });
}
