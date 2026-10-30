/**
 * Official MyAnimeList API v2 client
 * Docs: https://myanimelist.net/apiconfig/references/api/v2
 *
 * Public anime data only needs the app's Client ID (header X-MAL-CLIENT-ID),
 * no OAuth user token. The same Client ID as the Tautulli MAL updater works.
 *
 * Pure MAL: nothing is taken from Jikan or any other source. MAL v2 has no
 * endpoints for episodes, characters or staff, so episodes are synthesised
 * from num_episodes ("Episode 1..N", no titles/air dates) and cast/crew stay
 * empty. Titles are limited to MAL's main title, English, Japanese and synonyms.
 *
 * Responses are normalised to the Jikan v4 shapes used by the mapper.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import logger from '../utils/logger';
import {
  AnimeDataSource,
  IntervalQueue,
  Recommendation,
  SearchHints,
  normaliseDate,
  toEpisodesResponse,
} from './AnimeDataSource';
import {
  JikanAnime,
  JikanEpisode,
  JikanEpisodesResponse,
  JikanCharactersResponse,
  JikanStaffResponse,
  JikanPicturesResponse,
  JikanSearchResponse,
  JikanSearchOptions,
  JikanRelation,
  JikanTitle,
} from '../types/jikan';

interface MalPicture {
  medium?: string;
  large?: string;
}

interface MalAnime {
  id: number;
  title: string;
  main_picture?: MalPicture;
  alternative_titles?: { synonyms?: string[]; en?: string; ja?: string };
  start_date?: string;
  end_date?: string;
  synopsis?: string;
  background?: string;
  mean?: number;
  rank?: number;
  popularity?: number;
  num_list_users?: number;
  num_scoring_users?: number;
  nsfw?: 'white' | 'gray' | 'black';
  genres?: { id: number; name: string }[];
  media_type?: string;
  status?: string;
  num_episodes?: number;
  start_season?: { year: number; season: string };
  broadcast?: { day_of_the_week?: string; start_time?: string };
  source?: string;
  average_episode_duration?: number;
  rating?: string;
  pictures?: MalPicture[];
  related_anime?: {
    node: { id: number; title: string };
    relation_type: string;
    relation_type_formatted?: string;
  }[];
  studios?: { id: number; name: string }[];
  recommendations?: { node: { id: number; title: string }; num_recommendations?: number }[];
}

const DETAIL_FIELDS = [
  'id', 'title', 'main_picture', 'alternative_titles', 'start_date', 'end_date',
  'synopsis', 'background', 'mean', 'rank', 'popularity', 'num_list_users',
  'num_scoring_users', 'nsfw', 'genres', 'media_type', 'status', 'num_episodes',
  'start_season', 'broadcast', 'source', 'average_episode_duration', 'rating',
  'pictures', 'related_anime', 'studios', 'recommendations',
].join(',');

const SEARCH_FIELDS = 'id,title,alternative_titles,start_date,end_date,media_type,nsfw';

const MEDIA_TYPE_MAP: Record<string, JikanAnime['type']> = {
  tv: 'TV',
  ova: 'OVA',
  movie: 'Movie',
  special: 'Special',
  tv_special: 'Special',
  ona: 'ONA',
  music: 'Music',
};

const RATING_MAP: Record<string, string> = {
  g: 'G - All Ages',
  pg: 'PG - Children',
  pg_13: 'PG-13 - Teens 13 or older',
  r: 'R - 17+ (violence & profanity)',
  'r+': 'R+ - Mild Nudity',
  rx: 'Rx - Hentai',
};

const STATUS_MAP: Record<string, JikanAnime['status']> = {
  finished_airing: 'Finished Airing',
  currently_airing: 'Currently Airing',
  not_yet_aired: 'Not yet aired',
};

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MalApiClientOptions {
  baseURL?: string;
  clientId: string;
  requestsPerSecond?: number;
}

export class MalApiClient implements AnimeDataSource {
  readonly kind = 'mal' as const;
  readonly idPrefix = 'mal' as const;

  private client: AxiosInstance;
  private queue: IntervalQueue;
  private cache = new Map<string, { data: unknown; expiresAt: number }>();
  private inflight = new Map<string, Promise<unknown>>();

  constructor(options: MalApiClientOptions) {
    if (!options.clientId) {
      throw new Error('MAL_CLIENT_ID is required for METADATA_SOURCE=mal');
    }
    this.queue = new IntervalQueue(1000 / Math.max(0.1, options.requestsPerSecond ?? 2));
    this.client = axios.create({
      baseURL: options.baseURL || 'https://api.myanimelist.net/v2',
      timeout: 10000,
      headers: { 'X-MAL-CLIENT-ID': options.clientId },
    });

    this.client.interceptors.request.use((cfg) => {
      logger.info(`MAL API Request: ${cfg.method?.toUpperCase()} ${cfg.baseURL}${cfg.url}`);
      return cfg;
    });
    this.client.interceptors.response.use(
      (res) => res,
      async (error: AxiosError) => {
        const status = error.response?.status;
        logger.error(`MAL API Error: ${status ?? error.message} ${error.config?.url}`);
        if (status === 429 || status === 504) {
          await new Promise((r) => setTimeout(r, 2000));
          return this.client.request(error.config!);
        }
        if (status === 401 || status === 403) {
          logger.error('MAL API rejected the request (401/403) — check MAL_CLIENT_ID in .env');
        }
        // Re-throw a plain Error so the Client ID header never ends up in logs
        return Promise.reject(
          new Error(`MAL API request failed: ${status ?? error.code ?? error.message} ${error.config?.url ?? ''}`)
        );
      }
    );
  }

  private async cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() < hit.expiresAt) return hit.data as T;

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const p = this.queue
      .schedule(fetcher)
      .then((data) => {
        this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
        return data;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async getRaw(id: number): Promise<MalAnime> {
    return this.cached(`anime:${id}`, DAY_MS, async () => {
      const res = await this.client.get<MalAnime>(`/anime/${id}`, {
        params: { fields: DETAIL_FIELDS, nsfw: true },
      });
      return res.data;
    });
  }

  /** Converts a MAL v2 anime object to the Jikan shape */
  private toJikan(a: MalAnime): JikanAnime {
    const titles: JikanTitle[] = [{ type: 'Default', title: a.title }];
    if (a.alternative_titles?.en) titles.push({ type: 'English', title: a.alternative_titles.en });
    if (a.alternative_titles?.ja) titles.push({ type: 'Japanese', title: a.alternative_titles.ja });
    (a.alternative_titles?.synonyms || []).forEach((s) => titles.push({ type: 'Synonym', title: s }));

    const poster = a.main_picture?.large || a.main_picture?.medium || '';
    const from = normaliseDate(a.start_date);
    const to = normaliseDate(a.end_date);

    const relationsByType = new Map<string, JikanRelation>();
    (a.related_anime || []).forEach((r) => {
      const name =
        r.relation_type_formatted ||
        r.relation_type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
      if (!relationsByType.has(name)) relationsByType.set(name, { relation: name, entry: [] });
      relationsByType.get(name)!.entry.push({
        mal_id: r.node.id,
        type: 'anime',
        name: r.node.title,
        url: `https://myanimelist.net/anime/${r.node.id}`,
      });
    });

    const genres = (a.genres || []).map((g) => ({
      mal_id: g.id,
      type: 'anime',
      name: g.name,
      url: `https://myanimelist.net/anime/genre/${g.id}`,
    }));

    const avgMin = a.average_episode_duration ? Math.round(a.average_episode_duration / 60) : 0;

    return {
      mal_id: a.id,
      url: `https://myanimelist.net/anime/${a.id}`,
      images: { jpg: { image_url: poster, large_image_url: poster } },
      approved: true,
      titles,
      title: a.title,
      title_english: a.alternative_titles?.en || null,
      title_japanese: a.alternative_titles?.ja || null,
      title_synonyms: a.alternative_titles?.synonyms || [],
      type: MEDIA_TYPE_MAP[a.media_type || ''] || 'TV',
      source: a.source || '',
      episodes: a.num_episodes || null,
      status: STATUS_MAP[a.status || ''] || 'Finished Airing',
      airing: a.status === 'currently_airing',
      aired: { from, to },
      duration: avgMin ? `${avgMin} min per ep` : '',
      rating: RATING_MAP[a.rating || ''] || '',
      score: a.mean ?? null,
      scored_by: a.num_scoring_users ?? null,
      rank: a.rank ?? null,
      popularity: a.popularity ?? null,
      members: a.num_list_users ?? null,
      favorites: null,
      synopsis: a.synopsis || null,
      background: a.background || null,
      season: (a.start_season?.season as JikanAnime['season']) || null,
      year: a.start_season?.year ?? (from ? parseInt(from.slice(0, 4), 10) : null),
      producers: [],
      licensors: [],
      studios: (a.studios || []).map((s) => ({
        mal_id: s.id,
        type: 'anime',
        name: s.name,
        url: `https://myanimelist.net/anime/producer/${s.id}`,
      })),
      genres,
      explicit_genres: [],
      themes: [],
      demographics: [],
      relations: Array.from(relationsByType.values()),
      external: [],
    };
  }

  async getAnimeById(id: number): Promise<JikanAnime> {
    return this.toJikan(await this.getRaw(id));
  }

  async getRecommendations(id: number): Promise<Recommendation[]> {
    const a = await this.getRaw(id);
    return (a.recommendations || []).map((r) => ({ id: r.node.id, title: r.node.title }));
  }

  private async synthesiseEpisodes(id: number): Promise<JikanEpisode[]> {
    const a = await this.getRaw(id);
    const count = a.num_episodes || 0;
    const duration = a.average_episode_duration || null;
    return Array.from({ length: count }, (_, i) => ({
      mal_id: i + 1,
      url: null,
      title: `Episode ${i + 1}`,
      title_japanese: null,
      title_romanji: null,
      duration,
      aired: null,
      filler: false,
      recap: false,
      synopsis: null,
      forum_url: null,
    }));
  }

  async getAnimeEpisodes(id: number, page: number = 1): Promise<JikanEpisodesResponse> {
    return toEpisodesResponse(page === 1 ? await this.synthesiseEpisodes(id) : []);
  }

  async getAllAnimeEpisodes(id: number): Promise<JikanEpisodesResponse> {
    return toEpisodesResponse(await this.synthesiseEpisodes(id));
  }

  /** MAL API v2 has no characters endpoint */
  async getAnimeCharacters(_id: number): Promise<JikanCharactersResponse> {
    return { data: [] };
  }

  /** MAL API v2 has no staff endpoint */
  async getAnimeStaff(_id: number): Promise<JikanStaffResponse> {
    return { data: [] };
  }

  async getAnimePictures(id: number): Promise<JikanPicturesResponse> {
    const a = await this.getRaw(id);
    return {
      data: (a.pictures || [])
        .filter((p) => p.large || p.medium)
        .map((p) => ({ image_url: (p.medium || p.large)!, large_image_url: (p.large || p.medium)! })),
    };
  }

  async searchAnime(
    query: string,
    options?: JikanSearchOptions,
    _hints?: SearchHints // year filtering happens in MatchService (MAL has no year filter)
  ): Promise<JikanSearchResponse> {
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
    const q = query.trim();
    const empty: JikanSearchResponse = {
      pagination: { last_visible_page: 1, has_next_page: false, items: { count: 0, total: 0, per_page: limit } },
      data: [],
    };
    // MAL rejects queries shorter than 3 characters
    if (q.length < 3) return empty;

    const nsfw = options?.sfw === false;

    const nodes = await this.cached(`search:${q}:${limit}:${nsfw}`, 60 * 60 * 1000, async () => {
      const res = await this.client.get<{ data: { node: MalAnime }[] }>('/anime', {
        params: { q, limit, fields: SEARCH_FIELDS, nsfw },
      });
      return res.data.data.map((d) => d.node);
    });

    return {
      pagination: {
        last_visible_page: 1,
        has_next_page: false,
        items: { count: nodes.length, total: nodes.length, per_page: limit },
      },
      // Only mal_id is consumed by MatchService; the rest is best effort
      data: nodes.map((n) => this.toJikan(n) as any),
    };
  }

  clearCache(): void {
    this.cache.clear();
  }
}
