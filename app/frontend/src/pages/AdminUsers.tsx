import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import { runAdminLogout } from '@/lib/runAppLogout';
import { readAdminSession, ADMIN_SESSION_TTL_MS } from '@/lib/adminSession';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogForm, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Crown, HardHat, House, LayoutDashboard, Layers, Pencil, Plus, Shield, UserCheck, UserCog, UserX } from 'lucide-react';
import { toast } from 'sonner';

type AdminTab = 'project' | 'workers' | 'features' | 'admins';

interface ProjectSummary {
  id: number;
  name: string;
}

interface ProjectOverview {
  project_id: number;
  project_name: string;
  floors: number;
  rooms: number;
  active_workers: number;
  enabled_features: string[];
}

interface FeatureToggle {
  key: string;
  enabled: boolean;
}

interface SiteWorkerCard {
  id: number;
  name: string;
  active: boolean;
  assigned_floor?: string | null;
  assigned_room?: string | null;
  assigned_phase?: string | null;
  last_active_at?: string | null;
}

interface SystemAdmin {
  user_id: string;
  email: string;
  name: string | null;
  display_name?: string | null;
}

const FEATURE_LABELS: Record<string, string> = {
  checklists: 'Checklists',
  heating_cable: 'Heating Cable',
  photos: 'Photos',
  comments: 'Comments',
  visit_log: 'Visit Log',
};

