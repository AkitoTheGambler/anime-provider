/**
 * Registers this provider with Plex (Settings → Metadata Agents), so it doesn't have to be
 * added by hand. An entry with the same URL is updated, which also picks up a changed
 * identifier or title. Choosing the provider for a library stays a setting in Plex.
 */

import { PlexClient } from './PlexClient';
import logger from '../utils/logger';

export type RegistrationResult = 'added' | 'updated' | 'unchanged';

export interface RegistrationOptions {
  plex: PlexClient;
  /** URL under which Plex reaches this provider */
  uri: string;
  identifier: string;
  title: string;
}

const normalise = (uri: string) => uri.trim().replace(/\/+$/, '').toLowerCase();

export async function registerProvider(opts: RegistrationOptions): Promise<RegistrationResult> {
  const providers = await opts.plex.listMetadataProviders();
  const uri = normalise(opts.uri);
  const existing =
    providers.find((p) => normalise(p.uri) === uri) ?? providers.find((p) => p.identifier === opts.identifier);

  if (!existing) {
    await opts.plex.addMetadataProvider(opts.uri);
    logger.info(`Registered with Plex as "${opts.title}" (${opts.uri})`);
    return 'added';
  }

  if (normalise(existing.uri) === uri && existing.identifier === opts.identifier && existing.title === opts.title) {
    logger.info(`Already registered with Plex as "${opts.title}" (${opts.uri})`);
    return 'unchanged';
  }

  await opts.plex.updateMetadataProvider(existing.id, opts.uri);
  logger.info(
    `Updated the Plex provider entry "${existing.title}" (${existing.identifier}, ${existing.uri}) ` +
      `to "${opts.title}" (${opts.identifier}, ${opts.uri})`
  );
  return 'updated';
}
