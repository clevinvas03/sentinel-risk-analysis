import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { ToolHandler } from "./types";

const MAX_CHARS = 6000;

// TOOL 3 — fetch a URL (from web_search results or a KB document) and extract the
// main article text so the agent can read the full source, not just a snippet.
export const fetchUrl: ToolHandler = async (input, ctx) => {
  const url: string = String(input?.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return JSON.stringify({ error: "a valid http(s) url is required" });
  }

  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep raw url */
  }
  ctx.emitTrace("Reading article", host);

  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "dc-risk-intel/0.1 (risk-analysis demo)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return JSON.stringify({ error: `fetch failed: HTTP ${res.status}`, url });
    }
    html = await res.text();
  } catch (e: any) {
    return JSON.stringify({ error: `fetch failed: ${e?.message ?? e}`, url });
  }

  let title = host;
  let text = "";
  try {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    title = article?.title?.trim() || dom.window.document.title || host;
    text = (article?.textContent ?? "").replace(/\s+\n/g, "\n").trim();
  } catch {
    // Fallback: strip tags crudely if Readability fails on odd markup.
    text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  if (!text) {
    return JSON.stringify({ error: "could not extract readable text", url });
  }

  const truncated = text.length > MAX_CHARS;
  ctx.addSource({ kind: "web", title, url });

  return JSON.stringify({
    url,
    title,
    truncated,
    text: truncated ? text.slice(0, MAX_CHARS) + "…" : text,
  });
};
