import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { PermissionProvider, usePermissions } from '@/lib/permissions';
import Header from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogForm } from '@/components/ui/dialog';
import { Plus, FolderOpen, Trash2, LogIn, HardHat, Shield, Crown, ShieldCheck, Wrench, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { APP_NAME_PARTS } from '@/lib/branding';
import { DEV_ROLE_CHANGED_EVENT, getLocalDevUser, isDevRoleSwitcherHost } from '@/lib/devRole';
import { useDevPresentationSession } from '@/lib/devPresentationSession';
import { clearLocalAuthMarks, logoutRemoteSession } from '@/lib/appLogout';

interface Project {
  id: number;
  name: string;
  description?: string;
  created_at?: string;
}

const ROLE_BADGE: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  admin: { label: 'Admin', icon: <Crown className="h-3 w-3" />, color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/40' },
  manager: { label: 'Manager', icon: <ShieldCheck className="h-3 w-3" />, color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-100 dark:bg-blue-900/40' },
  electrician: { label: 'Electrician', icon: <Wrench className="h-3 w-3" />, color: 'text-slate-700 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800' },
  apprentice: { label: 'Apprentice', icon: <HardHat className="h-3 w-3" />, color: 'text-violet-700 dark:text-violet-300', bg: 'bg-violet-100 dark:bg-violet-900/40' },
  worker: { label: 'Electrician', icon: <Wrench className="h-3 w-3" />, color: 'text-slate-700 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800' },
};

function IndexContent({ onLogoutClearServer }: { onLogoutClearServer: () => void }) {
  const navigate = useNavigate();
  const { activateSession, endSession, sessionActive } = useDevPresentationSession();
  const { role, loading: permLoading, canCreateProject, canDeleteProject, canManageUsers, canEdit } = usePermissions();
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
    const devHost = isDevRoleSwitcherHost();
    if (devHost) {
      const stored = getLocalDevUser();
      setUser(sessionActive && stored ? stored : null);
      setLoading(false);
      return;
    }

    try {
      const res = await client.auth.me();
      if (res?.data) {
        setUser(res.data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [sessionActive]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const loadProjects = useCallback(async () => {
    if (!user) return;
    try {
      const res = await client.entities.projects.query({ sort: '-created_at' });
      setProjects(res?.data?.items || []);
    } catch {
      toast.error('Failed to load projects');
    }
  }, [user]);

  useEffect(() => {
    if (user) loadProjects();
  }, [user, loadProjects]);

  const handleLogin = async () => {
    const host = window.location.hostname;
    const isDevMode = host === 'localhost' || host === '127.0.0.1';
    if (!isDevMode) {
      await client.auth.toLogin();
      return;
    }

    localStorage.setItem(
      'user',
      JSON.stringify({
        id: 'local-admin',
        name: 'Local Admin',
        role: 'admin',
      })
    );
    activateSession();
    setUser(getLocalDevUser());
  };

  const handleLogout = async () => {
    endSession();
    clearLocalAuthMarks();
    onLogoutClearServer();
    setUser(null);
    setProjects([]);

    void logoutRemoteSession();

    window.dispatchEvent(new Event(DEV_ROLE_CHANGED_EVENT));
    navigate('/', { replace: true });
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
          <Button
            onClick={handleLogin}
            size="lg"
            className="w-full bg-amber-400 hover:bg-amber-500 text-[#1E3A5F] font-bold text-lg h-14 rounded-xl"
          >
            <LogIn className="mr-2 h-5 w-5" />
            Sign In to Get Started
          </Button>
        </div>
      </div>
    );
  }

  const roleBadge = ROLE_BADGE[role] || ROLE_BADGE.worker;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-background">
      <Header onLogout={handleLogout} />
      <div className="p-4 max-w-lg mx-auto space-y-4">
        {/* Role indicator + Admin link */}
        <div className="flex items-center justify-between">
          <Badge className={`${roleBadge.bg} ${roleBadge.color} border-0 gap-1`}>
            {roleBadge.icon}
            {roleBadge.label}
          </Badge>
          {canManageUsers && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950"
              onClick={() => navigate('/admin/users')}
            >
              <Shield className="h-3 w-3" />
              Manage Users
            </Button>
          )}
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
  const { sessionActive } = useDevPresentationSession();
  const [apiUser, setApiUser] = useState<unknown>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await client.auth.me();
        setApiUser(res?.data ?? null);
      } catch {
        setApiUser(null);
      } finally {
        setChecking(false);
      }
    };
    check();
  }, []);

  const devSignedIn = sessionActive && !!getLocalDevUser();
  const devHost = isDevRoleSwitcherHost();
  // On localhost, demo sign-in is the only gate — ignore /auth/me cookies so logout matches permissions.
  const isAuth = devHost ? devSignedIn : !!apiUser;

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <PermissionProvider isAuthenticated={isAuth}>
      <IndexContent onLogoutClearServer={() => setApiUser(null)} />
    </PermissionProvider>
  );
}