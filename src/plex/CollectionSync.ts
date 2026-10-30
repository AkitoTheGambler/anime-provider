/**
 * Writes franchise collections into a Plex TV library.
 *
 * For every show matched by this provider (guid "<identifier>://show/<prefix>-show-<id>"),
 * the provider's own metadata decides the collection(s) (franchise list; a
 * crossover entry can be in several). The tags are added to the show in Plex; the
 * user's own collections are kept. Collections this provider made (recognised
 * by their summary) that no longer fit are replaced, and left-over empty ones
 * are deleted. New collections get poster + summary.
 *
 * Shows matched with the other ID type (an outdated METADATA_SOURCE) keep their ID and get the
 * collection of their counterpart in the active source, found with the ID list. With rematch they
 * are matched to that counterpart in Plex instead, if it is unambiguous.
 */

import { PlexClient } from './PlexClient';
import logger from '../utils/logger';
import { COLLECTION_SUMMARY_SUFFIX } from '../constants';

export interface ResolvedCollection {
  tag: string;
  summary?: string;
  thumb?: string;
}

/** Returns the collection(s) for a provider ratingKey (e.g. "anidb-show-15910"), or null */
export type CollectionResolver = (
  providerRatingKey: string
) => Promise<ResolvedCollection | ResolvedCollection[] | null>;

export interface CollectionSyncOptions {
  plex: PlexClient;
  library: string;
  /** Only shows whose guid starts with this scheme are touched */
  providerIdentifier: string;
  /** ID prefix of the active source ("mal" / "anidb") */
  idPrefix?: 'mal' | 'anidb';
  resolve: CollectionResolver;
  /** ID of the same anime in another ID space (ID list); undefined = unknown */
  translate?: (from: 'mal' | 'anidb', id: number, to: 'mal' | 'anidb') => Promise<number | undefined>;
  /** Re-match outdated-source shows to their counterpart in the active source */
  rematch?: boolean;
}

export interface CollectionSyncResult {
  shows: number;
  matchedByProvider: number;
  tagged: number;
  /** outdated provider collections replaced on a show */
  retagged: number;
  alreadyTagged: number;
  noCollection: number;
  /** Matched while a different METADATA_SOURCE was active */
  outdatedSource: number;
  /** of those: re-matched to the active source */
  rematched: number;
  /** of those: no counterpart in the ID list */
  noCounterpart: number;
  failed: number;
  newCollections: string[];
  deletedCollections: string[];
}

let running = false;

export async function syncCollections(opts: CollectionSyncOptions): Promise<CollectionSyncResult> {
  if (running) throw new Error('Collection sync already running');
  running = true;
  try {
    return await doSync(opts);
  } finally {
    running = false;
  }
}

