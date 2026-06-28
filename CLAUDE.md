# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An **open-domain agentic** data-centre site-risk analyst. A single Anthropic-SDK
tool-use loop answers *any* question about data-centre risk and **decides its own
tool strategy** — there is deliberately **no routing logic / no hardcoded
questions**. Adding a capability = add a tool with a clear description; the model
learns when to use it. The agent loop ([lib/agent.ts](lib/agent.ts)) is the product.

Stack: Next.js 14 (App Router, TS) · Python FastAPI (embeddings + scrapers) ·
Postgres with **PostGIS + pgvector** · the Anthropic SDK pointed at either Anthropic
or an Anthropic-compatible endpoint (z.ai / GLM).

## Running it (no test suite exists)

Three processes. The DB runs in Docker; the app and embedding service run locally.

```bash
# 1. DB — builds a custom PostGIS+pgvector image (db/Dockerfile). Published on host
#    port 5433 (NOT 5432 — a local Postgres typically holds 5432). schema.sql is
#    applied on first boot of an empty volume.
docker compose up -d
#    Re-apply schema to an existing volume:
docker compose exec -T db psql -U postgres -d risk < db/schema.sql

# 2. Embedding service (owns the sentence-transformers model)
cd scraper
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --port 8000
.venv/bin/python seed.py     # cold-start KB (works offline); then optionally scrape.py

# 3. App — see the ANTHROPIC_BASE_URL gotcha below
cd ..
npm install
env -u ANTHROPIC_BASE_URL -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN npm run dev
```

Other commands:
```bash
npx tsc --noEmit                 # type-check (the main correctness gate)
npx next build                   # production build
npm run inspect:fs -- <featureServerUrl>   # print a county FeatureServer's layers/fields
docker compose exec -T db psql -U postgres -d risk -c "\dx"   # verify vector + postgis
```
`docker` lives at `/Applications/Docker.app/Contents/Resources/bin` if not on PATH.

## Architecture (the cross-file big picture)

**The agentic loop — [lib/agent.ts](lib/agent.ts).** A *manual* `messages.stream`
loop (not the SDK tool-runner, because we emit a live trace and stream the final
answer). It feeds events to a callback that [app/api/ask/route.ts](app/api/ask/route.ts)
turns into **SSE**. Event types: `trace`, `thinking`, `token`, `answer_reset`,
`sources`, `done`, `error`. Non-final turns stream text optimistically as `token`s;
when such a turn ends in a tool call, `answer_reset` clears that narration so only
the final turn becomes the answer. Loop cap = 15 iterations; handles `tool_use`,
`pause_turn`, `end_turn`.

**Tools — [lib/tools/](lib/tools/index.ts).** `index.ts` is the registry: a schema
array (`getToolDefinitions()`) + a `handlers` dispatch map. Every handler has the
signature `(input, ctx) => Promise<string>`; `ctx.emitTrace` and `ctx.addSource`
wire it into the live trace and the cited-sources list (`Source.kind` ∈
`kb|web|parcel`). To add a tool: write the handler, add a described schema, register
in `handlers`. Nothing else.

**Two-language embedding split (a hard invariant).** The sentence-transformers model
(`all-MiniLM-L6-v2`, **384-dim**) lives **only in Python**. The scraper/seed embed
chunks in-process at ingest; the TS agent embeds the live query by calling FastAPI
`/embed` ([lib/embed.ts](lib/embed.ts)). Same model on both sides ⇒ vectors share one
space. **Next.js owns all DB reads** via `pg` ([lib/db.ts](lib/db.ts)) — Python only
embeds + scrapes. If you change the model, change `EMBED_DIM`, the `vector(N)` column,
and re-embed everything.

**Provider abstraction — [lib/anthropic.ts](lib/anthropic.ts).** `LLM_PROVIDER`
(`anthropic` default | `zai`) drives `AGENT_MODEL`, `NORMALISER_MODEL`, base URL, and
auth (`authToken`/Bearer for z.ai, `apiKey`/x-api-key for Anthropic). `IS_ANTHROPIC`
gates two Anthropic-only features:
- **Adaptive thinking** (`thinking: {type:"adaptive"}`) — sent only for Anthropic.
- **Native `web_search`** server tool (`web_search_20260209`) — included only for
  Anthropic. With `WEB_SEARCH_PROVIDER=tavily` a custom Tavily tool is used instead
  (any provider). On z.ai with no Tavily, the agent simply has **no web search** (KB,
  parcels, geocode, site-risk, compare still work). `usesNativeWebSearch` tells the
  loop to read server-executed `web_search_tool_result` blocks for trace + sources.

