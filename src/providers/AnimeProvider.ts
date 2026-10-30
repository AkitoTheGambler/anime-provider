/**
 * Anime Metadata Provider
 * Supports Anime Shows, Seasons, and Episodes
 */

import {
  MediaProvider,
  MediaProviderResponse,
  MetadataType,
  FeatureType,
} from '../models/MediaProvider';
import { ANIME_PREFERENCES } from '../models/Preferences';
import {
  API_PATHS,
  ANIME_PROVIDER_IDENTIFIER,
  ANIME_PROVIDER_TITLE,
  ANIME_PROVIDER_VERSION,
} from '../constants';

/**
 * Creates the Anime MediaProvider definition
 */
export function createAnimeProvider(): MediaProvider {
  return {
    identifier: ANIME_PROVIDER_IDENTIFIER,
    title: ANIME_PROVIDER_TITLE,
    version: ANIME_PROVIDER_VERSION,
    Types: [
      {
        type: MetadataType.SHOW,
        Scheme: [
          {
            scheme: ANIME_PROVIDER_IDENTIFIER,
          },
        ],
      },
      {
        type: MetadataType.SEASON,
        Scheme: [
          {
            scheme: ANIME_PROVIDER_IDENTIFIER,
          },
        ],
      },
      {
        type: MetadataType.EPISODE,
        Scheme: [
          {
            scheme: ANIME_PROVIDER_IDENTIFIER,
          },
        ],
      },
    ],
    Feature: [
      {
        type: FeatureType.METADATA,
        key: `${API_PATHS.LIBRARY_METADATA}`,
      },
      {
        type: FeatureType.MATCH,
        key: `${API_PATHS.LIBRARY_MATCHES}`,
      },
    ],
    Setting: ANIME_PREFERENCES,
  };
}

/**
 * Gets the full MediaProvider response
 */
export function getAnimeProviderResponse(): MediaProviderResponse {
  return {
    MediaProvider: createAnimeProvider(),
  };
}
