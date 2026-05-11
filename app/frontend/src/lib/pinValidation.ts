/** Norwegian validation copy for site worker PINs (exactly six digits when creating or changing). */

export const PIN_ERROR_MUST_BE_SIX_NO = 'PIN-koden må være 6 siffer';
export const PIN_ERROR_DIGITS_ONLY_NO = 'PIN-koden kan kun inneholde tall';

const DIGITS_ONLY = /^[0-9]+$/;

export type PinValidationResult =
  | { ok: true; pin: string }
  | { ok: false; message: string };

/** New or updated worker PIN: exactly six numeric digits. */
export function validateNewSixDigitPin(pin: string): PinValidationResult {
  const p = pin.trim();
  if (!DIGITS_ONLY.test(p)) {
    return { ok: false, message: PIN_ERROR_DIGITS_ONLY_NO };
  }
  if (p.length !== 6) {
    return { ok: false, message: PIN_ERROR_MUST_BE_SIX_NO };
  }
  return { ok: true, pin: p };
}

/** Montør login: digits only, length 4–6 (legacy stored PINs). */
export function validateWorkerLoginPinInput(pin: string): PinValidationResult {
  const p = pin.trim();
  if (!p) {
    return { ok: false, message: PIN_ERROR_MUST_BE_SIX_NO };
  }
  if (!DIGITS_ONLY.test(p)) {
    return { ok: false, message: PIN_ERROR_DIGITS_ONLY_NO };
  }
  if (p.length < 4 || p.length > 6) {
    return { ok: false, message: PIN_ERROR_MUST_BE_SIX_NO };
  }
  return { ok: true, pin: p };
}
