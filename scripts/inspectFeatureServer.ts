/**
 * Inspect an ArcGIS FeatureServer to build a field_mapping for a new county.
 *
 *   npx tsx scripts/inspectFeatureServer.ts <featureServerOrLayerUrl>
 *
 * Examples:
 *   # List the layers on a FeatureServer (find the parcel layer's index):
 *   npx tsx scripts/inspectFeatureServer.ts \
 *     https://host/arcgis/rest/services/Parcels/FeatureServer
 *
 *   # Print the fields of a specific layer (to fill field_mapping candidates):
 *   npx tsx scripts/inspectFeatureServer.ts \
 *     https://host/arcgis/rest/services/Parcels/FeatureServer/0
 *
 * Onboarding a new county = add one CountyConfig entry in lib/parcelClient.ts with
 * the FeatureServer URL + a field_mapping built from this script's output.
 */

async function getJson(url: string): Promise<any> {
  const u = new URL(url);
  u.searchParams.set("f", "json");
  const res = await fetch(u.toString(), {
    headers: { "User-Agent": "dc-risk-intel/0.1 (risk-analysis demo)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${u.toString()}`);
  return res.json();
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: npx tsx scripts/inspectFeatureServer.ts <featureServerOrLayerUrl>");
    process.exit(1);
  }

  const base = url.replace(/\/+$/, "");
  const isLayer = /\/FeatureServer\/\d+$/.test(base);

  if (!isLayer) {
    // FeatureServer root -> list layers so the user can pick the parcel layer index.
    const meta = await getJson(base);
    const layers: Array<{ id: number; name: string }> = meta?.layers ?? [];
    console.log(`FeatureServer: ${base}`);
    console.log(`Layers (${layers.length}):`);
    for (const l of layers) {
      const flag = /parcel/i.test(l.name) ? "  <-- looks like the parcel layer" : "";
      console.log(`  [${l.id}] ${l.name}${flag}`);
    }
    console.log(
      `\nRe-run with .../FeatureServer/<id> to print that layer's fields, e.g.\n  npx tsx scripts/inspectFeatureServer.ts ${base}/${
        layers.find((l) => /parcel/i.test(l.name))?.id ?? 0
      }`
    );
    return;
  }

  // Layer -> print field names/types/aliases to build field_mapping candidates.
  const meta = await getJson(base);
  console.log(`Layer: ${meta?.name ?? base}  (geometryType: ${meta?.geometryType ?? "?"})`);
  const fields: Array<{ name: string; type: string; alias?: string }> = meta?.fields ?? [];
  console.log(`Fields (${fields.length}):`);
  for (const f of fields) {
    console.log(`  ${f.name}  (${f.type})${f.alias && f.alias !== f.name ? `  — ${f.alias}` : ""}`);
  }
  console.log(
    `\nSuggested field_mapping starting points (verify against the names above):\n` +
      `  apn:           ${guess(fields, ["apn", "parcel", "asmt"])}\n` +
      `  owner_name:    ${guess(fields, ["owner", "ownernme"])}\n` +
      `  land_use_code: ${guess(fields, ["use", "landuse", "zoning"])}\n` +
      `  situs_address: ${guess(fields, ["situs", "addr", "address"])}\n` +
      `  acreage:       ${guess(fields, ["acre", "acres"])}`
  );
}

function guess(fields: Array<{ name: string }>, needles: string[]): string {
  const hits = fields
    .map((f) => f.name)
    .filter((n) => needles.some((nd) => n.toLowerCase().includes(nd)));
  return hits.length ? `["${hits.join('", "')}"]` : "[]  (none obvious — inspect manually)";
}

main().catch((e) => {
  console.error("error:", e?.message ?? e);
  process.exit(1);
});
