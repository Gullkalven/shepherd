import { createClient } from '@metagptx/web-sdk';
import { getAPIBaseURL } from './config';

function axiosBaseURL(): string {
  const base = getAPIBaseURL().replace(/\/$/, '');
  if (!base) return '/';
  return `${base}/`;
}

// Same backend origin for every SDK request (paths are like /api/v1/...).
export const client = createClient({ baseURL: axiosBaseURL() });

const PROJECTS_ALL_PATH = '/api/v1/entities/projects/all';

/**
 * Loads projects via an absolute URL (API origin + path + query).
 * The web-sdk uses axios with relative paths; on some deployed SPAs the browser
 * can resolve those against the current route, producing a broken URL like `all?sort=…`
 * instead of `/api/v1/entities/projects/all?…`.
 */
export async function fetchProjectsListAll(): Promise<{ data: { items: unknown[] } }> {
  const base = getAPIBaseURL().replace(/\/$/, '');
  const qs = new URLSearchParams({
    sort: '-created_at',
    skip: '0',
    limit: '100',
  });
  const url = `${base}${PROJECTS_ALL_PATH}?${qs.toString()}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  try {
    const token = globalThis.localStorage?.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore */
  }
  if (typeof globalThis.window?.location?.origin === 'string') {
    headers['App-Host'] = globalThis.window.location.origin;
  }

  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & {
      response?: { status: number; data: unknown };
      config?: { url: string; method: string };
    };
    err.response = { status: res.status, data: body };
    err.config = { url, method: 'GET' };
    throw err;
  }
  const items =
    body && typeof body === 'object' && body !== null && 'items' in body && Array.isArray((body as { items: unknown }).items)
      ? (body as { items: unknown[] }).items
      : [];
  return { data: { items } };
}
