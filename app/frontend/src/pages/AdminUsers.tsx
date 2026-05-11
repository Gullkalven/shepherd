import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Crown, HardHat, House, LayoutDashboard, Layers, Pencil, Plus, Shield, Trash2, UserCheck, UserCog, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { validateNewSixDigitPin } from '@/lib/pinValidation';

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
  site_workers?: number;
  admin_count?: number;
  enabled_features: string[];
}

interface FeatureToggle {
  key: string;
  label?: string;
  enabled: boolean;
}

interface SiteWorkerCard {
  id: number;
  project_id?: number;
  name: string;
  active: boolean;
  has_pin?: boolean;
  pin_configured?: boolean;
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
  const [projectScopedLoading, setProjectScopedLoading] = useState(false);
  const [projectScopedError, setProjectScopedError] = useState<string | null>(null);
  const projectRequestSeq = useRef(0);

  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [adminEmailToAdd, setAdminEmailToAdd] = useState('');
  const [addingAdmin, setAddingAdmin] = useState(false);

  const [workerDialogOpen, setWorkerDialogOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState<SiteWorkerCard | null>(null);
  const [editWorkerName, setEditWorkerName] = useState('');
  const [editWorkerPin, setEditWorkerPin] = useState('');
  const [createWorkerOpen, setCreateWorkerOpen] = useState(false);
  const [createWorkerName, setCreateWorkerName] = useState('');
  const [createWorkerPin, setCreateWorkerPin] = useState('');
  const [createWorkerActive, setCreateWorkerActive] = useState(true);
  const [creatingWorker, setCreatingWorker] = useState(false);

  const [deletingWorker, setDeletingWorker] = useState<SiteWorkerCard | null>(null);
  const [deleteWorkerBusy, setDeleteWorkerBusy] = useState(false);

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
      setProjectScopedError(null);
      return;
    }
    const requestId = ++projectRequestSeq.current;
    setProjectScopedLoading(true);
    setProjectScopedError(null);
    setOverview(null);
    setFeatures([]);
    setSiteWorkers([]);
    try {
      const [overviewRes, featuresRes, workersRes] = await Promise.all([
        client.apiCall.invoke({ url: `/api/v1/admin/panel/projects/${selectedProjectId}/overview`, method: 'GET', data: {} }),
        client.apiCall.invoke({ url: `/api/v1/admin/panel/projects/${selectedProjectId}/features`, method: 'GET', data: {} }),
        client.apiCall.invoke({ url: `/api/v1/admin/panel/projects/${selectedProjectId}/site-workers`, method: 'GET', data: {} }),
      ]);
      if (requestId !== projectRequestSeq.current) return;
      setOverview((overviewRes?.data ?? null) as ProjectOverview | null);
      const featuresPayload = featuresRes?.data as { features?: FeatureToggle[] } | FeatureToggle[] | undefined;
      const parsedFeatures = Array.isArray(featuresPayload)
        ? featuresPayload
        : Array.isArray(featuresPayload?.features)
          ? featuresPayload.features
          : [];
      setFeatures(parsedFeatures);
      setSiteWorkers(Array.isArray(workersRes?.data) ? (workersRes.data as SiteWorkerCard[]) : []);
    } catch (e: unknown) {
      if (requestId !== projectRequestSeq.current) return;
      const err = e as { response?: { status?: number }; message?: string };
      const status = err?.response?.status;
      if (status === 403) {
        setProjectScopedError('You do not have access to this project.');
      } else if (status === 404) {
        setProjectScopedError('Project not found or no longer available.');
      } else {
        setProjectScopedError('Failed to load project data. Please try again.');
      }
      throw e;
    } finally {
      if (requestId === projectRequestSeq.current) {
        setProjectScopedLoading(false);
      }
    }
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
    void loadProjectScoped().catch(() => {});
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
    if (editWorkerPin.trim()) {
      const pinRes = validateNewSixDigitPin(editWorkerPin);
      if (!pinRes.ok) {
        toast.error(pinRes.message);
        return;
      }
      payload.pin = pinRes.pin;
    }
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

