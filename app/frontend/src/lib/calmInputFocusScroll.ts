/**
 * Mobile browsers (especially iOS Safari) often scroll focused text fields toward the vertical
 * center of the layout viewport, which feels like the page is being yanked. After the UA runs
 * its default focus scroll, we apply scrollIntoView with block/inline "nearest" so only the
 * minimum scroll correction remains — the field stays usable above the keyboard without a big jump.
 */

function shouldApplyCalmScroll(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(max-width: 1023.98px)').matches ||
    window.matchMedia('(pointer: coarse)').matches
  );
}

function isTextualField(el: EventTarget | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    if (
      t === 'hidden' ||
      t === 'button' ||
      t === 'submit' ||
      t === 'reset' ||
      t === 'checkbox' ||
      t === 'radio' ||
      t === 'file' ||
      t === 'range' ||
      t === 'image'
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Register a single document-level focusin handler. Returns a cleanup function.
 * Safe to call once from the app shell; idempotent if called multiple times (still use one cleanup).
 */
export function initCalmInputFocusScroll(): () => void {
  const onFocusIn = (ev: FocusEvent) => {
    if (!shouldApplyCalmScroll()) return;
    const target = ev.target;
    if (!isTextualField(target)) return;

    const el = target;
    const run = () => {
      el.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'auto',
      });
    };
    // Run after the browser’s default focus scroll so "nearest" can correct over-scrolling.
    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  };

  document.addEventListener('focusin', onFocusIn, false);
  return () => document.removeEventListener('focusin', onFocusIn, false);
}
