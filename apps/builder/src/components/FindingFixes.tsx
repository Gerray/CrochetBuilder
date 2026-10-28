import type { QuickFix } from "../state/quickfix.js";

interface FindingFixesProps {
  fixes: readonly QuickFix[];
  onApply: (fix: QuickFix) => void;
}

/** One-click fixes next to a finding (each one undo step). */
export function FindingFixes({ fixes, onApply }: FindingFixesProps) {
  if (fixes.length === 0) return null;
  return (
    <span className="finding-fixes">
      {fixes.map((fix) => (
        <button
          key={fix.label}
          type="button"
          className="btn btn-small finding-fix"
          title={`${fix.title} – rückgängig mit Strg+Z`}
          onClick={() => onApply(fix)}
        >
          {fix.label}
        </button>
      ))}
    </span>
  );
}