**Parcel subsystem (live county GIS).** Three files:
- [lib/parcelClient.ts](lib/parcelClient.ts) — live querying of Esri ArcGIS
  FeatureServers (and Socrata). `COUNTY_CONFIGS` registry maps county columns →
  STANDARD schema via **candidate-array** `field_mapping` (first present column
  wins, so exact names need not be known). Count-first (`returnCountOnly`), paginates
  on `resultOffset` until `exceededTransferLimit` is false, falls back `f=geojson`→
  `f=json`+esri→geojson, retries with backoff. The parcel **layer index** is resolved
  at runtime from `{base}?f=json` (layer matching `/parcel/i`), logged, and persisted
  to the `parcel_config` table — never hardcode `/FeatureServer/{n}`.
- [lib/parcelCache.ts](lib/parcelCache.ts) — 24h PostGIS cache keyed by `(county,apn)`
  + a query-hash table; spatial adjacency via `ST_Touches`/`ST_DWithin` over cached
  geometry (this is why the DB needs PostGIS, alongside pgvector for the KB).
- [lib/landUse.ts](lib/landUse.ts) — LLM land-use-code → STANDARD taxonomy, **cached
  per county** in `land_use_mappings` so the model is called only for unseen codes;
  deterministic owner normalisation. Gracefully falls back to `OTHER` with no LLM key.

**Schema — [db/schema.sql](db/schema.sql).** KB side: `documents`, `chunks`
(`vector(384)`, **HNSW** index), `assessments` (persisted runs + trace + sources).
Parcel side: `parcels` (PostGIS `geom`, GIST index), `land_use_mappings`,
`parcel_query_cache`, `parcel_config`.

## Non-obvious gotchas (most cost real debugging time)

- **`ANTHROPIC_BASE_URL` shadows `.env`.** dotenv/Next won't override an env var
  already set in the shell. A host-exported `ANTHROPIC_BASE_URL` (e.g. from the
  Claude Code harness) silently redirects requests — z.ai tokens then hit Anthropic
  and 401. Launch with `env -u ANTHROPIC_BASE_URL …` (above); `getAnthropic()` also
  force-overrides to the z.ai endpoint when `LLM_PROVIDER=zai`. A 401 with an
  Anthropic-style `req_…` id means the request went to Anthropic, not z.ai.
- **DB is on 5433, IPv4.** A local Postgres usually owns `localhost:5432` (and lacks a
  `postgres` role). `DATABASE_URL` uses `127.0.0.1:5433`; keep it consistent in `.env`
  (read by both Next and the Python scraper).
- **HNSW, not ivfflat.** ivfflat with `lists=100` over a small KB silently drops
  relevant results (empty-list recall collapse). The KB index is HNSW; don't switch
  back for "scale" unless the corpus is large *and* you tune probes.
- **County host reachability.** Some county GIS hosts (e.g. `webgis.sccgov.org`)
  firewall server-side/cloud traffic — connections time out even though DNS resolves.
  Santa Clara is pointed at the AGOL `Parcels_Public_View` endpoint instead. That
  public layer has **no owner/land-use fields** (APN/address/acreage/geometry only),
  so ownership/zoning questions are honestly declined.
- **Honest fallback is a feature.** If a live parcel endpoint is unreachable, the tool
  serves the labelled `data/demo_parcels.geojson` fixture and the agent is instructed
  to tell the user it's offline-sample data. Don't "fix" this by hiding the label.

## README

[README.md](README.md) has the interviewer-facing framing and the full ArcGIS query
pattern / pagination / cache details. The default model per the original spec is
`claude-sonnet-4-6`; this checkout is currently configured for z.ai (`glm-4.6`) via
`.env`.
