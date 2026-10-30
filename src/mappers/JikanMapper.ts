/**
 * Maps Jikan API responses to Plex Metadata models
 */

import {
  ShowMetadata,
  SeasonMetadata,
  EpisodeMetadata,
  Image,
  Genre,
  Guid,
  Person,
  Rating,
  Country,
  Studio,
  Similar,
} from '../models/Metadata';
import {
  JikanAnime,
  JikanEpisode,
  JikanCharacter,
  JikanStaffMember,
  JikanPicture,
} from '../types/jikan';
import { ANIME_PROVIDER_IDENTIFIER, COLLECTION_SUMMARY_SUFFIX } from '../constants';
import {
  constructGuid,
  constructMetadataKey,
  constructMetadataKeyWithChildren,
  createExternalGuid,
} from '../utils/guid';

/** A resolved franchise collection (from the Fribb list or the prequel chain) */
export interface CollectionRef {
  /** Collection key — the franchise's first entry ID */
  id: number;
  /** First entry, if it could be loaded → named in the configured title language */
  root?: JikanAnime | null;
  /** Fallback name (e.g. the Fribb franchise name) when root isn't available */
  name?: string;
}

/** Cast and crew (Plex people arrays), the same for a show, its seasons and episodes */
export interface People {
  Role?: Person[];
  Director?: Person[];
  Producer?: Person[];
  Writer?: Person[];
}

export interface JikanMapperConfig {
  titleLanguage?: 'english' | 'romaji' | 'japanese' | 'german' | 'french' | 'spanish';
  /** ratingKey / guid prefix of the active backend: 'mal' (jikan, mal) or 'anidb' */
  idPrefix?: 'mal' | 'anidb';
}

export class JikanMapper {
  private config: JikanMapperConfig;
  private idPrefix: 'mal' | 'anidb';

  constructor(config: JikanMapperConfig = {}) {
    this.config = {
      titleLanguage: config.titleLanguage || 'english',
      idPrefix: config.idPrefix || 'mal',
    };
    this.idPrefix = this.config.idPrefix!;
  }

  /**
   * Get best title for anime based on language preference
   */
  private getBestTitle(anime: JikanAnime): string {
    const preference = this.config.titleLanguage;

    // Try to get title based on preference
    switch (preference) {
      case 'english': {
        const englishTitle = anime.titles?.find((t) => t.type === 'English');
        if (englishTitle?.title) return englishTitle.title;
        // Fallback to romaji then Japanese
        if (anime.title) return anime.title;
        return anime.title_japanese || `${this.idPrefix.toUpperCase()}-${anime.mal_id}`;
      }

      case 'romaji': {
        // Use Default title (MAL's official title, often romaji)
        const defaultTitle = anime.titles?.find((t) => t.type === 'Default');
        if (defaultTitle?.title) return defaultTitle.title;
        // Fallback to deprecated title field, then English, then Japanese
        if (anime.title) return anime.title;
        const englishTitle = anime.titles?.find((t) => t.type === 'English');
        if (englishTitle?.title) return englishTitle.title;
        return anime.title_japanese || `${this.idPrefix.toUpperCase()}-${anime.mal_id}`;
      }

      case 'japanese': {
        if (anime.title_japanese) return anime.title_japanese;
        // Fallback to romaji then English
        if (anime.title) return anime.title;
        const englishTitle = anime.titles?.find((t) => t.type === 'English');
        if (englishTitle?.title) return englishTitle.title;
        return `${this.idPrefix.toUpperCase()}-${anime.mal_id}`;
      }

      case 'german': {
        const germanTitle = anime.titles?.find((t) => t.type === 'German');
        if (germanTitle?.title) return germanTitle.title;
        // Fallback to English, romaji, then Japanese
        const englishTitle = anime.titles?.find((t) => t.type === 'English');
        if (englishTitle?.title) return englishTitle.title;
        if (anime.title) return anime.title;
        return anime.title_japanese || `${this.idPrefix.toUpperCase()}-${anime.mal_id}`;
      }

      case 'french': {
        const frenchTitle = anime.titles?.find((t) => t.type === 'French');
        if (frenchTitle?.title) return frenchTitle.title;
        // Fallback to English, romaji, then Japanese
        const englishTitle = anime.titles?.find((t) => t.type === 'English');
        if (englishTitle?.title) return englishTitle.title;
        if (anime.title) return anime.title;
        return anime.title_japanese || `${this.idPrefix.toUpperCase()}-${anime.mal_id}`;
      }

      case 'spanish': {
        const spanishTitle = anime.titles?.find((t) => t.type === 'Spanish');
        if (spanishTitle?.title) return spanishTitle.title;
        // Fallback to English, romaji, then Japanese
        const englishTitle = anime.titles?.find((t) => t.type === 'English');
        if (englishTitle?.title) return englishTitle.title;
        if (anime.title) return anime.title;
        return anime.title_japanese || `${this.idPrefix.toUpperCase()}-${anime.mal_id}`;
      }

      default:
        // Default behavior (English preferred)
        const englishTitle = anime.titles?.find((t) => t.type === 'English');
        if (englishTitle?.title) return englishTitle.title;
        if (anime.title) return anime.title;
        return anime.title_japanese || `${this.idPrefix.toUpperCase()}-${anime.mal_id}`;
    }
  }

