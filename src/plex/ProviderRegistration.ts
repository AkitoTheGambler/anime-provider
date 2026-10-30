/**
 * Registers this provider with Plex (Settings → Metadata Agents), so it doesn't have to be
 * added by hand. The entry with this identifier is updated when its URL or title changed.
 * Plex doesn't allow an entry's identifier to change, so after a new identifier a new entry
 * is added and the old one is left alone (it may still be used by a library's agent).
 * Choosing the provider for a library stays a setting in Plex.
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
  const existing = providers.find((p) => p.identifier === opts.identifier);

  if (!existing) {
    await opts.plex.addMetadataProvider(opts.uri);
    logger.info(`Registered with Plex as "${opts.title}" (${opts.uri})`);
    const old = providers.find((p) => normalise(p.uri) === uri);
    if (old) {
      logger.warn(
        `Plex still has the entry "${old.title}" (${old.identifier}) for ${old.uri}. ` +
          `Switch the library's agent to "${opts.title}", then remove the old entry in Settings → Metadata Agents.`
      );
    }
    return 'added';
  }

  if (normalise(existing.uri) === uri && existing.title === opts.title) {
    logger.info(`Already registered with Plex as "${opts.title}" (${opts.uri})`);
    return 'unchanged';
  }

  await opts.plex.updateMetadataProvider(existing.id, opts.uri);
  logger.info(`Updated the Plex provider entry "${existing.title}" (${existing.uri}) to "${opts.title}" (${opts.uri})`);
  return 'updated';
}
