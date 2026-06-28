// PostGIS-backed cache for live parcel data: 24h freshness, APN-keyed upsert, and
// spatial adjacency (ST_Touches / ST_DWithin) against locally cached geometry.

import { createHash } from "crypto";
import { query } from "./db";
import type { GeoJSONGeometry, ParcelCriteria, StandardParcel } from "./parcelClient";

const CACHE_TTL_HOURS = 24;

// A parcel enriched with normalised fields, ready to cache.
export type EnrichedParcel = StandardParcel & {
  land_use_standard?: string | null;
  owner_name_normalised?: string | null;
  source?: string; // "live" | "offline-sample"
};

// Shape returned when reading parcels back out of the cache.
export type ParcelRecord = {
  county: string;
  state: string | null;
  apn: string;
  owner_name: string | null;
  owner_name_normalised: string | null;
  land_use_code: string | null;
  land_use_standard: string | null;
  situs_address: string | null;
  acreage: number | null;
  geometry: GeoJSONGeometry | null;
  source: string;
  fetched_at: string;
};

export function hashCriteria(county: string, criteria: ParcelCriteria): string {
  return createHash("sha1")
    .update(county + "|" + stableStringify(criteria))
    .digest("hex");
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify((v as any)[k]))
      .join(",") +
    "}"
  );
}

// UPSERT live parcels into PostGIS keyed by (county, apn), refreshing fetched_at.
export async function upsertParcels(parcels: EnrichedParcel[]): Promise<void> {
  for (const p of parcels) {
    if (!p.apn) continue;
    const geomJson = p.geometry ? JSON.stringify(p.geometry) : null;
    await query(
      `INSERT INTO parcels
         (county, state, apn, owner_name, owner_name_normalised,
          land_use_code, land_use_standard, situs_address, acreage,
          raw_attributes, geom, source, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,
               CASE WHEN $11::text IS NULL THEN NULL
                    ELSE ST_SetSRID(ST_GeomFromGeoJSON($11), 4326) END,
               $12, now())
       ON CONFLICT (county, apn) DO UPDATE SET
         state = EXCLUDED.state,
         owner_name = EXCLUDED.owner_name,
         owner_name_normalised = EXCLUDED.owner_name_normalised,
         land_use_code = EXCLUDED.land_use_code,
         land_use_standard = EXCLUDED.land_use_standard,
         situs_address = EXCLUDED.situs_address,
         acreage = EXCLUDED.acreage,
         raw_attributes = EXCLUDED.raw_attributes,
         geom = COALESCE(EXCLUDED.geom, parcels.geom),
         source = EXCLUDED.source,
         fetched_at = now()`,
      [
        p.county,
        p.state,
        p.apn,
        p.owner_name,
        p.owner_name_normalised ?? null,
        p.land_use_code,
        p.land_use_standard ?? null,
        p.situs_address,
        p.acreage,
        JSON.stringify(p.raw ?? {}),
        geomJson,
        p.source ?? "live",
      ]
    );
  }
}

// Returns the cached APN set for an identical recent query, or null if stale/missing.
export async function getFreshQueryCache(
  county: string,
  hash: string
): Promise<string[] | null> {
  const rows = await query<{ apns: string[] }>(
    `SELECT apns FROM parcel_query_cache
     WHERE county = $1 AND query_hash = $2
       AND fetched_at > now() - ($3 || ' hours')::interval`,
    [county, hash, CACHE_TTL_HOURS]
  );
  return rows[0]?.apns ?? null;
}

export async function recordQueryCache(
  county: string,
  hash: string,
  criteria: ParcelCriteria,
  apns: string[]
): Promise<void> {
  await query(
    `INSERT INTO parcel_query_cache (county, query_hash, criteria, apns, match_count, fetched_at)
     VALUES ($1,$2,$3::jsonb,$4,$5, now())
     ON CONFLICT (county, query_hash) DO UPDATE SET
       criteria = EXCLUDED.criteria, apns = EXCLUDED.apns,
       match_count = EXCLUDED.match_count, fetched_at = now()`,
    [county, hash, JSON.stringify(criteria), apns, apns.length]
  );
}

const SELECT_COLS = `
  county, state, apn, owner_name, owner_name_normalised,
  land_use_code, land_use_standard, situs_address, acreage, source,
  fetched_at,
  CASE WHEN geom IS NULL THEN NULL ELSE ST_AsGeoJSON(geom) END AS geom_json`;

function rowToRecord(r: any): ParcelRecord {
  return {
    county: r.county,
    state: r.state,
    apn: r.apn,
    owner_name: r.owner_name,
    owner_name_normalised: r.owner_name_normalised,
    land_use_code: r.land_use_code,
    land_use_standard: r.land_use_standard,
    situs_address: r.situs_address,
    acreage: r.acreage != null ? Number(r.acreage) : null,
    geometry: r.geom_json ? (JSON.parse(r.geom_json) as GeoJSONGeometry) : null,
    source: r.source,
    fetched_at: r.fetched_at,
  };
}

export async function getParcelsByApns(
  county: string,
  apns: string[]
): Promise<ParcelRecord[]> {
  if (!apns.length) return [];
  const rows = await query(
    `SELECT ${SELECT_COLS} FROM parcels WHERE county = $1 AND apn = ANY($2)`,
    [county, apns]
  );
  return rows.map(rowToRecord);
}

// Returns true only if EVERY requested APN is present AND fresh (<24h).
export async function apnsAreFresh(county: string, apns: string[]): Promise<boolean> {
  if (!apns.length) return false;
  const rows = await query<{ fresh: string }>(
    `SELECT COUNT(*) FILTER (
       WHERE fetched_at > now() - ($3 || ' hours')::interval
     )::text AS fresh
     FROM parcels WHERE county = $1 AND apn = ANY($2)`,
    [county, apns, CACHE_TTL_HOURS]
  );
  return Number(rows[0]?.fresh ?? 0) === apns.length;
}

// Spatial adjacency against locally cached geometry. Returns neighbours that share a
// boundary (ST_Touches) or fall within `distanceMeters` of the target parcel.
export async function findAdjacent(
  county: string,
  apn: string,
  distanceMeters = 0
): Promise<{ target: ParcelRecord | null; neighbours: ParcelRecord[] }> {
  const targetRows = await query(
    `SELECT ${SELECT_COLS} FROM parcels WHERE county = $1 AND apn = $2`,
    [county, apn]
  );
  if (!targetRows.length || !targetRows[0].geom_json) {
    return { target: targetRows.length ? rowToRecord(targetRows[0]) : null, neighbours: [] };
  }

  const rows = await query(
    `SELECT ${SELECT_COLS}
     FROM parcels p,
          (SELECT geom AS g FROM parcels WHERE county = $1 AND apn = $2) t
     WHERE p.county = $1
       AND p.apn <> $2
       AND p.geom IS NOT NULL
       AND (
         ST_Touches(p.geom, t.g)
         OR ($3 > 0 AND ST_DWithin(p.geom::geography, t.g::geography, $3))
       )
     ORDER BY ST_Distance(p.geom::geography, t.g::geography)
     LIMIT 200`,
    [county, apn, distanceMeters]
  );

  return { target: rowToRecord(targetRows[0]), neighbours: rows.map(rowToRecord) };
}
