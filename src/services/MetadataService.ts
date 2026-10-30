/**
 * Metadata Service - Handles metadata requests by ratingKey
 */

import { JikanClient } from '../clients/JikanClient';
import { AnimeDataSource } from '../clients/AnimeDataSource';
import { JikanMapper, JikanMapperConfig } from '../mappers/JikanMapper';
import {
  MetadataResponse,
  ShowMetadata,
  SeasonMetadata,
  EpisodeMetadata,
  Image,
} from '../models/Metadata';
import { ANIME_PROVIDER_IDENTIFIER } from '../constants';
import { getAggregatedSpecials, resolveTaggedSpecial, SPECIAL_RELATION_TYPES } from './SpecialsHelper';
import { FranchiseList } from './FranchiseCollections';
import { CollectionRef, People } from '../mappers/JikanMapper';
import { JikanAnime } from '../types/jikan';

/**
 * Franchise collections (COLLECTIONS=true/false), taken only from Fribb's
 * franchise list. Entries not in a list group get no collection.
 */
export interface CollectionOptions {
  enabled?: boolean; // default true
  franchiseList?: FranchiseList;
}

/**
 * Images response
 */
export interface ImagesResponse {
  MediaContainer: {
    offset: number;
    totalSize: number;
    identifier: string;
    size: number;
    Image: Image[];
  };
}

/**
 * Metadata service options
 */
export interface MetadataServiceOptions {
  language?: string;
  country?: string;
  includeChildren?: boolean;
}

/**
 * Paging options
 */
export interface PagingOptions {
  containerSize?: number;
  containerStart?: number;
}

/**
 * Parsed ratingKey components
 */
interface ParsedRatingKey {
  type: 'show' | 'season' | 'episode';
  malId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  /** special from a file tagged {mal-…}: that MAL entry and its episode */
  tagged?: { malId: number; episode: number };
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

export class MetadataService {
  private jikanClient: AnimeDataSource;
  private mapper: JikanMapper;

  /** "mal" or "anidb" — ratingKey prefix of the active backend */
  private prefix: string;

  /**
   * @param source - a data source (Jikan / MAL v2 / AniDB) or a Jikan base URL (legacy)
   */
  private collections: CollectionOptions;

  constructor(
    source?: AnimeDataSource | string,
    mapperConfig?: JikanMapperConfig,
    collections: CollectionOptions = {}
  ) {
    this.collections = { enabled: collections.enabled !== false, franchiseList: collections.franchiseList };
    this.jikanClient =
      source && typeof source !== 'string' ? source : new JikanClient(source as string | undefined);
    this.prefix = this.jikanClient.idPrefix;
    this.mapper = new JikanMapper({ ...mapperConfig, idPrefix: this.jikanClient.idPrefix });
  }

  /**
   * Parse ratingKey to extract metadata type and IDs
   * Format examples ({prefix} = "mal" for jikan/mal, "anidb" for anidb):
   * - {prefix}-show-{id}
   * - {prefix}-season-{id}-{seasonNumber}   (1, or 0 for specials)
   * - {prefix}-episode-{id}-{seasonNumber}-{episodeNumber}
   * - {prefix}-episode-{id}-0-{episodeNumber}-{taggedMalId}-{taggedEpisode}   (special from a tagged file)
   */
  private parseRatingKey(ratingKey: string): ParsedRatingKey | null {
    const m = ratingKey.match(/^(mal|anidb)-(show|season|episode)-(\d+)(?:-(\d+))?(?:-(\d+))?(?:-(\d+)-(\d+))?$/);
    if (!m) return null;

    const [, prefix, type, id, a, b, taggedId, taggedEpisode] = m;
    if (taggedId !== undefined && !(type === 'episode' && a === '0')) return null;
    if (prefix !== this.prefix) {
      throw new Error(
        `ratingKey "${ratingKey}" belongs to the "${prefix}" source but METADATA_SOURCE uses "${this.prefix}" IDs. ` +
          'Re-match it in Plex: select the items → Unmatch, then Refresh Metadata (a plain refresh keeps the old ID).'
      );
    }

    if (type === 'show' && a === undefined) {
      return { type: 'show', malId: parseInt(id, 10) };
    }
    if (type === 'season' && a !== undefined && b === undefined) {
      return { type: 'season', malId: parseInt(id, 10), seasonNumber: parseInt(a, 10) };
    }
    if (type === 'episode' && a !== undefined && b !== undefined) {
      return {
        type: 'episode',
        malId: parseInt(id, 10),
        seasonNumber: parseInt(a, 10),
        episodeNumber: parseInt(b, 10),
        tagged:
          taggedId !== undefined ? { malId: parseInt(taggedId, 10), episode: parseInt(taggedEpisode, 10) } : undefined,
      };
    }
    return null;
  }

