import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { client } from '@/lib/api';
import { DEV_ROLE_CHANGED_EVENT } from '@/lib/devRole';
import { readAdminSession, ADMIN_AUTH_EVENT } from '@/lib/adminSession';
import { readWorkerSession, WORKER_AUTH_EVENT } from '@/lib/workerSession';
import { invalidateClientSession } from '@/lib/appLogout';
import { httpStatusFromError } from '@/lib/apiErrors';

export type AppRole = 'admin' | 'worker';

/** Maps API / localStorage values (including legacy roles) to admin | worker. */
export function normalizeAppRole(raw: string | null | undefined): AppRole {
  if (!raw) return 'worker';
  const r = String(raw).toLowerCase();
  if (r === 'admin') return 'admin';
  if (r === 'manager') return 'admin';
  if (r === 'electrician' || r === 'apprentice' || r === 'worker') return 'worker';
  return 'worker';
}

export interface SectionVisibility {
  visit_log: boolean;
  checklist: boolean;
  photos: boolean;
  comments: boolean;
  status: boolean;
  assigned_worker: boolean;
}

const DEFAULT_VISIBILITY: SectionVisibility = {
  visit_log: true,
  checklist: true,
  photos: true,
  comments: true,
  status: true,
  assigned_worker: true,
};

interface PermissionContextType {
  role: AppRole;
  displayName: string | null;
  currentUserId: string | null;
  loading: boolean;
  isAdmin: boolean;
  isWorker: boolean;
  canEdit: boolean;
  canManageUsers: boolean;
  canCreateProject: boolean;
  canDeleteProject: boolean;
  canCreateFloor: boolean;
  canDeleteFloor: boolean;
  canCreateRoom: boolean;
  canDeleteRoom: boolean;
  canEditRoom: boolean;
  canAddChecklistItem: boolean;
  canDeleteChecklistItem: boolean;
  canCheckItem: boolean;
  canUploadPhoto: boolean;
  canDeletePhoto: boolean;
  canEditComment: boolean;
  canChangeStatus: boolean;
  canMovePhase: boolean;
  canDeleteVisit: boolean;
  sectionVisibility: SectionVisibility;
  refreshRole: () => Promise<void>;
  refreshVisibility: () => Promise<void>;
  /** True when the server reports a project PIN worker JWT (field worker session). */
  sessionIsPinWorker: boolean;
  /** True when the server reports the provisional admin PIN JWT. */
  sessionIsProvisionalAdmin: boolean;
}

const PermissionContext = createContext<PermissionContextType>({
  role: 'worker',
  displayName: null,
  currentUserId: null,
  loading: true,
  isAdmin: false,
  isWorker: true,
  canEdit: false,
  canManageUsers: false,
  canCreateProject: false,
  canDeleteProject: false,
  canCreateFloor: false,
  canDeleteFloor: false,
  canCreateRoom: false,
  canDeleteRoom: false,
  canEditRoom: false,
  canAddChecklistItem: false,
  canDeleteChecklistItem: false,
  canCheckItem: true,
  canUploadPhoto: true,
  canDeletePhoto: false,
  canEditComment: true,
  canChangeStatus: true,
  canMovePhase: false,
  canDeleteVisit: false,
  sectionVisibility: DEFAULT_VISIBILITY,
  refreshRole: async () => {},
  refreshVisibility: async () => {},
  sessionIsPinWorker: false,
  sessionIsProvisionalAdmin: false,
});

