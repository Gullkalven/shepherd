// Runtime configuration
let runtimeConfig: {
  API_BASE_URL: string;
} | null = null;

// Configuration loading state
let configLoading = true;

// Default fallback configuration
const defaultConfig = {
  API_BASE_URL: 'http://127.0.0.1:8000', // Only used if runtime config fails to load
};

// Function to load runtime configuration
export async function loadRuntimeConfig(): Promise<void> {
  try {
    console.log('🔧 DEBUG: Starting to load runtime config...');
    // Try to load configuration from a config endpoint
    const response = await fetch('/api/config');
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      // Only parse as JSON if the response is actually JSON
      if (contentType && contentType.includes('application/json')) {
        runtimeConfig = await response.json();
        console.log('Runtime config loaded successfully');
      } else {
        console.log(
          'Config endpoint returned non-JSON response, skipping runtime config'
        );
      }
    } else {
      console.log(
        '🔧 DEBUG: Config fetch failed with status:',
        response.status
      );
    }
  } catch (error) {
    console.log('Failed to load runtime config, using defaults:', error);
  } finally {
    configLoading = false;
    console.log(
      '🔧 DEBUG: Config loading finished, configLoading set to false'
    );
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
  // Vite env first — correct before loadRuntimeConfig() finishes (avoids hitting the frontend host on Render).
  const fromVite = viteResolvedApiOrigin();
  if (fromVite) {
    return { API_BASE_URL: fromVite };
  }

  if (configLoading) {
    console.log('Config still loading, using default config');
    return defaultConfig;
  }

  if (runtimeConfig?.API_BASE_URL) {
    console.log('Using runtime config');
    const u = String(runtimeConfig.API_BASE_URL).trim().replace(/\/$/, '');
    return { API_BASE_URL: u };
  }

  console.log('Using default config');
  return defaultConfig;
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