async function doSync({ plex, library, providerIdentifier, idPrefix, resolve, translate, rematch }: CollectionSyncOptions): Promise<CollectionSyncResult> {
  const section = await plex.findSection(library);
  if (!section) {
    const titles = await plex.listSectionTitles().catch(() => []);
    throw new Error(`Plex library "${library}" not found (available: ${titles.join(', ') || 'none'})`);
  }

  const result: CollectionSyncResult = {
    shows: 0, matchedByProvider: 0, tagged: 0, retagged: 0, alreadyTagged: 0, noCollection: 0,
    outdatedSource: 0, rematched: 0, noCounterpart: 0, failed: 0,
    newCollections: [], deletedCollections: [],
  };

  const initial = await plex.listCollections(section.key);
  const before = new Set(initial.map((c) => c.title));
  /** collections created by this provider (summary marker) */
  const ours = new Set(initial.filter((c) => (c.summary || '').endsWith(COLLECTION_SUMMARY_SUFFIX)).map((c) => c.title));
  const shows = await plex.listShows(section.key);
  result.shows = shows.length;
  const meta = new Map<string, ResolvedCollection>();
  /** provider ratingKeys already used by a show: a re-match must not create a duplicate */
  const usedKeys = new Set(
    shows.map((s) => s.guid.match(/\/((mal|anidb)-show-\d+)$/)?.[1]).filter((k): k is string => !!k)
  );

  for (const show of shows) {
    if (!show.guid.startsWith(`${providerIdentifier}://`)) continue;
    const m = show.guid.match(/\/((mal|anidb)-show-(\d+))$/);
    if (!m) continue;
    result.matchedByProvider++;

    try {
      let key = m[1];
      if (idPrefix && m[2] !== idPrefix) {
        result.outdatedSource++;
        const counterpart = translate ? await translate(m[2] as 'mal' | 'anidb', parseInt(m[3], 10), idPrefix) : undefined;
        if (!counterpart) {
          result.noCounterpart++;
          result.noCollection++;
          continue;
        }
        key = `${idPrefix}-show-${counterpart}`;
        if (rematch) {
          if (usedKeys.has(key)) {
            logger.warn(`Collection sync: "${show.title}" (${m[1]}) not re-matched, another show already uses ${key}`);
          } else {
            await plex.matchItem(show.ratingKey, `${providerIdentifier}://show/${key}`, show.title);
            usedKeys.add(key);
            result.rematched++;
            logger.info(`Collection sync: re-matched "${show.title}" ${m[1]} → ${key}`);
          }
        }
      }

      const resolved = await resolve(key);
      const cols = (Array.isArray(resolved) ? resolved : resolved ? [resolved] : []).filter((c) => c?.tag);
      if (!cols.length) {
        result.noCollection++;
        continue;
      }
      const wanted = [...new Set(cols.map((c) => c.tag))];
      for (const c of cols) if (!meta.has(c.tag)) meta.set(c.tag, c);

      let existing = show.collections;
      const isStale = (t: string) => ours.has(t) && !wanted.includes(t);
      if (wanted.some((t) => !existing.includes(t)) || existing.some(isStale)) {
        existing = await plex.getItemCollections(show.ratingKey);
      }
      const stale = existing.filter(isStale);
      const missing = wanted.filter((t) => !existing.includes(t));
      if (missing.length === 0 && stale.length === 0) {
        result.alreadyTagged++;
        continue;
      }
      const next = [...existing.filter((t) => !stale.includes(t)), ...missing];
      await plex.setItemCollections(section.key, show.ratingKey, next);
      const target = wanted.map((t) => `"${t}"`).join(', ');
      if (stale.length) {
        result.retagged++;
        logger.info(`Collection sync: "${show.title}" → ${target} (replaced ${stale.map((t) => `"${t}"`).join(', ')})`);
      } else {
        result.tagged++;
        logger.info(`Collection sync: "${show.title}" → ${target}`);
      }
    } catch (e) {
      result.failed++;
      logger.warn(`Collection sync failed for "${show.title}": ${(e as Error).message}`);
    }
  }

  if (result.outdatedSource > result.rematched) {
    const kept = result.outdatedSource - result.rematched - result.noCounterpart;
    logger.info(
      `Collection sync: ${result.outdatedSource} shows on an outdated source: ` +
        `${kept} kept their ID (collection via the ID list), ${result.noCounterpart} without counterpart` +
        (rematch ? '' : '. REMATCH_OUTDATED=true re-matches them')
    );
  }

  if (result.shows > 0 && result.matchedByProvider === 0) {
    logger.warn(
      `Collection sync: none of the ${result.shows} shows in "${library}" carry a ${providerIdentifier} guid ` +
        `(currently matched with ${(shows[0].guid || 'no guid').split('://')[0]})`
    );
  }

  const after = await plex.listCollections(section.key);

  // Remove provider-made collections that no show uses any more
  for (const c of after) {
    if (c.childCount === 0 && (c.summary || '').endsWith(COLLECTION_SUMMARY_SUFFIX)) {
      try {
        await plex.deleteCollection(c.ratingKey);
        result.deletedCollections.push(c.title);
        logger.info(`Collection sync: deleted empty collection "${c.title}"`);
      } catch (e) {
        logger.warn(`Could not delete empty collection "${c.title}": ${(e as Error).message}`);
      }
    }
  }

  // Poster + summary for collections this run created
  const created = after.filter((c) => !before.has(c.title) && meta.has(c.title));
  for (const c of created) {
    const info = meta.get(c.title)!;
    try {
      if (info.thumb) await plex.setCollectionPoster(c.ratingKey, info.thumb);
      if (info.summary) await plex.setCollectionSummary(section.key, c.ratingKey, info.summary);
    } catch (e) {
      logger.warn(`Could not set poster/summary for collection "${c.title}": ${(e as Error).message}`);
    }
    result.newCollections.push(c.title);
  }

  logger.info(
    `Collection sync done: ${result.matchedByProvider}/${result.shows} shows from this provider, ` +
      `${result.tagged} tagged, ${result.retagged} corrected, ${result.alreadyTagged} already tagged, ${result.noCollection} standalone, ` +
      `${result.outdatedSource} outdated source (${result.rematched} re-matched), ` +
      `${result.failed} failed, ${result.newCollections.length} new / ${result.deletedCollections.length} deleted collections`
  );
  return result;
}
