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
  resistance_ohm?: string;
  insulation_mohm?: string;
  date?: string;
  performed_by?: string;
  note?: string;
}

export interface HeatingCableDoc {
  before_installation?: HeatingCableStage;
  after_cable_laid?: HeatingCableStage;
  after_screed_final?: HeatingCableStage;
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
  return {
    resistance_ohm: typeof row.resistance_ohm === 'string' ? row.resistance_ohm : '',
    insulation_mohm: typeof row.insulation_mohm === 'string' ? row.insulation_mohm : '',
    date: typeof row.date === 'string' ? row.date : '',
    performed_by: typeof row.performed_by === 'string' ? row.performed_by : '',
    note: typeof row.note === 'string' ? row.note : '',
  };
}

export function normalizeHeatingCableDoc(raw: unknown): HeatingCableDoc {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  return {
    before_installation: normalizeStage(row.before_installation),
    after_cable_laid: normalizeStage(row.after_cable_laid),
    after_screed_final: normalizeStage(row.after_screed_final),
    locked_by_admin: row.locked_by_admin === true,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
}

function stageStarted(stage: HeatingCableStage | undefined): boolean {
  if (!stage) return false;
  return (
    isFilled(stage.resistance_ohm) ||
    isFilled(stage.insulation_mohm) ||
    isFilled(stage.date) ||
    isFilled(stage.performed_by) ||
    isFilled(stage.note)
  );
}

function stageComplete(stage: HeatingCableStage | undefined): boolean {
  if (!stage) return false;
  return (
    isFilled(stage.resistance_ohm) &&
    isFilled(stage.insulation_mohm) &&
    isFilled(stage.date) &&
    isFilled(stage.performed_by)
  );
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
    const complete = stageComplete(value);
    hasStartedAny = hasStartedAny || started;
    if (!complete) allComplete = false;
    if (!started) missingStages.push(stage.key);
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
