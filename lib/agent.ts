import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, AGENT_MODEL, IS_ANTHROPIC } from "./anthropic";
import {
  getToolDefinitions,
  handlers,
  usesNativeWebSearch,
} from "./tools";
import type { Source, ToolContext } from "./tools/types";

const MAX_ITERATIONS = 20;

export const SYSTEM_PROMPT = `You are an expert data centre site risk analyst. You can answer ANY question related to data centre development risk — including flood, seismic, climate, grid/power, cooling, water, planning and permitting, geopolitics, jurisdiction, cost, latency, connectivity, supply chain, labour, and sustainability.

You have tools to search an internal knowledge base of scraped risk intelligence, fetch structured risk data for coordinates, compare sites, and search the live web for anything you don't already know.

Always ground your answers in evidence from your tools. When you use the web or knowledge base, cite your sources. If you genuinely cannot find relevant information after using your tools, say so honestly and explain what you'd need. Never fabricate specific statistics, dates, or place names. When a question is ambiguous, state your interpretation and answer the most useful version of it. You may reason from established domain principles when no specific data exists, but flag clearly when you are doing so.

Strategy guidance (you decide — there is no fixed routing):
- For established domain knowledge, search the knowledge base first; judge relevance by the returned similarity scores.
- If the knowledge base is insufficient, off-topic, or the question needs current/breaking information, use web_search, then fetch_url to read the most useful result in full.
- For a specific location, geocode it then fetch structured site risk data. For comparisons, use compare_sites.
- For questions about land ownership, parcel size, land use/zoning, or campus assembly, use the parcel tools (search_parcels, get_parcel, find_adjacent_parcels). They query LIVE county assessor data. search_parcels checks the match count first — if it reports too many matches, narrow the criteria rather than forcing a large fetch. If a parcel tool returns OFFLINE SAMPLE data (because the live county endpoint was unreachable), explicitly tell the user the parcels are illustrative samples, not current assessor records.
- Keep calling tools until you have enough evidence, then write the answer.
- Do not call the same tool with the same input repeatedly. If a tool reports it is unavailable or returns an error, do NOT keep retrying it — use the information you already have, answer the most useful version of the question, and state the limitation honestly (e.g. that knowledge-base or web sources aren't available here). Always produce a final answer; never give up just because one source is unavailable.
- Cite sources inline as footnote-style markers like [1], [2] that correspond to the sources you actually consulted, and end with the key takeaway.
- If a question is clearly outside data centre site risk (e.g. trivia like "capital of France"), politely say it's outside your domain and offer what you can help with instead — do not fabricate.`;

export type AgentEvent =
  | { type: "trace"; step: string; detail?: string }
  | { type: "thinking"; text: string }
  | { type: "token"; text: string }
  | { type: "answer_reset" }
  | { type: "sources"; sources: Source[] }
  | { type: "done"; answer: string; sources: Source[]; trace: TraceEntry[] }
  | { type: "error"; message: string };

