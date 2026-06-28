import type { ToolHandler } from "./types";

// Optional fallback for TOOL 2 (web search), used only when
// WEB_SEARCH_PROVIDER=tavily. When provider=anthropic (the default) the agent uses
// the native web_search_20260209 server tool instead and this is never registered.
export const tavilySearch: ToolHandler = async (input, ctx) => {
  const q: string = String(input?.query ?? "").trim();
  if (!q) return JSON.stringify({ error: "query is required" });

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return JSON.stringify({
      error: "TAVILY_API_KEY is not set; cannot run web search via Tavily",
    });
  }

  ctx.emitTrace("Searching the web", q);

  let data: any;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: q,
        max_results: Math.min(Math.max(Number(input?.max_results) || 5, 1), 10),
        search_depth: "basic",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return JSON.stringify({ error: `Tavily error HTTP ${res.status}` });
    }
    data = await res.json();
  } catch (e: any) {
    return JSON.stringify({ error: `web search failed: ${e?.message ?? e}` });
  }

  const results = (data?.results ?? []).map((r: any) => {
    ctx.addSource({ kind: "web", title: r.title ?? r.url, url: r.url });
    return { title: r.title, url: r.url, snippet: r.content };
  });

  ctx.emitTrace(`Web search returned ${results.length} results`);
  return JSON.stringify({ results });
};
