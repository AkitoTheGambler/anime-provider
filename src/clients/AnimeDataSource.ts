/**
 * Common interface for every anime metadata backend (Jikan, MAL API v2, AniDB).
 *
 * All backends return data normalised to the Jikan v4 shapes in ../types/jikan,
 * so the mapper and services stay backend-agnostic. The field `mal_id` on the
 * normalised objects holds the *primary ID of the active backend* (a MAL ID for
 * jikan/mal, an AniDB aid for anidb) — see `idPrefix`.
 */

import {
  JikanAnime,
  JikanEpisode,
  JikanEpisodesResponse,
  JikanCharactersResponse,
  JikanStaffResponse,
  JikanPicturesResponse,
  JikanSearchResponse,
  JikanSearchOptions,
} from '../types/jikan';

export type MetadataSourceKind = 'jikan' | 'mal' | 'anidb';

/** Prefix used in ratingKeys / external guids, e.g. "mal-show-1", "anidb-show-1" */
export type IdPrefix = 'mal' | 'anidb';

/** Extra hints a backend may use to rank search results (ignored by Jikan) */
export interface SearchHints {
  /** Year Plex sent (from the show / season folder) — compared to the first-air year */
  year?: number;
}

/**
 * Year check used by every backend: the entry's first-air year must equal the
 * year Plex sends (same as TMDB's first_air_date_year / movie release year).
 * Plex always sends the show's (or season entry's) year, never an episode's.
 */
export function yearMatches(year: number, firstAired: string | null | undefined): boolean {
  const start = firstAired ? parseInt(firstAired.slice(0, 4), 10) : NaN;
  return start === year;
}

export interface SpecialEntry {
  anime: JikanAnime;
  episode: JikanEpisode;
  globalIndex: number; // 1-based, stable position in Season 0
}

/** A recommended / similar title (ID in the active backend's ID space) */
export interface Recommendation {
  id: number;
  title: string;
}

export interface AnimeDataSource {
  readonly kind: MetadataSourceKind;
  readonly idPrefix: IdPrefix;

  getAnimeById(id: number): Promise<JikanAnime>;
  getAnimeEpisodes(id: number, page?: number): Promise<JikanEpisodesResponse>;
  getAllAnimeEpisodes(id: number): Promise<JikanEpisodesResponse>;
  getAnimeCharacters(id: number): Promise<JikanCharactersResponse>;
  getAnimeStaff(id: number): Promise<JikanStaffResponse>;
  getAnimePictures(id: number): Promise<JikanPicturesResponse>;
  searchAnime(
    query: string,
    options?: JikanSearchOptions,
    hints?: SearchHints
  ): Promise<JikanSearchResponse>;

  /**
   * Backends that know specials natively (AniDB "S" episodes) implement this.
   * When absent, specials are aggregated from OVA/Special relations instead.
   */
  getSpecials?(id: number): Promise<SpecialEntry[]>;

  /** Recommended / similar anime → Plex "Similar" */
  getRecommendations?(id: number): Promise<Recommendation[]>;

  clearCache(): void;
}

/** Wraps a flat episode list in the Jikan pagination envelope */
export function toEpisodesResponse(episodes: JikanEpisode[]): JikanEpisodesResponse {
  return {
    pagination: {
      last_visible_page: 1,
      has_next_page: false,
      items: { count: episodes.length, total: episodes.length, per_page: episodes.length },
    },
    data: episodes,
  };
}

/**
 * Serial request queue enforcing a minimum interval between request starts.
 * Shared by the MAL and AniDB clients.
 */
export class IntervalQueue {
  private last = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly intervalMs: number) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const slot = this.chain.then(async () => {
      const wait = this.last + this.intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
    });
    this.chain = slot.catch(() => undefined);
    return slot.then(fn);
  }
}

/** Normalises partial dates ("2006", "2006-10", "2006-10-04") to ISO YYYY-MM-DD */
export function normaliseDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const m = String(date).match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!m) return null;
  const pad = (v: string | undefined) => (v ? v.padStart(2, '0') : '01');
  return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
}
