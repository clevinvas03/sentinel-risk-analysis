# Data Centre Risk Intelligence Agent

An **open-domain** agentic system that answers *any* question about data centre
site risk — flood, seismic, climate, grid/power, cooling, water, planning,
geopolitics, cost, latency, supply chain, sustainability, and more.

> **The agent is the product.** There are **no hardcoded questions and no routing
> logic.** A single Anthropic tool-use loop (`claude-sonnet-4-6`) receives any
> natural-language question and *autonomously decides* how to answer it: search the
> internal vector knowledge base, geocode a location, pull structured site-risk
> data, compare sites, or search the **live web** when its own knowledge is
> insufficient. It loops until it has enough evidence, then streams a grounded,
> cited answer. If a question is genuinely outside the domain, it says so honestly
> rather than hallucinating.

---

## For interviewers — what to look at

- **Open-domain, no routing.** Every question goes through the same loop in
  [`lib/agent.ts`](lib/agent.ts). There is no `if (question.includes(...))`
  anywhere. **Claude** chooses the tools and the strategy from the tool
  descriptions alone.
- **RAG + live web hybrid.** The internal pgvector knowledge base
  ([`search_knowledge_base`](lib/tools/searchKnowledgeBase.ts)) gives *depth* on
  established domain material; **native Anthropic `web_search`** gives *breadth and
  recency*. The KB only ever *enriches* the agent — it is never a ceiling.
- **Autonomous KB→web fallback.** `search_knowledge_base` returns cosine
  **similarity scores** to the model and flags low-relevance results. The decision
  to fall back to the web is made by **Claude in the loop**, not by our code.
