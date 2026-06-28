// Embeds query text by calling the Python FastAPI /embed endpoint, which owns the
// sentence-transformers model. Using the same model on both ingest and query sides
// guarantees the 384-dim vectors live in the same space.

const EMBED_SERVICE_URL =
  process.env.EMBED_SERVICE_URL ?? "http://localhost:8000";

export async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(`${EMBED_SERVICE_URL}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: [text] }),
    // The embedding service should be fast; fail clearly if it is down.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `Embedding service error ${res.status}: is the FastAPI service running at ${EMBED_SERVICE_URL}?`
    );
  }
  const data = (await res.json()) as { embeddings: number[][] };
  if (!data.embeddings?.[0]) {
    throw new Error("Embedding service returned no vector");
  }
  return data.embeddings[0];
}

// pgvector accepts a literal of the form '[0.1,0.2,...]'.
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
