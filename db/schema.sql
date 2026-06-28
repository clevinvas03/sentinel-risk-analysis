-- Open-Domain Data Centre Risk Intelligence Agent — schema
-- Applied automatically by docker-compose on first boot, or manually:
--   psql "$DATABASE_URL" -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;  -- parcel geometry + spatial adjacency

-- Scraped (or seeded) source documents that enrich the agent's knowledge base.
CREATE TABLE IF NOT EXISTS documents (
  id           BIGSERIAL PRIMARY KEY,
  source       TEXT NOT NULL,                 -- gdacs | reliefweb | datacenterdynamics | planning | seed
  url          TEXT UNIQUE,                   -- canonical source URL (NULL allowed for seeds)
  title        TEXT NOT NULL,
  country      TEXT,                          -- ISO-ish country / region label when known
  published_at TIMESTAMPTZ,
  raw_text     TEXT NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chunked + embedded passages. embedding dim = 384 (all-MiniLM-L6-v2).
CREATE TABLE IF NOT EXISTS chunks (
  id           BIGSERIAL PRIMARY KEY,
  document_id  BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index  INT NOT NULL,
  text         TEXT NOT NULL,
  token_count  INT,
  embedding    vector(384) NOT NULL
);

-- Persisted agent runs (question + grounded answer + full trace + sources).
CREATE TABLE IF NOT EXISTS assessments (
  id         BIGSERIAL PRIMARY KEY,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  trace      JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approximate-nearest-neighbour index for cosine similarity search.
-- HNSW (not ivfflat): high recall out of the box with no lists/probes tuning, and
-- — crucially — correct behaviour on a small or still-growing knowledge base, where
-- ivfflat's empty-list problem silently drops relevant results.
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS documents_source_idx ON documents (source);
CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks (document_id);
CREATE INDEX IF NOT EXISTS assessments_created_idx ON assessments (created_at DESC);

-- ---------------------------------------------------------------------------
-- Parcel layer (live county assessor data, cached in PostGIS)
-- ---------------------------------------------------------------------------

-- Normalised parcels cached from live ArcGIS/Socrata queries, keyed by APN.
-- `fetched_at` drives the 24h freshness window; `geom` enables spatial adjacency.
CREATE TABLE IF NOT EXISTS parcels (
  id                    BIGSERIAL PRIMARY KEY,
  county                TEXT NOT NULL,
  state                 TEXT,
  apn                   TEXT NOT NULL,
  owner_name            TEXT,
  owner_name_normalised TEXT,
  land_use_code         TEXT,
  land_use_standard     TEXT,                     -- STANDARD taxonomy (LLM-mapped)
  situs_address         TEXT,
  acreage               DOUBLE PRECISION,
  raw_attributes        JSONB NOT NULL DEFAULT '{}'::jsonb,
  geom                  geometry(Geometry, 4326),
  source                TEXT NOT NULL DEFAULT 'live',  -- live | offline-sample
  fetched_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (county, apn)
);

CREATE INDEX IF NOT EXISTS parcels_geom_idx ON parcels USING GIST (geom);
CREATE INDEX IF NOT EXISTS parcels_apn_idx ON parcels (county, apn);
CREATE INDEX IF NOT EXISTS parcels_fetched_idx ON parcels (fetched_at);
CREATE INDEX IF NOT EXISTS parcels_landuse_idx ON parcels (county, land_use_standard);

-- Per-county LLM mapping cache: land_use_code -> STANDARD class. Populated lazily
-- so Claude is only called when a brand-new, unseen code appears.
CREATE TABLE IF NOT EXISTS land_use_mappings (
  county         TEXT NOT NULL,
  land_use_code  TEXT NOT NULL,
  standard_class TEXT NOT NULL,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (county, land_use_code)
);

-- Records which APNs a given discovery query returned and when, so identical
-- repeat queries within 24h are served from the local PostGIS cache.
CREATE TABLE IF NOT EXISTS parcel_query_cache (
  county      TEXT NOT NULL,
  query_hash  TEXT NOT NULL,
  criteria    JSONB NOT NULL,
  apns        TEXT[] NOT NULL DEFAULT '{}',
  match_count INT NOT NULL DEFAULT 0,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (county, query_hash)
);

-- Resolved FeatureServer layer URL per county (so we resolve it once, log it, and
-- reuse it across restarts instead of re-discovering on every run).
CREATE TABLE IF NOT EXISTS parcel_config (
  county                   TEXT PRIMARY KEY,
  feature_server_layer_url TEXT NOT NULL,
  resolved_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