  const createSiteWorker = async () => {
    if (!selectedProjectId || creatingWorker) return;
    const name = createWorkerName.trim();
    const pin = createWorkerPin.trim();
    if (!name) {
      toast.error('Worker name is required');
      return;
    }
    const pinRes = validateNewSixDigitPin(pin);
    if (!pinRes.ok) {
      toast.error(pinRes.message);
      return;
    }
    setCreatingWorker(true);
    try {
      await client.apiCall.invoke({
        url: `/api/v1/admin/panel/projects/${selectedProjectId}/site-workers`,
        method: 'POST',
        data: {
          name,
          pin: pinRes.pin,
          active: createWorkerActive,
        },
      });
      toast.success('Site worker created');
      setCreateWorkerOpen(false);
      setCreateWorkerName('');
      setCreateWorkerPin('');
      setCreateWorkerActive(true);
      await loadProjectScoped();
    } catch (e: unknown) {
      const err = e as {
        data?: { detail?: string };
        response?: { data?: { detail?: string } };
        message?: string;
      };
      const detail =
        err?.data?.detail ||
        err?.response?.data?.detail ||
        err?.message ||
        'Could not create site worker';
      toast.error(detail);
    } finally {
      setCreatingWorker(false);
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

  const confirmDeleteWorker = async () => {
    if (!selectedProjectId || !deletingWorker) return;
    const targetId = deletingWorker.id;
    setDeleteWorkerBusy(true);
    try {
      await client.apiCall.invoke({
        url: `/api/v1/admin/panel/projects/${selectedProjectId}/site-workers/${targetId}`,
        method: 'DELETE',
        data: {},
      });
      // Optimistically drop from the list and decrement the visible counter
      // so the card disappears immediately even before the refresh resolves.
      setSiteWorkers((prev) => prev.filter((w) => w.id !== targetId));
      setOverview((prev) =>
        prev
          ? {
              ...prev,
              site_workers: Math.max(0, (prev.site_workers ?? 0) - 1),
              active_workers: deletingWorker.active
                ? Math.max(0, prev.active_workers - 1)
                : prev.active_workers,
            }
          : prev,
      );
      toast.success('Site worker deleted');
      setDeletingWorker(null);
      void loadProjectScoped();
    } catch (e: unknown) {
      const err = e as {
        data?: { detail?: string };
        response?: { data?: { detail?: string } };
        message?: string;
      };
      const detail =
        err?.data?.detail ||
        err?.response?.data?.detail ||
        err?.message ||
        'Could not delete site worker';
      toast.error(detail);
    } finally {
      setDeleteWorkerBusy(false);
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

        {tab === 'project' && projectScopedLoading && <Card className="p-6 text-center text-sm text-muted-foreground">Loading project overview…</Card>}
        {tab === 'project' && projectScopedError && <Card className="p-6 text-center text-sm text-muted-foreground">{projectScopedError}</Card>}
        {tab === 'project' && !projectScopedLoading && !projectScopedError && overview && (
          <Card className="p-4">
            <h2 className="text-lg font-bold">{overview.project_name}</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-center"><p className="text-xl font-bold">{overview.rooms}</p><p className="text-xs text-muted-foreground">Rooms</p></div>
              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-center"><p className="text-xl font-bold">{overview.active_workers}</p><p className="text-xs text-muted-foreground">Active workers</p></div>
              <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-center"><p className="text-xl font-bold">{overview.floors}</p><p className="text-xs text-muted-foreground">Floors</p></div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{overview.site_workers ?? 0} Site Workers • {overview.admin_count ?? 0} Admins</p>
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
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Site Workers</h3>
              <Button
                className="h-9"
                onClick={() => {
                  setCreateWorkerName('');
                  setCreateWorkerPin('');
                  setCreateWorkerActive(true);
                  setCreateWorkerOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add worker
              </Button>
            </div>
            {projectScopedLoading ? <Card className="p-6 text-center text-sm text-muted-foreground">Loading site workers…</Card> : null}
            {!projectScopedLoading && projectScopedError ? <Card className="p-6 text-center text-sm text-muted-foreground">{projectScopedError}</Card> : null}
            {!projectScopedLoading && !projectScopedError && siteWorkers.length === 0 ? <Card className="p-6 text-center text-sm text-muted-foreground">0 Site Workers</Card> : null}
            {!projectScopedLoading && !projectScopedError && siteWorkers.map((worker) => (
              <Card key={worker.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{worker.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">Assigned: {worker.assigned_floor || '-'} {worker.assigned_room ? `• Room ${worker.assigned_room}` : ''}</p>
                    <p className="text-xs text-muted-foreground">Phase: {worker.assigned_phase || '-'}</p>
                    <p className="text-xs text-muted-foreground">Last active: {worker.last_active_at ? new Date(worker.last_active_at).toLocaleString() : 'No activity yet'}</p>
                    <p className="text-xs text-muted-foreground">PIN: {worker.has_pin ?? worker.pin_configured ? 'Configured' : 'Not set'}</p>
                    {!worker.active ? <Badge className="mt-2 bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">Disabled</Badge> : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button size="sm" variant="outline" className="h-10" onClick={() => openEditWorker(worker)}><Pencil className="h-4 w-4 mr-1.5" />Edit</Button>
                    {worker.active ? (
                      <Button size="sm" variant="outline" className="h-10 text-amber-700 border-amber-300" onClick={() => void setWorkerActive(worker, false)}><UserX className="h-4 w-4 mr-1.5" />Disable</Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-10 text-emerald-700 border-emerald-300" onClick={() => void setWorkerActive(worker, true)}><UserCheck className="h-4 w-4 mr-1.5" />Enable</Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-10"
                      onClick={() => setDeletingWorker(worker)}
                      aria-label={`Delete site worker ${worker.name}`}
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </>
        )}

        {tab === 'features' && (
          <Card className="p-4 space-y-3">
            <h3 className="font-semibold">Enabled Features</h3>
            {features.map((feature) => (
              <div key={feature.key} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <span className="text-sm font-medium">{feature.label || FEATURE_LABELS[feature.key] || feature.key}</span>
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
              <Input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="Ny PIN (6 siffer, valgfritt)"
                value={editWorkerPin}
                onChange={(e) => setEditWorkerPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="h-12 text-center tracking-widest"
                autoComplete="new-password"
              />
            </div>
            <DialogFooter><Button type="submit" className="w-full">Save changes</Button></DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createWorkerOpen}
        onOpenChange={(open) => {
          if (!creatingWorker) setCreateWorkerOpen(open);
        }}
      >
        <DialogContent className="mx-4 max-w-sm">
          <DialogForm onSubmit={(e) => { e.preventDefault(); void createSiteWorker(); }}>
            <DialogHeader><DialogTitle>Add site worker</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="Worker name"
                value={createWorkerName}
                onChange={(e) => setCreateWorkerName(e.target.value)}
                className="h-12"
                autoComplete="off"
                disabled={creatingWorker}
              />
              <Input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="PIN (6 siffer)"
                value={createWorkerPin}
                onChange={(e) => setCreateWorkerPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="h-12 text-center tracking-widest"
                autoComplete="new-password"
                disabled={creatingWorker}
              />
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <span className="text-sm font-medium">Active on create</span>
                <Switch checked={createWorkerActive} onCheckedChange={setCreateWorkerActive} disabled={creatingWorker} />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full" disabled={creatingWorker}>
                {creatingWorker ? 'Creating…' : 'Create worker'}
              </Button>
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deletingWorker}
        onOpenChange={(open) => {
          if (!open && !deleteWorkerBusy) setDeletingWorker(null);
        }}
      >
        <DialogContent className="mx-4 max-w-sm">
          <DialogForm
            onSubmit={(e) => {
              e.preventDefault();
              void confirmDeleteWorker();
            }}
          >
            <DialogHeader>
              <DialogTitle>Delete this site worker? This cannot be undone.</DialogTitle>
            </DialogHeader>
            {deletingWorker ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{deletingWorker.name}</span> will be removed from this project.
              </p>
            ) : null}
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button
                type="submit"
                variant="destructive"
                className="w-full"
                disabled={deleteWorkerBusy}
              >
                {deleteWorkerBusy ? 'Deleting…' : 'Delete site worker'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={deleteWorkerBusy}
                onClick={() => setDeletingWorker(null)}
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>
    </div>
  );
}