  /**
   * Parse anime duration to milliseconds
   * Examples: "24 min per ep", "1 hr 45 min", "23 min"
   */
  private parseDuration(duration: string | null): number | undefined {
    if (!duration) return undefined;

    // Match patterns like "24 min", "1 hr 30 min"
    const hourMatch = duration.match(/(\d+)\s*hr/);
    const minMatch = duration.match(/(\d+)\s*min/);

    let totalMinutes = 0;
    if (hourMatch) totalMinutes += parseInt(hourMatch[1]) * 60;
    if (minMatch) totalMinutes += parseInt(minMatch[1]);

    return totalMinutes > 0 ? totalMinutes * 60 * 1000 : undefined;
  }

  /**
   * Map MAL content rating to Plex TV rating format
   */
  private mapRating(rating: string): string {
    const ratingMap: Record<string, string> = {
      'G - All Ages': 'TV-G',
      'PG - Children': 'TV-PG',
      'PG-13 - Teens 13 or older': 'TV-14',
      'R - 17+ (violence & profanity)': 'TV-MA',
      'R+ - Mild Nudity': 'TV-MA',
      'Rx - Hentai': 'XXX',
    };
    return ratingMap[rating] || 'NR';
  }

  /**
   * Check if anime is adult content
   */
  private isAdultContent(rating: string, genres: any[]): boolean {
    if (rating === 'Rx - Hentai') return true;
    // Check for explicit genres
    const adultGenres = ['Hentai', 'Ecchi'];
    return genres?.some((g) => adultGenres.includes(g.name)) || false;
  }

  /**
   * Build tagline (e.g., "TV • 24 Episodes • Fall 2013")
   */
  private buildTagline(anime: JikanAnime): string | undefined {
    const parts: string[] = [];

    if (anime.type) parts.push(anime.type);
    if (anime.episodes) parts.push(`${anime.episodes} Episodes`);
    if (anime.season && anime.year) {
      const season = anime.season.charAt(0).toUpperCase() + anime.season.slice(1);
      parts.push(`${season} ${anime.year}`);
    } else if (anime.year) {
      parts.push(anime.year.toString());
    }

    return parts.length > 0 ? parts.join(' • ') : undefined;
  }

