import { createRoot } from 'react-dom/client';
import './index.css';
import { loadRuntimeConfig } from './lib/config.ts';

// Load runtime configuration before rendering the app
async function initializeApp() {
  try {
    await loadRuntimeConfig();
  } catch (error) {
    console.warn('[Shepherd] Runtime config bootstrap failed; continuing with Vite env / defaults:', error);
  }

  // Import App after config is ready so @/lib/api createClient() sees the final API base
  // (VITE_API_URL / .env.production or /api/config), not a stale snapshot during loading.
  const { default: App } = await import('./App.tsx');
  createRoot(document.getElementById('root')!).render(<App />);
}

// Initialize the app
initializeApp();
