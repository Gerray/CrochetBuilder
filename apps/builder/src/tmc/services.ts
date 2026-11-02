/**
 * Everything the upload needs from outside; tests replace all of it. Null means the build is not
 * configured: then nothing of the upload shows and nothing of it loads.
 */

import type { FetchLike } from "./api.js";
import { loadSupabaseClient, type TmcAuthClient } from "./client.js";
import { readTmcConfig, type TmcConfig } from "./config.js";

export interface TmcServices {
  config: TmcConfig;
  loadClient: () => Promise<TmcAuthClient>;
  fetch: FetchLike;
  /** A fresh `builderKey`. */
  newKey: () => string;
  now: () => number;
}

export function defaultTmcServices(config: TmcConfig | null = readTmcConfig()): TmcServices | null {
  if (!config) return null;
  return {
    config,
    loadClient: () => loadSupabaseClient(config),
    fetch: (url, init) => globalThis.fetch(url, init),
    newKey: () => crypto.randomUUID(),
    now: () => Date.now(),
  };
}
