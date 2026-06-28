// Live county assessor / parcel querying against Esri ArcGIS FeatureServer REST
// endpoints (and Socrata SODA portals). No API key is needed for open ArcGIS
// FeatureServers. This module does the LIVE network I/O + normalisation to a
// STANDARD schema; PostGIS caching + adjacency live in ./parcelCache.

import { query } from "./db";

// ---------------------------------------------------------------------------
// STANDARD schema — every county's columns are mapped onto this shape.
// ---------------------------------------------------------------------------
export type StandardParcel = {
  county: string;
  state: string;
  apn: string;
  owner_name: string | null;
  land_use_code: string | null;
  situs_address: string | null;
  acreage: number | null;
  geometry: GeoJSONGeometry | null;
  raw: Record<string, unknown>;
};

export type GeoJSONGeometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] };

// Structured query criteria the agent tools build; translated to a WHERE clause
// (+ spatial params) here.
export type ParcelCriteria = {
  apns?: string[];
  ownerContains?: string;
  landUseCodes?: string[];
  /** Raw extra WHERE fragment, already in county column terms (advanced use). */
  rawWhere?: string;
  /** Proximity filter (meters around a point). */
  near?: { lat: number; lng: number; distanceMeters: number };
  /** Hard cap on records actually fetched (pagination stops at this). */
  maxRecords?: number;
};

// field_mapping: STANDARD field -> ordered list of CANDIDATE county column names.
// Candidate arrays make onboarding robust: the mapper picks the first column that
// actually exists (case-insensitive), so an exact column name need not be known in
// advance. Confirm/trim the candidates for a county with scripts/inspectFeatureServer.ts.
export type FieldMapping = {
  apn: string[];
  owner_name: string[];
  land_use_code: string[];
  situs_address: string[];
  acreage: string[];
};

export type CountyConfig = {
  county_name: string;
  state: string;
  portal: "arcgis" | "socrata";
  /**
   * For ArcGIS: either the fully-qualified parcel layer URL
   *   https://{host}/arcgis/rest/services/{service}/FeatureServer/{layer}
   * OR the FeatureServer base URL (no trailing /{layer}) — in which case the
   * layer index is RESOLVED at runtime from the server metadata (see
   * resolveLayerUrl). We deliberately do NOT hardcode a guessed layer index.
   */
  featureServerUrl?: string;
  /** Hub/open-data page used to discover the FeatureServer if none is configured. */
  discoveryHint?: string;
  /** For Socrata: the dataset resource id (e.g. "h53q-4i8r") and domain host. */
  socrataDomain?: string;
  socrataDataset?: string;
  field_mapping: FieldMapping;
};

// ---------------------------------------------------------------------------
// Per-county registry. Add a county = add one entry here (+ field_mapping).
// ---------------------------------------------------------------------------
export const COUNTY_CONFIGS: Record<string, CountyConfig> = {
  "santa-clara": {
    county_name: "Santa Clara",
    state: "CA",
    portal: "arcgis",
    // SCC Planning Office "Parcels Public View" on ArcGIS Online (services2.arcgis.com,
    // org tcv2cMrq63AgvbHF) — layer 0 "Parcels", ~504k parcels with geometry. We use
    // this AGOL-hosted endpoint rather than the county's own webgis.sccgov.org host,
    // which firewalls server-side (non-browser) traffic. The parcel LAYER index is
    // resolved at runtime from ?f=json (the layer matching /parcel/i) and persisted.
    //   Expected shape: https://{host}/arcgis/rest/services/{service}/FeatureServer/{layer}
    // NOTE: this PUBLIC view exposes APN / site address / acreage / geometry but NOT
    // owner name or land-use code (not published publicly). Proximity, APN lookup,
    // size, and spatial adjacency work live; owner/land-use come back null.
    featureServerUrl:
      "https://services2.arcgis.com/tcv2cMrq63AgvbHF/arcgis/rest/services/Parcels_Public_View/FeatureServer",
    discoveryHint: "https://gisdata-sccplanning.hub.arcgis.com/",
    field_mapping: {
      apn: ["APN", "APNdashed", "Previous_APN", "PARCEL", "PARCELID"],
      // owner / land-use not in the public view; kept as candidates for other counties.
      owner_name: ["OWNER", "OWNER_NAME", "OWNERNME1"],
      land_use_code: ["USE_CODE", "USECODE", "LANDUSE", "ZONING"],
      situs_address: ["Situs_Address_Full", "AGOL_Situs_Search", "SITUS", "ADDRESS"],
      acreage: ["Acres_Rec", "ACRES", "ACREAGE", "GIS_ACRES"],
    },
  },
};

export function getCountyConfig(county: string): CountyConfig | null {
  return COUNTY_CONFIGS[county] ?? null;
}

