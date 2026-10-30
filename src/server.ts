/**
 * HTTP Server entry point
 */

import { createApp } from './app';
import { config, validateConfig } from './config/env';
import logger from './utils/logger';
import { PlexClient } from './plex/PlexClient';
import { syncCollections } from './plex/CollectionSync';
import { makeProviderResolver } from './plex/providerResolver';
import { ANIME_PROVIDER_IDENTIFIER, ANIME_PROVIDER_TITLE } from './constants';

// Validate configuration on startup
try {
  validateConfig();
  logger.info('Configuration validated successfully');
} catch (error) {
  console.error('Configuration error:', error instanceof Error ? error.message : error);
  process.exit(1);
}

const app = createApp();

app.listen(config.server.port, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Anime Metadata Provider for Plex (shown in Plex as "${ANIME_PROVIDER_TITLE}")`);
  console.log(`${'='.repeat(60)}\n`);
  console.log(`Server: http://localhost:${config.server.port}`);
  console.log(`Health Check: http://localhost:${config.server.port}/health`);
  console.log(`Provider Definition: http://localhost:${config.server.port}/`);
  console.log(`Match Endpoint: http://localhost:${config.server.port}/library/metadata/matches`);
  console.log(`\nEnvironment: ${config.server.nodeEnv}`);
  console.log(`Metadata source: ${config.source}`);
  console.log(`Match scoring: ${config.match.scoring ? 'on' : 'off'}`);
  console.log(`Collections: ${!config.collections.enabled ? 'off' : !config.plex.token ? 'on (no PLEX_TOKEN)' : config.collections.syncHours > 0 ? `on, every ${config.collections.syncHours}h` : 'on, manual'}`);
  console.log(`\n${'='.repeat(60)}\n`);

  logger.info('Server started successfully', {
    port: config.server.port,
    nodeEnv: config.server.nodeEnv,
    source: config.source,
  });

  scheduleCollectionSync();
});

/**
 * Plex ignores provider collections in TV libraries, so the provider writes
 * them into Plex itself: 2 minutes after start, then every COLLECTION_SYNC_HOURS.
 */
function scheduleCollectionSync(): void {
  if (!config.collections.enabled || !config.plex.token || config.collections.syncHours <= 0) return;
  const run = () =>
    syncCollections({
      plex: new PlexClient(config.plex.url, config.plex.token),
      library: config.plex.library,
      providerIdentifier: ANIME_PROVIDER_IDENTIFIER,
      resolve: makeProviderResolver(`http://localhost:${config.server.port}`),
    }).catch((e) => logger.warn(`Collection sync failed: ${e.message}`));
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, config.collections.syncHours * 60 * 60 * 1000);
}
