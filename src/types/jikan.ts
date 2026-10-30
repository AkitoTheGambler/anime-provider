/**
 * TypeScript interfaces for Jikan API v4
 * Documentation: https://docs.api.jikan.moe/
 */

// Common types
export interface JikanImage {
  image_url: string;
  small_image_url?: string;
  large_image_url?: string;
}

export interface JikanImages {
  jpg: JikanImage;
  webp?: JikanImage;
}

export interface JikanDateRange {
  from: string | null;
  to: string | null;
  prop?: {
    from: {
      day: number | null;
      month: number | null;
      year: number | null;
    };
    to: {
      day: number | null;
      month: number | null;
      year: number | null;
    };
  };
  string?: string;
}

export interface JikanTitle {
  type: string; // 'Default', 'Synonym', 'Japanese', 'English', etc.
  title: string;
}

export interface JikanGenre {
  mal_id: number;
  type: string;
  name: string;
  url: string;
}

export interface JikanStudio {
  mal_id: number;
  type: string;
  name: string;
  url: string;
}

export interface JikanProducer {
  mal_id: number;
  type: string;
  name: string;
  url: string;
}

export interface JikanLicensor {
  mal_id: number;
  type: string;
  name: string;
  url: string;
}

// External IDs
export interface JikanExternalLinks {
  name: string;
  url: string;
}

export interface JikanExternalIds {
  mal_id: number;
  anilist_id?: number;
  anidb_id?: number;
  imdb_id?: string;
  thetvdb_id?: number;
}

// Anime types
export interface JikanAnime {
  mal_id: number;
  url: string;
  images: JikanImages;
  trailer?: {
    youtube_id: string | null;
    url: string | null;
    embed_url: string | null;
  };
  approved: boolean;
  titles: JikanTitle[];
  title: string; // Default title (usually romaji)
  title_english: string | null;
  title_japanese: string | null;
  title_synonyms: string[];
  type: 'TV' | 'OVA' | 'Movie' | 'Special' | 'ONA' | 'Music';
  source: string;
  episodes: number | null;
  status: 'Finished Airing' | 'Currently Airing' | 'Not yet aired';
  airing: boolean;
  aired: JikanDateRange;
  duration: string; // e.g., "24 min per ep"
  rating: string; // e.g., "PG-13 - Teens 13 or older"
  score: number | null;
  scored_by: number | null;
  rank: number | null;
  popularity: number | null;
  members: number | null;
  favorites: number | null;
  synopsis: string | null;
  background: string | null;
  season: 'summer' | 'winter' | 'spring' | 'fall' | null;
  year: number | null;
  broadcast?: {
    day: string | null;
    time: string | null;
    timezone: string | null;
    string: string | null;
  };
  producers: JikanProducer[];
  licensors: JikanLicensor[];
  studios: JikanStudio[];
  genres: JikanGenre[];
  explicit_genres: JikanGenre[];
  themes: JikanGenre[];
  demographics: JikanGenre[];
  // Additional fields from full endpoint
  relations?: JikanRelation[];
  theme?: {
    openings: string[];
    endings: string[];
  };
  external?: JikanExternalLinks[];
  streaming?: JikanExternalLinks[];
}

// Relation types
export interface JikanRelation {
  relation: string; // 'Sequel', 'Prequel', 'Side story', 'Adaptation', etc.
  entry: {
    mal_id: number;
    type: 'anime' | 'manga';
    name: string;
    url: string;
  }[];
}

// Episode types
export interface JikanEpisode {
  mal_id: number;
  url: string | null;
  title: string;
  title_japanese: string | null;
  title_romanji: string | null;
  duration: number | null; // seconds
  aired: string | null;
  filler: boolean;
  recap: boolean;
  synopsis: string | null;
  forum_url: string | null;
  /** Episode user score on a 0-5 scale (Jikan native; AniDB rating / 2) */
  score?: number | null;
}