export default function AdminUsers() {
  const navigate = useNavigate();
  const { isAdmin, loading: permLoading, sessionIsProvisionalAdmin } = usePermissions();

  const [tab, setTab] = useState<AdminTab>('project');
  const [loading, setLoading] = useState(true);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [features, setFeatures] = useState<FeatureToggle[]>([]);
  const [siteWorkers, setSiteWorkers] = useState<SiteWorkerCard[]>([]);
  const [systemAdmins, setSystemAdmins] = useState<SystemAdmin[]>([]);

  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [adminEmailToAdd, setAdminEmailToAdd] = useState('');
  const [addingAdmin, setAddingAdmin] = useState(false);

  const [workerDialogOpen, setWorkerDialogOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState<SiteWorkerCard | null>(null);
  const [editWorkerName, setEditWorkerName] = useState('');
  const [editWorkerPin, setEditWorkerPin] = useState('');

  const loadProjects = useCallback(async () => {
    const res = await client.entities.projects.query({ sort: 'name', limit: 200 });
    const items = (res?.data?.items ?? []) as ProjectSummary[];
    setProjects(items);
    if (items.length === 0) {
      setSelectedProjectId(null);
      return;
    }
    setSelectedProjectId((prev) => prev ?? items[0].id);
  }, []);

  const loadSystemAdmins = useCallback(async () => {
    const res = await client.apiCall.invoke({ url: '/api/v1/admin/roles/system-admins', method: 'GET', data: {} });
    setSystemAdmins(Array.isArray(res?.data) ? (res.data as SystemAdmin[]) : []);
  }, []);

  const loadProjectScoped = useCallback(async () => {
    if (!selectedProjectId) {
      setOverview(null);
      setFeatures([]);
      setSiteWorkers([]);
      return;
    }
    const [overviewRes, featuresRes, workersRes] = await Promise.all([
      client.apiCall.invoke({ url: `/api/v1/admin/panel/projects/${selectedProjectId}/overview`, method: 'GET', data: {} }),
      client.apiCall.invoke({ url: `/api/v1/admin/panel/projects/${selectedProjectId}/features`, method: 'GET', data: {} }),
      client.apiCall.invoke({ url: `/api/v1/admin/panel/projects/${selectedProjectId}/site-workers`, method: 'GET', data: {} }),
    ]);
    setOverview((overviewRes?.data ?? null) as ProjectOverview | null);
    setFeatures(Array.isArray(featuresRes?.data) ? (featuresRes.data as FeatureToggle[]) : []);
    setSiteWorkers(Array.isArray(workersRes?.data) ? (workersRes.data as SiteWorkerCard[]) : []);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!permLoading && isAdmin) {
      Promise.all([loadProjects(), loadSystemAdmins()])
        .catch(() => toast.error('Failed to load admin settings'))
        .finally(() => setLoading(false));
    } else if (!permLoading) {
      setLoading(false);
    }
  }, [permLoading, isAdmin, loadProjects, loadSystemAdmins]);

  useEffect(() => {
    if (!isAdmin || !selectedProjectId) return;
    void loadProjectScoped().catch(() => toast.error('Failed to load project data'));
  }, [isAdmin, selectedProjectId, loadProjectScoped]);

  if (permLoading || loading) {
    return <div className="min-h-dvh flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] border-t-transparent rounded-full" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-dvh p-4">
        <Card className="max-w-lg mx-auto p-8 text-center">
          <Shield className="h-10 w-10 mx-auto mb-3 text-red-500" />
          <h2 className="text-lg font-bold mb-1">Access Denied</h2>
          <p className="text-sm text-muted-foreground">Only system admins can open admin settings.</p>
          <Button className="mt-4" variant="outline" onClick={() => navigate('/admin/login')}>Admin sign-in</Button>
        </Card>
      </div>
    );
  }

  const adminPinSession = sessionIsProvisionalAdmin ? readAdminSession() : null;
  const adminSessionEndsLabel = adminPinSession?.expiresAt != null
    ? new Date(adminPinSession.expiresAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : null;

  const addSystemAdmin = async () => {
    if (!adminEmailToAdd.trim()) {
      toast.error('Enter an email address');
      return;
    }
    setAddingAdmin(true);
    try {
      await client.apiCall.invoke({ url: '/api/v1/admin/roles/system-admins', method: 'POST', data: { email: adminEmailToAdd.trim() } });
      setAdminDialogOpen(false);
      setAdminEmailToAdd('');
      toast.success('System admin added');
      await loadSystemAdmins();
    } catch (e: unknown) {
      const err = e as { data?: { detail?: string }; response?: { data?: { detail?: string } }; message?: string };
      toast.error(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Could not add admin');
    } finally {
      setAddingAdmin(false);
    }
  };

  const removeSystemAdmin = async (userId: string) => {
    try {
      await client.apiCall.invoke({ url: `/api/v1/admin/roles/system-admins/${userId}`, method: 'DELETE', data: {} });
      toast.success('System admin removed');
      await loadSystemAdmins();
    } catch (e: unknown) {
      const err = e as { data?: { detail?: string }; response?: { data?: { detail?: string } }; message?: string };
      toast.error(err?.data?.detail || err?.response?.data?.detail || err?.message || 'Could not remove admin');
    }
  };

  const toggleFeature = async (feature: FeatureToggle) => {
    if (!selectedProjectId) return;
    const next = !feature.enabled;
    setFeatures((prev) => prev.map((f) => (f.key === feature.key ? { ...f, enabled: next } : f)));
    try {
      await client.apiCall.invoke({
        url: `/api/v1/admin/panel/projects/${selectedProjectId}/features/${feature.key}`,
        method: 'PUT',
        data: { key: feature.key, enabled: next },
      });
    } catch {
      toast.error('Failed to update feature');
      void loadProjectScoped();
    }
  };

  const openEditWorker = (worker: SiteWorkerCard) => {
    setEditingWorker(worker);
    setEditWorkerName(worker.name);
    setEditWorkerPin('');
    setWorkerDialogOpen(true);
  };

  const saveWorkerEdit = async () => {
    if (!selectedProjectId || !editingWorker) return;
    const payload: { name: string; pin?: string } = { name: editWorkerName.trim() };
    if (!payload.name) {
      toast.error('Worker name is required');
      return;
    }
    if (editWorkerPin.trim().length >= 4) payload.pin = editWorkerPin.trim();
    try {
      await client.apiCall.invoke({
        url: `/api/v1/projects/${selectedProjectId}/workers/${editingWorker.id}`,
        method: 'PATCH',
        data: payload,
      });
      toast.success('Worker updated');
      setWorkerDialogOpen(false);
      setEditingWorker(null);
      void loadProjectScoped();
    } catch {
      toast.error('Could not update worker');
    }
  };

  const setWorkerActive = async (worker: SiteWorkerCard, active: boolean) => {
    if (!selectedProjectId) return;
    try {
      await client.apiCall.invoke({
        url: `/api/v1/projects/${selectedProjectId}/workers/${worker.id}`,
        method: 'PATCH',
        data: { active },
      });
      toast.success(active ? 'Worker enabled' : 'Worker disabled');
      void loadProjectScoped();
    } catch {
      toast.error('Could not update worker');
    }
  };

  const triggerAdminReset = async (adminUser: SystemAdmin) => {
    try {
      const res = await client.apiCall.invoke({
        url: `/api/v1/admin/roles/system-admins/${adminUser.user_id}/reset-password`,
        method: 'POST',
        data: { reason: 'admin-panel' },
      });
      toast.success((res?.data?.message as string | undefined) || 'Reset requested');
    } catch {
      toast.error('Could not trigger password reset');
    }
  };

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-background pb-8">
      <div className="max-w-lg mx-auto p-4 space-y-4">
        {sessionIsProvisionalAdmin ? (
          <Card className="border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-semibold uppercase text-amber-900">Provisional admin (PIN)</p>
            <p className="text-sm text-amber-900 mt-1">Temporary admin session. Replace with SSO when ready.</p>
            {adminSessionEndsLabel ? <p className="text-xs text-amber-800 mt-1">Session ends {adminSessionEndsLabel} (~{Math.round(ADMIN_SESSION_TTL_MS / 3600000)}h)</p> : null}
            <Button type="button" variant="outline" className="mt-3 w-full" onClick={() => runAdminLogout(navigate)}>Log out admin</Button>
          </Card>
        ) : (
          <p className="text-xs text-muted-foreground">Administrator session: account/SSO (not site worker PIN).</p>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Project</p>
          <div className="grid grid-cols-1 gap-2">
            {projects.map((project) => (
              <Button key={project.id} variant={selectedProjectId === project.id ? 'default' : 'outline'} className="h-11 justify-start rounded-xl" onClick={() => setSelectedProjectId(project.id)}>
                <House className="h-4 w-4 mr-2" />
                {project.name}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant={tab === 'project' ? 'default' : 'outline'} className="h-10" onClick={() => setTab('project')}><LayoutDashboard className="h-4 w-4 mr-1.5" />Project</Button>
          <Button variant={tab === 'workers' ? 'default' : 'outline'} className="h-10" onClick={() => setTab('workers')}><HardHat className="h-4 w-4 mr-1.5" />Site Workers</Button>
          <Button variant={tab === 'features' ? 'default' : 'outline'} className="h-10" onClick={() => setTab('features')}><Layers className="h-4 w-4 mr-1.5" />Features</Button>
          <Button variant={tab === 'admins' ? 'default' : 'outline'} className="h-10" onClick={() => setTab('admins')}><UserCog className="h-4 w-4 mr-1.5" />System Admins</Button>
        </div>

        {tab === 'project' && overview && (
          <Card className="p-4">
            <h2 className="text-lg font-bold">{overview.project_name}</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-center"><p className="text-xl font-bold">{overview.rooms}</p><p className="text-xs text-muted-foreground">Rooms</p></div>
              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-center"><p className="text-xl font-bold">{overview.active_workers}</p><p className="text-xs text-muted-foreground">Active workers</p></div>
              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-center"><p className="text-xl font-bold">{overview.floors}</p><p className="text-xs text-muted-foreground">Floors</p></div>
            </div>
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Enabled features</p>
              <div className="flex flex-wrap gap-2">
                {overview.enabled_features.map((feature) => <Badge key={feature} className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{FEATURE_LABELS[feature] ?? feature}</Badge>)}
              </div>
            </div>
          </Card>
        )}

        {tab === 'workers' && (
          <>
            {siteWorkers.map((worker) => (
              <Card key={worker.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{worker.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">Assigned: {worker.assigned_floor || '-'} {worker.assigned_room ? `• Room ${worker.assigned_room}` : ''}</p>
                    <p className="text-xs text-muted-foreground">Phase: {worker.assigned_phase || '-'}</p>
                    <p className="text-xs text-muted-foreground">Last active: {worker.last_active_at ? new Date(worker.last_active_at).toLocaleString() : 'No activity yet'}</p>
                    {!worker.active ? <Badge className="mt-2 bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">Disabled</Badge> : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button size="sm" variant="outline" className="h-10" onClick={() => openEditWorker(worker)}><Pencil className="h-4 w-4 mr-1.5" />Edit</Button>
                    {worker.active ? (
                      <Button size="sm" variant="outline" className="h-10 text-amber-700 border-amber-300" onClick={() => void setWorkerActive(worker, false)}><UserX className="h-4 w-4 mr-1.5" />Disable</Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-10 text-emerald-700 border-emerald-300" onClick={() => void setWorkerActive(worker, true)}><UserCheck className="h-4 w-4 mr-1.5" />Enable</Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
            {siteWorkers.length === 0 ? <Card className="p-6 text-center text-sm text-muted-foreground">No site workers found for this project.</Card> : null}
          </>
        )}

        {tab === 'features' && (
          <Card className="p-4 space-y-3">
            <h3 className="font-semibold">Enabled Features</h3>
            {features.map((feature) => (
              <div key={feature.key} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <span className="text-sm font-medium">{FEATURE_LABELS[feature.key] ?? feature.key}</span>
                <Switch checked={feature.enabled} onCheckedChange={() => void toggleFeature(feature)} />
              </div>
            ))}
          </Card>
        )}

        {tab === 'admins' && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">System Admins</h3>
              <Button className="h-9" onClick={() => setAdminDialogOpen(true)}><Plus className="h-4 w-4 mr-1.5" />Add admin</Button>
            </div>
            {systemAdmins.map((adminUser) => (
              <Card key={adminUser.user_id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{adminUser.name || adminUser.display_name || adminUser.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{adminUser.email}</p>
                    <Badge className="mt-2 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"><Crown className="h-3 w-3 mr-1" />System Admin</Badge>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => void triggerAdminReset(adminUser)}>Reset password</Button>
                    <Button type="button" size="sm" variant="outline" className="h-9 text-red-600 border-red-300" disabled={systemAdmins.length <= 1} onClick={() => void removeSystemAdmin(adminUser.user_id)}>Remove</Button>
                  </div>
                </div>
              </Card>
            ))}
          </>
        )}
      </div>

      <Dialog open={adminDialogOpen} onOpenChange={setAdminDialogOpen}>
        <DialogContent className="mx-4 max-w-sm">
          <DialogForm onSubmit={(e) => { e.preventDefault(); void addSystemAdmin(); }}>
            <DialogHeader><DialogTitle>Add system admin</DialogTitle></DialogHeader>
            <Input placeholder="Email address" value={adminEmailToAdd} onChange={(e) => setAdminEmailToAdd(e.target.value)} className="h-12" autoComplete="email" />
            <DialogFooter><Button type="submit" className="w-full" disabled={addingAdmin}>{addingAdmin ? 'Adding…' : 'Add admin'}</Button></DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      <Dialog open={workerDialogOpen} onOpenChange={setWorkerDialogOpen}>
        <DialogContent className="mx-4 max-w-sm">
          <DialogForm onSubmit={(e) => { e.preventDefault(); void saveWorkerEdit(); }}>
            <DialogHeader><DialogTitle>Edit site worker</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Worker name" value={editWorkerName} onChange={(e) => setEditWorkerName(e.target.value)} className="h-12" />
              <Input type="password" inputMode="numeric" placeholder="New PIN (optional)" value={editWorkerPin} onChange={(e) => setEditWorkerPin(e.target.value)} className="h-12 text-center tracking-widest" autoComplete="new-password" />
            </div>
            <DialogFooter><Button type="submit" className="w-full">Save changes</Button></DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>
    </div>
  );
}
