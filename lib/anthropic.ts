import Anthropic from "@anthropic-ai/sdk";

// The app talks to any Anthropic-compatible endpoint. Two providers are wired:
//   - "anthropic" (default): api.anthropic.com, model claude-sonnet-4-6, x-api-key.
//   - "zai": Zhipu GLM via https://api.z.ai/api/anthropic, Bearer token, GLM models.
// Switch with env (see .env.example): LLM_PROVIDER + ANTHROPIC_BASE_URL +
// ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY + AGENT_MODEL.
export const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
export const IS_ANTHROPIC = LLM_PROVIDER === "anthropic";

const DEFAULT_BASE_URL =
  LLM_PROVIDER === "zai" ? "https://api.z.ai/api/anthropic" : undefined;

// The spec's default model for Anthropic; a sensible GLM default otherwise. Both
// overridable via AGENT_MODEL so you can pin e.g. glm-4.7 / glm-5.2 per your plan.
export const AGENT_MODEL =
  process.env.AGENT_MODEL ??
  (LLM_PROVIDER === "zai" ? "glm-4.6" : "claude-sonnet-4-6");

// Cheaper model for the land-use classification helper.
export const NORMALISER_MODEL =
  process.env.NORMALISER_MODEL ??
  (LLM_PROVIDER === "zai" ? "glm-4.5-air" : "claude-haiku-4-5");

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!client) {
    let baseURL = process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL;
    // Robustness: an ambient ANTHROPIC_BASE_URL (e.g. exported by a host shell or
    // another tool) can shadow .env. If we're configured for z.ai but the resolved
    // base points at Anthropic, force the z.ai endpoint — otherwise the GLM token
    // would be sent to api.anthropic.com and rejected.
    if (LLM_PROVIDER === "zai" && (!baseURL || /\/\/api\.anthropic\.com/i.test(baseURL))) {
      baseURL = "https://api.z.ai/api/anthropic";
    }
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!authToken && !apiKey) {
      throw new Error(
        "No LLM credentials set. For z.ai set ANTHROPIC_AUTH_TOKEN (+ LLM_PROVIDER=zai); " +
          "for Anthropic set ANTHROPIC_API_KEY."
      );
    }

    // Prefer a Bearer auth token (z.ai) over x-api-key (Anthropic). Pass exactly
    // one auth mechanism so we never send conflicting headers.
    client = authToken
      ? new Anthropic({ authToken, baseURL })
      : new Anthropic({ apiKey, baseURL });
  }
  return client;
}
