/**
 * Match Service - Handles matching requests for anime shows, seasons, and episodes
 */

import { JikanClient } from '../clients/JikanClient';
import { AnimeDataSource, yearMatches } from '../clients/AnimeDataSource';
import { JikanMapper, JikanMapperConfig } from '../mappers/JikanMapper';
import { MetadataResponse, ShowMetadata } from '../models/Metadata';
import { getAggregatedSpecials } from './SpecialsHelper';
import { JikanAnimeSearchResult } from '../types/jikan';
import logger from '../utils/logger';
import { IdMapping, extractTaggedIds } from './IdMapping';
import { ANIME_PROVIDER_IDENTIFIER } from '../constants';

/** Search result with its computed match score */
export type ScoredResult<T> = T & { matchScore: number };

/** Results requested per search — one page of 20, like TMDB's default in the example provider */
const SEARCH_LIMIT = 20;
/** Results returned to Plex — same as the example: best 1 for auto-match, 5 for manual Fix Match */
const RESULTS_AUTO = 1;
const RESULTS_MANUAL = 5;

/** Scoring weights */
const SCORE = {
  EXACT_TITLE: 150, // normalised title equals one of the anime's titles
  YEAR_EXACT: 20, // start year equals the requested year
  YEAR_NEAR: 5, // start year is one year off (late-year premieres, file tags)
  // + MAL user score (0-10) as popularity tiebreaker
};

/**
 * Match request body parameters
 */
export interface MatchRequest {
  type: number; // 2=show, 3=season, 4=episode
  title?: string;
  parentTitle?: string; // For seasons
  grandparentTitle?: string; // For episodes
  year?: number; // Show matches
  parentYear?: number; // Season matches: the show / season folder year
  grandparentYear?: number; // Episode matches: the show folder year
  guid?: string; // External ID (e.g., "mal://12345", "anilist://20583")
  index?: number; // Season number or episode number
  parentIndex?: number; // Season number for episodes
  date?: string; // Air date for episode matching (YYYY-MM-DD format)
  filename?: string;
  manual?: number; // 0 or 1
  includeAdult?: number; // 0 or 1
  includeChildren?: number; // 0 or 1
}

/**
 * Match service options
 */
/** Construction-time matching behaviour */
export interface MatchBehaviour {
  /**
   * true (default): fetch up to 10 candidates and re-rank them with scoreAnimeMatches().
   * false: example-provider method — ask the API for 1 result (5 when manual)
   *        and trust its order.
   */
  scoring?: boolean;
  /** Translates folder-tagged IDs ({anidb-…}, {mal-…}, {anilist-…}) to the active source */
  idMapping?: IdMapping;
}

export interface MatchServiceOptions {
  language?: string;
  country?: string;
}


