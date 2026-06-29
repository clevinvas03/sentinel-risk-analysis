import { promises as fs } from "fs";
import path from "path";
import {
  COUNTY_CONFIGS,
  getCountyConfig,
  getParcelCount,
  queryParcels,
  type CountyConfig,
  type ParcelCriteria,
  type StandardParcel,
} from "../parcelClient";
import {
  apnsAreFresh,
  findAdjacent,
  getParcelsByApns,
  getFreshQueryCache,
  hashCriteria,
  recordQueryCache,
  upsertParcels,
  type EnrichedParcel,
} from "../parcelCache";
import { mapLandUseCodes, normaliseOwner } from "../landUse";
import type { ToolContext, ToolHandler } from "./types";

// Above this many matches we DON'T auto-fetch — we tell the agent the count and ask
// it to narrow (or pass max_records explicitly). Prevents pulling 100k+ rows.
const COUNT_FETCH_THRESHOLD = 500;

function resolveCountyKey(input: any): string {
  const raw = String(input?.county ?? "santa-clara").trim().toLowerCase();
  const slug = raw.replace(/\s+/g, "-");
  if (COUNTY_CONFIGS[slug]) return slug;
  // also accept the human name
  const byName = Object.keys(COUNTY_CONFIGS).find(
    (k) => COUNTY_CONFIGS[k].county_name.toLowerCase() === raw
  );
  return byName ?? slug;
}

// Normalise (land use via cached LLM map, owner deterministically), key to the
// county SLUG so all DB ops are consistent, then UPSERT into PostGIS.
async function enrichAndCache(
  slug: string,
  parcels: StandardParcel[],
  source: "live" | "offline-sample"
): Promise<EnrichedParcel[]> {
  const codes = parcels.map((p) => p.land_use_code).filter(Boolean) as string[];
  const codeMap = codes.length ? await mapLandUseCodes(slug, codes) : new Map();
  const enriched: EnrichedParcel[] = parcels.map((p) => ({
    ...p,
    county: slug, // store under the slug for consistent keying / adjacency
    land_use_standard: p.land_use_code ? codeMap.get(p.land_use_code) ?? "OTHER" : null,
    owner_name_normalised: normaliseOwner(p.owner_name),
    source,
  }));
  // UPSERT both live and offline-sample parcels so spatial adjacency has geometry
  // to work with. Each row keeps its `source` ('live' | 'offline-sample'), and
  // offline runs never call recordQueryCache, so the search cache-hit path never
  // re-serves sample data as if it were live.
  try {
    await upsertParcels(enriched);
  } catch (e) {
    // Caching is best-effort; a PostGIS hiccup must not lose the result.
    console.error("parcel cache upsert failed:", e);
  }
  return enriched;
}

// Trim a parcel to the fields the model needs (keeps tokens + sources lean).
function summarise(p: EnrichedParcel, cfg: CountyConfig) {
  return {
    apn: p.apn,
    county: cfg.county_name,
    owner: p.owner_name_normalised ?? p.owner_name,
    land_use_code: p.land_use_code,
    land_use: p.land_use_standard,
    situs_address: p.situs_address,
    acreage: p.acreage,
    has_geometry: !!p.geometry,
  };
}

function addParcelSources(
  parcels: { apn: string; situs_address: string | null }[],
  cfg: CountyConfig,
  slug: string,
  live: boolean,
  ctx: ToolContext,
  cap = 15
): void {
  for (const p of parcels.slice(0, cap)) {
    ctx.addSource({
      kind: "parcel",
      title: `${cfg.county_name} parcel ${p.apn}${p.situs_address ? ` — ${p.situs_address}` : ""}`,
      url: null,
      apn: p.apn,
      county: slug,
      live,
    });
  }
}

