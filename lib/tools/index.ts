import type Anthropic from "@anthropic-ai/sdk";
import { searchKnowledgeBase } from "./searchKnowledgeBase";
import { fetchUrl } from "./fetchUrl";
import { geocodeLocation } from "./geocode";
import { getSiteRiskData } from "./siteRisk";
import { compareSites } from "./compareSites";
import { tavilySearch } from "./tavilySearch";
import { searchParcels, getParcel, findAdjacentParcels } from "./parcels";
import { IS_ANTHROPIC } from "../anthropic";
import type { ToolHandler } from "./types";

export const WEB_SEARCH_PROVIDER = (
  process.env.WEB_SEARCH_PROVIDER ?? "anthropic"
).toLowerCase();

// ---------------------------------------------------------------------------
// Custom client-side tool schemas. The agent learns to use each tool PURELY from
// its description — adding a new capability is just: implement a handler, add a
// schema here with a clear description, register it in `handlers`. No routing code.
// ---------------------------------------------------------------------------
const customTools: Anthropic.Tool[] = [
  {
    name: "search_knowledge_base",
    description:
      "Semantic search over an internal knowledge base of scraped & curated data " +
      "centre risk intelligence (hazard alerts, humanitarian reports, industry news, " +
      "planning news, and analyst reference notes). Use this FIRST for established " +
      "domain knowledge and depth. Returns the most similar passages with a cosine " +
      "similarity score (0-1) and source provenance. If the top similarity is low " +
      "(< ~0.7) or results are off-topic, the internal KB likely does not cover the " +
      "question — reach for web_search instead. You MAY optionally pass country, " +
      "source, or date_from filters when they help.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query" },
        k: { type: "integer", description: "Number of passages to return (1-12, default 6)" },
        country: { type: "string", description: "Optional: restrict to a country/region substring" },
        source: {
          type: "string",
          description:
            "Optional: restrict to one source (gdacs | reliefweb | datacenterdynamics | planning | seed)",
        },
        date_from: { type: "string", description: "Optional ISO date: only documents published on/after this" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description:
      "Fetch a web page or knowledge-base source URL and extract its main article " +
      "text, so you can read the full source rather than just a search snippet. Use " +
      "after web_search (or on a KB result URL) when a snippet is not enough to answer " +
      "confidently. Returns the page title and extracted text (may be truncated).",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute http(s) URL" } },
      required: ["url"],
    },
  },
  {
    name: "geocode_location",
    description:
      "Resolve a place name or address (e.g. 'near Frankfurt', 'Dublin, Ireland') to " +
      "latitude/longitude using OpenStreetMap. Use this to turn a location mentioned " +
      "in the question into coordinates before calling get_site_risk_data.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Place name or address" } },
      required: ["query"],
    },
  },
  {
    name: "get_site_risk_data",
    description:
      "Return structured, layered site-risk data for a coordinate pair: flood, " +
      "seismic, climate (heat/drought), grid/power (interconnection headroom, queue, " +
      "carbon), and operational (water stress, connectivity diversity). Use for a " +
      "specific location after geocoding. NOTE: values are illustrative mock data " +
      "keyed to coordinates — say so when you rely on them.",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude" },
        lng: { type: "number", description: "Longitude" },
      },
      required: ["lat", "lng"],
    },
  },
  {
    name: "compare_sites",
    description:
      "Produce a side-by-side structured risk comparison across two or more sites. " +
      "Each site may be a place name (it will be geocoded) or an explicit {lat,lng} " +
      "pair. Use for comparative questions like 'is X or Y better for a build?'.",
    input_schema: {
      type: "object",
      properties: {
        sites: {
          type: "array",
          description: "Two or more place names and/or {name?, lat, lng} objects",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  name: { type: "string" },
                  lat: { type: "number" },
                  lng: { type: "number" },
                },
              },
            ],
          },
        },
      },
      required: ["sites"],
    },
  },
  {
    name: "search_parcels",
    description:
      "Query LIVE county assessor parcel data (land/ownership/land-use) for a site. " +
      "Use for questions about who owns land, parcel sizes, land-use/zoning, or " +
      "assembling a campus. It checks the match COUNT first and will refuse to dump " +
      "a huge result set — narrow with owner_contains, land_use_codes, or a tighter " +
      "'near' radius, or pass max_records. Data is fetched live from the county GIS " +
      "and cached 24h. If the live endpoint is unreachable it returns clearly-" +
      "labelled OFFLINE SAMPLE data — when that happens, tell the user the parcels " +
      "are illustrative samples, not current records. Currently configured counties: " +
      "Santa Clara, CA (county='santa-clara').",
    input_schema: {
      type: "object",
      properties: {
        county: { type: "string", description: "County slug, e.g. 'santa-clara' (default)" },
        near: {
          type: "object",
          description: "Proximity filter around a point",
          properties: {
            lat: { type: "number" },
            lng: { type: "number" },
            distance_m: { type: "number", description: "Radius in metres (default 1000)" },
          },
        },
        owner_contains: { type: "string", description: "Substring match on owner name" },
        land_use_codes: {
          type: "array",
          items: { type: "string" },
          description: "Restrict to specific county land-use codes",
        },
        apns: { type: "array", items: { type: "string" }, description: "Specific APNs" },
        max_records: {
          type: "integer",
          description: "Cap the number of parcels fetched (use after seeing the count)",
        },
      },
    },
  },
  {
    name: "get_parcel",
    description:
      "Fetch a single parcel by APN (assessor parcel number) from live county data " +
      "(served from the 24h cache when fresh). Returns owner, land use, situs " +
      "address, and acreage.",
    input_schema: {
      type: "object",
      properties: {
        county: { type: "string", description: "County slug (default 'santa-clara')" },
        apn: { type: "string", description: "Assessor parcel number" },
      },
      required: ["apn"],
    },
  },
  {
    name: "find_adjacent_parcels",
    description:
      "Find parcels adjacent to a given APN — touching its boundary, or within an " +
      "optional distance. Useful for land-assembly / campus-expansion questions " +
      "('what's next to this parcel?'). Runs spatial adjacency in PostGIS over " +
      "locally cached geometry, populating the neighbourhood from live data first.",
    input_schema: {
      type: "object",
      properties: {
        county: { type: "string", description: "County slug (default 'santa-clara')" },
        apn: { type: "string", description: "APN of the parcel to find neighbours of" },
        distance_m: {
          type: "number",
          description: "Optional: also include parcels within this many metres (default 0 = touching only)",
        },
      },
      required: ["apn"],
    },
  },
];

