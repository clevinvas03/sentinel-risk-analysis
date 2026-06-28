"use client";

import type { Source } from "./types";

const KIND_STYLE: Record<string, { label: string; cls: string }> = {
  kb: { label: "kb", cls: "border-kb/30 bg-kb/10 text-kb" },
  web: { label: "web", cls: "border-web/30 bg-web/10 text-web" },
  parcel: { label: "parcel", cls: "border-parcel/30 bg-parcel/10 text-parcel" },
};

export function SourceList({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;

  return (
    <div className="mt-7 border-t border-ink-700/70 pt-5">
      <div className="label mb-3">sources used · {sources.length}</div>
      <ol className="space-y-2">
        {sources.map((s, i) => {
          const kind =
            s.kind === "parcel" && s.live === false
              ? { label: "parcel·sample", cls: KIND_STYLE.parcel.cls }
              : KIND_STYLE[s.kind] ?? KIND_STYLE.web;
          const tag = s.kind === "kb" ? s.source || "kb" : kind.label;
          return (
            <li
              key={i}
              id={`source-${i + 1}`}
              className="flex scroll-mt-24 items-baseline gap-2.5 text-xs"
            >
              <span className="font-mono text-fg-faint">{String(i + 1).padStart(2, "0")}</span>
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-label ${kind.cls}`}
              >
                {tag}
              </span>
              <span className="text-fg-dim">
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-fg transition-colors hover:text-signal"
                  >
                    {s.title}
                  </a>
                ) : (
                  <span className="text-fg">{s.title}</span>
                )}
                {s.kind === "parcel" && s.apn && (
                  <span className="text-fg-faint"> · APN {s.apn}</span>
                )}
                {typeof s.similarity === "number" && (
                  <span className="text-fg-faint"> · sim {s.similarity.toFixed(2)}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
