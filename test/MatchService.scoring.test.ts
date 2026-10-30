/**
 * Unit tests for MatchService scoring algorithm
 * Tests private scoring methods via type assertion (no API calls needed)
 */

import { MatchService } from '../src/services/MatchService';
import { JikanAnimeSearchResult } from '../src/types/jikan';

const service = new MatchService() as any;

function makeResult(overrides: Partial<JikanAnimeSearchResult>): JikanAnimeSearchResult {
  return {
    mal_id: 1,
    url: '',
    approved: true,
    airing: false,
    source: 'Manga',
    title: 'Test Anime',
    title_english: null,
    title_japanese: null,
    title_synonyms: [],
    titles: [],
    year: null,
    score: null,
    type: 'TV',
    status: 'Finished Airing',
    episodes: 12,
    images: { jpg: { image_url: '', large_image_url: '' }, webp: { image_url: '', large_image_url: '' } },
    trailer: null,
    aired: { from: null, to: null, string: '' },
    duration: '24 min per ep',
    rating: 'PG-13 - Teens 13 or older',
    scored_by: null,
    rank: null,
    popularity: null,
    members: null,
    favorites: null,
    synopsis: null,
    background: null,
    season: null,
    broadcast: null,
    producers: [],
    licensors: [],
    studios: [],
    genres: [],
    explicit_genres: [],
    themes: [],
    demographics: [],
    ...overrides,
  };
}

