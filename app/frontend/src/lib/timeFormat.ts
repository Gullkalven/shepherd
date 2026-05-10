/**
 * Shared timestamp helpers.
 *
 * The app standardises on a Norwegian/European display format
 * (`DD.MM.YYYY HH:MM`, e.g. `09.05.2026 14:32`) for checklist activity,
 * checklist completion events, and related worker-facing timestamps.
 *
 * Construction crews need to know the exact moment something happened —
 * relative phrasing like "2 hours ago" gets ambiguous across long shifts
 * and is unreliable on devices with stale clocks. Using a fixed format
 * keeps timestamps unambiguous and compact enough for mobile.
 */

/**
 * Parse a backend timestamp string into milliseconds since epoch.
 *
 * Backend rows historically emit timestamps as either ISO strings or
 * `YYYY-MM-DD HH:MM:SS` (no timezone). For the latter we treat the value
 * as UTC, matching the pre-existing behaviour in `RoomDetail.tsx`.
 *
 * Returns `0` if the input is missing or unparseable so callers can
 * cheaply check truthiness.
 */
export function parseTimestampMs(s: string | null | undefined): number {
  if (!s) return 0;
  const raw = String(s).trim().replace(' ', 'T');
  if (!raw) return 0;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}Z`;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? 0 : t;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * Format a timestamp as `DD.MM.YYYY HH:MM` in the device's local timezone.
 *
 * Accepts an ISO/SQL string, epoch milliseconds, or a `Date`. Returns
 * `'—'` for missing/invalid input so the UI never renders raw garbage.
 *
 * We format manually (instead of `toLocaleString('nb-NO', …)`) because
 * the Norwegian locale inserts a comma between date and time
 * (`09.05.2026, 14:32`), which we want to omit for compactness.
 */
export function formatTimestamp(
  input: string | number | Date | null | undefined,
): string {
  if (input == null) return '—';
  let ms: number;
  if (input instanceof Date) {
    ms = input.getTime();
  } else if (typeof input === 'number') {
    ms = input;
  } else {
    ms = parseTimestampMs(input);
  }
  if (!ms) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}
