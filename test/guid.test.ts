/**
 * Unit tests for GUID utilities
 */

import {
  validateRatingKey,
  constructGuid,
  parseGuid,
  constructMetadataKey,
  constructMetadataKeyWithChildren,
  createExternalGuid,
} from '../src/utils/guid';

describe('GUID Utilities', () => {
  describe('validateRatingKey', () => {
    it('should accept valid rating keys with letters, numbers, dashes, and underscores', () => {
      expect(validateRatingKey('mal-show-5114')).toBe(true);
      expect(validateRatingKey('mal-season-5114-1')).toBe(true);
      expect(validateRatingKey('mal-episode-5114-1-3')).toBe(true);
      expect(validateRatingKey('ABC123xyz')).toBe(true);
      expect(validateRatingKey('test_key-123')).toBe(true);
    });

    it('should reject rating keys with invalid characters', () => {
      expect(validateRatingKey('invalid key')).toBe(false); // space
      expect(validateRatingKey('invalid.key')).toBe(false); // period
      expect(validateRatingKey('invalid/key')).toBe(false); // slash
      expect(validateRatingKey('invalid:key')).toBe(false); // colon
      expect(validateRatingKey('invalid@key')).toBe(false); // @
    });

    it('should reject empty strings', () => {
      expect(validateRatingKey('')).toBe(false);
    });
  });

  describe('constructGuid', () => {
    const scheme = 'tv.plex.agents.custom.mal';

    it('should construct valid show GUID', () => {
      const guid = constructGuid(scheme, 'show', 'mal-show-5114');
      expect(guid).toBe('tv.plex.agents.custom.mal://show/mal-show-5114');
    });

    it('should construct valid season GUID', () => {
      const guid = constructGuid(scheme, 'season', 'mal-season-5114-1');
      expect(guid).toBe('tv.plex.agents.custom.mal://season/mal-season-5114-1');
    });

    it('should construct valid episode GUID', () => {
      const guid = constructGuid(scheme, 'episode', 'mal-episode-5114-1-3');
      expect(guid).toBe('tv.plex.agents.custom.mal://episode/mal-episode-5114-1-3');
    });

    it('should throw error for invalid ratingKey', () => {
      expect(() => {
        constructGuid(scheme, 'show', 'invalid key');
      }).toThrow('Invalid ratingKey');
    });

    it('should handle ratingKeys with dashes and underscores', () => {
      const guid = constructGuid(scheme, 'show', 'mal_show-123');
      expect(guid).toBe('tv.plex.agents.custom.mal://show/mal_show-123');
    });
  });

  describe('parseGuid', () => {
    it('should parse valid show GUID correctly', () => {
      const guid = 'tv.plex.agents.custom.mal://show/mal-show-5114';
      const parsed = parseGuid(guid);

      expect(parsed.scheme).toBe('tv.plex.agents.custom.mal');
      expect(parsed.metadataType).toBe('show');
      expect(parsed.ratingKey).toBe('mal-show-5114');
    });

    it('should parse season GUID', () => {
      const guid = 'tv.plex.agents.custom.mal://season/mal-season-5114-1';
      const parsed = parseGuid(guid);

      expect(parsed.scheme).toBe('tv.plex.agents.custom.mal');
      expect(parsed.metadataType).toBe('season');
      expect(parsed.ratingKey).toBe('mal-season-5114-1');
    });

    it('should parse episode GUID', () => {
      const guid = 'tv.plex.agents.custom.mal://episode/mal-episode-5114-1-3';
      const parsed = parseGuid(guid);

      expect(parsed.scheme).toBe('tv.plex.agents.custom.mal');
      expect(parsed.metadataType).toBe('episode');
      expect(parsed.ratingKey).toBe('mal-episode-5114-1-3');
    });

    it('should throw error for invalid GUID format', () => {
      expect(() => parseGuid('invalid-guid')).toThrow('Invalid GUID format');
      expect(() => parseGuid('scheme://no-slash')).toThrow('Invalid GUID format');
      expect(() => parseGuid('missing-colon/show/123')).toThrow('Invalid GUID format');
    });
  });

  describe('constructMetadataKey', () => {
    it('should construct metadata key path', () => {
      const key = constructMetadataKey('mal-show-5114');
      expect(key).toBe('/library/metadata/mal-show-5114');
    });

    it('should handle different ratingKeys', () => {
      expect(constructMetadataKey('mal-season-5114-1')).toBe('/library/metadata/mal-season-5114-1');
      expect(constructMetadataKey('mal-episode-5114-1-3')).toBe('/library/metadata/mal-episode-5114-1-3');
    });
  });

  describe('constructMetadataKeyWithChildren', () => {
    it('should construct metadata key with children path', () => {
      const key = constructMetadataKeyWithChildren('mal-show-5114');
      expect(key).toBe('/library/metadata/mal-show-5114/children');
    });

    it('should handle season ratingKeys', () => {
      expect(constructMetadataKeyWithChildren('mal-season-5114-1')).toBe('/library/metadata/mal-season-5114-1/children');
    });
  });

  describe('createExternalGuid', () => {
    it('should create MAL external GUID with numeric ID', () => {
      const guid = createExternalGuid('mal', 5114);
      expect(guid).toBe('mal://5114');
    });

    it('should create AniList external GUID', () => {
      const guid = createExternalGuid('anilist', 'FMA_Brotherhood');
      expect(guid).toBe('anilist://FMA_Brotherhood');
    });

    it('should handle various provider names', () => {
      expect(createExternalGuid('mal', 1535)).toBe('mal://1535');
      expect(createExternalGuid('anilist', 9919)).toBe('anilist://9919');
    });
  });
});
