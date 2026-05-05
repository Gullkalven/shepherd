export type HeatingCableStageKey =
  | 'before_installation'
  | 'after_cable_laid'
  | 'after_screed_final';

export type HeatingCableRoomStatus =
  | 'not_started'
  | 'partial'
  | 'complete'
  | 'has_deviation_missing';

export interface HeatingCableStage {
  id?: string;
  label?: string;
  step_status?: 'locked' | 'unlocked';
  completed_by?: string;
  completed_by_name?: string;
  completed_at?: string;
  confirmation_text?: string;
  resistance_ohm?: string;
  insulation_mohm?: string;
  date?: string;
  performed_by?: string;
  note?: string;
  photos?: string[];
  images?: string[];
}

export interface HeatingCableDoc {
  before_installation?: HeatingCableStage;
  after_cable_laid?: HeatingCableStage;
  after_screed_final?: HeatingCableStage;
  extra_steps?: HeatingCableStage[];
  locked_by_admin?: boolean;
  updated_at?: string;
}

export interface HeatingCableDerived {
  status: HeatingCableRoomStatus;
  missingStages: HeatingCableStageKey[];
  hasDeviation: boolean;
  hasMissingValues: boolean;
  lastUpdated: string | null;
  performedBy: string;
}

/** UI copy for `deriveHeatingCableStatus` — use everywhere to avoid mismatched labels. */
export const HEATING_CABLE_DERIVED_STATUS_LABEL: Record<HeatingCableRoomStatus, string> = {
  not_started: 'Not started',
  partial: 'In progress',
  complete: 'Complete',
  has_deviation_missing: 'Needs attention',
};

export const HEATING_CABLE_STAGES: { key: HeatingCableStageKey; label: string }[] = [
  { key: 'before_installation', label: 'Before installation' },
  { key: 'after_cable_laid', label: 'After cable laid' },
  { key: 'after_screed_final', label: 'After screed / final' },
];

