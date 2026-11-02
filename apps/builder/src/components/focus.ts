/**
 * Focus the first enabled element among `[data-focus-id]` candidates after React rendered
 * the current update — used when the focused control disappears or becomes disabled
 * (deleting, moving to the first/last place), so focus never falls back to <body>.
 */
export function focusLater(...ids: string[]): void {
  setTimeout(() => {
    for (const id of ids) {
      const quoted = id.replace(/["\\]/g, "\\$&");
      const el = document.querySelector<HTMLElement>(`[data-focus-id="${quoted}"]`);
      if (el && !(el as HTMLButtonElement).disabled) {
        el.focus();
        return;
      }
    }
  }, 0);
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea, select, summary, a[href]";

/** Keep Tab inside a modal: from its last element to the first and back, and into it from outside. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault: () => void }, root: HTMLElement): void {
  if (e.key !== "Tab") return;
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (!active || active === root || !root.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}
