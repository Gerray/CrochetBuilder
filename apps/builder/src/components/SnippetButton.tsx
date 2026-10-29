import { useEffect, useMemo, useRef, useState } from "react";
import type { Row } from "@crochetbuilder/engine";
import type { RoundSpec } from "../state/rounds.js";
import {
  MAX_BRIDGE,
  MAX_OVAL_CHAIN,
  MAX_OVAL_INCREASES,
  MAX_SNIPPET_ROUNDS,
  MAX_SNIPPET_STITCHES,
  RING_SNIPPETS,
  ROUND_ONLY_SNIPPETS,
  SNIPPETS,
  defaultLegs,
  legChoices,
  snippetRounds,
  snippetSummary,
  type SnippetKind,
  type SnippetParams,
} from "../state/snippets.js";
import { NumberField } from "./fields.js";
import { useJoinParts } from "./joinParts.js";

interface SnippetButtonProps {
  /** Stitches of the row the snippet is inserted after (undefined: none yet). */
  currentCount: number | undefined;
  /** Where it goes, for the popover text ("nach Runde 4", "am Ende"). */
  placeText: string;
  /** How the piece is worked at the insertion point (rows get a turning chain, no ring). */
  type: Row["type"];
  onInsert: (rounds: RoundSpec[]) => void;
}

const SIZES = [18, 24, 30, 36, 42];
const CHAINS = [5, 7, 9, 11];
const KINDS_WITH_MAX: readonly SnippetKind[] = ["ballStart", "sphere", "tube"];

/** Why a snippet does not fit a piece worked in rows (shown muted there). */
const notForRows = (kind: SnippetKind) =>
  RING_SNIPPETS.includes(kind) ? "beginnt mit einem Magischen Ring" : "wird in Runden um die Kette gehäkelt";

/**
 * "+ Baustein": a small popover with typical runs of rounds (ball start, even rounds,
 * decreases, sphere, tube, oval start) inserted after the current row as one undo step.
 */
