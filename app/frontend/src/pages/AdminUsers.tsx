import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Shield, User, Users, Crown, Wrench,
  Eye, EyeOff, ClipboardList, CheckCircle2, Camera, MessageSquare, Activity, UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';

interface UserWithRole {
  user_id: string;
  email: string;
  name: string | null;
  app_role: string;
  display_name: string | null;
  role_id: number | null;
}

interface SectionSetting {
  role_name: string;
  section_key: string;
  section_label: string;
  is_visible: boolean;
}

const ROLE_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string; bg: string; description: string }
> = {
  admin: {
    label: 'Admin',
    icon: <Crown className="h-3.5 w-3.5" />,
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    description: 'Full access: projects, structure, phases, settings',
  },
  worker: {
    label: 'Worker',
    icon: <Wrench className="h-3.5 w-3.5" />,
    color: 'text-slate-700 dark:text-slate-300',
    bg: 'bg-slate-100 dark:bg-slate-800',
    description: 'Rooms, checklists, notes, photos — no structure changes',
  },
};

const SECTION_ICONS: Record<string, React.ReactNode> = {
  visit_log: <ClipboardList className="h-4 w-4 text-indigo-500" />,
  checklist: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  photos: <Camera className="h-4 w-4 text-blue-500" />,
  comments: <MessageSquare className="h-4 w-4 text-purple-500" />,
  status: <Activity className="h-4 w-4 text-amber-500" />,
  assigned_worker: <UserCheck className="h-4 w-4 text-teal-500" />,
};

const SECTION_ORDER = Object.keys(SECTION_ICONS);

const LEGACY_WORKER_ROLES = new Set(['worker', 'electrician', 'apprentice']);

