/**
 * Environment configuration
 */

// .env is loaded by constants.ts, which is imported here first
import { ANIME_PROVIDER_IDENTIFIER, ANIME_PROVIDER_TITLE } from '../constants';

const SOURCES = ['jikan', 'mal', 'anidb'] as const;
export type MetadataSource = (typeof SOURCES)[number];

/**
 * URL under which Plex reaches the provider. Without a port, PORT is added
 * ("http://192.168.1.10" → "http://192.168.1.10:3000"); write ":80" / ":443" explicitly for a reverse proxy.
 * Empty = http://localhost:PORT
 */
export function providerUrl(value: string | undefined, port: string | number): string {
  const v = (value || '').trim().replace(/\/+$/, '');
  if (!v) return `http://localhost:${port}`;
  const m = v.match(/^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i);
  if (!m) return v;
  const [, scheme, host, rest] = m;
  // host already has a port: "name:3000" or "[::1]:3000"
  if (/:\d+$/.test(host) && !/^\[[^\]]*\]$/.test(host)) return v;
  return `${scheme}${host}:${port}${rest}`;
}

function parseSource(v: string | undefined): MetadataSource {
  const s = (v || 'jikan').trim().toLowerCase();
  if (s === 'malv2' || s === 'mal_v2' || s === 'myanimelist') return 'mal';
  return s as MetadataSource; // unknown values are rejected by validateConfig()
}

/**
 * Environment configuration object
 */
export const config = {
  /** Which backend serves metadata: jikan | mal | anidb */
  source: parseSource(process.env.METADATA_SOURCE),
  jikan: {
    baseURL: process.env.JIKAN_BASE_URL || 'http://localhost:8080/v4',
    rateLimitPerSecond: parseInt(process.env.JIKAN_RATE_LIMIT_PER_SECOND || '3', 10),
    rateLimitPerMinute: parseInt(process.env.JIKAN_RATE_LIMIT_PER_MINUTE || '60', 10),
    timeoutMs: parseInt(process.env.JIKAN_TIMEOUT_MS || '20000', 10),
    retries: parseInt(process.env.JIKAN_RETRIES || '3', 10),
  },
  mal: {
    baseURL: process.env.MAL_API_BASE_URL || 'https://api.myanimelist.net/v2',
    clientId: process.env.MAL_CLIENT_ID || '',
    requestsPerSecond: parseFloat(process.env.MAL_REQUESTS_PER_SECOND || '2'),
  },
  anidb: {
    client: (process.env.ANIDB_CLIENT || '').trim().toLowerCase(), // AniDB expects the lowercase name
    clientVersion: process.env.ANIDB_CLIENT_VERSION || '1',
    apiURL: process.env.ANIDB_API_URL || 'http://api.anidb.net:9001/httpapi',
    titlesURL: process.env.ANIDB_TITLES_URL || 'https://anidb.net/api/anime-titles.xml.gz',
    imageBaseURL: process.env.ANIDB_IMAGE_BASE_URL || 'https://cdn-eu.anidb.net/images/main',
    cacheDir: process.env.ANIDB_CACHE_DIR || './cache/anidb',
    cacheHours: parseFloat(process.env.ANIDB_CACHE_HOURS || '24'),
    titlesRefreshHours: parseFloat(process.env.ANIDB_TITLES_REFRESH_HOURS || '24'),
    requestIntervalMs: parseInt(process.env.ANIDB_REQUEST_INTERVAL_MS || '2500', 10),
    minTagWeight: parseInt(process.env.ANIDB_MIN_TAG_WEIGHT || '300', 10),
  },
  match: {
    /** false = example-provider matching (trust the API's top result) */
    scoring: process.env.MATCH_SCORING === 'true',
  },
  collections: {
    /** Group franchise entries into Plex collections (true/false) */
    enabled: process.env.COLLECTIONS !== 'false',
    /** Download Fribb's lists into cache/collections (true) or only read the files there (false) */
    download: process.env.LISTS_DOWNLOAD !== 'false',
    /** Re-match shows of an outdated METADATA_SOURCE to their counterpart (false = keep the ID, collection only) */
    rematch: process.env.REMATCH_OUTDATED === 'true',
    /** Hours between automatic collection syncs into Plex (0 = only on demand) */
    syncHours: parseFloat(process.env.COLLECTION_SYNC_HOURS || '6'),
  },
  plex: {
    url: process.env.PLEX_URL || 'http://localhost:32400',
    token: process.env.PLEX_TOKEN || '',
    library: process.env.PLEX_LIBRARY || 'Anime',
  },
  cache: {
    animeDetailsHours: parseInt(process.env.CACHE_ANIME_DETAILS_HOURS || '24', 10),
    episodesHours: parseInt(process.env.CACHE_EPISODES_HOURS || '12', 10),
    searchHours: parseInt(process.env.CACHE_SEARCH_HOURS || '1', 10),
    charactersDays: parseInt(process.env.CACHE_CHARACTERS_DAYS || '7', 10),
  },
  provider: {
    identifier: ANIME_PROVIDER_IDENTIFIER,
    title: ANIME_PROVIDER_TITLE,
    version: process.env.PROVIDER_VERSION || '1.0.0',
    /** URL under which Plex reaches the provider (registration), see providerUrl() */
    url: providerUrl(process.env.PROVIDER_URL, process.env.PORT || '3000'),
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    logRequests: process.env.LOG_REQUESTS === 'true',
    logApiCalls: process.env.LOG_API_CALLS === 'true',
  },
  preferences: {
    titleLanguage: (process.env.TITLE_LANGUAGE || 'romaji') as 'english' | 'romaji' | 'japanese' | 'german' | 'french' | 'spanish',
  },
};

/** Human-readable description of the active backend (startup banner / health) */
export function describeSource(): string {
  const mal =
    config.source === 'mal'
      ? `MyAnimeList API v2 (${config.mal.baseURL})`
      : `Jikan (${config.jikan.baseURL})`;
  const anidb = `AniDB (client=${config.anidb.client || '?'})`;
  const def = config.source === 'anidb' ? anidb : mal;
  const tagged = config.anidb.client
    ? ` | {anidb-…} folders → ${anidb} | {mal-…} folders → ${mal}`
    : ' | {anidb-…} tags translated to MAL IDs (no ANIDB_CLIENT)';
  return `untagged → ${def}${tagged}`;
}

/**
 * Validates that required environment variables are set
 */
export function validateConfig(): void {
  const errors: string[] = [];

  if (!(SOURCES as readonly string[]).includes(config.source)) {
    errors.push(`METADATA_SOURCE must be one of: ${SOURCES.join(', ')} (got "${process.env.METADATA_SOURCE}")`);
  }

  if (config.source === 'jikan' && !config.jikan.baseURL) {
    errors.push('JIKAN_BASE_URL is not set');
  }

  if (config.source === 'mal' && !config.mal.clientId) {
    errors.push('MAL_CLIENT_ID is required when METADATA_SOURCE=mal (MAL → Account Settings → API)');
  }

  if (config.source === 'anidb') {
    if (!config.anidb.client) {
      errors.push('ANIDB_CLIENT is required when METADATA_SOURCE=anidb (register a client at https://anidb.net/software/add)');
    } else if (!/^[a-z0-9]+$/.test(config.anidb.client)) {
      errors.push('ANIDB_CLIENT must be lowercase letters/digits only, exactly as registered on AniDB');
    }
    if (!/^\d+$/.test(config.anidb.clientVersion)) {
      errors.push('ANIDB_CLIENT_VERSION must be an integer (the version registered on AniDB)');
    }
  }

  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }
}