function isFilled(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function normalizeStage(raw: unknown): HeatingCableStage {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  // Keep one canonical key (`date`) but accept legacy aliases from older payloads.
  const dateRaw =
    row.date ??
    row.markingDate ??
    row.dateMarking ??
    row.datomerking ??
    row.installedDate ??
    row.heatingCableDate ??
    row.registeredDate;
  const performedByRaw = row.performed_by ?? row.performedBy;
  const photosRaw = Array.isArray(row.photos) ? row.photos : [];
  const imagesRaw = Array.isArray(row.images) ? row.images : [];
  const mergedImages = [...photosRaw, ...imagesRaw].filter((p) => typeof p === 'string').map((p) => String(p));
  return {
    id: typeof row.id === 'string' ? row.id : '',
    label: typeof row.label === 'string' ? row.label : '',
    step_status: row.step_status === 'locked' ? 'locked' : 'unlocked',
    completed_by: typeof row.completed_by === 'string' ? row.completed_by : '',
    completed_by_name: typeof row.completed_by_name === 'string' ? row.completed_by_name : '',
    completed_at: typeof row.completed_at === 'string' ? row.completed_at : '',
    confirmation_text: typeof row.confirmation_text === 'string' ? row.confirmation_text : '',
    resistance_ohm: typeof row.resistance_ohm === 'string' ? row.resistance_ohm : '',
    insulation_mohm: typeof row.insulation_mohm === 'string' ? row.insulation_mohm : '',
    date: typeof dateRaw === 'string' ? dateRaw : '',
    performed_by: typeof performedByRaw === 'string' ? performedByRaw : '',
    note: typeof row.note === 'string' ? row.note : '',
    photos: mergedImages,
    images: mergedImages,
  };
}

export function normalizeHeatingCableDoc(raw: unknown): HeatingCableDoc {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  return {
    before_installation: normalizeStage(row.before_installation),
    after_cable_laid: normalizeStage(row.after_cable_laid),
    after_screed_final: normalizeStage(row.after_screed_final),
    extra_steps: Array.isArray(row.extra_steps) ? row.extra_steps.map((s) => normalizeStage(s)) : [],
    locked_by_admin: row.locked_by_admin === true,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
}

/** True if this stage has any measurement, note, or attached photo URL. */
export function heatingStageHasAnyData(stage: HeatingCableStage | undefined): boolean {
  if (!stage) return false;
  const hasPhotos = Array.isArray(stage.photos) && stage.photos.some((p) => typeof p === 'string' && p.trim().length > 0);
  return (
    isFilled(stage.resistance_ohm) ||
    isFilled(stage.insulation_mohm) ||
    isFilled(stage.date) ||
    isFilled(stage.performed_by) ||
    isFilled(stage.note) ||
    hasPhotos
  );
}

export function heatingStageIsLocked(stage: HeatingCableStage | undefined): boolean {
  return stage?.step_status === 'locked';
}

function stageStarted(stage: HeatingCableStage | undefined): boolean {
  return heatingStageHasAnyData(stage);
}

/** All required measurement fields present for a stage. */
export function isHeatingCableStageComplete(stage: HeatingCableStage | undefined): boolean {
  if (!stage) return false;
  return (
    isFilled(stage.resistance_ohm) &&
    isFilled(stage.insulation_mohm) &&
    isFilled(stage.date) &&
    isFilled(stage.performed_by)
  );
}

/** Value for `datetime-local` / legacy `date` inputs (local). */
export function formatHeatingCableDatetimeLocalNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Normalize stored date string for HTML `datetime-local` value. */
export function heatingCableDateForDatetimeLocalInput(stored: string | undefined): string {
  if (!stored?.trim()) return '';
  const s = stored.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00`;
  const parsed = Date.parse(s.replace(' ', 'T'));
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return s;
}

/** Normalize stored date string for HTML `date` value. */
export function heatingCableDateForDateInput(stored: string | undefined): string {
  if (!stored?.trim()) return '';
  const s = stored.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  const parsed = Date.parse(s.replace(' ', 'T'));
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return s;
}

/** Compact display for mobile “Performed” row, e.g. `2 May 23:06`. */
export function formatHeatingCablePerformedShort(stored: string | undefined): string {
  if (!stored?.trim()) return '';
  const s = stored.trim();
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00` : s.replace(' ', 'T');
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return s;
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type HeatingCableFocusTarget =
  | { kind: 'main'; key: HeatingCableStageKey }
  | { kind: 'extra'; index: number };

/** First incomplete stage in order: three main stages, then extra steps (visible rows only). */
export function getHeatingCableFocusTarget(doc: HeatingCableDoc): HeatingCableFocusTarget | null {
  const normalized = normalizeHeatingCableDoc(doc);
  for (const { key } of HEATING_CABLE_STAGES) {
    if (!isHeatingCableStageComplete(normalized[key])) return { kind: 'main', key };
  }
  const extras = normalized.extra_steps || [];
  for (let i = 0; i < extras.length; i++) {
    const step = extras[i];
    const visible = heatingStageHasAnyData(step) || Boolean(step.label?.trim());
    if (!visible) continue;
    if (!isHeatingCableStageComplete(step)) return { kind: 'extra', index: i };
  }
  return null;
}

/** Extra checklist rows only appear when they have data or a label. */
export function heatingExtraStepRowVisible(step: HeatingCableStage | undefined): boolean {
  if (!step) return false;
  return heatingStageHasAnyData(step) || Boolean(step.label?.trim());
}

/** Count of fully documented stages vs total stages (fixed three + visible extra steps only). */
export function heatingDocumentationProgress(docRaw: unknown): { complete: number; total: number } {
  const doc = normalizeHeatingCableDoc(docRaw);
  let complete = 0;
  for (const stage of HEATING_CABLE_STAGES) {
    if (isHeatingCableStageComplete(doc[stage.key])) complete++;
  }
  const extras = doc.extra_steps || [];
  let extraTotal = 0;
  for (const raw of extras) {
    const row = normalizeStage(raw);
    if (!heatingExtraStepRowVisible(row)) continue;
    extraTotal++;
    if (isHeatingCableStageComplete(row)) complete++;
  }
  const total = HEATING_CABLE_STAGES.length + extraTotal;
  return { complete, total };
}

export function deriveHeatingCableStatus(docRaw: unknown): HeatingCableDerived {
  const doc = normalizeHeatingCableDoc(docRaw);
  const missingStages: HeatingCableStageKey[] = [];
  let hasStartedAny = false;
  let allComplete = true;
  let hasDeviation = false;
  let hasMissingValues = false;
  const performers: string[] = [];

  for (const stage of HEATING_CABLE_STAGES) {
    const value = doc[stage.key];
    const started = stageStarted(value);
    const complete = isHeatingCableStageComplete(value);
    hasStartedAny = hasStartedAny || started;
    if (!complete) allComplete = false;
    if (!started) missingStages.push(stage.key);
    if (started && !complete) hasMissingValues = true;
    if (isFilled(value?.note)) hasDeviation = true;
    if (isFilled(value?.performed_by)) performers.push(String(value?.performed_by).trim());
  }
  for (const rawStage of doc.extra_steps || []) {
    const value = normalizeStage(rawStage);
    if (!heatingExtraStepRowVisible(value)) continue;
    const started = stageStarted(value);
    const complete = isHeatingCableStageComplete(value);
    hasStartedAny = hasStartedAny || started;
    if (!complete) allComplete = false;
    if (started && !complete) hasMissingValues = true;
    if (isFilled(value?.note)) hasDeviation = true;
    if (isFilled(value?.performed_by)) performers.push(String(value?.performed_by).trim());
  }

  let status: HeatingCableRoomStatus = 'not_started';
  if (hasStartedAny) {
    if (hasDeviation || hasMissingValues) status = 'has_deviation_missing';
    else if (allComplete) status = 'complete';
    else status = 'partial';
  }

  return {
    status,
    missingStages,
    hasDeviation,
    hasMissingValues,
    lastUpdated: isFilled(doc.updated_at) ? String(doc.updated_at) : null,
    performedBy: Array.from(new Set(performers)).join(', '),
  };
}

export function isHeatingCablePhase(phaseKey: string, phaseLabel: string): boolean {
  const k = String(phaseKey || '').toLowerCase();
  const l = String(phaseLabel || '').toLowerCase();
  return (
    k.includes('varmekabel') ||
    l.includes('varmekabel') ||
    (k.includes('heating') && k.includes('cable')) ||
    (l.includes('heating') && l.includes('cable'))
  );
}

/** Stored on `room_photos.caption` to tie uploads to a heating cable stage. */
export const HEATING_CABLE_STAGE_CAPTION_PREFIX = 'hc_stage:';

export function heatingCableStageCaption(stageId: string): string {
  return `${HEATING_CABLE_STAGE_CAPTION_PREFIX}${stageId}`;
}

/** Parses stage id from caption (new prefix or legacy “Heating cable module photo (stageId)”). */
export function parseHeatingCableStageFromCaption(caption: string | null | undefined): string | null {
  if (caption == null || typeof caption !== 'string') return null;
  const s = caption.trim();
  if (s.startsWith(HEATING_CABLE_STAGE_CAPTION_PREFIX)) {
    const rest = s.slice(HEATING_CABLE_STAGE_CAPTION_PREFIX.length);
    const id = rest.split('|')[0]?.trim();
    return id || null;
  }
  const legacy = /^Heating cable module photo \(([^)]+)\)\s*$/.exec(s);
  if (legacy) return legacy[1].trim() || null;
  return null;
}

/** Resolve stored heating photo reference (object key or absolute URL) to a display/download URL. */
export function resolveHeatingCablePhotoDownloadUrl(
  stored: string,
  resolvedPhotos: Array<{ object_key: string; downloadUrl?: string | null }>
): string {
  const trimmed = String(stored || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('blob:')) return trimmed;
  const hit = resolvedPhotos.find((p) => p.object_key === trimmed);
  const u = hit?.downloadUrl;
  return typeof u === 'string' && u.trim() ? u.trim() : '';
}

export type HeatingCableGalleryItem = {
  objectKey: string;
  displayUrl: string;
  photoId?: number;
};

export type HeatingCableGallerySection = {
  stageId: string;
  label: string;
  items: HeatingCableGalleryItem[];
};

function labelForHeatingStageId(doc: HeatingCableDoc, stageId: string): string {
  const main = HEATING_CABLE_STAGES.find((x) => x.key === stageId);
  if (main) return main.label;
  const normalized = normalizeHeatingCableDoc(doc);
  const extras = normalized.extra_steps || [];
  for (let i = 0; i < extras.length; i++) {
    const sid = (extras[i].id && String(extras[i].id).trim()) || `extra-${i}`;
    if (sid === stageId) return extras[i].label?.trim() || `Extra step ${i + 1}`;
  }
  return stageId;
}

function photoCreatedSortKey(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(String(iso).replace(' ', 'T'));
  return Number.isNaN(t) ? 0 : t;
}

/** One grouped gallery below heating stages: doc keys + server captions, URLs from room_photos. */
export function buildHeatingCableGallerySections(
  doc: HeatingCableDoc,
  resolvedPhotos: Array<{
    id: number;
    object_key: string;
    caption?: string | null;
    downloadUrl?: string;
    created_at?: string | null;
  }>
): HeatingCableGallerySection[] {
  const normalized = normalizeHeatingCableDoc(doc);
  const stageKeys = new Map<string, Set<string>>();
  const stageLabels = new Map<string, string>();

  const touchStage = (stageId: string, label: string) => {
    if (!stageKeys.has(stageId)) {
      stageKeys.set(stageId, new Set());
      stageLabels.set(stageId, label);
    }
  };

  const addKey = (stageId: string, label: string, objectKey: string) => {
    const k = objectKey.trim();
    if (!k) return;
    touchStage(stageId, label);
    stageKeys.get(stageId)!.add(k);
  };

  for (const { key, label } of HEATING_CABLE_STAGES) {
    touchStage(key, label);
    for (const ph of normalized[key]?.photos || []) {
      if (typeof ph === 'string' && ph.trim()) addKey(key, label, ph);
    }
  }

  (normalized.extra_steps || []).forEach((step, idx) => {
    const sid = (step.id && String(step.id).trim()) || `extra-${idx}`;
    const label = step.label?.trim() || `Extra step ${idx + 1}`;
    touchStage(sid, label);
    for (const ph of step.photos || []) {
      if (typeof ph === 'string' && ph.trim()) addKey(sid, label, ph);
    }
  });

  for (const p of resolvedPhotos) {
    const st = parseHeatingCableStageFromCaption(p.caption);
    if (!st) continue;
    const label = stageLabels.get(st) || labelForHeatingStageId(doc, st);
    addKey(st, label, p.object_key);
  }

  const meta = new Map<string, { id: number; created: number }>();
  for (const p of resolvedPhotos) {
    meta.set(p.object_key, { id: p.id, created: photoCreatedSortKey(p.created_at ?? null) });
  }

  const sortKeys = (keys: Iterable<string>) =>
    [...keys].sort((a, b) => {
      const ma = meta.get(a)?.created ?? 0;
      const mb = meta.get(b)?.created ?? 0;
      return mb - ma;
    });

  const sections: HeatingCableGallerySection[] = [];
  const emitted = new Set<string>();

  const pushSection = (stageId: string, label: string) => {
    const keys = stageKeys.get(stageId);
    if (!keys || keys.size === 0) return;
    emitted.add(stageId);
    const items: HeatingCableGalleryItem[] = sortKeys(keys).map((objectKey) => ({
      objectKey,
      displayUrl: resolveHeatingCablePhotoDownloadUrl(objectKey, resolvedPhotos),
      photoId: meta.get(objectKey)?.id,
    }));
    sections.push({ stageId, label, items });
  };

  for (const { key, label } of HEATING_CABLE_STAGES) {
    pushSection(key, label);
  }

  (normalized.extra_steps || []).forEach((step, idx) => {
    if (!heatingExtraStepRowVisible(step)) return;
    const sid = (step.id && String(step.id).trim()) || `extra-${idx}`;
    const label = step.label?.trim() || `Extra step ${idx + 1}`;
    pushSection(sid, label);
  });

  for (const stageId of stageKeys.keys()) {
    if (emitted.has(stageId)) continue;
    const keys = stageKeys.get(stageId);
    if (!keys || keys.size === 0) continue;
    pushSection(stageId, stageLabels.get(stageId) || labelForHeatingStageId(doc, stageId));
  }

  return sections;
}
