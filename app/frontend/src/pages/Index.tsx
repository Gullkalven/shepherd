import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import { client } from '@/lib/api';
import { useProjectList } from '@/contexts/ProjectListContext';
import { usePermissions } from '@/lib/permissions';
import type { AppShellOutletContext } from '@/layouts/AppShellLayout';
import { APP_LOGOUT_EVENT, PROJECTS_NAV_REFRESH_EVENT } from '@/lib/runAppLogout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogForm } from '@/components/ui/dialog';
import { Plus, FolderOpen, Trash2, Crown, Wrench, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { APP_NAME_PARTS } from '@/lib/branding';
import {
  DEV_ROLE_CHANGED_EVENT,
  ensureDemoBearerToken,
  getLocalDevUser,
  isDevRoleSwitcherHost,
  persistDemoSignIn,
  type DevAppRole,
} from '@/lib/devRole';
import { useDevPresentationSession } from '@/lib/devPresentationSession';
import WorkerTodayView from '@/components/WorkerTodayView';
import { ShepherdLogo } from '@/components/ShepherdLogo';
import { clearClientLogoutGate, getAuthMeEpoch } from '@/lib/appLogout';
import { hasStoredAuthCredential, syncBearerTokenFromSessions } from '@/lib/authCredentials';
import { consumeProjectNotFoundFlash } from '@/lib/projectNotFoundFlash';
import { useDesktopAutoFocus } from '@/lib/useDesktopAutoFocus';
import { readWorkerSession } from '@/lib/workerSession';
import { readAdminSession } from '@/lib/adminSession';
import { persistStoredSelectedProjectId } from '@/lib/selectedProjectStorage';
import { useI18n } from '@/lib/i18n';

interface Project {
  id: number;
  name: string;
  description?: string;
  created_at?: string;
}

const ROLE_BADGE: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  admin: { label: 'Admin', icon: <Crown className="h-3 w-3" />, color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/40' },
  worker: { label: 'Worker', icon: <Wrench className="h-3 w-3" />, color: 'text-slate-700 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800' },
};

const DEMO_ROLE_SIGN_IN: { role: DevAppRole; label: string }[] = [
  { role: 'admin', label: 'Admin' },
  { role: 'worker', label: 'Worker' },
];

function IndexContent({
  onLogoutClearServer,
  onDemoSignedIn,
}: {
  onLogoutClearServer: () => void;
  onDemoSignedIn: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { activateSession, endSession, sessionActive } = useDevPresentationSession();
  const {
    role,
    canCreateProject,
    canDeleteProject,
    canEdit,
    isWorker,
    loading: permLoading,
    sessionIsPinWorker,
    sessionIsProvisionalAdmin,
  } = usePermissions();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const {
    projects,
    loading: projectsLoading,
    failed: projectsLoadFailed,
    refetch: refetchProjects,
    ready: projectsReady,
  } = useProjectList();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Inline edit state
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editProjectName, setEditProjectName] = useState('');
  const desktopAutoFocus = useDesktopAutoFocus();

  const checkAuth = useCallback(async () => {
    ensureDemoBearerToken();
    const devHost = isDevRoleSwitcherHost();
    if (devHost) {
      const stored = getLocalDevUser();
      const pinOrAdmin =
        !!(readWorkerSession()?.token || readAdminSession()?.token);
      if (pinOrAdmin) {
        setLoading(true);
        const startEpoch = getAuthMeEpoch();
        try {
          const res = await client.auth.me();
          if (startEpoch !== getAuthMeEpoch()) return;
          const u = res?.data ?? null;
          if (u) clearClientLogoutGate();
          setUser(u);
        } catch {
          setUser(null);
        } finally {
          setLoading(false);
        }
        return;
      }
      setUser(sessionActive && stored ? stored : null);
      setLoading(false);
      return;
    }

    // Deployed hosts: only probe /auth/me when a stored bearer or PIN session exists.
    syncBearerTokenFromSessions();
    if (!hasStoredAuthCredential()) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const startEpoch = getAuthMeEpoch();
    try {
      const res = await client.auth.me();
      if (startEpoch !== getAuthMeEpoch()) return;
      const u = res?.data ?? null;
      if (u) clearClientLogoutGate();
      setUser(u);
    } catch {
      // 401: expected when session expired; shell `useAppShellAuth` also clears — no UI noise.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [sessionActive]);

  useEffect(() => {
    if (consumeProjectNotFoundFlash()) {
      toast.info(t('toastProjectNotFound'), { id: 'shepherd-project-not-found' });
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (permLoading) return;
    if (!isWorker || !sessionIsPinWorker) return;
    if (!readWorkerSession()?.token) navigate('/worker/login', { replace: true });
  }, [permLoading, isWorker, sessionIsPinWorker, navigate]);

  useEffect(() => {
    const onAppLogout = () => {
      setUser(null);
      onLogoutClearServer();
    };
    window.addEventListener(APP_LOGOUT_EVENT, onAppLogout as EventListener);
    return () => window.removeEventListener(APP_LOGOUT_EVENT, onAppLogout as EventListener);
  }, [onLogoutClearServer]);

  useEffect(() => {
    const onRoleChange = () => {
      void checkAuth();
    };
    window.addEventListener(DEV_ROLE_CHANGED_EVENT, onRoleChange);
    return () => window.removeEventListener(DEV_ROLE_CHANGED_EVENT, onRoleChange);
  }, [checkAuth]);

  const signInAsDemoRole = (role: DevAppRole) => {
    persistDemoSignIn(role);
    ensureDemoBearerToken();
    if (isDevRoleSwitcherHost()) {
      activateSession();
      setUser(getLocalDevUser());
    } else {
      onDemoSignedIn();
      void checkAuth();
      navigate('/', { replace: true });
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await client.entities.projects.create({
        data: { name: newName.trim(), description: newDesc.trim() },
      });
      toast.success('Project created');
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      void refetchProjects();
      window.dispatchEvent(new CustomEvent(PROJECTS_NAV_REFRESH_EVENT));
    } catch {
      toast.error('Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm('Delete this project and all its data?')) return;
    try {
      await client.entities.projects.delete({ id: String(id) });
      toast.success('Project deleted');
      void refetchProjects();
      window.dispatchEvent(new CustomEvent(PROJECTS_NAV_REFRESH_EVENT));
    } catch {
      toast.error('Failed to delete project');
    }
  };

  const startEditProject = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setEditingProjectId(project.id);
    setEditProjectName(project.name);
  };

  const saveProjectName = async (projectId: number) => {
    if (!editProjectName.trim()) {
      setEditingProjectId(null);
      return;
    }
    try {
      await client.entities.projects.update({
        id: String(projectId),
        data: { name: editProjectName.trim() },
      });
      toast.success('Project name updated');
      void refetchProjects();
      window.dispatchEvent(new CustomEvent(PROJECTS_NAV_REFRESH_EVENT));
    } catch {
      toast.error('Failed to update project name');
    }
    setEditingProjectId(null);
  };

  const cancelEditProject = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingProjectId(null);
    setEditProjectName('');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1E3A5F] to-[#0F2440] dark:from-slate-900 dark:to-slate-950 flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-6 max-w-sm">
          <ShepherdLogo className="mx-auto h-24 w-24 rounded-2xl shadow-lg" />
          <h1 className="text-4xl font-black tracking-[0.14em] uppercase text-white">
            {APP_NAME_PARTS.prefix}
            <span className="text-amber-300/90">{APP_NAME_PARTS.dot}</span>
            {APP_NAME_PARTS.suffix}
          </h1>
          {isDevRoleSwitcherHost() ? (
            <p className="text-white/55 text-sm">Demo sign-in — choose a role (no password)</p>
          ) : null}
          <div className="w-full space-y-2 pt-1">
            {isDevRoleSwitcherHost()
              ? DEMO_ROLE_SIGN_IN.map(({ role, label }) => (
                  <Button
                    key={role}
                    type="button"
                    onClick={() => signInAsDemoRole(role)}
                    size="lg"
                    className="w-full bg-amber-400 hover:bg-amber-500 text-[#1E3A5F] font-semibold text-base h-12 rounded-xl"
                  >
                    {label}
                  </Button>
                ))
              : null}
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full border-white/35 bg-white/10 text-white hover:bg-white/15"
              onClick={() => navigate('/worker/login')}
            >
              Site worker sign-in (PIN)
            </Button>
            {!isDevRoleSwitcherHost() ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full border-white/35 bg-white/10 text-white hover:bg-white/15"
                onClick={() => navigate('/admin/login')}
              >
                Administrator sign-in
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (permLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (isWorker) {
    return (
      <WorkerTodayView
        hasUser={!!user}
        sites={projects}
        sitesLoading={projectsLoading}
        sitesLoadFailed={projectsLoadFailed}
        onRefreshSites={() => void refetchProjects()}
      />
    );
  }

  const roleBadge = ROLE_BADGE[role] || ROLE_BADGE.worker;

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-background pb-8">
      <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-none lg:px-6 xl:px-8">
        <div className="flex flex-wrap items-center justify-start gap-2">
          <Badge className={`${roleBadge.bg} ${roleBadge.color} border-0 gap-1`}>
            {roleBadge.icon}
            {roleBadge.label}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => navigate('/worker/login')}
          >
            Site worker (PIN)
          </Button>
        </div>
        {sessionIsProvisionalAdmin ? (
          <p className="text-xs text-muted-foreground">
            Session: <strong className="text-foreground">Administrator (provisional PIN)</strong> — this is not a site
            worker sign-in.
          </p>
        ) : sessionIsPinWorker ? (
          <p className="text-xs text-muted-foreground">
            Session: <strong className="text-foreground">Site worker (PIN)</strong>
          </p>
        ) : null}

        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800 dark:text-foreground">My Projects</h2>
          {canCreateProject && (
            <Button
              onClick={() => setShowCreate(true)}
              className="bg-[#1E3A5F] hover:bg-[#2a4f7a] dark:bg-blue-600 dark:hover:bg-blue-700 h-10 rounded-xl"
            >
              <Plus className="h-4 w-4 mr-1" />
              New Project
            </Button>
          )}
        </div>

        {projects.length === 0 ? (
          <Card className="p-8 text-center space-y-4">
            <FolderOpen className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-muted-foreground">No projects yet</p>
            {canCreateProject && (
              <>
                <p className="text-sm text-muted-foreground mt-1">
                  Create your first project to add floors, rooms, and site workers.
                </p>
                <Button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="bg-[#1E3A5F] hover:bg-[#2a4f7a] dark:bg-blue-600 dark:hover:bg-blue-700 h-10 rounded-xl"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Create project
                </Button>
              </>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="p-4 shepherd-interactive-card"
                onClick={() => {
                  if (editingProjectId === project.id) return;
                  persistStoredSelectedProjectId(project.id);
                  navigate(`/project/${project.id}`);
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    {editingProjectId === project.id ? (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={editProjectName}
                          onChange={(e) => setEditProjectName(e.target.value)}
                          className="h-9 text-base sm:text-sm font-semibold"
                          {...(desktopAutoFocus ? { autoFocus: true } : {})}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveProjectName(project.id);
                            if (e.key === 'Escape') cancelEditProject();
                          }}
                          onBlur={() => saveProjectName(project.id)}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-emerald-500 hover:text-emerald-700"
                          onMouseDown={(e) => { e.preventDefault(); saveProjectName(project.id); }}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-600"
                          onMouseDown={(e) => { e.preventDefault(); cancelEditProject(); }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group/name">
                        <h3 className="font-semibold text-slate-800 dark:text-foreground truncate">{project.name}</h3>
                        {canEdit && (
                          <button
                            className="opacity-0 group-hover/name:opacity-100 transition-opacity text-slate-400 hover:text-blue-500 p-0.5"
                            onClick={(e) => startEditProject(e, project)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                    {project.description && editingProjectId !== project.id && (
                      <p className="text-sm text-muted-foreground truncate mt-0.5">
                        {project.description}
                      </p>
                    )}
                  </div>
                  {canDeleteProject && editingProjectId !== project.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 shrink-0 ml-2"
                      onClick={(e) => handleDelete(e, project.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm mx-4">
          <DialogForm onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
            <DialogHeader>
              <DialogTitle>New Project</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="Project name (e.g., Hotel Renovation)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-12"
              />
              <Input
                placeholder="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="h-12"
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={!newName.trim() || creating}
                className="w-full bg-[#1E3A5F] hover:bg-[#2a4f7a] dark:bg-blue-600 dark:hover:bg-blue-700 h-12"
              >
                {creating ? 'Creating...' : 'Create Project'}
              </Button>
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Index() {
  const ctx = useOutletContext<AppShellOutletContext>();
  return (
    <IndexContent
      onLogoutClearServer={ctx.onLogoutClearServer}
      onDemoSignedIn={ctx.onDemoSignedIn}
    />
  );
}