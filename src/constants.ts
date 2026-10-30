/**
 * Constants for the Anime Metadata Provider
 */

import dotenv from 'dotenv';
import path from 'path';

// .env is loaded here (once), because PROVIDER_IDENTIFIER / PROVIDER_TITLE are read below
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true } as dotenv.DotenvConfigOptions);

/** Default identifier; changing it makes Plex treat the provider as a new one */
export const DEFAULT_PROVIDER_IDENTIFIER = 'tv.plex.agents.custom.anime';
/** Default name Plex shows for the provider */
export const DEFAULT_PROVIDER_TITLE = 'Anime';

// Provider identification (PROVIDER_IDENTIFIER / PROVIDER_TITLE in .env override the defaults)
export const ANIME_PROVIDER_IDENTIFIER = (process.env.PROVIDER_IDENTIFIER || '').trim() || DEFAULT_PROVIDER_IDENTIFIER;
export const ANIME_PROVIDER_TITLE = (process.env.PROVIDER_TITLE || '').trim() || DEFAULT_PROVIDER_TITLE;
export const ANIME_PROVIDER_VERSION = '1.0.0';

/**
 * Every collection this provider creates carries this summary ending — the
 * Plex collection sync uses it to recognise (and clean up) its own collections.
 */
export const COLLECTION_SUMMARY_SUFFIX = '— all seasons, parts and sequels.';

// API paths (following Plex convention)
export const API_PATHS = {
  ROOT: '/',
  LIBRARY_METADATA: '/library/metadata',
  LIBRARY_MATCHES: '/library/metadata/matches',
};

// Metadata types
export const METADATA_TYPES = {
  MOVIE: 1,
  SHOW: 2,
  SEASON: 3,
  EPISODE: 4,
};

// Cache durations (milliseconds)
export const CACHE_DURATIONS = {
  ANIME_DETAILS: 24 * 60 * 60 * 1000, // 24 hours
  EPISODES: 12 * 60 * 60 * 1000, // 12 hours
  SEARCH: 1 * 60 * 60 * 1000, // 1 hour
  CHARACTERS: 7 * 24 * 60 * 60 * 1000, // 7 days
  STAFF: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// Pagination defaults
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
