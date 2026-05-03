/**
 * Dev-only diagnostics (never log tokens or secrets).
 */
export function shepherdDebug(tag: string, payload: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  console.debug(`[Shepherd] ${tag}`, payload);
}

/** Whether localStorage has a bearer token (boolean only). */
export function hasBearerTokenHint(): boolean {
  try {
    return Boolean(globalThis.localStorage?.getItem('token'));
  } catch {
    return false;
  }
}
