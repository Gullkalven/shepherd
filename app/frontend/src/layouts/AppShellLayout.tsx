import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { PermissionProvider } from '@/lib/permissions';
import { readDemoLocalStorageUser } from '@/lib/devRole';
import { useAppShellAuth } from '@/lib/useAppShellAuth';
import AppNavSidebar from '@/components/AppNavSidebar';
import { APP_NAME_PARTS } from '@/lib/branding';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export type AppShellOutletContext = {
  onLogoutClearServer: () => void;
  onDemoSignedIn: () => void;
};

export default function AppShellLayout() {
  const { isAuth, checking, setApiUser } = useAppShellAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (checking) return;
    if (isAuth) return;
    const p = location.pathname;
    if (p.startsWith('/project') || p.startsWith('/admin')) {
      navigate('/', { replace: true });
    }
  }, [isAuth, checking, location.pathname, navigate]);

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

  if (!isAuth) {
    return (
      <PermissionProvider isAuthenticated={false}>
        <Outlet context={outletContext} />
      </PermissionProvider>
    );
  }

  return (
    <PermissionProvider isAuthenticated>
      <div className="min-h-dvh bg-slate-50 dark:bg-background">
        <AppNavSidebar variant="desktop" />

        <header className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b border-border bg-background px-3 lg:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-[min(100vw-2rem,18rem)] flex-col p-0">
              <AppNavSidebar variant="sheet" onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="truncate text-sm font-black uppercase tracking-[0.12em]">
            {APP_NAME_PARTS.prefix}
            <span className="text-amber-600/90 dark:text-amber-400/90">{APP_NAME_PARTS.dot}</span>
            {APP_NAME_PARTS.suffix}
          </span>
        </header>

        <div className={cn('min-h-0 lg:pl-56')}>
          <Outlet context={outletContext} />
        </div>
      </div>
    </PermissionProvider>
  );
}