  /**
   * Get anime show metadata
   */
  private async getShow(
    malId: number,
    options: MetadataServiceOptions
  ): Promise<MetadataResponse> {
    const anime = await this.jikanClient.getAnimeById(malId);

    // Always send cast, crew, extra artwork and similar titles to Plex
    // (cached per backend; a failing lookup just leaves that field empty)
    const src = this.jikanClient;
    const [characters, staff, pictures, recommendations, collection] = await Promise.all([
      optional(() => src.getAnimeCharacters(malId).then((r) => r.data)),
      optional(() => src.getAnimeStaff(malId).then((r) => r.data)),
      optional(() => src.getAnimePictures(malId).then((r) => r.data)),
      optional(src.getRecommendations ? () => src.getRecommendations!(malId) : undefined),
      optional(() => this.resolveCollection(anime)),
    ]);

    const showMetadata = this.mapper.mapAnimeToShow(anime, {
      includeChildren: options.includeChildren,
      characters,
      staff,
      pictures,
      recommendations,
      collection: collection ?? null,
    });

    return {
      MediaContainer: {
        offset: 0,
        totalSize: 1,
        identifier: ANIME_PROVIDER_IDENTIFIER,
        size: 1,
        Metadata: [showMetadata],
      },
    };
  }

  /**
   * Cast and crew of a series for its seasons and episodes (cached per backend;
   * a failing lookup just leaves them out)
   */
  private async people(id: number): Promise<People> {
    const src = this.jikanClient;
    const [characters, staff] = await Promise.all([
      optional(() => src.getAnimeCharacters(id).then((r) => r.data)),
      optional(() => src.getAnimeStaff(id).then((r) => r.data)),
    ]);
    return this.mapper.mapPeople(characters, staff);
  }

  /**
   * Resolves the franchise collection for a show (see CollectionOptions).
   * The collection is keyed by the franchise's first (lowest) entry ID and named
   * after that entry in the configured title language.
   */
  private async resolveCollection(anime: JikanAnime): Promise<CollectionRef[] | null> {
    if (!this.collections.enabled || !this.collections.franchiseList) return null;
    // Franchise list only: key = the group's lowest own ID, name = the list's group
    // name. Crossover entries can be in several groups → one collection each.
    // Entries not in a group (or only in a group of one) get no collection.
    const franchises = await this.collections.franchiseList.findAll(anime.mal_id).catch(() => []);
    const refs = franchises
      .filter((f) => f.ids.length >= 2)
      .map((f) => ({ id: f.key, root: null, name: f.name }));
    return refs.length ? refs : null;
  }


