import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { client, fetchProjectsListAll } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import type { AppShellOutletContext } from '@/layouts/AppShellLayout';
import { APP_LOGOUT_EVENT, PROJECTS_NAV_REFRESH_EVENT } from '@/lib/runAppLogout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogForm } from '@/components/ui/dialog';
import { Plus, FolderOpen, Trash2, HardHat, Crown, Wrench, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { APP_NAME_PARTS } from '@/lib/branding';
import {
  ensureDemoBearerToken,
  getLocalDevUser,
  isDevRoleSwitcherHost,
  persistDemoSignIn,
  readDemoLocalStorageUser,
  type DevAppRole,
} from '@/lib/devRole';
import { useDevPresentationSession } from '@/lib/devPresentationSession';

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
  const navigate = useNavigate();
  const { activateSession, endSession, sessionActive } = useDevPresentationSession();
  const { role, canCreateProject, canDeleteProject, canEdit } = usePermissions();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Inline edit state
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editProjectName, setEditProjectName] = useState('');

  const checkAuth = useCallback(async () => {
    ensureDemoBearerToken();
    const devHost = isDevRoleSwitcherHost();
    if (devHost) {
      const stored = getLocalDevUser();
      setUser(sessionActive && stored ? stored : null);
      setLoading(false);
      return;
    }

    // Deployed demo: do not wait on auth.me() for UI or project list; localStorage demo (or null) first.
    setUser(readDemoLocalStorageUser());
    setLoading(false);
    void client.auth.me().then((res) => {
      if (res?.data) setUser(res.data);
    }).catch(() => {});
  }, [sessionActive]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const loadProjects = useCallback(async () => {
    const devHost = isDevRoleSwitcherHost();
    const useProjectsAll = !devHost;
    // Localhost: list only when signed in. Deployed: load from /all whenever demo session or API user exists (no auth.me gate).
    const canLoad =
      devHost ? !!user : readDemoLocalStorageUser() !== null || !!user;
    if (!canLoad) return;
    try {
      const res = useProjectsAll
        ? await fetchProjectsListAll()
        : await client.entities.projects.query({ sort: '-created_at' });
      setProjects((res?.data?.items || []) as Project[]);
    } catch (err: unknown) {
      const ax = err as {
        message?: string;
        response?: { status?: number; data?: unknown };
        config?: { baseURL?: string; url?: string; params?: unknown; method?: string };
      };
      const fullUrl = [ax.config?.baseURL, ax.config?.url].filter(Boolean).join('') || ax.config?.url;
      console.error('[Shepherd] loadProjects failed', {
        listEndpoint: useProjectsAll
          ? 'GET {API_BASE_URL}/api/v1/entities/projects/all?sort=-created_at&skip=0&limit=100'
          : 'GET /api/v1/entities/projects',
        message: ax.message,
        httpStatus: ax.response?.status,
        responseBody: ax.response?.data,
        requestMethod: ax.config?.method,
        requestUrl: fullUrl,
        requestParams: ax.config?.params,
      });
      toast.error('Failed to load projects');
    }
  }, [user]);

  useEffect(() => {
    void loadProjects();
  }, [user, loadProjects]);

  useEffect(() => {
    const onAppLogout = () => {
      setUser(null);
      setProjects([]);
      onLogoutClearServer();
    };
    window.addEventListener(APP_LOGOUT_EVENT, onAppLogout as EventListener);
    return () => window.removeEventListener(APP_LOGOUT_EVENT, onAppLogout as EventListener);
  }, [onLogoutClearServer]);

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
      loadProjects();
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
      loadProjects();
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
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, name: editProjectName.trim() } : p))
      );
      toast.success('Project name updated');
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
          <div className="w-20 h-20 bg-amber-400 rounded-2xl flex items-center justify-center mx-auto shadow-lg">
            <HardHat className="h-10 w-10 text-[#1E3A5F]" />
          </div>
          <h1 className="text-4xl font-black tracking-[0.14em] uppercase text-white">
            {APP_NAME_PARTS.prefix}
            <span className="text-amber-300/90">{APP_NAME_PARTS.dot}</span>
            {APP_NAME_PARTS.suffix}
          </h1>
          <p className="text-white/70 text-lg">
            Project and task management for teams
          </p>
          <p className="text-white/55 text-sm">
            Demo sign-in — choose a role (no password)
          </p>
          <div className="w-full space-y-2 pt-1">
            {DEMO_ROLE_SIGN_IN.map(({ role, label }) => (
              <Button
                key={role}
                type="button"
                onClick={() => signInAsDemoRole(role)}
                size="lg"
                className="w-full bg-amber-400 hover:bg-amber-500 text-[#1E3A5F] font-semibold text-base h-12 rounded-xl"
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const roleBadge = ROLE_BADGE[role] || ROLE_BADGE.worker;

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-background pb-8">
      <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-none lg:px-6 xl:px-8">
        <div className="flex items-center justify-start">
          <Badge className={`${roleBadge.bg} ${roleBadge.color} border-0 gap-1`}>
            {roleBadge.icon}
            {roleBadge.label}
          </Badge>
        </div>

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
          <Card className="p-8 text-center">
            <FolderOpen className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-muted-foreground">No projects yet</p>
            {canCreateProject && (
              <p className="text-sm text-muted-foreground mt-1">
                Create your first project to get started
              </p>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="p-4 cursor-pointer hover:shadow-md transition-shadow active:scale-[0.99]"
                onClick={() => editingProjectId !== project.id && navigate(`/project/${project.id}`)}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    {editingProjectId === project.id ? (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={editProjectName}
                          onChange={(e) => setEditProjectName(e.target.value)}
                          className="h-9 text-sm font-semibold"
                          autoFocus
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