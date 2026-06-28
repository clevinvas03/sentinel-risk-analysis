import { geocode } from "./geocode";
import { getSiteRisk } from "./siteRisk";
import type { ToolHandler } from "./types";

type SiteInput =
  | string
  | { name?: string; lat?: number; lng?: number; label?: string };

// TOOL 6 — side-by-side structured risk comparison for any number of sites.
// Each site may be a place name (geocoded) or a {lat,lng} pair.
export const compareSites: ToolHandler = async (input, ctx) => {
  const sites: SiteInput[] = Array.isArray(input?.sites) ? input.sites : [];
  if (sites.length < 2) {
    return JSON.stringify({
      error: "provide at least two sites (place names or {lat,lng} pairs)",
    });
  }

  ctx.emitTrace(
    "Comparing sites",
    sites
      .map((s) => (typeof s === "string" ? s : s.name ?? s.label ?? "site"))
      .join(" vs ")
  );

  const resolved = await Promise.all(
    sites.map(async (site) => {
      let label: string;
      let lat: number | undefined;
      let lng: number | undefined;

      if (typeof site === "string") {
        label = site;
        const g = await geocode(site);
        if (g) {
          lat = g.lat;
          lng = g.lng;
          label = site;
        }
      } else if (
        Number.isFinite(Number(site.lat)) &&
        Number.isFinite(Number(site.lng))
      ) {
        lat = Number(site.lat);
        lng = Number(site.lng);
        label = site.name ?? site.label ?? `${lat},${lng}`;
      } else if (site.name) {
        label = site.name;
        const g = await geocode(site.name);
        if (g) {
          lat = g.lat;
          lng = g.lng;
        }
      } else {
        label = "unknown";
      }

      if (lat === undefined || lng === undefined) {
        return { site: label, error: "could not resolve to coordinates" };
      }
      return { site: label, ...getSiteRisk(lat, lng) };
    })
  );

  return JSON.stringify({
    comparison: resolved,
    note: "Structured risk layers are MOCK values keyed to coordinates; see get_site_risk_data plug points for real data sources.",
  });
};