export function SnippetButton({ currentCount, placeText, type, onInsert }: SnippetButtonProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SnippetKind>("ballStart");
  const [params, setParams] = useState<SnippetParams>({ max: 36, rounds: 4, min: 6, chain: 7, increases: 2, bridge: 3, legA: "", legB: "" });
  const joins = useJoinParts();
  const legs = useMemo(() => legChoices(joins.parts), [joins.parts]);
  const legDefaults = defaultLegs(legs);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const firstKind = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstKind.current?.focus({ preventScroll: true });
    // The button sits at the end of the list: bring the whole popover into view.
    wrap.current?.querySelector(".popover")?.scrollIntoView?.({ block: "nearest" });
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const result = useMemo(() => snippetRounds(kind, params, currentCount, type, joins.parts), [kind, params, currentCount, type, joins.parts]);
  const set = (patch: Partial<SnippetParams>) => setParams((p) => ({ ...p, ...patch }));
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const insert = () => {
    if (!result.ok) return;
    setOpen(false);
    onInsert(result.rounds);
  };

  return (
    <div className="popover-anchor" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Typische Rundenfolgen einfügen: Kugelanfang, gerade Runden, Abnahmen, Kugel, Röhre, ovaler Anfang"
        onClick={() => {
          // In a piece worked in rows the round snippets do not apply: start with even rows.
          if (!open && type === "row" && ROUND_ONLY_SNIPPETS.includes(kind)) setKind("even");
          setOpen((o) => !o);
        }}
      >
        + Baustein
      </button>
      {open && (
        <div
          className="popover snippet-popover"
          role="dialog"
          aria-label="Baustein einfügen"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
              e.preventDefault();
              insert();
            }
          }}
        >
          <div className="segmented segmented-small snippet-kinds" role="radiogroup" aria-label="Baustein">
            {SNIPPETS.map((s, i) => (
              <button
                key={s.kind}
                ref={i === 0 ? firstKind : undefined}
                type="button"
                role="radio"
                aria-checked={kind === s.kind}
                // Shown muted in a piece worked in rows; a click still explains why it does not fit.
                className={`snippet-kind${type === "row" && ROUND_ONLY_SNIPPETS.includes(s.kind) ? " is-unavailable" : ""}`}
                aria-disabled={type === "row" && ROUND_ONLY_SNIPPETS.includes(s.kind) ? true : undefined}
                title={
                  type === "row" && ROUND_ONLY_SNIPPETS.includes(s.kind)
                    ? `${s.description} – nicht für Teile in Reihen (${notForRows(s.kind)})`
                    : s.description
                }
                onClick={() => setKind(s.kind)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="popover-hint">{SNIPPETS.find((s) => s.kind === kind)?.description}.</p>

          <div className="snippet-params">
            {KINDS_WITH_MAX.includes(kind) && (
              <div className="snippet-param">
                <span className="snippet-param-label">Bis</span>
                <div className="snippet-sizes" role="group" aria-label="Maschenzahl wählen">
                  {SIZES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="btn btn-small"
                      aria-pressed={params.max === n}
                      onClick={() => set({ max: n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <NumberField
                  className="narrow"
                  aria-label="Maschenzahl"
                  min={1}
                  max={MAX_SNIPPET_STITCHES}
                  value={params.max}
                  onValue={(max) => max !== undefined && set({ max })}
                />
                <span className="unit">M</span>
              </div>
            )}
            {kind === "decreaseTo" && (
              <div className="snippet-param">
                <span className="snippet-param-label">Bis</span>
                <div className="snippet-sizes" role="group" aria-label="Ziel wählen">
                  {[6, 12, 18].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="btn btn-small"
                      aria-pressed={params.min === n}
                      onClick={() => set({ min: n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <NumberField
                  className="narrow"
                  aria-label="Ziel-Maschenzahl"
                  min={1}
                  max={MAX_SNIPPET_STITCHES}
                  value={params.min}
                  onValue={(min) => min !== undefined && set({ min })}
                />
                <span className="unit">M</span>
              </div>
            )}
            {kind === "oval" && (
              <>
                <div className="snippet-param">
                  <span className="snippet-param-label">Kette</span>
                  <div className="snippet-sizes" role="group" aria-label="Luftmaschen wählen">
                    {CHAINS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="btn btn-small"
                        aria-pressed={params.chain === n}
                        onClick={() => set({ chain: n })}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <NumberField
                    className="narrow"
                    aria-label="Luftmaschen der Kette"
                    min={1}
                    max={MAX_OVAL_CHAIN}
                    value={params.chain}
                    onValue={(chain) => chain !== undefined && set({ chain })}
                  />
                  <span className="unit">Lm</span>
                </div>
                <label className="snippet-param">
                  <span className="snippet-param-label">Dann</span>
                  <NumberField
                    className="narrow"
                    aria-label="Anzahl Zunahmerunden"
                    min={0}
                    max={MAX_OVAL_INCREASES}
                    value={params.increases}
                    onValue={(increases) => increases !== undefined && set({ increases })}
                  />
                  <span className="unit">Zunahmerunden (je 3 Zun an beiden Enden)</span>
                </label>
              </>
            )}
            {kind === "joinLegs" && legs.length >= 2 && (
              <>
                {(["legA", "legB"] as const).map((which, i) => (
                  <label key={which} className="snippet-param">
                    <span className="snippet-param-label">{i === 0 ? "Erstes" : "Zweites"}</span>
                    <select
                      aria-label={i === 0 ? "Erstes Bein" : "Zweites Bein"}
                      value={params[which] || legDefaults?.[i] || ""}
                      onChange={(e) => set({ [which]: e.target.value })}
                    >
                      {legs.map((leg) => (
                        <option key={leg.key} value={leg.key}>
                          {leg.label} ({leg.count} M)
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label className="snippet-param">
                  <span className="snippet-param-label">Brücke</span>
                  <NumberField
                    className="narrow"
                    aria-label="Luftmaschen der Brücke"
                    min={1}
                    max={MAX_BRIDGE}
                    value={params.bridge}
                    onValue={(bridge) => bridge !== undefined && set({ bridge })}
                  />
                  <span className="unit">Lm zwischen den Beinen</span>
                </label>
              </>
            )}
            {(kind === "even" || kind === "tube") && (
              <label className="snippet-param">
                <span className="snippet-param-label">{kind === "tube" ? "Dann" : "Anzahl"}</span>
                <NumberField
                  className="narrow"
                  aria-label="Anzahl gerader Runden"
                  min={1}
                  max={MAX_SNIPPET_ROUNDS}
                  value={params.rounds}
                  onValue={(rounds) => rounds !== undefined && set({ rounds })}
                />
                <span className="unit">
                  {type === "row" ? "gerade Reihen" : "gerade Runden"}
                  {kind === "even" && currentCount ? ` mit ${currentCount} M` : ""}
                </span>
              </label>
            )}
          </div>

          <div className="snippet-footer">
            <span className={result.ok ? "snippet-summary" : "snippet-problem"} role="status">
              {result.ok ? `${snippetSummary(result.rounds, type)} · ${placeText}` : result.message}
            </span>
            <button type="button" className="btn btn-small btn-primary" disabled={!result.ok} onClick={insert}>
              Einfügen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
