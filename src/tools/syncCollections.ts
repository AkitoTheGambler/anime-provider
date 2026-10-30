/**
 * One-off collection sync:  npm run sync-collections
 * Needs the provider running (it resolves collections through it) and
 * PLEX_TOKEN / PLEX_LIBRARY in .env.
 */

import { config } from '../config/env';
import { PlexClient } from '../plex/PlexClient';
import { syncCollections } from '../plex/CollectionSync';
import { makeProviderResolver } from '../plex/providerResolver';
import { ANIME_PROVIDER_IDENTIFIER } from '../constants';

async function main() {
  if (!config.plex.token) throw new Error('PLEX_TOKEN is not set in .env');
  const providerURL = `http://localhost:${config.server.port}`;
  const r = await syncCollections({
    plex: new PlexClient(config.plex.url, config.plex.token),
    library: config.plex.library,
    providerIdentifier: ANIME_PROVIDER_IDENTIFIER,
    resolve: makeProviderResolver(providerURL),
  });
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => {
  const msg = e?.code === 'ECONNREFUSED' ? `${e.message} — is the provider / Plex running?` : e?.message || String(e);
  console.error(`Collection sync failed: ${msg}`);
  process.exit(1);
});
