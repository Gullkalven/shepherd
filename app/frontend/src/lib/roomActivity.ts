import { normalizeRoomPhase, visitMatchesPhase, photoMatchesPhase } from '@/lib/roomPhases';
import { DEFAULT_AREA_ID, taskBelongsToArea } from '@/lib/roomAreas';

export type ActivityLogEntry = {
  id?: string;
  at?: string;
  kind?: string;
  actor?: string;
  phase_key?: string;
  phase_label?: string;
  area_id?: string | null;
  item_name?: string | null;
  task_id?: number | null;
  photo_id?: number | null;
  meta?: Record<string, unknown> | null;
};

export function coerceActivityLog(raw: unknown): ActivityLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === 'object') as ActivityLogEntry[];
}

function q(s: string): string {
  return s.replace(/"/g, "'");
}

/** Primary line (requirement wording for checklist). */
export function formatActivityMessage(e: ActivityLogEntry): string {
  const actor = (e.actor || 'Someone').trim();
  const kind = e.kind || '';
  const item = (e.item_name || '').trim();
  const meta = e.meta && typeof e.meta === 'object' ? e.meta : {};

  switch (kind) {
    case 'checklist_checked':
      return `${actor} checked off "${q(item) || 'item'}"`;
    case 'checklist_unchecked':
      return `${actor} unchecked "${q(item) || 'item'}"`;
    case 'checklist_item_added':
      return `${actor} added checklist item "${q(item) || 'item'}"`;
    case 'checklist_item_renamed': {
      const nn = typeof meta.new_name === 'string' ? meta.new_name.trim() : '';
      return `${actor} renamed checklist item from "${q(item)}" to "${q(nn) || '…'}"`;
    }
    case 'checklist_item_deleted':
      return `${actor} removed checklist item "${q(item) || 'item'}"`;
    case 'photo_uploaded': {
      const fn = typeof meta.filename === 'string' ? meta.filename.trim() : '';
      return fn ? `${actor} uploaded photo: ${fn}` : `${actor} uploaded a photo`;
    }
    case 'legacy_photo': {
      const fn = typeof meta.filename === 'string' ? meta.filename.trim() : '';
      return fn ? `Photo uploaded: ${fn}` : 'Photo uploaded';
    }
    case 'photo_deleted': {
      const fn = typeof meta.filename === 'string' ? meta.filename.trim() : '';
      return fn ? `${actor} deleted photo: ${fn}` : `${actor} deleted a photo`;
    }
    case 'room_visit': {
      const act = typeof meta.action === 'string' ? meta.action.trim() : '';
      const tail = act ? `: ${act}` : ' visited the room';
      return `${actor}${tail}`;
    }
    case 'legacy_visit': {
      const s = typeof meta.summary === 'string' ? meta.summary.trim() : '';
      if (s) return `${actor}${s.startsWith(' ') ? '' : ' '}${s}`;
      return `${actor} visited the room`;
    }
    case 'phase_handoff': {
      const d = typeof meta.detail === 'string' ? meta.detail.trim() : '';
      return d || `${actor} completed phase handoff`;
    }
    case 'heating_cable_doc_saved':
      return `${actor} saved heating cable documentation`;
    case 'status_changed': {
      const from = meta.from != null ? String(meta.from) : '—';
      const to = meta.to != null ? String(meta.to) : '—';
      return `${actor} changed room status from ${from} to ${to}`;
    }
    case 'due_date_changed': {
      const from = meta.from != null ? String(meta.from) : '—';
      const to = meta.to != null ? String(meta.to) : '—';
      return `${actor} changed due date (${from} → ${to})`;
    }
    case 'room_note_updated':
      return `${actor} updated room notes`;
    case 'phase_status_changed': {
      const from = meta.from != null ? String(meta.from) : '—';
      const to = meta.to != null ? String(meta.to) : '—';
      return `${actor} updated phase step (${from} → ${to})`;
    }
    case 'phase_lock_changed': {
      const to = meta.to === true ? 'locked for workers' : meta.to === false ? 'reopened' : String(meta.to);
      return `${actor} ${to}`;
    }
    case 'workflow_deviations_updated':
      return `${actor} updated issues / deviations`;
    case 'checklist_labels_updated':
      return `${actor} updated checklist section titles`;
    case 'phase_tool_overrides_updated':
      return `${actor} updated phase tools visibility`;
    default:
      return `${actor} — ${kind || 'activity'}`;
  }
}

export function collectLoggedVisitIds(entries: ActivityLogEntry[]): Set<number> {
  const ids = new Set<number>();
  for (const e of entries) {
    const m = e.meta;
    if (!m || typeof m !== 'object') continue;
    const v = (m as { visit_id?: unknown }).visit_id;
    if (typeof v === 'number') ids.add(v);
  }
  return ids;
}

export function collectLoggedPhotoIds(entries: ActivityLogEntry[]): Set<number> {
  const ids = new Set<number>();
  for (const e of entries) {
    if (typeof e.photo_id === 'number') ids.add(e.photo_id);
    const m = e.meta;
    if (m && typeof m === 'object' && typeof (m as { photo_id?: unknown }).photo_id === 'number') {
      ids.add((m as { photo_id: number }).photo_id);
    }
  }
  return ids;
}

/** One activity line for the room Activity panel; `t` is ms since epoch from stored timestamps (not label text). */
export type ActivityDisplayRow = {
  t: number;
  msg: string;
  /** Stable React key; log rows prefer server `id` when present. */
  rowKey: string;
};

export function buildActivityRows(params: {
  activityLog: unknown;
  visits: {
    id: number;
    worker_name: string;
    action?: string;
    visited_at: string;
    phase?: string | null;
    area_id?: string | null;
  }[];
  photos: { id: number; filename?: string; created_at?: string | null; phase?: string | null; area_id?: string | null }[];
  phaseTab: string;
  phaseWorkflow: { key: string }[];
  activeAreaId: string;
  areasPrimaryId: string;
  parseActivityTime: (s: string | null | undefined) => number;
}): ActivityDisplayRow[] {
  const {
    activityLog,
    visits,
    photos,
    phaseTab,
    phaseWorkflow,
    activeAreaId,
    areasPrimaryId,
    parseActivityTime,
  } = params;
  const sel = normalizeRoomPhase(phaseTab, phaseWorkflow);
  const entries = coerceActivityLog(activityLog);
  const loggedVisits = collectLoggedVisitIds(entries);
  const loggedPhotos = collectLoggedPhotoIds(entries);

  /** Monotonic insert order: higher = newer. Used when two rows share the same `t` (e.g. same-second precision). */
  let seq = 0;
  const rows: { t: number; msg: string; seq: number; rowKey: string }[] = [];

  for (const e of entries) {
    if (!taskBelongsToArea(e.area_id, activeAreaId, areasPrimaryId)) continue;
    if (!visitMatchesPhase(e.phase_key, sel, phaseWorkflow)) continue;
    const t = parseActivityTime(e.at ?? null);
    const phaseLabel = (e.phase_label || e.phase_key || '').trim();
    const base = formatActivityMessage(e);
    const msg =
      phaseLabel && phaseLabel !== '—' ? `${base} · ${phaseLabel}` : base;
    const id = typeof e.id === 'string' && e.id.trim() ? e.id.trim() : '';
    rows.push({
      t,
      msg,
      seq: seq++,
      rowKey: id ? `log:${id}` : `log:seq-${seq - 1}`,
    });
  }

  for (const v of visits) {
    if (loggedVisits.has(v.id)) continue;
    if (!taskBelongsToArea(v.area_id, activeAreaId, areasPrimaryId)) continue;
    if (!visitMatchesPhase(v.phase, sel, phaseWorkflow)) continue;
    const t = parseActivityTime(v.visited_at);
    const tail = v.action?.trim() ? `: ${v.action.trim()}` : ' visited the room';
    rows.push({
      t,
      msg: `${v.worker_name}${tail}`,
      seq: seq++,
      rowKey: `visit:${v.id}`,
    });
  }

  for (const p of photos) {
    if (loggedPhotos.has(p.id)) continue;
    if (!taskBelongsToArea(p.area_id, activeAreaId, areasPrimaryId)) continue;
    if (!photoMatchesPhase(p.phase, sel, phaseWorkflow)) continue;
    const t = parseActivityTime(p.created_at ?? null);
    rows.push({
      t,
      msg: p.filename ? `Photo uploaded: ${p.filename}` : 'Photo uploaded',
      seq: seq++,
      rowKey: `photo:${p.id}`,
    });
  }

  rows.sort((a, b) => b.t - a.t || b.seq - a.seq);
  return rows
    .filter((r) => r.t > 0)
    .slice(0, 500)
    .map(({ t, msg, rowKey }) => ({ t, msg, rowKey }));
}
