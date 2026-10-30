/**
 * Unit tests for Metadata models
 */

import {
  ShowMetadata,
  SeasonMetadata,
  EpisodeMetadata,
  MediaContainer,
  Image,
  Genre,
  Guid,
  Person,
  Rating,
  Network,
} from '../src/models/Metadata';
import { ANIME_PROVIDER_IDENTIFIER } from '../src/constants';

const SCHEME = ANIME_PROVIDER_IDENTIFIER;

describe('Metadata Models', () => {
  describe('ShowMetadata', () => {
    it('should validate required fields for anime show', () => {
      const show: ShowMetadata = {
        type: 'show',
        ratingKey: 'mal-show-5114',
        key: '/library/metadata/mal-show-5114/children',
        guid: `${SCHEME}://show/mal-show-5114`,
        title: 'Fullmetal Alchemist: Brotherhood',
        originallyAvailableAt: '2009-04-05',
      };

      expect(show.type).toBe('show');
      expect(show.ratingKey).toBe('mal-show-5114');
      expect(show.title).toBe('Fullmetal Alchemist: Brotherhood');
    });

    it('should allow all optional show fields', () => {
      const show: ShowMetadata = {
        type: 'show',
        ratingKey: 'mal-show-5114',
        key: '/library/metadata/mal-show-5114/children',
        guid: `${SCHEME}://show/mal-show-5114`,
        title: 'Fullmetal Alchemist: Brotherhood',
        originallyAvailableAt: '2009-04-05',
        originalTitle: '鋼の錬金術師 FULLMETAL ALCHEMIST',
        thumb: 'https://cdn.myanimelist.net/images/anime/poster.jpg',
        art: 'https://cdn.myanimelist.net/images/anime/backdrop.jpg',
        contentRating: 'TV-14',
        year: 2009,
        summary: 'Two brothers use alchemy to try to restore their bodies...',
        duration: 1440000,
        studio: 'Bones',
        isAdult: false,
      };

      expect(show.year).toBe(2009);
      expect(show.originalTitle).toBe('鋼の錬金術師 FULLMETAL ALCHEMIST');
      expect(show.studio).toBe('Bones');
    });

    it('should allow Genre array', () => {
      const genres: Genre[] = [
        { tag: 'Action' },
        { tag: 'Adventure' },
        { tag: 'Fantasy' },
      ];

      const show: ShowMetadata = {
        type: 'show',
        ratingKey: 'mal-show-5114',
        key: '/library/metadata/mal-show-5114/children',
        guid: `${SCHEME}://show/mal-show-5114`,
        title: 'Fullmetal Alchemist: Brotherhood',
        originallyAvailableAt: '2009-04-05',
        Genre: genres,
      };

      expect(show.Genre).toHaveLength(3);
      expect(show.Genre?.[0].tag).toBe('Action');
    });

    it('should allow MAL external Guid', () => {
      const guids: Guid[] = [
        { id: 'mal://5114' },
        { id: 'anilist://9919' },
      ];

      const show: ShowMetadata = {
        type: 'show',
        ratingKey: 'mal-show-5114',
        key: '/library/metadata/mal-show-5114/children',
        guid: `${SCHEME}://show/mal-show-5114`,
        title: 'Fullmetal Alchemist: Brotherhood',
        originallyAvailableAt: '2009-04-05',
        Guid: guids,
      };

      expect(show.Guid).toHaveLength(2);
      expect(show.Guid?.[0].id).toBe('mal://5114');
    });

    it('should allow Role array with voice actors', () => {
      const cast: Person[] = [
        { tag: 'Romi Park', role: 'Edward Elric', order: 1 },
        { tag: 'Rie Kugimiya', role: 'Alphonse Elric', order: 2 },
      ];

      const show: ShowMetadata = {
        type: 'show',
        ratingKey: 'mal-show-5114',
        key: '/library/metadata/mal-show-5114/children',
        guid: `${SCHEME}://show/mal-show-5114`,
        title: 'Fullmetal Alchemist: Brotherhood',
        originallyAvailableAt: '2009-04-05',
        Role: cast,
      };

      expect(show.Role).toHaveLength(2);
      expect(show.Role?.[0].role).toBe('Edward Elric');
    });

    it('should allow MAL audience Rating', () => {
      const ratings: Rating[] = [
        { image: 'mal://image.rating', type: 'audience', value: 9.1 },
      ];

      const show: ShowMetadata = {
        type: 'show',
        ratingKey: 'mal-show-5114',
        key: '/library/metadata/mal-show-5114/children',
        guid: `${SCHEME}://show/mal-show-5114`,
        title: 'Fullmetal Alchemist: Brotherhood',
        originallyAvailableAt: '2009-04-05',
        Rating: ratings,
      };

      expect(show.Rating?.[0].value).toBe(9.1);
      expect(show.Rating?.[0].type).toBe('audience');
    });

    it('should allow Network array for broadcast network', () => {
      const networks: Network[] = [{ tag: 'MBS' }];

      const show: ShowMetadata = {
        type: 'show',
        ratingKey: 'mal-show-5114',
        key: '/library/metadata/mal-show-5114/children',
        guid: `${SCHEME}://show/mal-show-5114`,
        title: 'Fullmetal Alchemist: Brotherhood',
        originallyAvailableAt: '2009-04-05',
        Network: networks,
      };

      expect(show.Network).toHaveLength(1);
      expect(show.Network?.[0].tag).toBe('MBS');
    });

    it('should allow Children object with seasons', () => {
      const show: ShowMetadata = {
        type: 'show',
        ratingKey: 'mal-show-5114',
        key: '/library/metadata/mal-show-5114/children',
        guid: `${SCHEME}://show/mal-show-5114`,
        title: 'Fullmetal Alchemist: Brotherhood',
        originallyAvailableAt: '2009-04-05',
        Children: {
          size: 1,
          Metadata: [
            {
              type: 'season',
              ratingKey: 'mal-season-5114-1',
              key: '/library/metadata/mal-season-5114-1/children',
              guid: `${SCHEME}://season/mal-season-5114-1`,
              title: 'Season 1',
              originallyAvailableAt: '2009-04-05',
              parentRatingKey: 'mal-show-5114',
              parentKey: '/library/metadata/mal-show-5114',
              parentGuid: `${SCHEME}://show/mal-show-5114`,
              parentType: 'show',
              parentTitle: 'Fullmetal Alchemist: Brotherhood',
              index: 1,
            },
          ],
        },
      };

      expect(show.Children?.size).toBe(1);
      expect(show.Children?.Metadata).toHaveLength(1);
      expect(show.Children?.Metadata[0].type).toBe('season');
    });
  });

  describe('SeasonMetadata', () => {
    it('should validate required fields for anime season', () => {
      const season: SeasonMetadata = {
        type: 'season',
        ratingKey: 'mal-season-5114-1',
        key: '/library/metadata/mal-season-5114-1/children',
        guid: `${SCHEME}://season/mal-season-5114-1`,
        title: 'Season 1',
        originallyAvailableAt: '2009-04-05',
        parentRatingKey: 'mal-show-5114',
        parentKey: '/library/metadata/mal-show-5114',
        parentGuid: `${SCHEME}://show/mal-show-5114`,
        parentType: 'show',
        parentTitle: 'Fullmetal Alchemist: Brotherhood',
        index: 1,
      };

      expect(season.type).toBe('season');
      expect(season.index).toBe(1);
      expect(season.parentTitle).toBe('Fullmetal Alchemist: Brotherhood');
      expect(season.parentRatingKey).toBe('mal-show-5114');
    });

    it('should allow optional parentThumb', () => {
      const season: SeasonMetadata = {
        type: 'season',
        ratingKey: 'mal-season-5114-1',
        key: '/library/metadata/mal-season-5114-1/children',
        guid: `${SCHEME}://season/mal-season-5114-1`,
        title: 'Season 1',
        originallyAvailableAt: '2009-04-05',
        parentRatingKey: 'mal-show-5114',
        parentKey: '/library/metadata/mal-show-5114',
        parentGuid: `${SCHEME}://show/mal-show-5114`,
        parentType: 'show',
        parentTitle: 'Fullmetal Alchemist: Brotherhood',
        parentThumb: 'https://cdn.myanimelist.net/images/anime/poster.jpg',
        index: 1,
      };

      expect(season.parentThumb).toBeDefined();
      expect(season.parentGuid).toContain('show');
    });

    it('should allow Children object with episodes', () => {
      const season: SeasonMetadata = {
        type: 'season',
        ratingKey: 'mal-season-5114-1',
        key: '/library/metadata/mal-season-5114-1/children',
        guid: `${SCHEME}://season/mal-season-5114-1`,
        title: 'Season 1',
        originallyAvailableAt: '2009-04-05',
        parentRatingKey: 'mal-show-5114',
        parentKey: '/library/metadata/mal-show-5114',
        parentGuid: `${SCHEME}://show/mal-show-5114`,
        parentType: 'show',
        parentTitle: 'Fullmetal Alchemist: Brotherhood',
        index: 1,
        Children: {
          size: 1,
          Metadata: [
            {
              type: 'episode',
              ratingKey: 'mal-episode-5114-1-1',
              key: '/library/metadata/mal-episode-5114-1-1',
              guid: `${SCHEME}://episode/mal-episode-5114-1-1`,
              title: 'Fullmetal Alchemist',
              originallyAvailableAt: '2009-04-05',
              parentRatingKey: 'mal-season-5114-1',
              parentKey: '/library/metadata/mal-season-5114-1',
              parentGuid: `${SCHEME}://season/mal-season-5114-1`,
              parentType: 'season',
              parentTitle: 'Season 1',
              index: 1,
              grandparentRatingKey: 'mal-show-5114',
              grandparentKey: '/library/metadata/mal-show-5114',
              grandparentGuid: `${SCHEME}://show/mal-show-5114`,
              grandparentType: 'show',
              grandparentTitle: 'Fullmetal Alchemist: Brotherhood',
              parentIndex: 1,
            },
          ],
        },
      };

      expect(season.Children?.size).toBe(1);
      expect(season.Children?.Metadata[0].type).toBe('episode');
    });
  });

  describe('EpisodeMetadata', () => {
    it('should validate required fields for anime episode', () => {
      const episode: EpisodeMetadata = {
        type: 'episode',
        ratingKey: 'mal-episode-5114-1-1',
        key: '/library/metadata/mal-episode-5114-1-1',
        guid: `${SCHEME}://episode/mal-episode-5114-1-1`,
        title: 'Fullmetal Alchemist',
        originallyAvailableAt: '2009-04-05',
        parentRatingKey: 'mal-season-5114-1',
        parentKey: '/library/metadata/mal-season-5114-1',
        parentGuid: `${SCHEME}://season/mal-season-5114-1`,
        parentType: 'season',
        parentTitle: 'Season 1',
        index: 1,
        grandparentRatingKey: 'mal-show-5114',
        grandparentKey: '/library/metadata/mal-show-5114',
        grandparentGuid: `${SCHEME}://show/mal-show-5114`,
        grandparentType: 'show',
        grandparentTitle: 'Fullmetal Alchemist: Brotherhood',
        parentIndex: 1,
      };

      expect(episode.type).toBe('episode');
      expect(episode.index).toBe(1);
      expect(episode.parentIndex).toBe(1);
      expect(episode.grandparentTitle).toBe('Fullmetal Alchemist: Brotherhood');
    });

    it('should require both parent and grandparent attributes', () => {
      const episode: EpisodeMetadata = {
        type: 'episode',
        ratingKey: 'mal-episode-5114-1-1',
        key: '/library/metadata/mal-episode-5114-1-1',
        guid: `${SCHEME}://episode/mal-episode-5114-1-1`,
        title: 'Fullmetal Alchemist',
        originallyAvailableAt: '2009-04-05',
        summary: 'Edward and Alphonse attempt a human transmutation...',
        duration: 1440000,
        parentRatingKey: 'mal-season-5114-1',
        parentKey: '/library/metadata/mal-season-5114-1',
        parentGuid: `${SCHEME}://season/mal-season-5114-1`,
        parentType: 'season',
        parentTitle: 'Season 1',
        parentThumb: 'https://cdn.myanimelist.net/images/anime/poster.jpg',
        index: 1,
        grandparentRatingKey: 'mal-show-5114',
        grandparentKey: '/library/metadata/mal-show-5114',
        grandparentGuid: `${SCHEME}://show/mal-show-5114`,
        grandparentType: 'show',
        grandparentTitle: 'Fullmetal Alchemist: Brotherhood',
        grandparentThumb: 'https://cdn.myanimelist.net/images/anime/poster.jpg',
        parentIndex: 1,
      };

      expect(episode.parentRatingKey).toBeDefined();
      expect(episode.grandparentRatingKey).toBeDefined();
      expect(episode.duration).toBe(1440000);
    });

    it('should allow snapshot Image type for episode thumbnail', () => {
      const images: Image[] = [
        { type: 'snapshot', url: 'https://cdn.myanimelist.net/images/episodes/screenshot.jpg' },
      ];

      const episode: EpisodeMetadata = {
        type: 'episode',
        ratingKey: 'mal-episode-5114-1-1',
        key: '/library/metadata/mal-episode-5114-1-1',
        guid: `${SCHEME}://episode/mal-episode-5114-1-1`,
        title: 'Fullmetal Alchemist',
        originallyAvailableAt: '2009-04-05',
        parentRatingKey: 'mal-season-5114-1',
        parentKey: '/library/metadata/mal-season-5114-1',
        parentGuid: `${SCHEME}://season/mal-season-5114-1`,
        parentType: 'season',
        parentTitle: 'Season 1',
        index: 1,
        grandparentRatingKey: 'mal-show-5114',
        grandparentKey: '/library/metadata/mal-show-5114',
        grandparentGuid: `${SCHEME}://show/mal-show-5114`,
        grandparentType: 'show',
        grandparentTitle: 'Fullmetal Alchemist: Brotherhood',
        parentIndex: 1,
        Image: images,
      };

      expect(episode.Image?.[0].type).toBe('snapshot');
    });
  });

  describe('MediaContainer', () => {
    it('should wrap show metadata in proper structure', () => {
      const container: MediaContainer = {
        offset: 0,
        totalSize: 1,
        identifier: SCHEME,
        size: 1,
        Metadata: [
          {
            type: 'show',
            ratingKey: 'mal-show-5114',
            key: '/library/metadata/mal-show-5114/children',
            guid: `${SCHEME}://show/mal-show-5114`,
            title: 'Fullmetal Alchemist: Brotherhood',
            originallyAvailableAt: '2009-04-05',
          },
        ],
      };

      expect(container.size).toBe(1);
      expect(container.Metadata).toHaveLength(1);
      expect(container.offset).toBe(0);
      expect(container.identifier).toBe(SCHEME);
    });

    it('should support multiple metadata items', () => {
      const container: MediaContainer = {
        offset: 0,
        totalSize: 2,
        identifier: SCHEME,
        size: 2,
        Metadata: [
          {
            type: 'season',
            ratingKey: 'mal-season-5114-1',
            key: '/library/metadata/mal-season-5114-1/children',
            guid: `${SCHEME}://season/mal-season-5114-1`,
            title: 'Season 1',
            originallyAvailableAt: '2009-04-05',
            parentRatingKey: 'mal-show-5114',
            parentKey: '/library/metadata/mal-show-5114',
            parentGuid: `${SCHEME}://show/mal-show-5114`,
            parentType: 'show',
            parentTitle: 'Fullmetal Alchemist: Brotherhood',
            index: 1,
          },
          {
            type: 'season',
            ratingKey: 'mal-season-5114-2',
            key: '/library/metadata/mal-season-5114-2/children',
            guid: `${SCHEME}://season/mal-season-5114-2`,
            title: 'Season 2',
            originallyAvailableAt: '2009-10-01',
            parentRatingKey: 'mal-show-5114',
            parentKey: '/library/metadata/mal-show-5114',
            parentGuid: `${SCHEME}://show/mal-show-5114`,
            parentType: 'show',
            parentTitle: 'Fullmetal Alchemist: Brotherhood',
            index: 2,
          },
        ],
      };

      expect(container.size).toBe(2);
      expect(container.totalSize).toBe(2);
      expect(container.Metadata).toHaveLength(2);
    });

    it('should support empty results', () => {
      const container: MediaContainer = {
        offset: 0,
        totalSize: 0,
        identifier: SCHEME,
        size: 0,
        Metadata: [],
      };

      expect(container.size).toBe(0);
      expect(container.Metadata).toHaveLength(0);
    });
  });
});
