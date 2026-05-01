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
  resistance_ohm?: string;
  insulation_mohm?: string;
  date?: string;
  performed_by?: string;
  note?: string;
  photos?: string[];
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
  const photosRaw = Array.isArray(row.photos) ? row.photos : [];
  return {
    id: typeof row.id === 'string' ? row.id : '',
    label: typeof row.label === 'string' ? row.label : '',
    resistance_ohm: typeof row.resistance_ohm === 'string' ? row.resistance_ohm : '',
    insulation_mohm: typeof row.insulation_mohm === 'string' ? row.insulation_mohm : '',
    date: typeof row.date === 'string' ? row.date : '',
    performed_by: typeof row.performed_by === 'string' ? row.performed_by : '',
    note: typeof row.note === 'string' ? row.note : '',
    photos: photosRaw.filter((p) => typeof p === 'string').map((p) => String(p)),
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

/** Count of fully documented stages vs total stages (fixed three + any extra steps). */
export function heatingDocumentationProgress(docRaw: unknown): { complete: number; total: number } {
  const doc = normalizeHeatingCableDoc(docRaw);
  let complete = 0;
  for (const stage of HEATING_CABLE_STAGES) {
    if (isHeatingCableStageComplete(doc[stage.key])) complete++;
  }
  const extras = doc.extra_steps || [];
  for (const raw of extras) {
    if (isHeatingCableStageComplete(normalizeStage(raw))) complete++;
  }
  const total = HEATING_CABLE_STAGES.length + extras.length;
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
