import { useState, type InputHTMLAttributes } from "react";

type BaseInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "step">;

interface NumberFieldProps extends BaseInputProps {
  value: number | undefined;
  /** Called with every valid value while typing; `undefined` for an empty field when allowed. */
  onValue: (value: number | undefined) => void;
  min?: number;
  step?: number;
  decimal?: boolean;
  allowEmpty?: boolean;
}

function formatNumber(value: number | undefined, decimal: boolean): string {
  if (value === undefined) return "";
  return decimal ? String(value).replace(".", ",") : String(value);
}

/**
 * A number input that tolerates intermediate states while typing ("", "3,") and accepts
 * German decimal commas. Valid values are passed on immediately; on blur the field shows
 * the stored value again.
 */
export function NumberField({
  value,
  onValue,
  min = 0,
  step = 1,
  decimal = false,
  allowEmpty = false,
  className,
  onBlur,
  onKeyDown,
  ...rest
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const accept = (n: number) => Number.isFinite(n) && n >= min && (decimal || Number.isInteger(n));
  const parse = (text: string) => Number(text.trim().replace(",", "."));

  // A draft is shown while it is an unfinished entry ("", "3,") or matches the stored value;
  // when the value changed elsewhere (undo, "Soll übernehmen") the stored value wins.
  const draftNumber = draft === null ? undefined : parse(draft);
  const showDraft =
    draft !== null && (draft.trim() === "" || !accept(draftNumber!) || draftNumber === value);

  return (
    <input
      {...rest}
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      className={["number-field", className].filter(Boolean).join(" ")}
      value={showDraft ? draft! : formatNumber(value, decimal)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (text.trim() === "") {
          if (allowEmpty) onValue(undefined);
          return;
        }
        const n = parse(text);
        if (accept(n)) onValue(n);
      }}
      onKeyDown={(e) => {
        if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey) {
          e.preventDefault();
          const base = value ?? min;
          const next = Math.round((base + (e.key === "ArrowUp" ? step : -step)) * 100) / 100;
          if (accept(next)) {
            setDraft(null);
            onValue(next);
          }
        }
        onKeyDown?.(e);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}

interface ListFieldProps extends BaseInputProps {
  value: readonly string[] | undefined;
  onList: (value: string[] | undefined) => void;
}

/** A comma-separated text list ("Rot, Weiß"); empty → undefined. */
export function ListField({ value, onList, onBlur, ...rest }: ListFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...rest}
      type="text"
      value={draft ?? (value ?? []).join(", ")}
      onChange={(e) => {
        setDraft(e.target.value);
        const items = e.target.value
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        onList(items.length > 0 ? items : undefined);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
