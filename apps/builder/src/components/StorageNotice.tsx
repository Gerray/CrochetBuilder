/** Offer the unreadable stored value as a JSON download. */
function downloadBackup(raw: unknown) {
  const blob = new Blob([JSON.stringify(raw, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `crochetbuilder-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface StorageNoticeProps {
  raw: unknown;
  onStartFresh: () => void;
}

/**
 * Shown when the stored document could not be read (older or foreign format, too large).
 * Nothing is saved until the person chooses; the old value stays in a backup either way.
 */
export function StorageNotice({ raw, onStartFresh }: StorageNoticeProps) {
  return (
    <div className="storage-notice" role="alertdialog" aria-labelledby="storage-notice-title" aria-describedby="storage-notice-text">
      <div>
        <strong id="storage-notice-title">Gespeicherte Anleitung konnte nicht gelesen werden.</strong>
        <p id="storage-notice-text">
          Sie stammt vermutlich aus einer anderen Version oder ist beschädigt. Sie wurde gesichert und wird nicht
          überschrieben, bis du entscheidest. Bis dahin wird nichts gespeichert.
        </p>
      </div>
      <div className="storage-notice-actions">
        <button type="button" className="btn" onClick={() => downloadBackup(raw)}>
          Sicherung herunterladen
        </button>
        <button type="button" className="btn btn-primary" onClick={onStartFresh}>
          Neu beginnen
        </button>
      </div>
    </div>
  );
}