// ---------------------------------------------------------------------------
// Resilient fetch with timeout + exponential backoff on timeout / 5xx.
// ---------------------------------------------------------------------------
async function fetchJson(
  url: string,
  { retries = 3, timeoutMs = 25_000 }: { retries?: number; timeoutMs?: number } = {}
): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "dc-risk-intel/0.1 (risk-analysis demo)" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 500) {
        throw new Error(`upstream ${res.status}`);
      }
      if (!res.ok) {
        // 4xx is not retryable — surface immediately.
        throw new Error(`HTTP ${res.status} from ${url}`);
      }
      return await res.json();
    } catch (e: any) {
      lastErr = e;
      const retryable =
        e?.name === "TimeoutError" ||
        /upstream 5\d\d/.test(String(e?.message)) ||
        e?.name === "AbortError";
      if (attempt < retries && retryable) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      break;
    }
  }
  throw new Error(
    `parcel endpoint unreachable: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

function withParams(base: string, params: Record<string, string | number | boolean>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

// ---------------------------------------------------------------------------
// Resolve the parcel LAYER URL for an ArcGIS county.
//   - If the config already points at .../FeatureServer/{n}, use it.
//   - Otherwise read {base}?f=json, pick the layer whose name matches /parcel/i,
//     build .../FeatureServer/{id}, persist it to parcel_config, and log it.
// ---------------------------------------------------------------------------
const layerUrlCache = new Map<string, string>();

export async function resolveLayerUrl(
  county: string,
  log: (msg: string) => void = (m) => console.log(m)
): Promise<string> {
  if (layerUrlCache.has(county)) return layerUrlCache.get(county)!;

  // Persisted resolution (survives restarts).
  try {
    const rows = await query<{ feature_server_layer_url: string }>(
      `SELECT feature_server_layer_url FROM parcel_config WHERE county = $1`,
      [county]
    );
    if (rows[0]?.feature_server_layer_url) {
      layerUrlCache.set(county, rows[0].feature_server_layer_url);
      return rows[0].feature_server_layer_url;
    }
  } catch {
    /* parcel_config may not exist yet in some envs; fall through to live resolve */
  }

  const cfg = getCountyConfig(county);
  if (!cfg || cfg.portal !== "arcgis" || !cfg.featureServerUrl) {
    throw new Error(`no ArcGIS FeatureServer configured for county '${county}'`);
  }

  const base = cfg.featureServerUrl.replace(/\/+$/, "");
  // Already a fully-qualified layer URL?
  if (/\/FeatureServer\/\d+$/.test(base)) {
    await persistLayerUrl(county, base);
    layerUrlCache.set(county, base);
    log(`[parcels] using configured layer URL for ${county}: ${base}`);
    return base;
  }

  // Discover the layer index from server metadata.
  const meta = await fetchJson(withParams(`${base}`, { f: "json" }));
  const layers: Array<{ id: number; name: string }> = meta?.layers ?? [];
  const match =
    layers.find((l) => /parcel/i.test(l.name)) ??
    layers.find((l) => /(assessor|cadastr|land\s*base)/i.test(l.name));
  if (!match) {
    throw new Error(
      `could not find a parcel layer on ${base} (layers: ${layers
        .map((l) => `${l.id}:${l.name}`)
        .join(", ")})`
    );
  }
  const resolved = `${base}/${match.id}`;
  log(`[parcels] resolved ${county} parcel layer -> ${resolved} (name="${match.name}")`);
  await persistLayerUrl(county, resolved);
  layerUrlCache.set(county, resolved);
  return resolved;
}

async function persistLayerUrl(county: string, url: string): Promise<void> {
  try {
    await query(
      `INSERT INTO parcel_config (county, feature_server_layer_url, resolved_at)
       VALUES ($1, $2, now())
       ON CONFLICT (county) DO UPDATE
         SET feature_server_layer_url = EXCLUDED.feature_server_layer_url, resolved_at = now()`,
      [county, url]
    );
  } catch {
    /* non-fatal: in-process cache still serves this run */
  }
}

// ---------------------------------------------------------------------------
// Field mapping helpers.
// ---------------------------------------------------------------------------
function pick(attrs: Record<string, any>, candidates: string[]): any {
  const lower = new Map(Object.keys(attrs).map((k) => [k.toLowerCase(), k]));
  for (const c of candidates) {
    const key = lower.get(c.toLowerCase());
    if (key !== undefined && attrs[key] !== undefined && attrs[key] !== null) {
      return attrs[key];
    }
  }
  return null;
}

function mapToStandard(
  attrs: Record<string, any>,
  geometry: GeoJSONGeometry | null,
  cfg: CountyConfig
): StandardParcel {
  const fm = cfg.field_mapping;
  const apnRaw = pick(attrs, fm.apn);
  const objectId = pick(attrs, ["OBJECTID", "FID", "OID"]);
  const apn =
    apnRaw != null ? String(apnRaw).trim() : objectId != null ? `oid:${objectId}` : "";
  const acreageRaw = pick(attrs, fm.acreage);
  return {
    county: cfg.county_name,
    state: cfg.state,
    apn,
    owner_name: textOrNull(pick(attrs, fm.owner_name)),
    land_use_code: textOrNull(pick(attrs, fm.land_use_code)),
    situs_address: textOrNull(pick(attrs, fm.situs_address)),
    acreage: acreageRaw != null && acreageRaw !== "" ? Number(acreageRaw) : null,
    geometry,
    raw: attrs,
  };
}

function textOrNull(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// ---------------------------------------------------------------------------
// Esri JSON geometry -> GeoJSON (fallback when a server rejects f=geojson).
// ---------------------------------------------------------------------------
function esriToGeoJSON(geom: any): GeoJSONGeometry | null {
  if (!geom) return null;
  if (Array.isArray(geom.rings)) {
    // Esri polygons: array of rings; outer rings CW, holes CCW. We keep rings as-is
    // (good enough for storage/adjacency); multiple outer rings -> MultiPolygon.
    const rings: number[][][] = geom.rings;
    return rings.length > 1
      ? { type: "MultiPolygon", coordinates: rings.map((r) => [r]) }
      : { type: "Polygon", coordinates: rings };
  }
  if (Array.isArray(geom.paths)) {
    const paths: number[][][] = geom.paths;
    return paths.length > 1
      ? { type: "MultiLineString", coordinates: paths }
      : { type: "LineString", coordinates: paths[0] };
  }
  if (typeof geom.x === "number" && typeof geom.y === "number") {
    return { type: "Point", coordinates: [geom.x, geom.y] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// WHERE-clause builder (ArcGIS SQL).
// ---------------------------------------------------------------------------
function escapeSql(v: string): string {
  return v.replace(/'/g, "''");
}

function buildWhere(criteria: ParcelCriteria, cfg: CountyConfig): string {
  const clauses: string[] = [];
  const fm = cfg.field_mapping;
  if (criteria.apns?.length) {
    const col = fm.apn[0];
    const list = criteria.apns.map((a) => `'${escapeSql(a)}'`).join(",");
    clauses.push(`${col} IN (${list})`);
  }
  if (criteria.ownerContains) {
    const col = fm.owner_name[0];
    clauses.push(`UPPER(${col}) LIKE '%${escapeSql(criteria.ownerContains.toUpperCase())}%'`);
  }
  if (criteria.landUseCodes?.length) {
    const col = fm.land_use_code[0];
    const list = criteria.landUseCodes.map((c) => `'${escapeSql(c)}'`).join(",");
    clauses.push(`${col} IN (${list})`);
  }
  if (criteria.rawWhere) clauses.push(`(${criteria.rawWhere})`);
  return clauses.length ? clauses.join(" AND ") : "1=1";
}

function spatialParams(criteria: ParcelCriteria): Record<string, string | number> {
  if (!criteria.near) return {};
  const { lat, lng, distanceMeters } = criteria.near;
  return {
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    distance: distanceMeters,
    units: "esriSRUnit_Meter",
    spatialRel: "esriSpatialRelIntersects",
    inSR: 4326,
  };
}

const PAGE_SIZE = 1000;

// ---------------------------------------------------------------------------
// getParcelCount — count-first check so the agent never blindly pulls 100k rows.
// ---------------------------------------------------------------------------
export async function getParcelCount(
  county: string,
  criteria: ParcelCriteria,
  log: (m: string) => void = () => {}
): Promise<number> {
  const cfg = getCountyConfig(county);
  if (!cfg) throw new Error(`unknown county '${county}'`);

  if (cfg.portal === "socrata") {
    return socrataCount(cfg, criteria);
  }

  const layerUrl = await resolveLayerUrl(county, log);
  const url = withParams(`${layerUrl}/query`, {
    where: buildWhere(criteria, cfg),
    returnCountOnly: true,
    f: "json", // count-only is not a geojson operation
    ...spatialParams(criteria),
  });
  const data = await fetchJson(url);
  return Number(data?.count ?? 0);
}

// ---------------------------------------------------------------------------
// queryParcels — paginated live fetch, normalised to StandardParcel[].
// Tries f=geojson; falls back to f=json + esriToGeoJSON if the server rejects it.
// ---------------------------------------------------------------------------
export async function queryParcels(
  county: string,
  criteria: ParcelCriteria,
  log: (m: string) => void = () => {}
): Promise<StandardParcel[]> {
  const cfg = getCountyConfig(county);
  if (!cfg) throw new Error(`unknown county '${county}'`);

  if (cfg.portal === "socrata") {
    return socrataQuery(cfg, criteria, log);
  }

  const layerUrl = await resolveLayerUrl(county, log);
  const where = buildWhere(criteria, cfg);
  const spatial = spatialParams(criteria);
  const cap = criteria.maxRecords ?? Infinity;

  const out: StandardParcel[] = [];
  let offset = 0;
  let useGeojson = true;

  while (out.length < cap) {
    const fmt = useGeojson ? "geojson" : "json";
    const url = withParams(`${layerUrl}/query`, {
      where,
      outFields: "*",
      returnGeometry: true,
      outSR: 4326,
      f: fmt,
      resultOffset: offset,
      resultRecordCount: PAGE_SIZE,
      ...spatial,
    });

    let data: any;
    try {
      data = await fetchJson(url);
    } catch (e) {
      if (useGeojson) {
        // Some servers reject f=geojson — retry this page as Esri JSON.
        log(`[parcels] f=geojson failed, falling back to f=json for ${county}`);
        useGeojson = false;
        continue;
      }
      throw e;
    }

    // An ArcGIS error can come back as HTTP 200 with an {error:{...}} body.
    if (data?.error) {
      if (useGeojson) {
        useGeojson = false;
        continue;
      }
      throw new Error(`ArcGIS error: ${data.error?.message ?? JSON.stringify(data.error)}`);
    }

    let pageCount = 0;
    if (useGeojson) {
      const feats: any[] = data?.features ?? [];
      for (const f of feats) {
        out.push(mapToStandard(f.properties ?? {}, f.geometry ?? null, cfg));
        pageCount++;
        if (out.length >= cap) break;
      }
    } else {
      const feats: any[] = data?.features ?? [];
      for (const f of feats) {
        out.push(mapToStandard(f.attributes ?? {}, esriToGeoJSON(f.geometry), cfg));
        pageCount++;
        if (out.length >= cap) break;
      }
    }

    const exceeded = useGeojson
      ? data?.properties?.exceededTransferLimit ?? data?.exceededTransferLimit
      : data?.exceededTransferLimit;

    if (!exceeded || pageCount === 0) break;
    offset += PAGE_SIZE;
  }

  log(`[parcels] ${county}: fetched ${out.length} parcels (where: ${where})`);
  return out;
}

// ---------------------------------------------------------------------------
// Socrata SODA fallback (e.g. data.sccgov.org). where/$limit/$offset paging.
// ---------------------------------------------------------------------------
function socrataHeaders(): Record<string, string> {
  const token = process.env.SOCRATA_APP_TOKEN;
  return token ? { "X-App-Token": token } : {};
}

async function socrataCount(cfg: CountyConfig, criteria: ParcelCriteria): Promise<number> {
  if (!cfg.socrataDomain || !cfg.socrataDataset) throw new Error("socrata config missing");
  const base = `https://${cfg.socrataDomain}/resource/${cfg.socrataDataset}.json`;
  const url = withParams(base, {
    $select: "count(1) as n",
    ...(buildWhere(criteria, cfg) !== "1=1" ? { $where: socrataWhere(criteria, cfg) } : {}),
  });
  const res = await fetch(url, { headers: socrataHeaders(), signal: AbortSignal.timeout(25_000) });
  const rows = await res.json();
  return Number(rows?.[0]?.n ?? 0);
}

