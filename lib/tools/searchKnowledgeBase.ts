import { query } from "../db";
import { embedQuery, toVectorLiteral } from "../embed";
import type { ToolHandler } from "./types";

type Row = {
  chunk_id: number;
  document_id: number;
  text: string;
  title: string;
  url: string | null;
  source: string;
  country: string | null;
  published_at: string | null;
  similarity: number;
};

// TOOL 1 — semantic search over the internal scraped/seeded knowledge base.
// The agent decides whether to pass the optional country/source/date filters; we
// never apply them automatically. We return similarity scores so the *model* can
// judge whether the KB is relevant enough or whether it should reach for the web.
export const searchKnowledgeBase: ToolHandler = async (input, ctx) => {
  const q: string = String(input?.query ?? "").trim();
  if (!q) return JSON.stringify({ error: "query is required" });

  const k = Math.min(Math.max(Number(input?.k) || 6, 1), 12);
  const country: string | undefined = input?.country?.trim() || undefined;
  const source: string | undefined = input?.source?.trim() || undefined;
  const dateFrom: string | undefined = input?.date_from?.trim() || undefined;

  ctx.emitTrace("Searching knowledge base", q);

  const vec = await embedQuery(q);

  const where: string[] = [];
  const params: unknown[] = [toVectorLiteral(vec)];
  if (country) {
    params.push(country);
    where.push(`d.country ILIKE '%' || $${params.length} || '%'`);
  }
  if (source) {
    params.push(source);
    where.push(`d.source = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    where.push(`d.published_at >= $${params.length}`);
  }
  params.push(k);

  const sql = `
    SELECT c.id AS chunk_id, c.document_id, c.text,
           d.title, d.url, d.source, d.country, d.published_at,
           1 - (c.embedding <=> $1::vector) AS similarity
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY c.embedding <=> $1::vector
    LIMIT $${params.length}
  `;

  let rows: Row[];
  try {
    rows = await query<Row>(sql, params);
  } catch (e: any) {
    return JSON.stringify({
      error: `knowledge base query failed: ${e?.message ?? e}`,
    });
  }

  if (rows.length === 0) {
    ctx.emitTrace("Knowledge base returned no results");
    return JSON.stringify({
      results: [],
      note: "No matching documents in the internal knowledge base. Consider web_search.",
    });
  }

  const top = rows[0].similarity;
  ctx.emitTrace(
    `Found ${rows.length} KB ${rows.length === 1 ? "result" : "results"}`,
    `top similarity ${top.toFixed(2)}`
  );

  // Register every consulted chunk as a source for citation/provenance.
  for (const r of rows) {
    ctx.addSource({
      kind: "kb",
      title: r.title,
      url: r.url,
      chunkId: r.chunk_id,
      source: r.source,
      similarity: Number(r.similarity.toFixed(3)),
    });
  }

  return JSON.stringify({
    results: rows.map((r) => ({
      chunk_id: r.chunk_id,
      similarity: Number(r.similarity.toFixed(3)),
      title: r.title,
      source: r.source,
      country: r.country,
      published_at: r.published_at,
      url: r.url,
      text: r.text,
    })),
    guidance:
      top < 0.7
        ? "Top similarity is below 0.7 — the internal knowledge base may not directly cover this. Consider web_search for better or more current evidence."
        : "Knowledge base results look relevant.",
  });
};
