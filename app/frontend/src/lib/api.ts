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

function apiDetailMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const row = body as { detail?: unknown; message?: unknown };
    const detail = row.detail ?? row.message;
    if (typeof detail === 'string' && detail.trim()) return detail.trim();
    if (Array.isArray(detail)) {
      const msg = detail
        .map((x) => {
          if (typeof x === 'string') return x;
          if (x && typeof x === 'object') {
            const item = x as { msg?: unknown; message?: unknown; loc?: unknown };
            const text = item.msg ?? item.message;
            if (typeof text === 'string' && text.trim()) {
              const loc = Array.isArray(item.loc) ? item.loc.join('.') : '';
              return loc ? `${loc}: ${text}` : text;
            }
          }
          return String(x);
        })
        .join(', ')
        .trim();
      if (msg) return msg;
    }
  }
  return fallback;
}

function parseJsonBody(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

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
  const items = extractProjectItemsFromListBody(body);
  return { data: { items } };
}

/** Normalizes FastAPI / SDK variants: `{ items }`, `{ data: { items } }`, or a bare array. */
/** Worker phase handoff: records visit and persists phase_lock_overrides (workers cannot PATCH locks directly). */
export async function postWorkerPhaseHandoff(
  roomId: number,
  body: { phase: string; worker_name: string; area_id?: string }
): Promise<void> {
  const base = getAPIBaseURL().replace(/\/$/, '');
  const url = `${base}/api/v1/entities/rooms/${roomId}/worker-phase-handoff`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = globalThis.localStorage?.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore */
  }
  if (typeof globalThis.window?.location?.origin === 'string') {
    headers['App-Host'] = globalThis.window.location.origin;
  }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (typeof j.detail === 'string') detail = j.detail;
      else if (Array.isArray(j.detail)) detail = j.detail.map(String).join(', ');
    } catch {
      /* ignore */
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
}

export async function patchHeatingCableStep(
  roomId: number,
  stepKey: string,
  payload: {
    resistance?: string;
    insulation?: string;
    performed_at?: string;
    photos?: string[];
    note?: string;
    /** When set, replaces extra measurement rows on the server copy of the document. */
    extra_steps?: Record<string, unknown>[];
  }
): Promise<{ heating_cable_doc?: unknown }> {
  const base = getAPIBaseURL().replace(/\/$/, '');
  const url = `${base}/api/v1/rooms/${roomId}/heating-cable/${encodeURIComponent(stepKey)}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = globalThis.localStorage?.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore */
  }
  if (typeof globalThis.window?.location?.origin === 'string') headers['App-Host'] = globalThis.window.location.origin;
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(payload) });
  const text = await res.text();
  const body = parseJsonBody(text);
  if (!res.ok) {
    throw Object.assign(new Error(apiDetailMessage(body, `HTTP ${res.status}`)), {
      response: { status: res.status, data: body },
    });
  }
  return body as { heating_cable_doc?: unknown };
}

/** Persist optional measurement rows after the final main heating stage is locked. */
export async function patchHeatingCableExtraSteps(
  roomId: number,
  extra_steps: Record<string, unknown>[]
): Promise<{ heating_cable_doc?: unknown }> {
  const base = getAPIBaseURL().replace(/\/$/, '');
  const url = `${base}/api/v1/rooms/${roomId}/heating-cable/extra-steps`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = globalThis.localStorage?.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore */
  }
  if (typeof globalThis.window?.location.origin === 'string') headers['App-Host'] = globalThis.window.location.origin;
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ extra_steps }),
  });
  const text = await res.text();
  const body = parseJsonBody(text);
  if (!res.ok) {
    throw Object.assign(new Error(apiDetailMessage(body, `HTTP ${res.status}`)), {
      response: { status: res.status, data: body },
    });
  }
  return body as { heating_cable_doc?: unknown };
}

export async function confirmHeatingCableStep(
  roomId: number,
  stepKey: string,
  payload: Record<string, never> = {}
): Promise<{ heating_cable_doc?: unknown }> {
  const base = getAPIBaseURL().replace(/\/$/, '');
  const url = `${base}/api/v1/rooms/${roomId}/heating-cable/${encodeURIComponent(stepKey)}/confirm`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = globalThis.localStorage?.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore */
  }
  if (typeof globalThis.window?.location?.origin === 'string') headers['App-Host'] = globalThis.window.location.origin;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  const text = await res.text();
  const body = parseJsonBody(text);
  if (!res.ok) {
    throw Object.assign(new Error(apiDetailMessage(body, `HTTP ${res.status}`)), {
      response: { status: res.status, data: body },
    });
  }
  return body as { heating_cable_doc?: unknown };
}

export function extractProjectItemsFromListBody(body: unknown): unknown[] {
  if (body == null) return [];
  if (Array.isArray(body)) return body;
  if (typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;
  if (Array.isArray(o.items)) return o.items;
  const nested = o.data;
  if (nested && typeof nested === 'object') {
    const d = nested as { items?: unknown };
    if (Array.isArray(d.items)) return d.items;
  }
  return [];
}