export interface JikanEpisodesResponse {
  pagination: {
    last_visible_page: number;
    has_next_page: boolean;
    items: {
      count: number;
      total: number;
      per_page: number;
    };
  };
  data: JikanEpisode[];
}

// Character types
export interface JikanCharacterMeta {
  mal_id: number;
  url: string;
  images: JikanImages;
  name: string;
}

export interface JikanPersonMeta {
  mal_id: number;
  url: string;
  images: JikanImages;
  name: string;
}

export interface JikanVoiceActor {
  person: JikanPersonMeta;
  language: string;
}

export interface JikanCharacter {
  character: JikanCharacterMeta;
  role: 'Main' | 'Supporting';
  favorites: number;
  voice_actors: JikanVoiceActor[];
}

export interface JikanCharactersResponse {
  data: JikanCharacter[];
}

// Staff types
export interface JikanStaffMember {
  person: JikanPersonMeta;
  positions: string[]; // ['Director', 'Script', 'Music', etc.]
}

export interface JikanStaffResponse {
  data: JikanStaffMember[];
}

// Pictures types
export interface JikanPicture {
  image_url: string;
  large_image_url: string;
}

export interface JikanPicturesResponse {
  data: JikanPicture[];
}

// Search types
export interface JikanAnimeSearchResult {
  mal_id: number;
  url: string;
  images: JikanImages;
  trailer: {
    youtube_id: string | null;
    url: string | null;
    embed_url: string | null;
  } | null;
  approved: boolean;
  titles: JikanTitle[];
  title: string;
  title_english: string | null;
  title_japanese: string | null;
  title_synonyms: string[];
  type: 'TV' | 'OVA' | 'Movie' | 'Special' | 'ONA' | 'Music';
  source: string;
  episodes: number | null;
  status: string;
  airing: boolean;
  aired: JikanDateRange;
  duration: string;
  rating: string;
  score: number | null;
  scored_by: number | null;
  rank: number | null;
  popularity: number | null;
  members: number | null;
  favorites: number | null;
  synopsis: string | null;
  background: string | null;
  season: string | null;
  year: number | null;
  broadcast: {
    day: string | null;
    time: string | null;
    timezone: string | null;
    string: string | null;
  } | null;
  producers: JikanProducer[];
  licensors: JikanLicensor[];
  studios: JikanStudio[];
  genres: JikanGenre[];
  explicit_genres: JikanGenre[];
  themes: JikanGenre[];
  demographics: JikanGenre[];
}

export interface JikanSearchResponse {
  pagination: {
    last_visible_page: number;
    has_next_page: boolean;
    items: {
      count: number;
      total: number;
      per_page: number;
    };
  };
  data: JikanAnimeSearchResult[];
}

// Search options
export interface JikanSearchOptions {
  page?: number;
  limit?: number;
  type?: 'tv' | 'movie' | 'ova' | 'special' | 'ona' | 'music';
  score?: number;
  min_score?: number;
  max_score?: number;
  status?: 'airing' | 'complete' | 'upcoming';
  rating?: 'g' | 'pg' | 'pg13' | 'r17' | 'r' | 'rx';
  sfw?: boolean;
  genres?: string; // Comma-separated genre IDs
  order_by?:
    | 'mal_id'
    | 'title'
    | 'type'
    | 'rating'
    | 'start_date'
    | 'end_date'
    | 'episodes'
    | 'score'
    | 'scored_by'
    | 'rank'
    | 'popularity'
    | 'members'
    | 'favorites';
  sort?: 'desc' | 'asc';
  letter?: string;
  producer?: string;
  /** aired.from >= start_date (YYYY-MM-DD) — see jikan-rest app/Anime.php filterByStartDate */
  start_date?: string;
  /** aired.to <= end_date (YYYY-MM-DD) */
  end_date?: string;
}

// Cached response wrapper
export interface CachedResponse<T = any> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

// Rate limiter token bucket
export interface RateLimiterOptions {
  tokensPerInterval: number;
  interval: number; // milliseconds
  maxTokens: number;
}