  /**
   * Map Jikan images to Plex Image array
   */
  private mapImages(anime: JikanAnime, pictures?: JikanPicture[]): Image[] | undefined {
    const images: Image[] = [];

    // Main poster (coverPoster)
    if (anime.images.jpg.large_image_url) {
      images.push({
        type: 'coverPoster',
        url: anime.images.jpg.large_image_url,
        alt: this.getBestTitle(anime),
      });
    }

    // Backdrop (use poster as backdrop for anime)
    if (anime.images.jpg.large_image_url) {
      images.push({
        type: 'background',
        url: anime.images.jpg.large_image_url,
        alt: this.getBestTitle(anime),
      });
    }

    // Add additional pictures if available
    if (pictures && pictures.length > 0) {
      // Add first additional picture as alternative background
      if (pictures[0].large_image_url) {
        images.push({
          type: 'background',
          url: pictures[0].large_image_url,
          alt: this.getBestTitle(anime),
        });
      }
    }

    return images.length > 0 ? images : undefined;
  }

  /**
   * Map Jikan genres to Plex Genre array
   */
  private mapGenres(anime: JikanAnime): Genre[] | undefined {
    const allGenres = [
      ...(anime.genres || []),
      ...(anime.themes || []),
      ...(anime.demographics || []),
    ];

    if (allGenres.length === 0) return undefined;

    return allGenres.map((genre) => ({
      tag: genre.name,
    }));
  }

  /**
   * Map external IDs to Plex Guid array
   */
  private mapExternalGuids(anime: JikanAnime): Guid[] | undefined {
    const guids: Guid[] = [];

    // Always include the primary ID of the active backend (mal:// or anidb://)
    guids.push({ id: createExternalGuid(this.idPrefix, anime.mal_id) });

    // Add external IDs if available from full endpoint
    if (anime.external) {
      anime.external.forEach((ext) => {
        const lowerName = ext.name.toLowerCase();
        if (lowerName.includes('myanimelist')) {
          const malId = ext.url.match(/\/anime\/(\d+)/)?.[1];
          if (malId) guids.push({ id: createExternalGuid('mal', malId) });
        } else if (lowerName.includes('anilist')) {
          const anilistId = ext.url.match(/\/(\d+)/)?.[1];
          if (anilistId) guids.push({ id: createExternalGuid('anilist', anilistId) });
        } else if (lowerName.includes('anidb')) {
          const anidbId = ext.url.match(/\/(\d+)/)?.[1];
          if (anidbId) guids.push({ id: createExternalGuid('anidb', anidbId) });
        } else if (lowerName.includes('imdb')) {
          const imdbId = ext.url.match(/\/(tt\d+)/)?.[1];
          if (imdbId) guids.push({ id: createExternalGuid('imdb', imdbId) });
        }
      });
    }

    const unique = guids.filter((g, i) => guids.findIndex((o) => o.id === g.id) === i);
    return unique.length > 0 ? unique : undefined;
  }

  /**
   * Plex collection for a franchise group from Fribb's list (resolved by
   * MetadataService). Without a resolved group there is no collection.
   */
  private mapCollection(anime: JikanAnime, refs?: CollectionRef | CollectionRef[] | null): any[] | undefined {
    // Only resolved franchise groups (franchise list, see MetadataService) become collections;
    // a crossover entry can be in several
    const list = (Array.isArray(refs) ? refs : refs ? [refs] : []).filter(Boolean);
    if (!list.length) return undefined;
    return list.map((ref) => this.mapOneCollection(anime, ref));
  }

  private mapOneCollection(anime: JikanAnime, ref: CollectionRef): any {
    const id = ref.id;
    const title = ref.root
      ? this.extractBaseSeriesName(this.getBestTitle(ref.root))
      : ref.name || this.extractBaseSeriesName(this.getBestTitle(anime));
    const poster =
      ref.root?.images?.jpg?.large_image_url || anime.images?.jpg?.large_image_url || undefined;

    return {
      guid: `${this.idPrefix}-collection://${id}`,
      key: `/library/collections/${this.idPrefix}-collection-${id}`,
      tag: title,
      summary: `${title} ${COLLECTION_SUMMARY_SUFFIX}`,
      thumb: poster,
      art: poster,
    };
  }