- **Full transparency.** The UI shows a **live agent trace** (every tool call and a
  summary of the model's reasoning, streamed in real time) and a **"Sources used"**
  list of the exact KB chunks and web URLs the agent actually consulted, with
  footnote-style inline citations. Past runs are persisted under **History**, and
  the **Knowledge Base** explorer shows chunk provenance and per-chunk similarity.
- **Honest by construction.** The system prompt forbids fabricating statistics,
  dates, or place names; requires the agent to flag first-principles reasoning; and
  redirects clearly out-of-domain questions.

### How to add a new tool (the extensibility story)

1. Write a handler `(input, ctx) => Promise<string>` in `lib/tools/`.
2. Add a schema with a **clear, prescriptive `description`** to `customTools` in
   [`lib/tools/index.ts`](lib/tools/index.ts), and register the handler in
   `handlers`.

That's it — there is no routing to update. The agent learns *when* to use the new
tool purely from its description, because the loop is fully tool-driven.

---

## Architecture

```
Next.js 14 (App Router, TypeScript)        Python FastAPI (embedding + scraper)
  app/page.tsx   Intelligence Terminal        /embed   sentence-transformers (MiniLM, 384d)
  app/api/ask    SSE: live trace + tokens      /health
  lib/agent.ts   open-domain agentic loop     scrape.py  GDACS / ReliefWeb /
  lib/tools/*    6 tools                                  DatacenterDynamics / Planning
  lib/db.ts      pg + pgvector                            -> chunk -> embed -> store
                                               seed.py    cold-start demo KB
        |                                          |
        +---------------> PostgreSQL + pgvector <--+   (Docker Compose)
```

**Why the split:** the sentence-transformers model lives **only** in Python. The
scraper embeds chunks at ingest; the TS agent embeds the live query via FastAPI
`/embed`. Same model on both sides ⇒ identical 384-dim vectors, so cosine
similarity is meaningful. Next.js owns all DB reads via `pg` for one consistent
data path.

### The tools

| # | Tool | What it does |
|---|------|--------------|
| 1 | `search_knowledge_base` | Embeds the query, runs pgvector cosine search, returns top-N chunks **with similarity + provenance**. Optional country/source/date filters the *agent* may choose. |
| 2 | `web_search` | **Anthropic native `web_search_20260209` server tool** (default). Optional **Tavily** fallback when `WEB_SEARCH_PROVIDER=tavily`. |
| 3 | `fetch_url` | Fetches a page (web or KB URL) and extracts the main article text (`@mozilla/readability`) so the agent reads the full source, not just a snippet. |
| 4 | `geocode_location` | Place name/address → lat/lng via OpenStreetMap Nominatim. |
| 5 | `get_site_risk_data` | Structured flood/seismic/climate/grid/operational layers for coordinates. **Mock data** with clearly marked plug points for real FEMA/USGS/IPCC/ENTSO-E feeds. |
| 6 | `compare_sites` | Side-by-side structured risk comparison across two or more sites (names or coords). |
| 7 | `search_parcels` | **Live** county assessor parcels (ownership, land use, size) — count-first, 24h-cached, honest offline fallback. |
| 8 | `get_parcel` | A single parcel by APN (cache-first). |
| 9 | `find_adjacent_parcels` | Spatial adjacency (PostGIS `ST_Touches`/`ST_DWithin`) for land-assembly questions. |

The loop runs up to **15 iterations**, streams the final answer token-by-token, and
logs the full trace.

---

## Live parcel data (county assessor)

Parcels are queried **live** from county GIS portals — there is no static download.
Most US counties run **Esri ArcGIS** and expose a **FeatureServer REST API**.

### The ArcGIS FeatureServer query pattern

```
GET {featureServerLayerUrl}/query
  ?where={SQL_WHERE}
  &outFields=*
  &f=geojson            # falls back to f=json (+ Esri→GeoJSON) if rejected
  &returnGeometry=true&outSR=4326
  &resultOffset={offset}&resultRecordCount={pageSize}   # pagination

# Proximity filter:
  &geometry={lng},{lat}&geometryType=esriGeometryPoint
  &distance={meters}&units=esriSRUnit_Meter
  &spatialRel=esriSpatialRelIntersects&inSR=4326
```

Implemented in [`lib/parcelClient.ts`](lib/parcelClient.ts):

- **Count-first** — `getParcelCount()` uses `returnCountOnly=true` so the agent knows
  how many parcels match *before* fetching; `search_parcels` refuses to pull more
  than ~500 without an explicit `max_records`, so it never drags 100k+ rows.
- **Pagination** — loops on `resultOffset` until `exceededTransferLimit` is false
  (ArcGIS caps ~1000–2000 records/request).
- **Format fallback** — tries `f=geojson`; on rejection retries `f=json` and converts
  Esri geometry → GeoJSON. ArcGIS error bodies returned as HTTP 200 are detected too.
- **Robustness** — timeouts / 5xx retry with exponential backoff; a truly unreachable
  endpoint surfaces a clear error and the agent falls back to the **offline sample**
  fixture, **clearly labelled** ([`data/demo_parcels.geojson`](data/demo_parcels.geojson)).
- **Socrata** — counties on a SODA portal (e.g. `data.sccgov.org`) are supported via
  `?$where=/$limit=/$offset=` with an optional `SOCRATA_APP_TOKEN`.

### 24h PostGIS cache

Live results are UPSERTed into the `parcels` table (PostGIS) keyed by `(county, apn)`
with a `fetched_at` timestamp ([`lib/parcelCache.ts`](lib/parcelCache.ts)). An
identical query within **24h** is served from the local table (fast, and gentle on
the county server); otherwise it re-queries live. Spatial adjacency
(`find_adjacent_parcels`) always runs against the local PostGIS geometry with a GIST
index. *(This is why the DB image bundles **PostGIS + pgvector** — see
[`db/Dockerfile`](db/Dockerfile).)*

### Normalisation (LLM, cached)

Each county's `land_use_code` → STANDARD taxonomy mapping runs on the live rows via
Claude (Haiku) and is **cached per county** in `land_use_mappings`, so the model is
only called when a brand-new, unseen code appears
([`lib/landUse.ts`](lib/landUse.ts)). Owner names are normalised deterministically.

### Add a county = add a config

Onboarding a new county is **one entry** in `COUNTY_CONFIGS`
([`lib/parcelClient.ts`](lib/parcelClient.ts)): the FeatureServer URL + a
`field_mapping` (STANDARD field → candidate county column names). The exact parcel
**layer index** is resolved automatically at runtime from the FeatureServer's
`?f=json` metadata (the layer matching `/parcel/i`), logged, and persisted to
`parcel_config` — so you never hardcode a guessed `/FeatureServer/{n}`.

To find a county's parcel FeatureServer URL and build its `field_mapping`:

```bash
# 1. Find the FeatureServer on the county's ArcGIS Hub / open-data portal
#    (e.g. https://gisdata-sccplanning.hub.arcgis.com/ for Santa Clara).
# 2. List its layers to find the parcel layer index:
npm run inspect:fs -- https://{host}/arcgis/rest/services/{service}/FeatureServer
# 3. Print that layer's fields to fill field_mapping candidates:
npm run inspect:fs -- https://{host}/arcgis/rest/services/{service}/FeatureServer/{layer}
```

> Santa Clara County, CA is seeded (`county='santa-clara'`), pointing at the verified
> SCC GIS FeatureServer base; the parcel layer index resolves on first query.

---

## Quick start

Prerequisites: **Docker Desktop**, **Node 18+**, **Python 3.10+**, and an
**Anthropic API key**.

```bash
# 0. Configure
cp .env.example .env            # then set ANTHROPIC_API_KEY

# 1. Database (Postgres + pgvector). schema.sql is applied automatically on first boot.
docker compose up -d
#   If the volume already existed, apply the schema manually:
#   psql "$DATABASE_URL" -f db/schema.sql

# 2. Embedding service + knowledge base
cd scraper
pip install -r requirements.txt
uvicorn main:app --port 8000          # serves /embed  (keep running)
#   in another shell, from scraper/:
python seed.py                        # cold-start demo KB (works offline)
python scrape.py                      # live public sources (best-effort per source)

# 3. App
cd ..
npm install
npm run dev                           # http://localhost:3000
```

Open <http://localhost:3000> and ask anything. Watch the trace panel on the right.

### Web search backend

- `WEB_SEARCH_PROVIDER=anthropic` (default) — uses the built-in
  `web_search_20260209` server tool. No extra key.
- `WEB_SEARCH_PROVIDER=tavily` — uses the Tavily Search API instead (set
  `TAVILY_API_KEY`). Implemented in [`lib/tools/tavilySearch.ts`](lib/tools/tavilySearch.ts).

---

## Try these (all handled by the *same* loop)

| Kind | Example | Typical strategy |
|------|---------|------------------|
| Specific factual | *What's the seismic risk near Naples?* | geocode → site-risk / KB |
| Comparative | *Is Ireland or Denmark better for a hyperscale build?* | `compare_sites` + KB |
| Open-ended | *What's the biggest emerging risk for European data centres?* | KB + web |
| Current events | *Any recent grid problems in Texas?* | `web_search` → `fetch_url` |
| Out of scope | *What's the capital of France?* | polite redirect, no fabrication |
| Vague | *Tell me about risk* | states interpretation, then answers |

---

## Data sources (scraper)

GDACS RSS (hazard alerts), ReliefWeb API (humanitarian/infrastructure reports),
DatacenterDynamics RSS (industry news), Planning Portal news (planning/permitting).
Each source is best-effort: a dead feed is skipped, never aborting the run. The
scraped corpus **enriches** the agent; live `web_search` covers everything else.

## Environment variables

| Var | Purpose |
|-----|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key (required) |
| `DATABASE_URL` | Postgres connection string (matches `docker-compose.yml`) |
| `EMBED_SERVICE_URL` | FastAPI embedding service (default `http://localhost:8000`) |
| `WEB_SEARCH_PROVIDER` | `anthropic` (default) or `tavily` |
| `TAVILY_API_KEY` | Required only when `WEB_SEARCH_PROVIDER=tavily` |
| `SOCRATA_APP_TOKEN` | Optional — raises rate limits for Socrata-portal counties. ArcGIS FeatureServers need **no** key. |
| `NEXT_PUBLIC_APP_URL` | App base URL |

## Project layout

```
db/Dockerfile                  PostGIS + pgvector image
db/schema.sql                  KB tables + parcels/land_use_mappings/parcel_query_cache/parcel_config
scraper/                       FastAPI /embed + scrapers + seed (Python)
lib/agent.ts                   the open-domain agentic loop + system prompt
lib/tools/                     the 9 tools + schemas (index.ts) + types
lib/parcelClient.ts            live ArcGIS/Socrata parcel querying (count-first, pagination, esri→geojson)
lib/parcelCache.ts             24h PostGIS cache + spatial adjacency
lib/landUse.ts                 LLM land-use normalisation (cached per county)
scripts/inspectFeatureServer.ts  helper to build a new county's field_mapping
data/demo_parcels.geojson      offline parcel fallback fixture
app/api/{ask,kb,history}/      SSE agent endpoint + KB explorer + history APIs
app/{page,explorer,history}    Intelligence Terminal, KB explorer, run history
components/                    AgentTrace, AnswerStream, SourceList, ExamplePills
```
