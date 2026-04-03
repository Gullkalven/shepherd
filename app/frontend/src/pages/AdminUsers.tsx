import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { PermissionProvider, usePermissions } from '@/lib/permissions';
import Header from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Shield, ShieldCheck, User, Users, Crown, Wrench, HardHat,
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

const ROLE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; description: string }> = {
  admin: {
    label: 'Admin',
    icon: <Crown className="h-3.5 w-3.5" />,
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    description: 'Full control over everything',
  },
  manager: {
    label: 'Manager',
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
    color: 'text-blue-700 dark:text-blue-300',
    bg: 'bg-blue-100 dark:bg-blue-900/40',
    description: 'Can edit items, rooms, floors',
  },
  electrician: {
    label: 'Electrician (Montor)',
    icon: <Wrench className="h-3.5 w-3.5" />,
    color: 'text-slate-700 dark:text-slate-300',
    bg: 'bg-slate-100 dark:bg-slate-800',
    description: 'Can update checklist/status, comments, photos, visits',
  },
  apprentice: {
    label: 'Apprentice (Laerling)',
    icon: <HardHat className="h-3.5 w-3.5" />,
    color: 'text-violet-700 dark:text-violet-300',
    bg: 'bg-violet-100 dark:bg-violet-900/40',
    description: 'Limited field access, cannot change structure',
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

function AdminUsersContent() {
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
    } catch (e: any) {
      const detail = e?.data?.detail || e?.response?.data?.detail || e?.message || 'Failed to update role';
      toast.error(detail);
    } finally {
      setUpdating(null);
    }
  };

  const handleToggleSection = async (roleName: string, sectionKey: string, currentVisible: boolean) => {
    const newVisible = !currentVisible;
    // Optimistic update
    setSections((prev) =>
      prev.map((s) =>
        s.role_name === roleName && s.section_key === sectionKey
          ? { ...s, is_visible: newVisible }
          : s
      )
    );
    try {
      await client.apiCall.invoke({
        url: '/api/v1/sections/visibility/update',
        method: 'POST',
        data: { role_name: roleName, section_key: sectionKey, is_visible: newVisible },
      });
      toast.success(`${sectionKey.replace('_', ' ')} ${newVisible ? 'shown' : 'hidden'} for ${roleName}s`);
    } catch {
      // Revert
      setSections((prev) =>
        prev.map((s) =>
          s.role_name === roleName && s.section_key === sectionKey
            ? { ...s, is_visible: currentVisible }
            : s
        )
      );
      toast.error('Failed to update setting');
    }
  };

  if (permLoading || loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background">
        <Header breadcrumbs={[{ label: 'Projects', path: '/' }, { label: 'Admin' }]} />
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

  const adminCount = users.filter((u) => u.app_role === 'admin').length;
  const managerCount = users.filter((u) => u.app_role === 'manager').length;
  const electricianCount = users.filter((u) => u.app_role === 'electrician' || u.app_role === 'worker').length;
  const apprenticeCount = users.filter((u) => u.app_role === 'apprentice').length;

  const getSectionsForRole = (roleName: string) =>
    sections.filter((s) => s.role_name === roleName);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-background pb-8">
      <Header breadcrumbs={[{ label: 'Projects', path: '/' }, { label: 'Admin Settings' }]} />
      <div className="p-4 max-w-lg mx-auto space-y-4">
        {/* Tab Toggle */}
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
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="p-3 text-center">
                <Crown className="h-5 w-5 text-amber-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-slate-800 dark:text-foreground">{adminCount}</p>
                <p className="text-xs text-muted-foreground">Admins</p>
              </Card>
              <Card className="p-3 text-center">
                <ShieldCheck className="h-5 w-5 text-blue-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-slate-800 dark:text-foreground">{managerCount}</p>
                <p className="text-xs text-muted-foreground">Managers</p>
              </Card>
              <Card className="p-3 text-center">
                <Wrench className="h-5 w-5 text-slate-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-slate-800 dark:text-foreground">{electricianCount}</p>
                <p className="text-xs text-muted-foreground">Electricians</p>
              </Card>
              <Card className="p-3 text-center">
                <HardHat className="h-5 w-5 text-violet-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-slate-800 dark:text-foreground">{apprenticeCount}</p>
                <p className="text-xs text-muted-foreground">Apprentices</p>
              </Card>
            </div>

            {/* Role Legend */}
            <Card className="p-4">
              <h3 className="font-semibold text-slate-800 dark:text-foreground mb-3 flex items-center gap-2">
                <HardHat className="h-4 w-4 text-amber-500" />
                Role Permissions
              </h3>
              <div className="space-y-2">
                {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
                  <div key={key} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <Badge className={`${cfg.bg} ${cfg.color} border-0 gap-1`}>
                      {cfg.icon}
                      {cfg.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{cfg.description}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* User List */}
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
                  const normalizedRole = user.app_role === 'worker' ? 'electrician' : user.app_role;
                  const roleCfg = ROLE_CONFIG[normalizedRole] || ROLE_CONFIG.electrician;
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
                          value={user.app_role === "worker" ? "electrician" : user.app_role}
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
                            <SelectItem value="manager">
                              <span className="flex items-center gap-1.5">
                                <ShieldCheck className="h-3 w-3 text-blue-500" />
                                Manager
                              </span>
                            </SelectItem>
                            <SelectItem value="electrician">
                              <span className="flex items-center gap-1.5">
                                <Wrench className="h-3 w-3 text-slate-500" />
                                Electrician
                              </span>
                            </SelectItem>
                            <SelectItem value="apprentice">
                              <span className="flex items-center gap-1.5">
                                <HardHat className="h-3 w-3 text-violet-500" />
                                Apprentice
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
                Section Visibility
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                Control which sections are visible in the Room Detail page for each role. Toggle off to hide a section.
              </p>
            </Card>

            {sectionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-6 w-6 border-3 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
              </div>
            ) : (
              ['admin', 'manager', 'electrician', 'apprentice'].map((roleName) => {
                const roleCfg = ROLE_CONFIG[roleName];
                const roleSections = getSectionsForRole(roleName);

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

export default function AdminUsers() {
  const [isAuth, setIsAuth] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await client.auth.me();
        setIsAuth(!!res?.data);
      } catch {
        setIsAuth(false);
      } finally {
        setChecking(false);
      }
    };
    check();
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#1E3A5F] dark:border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <PermissionProvider isAuthenticated={isAuth}>
      <AdminUsersContent />
    </PermissionProvider>
  );
}