/**
 * Anime Provider Routes
 */

import { Router, Request, Response } from 'express';
import { getAnimeProviderResponse } from '../providers/AnimeProvider';
import { MatchService, MatchRequest } from '../services/MatchService';
import { MetadataService } from '../services/MetadataService';
import { getPreferencesResponse } from '../models/Preferences';
import { config } from '../config/env';
import { getSourceFor, getFranchiseList, getIdMapping, defaultPrefix } from '../clients/createDataSource';
import { SourceRouter, SourceServices } from '../services/SourceRouter';
import { IdPrefix } from '../clients/AnimeDataSource';
import { API_PATHS, DEFAULT_PAGE_SIZE } from '../constants';
import logger from '../utils/logger';

const router = Router();

/** Short error text for logs (no stack traces / request dumps) */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Services per ID space, created once and reused across requests
let sourceRouter: SourceRouter | null = null;

function buildServices(prefix: IdPrefix): SourceServices | undefined {
  const source = getSourceFor(prefix);
  if (!source) return undefined;
  const mapperConfig = { titleLanguage: config.preferences.titleLanguage };
  return {
    match: new MatchService(source, mapperConfig, { scoring: config.match.scoring, idMapping: getIdMapping() }),
    metadata: new MetadataService(source, mapperConfig, {
      enabled: config.collections.enabled,
      franchiseList: config.collections.enabled ? getFranchiseList(prefix) : undefined,
    }),
  };
}

function getRouter(): SourceRouter {
  if (!sourceRouter) {
    sourceRouter = new SourceRouter({ mal: buildServices('mal'), anidb: buildServices('anidb') }, defaultPrefix());
  }
  return sourceRouter;
}

/**
 * Helper to parse Plex headers
 */
function parseHeaders(req: Request): {
  language?: string;
  country?: string;
  containerSize?: number;
  containerStart?: number;
} {
  return {
    language: req.get('X-Plex-Language') || undefined,
    country: req.get('X-Plex-Country') || undefined,
    containerSize: req.get('X-Plex-Container-Size')
      ? parseInt(req.get('X-Plex-Container-Size')!, 10)
      : DEFAULT_PAGE_SIZE,
    containerStart: req.get('X-Plex-Container-Start')
      ? parseInt(req.get('X-Plex-Container-Start')!, 10)
      : 1,
  };
}

/**
 * Get MediaProvider definition
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const providerResponse = getAnimeProviderResponse();
    logger.info('Provider response:', {
      hasSettings: !!providerResponse.MediaProvider.Setting,
      settingsLength: providerResponse.MediaProvider.Setting?.length,
      response: JSON.stringify(providerResponse).substring(0, 500)
    });
    res.json(providerResponse);
  } catch (error) {
    logger.error('Error getting provider definition', { error });
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get images for an item
 */
router.get(`${API_PATHS.LIBRARY_METADATA}/:ratingKey/images`, async (req: Request, res: Response) => {
  try {
    const ratingKey = Array.isArray(req.params.ratingKey) ? req.params.ratingKey[0] : req.params.ratingKey;
    const { language, country } = parseHeaders(req);

    const service = getRouter().metadataFor(ratingKey);
    const imagesResponse = await service.getImages(ratingKey, {
      language,
      country,
    });

    res.json(imagesResponse);
  } catch (error) {
    logger.error('Error getting images', { error: errorMessage(error), ratingKey: req.params.ratingKey });
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get children (seasons for shows, episodes for seasons)
 */
router.get(`${API_PATHS.LIBRARY_METADATA}/:ratingKey/children`, async (req: Request, res: Response) => {
  try {
    const ratingKey = Array.isArray(req.params.ratingKey) ? req.params.ratingKey[0] : req.params.ratingKey;
    const { language, country, containerSize, containerStart } = parseHeaders(req);

    const service = getRouter().metadataFor(ratingKey);
    const metadataResponse = await service.getChildren(
      ratingKey,
      { language, country },
      { containerSize, containerStart }
    );

    res.json(metadataResponse);
  } catch (error) {
    logger.error('Error getting children', { error: errorMessage(error), ratingKey: req.params.ratingKey });
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get metadata for a specific item
 */
router.get(`${API_PATHS.LIBRARY_METADATA}/:ratingKey`, async (req: Request, res: Response) => {
  try {
    const ratingKey = Array.isArray(req.params.ratingKey) ? req.params.ratingKey[0] : req.params.ratingKey;
    const { language, country, containerSize, containerStart } = parseHeaders(req);
    const includeChildren = req.query.includeChildren === '1';

    const service = getRouter().metadataFor(ratingKey);
    const metadataResponse = await service.getMetadata(
      ratingKey,
      {
        language,
        country,
        includeChildren,
      },
      { containerSize, containerStart }
    );

    res.json(metadataResponse);
  } catch (error) {
    logger.error('Error getting metadata', { error: errorMessage(error), ratingKey: req.params.ratingKey });
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Match endpoint - search/match for items
 */
router.post(API_PATHS.LIBRARY_MATCHES, async (req: Request, res: Response) => {
  try {
    const matchRequest: MatchRequest = req.body;
    const { language, country } = parseHeaders(req);

    logger.info('Match request received', { matchRequest });

    const service = getRouter();
    const matchResponse = await service.match(matchRequest, {
      language,
      country,
    });

    res.json(matchResponse);
  } catch (error) {
    logger.error('Error matching', { error: errorMessage(error), body: req.body });
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /:/prefs
 * Returns provider preferences/settings for Plex UI
 */
router.get(/^\/\:\/prefs$/, (_req: Request, res: Response) => {
  logger.info('Incoming Request: GET /:/prefs');
  res.json(getPreferencesResponse());
});

export default router;