function socrataWhere(criteria: ParcelCriteria, cfg: CountyConfig): string {
  // Socrata uses SoQL (similar to SQL). Reuse the same column mapping.
  return buildWhere(criteria, cfg);
}

async function socrataQuery(
  cfg: CountyConfig,
  criteria: ParcelCriteria,
  log: (m: string) => void
): Promise<StandardParcel[]> {
  if (!cfg.socrataDomain || !cfg.socrataDataset) throw new Error("socrata config missing");
  const base = `https://${cfg.socrataDomain}/resource/${cfg.socrataDataset}.json`;
  const cap = criteria.maxRecords ?? Infinity;
  const out: StandardParcel[] = [];
  let offset = 0;
  const limit = 1000;

  while (out.length < cap) {
    const params: Record<string, string | number> = { $limit: limit, $offset: offset };
    if (buildWhere(criteria, cfg) !== "1=1") params.$where = socrataWhere(criteria, cfg);
    const url = withParams(base, params);
    const res = await fetch(url, { headers: socrataHeaders(), signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`Socrata HTTP ${res.status}`);
    const rows: any[] = await res.json();
    if (!rows.length) break;
    for (const r of rows) {
      // Socrata returns geometry under a 'the_geom'/'geometry' GeoJSON field if present.
      const geom = (r.the_geom ?? r.geometry ?? null) as GeoJSONGeometry | null;
      out.push(mapToStandard(r, geom, cfg));
      if (out.length >= cap) break;
    }
    if (rows.length < limit) break;
    offset += limit;
  }
  log(`[parcels] ${cfg.county_name} (socrata): fetched ${out.length} parcels`);
  return out;
}
