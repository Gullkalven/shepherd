/** Mirrors `AppRole` in permissions — kept local to avoid import cycles. */
export type DevAppRole = 'admin' | 'manager' | 'electrician' | 'apprentice';

export const DEV_ROLE_CHANGED_EVENT = 'shepherd-dev-role-changed';

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
    if (u?.id !== 'local-admin') return null;
    return u as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const DEV_ROLE_OPTIONS: { value: DevAppRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager (BAS / Prosjektleder)' },
  { value: 'electrician', label: 'Electrician (Montør)' },
  { value: 'apprentice', label: 'Apprentice (Lærling)' },
];

const DEV_DISPLAY_NAMES: Record<DevAppRole, string> = {
  admin: 'Dev Admin',
  manager: 'Dev Manager',
  electrician: 'Dev Electrician',
  apprentice: 'Dev Apprentice',
};

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
  let base: Record<string, unknown>;
  try {
    const raw = localStorage.getItem('user');
    base = raw ? (JSON.parse(raw) as Record<string, unknown>) : { id: 'dev-local', email: 'dev@localhost' };
  } catch {
    base = { id: 'dev-local', email: 'dev@localhost' };
  }
  base.role = role;
  base.name = DEV_DISPLAY_NAMES[role];
  localStorage.setItem('user', JSON.stringify(base));
  window.dispatchEvent(new Event(DEV_ROLE_CHANGED_EVENT));
}
