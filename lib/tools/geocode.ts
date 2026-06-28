import type { ToolHandler } from "./types";

export type GeoResult = {
  lat: number;
  lng: number;
  display_name: string;
};

// Core geocode used by both the tool and compare_sites.
export async function geocode(q: string): Promise<GeoResult | null> {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(q);
  const res = await fetch(url, {
    // Nominatim usage policy requires a descriptive User-Agent.
    headers: { "User-Agent": "dc-risk-intel/0.1 (risk-analysis demo)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const arr = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;
  if (!arr.length) return null;
  return {
    lat: parseFloat(arr[0].lat),
    lng: parseFloat(arr[0].lon),
    display_name: arr[0].display_name,
  };
}

// TOOL 4 — turn a place name / address into coordinates (OpenStreetMap Nominatim).
export const geocodeLocation: ToolHandler = async (input, ctx) => {
  const q: string = String(input?.query ?? input?.location ?? "").trim();
  if (!q) return JSON.stringify({ error: "query (a place name) is required" });

  ctx.emitTrace("Geocoding location", q);
  try {
    const r = await geocode(q);
    if (!r) return JSON.stringify({ error: `no match for '${q}'` });
    return JSON.stringify(r);
  } catch (e: any) {
    return JSON.stringify({ error: `geocoding failed: ${e?.message ?? e}` });
  }
};
