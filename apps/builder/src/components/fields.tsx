import { useState, type InputHTMLAttributes, type Ref } from "react";

type BaseInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "step">;

interface NumberFieldProps extends BaseInputProps {
  value: number | undefined;
  /** Called with every valid value while typing; `undefined` for an empty field when allowed. */
  onValue: (value: number | undefined) => void;
  min?: number;
  /** Largest accepted value; larger entries are shown as invalid and not passed on. */
  max?: number;
  step?: number;
  decimal?: boolean;
  allowEmpty?: boolean;
  inputRef?: Ref<HTMLInputElement>;
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
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  decimal = false,
  allowEmpty = false,
  className,
  onBlur,
  onKeyDown,
  inputRef,
  ...rest
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const accept = (n: number) => Number.isFinite(n) && n >= min && n <= max && (decimal || Number.isInteger(n));
  // Plain digits only ("1e9", "0x10", "Infinity" are not numbers here).
  const pattern = decimal ? /^\d+([.,]\d*)?$/ : /^\d+$/;
  const parse = (text: string) => (pattern.test(text.trim()) ? Number(text.trim().replace(",", ".")) : Number.NaN);

  // A draft is shown while it is an unfinished entry ("", "3,") or matches the stored value;
  // when the value changed elsewhere (undo, "Soll übernehmen") the stored value wins.
  const draftNumber = draft === null ? undefined : parse(draft);
  const showDraft =
    draft !== null && (draft.trim() === "" || !accept(draftNumber!) || draftNumber === value);
  const invalid = draft !== null && draft.trim() !== "" && !accept(draftNumber!);

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      aria-invalid={invalid ? true : undefined}
      title={invalid ? `Erlaubt: ${min} bis ${max.toLocaleString("de-DE")}` : rest.title}
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
