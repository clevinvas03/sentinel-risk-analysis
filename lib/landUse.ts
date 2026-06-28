// Normalisation that runs on LIVE returned parcel rows:
//   - land_use_code -> STANDARD taxonomy via Claude, CACHED per county so the model
//     is only called when a brand-new, unseen code appears.
//   - owner_name -> deterministic cleanup (cheap, no per-row LLM cost; can be
//     upgraded to an LLM pass if richer entity resolution is needed).

import { getAnthropic, NORMALISER_MODEL } from "./anthropic";
import { query } from "./db";

// STANDARD land-use taxonomy. Data-centre siting cares most about INDUSTRIAL,
// UTILITY_INFRASTRUCTURE, and VACANT_LAND, so they are first-class classes.
export const STANDARD_LAND_USE = [
  "RESIDENTIAL",
  "COMMERCIAL",
  "INDUSTRIAL",
  "UTILITY_INFRASTRUCTURE",
  "AGRICULTURAL",
  "VACANT_LAND",
  "PUBLIC_INSTITUTIONAL",
  "MIXED_USE",
  "OTHER",
] as const;

export type StandardLandUse = (typeof STANDARD_LAND_USE)[number];

// Map a set of county land_use_codes to STANDARD classes, using the per-county
// cache and only calling Claude for codes not seen before.
export async function mapLandUseCodes(
  county: string,
  codes: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = Array.from(new Set(codes.filter((c) => c && c.trim() !== "")));
  if (unique.length === 0) return result;

  // 1) cached mappings
  const cached = await query<{ land_use_code: string; standard_class: string }>(
    `SELECT land_use_code, standard_class FROM land_use_mappings
     WHERE county = $1 AND land_use_code = ANY($2)`,
    [county, unique]
  );
  for (const row of cached) result.set(row.land_use_code, row.standard_class);

  const unseen = unique.filter((c) => !result.has(c));
  if (unseen.length === 0) return result;

  // 2) ask Claude only for the unseen codes
  let mapping: Record<string, string> = {};
  try {
    mapping = await classifyWithClaude(county, unseen);
  } catch (e) {
    // On failure, fall back to OTHER so ingestion never breaks; don't cache failures.
    for (const c of unseen) result.set(c, "OTHER");
    return result;
  }

  // 3) persist + merge
  for (const code of unseen) {
    const cls = STANDARD_LAND_USE.includes(mapping[code] as StandardLandUse)
      ? mapping[code]
      : "OTHER";
    result.set(code, cls);
    try {
      await query(
        `INSERT INTO land_use_mappings (county, land_use_code, standard_class)
         VALUES ($1,$2,$3)
         ON CONFLICT (county, land_use_code) DO UPDATE SET standard_class = EXCLUDED.standard_class`,
        [county, code, cls]
      );
    } catch {
      /* non-fatal */
    }
  }
  return result;
}

async function classifyWithClaude(
  county: string,
  codes: string[]
): Promise<Record<string, string>> {
  const client = getAnthropic();
  const res = await client.messages.create({
    model: NORMALISER_MODEL,
    max_tokens: 1024,
    system:
      `You map county assessor land-use codes to a fixed STANDARD taxonomy. ` +
      `Allowed classes: ${STANDARD_LAND_USE.join(", ")}. ` +
      `Reply ONLY with a compact JSON object mapping each input code (as a string key) ` +
      `to exactly one allowed class. If unsure, use "OTHER". No prose.`,
    messages: [
      {
        role: "user",
        content: `County: ${county}\nLand-use codes:\n${codes
          .map((c) => `- ${c}`)
          .join("\n")}`,
      },
    ],
  });
  const text = res.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON in classifier response");
  return JSON.parse(match[0]);
}

// Deterministic owner-name normalisation: uppercase, collapse whitespace, strip
// trailing punctuation, and standardise common entity suffixes. Cheap and stable.
export function normaliseOwner(name: string | null): string | null {
  if (!name) return null;
  let s = name.toUpperCase().replace(/\s+/g, " ").trim();
  s = s.replace(/[.,]+$/g, "").trim();
  s = s
    .replace(/\bL\.?L\.?C\.?\b/g, "LLC")
    .replace(/\bINC\.?\b/g, "INC")
    .replace(/\bCORP\.?\b/g, "CORP")
    .replace(/\bCO\.?\b/g, "CO")
    .replace(/\bL\.?P\.?\b/g, "LP")
    .replace(/\bTR(UST)?\b/g, "TRUST");
  return s.replace(/\s+/g, " ").trim() || null;
}
