import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { PermissionProvider, usePermissions } from '@/lib/permissions';
import { readDemoLocalStorageUser } from '@/lib/devRole';
import { useAppShellAuth } from '@/lib/useAppShellAuth';
import AppNavSidebar from '@/components/AppNavSidebar';
import { APP_NAME_PARTS } from '@/lib/branding';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { initCalmInputFocusScroll } from '@/lib/calmInputFocusScroll';

export type AppShellOutletContext = {
  onLogoutClearServer: () => void;
  onDemoSignedIn: () => void;
};

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
        <SheetContent side="left" className="flex w-[min(100vw-2rem,18rem)] flex-col p-0">
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

export default function AppShellLayout() {
  const { isAuth, checking, setApiUser } = useAppShellAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    return initCalmInputFocusScroll();
  }, []);

  /** Hint scrollports (including the UA) to leave space for sticky header + keyboard — reduces jump-to-center. */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023.98px)');
    const style = document.createElement('style');
    style.setAttribute('data-shepherd-mobile-scroll-padding', '');
    style.textContent = `
@media (max-width: 1023.98px) {
  html {
    scroll-padding-top: 2.75rem;
    scroll-padding-bottom: max(5.5rem, 30dvh);
  }
}`;
    const apply = () => {
      if (mq.matches) {
        if (!style.parentNode) document.head.appendChild(style);
      } else if (style.parentNode) {
        style.remove();
      }
    };
    apply();
    mq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      style.remove();
    };
  }, []);

  /**
   * On supported Chromium-based mobile browsers, prefer resizing the layout with the on-screen
   * keyboard (less overlay reflow) — helps stability next to our focus handler.
   * iOS Safari ignores this; no effect on desktop if viewport meta is missing.
   */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023.98px)');
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;

    const orig = meta.getAttribute('content') || '';
    const sync = () => {
      if (mq.matches) {
        if (orig.includes('interactive-widget')) return;
        const next = orig.trim()
          ? `${orig.trim()}, interactive-widget=resizes-content`
          : 'interactive-widget=resizes-content';
        meta.setAttribute('content', next);
      } else {
        meta.setAttribute('content', orig);
      }
    };
    sync();
    mq.addEventListener('change', sync);
    return () => {
      mq.removeEventListener('change', sync);
      meta.setAttribute('content', orig);
    };
  }, []);

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

        <MobileNavHeader mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />

        <div className={cn('min-h-0 lg:pl-56')}>
          <Outlet context={outletContext} />
        </div>
      </div>
    </PermissionProvider>
  );
}
