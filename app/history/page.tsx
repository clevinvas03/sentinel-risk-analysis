"use client";

import { useEffect, useState } from "react";
import type { Source, TraceEntry } from "@/components/types";

type Assessment = {
  id: number;
  question: string;
  answer: string;
  trace: TraceEntry[];
  sources: Source[];
  created_at: string;
};

export default function History() {
  const [items, setItems] = useState<Assessment[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/history");
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setItems(data.assessments ?? []);
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <p className="label mb-3">persisted runs</p>
      <h1 className="font-display text-[1.6rem] font-medium tracking-tight text-fg">
        Assessment history
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
        Every run is saved with its full agent trace and the sources actually
        consulted.
      </p>

      {err && <p className="mt-4 text-sm text-red-300">{err}</p>}
      {loading && <p className="label mt-4">loading…</p>}

      <div className="mt-5 space-y-2.5">
        {items.map((a) => {
          const isOpen = open === a.id;
          return (
            <div
              key={a.id}
              className="overflow-hidden rounded-xl border border-ink-700 bg-ink-800/40 shadow-panel"
            >
              <button
                onClick={() => setOpen(isOpen ? null : a.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="font-mono text-xs text-signal/80">
                  {isOpen ? "▾" : "▸"}
                </span>
                <span className="flex-1 text-sm text-fg">{a.question}</span>
                <span className="font-mono text-[0.68rem] text-fg-faint">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </button>

              {isOpen && (
                <div className="space-y-4 border-t border-ink-700/70 px-4 py-4">
                  <div>
                    <div className="label mb-1.5">answer</div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-dim">
                      {a.answer}
                    </p>
                  </div>

                  {a.trace?.length > 0 && (
                    <div>
                      <div className="label mb-1.5">trace</div>
                      <ol className="space-y-1">
                        {a.trace.map((t, i) => (
                          <li key={i} className="text-xs text-fg-dim">
                            <span className="text-fg-faint">·</span> {t.step}
                            {t.detail && (
                              <span className="font-mono text-fg-faint"> — {t.detail}</span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {a.sources?.length > 0 && (
                    <div>
                      <div className="label mb-1.5">sources · {a.sources.length}</div>
                      <ol className="space-y-1">
                        {a.sources.map((s, i) => (
                          <li key={i} className="text-xs">
                            <span className="font-mono text-fg-faint">
                              {String(i + 1).padStart(2, "0")}
                            </span>{" "}
                            <span className="font-mono text-[0.6rem] uppercase tracking-label text-fg-faint">
                              {s.kind === "kb" ? s.source || "kb" : s.kind}
                            </span>{" "}
                            {s.url ? (
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noreferrer"
                                className="break-all text-fg transition-colors hover:text-signal"
                              >
                                {s.title}
                              </a>
                            ) : (
                              <span className="text-fg">{s.title}</span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!loading && items.length === 0 && (
          <p className="text-sm text-fg-faint">
            No assessments yet — ask a question on the Terminal page.
          </p>
        )}
      </div>
    </div>
  );
}
