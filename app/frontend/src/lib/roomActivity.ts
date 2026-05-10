import { heatingStageDisplayLabel } from '@/lib/heatingCable';
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

/** Primary activity line (Norwegian UI copy). */
export function formatActivityMessage(e: ActivityLogEntry): string {
  const actor = (e.actor || 'Ukjent').trim();
  const kind = e.kind || '';
  const item = (e.item_name || '').trim();
  const meta = e.meta && typeof e.meta === 'object' ? e.meta : {};

  switch (kind) {
    case 'checklist_checked':
      return `${actor} avmerket «${q(item) || 'punkt'}»`;
    case 'checklist_unchecked':
      return `${actor} fjernet avmerking på «${q(item) || 'punkt'}»`;
    case 'checklist_item_added':
      return `${actor} la til sjekkpunkt «${q(item) || 'punkt'}»`;
    case 'checklist_item_renamed': {
      const nn = typeof meta.new_name === 'string' ? meta.new_name.trim() : '';
      return `${actor} endret navn på sjekkpunkt fra «${q(item)}» til «${q(nn) || '…'}»`;
    }
    case 'checklist_item_deleted':
      return `${actor} fjernet sjekkpunkt «${q(item) || 'punkt'}»`;
    case 'photo_uploaded': {
      const fn = typeof meta.filename === 'string' ? meta.filename.trim() : '';
      return fn ? `${actor} lastet opp bilde (${fn})` : `${actor} lastet opp bilde`;
    }
    case 'legacy_photo': {
      const fn = typeof meta.filename === 'string' ? meta.filename.trim() : '';
      return fn ? `Bilde lastet opp: ${fn}` : 'Bilde lastet opp';
    }
    case 'photo_deleted': {
      const fn = typeof meta.filename === 'string' ? meta.filename.trim() : '';
      return fn ? `${actor} slettet bilde: ${fn}` : `${actor} slettet et bilde`;
    }
    case 'room_visit': {
      const act = typeof meta.action === 'string' ? meta.action.trim() : '';
      const tail = act ? `: ${act}` : ' besøkte rommet';
      return `${actor}${tail}`;
    }
    case 'legacy_visit': {
      const s = typeof meta.summary === 'string' ? meta.summary.trim() : '';
      if (s) return `${actor}${s.startsWith(' ') ? '' : ' '}${s}`;
      return `${actor} besøkte rommet`;
    }
    case 'phase_handoff': {
      const d = typeof meta.detail === 'string' ? meta.detail.trim() : '';
      return d || `${actor} registrerte faseoverlevering`;
    }
    case 'heating_cable_doc_saved':
      return `${actor} lagret varmekabel-dokumentasjon`;
    case 'heating_cable_step_completed': {
      const sl = heatingStageDisplayLabel(meta);
      return sl ? `${actor} fullførte ${sl}` : `${actor} fullførte et varmekabeltrinn`;
    }
    case 'heating_cable_measurements_updated': {
      const sl = heatingStageDisplayLabel(meta);
      const r = typeof meta.resistance_ohm === 'string' ? meta.resistance_ohm.trim() : '';
      const ins = typeof meta.insulation_mohm === 'string' ? meta.insulation_mohm.trim() : '';
      const parts: string[] = [];
      if (r) parts.push(`${r} Ω`);
      if (ins) parts.push(`${ins} MΩ`);
      const detail = parts.join(' / ');
      if (sl && detail) return `${actor} oppdaterte målinger for ${sl} · ${detail}`;
      if (sl) return `${actor} oppdaterte målinger for ${sl}`;
      return `${actor} oppdaterte varmekabelmålinger`;
    }
    case 'heating_cable_admin_measurement_correction': {
      const sl = heatingStageDisplayLabel(meta);
      const pr = typeof meta.prev_resistance_ohm === 'string' ? meta.prev_resistance_ohm.trim() : '';
      const pi = typeof meta.prev_insulation_mohm === 'string' ? meta.prev_insulation_mohm.trim() : '';
      const pd = typeof meta.prev_date === 'string' ? meta.prev_date.trim() : '';
      const nr = typeof meta.resistance_ohm === 'string' ? meta.resistance_ohm.trim() : '';
      const ni = typeof meta.insulation_mohm === 'string' ? meta.insulation_mohm.trim() : '';
      const nd = typeof meta.date === 'string' ? meta.date.trim() : '';
      const bits: string[] = [];
      if (pr !== nr) bits.push(`Motstand ${pr || '—'} Ω → ${nr || '—'} Ω`);
      if (pi !== ni) bits.push(`Isolasjon ${pi || '—'} MΩ → ${ni || '—'} MΩ`);
      if (pd !== nd) bits.push(`Dato ${pd || '—'} → ${nd || '—'}`);
      const detail = bits.join(' · ');
      if (sl && detail) return `${actor} korrigerte målinger for ${sl} · ${detail}`;
      if (sl) return `${actor} korrigerte målinger for ${sl}`;
      return `${actor} korrigerte varmekabelmålinger`;
    }
    case 'heating_cable_admin_step_unlocked': {
      const sl = heatingStageDisplayLabel(meta);
      return sl ? `${actor} låste opp ${sl}` : `${actor} låste opp et varmekabeltrinn`;
    }
    case 'heating_cable_note_updated': {
      const sl = heatingStageDisplayLabel(meta);
      return sl ? `${actor} oppdaterte notat for ${sl}` : `${actor} oppdaterte et varmekabelnotat`;
    }
    case 'heating_cable_stage_photos_updated': {
      const sl = heatingStageDisplayLabel(meta);
      return sl ? `${actor} oppdaterte bilder for ${sl}` : `${actor} oppdaterte varmekabelbilder`;
    }
    case 'heating_cable_extra_steps_updated':
      return `${actor} oppdaterte ekstra varmekabelmålinger`;
    case 'status_changed': {
      const from = meta.from != null ? String(meta.from) : '—';
      const to = meta.to != null ? String(meta.to) : '—';
      return `${actor} endret romstatus fra ${from} til ${to}`;
    }
    case 'due_date_changed': {
      const from = meta.from != null ? String(meta.from) : '—';
      const to = meta.to != null ? String(meta.to) : '—';
      return `${actor} endret frist (${from} → ${to})`;
    }
    case 'room_note_updated':
      return `${actor} oppdaterte romnotat`;
    case 'phase_status_changed': {
      const from = meta.from != null ? String(meta.from) : '—';
      const to = meta.to != null ? String(meta.to) : '—';
      return `${actor} oppdaterte fasetrinn (${from} → ${to})`;
    }
    case 'phase_lock_changed': {
      if (meta.to === true) return `${actor} låste fase for montører`;
      if (meta.to === false) return `${actor} åpnet fase for montører`;
      return `${actor} ${String(meta.to)}`;
    }
    case 'workflow_deviations_updated':
      return `${actor} oppdaterte avvik`;
    case 'issue_resolved':
      return `${actor} løste avvik`;
    case 'checklist_labels_updated':
      return `${actor} oppdaterte titler på sjekkliste-seksjoner`;
    case 'phase_tool_overrides_updated':
      return `${actor} oppdaterte synlighet for faseverktøy`;
    default:
      return `${actor} — ${kind || 'hendelse'}`;
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
    const tail = v.action?.trim() ? `: ${v.action.trim()}` : ' besøkte rommet';
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
      msg: p.filename ? `Bilde lastet opp: ${p.filename}` : 'Bilde lastet opp',
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
