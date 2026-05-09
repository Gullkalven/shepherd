import { cn } from '@/lib/utils';

/** Public URL of the official Shepherd brand mark (dog with hardhat). */
export const SHEPHERD_LOGO_URL = '/shepherd-logo.png';

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