/** Runs an optional lookup; a failure (or missing backend support) yields undefined instead of failing the request */
async function optional<T>(fn: (() => Promise<T>) | undefined): Promise<T | undefined> {
  if (!fn) return undefined;
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

export class MatchService {
  private jikanClient: AnimeDataSource;
  private mapper: JikanMapper;

  /** "mal" or "anidb" — ratingKey prefix of the active backend */
  private prefix: string;

  /**
   * @param source - a data source (Jikan / MAL v2 / AniDB) or a Jikan base URL (legacy)
   */
  private scoring: boolean;
  private idMapping?: IdMapping;

  constructor(
    source?: AnimeDataSource | string,
    mapperConfig?: JikanMapperConfig,
    behaviour: MatchBehaviour = {}
  ) {
    this.scoring = behaviour.scoring !== false;
    this.idMapping = behaviour.idMapping;
    this.jikanClient =
      source && typeof source !== 'string' ? source : new JikanClient(source as string | undefined);
    this.prefix = this.jikanClient.idPrefix;
    this.mapper = new JikanMapper({ ...mapperConfig, idPrefix: this.jikanClient.idPrefix });
  }

  /**
   * Parse external GUID to extract provider and ID
   */
  private parseExternalGuid(guid: string): { provider: string; id: string } | null {
    const match = guid.match(/^([^:]+):\/\/(.+)$/);
    if (!match) return null;

    return {
      provider: match[1],
      id: match[2],
    };
  }

  /**
   * Match anime show
   */
  private async matchShow(
    request: MatchRequest,
    options: MatchServiceOptions
  ): Promise<MetadataResponse> {
    let matches: ShowMetadata[] = [];

    // Try to match by external ID first
    if (request.guid) {
      const parsed = this.parseExternalGuid(request.guid);
      if (parsed && parsed.provider === this.prefix) {
        try {
          const malId = parseInt(parsed.id, 10);
          const anime = await this.jikanClient.getAnimeById(malId);

          const [characters, staff, pictures] = await Promise.all([
            optional(() => this.jikanClient.getAnimeCharacters(malId).then((r) => r.data)),
            optional(() => this.jikanClient.getAnimeStaff(malId).then((r) => r.data)),
            optional(() => this.jikanClient.getAnimePictures(malId).then((r) => r.data)),
          ]);

          matches.push(
            this.mapper.mapAnimeToShow(anime, {
              includeChildren: request.includeChildren === 1,
              characters,
              staff,
              pictures,
            })
          );
        } catch (error) {
          // Fall through to title search
        }
      }
    }

    // Folder / file tagged with an ID ({anidb-12566}, [mal-34437], {anilist-…}):
    // exact match, no title search needed.
    if (matches.length === 0) {
      const tagged = await this.matchByTaggedId(request);
      if (tagged) {
        matches.push(tagged);
        if (request.manual !== 1) {
          return {
            MediaContainer: { offset: 0, totalSize: 1, identifier: ANIME_PROVIDER_IDENTIFIER, size: 1, Metadata: matches },
          };
        }
      }
    }

    // If no match by ID, search by title (manual Fix Match: also list search results)
    if ((matches.length === 0 || request.manual === 1) && request.title) {
      const searchResults = await this.jikanClient.searchAnime(request.title, {
        page: 1,
        limit: SEARCH_LIMIT,
        sfw: request.includeAdult !== 1,
      }, { year: request.year });

      // Year filter: first-air year must equal the year Plex sends (from the show /
      // season folder) — same as TMDB's first_air_date_year in the example.
      // Jikan narrows server-side via start_date; MAL has no date filter, so the
      // exact check runs on the page here. AniDB applies the same rule itself.
      let candidates = searchResults.data;
      if (request.year && this.jikanClient.kind !== 'anidb') {
        const y = request.year;
        candidates = candidates.filter((r) =>
          // fall back to the result's year field when no start date is present
          yearMatches(y, r.aired?.from || (r.year ? `${r.year}-01-01` : null))
        );
        logger.info(
          `Year filter ${y}: ${candidates.length}/${searchResults.data.length} results for "${request.title}"`
        );
      }

      // AniDB already ranks its local title search (and only returns IDs);
      // Jikan / MAL results are re-ranked against every registered title.
      const useScoring = this.scoring && this.jikanClient.kind !== 'anidb';
      const ranked = useScoring
        ? this.scoreAnimeMatches(candidates, request.title, request.year)
        : candidates;

      if (ranked.length > 0 && useScoring) {
        logger.info(
          `Match scores for "${request.title}"${request.year ? ` (${request.year})` : ''}: ` +
            ranked
              .slice(0, 5)
              .map((r: any) => `${r.title} [${r.mal_id}] ${r.matchScore.toFixed(1)}`)
              .join(' | ')
        );
      }

      const limit = Math.min(request.manual === 1 ? RESULTS_MANUAL : RESULTS_AUTO, ranked.length);

      for (let i = 0; i < limit; i++) {
        const anime = ranked[i];
        const malId = anime.mal_id;

        try {
          const [animeDetails, characters, staff, pictures] = await Promise.all([
            this.jikanClient.getAnimeById(malId),
            optional(() => this.jikanClient.getAnimeCharacters(malId).then((r) => r.data)),
            optional(() => this.jikanClient.getAnimeStaff(malId).then((r) => r.data)),
            optional(() => this.jikanClient.getAnimePictures(malId).then((r) => r.data)),
          ]);

          if (matches.some((m) => m.ratingKey === `${this.prefix}-show-${malId}`)) continue;

          // Respect Plex's adult flag on every backend (AniDB search can't filter it up front)
          if (request.includeAdult !== 1 && animeDetails.rating === 'Rx - Hentai') continue;

          matches.push(
            this.mapper.mapAnimeToShow(animeDetails, {
              includeChildren: request.includeChildren === 1,
              characters,
              staff,
              pictures,
            })
          );
        } catch (error) {
          // Skip this result and continue
          continue;
        }
      }
    }

    return {
      MediaContainer: {
        offset: 0,
        totalSize: matches.length,
        identifier: ANIME_PROVIDER_IDENTIFIER,
        size: matches.length,
        Metadata: matches,
      },
    };
  }

  /**
   * Match Season 0 (Specials) for a show
   */
  private async matchSpecialSeason(
    request: MatchRequest,
    options: MatchServiceOptions
  ): Promise<MetadataResponse> {
    const showTitle = request.parentTitle || request.title;
    if (!showTitle) {
      throw new Error('Parent title is required for special season matching');
    }

    const showMatch = await this.matchShow(
      { ...request, type: 2, title: showTitle, manual: 0, year: this.lookupYear(request) },
      options
    );

    if (showMatch.MediaContainer.Metadata.length === 0) {
      return { MediaContainer: { offset: 0, totalSize: 0, identifier: ANIME_PROVIDER_IDENTIFIER, size: 0, Metadata: [] } };
    }

    const show = showMatch.MediaContainer.Metadata[0] as ShowMetadata;
    const mainMalId = parseInt(show.ratingKey.replace(`${this.prefix}-show-`, ''), 10);
    const [mainAnime, specials] = await Promise.all([
      this.jikanClient.getAnimeById(mainMalId),
      getAggregatedSpecials(mainMalId, this.jikanClient),
    ]);

    const seasonMetadata = this.mapper.mapAnimeToSpecialSeason(mainAnime, {
      includeChildren: request.includeChildren === 1,
      specials,
    });

    return {
      MediaContainer: {
        offset: 0,
        totalSize: 1,
        identifier: ANIME_PROVIDER_IDENTIFIER,
        size: 1,
        Metadata: [seasonMetadata],
      },
    };
  }

  /**
   * Match a special episode (parentIndex === 0) from Season 0
   */
  private async matchSpecialEpisode(
    request: MatchRequest,
    options: MatchServiceOptions
  ): Promise<MetadataResponse> {
    const showTitle = request.grandparentTitle || request.parentTitle || request.title;
    if (!showTitle) {
      throw new Error('Grandparent title is required for special episode matching');
    }

    const showMatch = await this.matchShow(
      { ...request, type: 2, title: showTitle, manual: 0, year: this.lookupYear(request) },
      options
    );

    if (showMatch.MediaContainer.Metadata.length === 0) {
      return { MediaContainer: { offset: 0, totalSize: 0, identifier: ANIME_PROVIDER_IDENTIFIER, size: 0, Metadata: [] } };
    }

    const show = showMatch.MediaContainer.Metadata[0] as ShowMetadata;
    const mainMalId = parseInt(show.ratingKey.replace(`${this.prefix}-show-`, ''), 10);
    const [mainAnime, specials] = await Promise.all([
      this.jikanClient.getAnimeById(mainMalId),
      getAggregatedSpecials(mainMalId, this.jikanClient),
    ]);

    const special = specials.find((s) => s.globalIndex === request.index);
    if (!special) {
      return { MediaContainer: { offset: 0, totalSize: 0, identifier: ANIME_PROVIDER_IDENTIFIER, size: 0, Metadata: [] } };
    }

    const grandparentRatingKey = `${this.prefix}-show-${mainMalId}`;
    const parentRatingKey = `${this.prefix}-season-${mainMalId}-0`;

    const episodeMetadata = this.mapper.mapSpecialEpisodeToMetadata(
      special.episode,
      special.anime,
      mainAnime,
      special.globalIndex,
      grandparentRatingKey,
      parentRatingKey
    );

    return {
      MediaContainer: {
        offset: 0,
        totalSize: 1,
        identifier: ANIME_PROVIDER_IDENTIFIER,
        size: 1,
        Metadata: [episodeMetadata],
      },
    };
  }

  /**
   * Match anime season (always returns Season 1 for the parent show)
   */
  private async matchSeason(
    request: MatchRequest,
    options: MatchServiceOptions
  ): Promise<MetadataResponse> {
    // For seasons, we need the parent show's title
    const showTitle = request.parentTitle || request.title;
    if (!showTitle) {
      throw new Error('Parent title is required for season matching');
    }

    // Season 0 = Specials
    if (request.index === 0) {
      return this.matchSpecialSeason(request, options);
    }

    // Search for the show
    const showMatch = await this.matchShow(
      {
        ...request,
        type: 2, // Show type
        title: showTitle,
        manual: 0, // Get best match only
        year: this.lookupYear(request),
      },
      options
    );

    // If we found a show, return its season
    if (showMatch.MediaContainer.Metadata.length > 0) {
      const show = showMatch.MediaContainer.Metadata[0] as ShowMetadata;
      const malId = show.ratingKey.replace(`${this.prefix}-show-`, '');
      const anime = await this.jikanClient.getAnimeById(parseInt(malId, 10));

      const seasonMetadata = this.mapper.mapAnimeToSeason(anime);

      return {
        MediaContainer: {
          offset: 0,
          totalSize: 1,
          identifier: ANIME_PROVIDER_IDENTIFIER,
          size: 1,
          Metadata: [seasonMetadata],
        },
      };
    }

    return {
      MediaContainer: {
        offset: 0,
        totalSize: 0,
        identifier: ANIME_PROVIDER_IDENTIFIER,
        size: 0,
        Metadata: [],
      },
    };
  }

  /**
   * Match anime episode
   */
  private async matchEpisode(
    request: MatchRequest,
    options: MatchServiceOptions
  ): Promise<MetadataResponse> {
    // For episodes, we need the grandparent show's title
    const showTitle = request.grandparentTitle || request.parentTitle || request.title;
    if (!showTitle) {
      throw new Error('Grandparent title is required for episode matching');
    }

    // Episode number is required
    if (!request.index) {
      throw new Error('Episode number (index) is required for episode matching');
    }

    // parentIndex 0 = Season 0 (Specials)
    if (request.parentIndex === 0) {
      return this.matchSpecialEpisode(request, options);
    }

    // Search for the show
    const showMatch = await this.matchShow(
      {
        ...request,
        type: 2, // Show type
        title: showTitle,
        manual: 0, // Get best match only
        year: this.lookupYear(request),
      },
      options
    );

    // If we found a show, fetch and return the specific episode
    if (showMatch.MediaContainer.Metadata.length > 0) {
      const show = showMatch.MediaContainer.Metadata[0] as ShowMetadata;
      const malId = parseInt(show.ratingKey.replace(`${this.prefix}-show-`, ''), 10);

      const [anime, episodesResponse] = await Promise.all([
        this.jikanClient.getAnimeById(malId),
        this.jikanClient.getAllAnimeEpisodes(malId),
      ]);

      const episode = episodesResponse.data.find((ep) => ep.mal_id === request.index);
      if (!episode) {
        return {
          MediaContainer: {
            offset: 0,
            totalSize: 0,
            identifier: ANIME_PROVIDER_IDENTIFIER,
            size: 0,
            Metadata: [],
          },
        };
      }

      const grandparentRatingKey = `${this.prefix}-show-${malId}`;
      const parentRatingKey = `${this.prefix}-season-${malId}-1`;

      const episodeMetadata = this.mapper.mapEpisodeToMetadata(
        episode,
        anime,
        grandparentRatingKey,
        parentRatingKey
      );

      return {
        MediaContainer: {
          offset: 0,
          totalSize: 1,
          identifier: ANIME_PROVIDER_IDENTIFIER,
          size: 1,
          Metadata: [episodeMetadata],
        },
      };
    }

    return {
      MediaContainer: {
        offset: 0,
        totalSize: 0,
        identifier: ANIME_PROVIDER_IDENTIFIER,
        size: 0,
        Metadata: [],
      },
    };
  }

  /** Year for the show lookup behind a season / episode match */
  private lookupYear(request: MatchRequest): number | undefined {
    if (request.type === 3) return request.parentYear ?? request.year;
    if (request.type === 4) return request.grandparentYear ?? request.parentYear ?? request.year;
    return request.year;
  }

  /**
   * Matches via an ID tagged in the file/folder name or titles. IDs of other
   * sites are translated with the ID mapping list (e.g. AniDB → MAL).
   */
  private async matchByTaggedId(request: MatchRequest): Promise<ShowMetadata | null> {
    const tags = extractTaggedIds(
      request.filename,
      request.title,
      request.parentTitle,
      request.grandparentTitle
    );
    if (!tags.length) return null;

    // Prefer an ID of the active source, then the others
    tags.sort((a, b) => Number(b.provider === this.prefix) - Number(a.provider === this.prefix));

    for (const tag of tags) {
      let id: number | undefined = tag.provider === this.prefix ? tag.id : undefined;
      if (id === undefined && this.idMapping) {
        id = await this.idMapping.convert(tag.provider, tag.id, this.prefix as 'mal' | 'anidb').catch(() => undefined);
      }
      if (id === undefined) {
        logger.info(`Tagged ${tag.provider}-${tag.id} has no ${this.prefix} ID mapping; trying next / title search`);
        continue;
      }
      try {
        const anime = await this.jikanClient.getAnimeById(id);
        const [characters, staff, pictures] = await Promise.all([
          optional(() => this.jikanClient.getAnimeCharacters(id!).then((r) => r.data)),
          optional(() => this.jikanClient.getAnimeStaff(id!).then((r) => r.data)),
          optional(() => this.jikanClient.getAnimePictures(id!).then((r) => r.data)),
        ]);
        logger.info(`Matched by tagged ID ${tag.provider}-${tag.id} → ${this.prefix}-${id} (${anime.title})`);
        return this.mapper.mapAnimeToShow(anime, {
          includeChildren: request.includeChildren === 1,
          characters,
          staff,
          pictures,
        });
      } catch (e) {
        logger.warn(`Tagged ID ${tag.provider}-${tag.id} → ${this.prefix}-${id} could not be loaded: ${(e as Error).message}`);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- scoring

  /**
   * Normalises a title for comparison:
   * lowercase, strip diacritics, drop articles (the / a / an), drop punctuation,
   * collapse whitespace. "The Rising of the Shield Hero" → "rising of shield hero",
   * "Re:Zero" → "rezero".
   */
  private normalizeTitle(title: string): string {
    return (title || '')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter((w) => w && w !== 'the' && w !== 'a' && w !== 'an')
      .join(' ');
  }

  /** Classic Levenshtein edit distance (two-row DP) */
  private levenshteinDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    let curr = new Array<number>(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }
    return prev[b.length];
  }

  /** Similarity 0-100 based on edit distance relative to the longer string */
  private fuzzyMatchScore(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 100;
    return (1 - this.levenshteinDistance(a, b) / maxLen) * 100;
  }

  /** Every title MAL has registered for a result (default, en, ja, synonyms, de/fr/es…) */
  private candidateTitles(r: JikanAnimeSearchResult): string[] {
    const titles = [
      r.title,
      r.title_english,
      r.title_japanese,
      ...(r.title_synonyms || []),
      ...(r.titles || []).map((t) => t.title),
    ].filter((t): t is string => !!t);
    return Array.from(new Set(titles));
  }

  private resultYear(r: JikanAnimeSearchResult): number | null {
    if (r.year) return r.year;
    const from = r.aired?.from;
    const y = from ? parseInt(from.slice(0, 4), 10) : NaN;
    return isNaN(y) ? null : y;
  }

  /**
   * Scores search results against the requested title (and year) and sorts best-first.
   *   title:      150 for an exact (normalised) match on any registered title,
   *               otherwise the best fuzzy similarity 0-100
   *   year:       +20 exact, +5 when one year off (only when a year is requested)
   *   popularity: + MAL score (0-10) as tiebreaker
   * Language settings deliberately play no part: matching uses all titles.
   */
  private scoreAnimeMatches<T extends JikanAnimeSearchResult>(
    results: T[],
    title: string,
    year?: number
  ): ScoredResult<T>[] {
    const query = this.normalizeTitle(title);

    return results
      .map((r, index) => {
        let titleScore = 0;
        for (const candidate of this.candidateTitles(r)) {
          const norm = this.normalizeTitle(candidate);
          if (!norm) continue;
          const s = norm === query ? SCORE.EXACT_TITLE : this.fuzzyMatchScore(query, norm);
          if (s > titleScore) titleScore = s;
          if (titleScore === SCORE.EXACT_TITLE) break;
        }

        let yearScore = 0;
        const ry = this.resultYear(r);
        if (year && ry) {
          if (ry === year) yearScore = SCORE.YEAR_EXACT;
          else if (Math.abs(ry - year) === 1) yearScore = SCORE.YEAR_NEAR;
        }

        const popularity = typeof r.score === 'number' ? r.score : 0;
        return { r, index, matchScore: titleScore + yearScore + popularity };
      })
      // stable: equal scores keep the API's own relevance order
      .sort((a, b) => b.matchScore - a.matchScore || a.index - b.index)
      .map(({ r, matchScore }) => ({ ...r, matchScore }));
  }

  /**
   * Match anime based on request type
   */
  async match(request: MatchRequest, options: MatchServiceOptions = {}): Promise<MetadataResponse> {
    switch (request.type) {
      case 2: // Show
        return this.matchShow(request, options);

      case 3: // Season
        return this.matchSeason(request, options);

      case 4: // Episode
        return this.matchEpisode(request, options);

      default:
        throw new Error(`Unsupported match type: ${request.type}`);
    }
  }
}
