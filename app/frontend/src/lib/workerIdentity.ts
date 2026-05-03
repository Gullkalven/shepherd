/**
 * Resolves the human label used for “Performed by”, checklist attribution,
 * activity-related UI, etc. PIN worker sessions take precedence over profile/demo names.
 *
 * The localhost/demo worker preset (`local-worker`) does not contribute an actor name unless
 * the user explicitly entered one via the checklist name dialog (legacy storage key).
 */

import { readDemoLocalStorageUser, getLocalDevUser, isDevRoleSwitcherHost } from '@/lib/devRole';
import { readWorkerSession } from '@/lib/workerSession';

/** Legacy opt-in name when the demo preset worker types their name in the checklist dialog. */
export const LEGACY_WORKER_DISPLAY_NAME_KEY = 'trello_v2_worker_name';

const DEMO_WORKER_USER_IDS = new Set(['local-worker']);

/** True when signed in as the isolated dev/demo worker account (not a PIN worker). */
export function isDemoPresetWorkerUser(): boolean {
  if (readWorkerSession()?.token) return false;
  if (isDevRoleSwitcherHost()) {
    const u = getLocalDevUser();
    if (u && DEMO_WORKER_USER_IDS.has(String(u.id ?? ''))) return true;
  }
  const d = readDemoLocalStorageUser();
  if (d && DEMO_WORKER_USER_IDS.has(String(d.id ?? ''))) return true;
  return false;
}

/**
 * Effective worker label for actions (checklist, heating cable, handoff, deviations).
 * Never returns the demo preset display name unless overridden via LEGACY key.
 */
export function resolveWorkerActorLabel(displayName: string | null | undefined): string {
  const pin = readWorkerSession();
  if (pin?.token && pin.name?.trim()) {
    return pin.name.trim();
  }

  if (isDemoPresetWorkerUser()) {
    try {
      const legacy = localStorage.getItem(LEGACY_WORKER_DISPLAY_NAME_KEY)?.trim();
      if (legacy) return legacy;
    } catch {
      /* ignore */
    }
    return '';
  }

  const fromProfile = displayName?.trim();
  if (fromProfile) return fromProfile;

  try {
    return localStorage.getItem(LEGACY_WORKER_DISPLAY_NAME_KEY)?.trim() || '';
  } catch {
    return '';
  }
}
