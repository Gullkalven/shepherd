import { cn } from '@/lib/utils';

/** Transparent brand mark for in-app UI (login, nav). Not used for PWA/tab icons. */
export const SHEPHERD_LOGO_URL = '/shepherd-logo-mark.png';

type ShepherdLogoProps = {
  className?: string;
  /** @default "Shepherd" */
  alt?: string;
};

export function ShepherdLogo({ className, alt = 'Shepherd' }: ShepherdLogoProps) {
  return (
    <img
      src={SHEPHERD_LOGO_URL}
      alt={alt}
      className={cn('object-contain', className)}
      decoding="async"
    />
  );
}