// ---------------------------------------------------------------------------
// Offline fallback fixture. Used ONLY when live querying fails (e.g. no network).
// Results are clearly labelled as offline sample data so the agent can say so.
// ---------------------------------------------------------------------------
async function loadDemoParcels(slug: string, cfg: CountyConfig): Promise<StandardParcel[]> {
  const file = path.join(process.cwd(), "data", "demo_parcels.geojson");
  const txt = await fs.readFile(file, "utf8");
  const fc = JSON.parse(txt);
  const feats: any[] = fc?.features ?? [];
  return feats.map((f) => {
    const a = f.properties ?? {};
    return {
      county: cfg.county_name,
      state: cfg.state,
      apn: String(a.APN ?? a.apn ?? ""),
      owner_name: a.OWNER ?? a.owner ?? null,
      land_use_code: a.USE_CODE ?? a.use_code ?? null,
      situs_address: a.SITUS ?? a.situs ?? null,
      acreage: a.ACRES != null ? Number(a.ACRES) : null,
      geometry: f.geometry ?? null,
      raw: a,
    } as StandardParcel;
  });
}

function filterDemo(parcels: StandardParcel[], criteria: ParcelCriteria): StandardParcel[] {
  return parcels.filter((p) => {
    if (criteria.apns?.length && !criteria.apns.includes(p.apn)) return false;
    if (
      criteria.ownerContains &&
      !(p.owner_name ?? "").toUpperCase().includes(criteria.ownerContains.toUpperCase())
    )
      return false;
    if (criteria.landUseCodes?.length && !criteria.landUseCodes.includes(p.land_use_code ?? ""))
      return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// TOOL: search_parcels — discovery with a count-first guard + 24h PostGIS cache.
// ---------------------------------------------------------------------------
export const searchParcels: ToolHandler = async (input, ctx) => {
  const slug = resolveCountyKey(input);
  const cfg = getCountyConfig(slug);
  if (!cfg) {
    return JSON.stringify({
      error: `county '${slug}' is not configured. Configured: ${Object.keys(COUNTY_CONFIGS).join(", ")}`,
    });
  }

  const criteria: ParcelCriteria = {
    apns: input?.apns,
    ownerContains: input?.owner_contains,
    landUseCodes: input?.land_use_codes,
    rawWhere: input?.where,
    near:
      input?.near && Number.isFinite(input.near.lat) && Number.isFinite(input.near.lng)
        ? {
            lat: Number(input.near.lat),
            lng: Number(input.near.lng),
            distanceMeters: Number(input.near.distance_m ?? 1000),
          }
        : undefined,
    maxRecords: input?.max_records ? Number(input.max_records) : undefined,
  };

  const log = (m: string) => ctx.emitTrace(m.replace(/^\[parcels\]\s*/, "Parcels: "));
  const hash = hashCriteria(slug, criteria);

  // 1) Serve from the local PostGIS cache if this exact query is < 24h old.
  try {
    const cachedApns = await getFreshQueryCache(slug, hash);
    if (cachedApns && (await apnsAreFresh(slug, cachedApns))) {
      ctx.emitTrace("Parcels: serving from local cache (<24h fresh)", `${cachedApns.length} parcels`);
      const records = await getParcelsByApns(slug, cachedApns);
      addParcelSources(records, cfg, slug, true, ctx);
      return JSON.stringify({
        county: cfg.county_name,
        source: "live (cached <24h)",
        count: records.length,
        parcels: records.map((r) => ({
          apn: r.apn,
          county: cfg.county_name,
          owner: r.owner_name_normalised ?? r.owner_name,
          land_use_code: r.land_use_code,
          land_use: r.land_use_standard,
          situs_address: r.situs_address,
          acreage: r.acreage,
          has_geometry: !!r.geometry,
        })),
      });
    }
  } catch {
    /* cache miss path below */
  }

  // 2) Count-first so we never blindly pull a huge result set.
  try {
    ctx.emitTrace("Parcels: checking match count (live)", `${cfg.county_name}`);
    const count = await getParcelCount(slug, criteria, log);
    ctx.emitTrace("Parcels: matches", String(count));

    if (count === 0) {
      return JSON.stringify({ county: cfg.county_name, source: "live", count: 0, parcels: [] });
    }
    if (count > COUNT_FETCH_THRESHOLD && !criteria.maxRecords) {
      return JSON.stringify({
        county: cfg.county_name,
        source: "live",
        count,
        fetched: false,
        guidance: `${count} parcels match — too many to fetch at once. Narrow the criteria (e.g. add owner_contains, land_use_codes, or a tighter 'near' radius), or pass max_records to fetch a capped sample.`,
      });
    }

    // 3) Live fetch (paginated) -> normalise -> cache.
    ctx.emitTrace("Parcels: fetching live from county FeatureServer");
    const raw = await queryParcels(slug, criteria, log);
    const enriched = await enrichAndCache(slug, raw, "live");
    // Recording the query cache is best-effort — a missing/unreachable DB (e.g. a
    // serverless deploy with no database) must not fail an otherwise-successful
    // live fetch.
    try {
      await recordQueryCache(slug, hash, criteria, enriched.map((p) => p.apn).filter(Boolean));
    } catch (e) {
      console.error("recordQueryCache failed (non-fatal):", e);
    }
    addParcelSources(enriched, cfg, slug, true, ctx);

    return JSON.stringify({
      county: cfg.county_name,
      source: "live",
      count: enriched.length,
      parcels: enriched.map((p) => summarise(p, cfg)),
    });
  } catch (liveErr: any) {
    // 4) Honest offline fallback (clearly labelled).
    return offlineFallback(slug, cfg, criteria, ctx, liveErr);
  }
};

async function offlineFallback(
  slug: string,
  cfg: CountyConfig,
  criteria: ParcelCriteria,
  ctx: ToolContext,
  liveErr: any
): Promise<string> {
  ctx.emitTrace(
    "Parcels: live county endpoint unreachable — using OFFLINE SAMPLE data",
    String(liveErr?.message ?? liveErr)
  );
  try {
    const demo = filterDemo(await loadDemoParcels(slug, cfg), criteria);
    const enriched = await enrichAndCache(slug, demo, "offline-sample");
    addParcelSources(enriched, cfg, slug, false, ctx);
    return JSON.stringify({
      county: cfg.county_name,
      source: "offline sample data",
      live_error: String(liveErr?.message ?? liveErr),
      warning:
        "Live county data was unreachable. These are OFFLINE SAMPLE parcels — tell the user the results are illustrative sample data, not current assessor records.",
      count: enriched.length,
      parcels: enriched.map((p) => summarise(p, cfg)),
    });
  } catch {
    return JSON.stringify({
      error: `live county endpoint unreachable and no offline fixture available: ${liveErr?.message ?? liveErr}`,
    });
  }
}

// ---------------------------------------------------------------------------
// TOOL: get_parcel — single parcel by APN (cache-first, else live).
// ---------------------------------------------------------------------------
export const getParcel: ToolHandler = async (input, ctx) => {
  const slug = resolveCountyKey(input);
  const cfg = getCountyConfig(slug);
  const apn = String(input?.apn ?? "").trim();
  if (!cfg) return JSON.stringify({ error: `county '${slug}' not configured` });
  if (!apn) return JSON.stringify({ error: "apn is required" });

  try {
    if (await apnsAreFresh(slug, [apn])) {
      ctx.emitTrace("Parcels: parcel from local cache (<24h)", apn);
      const [r] = await getParcelsByApns(slug, [apn]);
      if (r) {
        addParcelSources([r], cfg, slug, true, ctx);
        return JSON.stringify({ source: "live (cached <24h)", parcel: r });
      }
    }
  } catch {
    /* fall through to live */
  }

  try {
    ctx.emitTrace("Parcels: fetching parcel live", apn);
    const raw = await queryParcels(slug, { apns: [apn], maxRecords: 1 }, (m) =>
      ctx.emitTrace(m.replace(/^\[parcels\]\s*/, "Parcels: "))
    );
    if (!raw.length) return JSON.stringify({ source: "live", found: false, apn });
    const enriched = await enrichAndCache(slug, raw, "live");
    addParcelSources(enriched, cfg, slug, true, ctx);
    return JSON.stringify({ source: "live", parcel: summarise(enriched[0], cfg) });
  } catch (e: any) {
    return offlineFallback(slug, cfg, { apns: [apn], maxRecords: 1 }, ctx, e);
  }
};

// ---------------------------------------------------------------------------
// TOOL: find_adjacent_parcels — spatial adjacency against local PostGIS.
// Ensures the target + its neighbourhood are cached (live proximity fetch) first.
// ---------------------------------------------------------------------------
export const findAdjacentParcels: ToolHandler = async (input, ctx) => {
  const slug = resolveCountyKey(input);
  const cfg = getCountyConfig(slug);
  const apn = String(input?.apn ?? "").trim();
  const distanceM = Number(input?.distance_m ?? 0);
  if (!cfg) return JSON.stringify({ error: `county '${slug}' not configured` });
  if (!apn) return JSON.stringify({ error: "apn is required" });

  try {
    // Make sure the target is cached.
    let [target] = await getParcelsByApns(slug, [apn]);
    if (!target) {
      ctx.emitTrace("Parcels: fetching target parcel live", apn);
      const raw = await queryParcels(slug, { apns: [apn], maxRecords: 1 });
      if (!raw.length) return JSON.stringify({ found: false, apn });
      await enrichAndCache(slug, raw, "live");
      [target] = await getParcelsByApns(slug, [apn]);
    }

    // Populate the neighbourhood around the target's centroid so adjacency has
    // candidates to test against (best-effort; adjacency still runs on whatever
    // is cached if this fails).
    if (target?.geometry) {
      const c = centroid(target.geometry);
      if (c) {
        try {
          ctx.emitTrace("Parcels: populating neighbourhood (live)", `${distanceM || 250} m radius`);
          const near = await queryParcels(slug, {
            near: { lat: c.lat, lng: c.lng, distanceMeters: Math.max(distanceM, 250) },
            maxRecords: 200,
          });
          await enrichAndCache(slug, near, "live");
        } catch {
          /* adjacency falls back to whatever is already cached */
        }
      }
    }

    ctx.emitTrace("Parcels: computing adjacency (PostGIS)", apn);
    const { target: t, neighbours } = await findAdjacent(slug, apn, distanceM);
    addParcelSources(
      [...(t ? [t] : []), ...neighbours],
      cfg,
      slug,
      true,
      ctx
    );
    return JSON.stringify({
      county: cfg.county_name,
      target: t
        ? { apn: t.apn, owner: t.owner_name_normalised ?? t.owner_name, land_use: t.land_use_standard, situs_address: t.situs_address }
        : null,
      neighbour_count: neighbours.length,
      neighbours: neighbours.map((n) => ({
        apn: n.apn,
        owner: n.owner_name_normalised ?? n.owner_name,
        land_use: n.land_use_standard,
        situs_address: n.situs_address,
        acreage: n.acreage,
      })),
      note:
        distanceM > 0
          ? `Neighbours share a boundary or fall within ${distanceM} m.`
          : "Neighbours share a boundary (touching parcels).",
    });
  } catch (e: any) {
    return JSON.stringify({ error: `adjacency failed: ${e?.message ?? e}` });
  }
};

// Rough centroid of a GeoJSON geometry (good enough to centre a proximity query).
function centroid(geom: any): { lat: number; lng: number } | null {
  const coords: number[][] = [];
  const walk = (c: any) => {
    if (typeof c?.[0] === "number" && typeof c?.[1] === "number") coords.push(c);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(geom?.coordinates);
  if (!coords.length) return null;
  const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return { lat, lng };
}
