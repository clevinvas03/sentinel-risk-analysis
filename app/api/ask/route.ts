import { runAgent, type AgentEvent } from "@/lib/agent";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST { question } -> Server-Sent Events stream of agent trace + answer tokens.
export async function POST(req: Request) {
  let question = "";
  try {
    const body = await req.json();
    question = String(body?.question ?? "").trim();
  } catch {
    /* fall through to validation */
  }

  if (!question) {
    return new Response(JSON.stringify({ error: "question is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };

      let answer = "";
      let sources: AgentEvent extends { sources: infer S } ? S : any = [];
      let trace: any[] = [];

      await runAgent(question, (ev) => {
        if (ev.type === "done") {
          answer = ev.answer;
          sources = ev.sources as any;
          trace = ev.trace;
        }
        send(ev);
      });

      // Persist the assessment (best-effort; never block the response on it).
      try {
        await query(
          `INSERT INTO assessments (question, answer, trace, sources)
           VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
          [question, answer, JSON.stringify(trace), JSON.stringify(sources)]
        );
      } catch (e) {
        console.error("Failed to persist assessment:", e);
      }

      controller.enqueue(encoder.encode(`event: end\ndata: {}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