  /**
   * Extract base series name (remove season/part numbers)
   * Examples:
   * "Attack on Titan Season 2" → "Attack on Titan"
   * "Monogatari Series: Second Season" → "Monogatari Series"
   */
  private extractBaseSeriesName(title: string): string {
    // Remove common season/part indicators
    return title
      .replace(/\s+(Season|Part|Cour|2nd|3rd|4th)\s+\d+/gi, '')
      .replace(/\s+(Season|Part|Cour)\s+(Two|Three|Four|Five)/gi, '')
      .replace(/:\s+(Second|Third|Final|Last)\s+Season/gi, '')
      .replace(/\s+\d+(st|nd|rd|th)\s+Season/gi, '')
      .replace(/\s+-\s+Part\s+\d+/gi, '')
      .trim();
  }

  /**
   * Map studios to Plex Studio array
   */
  private mapStudios(anime: JikanAnime): Studio[] | undefined {
    if (!anime.studios || anime.studios.length === 0) return undefined;

    return anime.studios.map((studio) => ({
      tag: studio.name,
    }));
  }

  /**
   * Map producers to Plex Country array (repurposed for producers)
   */
  private mapProducers(anime: JikanAnime): Country[] | undefined {
    if (!anime.producers || anime.producers.length === 0) return undefined;

    return anime.producers.map((producer) => ({
      tag: producer.name,
    }));
  }

  /**
   * Map MAL score to Plex Rating array
   */
  private mapRatings(score: number | null, scoredBy: number | null): Rating[] | undefined {
    if (!score) return undefined;

    return [
      {
        image: 'myanimelist://image.rating',
        type: 'audience',
        value: score,
      },
    ];
  }

  /**
   * Map characters to Plex Role array
   * Limit to top 50 to avoid massive responses
   */
  private mapCharacters(characters: JikanCharacter[]): Person[] | undefined {
    if (!characters || characters.length === 0) return undefined;

    // Main cast first, then supporting; limit to 50
    const filteredChars = characters
      .filter((c) => c.role === 'Main' || c.role === 'Supporting')
      .sort((x, y) => (x.role === y.role ? 0 : x.role === 'Main' ? -1 : 1))
      .slice(0, 50);

    return filteredChars.map((c, index) => {
      // Prefer the original Japanese voice actor
      const va = c.voice_actors?.find((v) => v.language === 'Japanese') || c.voice_actors?.[0];
      return {
        tag: va?.person?.name || c.character.name,
        role: c.character.name,
        order: index + 1,
        thumb: va?.person?.images?.jpg?.image_url || c.character.images?.jpg?.image_url || undefined,
      };
    });
  }

  /**
   * Cast (voice actors) and crew of a series. Neither MAL/Jikan nor AniDB have staff
   * per episode, so seasons and episodes get the series' cast and crew.
   */
  mapPeople(characters?: JikanCharacter[], staff?: JikanStaffMember[]): People {
    const crew = staff ? this.mapStaff(staff) : {};
    const people: People = {
      Role: characters ? this.mapCharacters(characters) : undefined,
      Director: crew.Director,
      Producer: crew.Producer,
      Writer: crew.Writer,
    };
    (Object.keys(people) as (keyof People)[]).forEach((k) => people[k] === undefined && delete people[k]);
    return people;
  }

