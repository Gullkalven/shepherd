import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RotateCw, Smartphone } from 'lucide-react';

type MobilePortraitGuardProps = {
  children: ReactNode;
};

function isMobileLikeDevice(): boolean {
  if (typeof window === 'undefined') return false;

  const coarsePointer = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const smallViewport = window.matchMedia('(max-width: 1366px)').matches;
  const ua = window.navigator.userAgent;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua);

  return (coarsePointer && smallViewport) || mobileUa;
}

function isLandscapeOrientation(): boolean {
  if (typeof window === 'undefined') return false;

  if (window.screen?.orientation?.type) {
    return window.screen.orientation.type.startsWith('landscape');
  }

  return window.matchMedia('(orientation: landscape)').matches;
}

export default function MobilePortraitGuard({ children }: MobilePortraitGuardProps) {
  const [isMobileLike, setIsMobileLike] = useState<boolean>(() => isMobileLikeDevice());
  const [isLandscape, setIsLandscape] = useState<boolean>(() => isLandscapeOrientation());

  useEffect(() => {
    const refresh = () => {
      setIsMobileLike(isMobileLikeDevice());
      setIsLandscape(isLandscapeOrientation());
    };

    refresh();

    const media = window.matchMedia('(orientation: landscape)');
    const onOrientation = () => refresh();

    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);
    media.addEventListener('change', onOrientation);
    window.screen?.orientation?.addEventListener?.('change', onOrientation);

    return () => {
      window.removeEventListener('resize', refresh);
      window.removeEventListener('orientationchange', refresh);
      media.removeEventListener('change', onOrientation);
      window.screen?.orientation?.removeEventListener?.('change', onOrientation);
    };
  }, []);

  const shouldBlockLandscape = useMemo(() => isMobileLike && isLandscape, [isLandscape, isMobileLike]);

  useEffect(() => {
    if (!isMobileLike) return;

    const orientationApi = window.screen?.orientation;
    if (!orientationApi?.lock) return;

    orientationApi.lock('portrait').catch(() => {
      // iOS Safari and many browsers reject or ignore orientation lock outside fullscreen contexts.
    });
  }, [isMobileLike]);

  useEffect(() => {
    document.documentElement.classList.toggle('mobile-orientation-lock', shouldBlockLandscape);
    return () => {
      document.documentElement.classList.remove('mobile-orientation-lock');
    };
  }, [shouldBlockLandscape]);

  return (
    <>
      <div aria-hidden={shouldBlockLandscape} className={shouldBlockLandscape ? 'hidden' : undefined}>
        {children}
      </div>

      {shouldBlockLandscape && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Rotate device to portrait mode"
          className="fixed inset-0 z-[100] flex min-h-dvh items-center justify-center bg-background/98 px-6 py-6 text-foreground"
          style={{
            paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
            paddingRight: 'max(1.5rem, env(safe-area-inset-right))',
            paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
            paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
          }}
        >
          <div className="flex w-full max-w-sm flex-col items-center justify-center rounded-3xl border border-border/80 bg-card px-8 py-10 text-center shadow-xl">
            <div className="relative mb-6">
              <div className="rounded-3xl border border-border/80 bg-muted/30 p-5">
                <Smartphone className="h-12 w-12 text-foreground/80" />
              </div>
              <RotateCw className="absolute -right-3 -top-3 h-7 w-7 text-primary" />
            </div>
            <p className="text-balance text-lg font-semibold tracking-tight">Rotate device to portrait mode</p>
          </div>
        </div>
      )}
    </>
  );
}
