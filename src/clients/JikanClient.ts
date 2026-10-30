/**
 * Jikan API v4 Client
 * Documentation: https://docs.api.jikan.moe/
 *
 * Rate Limits:
 * - 3 requests per second
 * - 60 requests per minute
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';
import {
  JikanAnime,
  JikanEpisodesResponse,
  JikanCharactersResponse,
  JikanStaffResponse,
  JikanPicturesResponse,
  JikanSearchResponse,
  JikanSearchOptions,
  CachedResponse,
} from '../types/jikan';
import { AnimeDataSource, IntervalQueue, Recommendation, SearchHints } from './AnimeDataSource';

export interface JikanClientOptions {
  /** Max request starts per second (Jikan: 3) */
  perSecond?: number;
  /** Max requests per rolling minute (Jikan: 60) */
  perMinute?: number;
  /** Per-request timeout; Jikan can be slow under load */
  timeoutMs?: number;
  /** Retries on timeout / network error / 429 / 5xx */
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class JikanClient implements AnimeDataSource {
  readonly kind = 'jikan' as const;
  readonly idPrefix = 'mal' as const;
  private client: AxiosInstance;
  private baseURL: string;
  private queue: IntervalQueue;
  private perMinute: number;
  private recentStarts: number[] = [];
  private retries: number;
  private cache: Map<string, CachedResponse>;
  private inflight = new Map<string, Promise<unknown>>();
  private cacheDurations: Map<string, number>;

  constructor(baseURL: string = 'http://localhost:8080/v4', options: JikanClientOptions = {}) {
    this.baseURL = baseURL;
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: options.timeoutMs ?? 20000,
    });

    // Serial start spacing (3/s) + rolling 60/min window — Plex fires many
    // match requests at once during a scan; this keeps Jikan from throttling us.
    this.queue = new IntervalQueue(Math.ceil(1000 / Math.max(0.1, options.perSecond ?? 3)));
    this.perMinute = Math.max(1, options.perMinute ?? 60);
    this.retries = Math.max(0, options.retries ?? 3);

    // Initialize cache
    this.cache = new Map();

    // Cache durations (in milliseconds)
    this.cacheDurations = new Map([
      ['anime', 24 * 60 * 60 * 1000], // 24 hours
      ['episodes', 12 * 60 * 60 * 1000], // 12 hours
      ['characters', 7 * 24 * 60 * 60 * 1000], // 7 days
      ['staff', 7 * 24 * 60 * 60 * 1000], // 7 days
      ['pictures', 7 * 24 * 60 * 60 * 1000], // 7 days
      ['search', 1 * 60 * 60 * 1000], // 1 hour
    ]);

    this.client.interceptors.request.use((config) => {
      logger.info(`Jikan API Request: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
      return config;
    });
  }

  /** Waits until another request fits into the rolling per-minute budget */
  private async minuteSlot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.recentStarts = this.recentStarts.filter((t) => now - t < 60000);
      if (this.recentStarts.length < this.perMinute) {
        this.recentStarts.push(now);
        return;
      }
      const wait = this.recentStarts[0] + 60000 - now + 50;
      logger.info(`Jikan per-minute limit reached, waiting ${wait}ms`);
      await sleep(wait);
    }
  }

  /** Rate-limited request with retries; rejects with a short plain Error */
  private async request<T>(label: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.queue.schedule(async () => {
          await this.minuteSlot();
          return fn();
        });
      } catch (e: any) {
        const status: number | undefined = e?.response?.status;
        const retryable = status === undefined || status === 429 || status >= 500;
        const reason = status ?? e?.code ?? e?.message;
        if (!retryable || attempt >= this.retries) {
          logger.error(`Jikan API failed: ${reason} ${label}`);
          throw new Error(`Jikan API request failed (${reason}): ${label}`);
        }
        const wait = status === 429 ? 2000 * (attempt + 1) : 1000 * 2 ** attempt;
        logger.warn(`Jikan API ${reason} ${label} — retry ${attempt + 1}/${this.retries} in ${wait}ms`);
        await sleep(wait);
      }
    }
  }

  /**
   * Get data from cache or fetch from API (concurrent identical requests share one call)
   */
  private async getCached<T>(
    cacheKey: string,
    cacheType: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      logger.info(`Cache hit: ${cacheKey}`);
      return cached.data as T;
    }

    const pending = this.inflight.get(cacheKey);
    if (pending) return pending as Promise<T>;

    const p = this.request(cacheKey, fetcher)
      .then((data) => {
        const cacheDuration = this.cacheDurations.get(cacheType) || 60 * 60 * 1000;
        this.cache.set(cacheKey, { data, timestamp: Date.now(), expiresAt: Date.now() + cacheDuration });
        return data;
      })
      .finally(() => this.inflight.delete(cacheKey));
    this.inflight.set(cacheKey, p);
    return p;
  }

  /**
   * Get anime by MAL ID
   */
  async getAnimeById(malId: number): Promise<JikanAnime> {
    const cacheKey = `anime:${malId}`;
    return this.getCached(cacheKey, 'anime', async () => {
      const response = await this.client.get<{ data: JikanAnime }>(`/anime/${malId}/full`);
      return response.data.data;
    });
  }

  /**
   * Get anime episodes (paginated)
   */
  async getAnimeEpisodes(malId: number, page: number = 1): Promise<JikanEpisodesResponse> {
    const cacheKey = `episodes:${malId}:${page}`;
    return this.getCached(cacheKey, 'episodes', async () => {
      const response = await this.client.get<JikanEpisodesResponse>(`/anime/${malId}/episodes`, {
        params: { page },
      });
      return response.data;
    });
  }

  /**
   * Get all episodes for an anime (handles pagination)
   */
  async getAllAnimeEpisodes(malId: number): Promise<JikanEpisodesResponse> {
    // Fetch first page
    const firstPage = await this.getAnimeEpisodes(malId, 1);

    // If there's only one page, return it
    if (!firstPage.pagination.has_next_page) {
      return firstPage;
    }

    // Fetch remaining pages
    const allEpisodes = [...firstPage.data];
    const totalPages = firstPage.pagination.last_visible_page;

    for (let page = 2; page <= totalPages; page++) {
      const pageData = await this.getAnimeEpisodes(malId, page);
      allEpisodes.push(...pageData.data);
    }

    return {
      pagination: {
        ...firstPage.pagination,
        items: {
          ...firstPage.pagination.items,
          count: allEpisodes.length,
        },
      },
      data: allEpisodes,
    };
  }

  /**
   * Get anime characters
   */
  async getAnimeCharacters(malId: number): Promise<JikanCharactersResponse> {
    const cacheKey = `characters:${malId}`;
    return this.getCached(cacheKey, 'characters', async () => {
      const response = await this.client.get<JikanCharactersResponse>(`/anime/${malId}/characters`);
      return response.data;
    });
  }

  /**
   * Get anime staff
   */
  async getAnimeStaff(malId: number): Promise<JikanStaffResponse> {
    const cacheKey = `staff:${malId}`;
    return this.getCached(cacheKey, 'staff', async () => {
      const response = await this.client.get<JikanStaffResponse>(`/anime/${malId}/staff`);
      return response.data;
    });
  }

  /**
   * Get anime pictures
   */
  async getAnimePictures(malId: number): Promise<JikanPicturesResponse> {
    const cacheKey = `pictures:${malId}`;
    return this.getCached(cacheKey, 'pictures', async () => {
      const response = await this.client.get<JikanPicturesResponse>(`/anime/${malId}/pictures`);
      return response.data;
    });
  }

  /**
   * Get recommended anime (MAL user recommendations), most-voted first
   */
  async getRecommendations(malId: number): Promise<Recommendation[]> {
    const cacheKey = `recommendations:${malId}`;
    return this.getCached(cacheKey, 'characters', async () => {
      const response = await this.client.get<{
        data: { entry: { mal_id: number; title: string }; votes: number }[];
      }>(`/anime/${malId}/recommendations`);
      return (response.data.data || []).map((r) => ({ id: r.entry.mal_id, title: r.entry.title }));
    });
  }

  /**
   * Search for anime
   */
  async searchAnime(
    query: string,
    options?: JikanSearchOptions,
    hints?: SearchHints
  ): Promise<JikanSearchResponse> {
    // Server-side year narrowing: Jikan's start_date means "aired.from >= date",
    // so this drops everything that started before the year. The exact
    // "first aired in that year" check happens in MatchService.
    const params: JikanSearchOptions & { q: string } = { q: query, ...options };
    if (hints?.year) {
      params.start_date = `${hints.year}-01-01`;
    }

    const cacheKey = `search:${JSON.stringify(params)}`;
    return this.getCached(cacheKey, 'search', async () => {
      try {
        const response = await this.client.get<JikanSearchResponse>('/anime', { params });
        return response.data;
      } catch (e: any) {
        // Some Jikan builds validate start_date as "before end_date" and reject it
        // when end_date is absent (HTTP 400/422). The exact year check happens in
        // MatchService anyway, so retry once without the server-side narrowing.
        const status = e?.response?.status;
        if (params.start_date && (status === 400 || status === 422)) {
          logger.warn(`Jikan rejected start_date (${status}); searching without it`);
          const { start_date, ...rest } = params;
          const response = await this.client.get<JikanSearchResponse>('/anime', { params: rest });
          return response.data;
        }
        throw e;
      }
    });
  }

  /**
   * Get image URL from Jikan image object
   * Jikan returns full URLs, no construction needed
   */
  getImageURL(imageUrl: string | null): string | null {
    return imageUrl;
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Jikan client cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}
