import { useCallback, useEffect, useState } from 'react';
import { client } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogForm } from '@/components/ui/dialog';
import { Plus, Pencil, UserX, UserCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiFailureMessage, devLogApiFailure } from '@/lib/apiErrors';

type ProjectWorker = {
  id: number;
  project_id: number;
  name: string;
  role: string;
  active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

export default function ProjectWorkersPanel({ projectId }: { projectId: number }) {
  const [workers, setWorkers] = useState<ProjectWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectWorker | null>(null);
  const [editName, setEditName] = useState('');
  const [editPin, setEditPin] = useState('');
  const [deleting, setDeleting] = useState<ProjectWorker | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.apiCall.invoke({
        url: `/api/v1/projects/${projectId}/workers`,
        method: 'GET',
        data: {},
      });
      const data = res?.data;
      setWorkers(Array.isArray(data) ? (data as ProjectWorker[]) : []);
    } catch (err) {
      devLogApiFailure('ProjectWorkersPanel.load', err);
      toast.error(apiFailureMessage(err) ?? 'Failed to load site workers');
      setWorkers([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createWorker = async () => {
    if (!newName.trim() || newPin.trim().length < 4) {
      toast.error('Name and PIN (4+ characters) are required');
      return;
    }
    setCreating(true);
    try {
      await client.apiCall.invoke({
        url: `/api/v1/projects/${projectId}/workers`,
        method: 'POST',
        data: { name: newName.trim(), pin: newPin.trim(), role: 'worker' },
      });
      toast.success('Worker created');
      setCreateOpen(false);
      setNewName('');
      setNewPin('');
      void load();
    } catch (err) {
      devLogApiFailure('ProjectWorkersPanel.createWorker', err);
      toast.error(apiFailureMessage(err) ?? 'Could not create worker');
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (w: ProjectWorker) => {
    setEditing(w);
    setEditName(w.name);
    setEditPin('');
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editName.trim()) {
      toast.error('Name is required');
      return;
    }
    try {
      const payload: { name: string; pin?: string } = { name: editName.trim() };
      if (editPin.trim().length >= 4) payload.pin = editPin.trim();
      await client.apiCall.invoke({
        url: `/api/v1/projects/${projectId}/workers/${editing.id}`,
        method: 'PATCH',
        data: payload,
      });
      toast.success(editPin.trim().length >= 4 ? 'Worker updated (PIN changed)' : 'Worker updated');
      setEditing(null);
      void load();
    } catch (err) {
      devLogApiFailure('ProjectWorkersPanel.saveEdit', err);
      toast.error(apiFailureMessage(err) ?? 'Could not update worker');
    }
  };

  const setActive = async (w: ProjectWorker, active: boolean) => {
    try {
      await client.apiCall.invoke({
        url: `/api/v1/projects/${projectId}/workers/${w.id}`,
        method: 'PATCH',
        data: { active },
      });
      toast.success(active ? 'Worker reactivated' : 'Worker deactivated');
      void load();
    } catch (err) {
      devLogApiFailure('ProjectWorkersPanel.setActive', err);
      toast.error(apiFailureMessage(err) ?? 'Could not update worker');
    }
  };

  const deleteWorker = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await client.apiCall.invoke({
        url: `/api/v1/projects/${projectId}/workers/${deleting.id}`,
        method: 'DELETE',
        data: {},
      });
      setWorkers((prev) => prev.filter((w) => w.id !== deleting.id));
      toast.success('Worker deleted');
      setDeleting(null);
    } catch (err) {
      devLogApiFailure('ProjectWorkersPanel.deleteWorker', err);
      toast.error(apiFailureMessage(err) ?? 'Could not delete worker');
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-800 dark:text-foreground">Site workers (PIN)</h2>
          <p className="text-xs text-muted-foreground">Field sign-in: /worker/login — project #{projectId}</p>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-9 shrink-0"
          onClick={() => {
            setNewName('');
            setNewPin('');
            setCreateOpen(true);
          }}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add worker
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : workers.length === 0 ? (
        <div className="space-y-3 rounded-md border border-dashed border-border p-4 text-center">
          <p className="text-sm text-muted-foreground">No PIN workers yet. Add one for workers to sign in at /worker/login.</p>
          <Button
            type="button"
            size="sm"
            className="h-9"
            onClick={() => {
              setNewName('');
              setNewPin('');
              setCreateOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add worker
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {workers.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-medium text-slate-900 dark:text-foreground">{w.name}</span>
                {!w.active ? (
                  <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    Inactive
                  </span>
                ) : null}
                <span className="ml-2 text-xs text-muted-foreground">{w.role}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(w)} aria-label="Edit worker">
                  <Pencil className="h-4 w-4" />
                </Button>
                {w.active ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-amber-700 dark:text-amber-400"
                    onClick={() => void setActive(w, false)}
                    aria-label="Deactivate"
                  >
                    <UserX className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-emerald-700 dark:text-emerald-400"
                    onClick={() => void setActive(w, true)}
                    aria-label="Reactivate"
                  >
                    <UserCheck className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  onClick={() => setDeleting(w)}
                  aria-label="Delete worker"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="mx-4 max-w-sm">
          <DialogForm
            onSubmit={(e) => {
              e.preventDefault();
              void createWorker();
            }}
          >
            <DialogHeader>
              <DialogTitle>Add site worker</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="Display name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-12"
                autoComplete="off"
              />
              <Input
                type="password"
                inputMode="numeric"
                placeholder="PIN (4+ digits)"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                className="h-12 text-center text-lg tracking-widest"
                autoComplete="new-password"
              />
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? 'Creating…' : 'Create worker'}
              </Button>
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="mx-4 max-w-sm">
          <DialogForm
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit worker</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="Display name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-12"
                autoComplete="off"
              />
              <Input
                type="password"
                inputMode="numeric"
                placeholder="New PIN (leave blank to keep)"
                value={editPin}
                onChange={(e) => setEditPin(e.target.value)}
                className="h-12 text-center text-lg tracking-widest"
                autoComplete="new-password"
              />
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full">
                Save
              </Button>
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && !deletingBusy && setDeleting(null)}>
        <DialogContent className="mx-4 max-w-sm">
          <DialogForm
            onSubmit={(e) => {
              e.preventDefault();
              void deleteWorker();
            }}
          >
            <DialogHeader>
              <DialogTitle>Are you sure you want to delete this worker?</DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={deletingBusy}
                onClick={() => setDeleting(null)}
              >
                Cancel
              </Button>
              <Button type="submit" className="w-full" variant="destructive" disabled={deletingBusy}>
                {deletingBusy ? 'Deleting…' : 'Delete worker'}
              </Button>
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
