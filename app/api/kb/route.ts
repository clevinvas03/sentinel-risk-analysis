import { query } from "@/lib/db";
import { embedQuery, toVectorLiteral } from "@/lib/embed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Knowledge-base explorer.
//   GET /api/kb                      -> recent chunks + provenance + KB stats
//   GET /api/kb?q=flood+risk         -> semantic search (same path the agent uses)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  try {
    const stats = await query<{ source: string; documents: number; chunks: number }>(
      `SELECT d.source,
              COUNT(DISTINCT d.id) AS documents,
              COUNT(c.id) AS chunks
       FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
       GROUP BY d.source ORDER BY chunks DESC`
    );

    if (q) {
      const vec = await embedQuery(q);
      const rows = await query(
        `SELECT c.id AS chunk_id, c.text, c.chunk_index,
                d.id AS document_id, d.title, d.url, d.source, d.country, d.published_at,
                1 - (c.embedding <=> $1::vector) AS similarity
         FROM chunks c JOIN documents d ON d.id = c.document_id
         ORDER BY c.embedding <=> $1::vector
         LIMIT 20`,
        [toVectorLiteral(vec)]
      );
      return Response.json({ mode: "search", query: q, stats, results: rows });
    }

    const rows = await query(
      `SELECT c.id AS chunk_id, c.text, c.chunk_index,
              d.id AS document_id, d.title, d.url, d.source, d.country, d.published_at, d.fetched_at
       FROM chunks c JOIN documents d ON d.id = c.document_id
       ORDER BY d.fetched_at DESC, c.chunk_index ASC
       LIMIT 60`
    );
    return Response.json({ mode: "recent", stats, results: rows });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
