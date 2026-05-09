import { getAPIBaseURL } from '@/lib/config';

function apiOrigin(): string {
  try {
    return new URL(getAPIBaseURL()).origin;
  } catch {
    return getAPIBaseURL().replace(/\/$/, '');
  }
}

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1';
}

export function resolveDisplayImageUrl(raw: string | null | undefined): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('blob:') || value.startsWith('data:')) return value;

  if (value.startsWith('/api/')) {
    return `${apiOrigin()}${value}`;
  }

  try {
    const url = new URL(value);
    if (isLoopbackHost(url.hostname)) {
      return `${apiOrigin()}${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return value;
  }
}
