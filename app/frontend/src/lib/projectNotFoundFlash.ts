/** One-shot message on project overview after a bad /project/:id was cleared. */
export const FLASH_PROJECT_NOT_FOUND_KEY = 'shepherd_flash_project_not_found';

export function flashProjectNotFoundOnce(): void {
  try {
    if (sessionStorage.getItem(FLASH_PROJECT_NOT_FOUND_KEY) === '1') return;
    sessionStorage.setItem(FLASH_PROJECT_NOT_FOUND_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function consumeProjectNotFoundFlash(): boolean {
  try {
    if (sessionStorage.getItem(FLASH_PROJECT_NOT_FOUND_KEY) === '1') {
      sessionStorage.removeItem(FLASH_PROJECT_NOT_FOUND_KEY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
