import type { NavigateFunction } from 'react-router-dom';
import {
  bumpAuthMeEpoch,
  clearLocalAuthMarks,
  logoutRemoteSession,
  setClientLogoutGate,
} from '@/lib/appLogout';
import { DEV_ROLE_CHANGED_EVENT } from '@/lib/devRole';
import { queryClient } from '@/lib/queryClient';

export const APP_LOGOUT_EVENT = 'shepherd-app-logout';

/** Sidebar / shell: clear all client auth state, invalidate in-flight auth checks, then navigate home. */
export async function runAppLogout(navigate: NavigateFunction, endSession: () => void) {
  endSession();
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
