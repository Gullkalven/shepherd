import type { NavigateFunction } from 'react-router-dom';
import {
  bumpAuthMeEpoch,
  clearLocalAuthMarks,
  logoutRemoteSession,
  setClientLogoutGate,
} from '@/lib/appLogout';
import { DEV_ROLE_CHANGED_EVENT } from '@/lib/devRole';
import { queryClient } from '@/lib/queryClient';
import { clearAdminSession } from '@/lib/adminSession';
import { clearWorkerSession } from '@/lib/workerSession';
import { clearWorkerLastRoom } from '@/lib/workerLastRoom';

export const APP_LOGOUT_EVENT = 'shepherd-app-logout';

/** Sidebar / shell: clear all client auth state, invalidate in-flight auth checks, then navigate home. */
export async function runAppLogout(navigate: NavigateFunction, endSession: () => void) {
  endSession();
  clearWorkerLastRoom();
  clearLocalAuthMarks();
  setClientLogoutGate();
  bumpAuthMeEpoch();
  queryClient.clear();
  window.dispatchEvent(new CustomEvent(APP_LOGOUT_EVENT));
  await logoutRemoteSession();
  window.dispatchEvent(new Event(DEV_ROLE_CHANGED_EVENT));
  navigate('/', { replace: true });
}

export const PROJECTS_NAV_REFRESH_EVENT = 'shepherd-projects-nav-refresh';

/**
 * Clear provisional PIN worker session and open PIN login.
 * Use for “Switch worker” and PIN “Log out” (does not set demo logout gate).
 */
export function runWorkerSwitch(navigate: NavigateFunction) {
  clearWorkerLastRoom();
  clearWorkerSession();
  clearAdminSession();
  try {
    localStorage.removeItem('token');
  } catch {
    /* ignore */
  }
  bumpAuthMeEpoch();
  queryClient.clear();
  window.dispatchEvent(new CustomEvent(APP_LOGOUT_EVENT));
  void logoutRemoteSession();
  navigate('/worker/login', { replace: true });
}

/** End provisional admin PIN session only (does not dispatch full app logout). */
export function runAdminLogout(navigate: NavigateFunction) {
  clearAdminSession();
  bumpAuthMeEpoch();
  queryClient.clear();
  navigate('/admin/login', { replace: true });
}
