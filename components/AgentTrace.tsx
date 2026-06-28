"use client";

import { useEffect, useRef } from "react";
import type { TraceEntry } from "./types";

// A small monochrome glyph per step type — drawn from a restrained set, no emoji.
function glyph(step: string): string {
  const s = step.toLowerCase();
  if (s.includes("knowledge base")) return "◇"; // retrieval
  if (s.includes("web")) return "⬡"; // web
  if (s.includes("reading")) return "▤"; // document
  if (s.includes("geocod")) return "◎"; // location
  if (s.includes("site risk")) return "⊞"; // layers
  if (s.includes("compar")) return "⇌"; // comparison
  if (s.includes("parcel")) return "▢"; // parcel
  if (s.includes("reasoning")) return "∴"; // thinking
  if (s.includes("synthes")) return "✶"; // writing
  if (s.includes("cache")) return "≡";
  return "·";
}

// tint the glyph by domain
function tint(step: string): string {
  const s = step.toLowerCase();
  if (s.includes("knowledge base") || s.includes("cache")) return "text-kb";
  if (s.includes("web") || s.includes("reading")) return "text-web";
  if (s.includes("parcel")) return "text-parcel";
  if (s.includes("synthes")) return "text-signal";
  return "text-fg-faint";
}

export function AgentTrace({
  trace,
  running,
}: {
  trace: TraceEntry[];
  running: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [trace.length]);

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800/40 p-5 shadow-panel">
      <div className="mb-4 flex items-center gap-2">
        <span className="label">agent trace</span>
        <span className="h-px flex-1 bg-ink-700/70" />
        {running && (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-signal pulse-dot" />
            <span className="label text-signal/80">working</span>
          </span>
        )}
      </div>

      {trace.length === 0 ? (
        <p className="text-xs leading-relaxed text-fg-faint">
          The agent chooses its own tools. Each retrieval, web search, and reasoning
          step will stream here in real time.
        </p>
      ) : (
        <ol className="relative space-y-3 pl-1">
          {/* timeline spine */}
          <span className="absolute bottom-1 left-[7px] top-1 w-px bg-ink-700/70" />
          {trace.map((t, i) => (
            <li key={i} className="rise relative flex gap-3">
              <span
                className={`relative z-10 mt-px font-mono text-[0.8rem] leading-none ${tint(
                  t.step
                )}`}
              >
                {glyph(t.step)}
              </span>
              <div className="min-w-0 -mt-[3px]">
                <div className="text-xs leading-snug text-fg">{t.step}</div>
                {t.detail && (
                  <div className="mt-0.5 break-words font-mono text-[0.68rem] leading-snug text-fg-faint">
                    {t.detail}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <div ref={endRef} />
    </div>
  );
}
