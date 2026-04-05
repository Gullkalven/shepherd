/** Mirrors `AppRole` in permissions — kept local to avoid import cycles. */
export type DevAppRole = 'admin' | 'worker';

export const DEV_ROLE_CHANGED_EVENT = 'shepherd-dev-role-changed';

export const DEMO_USER_PRESETS: Record<DevAppRole, { id: string; name: string }> = {
  admin: { id: 'local-admin', name: 'Demo Admin' },
  worker: { id: 'local-worker', name: 'Demo Worker' },
};

/** Recognize older demo sign-ins so deployed demos keep working after role simplification. */
const LEGACY_DEMO_IDS = new Set([
  'local-manager',
  'local-electrician',
  'local-apprentice',
]);

const DEMO_USER_IDS = new Set([
  ...Object.values(DEMO_USER_PRESETS).map((p) => p.id),
  ...LEGACY_DEMO_IDS,
]);

/** Writes demo user + role and notifies `PermissionProvider` (same pattern as dev role switcher). */
export function persistDemoSignIn(role: DevAppRole): void {
  if (typeof window === 'undefined') return;
  const preset = DEMO_USER_PRESETS[role];
  localStorage.setItem(
    'user',
    JSON.stringify({ id: preset.id, name: preset.name, role })
  );
  window.dispatchEvent(new Event(DEV_ROLE_CHANGED_EVENT));
}

export function isDevRoleSwitcherHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

/** Parsed `localStorage.user` on dev hosts only; used after explicit dev sign-in. */
export function getLocalDevUser(): Record<string, unknown> | null {
  if (!isDevRoleSwitcherHost()) return null;
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Deployed demo sign-in: same `localStorage` `user` key as localhost, identified by `id`.
 * Used when there is no API session but the demo user was stored explicitly.
 */
export function readDemoLocalStorageUser(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const u = JSON.parse(raw) as { id?: string; role?: string };
    if (!u?.id || !DEMO_USER_IDS.has(String(u.id))) return null;
    const normalizedRole: DevAppRole =
      u.role === 'admin' || u.role === 'manager' ? 'admin' : 'worker';
    return { ...u, role: normalizedRole };
  } catch {
    return null;
  }
}

/** Must match `LOCAL_DEV_TOKEN` in `app/backend/dependencies/auth.py`. The web SDK sends Authorization only when `localStorage.token` is set. */
const DEMO_BEARER_TOKEN = '__local_dev_auth__';

/** On deployed hosts, demo sign-in stores `user` but not `token`; the API client then sends no credentials and the backend returns 401 (localhost-only auto-auth does not apply). */
export function ensureDemoBearerToken(): void {
  if (typeof window === 'undefined') return;
  if (isDevRoleSwitcherHost()) return;
  if (!readDemoLocalStorageUser()) return;
  try {
    if (!localStorage.getItem('token')) {
      localStorage.setItem('token', DEMO_BEARER_TOKEN);
    }
  } catch {
    /* ignore */
  }
}

export const DEV_ROLE_OPTIONS: { value: DevAppRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'worker', label: 'Worker' },
];

export function readDevRoleFromStorage(): DevAppRole {
  if (!isDevRoleSwitcherHost()) return 'worker';
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return 'worker';
    const u = JSON.parse(raw) as { role?: string };
    const r = u?.role;
    if (r === 'admin' || r === 'manager') return 'admin';
    if (r === 'worker' || r === 'electrician' || r === 'apprentice') return 'worker';
    return 'worker';
  } catch {
    return 'worker';
  }
}

/** Persists role + display name for dev local user and notifies PermissionProvider. */
export function applyDevRole(role: DevAppRole): void {
  const preset = DEMO_USER_PRESETS[role];
  let base: Record<string, unknown>;
  try {
    const raw = localStorage.getItem('user');
    base = raw ? (JSON.parse(raw) as Record<string, unknown>) : { email: 'dev@localhost' };
  } catch {
    base = { email: 'dev@localhost' };
  }
  base.id = preset.id;
  base.role = role;
  base.name = preset.name;
  localStorage.setItem('user', JSON.stringify(base));
  window.dispatchEvent(new Event(DEV_ROLE_CHANGED_EVENT));
}
