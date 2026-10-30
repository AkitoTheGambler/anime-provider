/**
 * Builds the metadata backends. Shared instances keep rate limits and caches global.
 *
 * Two ID spaces exist side by side:
 *   "anidb" → AniDB client (when ANIDB_CLIENT is configured)
 *   "mal"   → MyAnimeList-based client: MAL API v2 if METADATA_SOURCE=mal, else Jikan
 * METADATA_SOURCE picks the default for items without an ID tag in their folder name.
 */

import { config } from '../config/env';
import { AnimeDataSource, IdPrefix } from './AnimeDataSource';
import { JikanClient } from './JikanClient';
import { MalApiClient } from './MalApiClient';
import { AniDbClient } from './AniDbClient';

import { FranchiseList } from '../services/FranchiseCollections';
import { IdMapping } from '../services/IdMapping';

const sources: Partial<Record<IdPrefix, AnimeDataSource>> = {};
const franchiseLists: Partial<Record<IdPrefix, FranchiseList>> = {};
let sharedIdMapping: IdMapping | null = null;

/** ID space used for items without a tag (from METADATA_SOURCE) */
export function defaultPrefix(): IdPrefix {
  return config.source === 'anidb' ? 'anidb' : 'mal';
}

/** Is AniDB usable (registered client configured)? */
export function anidbAvailable(): boolean {
  return !!config.anidb.client;
}

function createSource(prefix: IdPrefix): AnimeDataSource {
  if (prefix === 'anidb') {
    return new AniDbClient({
      client: config.anidb.client,
      clientVersion: config.anidb.clientVersion,
      apiURL: config.anidb.apiURL,
      titlesURL: config.anidb.titlesURL,
      imageBaseURL: config.anidb.imageBaseURL,
      cacheDir: config.anidb.cacheDir,
      cacheHours: config.anidb.cacheHours,
      titlesRefreshHours: config.anidb.titlesRefreshHours,
      requestIntervalMs: config.anidb.requestIntervalMs,
      minTagWeight: config.anidb.minTagWeight,
      titleLanguage: config.preferences.titleLanguage,
    });
  }
  if (config.source === 'mal') {
    return new MalApiClient({
      baseURL: config.mal.baseURL,
      clientId: config.mal.clientId,
      requestsPerSecond: config.mal.requestsPerSecond,
    });
  }
  // METADATA_SOURCE=jikan, or anidb (then MAL-ID items are still served via Jikan)
  return new JikanClient(config.jikan.baseURL, {
    perSecond: config.jikan.rateLimitPerSecond,
    perMinute: config.jikan.rateLimitPerMinute,
    timeoutMs: config.jikan.timeoutMs,
    retries: config.jikan.retries,
  });
}

/** Data source for an ID space; null when AniDB is requested but not configured */
export function getSourceFor(prefix: IdPrefix): AnimeDataSource | null {
  if (prefix === 'anidb' && !anidbAvailable()) return null;
  if (!sources[prefix]) sources[prefix] = createSource(prefix);
  return sources[prefix]!;
}

/** Default data source (METADATA_SOURCE) */
export function getDataSource(): AnimeDataSource {
  return getSourceFor(defaultPrefix())!;
}

/** Kept for compatibility: builds a fresh default source */
export function createDataSource(): AnimeDataSource {
  return createSource(defaultPrefix());
}

/** Fribb franchise list for an ID space (MAL IDs or AniDB IDs) */
export function getFranchiseList(idType: IdPrefix = defaultPrefix()): FranchiseList {
  if (!franchiseLists[idType]) franchiseLists[idType] = new FranchiseList({ idType });
  return franchiseLists[idType]!;
}

/** Fribb cross-site ID mapping (for {anidb-…}/{mal-…}/{anilist-…} folder tags) */
export function getIdMapping(): IdMapping {
  if (!sharedIdMapping) sharedIdMapping = new IdMapping();
  return sharedIdMapping;
}
