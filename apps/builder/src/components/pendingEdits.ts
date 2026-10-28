/**
 * Fields that hold typed but not yet committed text (a row's free text, a part's name)
 * register here. Before the editor swaps the rows in view (another part, a new or copied
 * part) it commits them all; a text that cannot be read stops the switch, keeps its error
 * and gets the focus back — nothing typed is lost silently.
 */

export interface PendingEdit {
  /** Commit the field's draft (no-op without one); false if the text cannot be read. */
  commit: () => boolean;
  focus: () => void;
}

const pending = new Set<PendingEdit>();

/** Register a field; returns the function that removes it again. */
export function registerPendingEdit(edit: PendingEdit): () => void {
  pending.add(edit);
  return () => {
    pending.delete(edit);
  };
}

/** Commit every registered field. False, with the focus in the first unreadable one, if any fails. */
export function commitPendingEdits(): boolean {
  for (const edit of [...pending]) {
    if (!edit.commit()) {
      edit.focus();
      return false;
    }
  }
  return true;
}
