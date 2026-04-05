import type { NavigateFunction } from 'react-router-dom';
import { clearLocalAuthMarks, logoutRemoteSession } from '@/lib/appLogout';
import { DEV_ROLE_CHANGED_EVENT } from '@/lib/devRole';

export const APP_LOGOUT_EVENT = 'shepherd-app-logout';

/** Sidebar / shell: notify Index to clear local user+projects; then navigate home. */
export function runAppLogout(navigate: NavigateFunction, endSession: () => void) {
  endSession();
  clearLocalAuthMarks();
  window.dispatchEvent(new CustomEvent(APP_LOGOUT_EVENT));
  void logoutRemoteSession();
  window.dispatchEvent(new Event(DEV_ROLE_CHANGED_EVENT));
  navigate('/', { replace: true });
}

export const PROJECTS_NAV_REFRESH_EVENT = 'shepherd-projects-nav-refresh';
