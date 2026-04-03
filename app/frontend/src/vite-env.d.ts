/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Preferred production API origin (no trailing slash), e.g. https://your-backend.onrender.com */
  readonly VITE_API_URL?: string;
  /** Legacy alias for VITE_API_URL */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
