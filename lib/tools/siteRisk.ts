import type { ToolHandler } from "./types";

// Deterministic pseudo-random in [0,1) from a seed, so the same coordinates always
// return the same mock risk profile (stable demos, no flicker between calls).
function seeded(n: number): number {
  const x = Math.sin(n) * 10000;
  return x - Math.floor(x);
}

function band(v: number): "low" | "moderate" | "high" | "severe" {
  if (v < 0.3) return "low";
  if (v < 0.6) return "moderate";
  if (v < 0.85) return "high";
  return "severe";
}

export type SiteRisk = ReturnType<typeof getSiteRisk>;

// ---------------------------------------------------------------------------
// MOCK DATA LAYER.
// Each block below is where a real provider would plug in. The values are
// deterministic placeholders derived from the coordinates so the structure and
// shape are realistic for the agent to reason over.
// ---------------------------------------------------------------------------
export function getSiteRisk(lat: number, lng: number) {
  const s = Math.abs(lat * 31.7 + lng * 13.3);

  // FLOOD — TODO: replace with FEMA NFHL (US) / national flood maps (EU) lookup.
  const floodV = seeded(s + 1);
  // SEISMIC — TODO: replace with USGS seismic hazard / national PGA grids.
  const seismicV = seeded(s + 2);
  // CLIMATE — TODO: replace with downscaled IPCC scenario projections.
  const heatV = seeded(s + 3);
  const droughtV = seeded(s + 4);
  // GRID — TODO: replace with ENTSO-E / EIA / local TSO interconnection data.
  const gridHeadroomV = seeded(s + 5);
  // OPERATIONAL — TODO: replace with utility water-stress & connectivity datasets.
  const waterStressV = seeded(s + 6);
  const connectivityV = seeded(s + 7);

  return {
    coordinates: { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) },
    data_quality:
      "MOCK — illustrative values keyed to coordinates; wire FEMA/USGS/IPCC/ENTSO-E for production",
    flood: {
      rating: band(floodV),
      // 1% AEP = 1-in-100-year floodplain.
      in_100yr_floodplain: floodV > 0.7,
      pluvial_trend: floodV > 0.5 ? "increasing" : "stable",
    },
    seismic: {
      rating: band(seismicV),
      pga_g_475yr: Number((seismicV * 0.5).toFixed(2)), // peak ground accel, g
      nearby_faults: seismicV > 0.6,
    },
    climate: {
      heat_stress: band(heatV),
      cooling_degree_day_trend: heatV > 0.5 ? "rising" : "flat",
      drought_risk: band(droughtV),
    },
    grid: {
      interconnection_headroom: band(1 - gridHeadroomV), // low headroom = higher risk
      estimated_queue_years: Number((gridHeadroomV * 6).toFixed(1)),
      carbon_intensity: band(seeded(s + 8)),
    },
    operational: {
      water_stress: band(waterStressV),
      connectivity_diversity: band(1 - connectivityV), // low diversity = higher risk
    },
  };
}

// TOOL 5 — structured, layered risk data for a coordinate pair.
export const getSiteRiskData: ToolHandler = async (input, ctx) => {
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return JSON.stringify({ error: "numeric lat and lng are required" });
  }
  ctx.emitTrace("Fetching structured site risk", `${lat.toFixed(2)}, ${lng.toFixed(2)}`);
  return JSON.stringify(getSiteRisk(lat, lng));
};