  /**
   * Map staff to Plex crew arrays.
   *  Director: (chief/series) director — not episode/sound/animation/art directors
   *  Writer:   script, series composition, original creator/work
   *  Producer: producers (max 10)
   */
  private mapStaff(staff: JikanStaffMember[]): {
    Director?: Person[];
    Producer?: Person[];
    Writer?: Person[];
  } {
    const lists = { Director: [] as Person[], Producer: [] as Person[], Writer: [] as Person[] };
    const seen = { Director: new Set<string>(), Producer: new Set<string>(), Writer: new Set<string>() };

    const classify = (position: string): keyof typeof lists | null => {
      const p = position.toLowerCase();
      if (/^(chief |series )?director\b/.test(p) && !/(episode|sound|animation|art|assistant|unit|photography|cg|3d)/.test(p)) {
        return 'Director';
      }
      if (/script|screenplay|series composition|original creator|original work|writer/.test(p)) return 'Writer';
      if (/producer/.test(p)) return 'Producer';
      return null;
    };

    staff.forEach((member) => {
      member.positions.forEach((position) => {
        const kind = classify(position);
        if (!kind || seen[kind].has(member.person.name)) return;
        seen[kind].add(member.person.name);
        lists[kind].push({
          tag: member.person.name,
          role: position,
          thumb: member.person.images?.jpg?.image_url || undefined,
        });
      });
    });

    lists.Producer = lists.Producer.slice(0, 10);
    return {
      Director: lists.Director.length > 0 ? lists.Director : undefined,
      Producer: lists.Producer.length > 0 ? lists.Producer : undefined,
      Writer: lists.Writer.length > 0 ? lists.Writer : undefined,
    };
  }

