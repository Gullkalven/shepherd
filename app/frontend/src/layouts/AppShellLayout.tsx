import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { PermissionProvider, usePermissions } from '@/lib/permissions';
import { readDemoLocalStorageUser } from '@/lib/devRole';
import { readAdminSession } from '@/lib/adminSession';
import { readWorkerSession } from '@/lib/workerSession';
import { useAppShellAuth } from '@/lib/useAppShellAuth';
import AppNavSidebar from '@/components/AppNavSidebar';
import { shepherdDebug } from '@/lib/shepherdDebug';
import { APP_NAME_PARTS } from '@/lib/branding';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import WorkerMobileBottomNav from '@/components/WorkerMobileBottomNav';
import { ProjectListProvider } from '@/contexts/ProjectListContext';

export type AppShellOutletContext = {
  onLogoutClearServer: () => void;
  onDemoSignedIn: () => void;
};

function isLoginRoute(pathname: string): boolean {
  return pathname === '/admin/login' || pathname === '/worker/login';
}

/** Slimmer top bar on worker home so the page hero (rooms / site) stays primary on small screens. */
function MobileNavHeader({
  mobileOpen,
  setMobileOpen,
}: {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}) {
  const { isWorker } = usePermissions();
  const location = useLocation();
  const compactWorkerHome = isWorker && location.pathname === '/';

  /** Workers use bottom navigation; avoid hamburger / sheet menu on small screens. */
  if (isWorker) {
    return null;
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex items-center gap-2 border-b border-border bg-background px-2 sm:px-3 lg:hidden',
        compactWorkerHome ? 'h-10 py-1.5' : 'h-12'
      )}
    >
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="flex w-[min(calc(100%-2rem),18rem)] flex-col p-0">
          <AppNavSidebar variant="sheet" onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      {!compactWorkerHome && (
        <span className="truncate text-sm font-black uppercase tracking-[0.12em]">
          {APP_NAME_PARTS.prefix}
          <span className="text-amber-600/90 dark:text-amber-400/90">{APP_NAME_PARTS.dot}</span>
          {APP_NAME_PARTS.suffix}
        </span>
      )}
    </header>
  );
}

function AuthenticatedShellLayout({ outletContext }: { outletContext: AppShellOutletContext }) {
  const { isWorker } = usePermissions();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh min-w-0 max-w-full overflow-x-hidden bg-slate-50 dark:bg-background">
      <AppNavSidebar variant="desktop" />

      <MobileNavHeader mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />

      <WorkerMobileBottomNav />

      <div
        className={cn(
          'min-h-0 min-w-0 max-w-full lg:pl-56',
          isWorker &&
            'max-lg:pb-[calc(4.25rem+env(safe-area-inset-bottom))] max-lg:pt-[max(0.25rem,env(safe-area-inset-top))]'
        )}
      >
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}

export default function AppShellLayout() {
  const { isAuth, checking, setApiUser } = useAppShellAuth();
  const location = useLocation();

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    shepherdDebug('AppShellLayout', {
      path: location.pathname,
      checking,
      isAuth,
      adminSession: Boolean(readAdminSession()?.token),
      workerSession: Boolean(readWorkerSession()?.token),
    });
  }, [location.pathname, checking, isAuth]);

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 dark:bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E3A5F] border-t-transparent dark:border-blue-400" />
      </div>
    );
  }

  const outletContext: AppShellOutletContext = {
    onLogoutClearServer: () => setApiUser(null),
    onDemoSignedIn: () => setApiUser(readDemoLocalStorageUser()),
  };

  /** Signed-in users should not stay on login screens (sync redirect — avoids mounting login under shell). */
  if (isAuth && location.pathname === '/admin/login') {
    return <Navigate to="/" replace />;
  }
  if (isAuth && location.pathname === '/worker/login' && readWorkerSession()?.token) {
    return <Navigate to="/worker/rooms" replace />;
  }

  /**
   * Logged-out users must never mount project routes or API-heavy shells (prevents `/entities/projects/:id` spam).
   */
  if (!isAuth) {
    const p = location.pathname;
    if (p.startsWith('/project')) {
      return <Navigate to="/admin/login" replace />;
    }
    if (p.startsWith('/admin') && p !== '/admin/login') {
      return <Navigate to="/admin/login" replace />;
    }
    if (p.startsWith('/worker') && p !== '/worker/login') {
      return <Navigate to="/worker/login" replace />;
    }
  }

  /** Login routes never use the authenticated sidebar/header chrome — prevents nav stacking on top of login. */
  if (isLoginRoute(location.pathname)) {
    return (
      <PermissionProvider isAuthenticated={isAuth}>
        <Outlet context={outletContext} />
      </PermissionProvider>
    );
  }

  if (!isAuth) {
    return (
      <PermissionProvider isAuthenticated={false}>
        <Outlet context={outletContext} />
      </PermissionProvider>
    );
  }

  return (
    <PermissionProvider isAuthenticated>
      <ProjectListProvider>
        <AuthenticatedShellLayout outletContext={outletContext} />
      </ProjectListProvider>
    </PermissionProvider>
  );
}
