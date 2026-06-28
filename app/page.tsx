"use client";

import { useCallback, useRef, useState } from "react";
import { ExamplePills } from "@/components/ExamplePills";
import { AgentTrace } from "@/components/AgentTrace";
import { AnswerStream } from "@/components/AnswerStream";
import { SourceList } from "@/components/SourceList";
import type { AgentEvent, Source, TraceEntry } from "@/components/types";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(
    async (q: string) => {
      if (!q.trim() || running) return;
      setRunning(true);
      setStarted(true);
      setError(null);
      setAnswer("");
      setTrace([]);
      setSources([]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const msg = await res.text().catch(() => "");
          throw new Error(msg || `request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            const payload = dataLine.slice(6);
            if (!payload.trim() || payload === "{}") continue;
            try {
              handleEvent(JSON.parse(payload));
            } catch {
              /* ignore partial frame */
            }
          }
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") setError(e?.message ?? String(e));
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [running]
  );

  function handleEvent(ev: AgentEvent) {
    switch (ev.type) {
      case "trace":
        setTrace((t) => [...t, { step: ev.step, detail: ev.detail }]);
        break;
      case "token":
        setAnswer((a) => a + ev.text);
        break;
      case "answer_reset":
        setAnswer("");
        break;
      case "sources":
      case "done":
        setSources(ev.sources);
        break;
      case "error":
        setError(ev.message);
        break;
    }
  }

  return (
    <div>
      {/* Hero */}
      <section className="mb-9">
        <p className="label mb-3">Data centre site-risk analyst · agentic</p>
        <h1 className="max-w-3xl font-display text-[2.1rem] font-medium leading-[1.12] tracking-tight text-fg">
          Ask anything about{" "}
          <span className="text-signal">data centre site risk</span>.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-dim">
          One open-domain agent — no fixed questions, no routing. It decides which
          tools to use (internal knowledge base, structured site risk, geocoding,
          parcels, comparison, live web) and shows every step of its reasoning.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="mt-6"
        >
          <div className="group relative flex items-center rounded-xl border border-ink-700 bg-ink-800/70 shadow-panel transition focus-within:border-signal/60 focus-within:shadow-focus">
            <span className="pl-4 pr-1 font-mono text-signal/80 select-none">›</span>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What's the flood risk for a site near Frankfurt — and how is it changing?"
              className="flex-1 bg-transparent px-2 py-4 font-mono text-sm text-fg placeholder:text-fg-faint focus:outline-none"
            />
            <button
              type="submit"
              disabled={running || !question.trim()}
              className="m-1.5 rounded-lg bg-signal px-5 py-2.5 text-sm font-semibold text-ink-900 transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-fg-faint"
            >
              {running ? "Analysing…" : "Analyse"}
            </button>
          </div>
          <ExamplePills onPick={setQuestion} />
        </form>
      </section>

      {error && (
        <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          <span className="label mr-2 text-red-400/80">error</span>
          {error}
        </div>
      )}

      {/* Console */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="min-h-[16rem] rounded-xl border border-ink-700 bg-ink-800/40 p-6 shadow-panel">
          <div className="label mb-4 flex items-center gap-2">
            <span>analysis</span>
            <span className="h-px flex-1 bg-ink-700/70" />
          </div>
          {!started ? (
            <EmptyState />
          ) : (
            <>
              <AnswerStream text={answer} streaming={running} />
              <SourceList sources={sources} />
            </>
          )}
        </div>

        <div className="lg:sticky lg:top-20">
          <AgentTrace trace={trace} running={running} />
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-3 py-6 text-sm text-fg-faint">
      <p className="max-w-md leading-relaxed">
        Pose a question above. The grounded answer streams here as the agent works;
        its tool calls and reasoning appear in the trace on the right, and every
        source it actually consulted is cited below.
      </p>
    </div>
  );
}
