import { useRef, useState, type ReactNode } from "react";

const MIN = 0.3;
const MAX = 0.75;
const STORAGE_KEY = "crochetbuilder:split";

function readRatio(): number {
  try {
    const n = Number(globalThis.localStorage?.getItem(STORAGE_KEY));
    return Number.isFinite(n) && n >= MIN && n <= MAX ? n : 0.5;
  } catch {
    return 0.5;
  }
}

function writeRatio(ratio: number) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(ratio));
  } catch {
    // ignore (private mode)
  }
}

const clamp = (r: number) => Math.min(MAX, Math.max(MIN, r));

/** Two panes side by side with a draggable, keyboard-operable divider (50/50 by default). */
export function SplitPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  const [ratio, setRatio] = useState(readRatio);
  const container = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = (r: number) => {
    const next = clamp(r);
    setRatio(next);
    writeRatio(next);
  };

  return (
    <div className="split" ref={container} style={{ ["--split" as string]: `${ratio * 100}%` }}>
      <div className="split-left">{left}</div>
      <div
        className="split-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Breite der Bereiche"
        aria-valuemin={MIN * 100}
        aria-valuemax={MAX * 100}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragging.current || !container.current) return;
          const rect = container.current.getBoundingClientRect();
          if (rect.width > 0) update((e.clientX - rect.left) / rect.width);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onDoubleClick={() => update(0.5)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") update(ratio - 0.05);
          else if (e.key === "ArrowRight") update(ratio + 0.05);
          else if (e.key === "Home") update(MIN);
          else if (e.key === "End") update(MAX);
          else return;
          e.preventDefault();
        }}
      />
      <div className="split-right">{right}</div>
    </div>
  );
}
