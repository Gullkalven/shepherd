import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChevronLeft, HardHat, LogOut, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { APP_NAME_PARTS } from '@/lib/branding';
import DevRoleSwitcher from '@/components/DevRoleSwitcher';

interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface HeaderProps {
  breadcrumbs?: BreadcrumbItem[];
  onLogout?: () => void;
}

export default function Header({ breadcrumbs = [], onLogout }: HeaderProps) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isRoot = breadcrumbs.length === 0;

  const handleBack = () => {
    if (breadcrumbs.length > 1) {
      const parent = breadcrumbs[breadcrumbs.length - 2];
      if (parent.path) navigate(parent.path);
      else navigate(-1 as any);
    } else {
      navigate('/');
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-[#1E3A5F] dark:bg-slate-900 text-white shadow-lg">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3.5 lg:max-w-none lg:px-6 xl:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {breadcrumbs.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-white transition-all hover:bg-white/20 hover:scale-[1.02]"
              onClick={handleBack}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="flex min-w-0 items-center gap-2.5">
            <HardHat className="h-5 w-5 text-amber-400 shrink-0" />
            <div className="flex items-center gap-1 text-sm truncate">
              {isRoot ? (
                <span className="text-base font-black tracking-[0.14em] uppercase">
                  {APP_NAME_PARTS.prefix}
                  <span className="text-amber-300/90">{APP_NAME_PARTS.dot}</span>
                  {APP_NAME_PARTS.suffix}
                </span>
              ) : (
                breadcrumbs.map((item, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-white/50">/</span>}
                    {item.path && i < breadcrumbs.length - 1 ? (
                      <button
                        onClick={() => navigate(item.path!)}
                        className="text-white/70 hover:text-white truncate max-w-[80px]"
                      >
                        {item.label}
                      </button>
                    ) : (
                      <span className="font-semibold truncate max-w-[120px]">
                        {item.label}
                      </span>
                    )}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <DevRoleSwitcher />
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-white transition-all hover:bg-white/20 hover:scale-[1.02]"
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          {onLogout && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-white transition-all hover:bg-white/20 hover:scale-[1.02]"
              onClick={onLogout}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}