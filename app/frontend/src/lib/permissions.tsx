import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { client } from '@/lib/api';
import { DEV_ROLE_CHANGED_EVENT, readDemoLocalStorageUser } from '@/lib/devRole';

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
}

const PermissionContext = createContext<PermissionContextType>({
  role: 'worker',
  displayName: null,
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
});

export function PermissionProvider({ children, isAuthenticated }: { children: ReactNode; isAuthenticated: boolean }) {
  const [role, setRole] = useState<AppRole>('worker');
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sectionVisibility, setSectionVisibility] = useState<SectionVisibility>(DEFAULT_VISIBILITY);

  const fetchRole = useCallback(async () => {
    const host = window.location.hostname;
    const isDevMode = host === 'localhost' || host === '127.0.0.1';
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
      setRole(normalizeAppRole(localRole));
      setDisplayName(localUser?.name || null);
      setLoading(false);
      return;
    }

    const demoLocal = readDemoLocalStorageUser();
    const demoRole = demoLocal?.role as string | undefined;
    if (
      !isDevMode &&
      isAuthenticated &&
      demoLocal &&
      (demoRole === 'admin' ||
        demoRole === 'manager' ||
        demoRole === 'electrician' ||
        demoRole === 'apprentice' ||
        demoRole === 'worker')
    ) {
      setRole(normalizeAppRole(demoRole));
      setDisplayName((demoLocal.name as string) || null);
      setLoading(false);
      return;
    }

    if (!isAuthenticated) {
      setRole('worker');
      setDisplayName(null);
      setLoading(false);
      return;
    }
    try {
      const res = await client.apiCall.invoke({
        url: '/api/v1/admin/roles/me',
        method: 'GET',
        data: {},
      });
      const data = res?.data;
      if (data?.app_role) {
        setRole(normalizeAppRole(data.app_role));
        setDisplayName(data.display_name || null);
      } else {
        setRole('worker');
      }
    } catch {
      setRole('worker');
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
    window.addEventListener(DEV_ROLE_CHANGED_EVENT, onDevRoleChange);
    return () => window.removeEventListener(DEV_ROLE_CHANGED_EVENT, onDevRoleChange);
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