export type TraceEntry = { step: string; detail?: string; at: number };

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    const key =
      s.kind === "kb"
        ? `kb:${s.chunkId}`
        : s.kind === "parcel"
          ? `parcel:${s.county}:${s.apn}`
          : `web:${s.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// Extract trace + sources from the resolved server-side web_search blocks that the
// API already executed (native provider). We read them; we never re-run them.
function ingestServerToolBlocks(
  content: any[],
  ctx: ToolContext
): void {
  for (const block of content) {
    if (block?.type === "server_tool_use" && block?.name === "web_search") {
      const q = block?.input?.query;
      ctx.emitTrace("Searching the web", typeof q === "string" ? q : undefined);
    }
    if (block?.type === "web_search_tool_result") {
      const results = Array.isArray(block.content) ? block.content : [];
      let n = 0;
      for (const r of results) {
        if (r?.type === "web_search_result" && r?.url) {
          ctx.addSource({ kind: "web", title: r.title ?? r.url, url: r.url });
          n++;
        }
      }
      ctx.emitTrace(`Web search returned ${n} ${n === 1 ? "result" : "results"}`);
    }
  }
}

/**
 * Run the open-domain agentic loop. `emit` receives events as they happen so the
 * caller (the SSE route) can stream them to the browser in real time.
 */
export async function runAgent(
  question: string,
  emit: (ev: AgentEvent) => void
): Promise<void> {
  const client = getAnthropic();
  const tools = getToolDefinitions();

  const sources: Source[] = [];
  const trace: TraceEntry[] = [];
  const ctx: ToolContext = {
    emitTrace: (step, detail) => {
      const entry = { step, detail, at: Date.now() };
      trace.push(entry);
      emit({ type: "trace", step, detail });
    },
    addSource: (s) => sources.push(s),
  };

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: question },
  ];

  let finalAnswer = "";
  let announcedSynthesis = false;

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const stream = client.messages.stream({
        model: AGENT_MODEL,
        max_tokens: 8000,
        // Adaptive thinking is Anthropic-only; omit for GLM/other providers.
        ...(IS_ANTHROPIC
          ? { thinking: { type: "adaptive", display: "summarized" } as const }
          : {}),
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      let turnText = "";
      let currentBlock: string | null = null;
      let thinkingBuf = "";

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          currentBlock = (event.content_block as any)?.type ?? null;
          thinkingBuf = "";
        } else if (event.type === "content_block_delta") {
          const d: any = event.delta;
          if (d.type === "text_delta") {
            if (!announcedSynthesis) {
              announcedSynthesis = true;
              ctx.emitTrace("Synthesising answer");
            }
            turnText += d.text;
            emit({ type: "token", text: d.text });
          } else if (d.type === "thinking_delta") {
            thinkingBuf += d.thinking ?? "";
            emit({ type: "thinking", text: d.thinking ?? "" });
          }
        } else if (event.type === "content_block_stop") {
          if (currentBlock === "thinking" && thinkingBuf.trim()) {
            const snip = thinkingBuf.trim().replace(/\s+/g, " ").slice(0, 160);
            trace.push({ step: "Reasoning", detail: snip, at: Date.now() });
            emit({ type: "trace", step: "Reasoning", detail: snip });
          }
          currentBlock = null;
        }
      }

      const msg = await stream.finalMessage();

      // Read server-side web_search blocks for trace + sources (native provider).
      if (usesNativeWebSearch) {
        ingestServerToolBlocks(msg.content as any[], ctx);
      }

      // Preserve the assistant turn (including thinking blocks) for the next call.
      messages.push({ role: "assistant", content: msg.content });

      if (msg.stop_reason === "end_turn") {
        finalAnswer = turnText.trim() ||
          (msg.content as any[])
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("")
            .trim();
        break;
      }

      // This turn's text was narration before a tool call, not the final answer —
      // clear it from the answer pane.
      if (turnText.trim()) {
        emit({ type: "answer_reset" });
      }

      if (msg.stop_reason === "pause_turn") {
        // Native web_search hit its server iteration cap; re-send to resume.
        continue;
      }

      if (msg.stop_reason === "tool_use") {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of msg.content as any[]) {
          if (block.type !== "tool_use") continue;
          const handler = handlers[block.name];
          let resultStr: string;
          if (!handler) {
            resultStr = JSON.stringify({
              error: `no handler for tool '${block.name}'`,
            });
          } else {
            try {
              resultStr = await handler(block.input, ctx);
            } catch (e: any) {
              resultStr = JSON.stringify({
                error: `tool '${block.name}' failed: ${e?.message ?? e}`,
              });
            }
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: resultStr,
          });
        }
        if (toolResults.length === 0) {
          // Nothing to execute and not end_turn — avoid an infinite loop.
          break;
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // Any other stop reason: stop gracefully.
      break;
    }

    if (!finalAnswer) {
      // The loop hit its iteration cap while still calling tools. Rather than give
      // up, force one final synthesis from everything already gathered — no tools,
      // so the model must write the answer.
      ctx.emitTrace("Synthesising final answer", "tool budget reached");
      emit({ type: "answer_reset" });
      messages.push({
        role: "user",
        content:
          "You have reached your tool-call budget — do not call any more tools. Using only " +
          "the information already gathered above, write your best grounded answer to the " +
          "original question now. Cite the sources you actually used and note any limitations.",
      });
      try {
        const finalStream = client.messages.stream({
          model: AGENT_MODEL,
          max_tokens: 8000,
          ...(IS_ANTHROPIC
            ? { thinking: { type: "adaptive", display: "summarized" } as const }
            : {}),
          system: SYSTEM_PROMPT,
          messages,
        });
        let t = "";
        for await (const ev of finalStream) {
          if (
            ev.type === "content_block_delta" &&
            (ev.delta as any).type === "text_delta"
          ) {
            const txt = (ev.delta as any).text as string;
            t += txt;
            emit({ type: "token", text: txt });
          }
        }
        await finalStream.finalMessage();
        finalAnswer = t.trim();
      } catch {
        /* fall through to the canned message */
      }
      if (!finalAnswer) {
        finalAnswer =
          "I gathered relevant data but couldn't compose a full answer in time. Please try rephrasing or narrowing the question.";
        emit({ type: "token", text: finalAnswer });
      }
    }

    const deduped = dedupeSources(sources);
    emit({ type: "sources", sources: deduped });
    emit({ type: "done", answer: finalAnswer, sources: deduped, trace });
  } catch (e: any) {
    emit({ type: "error", message: e?.message ?? String(e) });
  }
}