export default function AdminUsers() {
  const navigate = useNavigate();
  const { isAdmin, loading: permLoading } = usePermissions();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionSetting[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'sections'>('users');

  const loadUsers = useCallback(async () => {
    try {
      const res = await client.apiCall.invoke({
        url: '/api/v1/admin/roles/users',
        method: 'GET',
        data: {},
      });
      setUsers(res?.data || []);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSections = useCallback(async () => {
    try {
      const res = await client.apiCall.invoke({
        url: '/api/v1/sections/visibility',
        method: 'GET',
        data: {},
      });
      setSections(res?.data || []);
    } catch {
      toast.error('Failed to load section settings');
    } finally {
      setSectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!permLoading && isAdmin) {
      loadUsers();
      loadSections();
    } else if (!permLoading && !isAdmin) {
      setLoading(false);
      setSectionsLoading(false);
    }
  }, [permLoading, isAdmin, loadUsers, loadSections]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdating(userId);
    try {
      await client.apiCall.invoke({
        url: '/api/v1/admin/roles/assign',
        method: 'POST',
        data: { user_id: userId, app_role: newRole },
      });
      setUsers((prev) =>
        prev.map((u) => (u.user_id === userId ? { ...u, app_role: newRole } : u))
      );
      toast.success(`Role updated to ${ROLE_CONFIG[newRole]?.label || newRole}`);
    } catch (e: unknown) {
      const ax = e as { data?: { detail?: string }; response?: { data?: { detail?: string } }; message?: string };
      const detail = ax?.data?.detail || ax?.response?.data?.detail || ax?.message || 'Failed to update role';
      toast.error(detail);
    } finally {
      setUpdating(null);
    }
  };

  const handleToggleSection = async (roleName: string, sectionKey: string, currentVisible: boolean) => {
    const newVisible = !currentVisible;
    const matchesRole = (s: SectionSetting) =>
      s.section_key === sectionKey &&
      (roleName === 'admin' ? s.role_name === 'admin' : LEGACY_WORKER_ROLES.has(s.role_name));

    setSections((prev) => {
      const hasRow = prev.some(matchesRole);
      if (hasRow) {
        return prev.map((s) =>
          matchesRole(s) ? { ...s, is_visible: newVisible, role_name: roleName } : s
        );
      }
      return [
        ...prev,
        {
          role_name: roleName,
          section_key: sectionKey,
          section_label: sectionKey.replace(/_/g, ' '),
          is_visible: newVisible,
        },
      ];
    });
    try {
      await client.apiCall.invoke({
        url: '/api/v1/sections/visibility/update',
        method: 'POST',
        data: { role_name: roleName, section_key: sectionKey, is_visible: newVisible },
      });
      toast.success(`${sectionKey.replace('_', ' ')} ${newVisible ? 'shown' : 'hidden'} for ${roleName}s`);
    } catch {
      void loadSections();
      toast.error('Failed to update setting');
    }
  };

  const sectionsForRole = useMemo(() => {
    const build = (canonical: 'admin' | 'worker'): SectionSetting[] =>
      SECTION_ORDER.map((section_key) => {
        const candidates = sections.filter(
          (s) =>
            s.section_key === section_key &&
            (canonical === 'admin' ? s.role_name === 'admin' : LEGACY_WORKER_ROLES.has(s.role_name))
        );
        const base =
          candidates.find((s) => s.role_name === (canonical === 'admin' ? 'admin' : 'worker')) ??
          candidates[0];
        if (!base) {
          return {
            role_name: canonical,
            section_key,
            section_label: section_key.replace(/_/g, ' '),
            is_visible: true,
          };
        }
        return { ...base, role_name: canonical };
      });
    return {
      admin: build('admin'),
      worker: build('worker'),
    };
  }, [sections]);

  if (permLoading || loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-dvh bg-slate-50 dark:bg-background">
        <div className="p-4 max-w-lg mx-auto">
          <Card className="p-8 text-center">
            <Shield className="h-12 w-12 text-red-400 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-slate-800 dark:text-foreground mb-2">Access Denied</h2>
            <p className="text-muted-foreground text-sm">Only administrators can manage user roles.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/')}>Go Back</Button>
          </Card>
        </div>
      </div>
    );
  }

  const adminCount = users.filter((u) => u.app_role === 'admin' || u.app_role === 'manager').length;
  const workerCount = users.filter(
    (u) =>
      u.app_role === 'worker' ||
      u.app_role === 'electrician' ||
      u.app_role === 'apprentice'
  ).length;

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-background pb-8">
      <div className="p-4 max-w-lg mx-auto space-y-4">
        <div className="flex bg-slate-200 dark:bg-slate-800 rounded-lg p-0.5">
          <Button
            variant="ghost"
            size="sm"
            className={`flex-1 rounded-md h-9 ${activeTab === 'users' ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            <Users className="h-4 w-4 mr-1.5" />
            Users
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`flex-1 rounded-md h-9 ${activeTab === 'sections' ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`}
            onClick={() => setActiveTab('sections')}
          >
            <Eye className="h-4 w-4 mr-1.5" />
            Sections
          </Button>
        </div>

        {activeTab === 'users' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-3 text-center">
                <Crown className="h-5 w-5 text-amber-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-slate-800 dark:text-foreground">{adminCount}</p>
                <p className="text-xs text-muted-foreground">Admins</p>
              </Card>
              <Card className="p-3 text-center">
                <Wrench className="h-5 w-5 text-slate-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-slate-800 dark:text-foreground">{workerCount}</p>
                <p className="text-xs text-muted-foreground">Workers</p>
              </Card>
            </div>

            <Card className="p-4">
              <h3 className="font-semibold text-slate-800 dark:text-foreground mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-amber-500" />
                Roles
              </h3>
              <div className="space-y-2">
                {(['admin', 'worker'] as const).map((key) => {
                  const cfg = ROLE_CONFIG[key];
                  return (
                    <div key={key} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                      <Badge className={`${cfg.bg} ${cfg.color} border-0 gap-1`}>
                        {cfg.icon}
                        {cfg.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{cfg.description}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <h2 className="text-lg font-bold text-slate-800 dark:text-foreground flex items-center gap-2">
              <Users className="h-5 w-5" />
              Users ({users.length})
            </h2>

            {users.length === 0 ? (
              <Card className="p-8 text-center">
                <Users className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                <p className="text-muted-foreground">No users found</p>
                <p className="text-sm text-muted-foreground mt-1">Users will appear here after they log in</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {users.map((user) => {
                  const displayRole =
                    user.app_role === 'manager'
                      ? 'admin'
                      : ['electrician', 'apprentice'].includes(user.app_role)
                        ? 'worker'
                        : user.app_role;
                  const roleCfg = ROLE_CONFIG[displayRole] || ROLE_CONFIG.worker;
                  const selectValue = displayRole === 'admin' ? 'admin' : 'worker';
                  return (
                    <Card key={user.user_id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                            <User className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-slate-800 dark:text-foreground truncate">
                              {user.name || user.display_name || 'Unnamed User'}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                            <Badge className={`${roleCfg.bg} ${roleCfg.color} border-0 gap-1 mt-1.5 text-[10px]`}>
                              {roleCfg.icon}
                              {roleCfg.label}
                            </Badge>
                          </div>
                        </div>
                        <Select
                          value={selectValue}
                          onValueChange={(val) => handleRoleChange(user.user_id, val)}
                          disabled={updating === user.user_id}
                        >
                          <SelectTrigger className="w-[120px] h-9 shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">
                              <span className="flex items-center gap-1.5">
                                <Crown className="h-3 w-3 text-amber-500" />
                                Admin
                              </span>
                            </SelectItem>
                            <SelectItem value="worker">
                              <span className="flex items-center gap-1.5">
                                <Wrench className="h-3 w-3 text-slate-500" />
                                Worker
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === 'sections' && (
          <>
            <Card className="p-4">
              <h3 className="font-semibold text-slate-800 dark:text-foreground mb-2 flex items-center gap-2">
                <Eye className="h-4 w-4 text-blue-500" />
                Section visibility
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                Control which sections appear on the room page for each role.
              </p>
            </Card>

            {sectionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-6 w-6 border-3 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
              </div>
            ) : (
              (['admin', 'worker'] as const).map((roleName) => {
                const roleCfg = ROLE_CONFIG[roleName];
                const roleSections = sectionsForRole[roleName];

                return (
                  <Card key={roleName} className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Badge className={`${roleCfg.bg} ${roleCfg.color} border-0 gap-1`}>
                        {roleCfg.icon}
                        {roleCfg.label}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      {roleSections.map((section) => (
                        <div
                          key={`${section.role_name}-${section.section_key}`}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50"
                        >
                          <div className="flex items-center gap-2.5">
                            {SECTION_ICONS[section.section_key] || <Eye className="h-4 w-4" />}
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                              {section.section_label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {section.is_visible ? (
                              <Eye className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                            )}
                            <Switch
                              checked={section.is_visible}
                              onCheckedChange={() =>
                                handleToggleSection(section.role_name, section.section_key, section.is_visible)
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
