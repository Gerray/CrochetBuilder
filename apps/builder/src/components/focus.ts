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
