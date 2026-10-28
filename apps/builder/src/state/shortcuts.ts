/**
 * Global keyboard shortcuts, decided by the produced character (`key`), not the physical
 * key (`code`): on a German QWERTZ keyboard the key labelled Z sits where QWERTY has Y.
 *
 *   Ctrl/Cmd+Z → undo · Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z → redo · Alt+N → add a row
 *   Alt+↑ / Alt+↓ → previous / next part
 *
 * Alt+↑/↓ is free in browsers (Alt+←/→ is history navigation, Ctrl+PageUp/PageDown switches
 * browser tabs).
 */

export type Shortcut = "undo" | "redo" | "addRow" | "prevPart" | "nextPart";

export interface KeyInfo {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function shortcutFor(e: KeyInfo): Shortcut | null {
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (e.altKey && !mod) {
    // macOS Option+N yields a dead key / "˜" instead of "n" — fall back to the position then.
    const letter = /^[a-z]$/.test(key);
    if (key === "n" || (!letter && e.code === "KeyN")) return "addRow";
    if (e.key === "ArrowUp" && !e.shiftKey) return "prevPart";
    if (e.key === "ArrowDown" && !e.shiftKey) return "nextPart";
    return null;
  }
  if (mod && !e.altKey) {
    if (key === "z") return e.shiftKey ? "redo" : "undo";
    if (key === "y") return "redo";
  }
  return null;
}