describe('MatchService Scoring Algorithm', () => {
  describe('normalizeTitle', () => {
    it('should lowercase the title', () => {
      expect(service.normalizeTitle('Attack on Titan')).toBe('attack on titan');
    });

    it('should remove leading articles', () => {
      expect(service.normalizeTitle('The Rising of the Shield Hero')).toBe('rising of shield hero');
      expect(service.normalizeTitle('A Silent Voice')).toBe('silent voice');
      expect(service.normalizeTitle('An Unusual Hero')).toBe('unusual hero');
    });

    it('should remove diacritics', () => {
      expect(service.normalizeTitle('Bersérk')).toBe('berserk');
    });

    it('should remove special characters', () => {
      expect(service.normalizeTitle('Re:Zero')).toBe('rezero');
      expect(service.normalizeTitle('Sword Art Online!')).toBe('sword art online');
    });

    it('should normalize multiple spaces', () => {
      expect(service.normalizeTitle('Attack  on   Titan')).toBe('attack on titan');
    });
  });

  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(service.levenshteinDistance('attack', 'attack')).toBe(0);
    });

    it('should return string length for empty vs non-empty', () => {
      expect(service.levenshteinDistance('', 'anime')).toBe(5);
      expect(service.levenshteinDistance('anime', '')).toBe(5);
    });

    it('should return 1 for single substitution', () => {
      expect(service.levenshteinDistance('kitten', 'sitten')).toBe(1);
    });

    it('should return 1 for single insertion', () => {
      expect(service.levenshteinDistance('titan', 'titans')).toBe(1);
    });

    it('should return 1 for single deletion', () => {
      expect(service.levenshteinDistance('titans', 'titan')).toBe(1);
    });
  });

  describe('fuzzyMatchScore', () => {
    it('should return 100 for identical strings', () => {
      expect(service.fuzzyMatchScore('naruto', 'naruto')).toBe(100);
    });

    it('should return 0 for completely different strings of same length', () => {
      const score = service.fuzzyMatchScore('aaaa', 'zzzz');
      expect(score).toBe(0);
    });

    it('should return high score for near-matches', () => {
      const score = service.fuzzyMatchScore('naruto', 'narutoo');
      expect(score).toBeGreaterThan(80);
    });

    it('should return lower score for more distant strings', () => {
      const closeScore = service.fuzzyMatchScore('attack on titan', 'attack on titans');
      const farScore = service.fuzzyMatchScore('attack on titan', 'one piece');
      expect(closeScore).toBeGreaterThan(farScore);
    });

    it('should return 100 for empty strings', () => {
      expect(service.fuzzyMatchScore('', '')).toBe(100);
    });
  });

  describe('scoreAnimeMatches', () => {
    it('should give highest score to exact title match', () => {
      const results = [
        makeResult({ mal_id: 1, title: 'Naruto', score: 7.0 }),
        makeResult({ mal_id: 2, title: 'Naruto Shippuden', score: 8.0 }),
      ];

      const scored = service.scoreAnimeMatches(results, 'Naruto');
      expect(scored[0].mal_id).toBe(1);
    });

    it('should prefer exact match over higher MAL score', () => {
      const results = [
        makeResult({ mal_id: 1, title: 'One Piece', score: 9.2 }),
        makeResult({ mal_id: 2, title: 'Dragon Ball', score: 7.0 }),
      ];

      const scored = service.scoreAnimeMatches(results, 'Dragon Ball');
      expect(scored[0].mal_id).toBe(2);
    });

    it('should match against english title variant', () => {
      const results = [
        makeResult({ mal_id: 1, title: 'Shingeki no Kyojin', title_english: 'Attack on Titan', score: 9.0 }),
        makeResult({ mal_id: 2, title: 'Something Else', title_english: null, score: 5.0 }),
      ];

      const scored = service.scoreAnimeMatches(results, 'Attack on Titan');
      expect(scored[0].mal_id).toBe(1);
    });

    it('should match against japanese title variant', () => {
      const results = [
        makeResult({
          mal_id: 1,
          title: 'Fullmetal Alchemist: Brotherhood',
          title_japanese: '鋼の錬金術師 FULLMETAL ALCHEMIST',
          score: 9.1,
        }),
        makeResult({ mal_id: 2, title: 'Another Show', score: 8.0 }),
      ];

      const scored = service.scoreAnimeMatches(results, 'Fullmetal Alchemist: Brotherhood');
      expect(scored[0].mal_id).toBe(1);
    });

    it('should match against title synonyms', () => {
      const results = [
        makeResult({
          mal_id: 1,
          title: 'Kimi no Na wa.',
          title_english: 'Your Name.',
          title_synonyms: ['Your Name'],
          score: 9.0,
        }),
        makeResult({ mal_id: 2, title: 'Other Film', score: 8.0 }),
      ];

      const scored = service.scoreAnimeMatches(results, 'Your Name');
      expect(scored[0].mal_id).toBe(1);
    });

    it('should apply year bonus when year matches', () => {
      const results = [
        makeResult({ mal_id: 1, title: 'Overlord', year: 2015, score: 7.5 }),
        makeResult({ mal_id: 2, title: 'Overlord', year: 2018, score: 7.5 }),
      ];

      const scored = service.scoreAnimeMatches(results, 'Overlord', 2015);
      expect(scored[0].mal_id).toBe(1);
    });

    it('should not apply year bonus when no year provided', () => {
      const results = [
        makeResult({ mal_id: 1, title: 'Overlord', year: 2015, score: 7.5 }),
        makeResult({ mal_id: 2, title: 'Overlord', year: 2018, score: 8.0 }),
      ];

      const scored = service.scoreAnimeMatches(results, 'Overlord');
      // Without year, higher MAL score should win (both exact match, so popularity bonus applies)
      expect(scored[0].mal_id).toBe(2);
    });

    it('should use popularity bonus as tiebreaker', () => {
      const results = [
        makeResult({ mal_id: 1, title: 'Naruto', score: 7.0 }),
        makeResult({ mal_id: 2, title: 'Naruto', score: 8.0 }),
      ];

      const scored = service.scoreAnimeMatches(results, 'Naruto');
      // Both exact match (+100), higher score wins via popularity bonus
      expect(scored[0].mal_id).toBe(2);
    });

    it('should return results sorted by score descending', () => {
      const results = [
        makeResult({ mal_id: 1, title: 'Death Note', score: 8.6 }),
        makeResult({ mal_id: 2, title: 'Something Unrelated', score: 9.5 }),
        makeResult({ mal_id: 3, title: 'Death Note', score: 7.0 }),
      ];

      const scored = service.scoreAnimeMatches(results, 'Death Note');
      expect(scored[0].matchScore).toBeGreaterThanOrEqual(scored[1].matchScore);
      expect(scored[1].matchScore).toBeGreaterThanOrEqual(scored[2].matchScore);
    });

    it('should attach matchScore to each result', () => {
      const results = [makeResult({ mal_id: 1, title: 'Cowboy Bebop', score: 8.8 })];
      const scored = service.scoreAnimeMatches(results, 'Cowboy Bebop');

      expect(scored[0]).toHaveProperty('matchScore');
      expect(typeof scored[0].matchScore).toBe('number');
      expect(scored[0].matchScore).toBeGreaterThan(0);
    });
  });
});
