/** Mirrors `AppRole` in permissions — kept local to avoid import cycles. */
export type DevAppRole = 'admin' | 'manager' | 'electrician' | 'apprentice';

export const DEV_ROLE_CHANGED_EVENT = 'shepherd-dev-role-changed';

/** Demo / test users: stable ids in `localStorage.user` for deployed and local demos. */
export const DEMO_USER_PRESETS: Record<DevAppRole, { id: string; name: string }> = {
  admin: { id: 'local-admin', name: 'Demo Admin' },
  manager: { id: 'local-manager', name: 'Demo BAS / Prosjektleder' },
  electrician: { id: 'local-electrician', name: 'Demo Montør' },
  apprentice: { id: 'local-apprentice', name: 'Demo Lærling' },
};

const DEMO_USER_IDS = new Set(
  Object.values(DEMO_USER_PRESETS).map((p) => p.id)
);

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
    const u = JSON.parse(raw) as { id?: string };
    if (!u?.id || !DEMO_USER_IDS.has(String(u.id))) return null;
    return u as Record<string, unknown>;
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

/**
 * Use GET .../entities/projects/all for listing on real hosts during the demo flow.
 * We match either stored demo `user` or the synthetic demo bearer (create/update still need that token);
 * otherwise a protected list request can still hit GET .../projects without a usable session and return 401.
 */
export function shouldLoadProjectListViaAllEndpoint(): boolean {
  if (typeof window === 'undefined') return false;
  if (isDevRoleSwitcherHost()) return false;
  if (readDemoLocalStorageUser() !== null) return true;
  try {
    return localStorage.getItem('token') === DEMO_BEARER_TOKEN;
  } catch {
    return false;
  }
}

export const DEV_ROLE_OPTIONS: { value: DevAppRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager (BAS / Prosjektleder)' },
  { value: 'electrician', label: 'Electrician (Montør)' },
  { value: 'apprentice', label: 'Apprentice (Lærling)' },
];

export function readDevRoleFromStorage(): DevAppRole {
  if (!isDevRoleSwitcherHost()) return 'electrician';
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return 'electrician';
    const u = JSON.parse(raw) as { role?: string };
    const r = u?.role;
    if (r === 'worker' || r === 'electrician') return 'electrician';
    if (r === 'admin' || r === 'manager' || r === 'apprentice') return r;
    return 'electrician';
  } catch {
    return 'electrician';
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