// The Tavily fallback is registered as a custom tool ONLY when selected.
const tavilyTool: Anthropic.Tool = {
  name: "web_search",
  description:
    "Search the live web for current, breaking, or niche information that the " +
    "internal knowledge base does not cover. This is what makes the agent open-" +
    "domain: use it whenever the KB is insufficient or the question needs up-to-date " +
    "information. Returns titles, snippets and URLs; follow up with fetch_url to read " +
    "a result in full.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      max_results: { type: "integer", description: "1-10, default 5" },
    },
    required: ["query"],
  },
};

// Native Anthropic server tool (default). The API executes it server-side; we never
// implement it. Typed loosely because the SDK's tool union is version-specific.
const nativeWebSearchTool = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 6,
} as unknown as Anthropic.Tool;

// Build the tool list handed to the model based on the configured provider.
//   - Tavily selected      -> custom tavily web_search tool (works on any provider)
//   - Anthropic + no Tavily -> native web_search server tool
//   - non-Anthropic (e.g. z.ai/GLM) + no Tavily -> NO web search (GLM can't run the
//     native server tool); the agent still has KB, parcels, geocode, site-risk, compare.
export function getToolDefinitions(): Anthropic.Tool[] {
  if (WEB_SEARCH_PROVIDER === "tavily") {
    return [...customTools, tavilyTool];
  }
  if (IS_ANTHROPIC) {
    return [...customTools, nativeWebSearchTool];
  }
  return [...customTools];
}

// Handlers for tools WE execute. web_search is absent here when using the native
// server tool (the API runs it); present only under the Tavily fallback.
export const handlers: Record<string, ToolHandler> = {
  search_knowledge_base: searchKnowledgeBase,
  fetch_url: fetchUrl,
  geocode_location: geocodeLocation,
  get_site_risk_data: getSiteRiskData,
  compare_sites: compareSites,
  search_parcels: searchParcels,
  get_parcel: getParcel,
  find_adjacent_parcels: findAdjacentParcels,
  ...(WEB_SEARCH_PROVIDER === "tavily" ? { web_search: tavilySearch } : {}),
};

export const usesNativeWebSearch = IS_ANTHROPIC && WEB_SEARCH_PROVIDER !== "tavily";
