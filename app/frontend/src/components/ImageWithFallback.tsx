import { useState, type ImgHTMLAttributes } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type ImageWithFallbackProps = ImgHTMLAttributes<HTMLImageElement> & {
  src?: string | null;
  fallbackClassName?: string;
  iconClassName?: string;
};

export function ImageWithFallback({
  src,
  alt = '',
  className,
  fallbackClassName,
  iconClassName,
  onError,
  ...props
}: ImageWithFallbackProps) {
  const resolvedSrc = String(src || '').trim();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!resolvedSrc || failedSrc === resolvedSrc) {
    return (
      <div className={cn('flex h-full w-full items-center justify-center', fallbackClassName)}>
        <ImageIcon className={cn('h-6 w-6 text-muted-foreground/40', iconClassName)} aria-hidden />
        <span className="sr-only">{alt || 'Image unavailable'}</span>
      </div>
    );
  }

  return (
    <img
      {...props}
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={(event) => {
        setFailedSrc(resolvedSrc);
        onError?.(event);
      }}
    />
  );
}
