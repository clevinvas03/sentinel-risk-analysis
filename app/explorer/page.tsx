"use client";

import { useEffect, useState } from "react";

type Stat = { source: string; documents: string; chunks: string };
type Chunk = {
  chunk_id: number;
  document_id: number;
  chunk_index: number;
  text: string;
  title: string;
  url: string | null;
  source: string;
  country: string | null;
  published_at: string | null;
  similarity?: number;
};

export default function Explorer() {
  const [stats, setStats] = useState<Stat[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"recent" | "search">("recent");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(query?: string) {
    setLoading(true);
    setErr(null);
    try {
      const url = query ? `/api/kb?q=${encodeURIComponent(query)}` : "/api/kb";
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStats(data.stats ?? []);
      setChunks(data.results ?? []);
      setMode(data.mode);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <p className="label mb-3">internal corpus · pgvector</p>
      <h1 className="font-display text-[1.6rem] font-medium tracking-tight text-fg">
        Knowledge base
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
        The scraped &amp; curated corpus that gives the agent depth. Search runs the
        same cosine-similarity vector query the agent uses — provenance and per-chunk
        similarity are shown so retrieval is fully transparent.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {stats.map((s) => (
          <span
            key={s.source}
            className="rounded-full border border-ink-700 px-3 py-1 text-xs text-fg-dim"
          >
            <span className="font-mono text-fg">{s.source}</span> · {s.documents} docs
            · {s.chunks} chunks
          </span>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          q.trim() ? load(q) : load();
        }}
        className="mt-5 flex gap-2"
      >
        <div className="flex flex-1 items-center rounded-xl border border-ink-700 bg-ink-800/70 transition focus-within:border-signal/60 focus-within:shadow-focus">
          <span className="pl-4 pr-1 font-mono text-signal/80">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Semantic search — e.g. submarine cable chokepoints"
            className="flex-1 bg-transparent px-2 py-3 font-mono text-sm text-fg placeholder:text-fg-faint focus:outline-none"
          />
        </div>
        <button className="rounded-xl border border-ink-700 px-4 text-sm text-fg-dim transition hover:border-signal/50 hover:text-fg">
          Search
        </button>
        {mode === "search" && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              load();
            }}
            className="px-2 text-sm text-fg-faint hover:text-fg-dim"
          >
            clear
          </button>
        )}
      </form>

      {err && <p className="mt-4 text-sm text-red-300">{err}</p>}
      {loading && <p className="label mt-4">loading…</p>}

      <div className="mt-5 space-y-3">
        {chunks.map((c) => (
          <div
            key={c.chunk_id}
            className="rise rounded-xl border border-ink-700 bg-ink-800/40 p-4 shadow-panel"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded border border-kb/30 bg-kb/10 px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-label text-kb">
                {c.source}
              </span>
              <span className="font-medium text-fg">{c.title}</span>
              {c.country && <span className="text-fg-faint">· {c.country}</span>}
              <span className="text-fg-faint">· chunk {c.chunk_index}</span>
              {typeof c.similarity === "number" && (
                <span className="ml-auto font-mono text-signal">
                  {Number(c.similarity).toFixed(3)}
                </span>
              )}
            </div>
            <p className="text-[0.82rem] leading-relaxed text-fg-dim">
              {c.text.length > 420 ? c.text.slice(0, 420) + "…" : c.text}
            </p>
            {c.url && (
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block break-all font-mono text-[0.7rem] text-signal/80 hover:text-signal"
              >
                {c.url}
              </a>
            )}
          </div>
        ))}
        {!loading && chunks.length === 0 && (
          <p className="text-sm text-fg-faint">
            No chunks yet. Run <code className="font-mono text-signal">python seed.py</code>{" "}
            and <code className="font-mono text-signal">python scrape.py</code> to
            populate the knowledge base.
          </p>
        )}
      </div>
    </div>
  );
}
