import { BlennyConfig } from "../config.ts";

export function loadConfig(): BlennyConfig {
  const config = new BlennyConfig();
  config.logSources();
  return config;
}

export function checkJwtSecret(config: BlennyConfig): void {
  if (config.jwtSecret !== "CHANGE-ME-EMBEDDED-DEFAULT") return;
  if (config.devMode) {
    console.warn(
      "WARNING: auth.jwt_secret is the embedded default. " +
        "Set BLENNY_AUTH_JWT_SECRET or add it to blenny.json for any non-development deployment.",
    );
  } else {
    console.error(
      "FATAL: auth.jwt_secret is still the embedded default. " +
        "Set BLENNY_AUTH_JWT_SECRET or add it to blenny.json before deploying to production.",
    );
    Deno.exit(1);
  }
}
