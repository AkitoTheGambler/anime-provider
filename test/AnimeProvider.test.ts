/**
 * Unit tests for Anime MediaProvider
 */

import {
  createAnimeProvider,
  getAnimeProviderResponse,
} from '../src/providers/AnimeProvider';
import {
  ANIME_PROVIDER_IDENTIFIER,
  ANIME_PROVIDER_TITLE,
  ANIME_PROVIDER_VERSION,
} from '../src/constants';
import { MetadataType, FeatureType } from '../src/models/MediaProvider';

describe('Anime MediaProvider', () => {
  describe('createAnimeProvider', () => {
    const provider = createAnimeProvider();

    it('should have the correct identifier', () => {
      expect(provider.identifier).toBe(process.env.PROVIDER_IDENTIFIER || 'tv.plex.agents.custom.anime');
      expect(provider.identifier).toBe(ANIME_PROVIDER_IDENTIFIER);
    });

    it('should have the correct title', () => {
      expect(provider.title).toBe(process.env.PROVIDER_TITLE || 'Anime');
      expect(provider.title).toBe(ANIME_PROVIDER_TITLE);
    });

    it('should have a version', () => {
      expect(provider.version).toBe(ANIME_PROVIDER_VERSION);
      expect(provider.version).toBe('1.0.0');
    });

    it('should support Show, Season, and Episode types', () => {
      expect(provider.Types).toHaveLength(3);

      const types = provider.Types.map((t) => t.type);
      expect(types).toContain(MetadataType.SHOW);
      expect(types).toContain(MetadataType.SEASON);
      expect(types).toContain(MetadataType.EPISODE);
    });

    it('should not support Movie or Collection types', () => {
      const types = provider.Types.map((t) => t.type);
      expect(types).not.toContain(MetadataType.MOVIE);
      expect(types).not.toContain(MetadataType.COLLECTION);
    });

    it('should have the correct scheme for each type', () => {
      provider.Types.forEach((typeDefinition) => {
        expect(typeDefinition.Scheme).toHaveLength(1);
        expect(typeDefinition.Scheme[0].scheme).toBe(ANIME_PROVIDER_IDENTIFIER);
      });
    });

    it('should have metadata and match features', () => {
      expect(provider.Feature).toHaveLength(2);

      const featureTypes = provider.Feature.map((f) => f.type);
      expect(featureTypes).toContain(FeatureType.METADATA);
      expect(featureTypes).toContain(FeatureType.MATCH);
    });

    it('should not have collection feature', () => {
      const featureTypes = provider.Feature.map((f) => f.type);
      expect(featureTypes).not.toContain(FeatureType.COLLECTION);
    });

    it('should have correct metadata feature endpoint', () => {
      const metadataFeature = provider.Feature.find(
        (f) => f.type === FeatureType.METADATA
      );
      expect(metadataFeature).toBeDefined();
      expect(metadataFeature?.key).toBe('/library/metadata');
    });

    it('should have correct match feature endpoint', () => {
      const matchFeature = provider.Feature.find(
        (f) => f.type === FeatureType.MATCH
      );
      expect(matchFeature).toBeDefined();
      expect(matchFeature?.key).toBe('/library/metadata/matches');
    });

    it('should validate identifier format (must use custom prefix)', () => {
      expect(provider.identifier).toMatch(/^tv\.plex\.agents\.custom\./);
    });

    it('should validate identifier characters (only ASCII letters, numbers, and periods)', () => {
      expect(provider.identifier).toMatch(/^[a-zA-Z0-9.]+$/);
    });

    it('should have correct numeric values for metadata types', () => {
      const showType = provider.Types.find((t) => t.type === MetadataType.SHOW);
      const seasonType = provider.Types.find((t) => t.type === MetadataType.SEASON);
      const episodeType = provider.Types.find((t) => t.type === MetadataType.EPISODE);

      expect(showType?.type).toBe(2);
      expect(seasonType?.type).toBe(3);
      expect(episodeType?.type).toBe(4);
    });

    it('should expose provider preferences/settings', () => {
      expect(provider.Setting).toBeDefined();
      expect(Array.isArray(provider.Setting)).toBe(true);
    });

    it('should have titleLanguage preference', () => {
      const titlePref = provider.Setting?.find((s) => s.id === 'titleLanguage');
      expect(titlePref).toBeDefined();
      expect(titlePref?.type).toBe('enum');
      expect(titlePref?.values).toContain('english');
      expect(titlePref?.values).toContain('romaji');
      expect(titlePref?.values).toContain('japanese');
    });

    it('should not have includeAdult preference (handled by Plex directly)', () => {
      const adultPref = provider.Setting?.find((s) => s.id === 'includeAdult');
      expect(adultPref).toBeUndefined();
    });
  });

  describe('getAnimeProviderResponse', () => {
    const response = getAnimeProviderResponse();

    it('should wrap provider in MediaProvider property', () => {
      expect(response).toHaveProperty('MediaProvider');
    });

    it('should return complete provider definition', () => {
      expect(response.MediaProvider.identifier).toBe(ANIME_PROVIDER_IDENTIFIER);
      expect(response.MediaProvider.title).toBe(ANIME_PROVIDER_TITLE);
      expect(response.MediaProvider.Types).toHaveLength(3);
      expect(response.MediaProvider.Feature).toHaveLength(2);
    });
  });
});
