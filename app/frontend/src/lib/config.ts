// Runtime configuration
let runtimeConfig: {
  API_BASE_URL: string;
} | null = null;

// Configuration loading state
let configLoading = true;

/** Local `vite` / dev server: backend not on the static site host. */
const LOCAL_DEV_API_ORIGIN = 'http://127.0.0.1:8000';

/**
 * If a production build has no VITE_API_URL (misconfigured CI), never default to loopback —
 * browsers on Render/static hosts cannot reach 127.0.0.1:8000.
 */
const PRODUCTION_API_ORIGIN_FALLBACK = 'https://shepherd-backend-aj54.onrender.com';

function isLoopbackApiOrigin(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes('127.0.0.1') || u.includes('localhost');
}

// Function to load runtime configuration
export async function loadRuntimeConfig(): Promise<void> {
  try {
    if (import.meta.env.DEV) {
      console.log('[Shepherd] Loading /api/config (optional)…');
    }
    const response = await fetch('/api/config');
    if (!response.ok) {
      if (import.meta.env.DEV) {
        console.warn(`[Shepherd] /api/config HTTP ${response.status}; using Vite env / defaults.`);
      }
      return;
    }

    const raw = await response.text();
    const trimmed = raw.trim();
    if (!trimmed) return;

    // SPA hosts often return index.html for unknown routes — never treat as JSON success.
    if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
      if (import.meta.env.DEV) {
        console.warn('[Shepherd] /api/config returned HTML, not JSON; using Vite env / defaults.');
      }
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      console.warn('[Shepherd] /api/config body is not valid JSON; using Vite env / defaults.');
      return;
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      'API_BASE_URL' in (parsed as Record<string, unknown>)
    ) {
      const url = String((parsed as { API_BASE_URL?: unknown }).API_BASE_URL ?? '').trim();
      if (url) {
        runtimeConfig = { API_BASE_URL: url.replace(/\/$/, '') };
        if (import.meta.env.DEV) {
          console.log('[Shepherd] Runtime API_BASE_URL applied from /api/config.');
        }
      }
    }
  } catch (error) {
    console.warn('[Shepherd] Failed to fetch /api/config; using Vite env / defaults:', error);
  } finally {
    configLoading = false;
  }
}

/** Production API origin from Vite (baked in at build time). VITE_API_URL is preferred; VITE_API_BASE_URL kept for older setups. */
function viteResolvedApiOrigin(): string | null {
  const primary = import.meta.env.VITE_API_URL;
  if (typeof primary === 'string' && primary.trim() !== '') {
    return primary.trim().replace(/\/$/, '');
  }
  const legacy = import.meta.env.VITE_API_BASE_URL;
  if (typeof legacy === 'string' && legacy.trim() !== '') {
    return legacy.trim().replace(/\/$/, '');
  }
  return null;
}

// Get current configuration
export function getConfig() {
  // Vite env first — from .env.production at build time or CI; never relies on the page’s host.
  const fromVite = viteResolvedApiOrigin();
  if (fromVite) {
    return { API_BASE_URL: fromVite };
  }

  if (configLoading) {
    if (import.meta.env.DEV) {
      return { API_BASE_URL: LOCAL_DEV_API_ORIGIN };
    }
    console.warn(
      '[Shepherd] API: no VITE_API_URL in bundle while config loading; using production fallback (set VITE_API_URL or rely on .env.production).'
    );
    return { API_BASE_URL: PRODUCTION_API_ORIGIN_FALLBACK };
  }

  if (runtimeConfig?.API_BASE_URL) {
    if (import.meta.env.DEV) {
      console.log('[Shepherd] Using runtime API_BASE_URL from /api/config.');
    }
    let u = String(runtimeConfig.API_BASE_URL).trim().replace(/\/$/, '');
    if (import.meta.env.PROD && isLoopbackApiOrigin(u)) {
      console.warn(
        '[Shepherd] Ignoring loopback API_BASE_URL from /api/config in production; using fallback.'
      );
      u = PRODUCTION_API_ORIGIN_FALLBACK;
    }
    return { API_BASE_URL: u };
  }

  if (import.meta.env.PROD) {
    console.warn('[Shepherd] API: no VITE_API_URL and no runtime config; using production fallback.');
    return { API_BASE_URL: PRODUCTION_API_ORIGIN_FALLBACK };
  }

  console.log('Using local dev API default');
  return { API_BASE_URL: LOCAL_DEV_API_ORIGIN };
}

// Dynamic API_BASE_URL getter - this will always return the current config
export function getAPIBaseURL(): string {
  return getConfig().API_BASE_URL;
}

// For backward compatibility, but this should be avoided
// Removed static export to prevent using stale config values
// export const API_BASE_URL = getAPIBaseURL();

export const config = {
  get API_BASE_URL() {
    return getAPIBaseURL();
  },
};