export function PermissionProvider({ children, isAuthenticated }: { children: ReactNode; isAuthenticated: boolean }) {
  const [role, setRole] = useState<AppRole>('worker');
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionIsPinWorker, setSessionIsPinWorker] = useState(false);
  const [sessionIsProvisionalAdmin, setSessionIsProvisionalAdmin] = useState(false);
  const [sectionVisibility, setSectionVisibility] = useState<SectionVisibility>(DEFAULT_VISIBILITY);

  const fetchRole = useCallback(async () => {
    if (!isAuthenticated) {
      setRole('worker');
      setDisplayName(null);
      setCurrentUserId(null);
      setSessionIsPinWorker(false);
      setSessionIsProvisionalAdmin(false);
      setLoading(false);
      return;
    }

    const host = window.location.hostname;
    const isDevMode = host === 'localhost' || host === '127.0.0.1';

    if ((readWorkerSession()?.token || readAdminSession()?.token) && isAuthenticated) {
      try {
        const res = await client.apiCall.invoke({
          url: '/api/v1/admin/roles/me',
          method: 'GET',
          data: {},
        });
        const data = res?.data as {
          app_role?: string;
          display_name?: string | null;
          current_user_id?: string | null;
          is_worker_session?: boolean;
          is_provisional_admin?: boolean;
        };
        setSessionIsPinWorker(!!data?.is_worker_session);
        setSessionIsProvisionalAdmin(!!data?.is_provisional_admin);
        const pinLabel = readWorkerSession()?.name?.trim() || null;
        setCurrentUserId(data?.current_user_id || null);
        if (data?.app_role) {
          setRole(normalizeAppRole(data.app_role));
          setDisplayName(data.display_name || pinLabel || null);
        } else {
          setRole('worker');
        }
      } catch (err) {
        if (isAuthenticated && httpStatusFromError(err) === 401) {
          invalidateClientSession();
        }
        setRole('worker');
        setCurrentUserId(null);
        setSessionIsPinWorker(false);
        setSessionIsProvisionalAdmin(false);
      } finally {
        setLoading(false);
      }
      return;
    }

    const localUser = (() => {
      if (!isDevMode) return null;
      try {
        const raw = localStorage.getItem('user');
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    })();
    const localRole = localUser?.role;
    if (
      isDevMode &&
      isAuthenticated &&
      (localRole === 'admin' ||
        localRole === 'manager' ||
        localRole === 'electrician' ||
        localRole === 'apprentice' ||
        localRole === 'worker')
    ) {
      setSessionIsPinWorker(false);
      setSessionIsProvisionalAdmin(false);
      setRole(normalizeAppRole(localRole));
      setDisplayName(localUser?.name || null);
      setCurrentUserId(typeof localUser?.id === 'string' ? localUser.id : null);
      setLoading(false);
      return;
    }

    try {
      const res = await client.apiCall.invoke({
        url: '/api/v1/admin/roles/me',
        method: 'GET',
        data: {},
      });
      const data = res?.data as {
        app_role?: string;
        display_name?: string | null;
        current_user_id?: string | null;
        is_worker_session?: boolean;
        is_provisional_admin?: boolean;
      };
      setSessionIsPinWorker(!!data?.is_worker_session);
      setSessionIsProvisionalAdmin(!!data?.is_provisional_admin);
      const pinLabel = readWorkerSession()?.name?.trim() || null;
      setCurrentUserId(data?.current_user_id || null);
      if (data?.app_role) {
        setRole(normalizeAppRole(data.app_role));
        setDisplayName(data.display_name || pinLabel || null);
      } else {
        setRole('worker');
      }
    } catch (err) {
      if (isAuthenticated && httpStatusFromError(err) === 401) {
        invalidateClientSession();
      }
      setRole('worker');
      setCurrentUserId(null);
      setSessionIsPinWorker(false);
      setSessionIsProvisionalAdmin(false);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  const fetchVisibility = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await client.apiCall.invoke({
        url: `/api/v1/sections/visibility/${role}`,
        method: 'GET',
        data: {},
      });
      const items = res?.data;
      if (Array.isArray(items)) {
        const vis: SectionVisibility = { ...DEFAULT_VISIBILITY };
        items.forEach((item: { section_key: string; is_visible: boolean }) => {
          if (item.section_key in vis) {
            (vis as Record<string, boolean>)[item.section_key] = item.is_visible;
          }
        });
        setSectionVisibility(vis);
      }
    } catch {
      // Keep defaults
    }
  }, [isAuthenticated, role]);

  useEffect(() => {
    fetchRole();
  }, [fetchRole]);

  useEffect(() => {
    const onDevRoleChange = () => {
      void fetchRole();
    };
    const onWorkerAuth = () => {
      void fetchRole();
    };
    window.addEventListener(DEV_ROLE_CHANGED_EVENT, onDevRoleChange);
    const onAdminAuth = () => {
      void fetchRole();
    };
    window.addEventListener(WORKER_AUTH_EVENT, onWorkerAuth);
    window.addEventListener(ADMIN_AUTH_EVENT, onAdminAuth);
    return () => {
      window.removeEventListener(DEV_ROLE_CHANGED_EVENT, onDevRoleChange);
      window.removeEventListener(WORKER_AUTH_EVENT, onWorkerAuth);
      window.removeEventListener(ADMIN_AUTH_EVENT, onAdminAuth);
    };
  }, [fetchRole]);

  useEffect(() => {
    if (!loading && isAuthenticated) {
      fetchVisibility();
    }
  }, [loading, isAuthenticated, role, fetchVisibility]);

  const isAdmin = role === 'admin';
  const isWorker = role === 'worker';
  const canEdit = isAdmin;

  const value: PermissionContextType = {
    role,
    displayName,
    currentUserId,
    loading,
    isAdmin,
    isWorker,
    canEdit,
    canManageUsers: isAdmin,
    canCreateProject: canEdit,
    canDeleteProject: isAdmin,
    canCreateFloor: canEdit,
    canDeleteFloor: canEdit,
    canCreateRoom: canEdit,
    canDeleteRoom: canEdit,
    canEditRoom: canEdit,
    canAddChecklistItem: canEdit,
    canDeleteChecklistItem: canEdit,
    canCheckItem: true,
    canUploadPhoto: isAdmin || sectionVisibility.photos,
    canDeletePhoto: canEdit,
    canEditComment: true,
    canChangeStatus: true,
    canMovePhase: isAdmin,
    canDeleteVisit: canEdit,
    sectionVisibility,
    refreshRole: fetchRole,
    refreshVisibility: fetchVisibility,
    sessionIsPinWorker,
    sessionIsProvisionalAdmin,
  };

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermissionContext);
}
