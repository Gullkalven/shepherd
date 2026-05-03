/**
 * Project id from route params — must be a positive integer string (no slugs).
 */
export function parseProjectRouteParam(raw: string | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return n;
}

export type ProjectRecord = { id: number; name: string };

/**
 * Normalizes entity GET JSON — supports flat `{ id, name }` or wrapped `{ data: { id, name } }`.
 */
export function unwrapProjectBody(body: unknown): ProjectRecord | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const tryRow = (x: Record<string, unknown>): ProjectRecord | null => {
    const idRaw = x.id;
    const nameRaw = x.name;
    const id =
      typeof idRaw === 'number'
        ? idRaw
        : typeof idRaw === 'string' && /^\d+$/.test(idRaw)
          ? Number(idRaw)
          : NaN;
    if (!Number.isFinite(id) || id < 1) return null;
    if (typeof nameRaw !== 'string') return null;
    return { id, name: nameRaw };
  };
  const direct = tryRow(o);
  if (direct) return direct;
  const nested = o.data;
  if (nested && typeof nested === 'object') {
    return tryRow(nested as Record<string, unknown>);
  }
  return null;
}

/** Drop list rows missing a valid numeric id (never navigate using bad rows). */
export function sanitizeProjectListItems(
  items: unknown[]
): Array<ProjectRecord & { description?: string; created_at?: string }> {
  const out: Array<ProjectRecord & { description?: string; created_at?: string }> = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const base = unwrapProjectBody(raw);
    if (!base) continue;
    const o = raw as Record<string, unknown>;
    out.push({
      ...base,
      ...(typeof o.description === 'string' ? { description: o.description } : {}),
      ...(typeof o.created_at === 'string' ? { created_at: o.created_at } : {}),
    });
  }
  return out;
}