  /**
   * Get Season 0 (Specials) metadata
   */
  private async getSpecialSeason(
    mainMalId: number,
    options: MetadataServiceOptions,
    paging?: PagingOptions
  ): Promise<MetadataResponse> {
    const [mainAnime, specials, people] = await Promise.all([
      this.jikanClient.getAnimeById(mainMalId),
      getAggregatedSpecials(mainMalId, this.jikanClient),
      this.people(mainMalId),
    ]);

    let paginatedSpecials = specials;
    if (options.includeChildren && paging) {
      const start = (paging.containerStart || 1) - 1;
      const size = paging.containerSize || 20;
      paginatedSpecials = specials.slice(start, start + size);
    }

    const seasonMetadata = this.mapper.mapAnimeToSpecialSeason(mainAnime, {
      includeChildren: options.includeChildren,
      specials: paginatedSpecials,
      people,
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
   * Get a single special episode by globalIndex from Season 0
   */
  private async getSpecialEpisode(
    mainMalId: number,
    globalIndex: number,
    options: MetadataServiceOptions,
    tagged?: { malId: number; episode: number }
  ): Promise<MetadataResponse> {
    const [mainAnime, special, people] = await Promise.all([
      this.jikanClient.getAnimeById(mainMalId),
      tagged
        ? resolveTaggedSpecial(tagged, mainMalId, globalIndex, this.jikanClient)
        : getAggregatedSpecials(mainMalId, this.jikanClient).then((all) => all.find((s) => s.globalIndex === globalIndex)),
      this.people(mainMalId),
    ]);

    if (!special) {
      throw new Error(`Special episode ${globalIndex} not found for anime ${mainMalId}`);
    }

    const grandparentRatingKey = `${this.prefix}-show-${mainMalId}`;
    const parentRatingKey = `${this.prefix}-season-${mainMalId}-0`;

    const episodeMetadata = this.mapper.mapSpecialEpisodeToMetadata(
      special.episode,
      special.anime,
      mainAnime,
      special.globalIndex,
      grandparentRatingKey,
      parentRatingKey,
      people,
      tagged
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
   * Get anime season metadata
   */
  private async getSeason(
    malId: number,
    seasonNumber: number,
    options: MetadataServiceOptions,
    paging?: PagingOptions
  ): Promise<MetadataResponse> {
    // Season 0 = Specials
    if (seasonNumber === 0) {
      return this.getSpecialSeason(malId, options, paging);
    }

    const [anime, people] = await Promise.all([this.jikanClient.getAnimeById(malId), this.people(malId)]);

    let episodes;
    if (options.includeChildren) {
      const episodesResponse = await this.jikanClient.getAllAnimeEpisodes(malId);
      episodes = episodesResponse.data;

      // Apply pagination if specified
      if (paging) {
        const start = (paging.containerStart || 1) - 1; // Convert to 0-based
        const size = paging.containerSize || 20;
        episodes = episodes.slice(start, start + size);
      }
    }

    const seasonMetadata = this.mapper.mapAnimeToSeason(anime, {
      includeChildren: options.includeChildren,
      episodes,
      people,
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
   * Get anime episode metadata
   */
  private async getEpisode(
    malId: number,
    episodeNumber: number,
    options: MetadataServiceOptions
  ): Promise<MetadataResponse> {
    const [anime, episodesResponse, people] = await Promise.all([
      this.jikanClient.getAnimeById(malId),
      this.jikanClient.getAllAnimeEpisodes(malId),
      this.people(malId),
    ]);

    const episode = episodesResponse.data.find((ep) => ep.mal_id === episodeNumber);
    if (!episode) {
      throw new Error(`Episode ${episodeNumber} not found for anime ${malId}`);
    }

    const grandparentRatingKey = `${this.prefix}-show-${malId}`;
    const parentRatingKey = `${this.prefix}-season-${malId}-1`;

    const episodeMetadata = this.mapper.mapEpisodeToMetadata(
      episode,
      anime,
      grandparentRatingKey,
      parentRatingKey,
      people
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
   * The MAL entry a special (Season 0 episode) comes from, e.g. for the MyAnimeList updater.
   * Only for MAL-based sources: AniDB's specials are episodes of the anime itself.
   * @returns null when the ratingKey is no special or the special isn't known
   */
  async getSpecialSource(
    ratingKey: string
  ): Promise<{ mal_id: number; episode: number; title: string; episodes: number | null } | null> {
    const parsed = this.parseRatingKey(ratingKey);
    if (!parsed || parsed.type !== 'episode' || parsed.seasonNumber !== 0) return null;
    if (this.jikanClient.getSpecials) return null; // native specials (AniDB): no separate entry
    if (parsed.tagged) {
      const entry = await this.jikanClient.getAnimeById(parsed.tagged.malId);
      return { mal_id: entry.mal_id, episode: parsed.tagged.episode, title: entry.title, episodes: entry.episodes ?? null };
    }
    const specials = await getAggregatedSpecials(parsed.malId, this.jikanClient);
    const special = specials.find((s) => s.globalIndex === parsed.episodeNumber);
    if (!special) return null;
    return {
      mal_id: special.anime.mal_id,
      episode: special.episode.mal_id,
      title: special.anime.title,
      episodes: special.anime.episodes ?? null,
    };
  }

  /**
   * Get metadata by ratingKey
   */
  async getMetadata(
    ratingKey: string,
    options: MetadataServiceOptions = {},
    paging?: PagingOptions
  ): Promise<MetadataResponse> {
    const parsed = this.parseRatingKey(ratingKey);
    if (!parsed) {
      throw new Error(`Invalid ratingKey format: ${ratingKey}`);
    }

    switch (parsed.type) {
      case 'show':
        return this.getShow(parsed.malId, options);

      case 'season':
        return this.getSeason(parsed.malId, parsed.seasonNumber!, options, paging);

      case 'episode':
        if (parsed.seasonNumber === 0) {
          return this.getSpecialEpisode(parsed.malId, parsed.episodeNumber!, options, parsed.tagged);
        }
        return this.getEpisode(parsed.malId, parsed.episodeNumber!, options);

      default:
        throw new Error(`Unsupported metadata type: ${(parsed as any).type}`);
    }
  }

  /**
   * Get children metadata (seasons for shows, episodes for seasons)
   */
  async getChildren(
    ratingKey: string,
    options: MetadataServiceOptions = {},
    paging?: PagingOptions
  ): Promise<MetadataResponse> {
    const parsed = this.parseRatingKey(ratingKey);
    if (!parsed) {
      throw new Error(`Invalid ratingKey format: ${ratingKey}`);
    }

    if (parsed.type === 'show') {
      const anime = await this.jikanClient.getAnimeById(parsed.malId);
      const seasons: SeasonMetadata[] = [];

      // Include Season 0 (Specials): natively (AniDB "S" episodes) or via special-type relations
      const hasSpecials = this.jikanClient.getSpecials
        ? (await this.jikanClient.getSpecials(parsed.malId)).length > 0
        : anime.relations?.some(
            (r) =>
              SPECIAL_RELATION_TYPES.includes(r.relation) &&
              r.entry.some((e) => e.type === 'anime')
          ) ?? false;

      if (hasSpecials) {
        seasons.push(this.mapper.mapAnimeToSpecialSeason(anime));
      }

      // Always include Season 1
      seasons.push(this.mapper.mapAnimeToSeason(anime));

      return {
        MediaContainer: {
          offset: 0,
          totalSize: seasons.length,
          identifier: ANIME_PROVIDER_IDENTIFIER,
          size: seasons.length,
          Metadata: seasons,
        },
      };
    } else if (parsed.type === 'season') {
      // Return episodes
      return this.getSeason(parsed.malId, parsed.seasonNumber!, { includeChildren: true }, paging);
    }

    throw new Error(`Cannot get children for type: ${parsed.type}`);
  }

  /**
   * Get images for an anime
   */
  async getImages(ratingKey: string, options: MetadataServiceOptions = {}): Promise<ImagesResponse> {
    const parsed = this.parseRatingKey(ratingKey);
    if (!parsed) {
      throw new Error(`Invalid ratingKey format: ${ratingKey}`);
    }

    const [anime, picturesResponse] = await Promise.all([
      this.jikanClient.getAnimeById(parsed.malId),
      this.jikanClient.getAnimePictures(parsed.malId),
    ]);

    const images = this.mapper.mapAnimeToShow(anime, { pictures: picturesResponse.data }).Image || [];

    return {
      MediaContainer: {
        offset: 0,
        totalSize: images.length,
        identifier: ANIME_PROVIDER_IDENTIFIER,
        size: images.length,
        Image: images,
      },
    };
  }
}
