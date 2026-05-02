import { useEffect, useState } from 'react';

const DESKTOP = '(min-width: 1024px)';

/**
 * `autoFocus` on phones triggers an immediate scroll on open/edit, which often fights the user.
 * Use this to only enable autoFocus on desktop breakpoint (lg+).
 */
export function useDesktopAutoFocus(): boolean {
  const [allow, setAllow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const sync = () => setAllow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return allow;
}