  /**
   * Map recommendations to Plex "Similar" (max 10)
   */
  private mapSimilar(recs?: { id: number; title: string }[]): Similar[] | undefined {
    if (!recs || recs.length === 0) return undefined;
    return recs.slice(0, 10).map((r) => ({
      guid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'show', `${this.idPrefix}-show-${r.id}`),
      tag: r.title,
    }));
  }

  /**
   * Get year from date string
   */
  private getYearFromDate(dateString: string | null): number | undefined {
    if (!dateString) return undefined;
    const year = new Date(dateString).getFullYear();
    return isNaN(year) ? undefined : year;
  }

  /**
   * Map Jikan anime to Plex ShowMetadata
   */
  mapAnimeToShow(
    anime: JikanAnime,
    options?: {
      includeChildren?: boolean;
      characters?: JikanCharacter[];
      staff?: JikanStaffMember[];
      pictures?: JikanPicture[];
      recommendations?: { id: number; title: string }[];
      /** Resolved franchise collection(s) (null / undefined = none) */
      collection?: CollectionRef | CollectionRef[] | null;
    }
  ): ShowMetadata {
    const ratingKey = `${this.idPrefix}-show-${anime.mal_id}`;
    const people = this.mapPeople(options?.characters, options?.staff);

    const metadata: ShowMetadata = {
      type: 'show',
      ratingKey,
      key: options?.includeChildren
        ? constructMetadataKeyWithChildren(ratingKey)
        : constructMetadataKey(ratingKey),
      guid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'show', ratingKey),
      title: this.getBestTitle(anime),
      originalTitle: anime.title_japanese || undefined,
      summary: anime.synopsis || undefined,
      tagline: this.buildTagline(anime),
      year: this.getYearFromDate(anime.aired?.from),
      originallyAvailableAt: anime.aired?.from || '',
      contentRating: this.mapRating(anime.rating),
      studio: anime.studios?.[0]?.name,
      thumb: anime.images.jpg.large_image_url || undefined,
      art: anime.images.jpg.large_image_url || undefined,
      duration: this.parseDuration(anime.duration),
      isAdult: this.isAdultContent(anime.rating, anime.genres || []),

      // Arrays
      Image: this.mapImages(anime, options?.pictures),
      Genre: this.mapGenres(anime),
      Guid: this.mapExternalGuids(anime),
      Country: this.mapProducers(anime),
      Studio: this.mapStudios(anime),
      Rating: this.mapRatings(anime.score, anime.scored_by),
      ...people,
      Collection: this.mapCollection(anime, options?.collection),
      Similar: this.mapSimilar(options?.recommendations),
    };

    // Add single season with all episodes if requested
    if (options?.includeChildren) {
      metadata.Children = {
        size: 1,
        Metadata: [this.createSingleSeason(anime, ratingKey, people)],
      };
    }

    return metadata;
  }

  /**
   * Create a single season (Season 1) for an anime
   */
  private createSingleSeason(anime: JikanAnime, parentRatingKey: string, people: People = {}): SeasonMetadata {
    const seasonRatingKey = `${this.idPrefix}-season-${anime.mal_id}-1`;

    return {
      type: 'season',
      ratingKey: seasonRatingKey,
      key: constructMetadataKey(seasonRatingKey),
      guid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'season', seasonRatingKey),
      title: 'Season 1',
      originallyAvailableAt: anime.aired?.from || '',
      index: 1,
      parentRatingKey,
      parentKey: constructMetadataKey(parentRatingKey),
      parentGuid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'show', parentRatingKey),
      parentType: 'show',
      parentTitle: this.getBestTitle(anime),
      thumb: anime.images.jpg.large_image_url || undefined,
      ...people,
    };
  }

  /**
   * Map Jikan anime to Plex SeasonMetadata
   */
  mapAnimeToSeason(
    anime: JikanAnime,
    options?: {
      includeChildren?: boolean;
      episodes?: JikanEpisode[];
      /** series cast and crew (see mapPeople), also given to each episode */
      people?: People;
    }
  ): SeasonMetadata {
    const people = options?.people ?? {};
    const parentRatingKey = `${this.idPrefix}-show-${anime.mal_id}`;
    const seasonRatingKey = `${this.idPrefix}-season-${anime.mal_id}-1`;

    const metadata: SeasonMetadata = {
      type: 'season',
      ratingKey: seasonRatingKey,
      key: options?.includeChildren
        ? constructMetadataKeyWithChildren(seasonRatingKey)
        : constructMetadataKey(seasonRatingKey),
      guid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'season', seasonRatingKey),
      title: 'Season 1',
      originallyAvailableAt: anime.aired?.from || '',
      index: 1,
      parentRatingKey,
      parentKey: constructMetadataKey(parentRatingKey),
      parentGuid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'show', parentRatingKey),
      parentType: 'show',
      parentTitle: this.getBestTitle(anime),
      thumb: anime.images.jpg.large_image_url || undefined,
      ...people,
    };

    // Add episodes if requested
    if (options?.includeChildren && options?.episodes) {
      metadata.Children = {
        size: options.episodes.length,
        Metadata: options.episodes.map((ep) =>
          this.mapEpisodeToMetadata(ep, anime, parentRatingKey, seasonRatingKey, people)
        ),
      };
    }

    return metadata;
  }

  /**
   * Map main anime to a Season 0 (Specials) SeasonMetadata
   */
  mapAnimeToSpecialSeason(
    mainAnime: JikanAnime,
    options?: {
      includeChildren?: boolean;
      specials?: Array<{ anime: JikanAnime; episode: JikanEpisode; globalIndex: number }>;
      /** cast and crew of the main series (see mapPeople), also given to each special */
      people?: People;
    }
  ): SeasonMetadata {
    const people = options?.people ?? {};
    const parentRatingKey = `${this.idPrefix}-show-${mainAnime.mal_id}`;
    const seasonRatingKey = `${this.idPrefix}-season-${mainAnime.mal_id}-0`;

    const metadata: SeasonMetadata = {
      type: 'season',
      ratingKey: seasonRatingKey,
      key: options?.includeChildren
        ? constructMetadataKeyWithChildren(seasonRatingKey)
        : constructMetadataKey(seasonRatingKey),
      guid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'season', seasonRatingKey),
      title: 'Specials',
      originallyAvailableAt: mainAnime.aired?.from || '',
      index: 0,
      parentRatingKey,
      parentKey: constructMetadataKey(parentRatingKey),
      parentGuid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'show', parentRatingKey),
      parentType: 'show',
      parentTitle: this.getBestTitle(mainAnime),
      thumb: mainAnime.images.jpg.large_image_url || undefined,
      ...people,
    };

    if (options?.includeChildren && options.specials) {
      metadata.Children = {
        size: options.specials.length,
        Metadata: options.specials.map((s) =>
          this.mapSpecialEpisodeToMetadata(
            s.episode,
            s.anime,
            mainAnime,
            s.globalIndex,
            parentRatingKey,
            seasonRatingKey,
            people
          )
        ),
      };
    }

    return metadata;
  }

  /**
   * Map a special episode to EpisodeMetadata under the main show's Season 0
   */
  mapSpecialEpisodeToMetadata(
    episode: JikanEpisode,
    specialAnime: JikanAnime,
    mainAnime: JikanAnime,
    globalIndex: number,
    grandparentRatingKey: string,
    parentRatingKey: string,
    people: People = {}
  ): EpisodeMetadata {
    const episodeRatingKey = `${this.idPrefix}-episode-${mainAnime.mal_id}-0-${globalIndex}`;

    return {
      type: 'episode',
      ratingKey: episodeRatingKey,
      key: constructMetadataKey(episodeRatingKey),
      guid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'episode', episodeRatingKey),
      title: episode.title || specialAnime.title_english || specialAnime.title,
      originallyAvailableAt: episode.aired || specialAnime.aired?.from || '',
      index: globalIndex,
      parentIndex: 0,
      summary: episode.synopsis || specialAnime.synopsis || undefined,
      duration: episode.duration
        ? episode.duration * 1000
        : this.parseDuration(specialAnime.duration),
      thumb: specialAnime.images.jpg.large_image_url || undefined,

      parentRatingKey,
      parentKey: constructMetadataKey(parentRatingKey),
      parentGuid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'season', parentRatingKey),
      parentType: 'season',
      parentTitle: 'Specials',
      grandparentRatingKey,
      grandparentKey: constructMetadataKey(grandparentRatingKey),
      grandparentGuid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'show', grandparentRatingKey),
      grandparentType: 'show',
      grandparentTitle: this.getBestTitle(mainAnime),
      grandparentThumb: mainAnime.images.jpg.large_image_url || undefined,
      ...people,
    };
  }

  /**
   * Map Jikan episode to Plex EpisodeMetadata
   */
  mapEpisodeToMetadata(
    episode: JikanEpisode,
    anime: JikanAnime,
    grandparentRatingKey: string,
    parentRatingKey: string,
    people: People = {}
  ): EpisodeMetadata {
    const episodeRatingKey = `${this.idPrefix}-episode-${anime.mal_id}-1-${episode.mal_id}`;

    return {
      type: 'episode',
      ratingKey: episodeRatingKey,
      key: constructMetadataKey(episodeRatingKey),
      guid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'episode', episodeRatingKey),
      title: episode.title || `Episode ${episode.mal_id}`,
      originallyAvailableAt: episode.aired || '',
      index: episode.mal_id,
      parentIndex: 1, // Always season 1
      summary: episode.synopsis || undefined,
      thumb: undefined, // Jikan doesn't provide episode thumbnails
      duration: episode.duration ? episode.duration * 1000 : undefined, // Convert seconds to ms
      Rating: episode.score
        ? [{ image: 'myanimelist://image.rating', type: 'audience', value: Math.round(episode.score * 200) / 100 }]
        : undefined, // 0-5 → 0-10

      // Parent references
      parentRatingKey,
      parentKey: constructMetadataKey(parentRatingKey),
      parentGuid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'season', parentRatingKey),
      parentType: 'season',
      parentTitle: 'Season 1',
      grandparentRatingKey,
      grandparentKey: constructMetadataKey(grandparentRatingKey),
      grandparentGuid: constructGuid(ANIME_PROVIDER_IDENTIFIER, 'show', grandparentRatingKey),
      grandparentType: 'show',
      grandparentTitle: this.getBestTitle(anime),
      grandparentThumb: anime.images.jpg.large_image_url || undefined,
      ...people,
    };
  }
}
