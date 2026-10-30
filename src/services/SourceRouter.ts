/**
 * Per-item source selection.
 *
 * Matching:
 *   folder/file tagged {anidb-…} (and AniDB configured) → AniDB
 *   folder/file tagged {mal-…}                          → MyAnimeList (Jikan / MAL v2)
 *   no tag                                              → default METADATA_SOURCE
 *   If the tagged source finds nothing, the default source is tried next
 *   (it can still translate the tag via the ID mapping list).
 *
 * Metadata requests are routed by the ratingKey prefix ("anidb-…" / "mal-…"),
 * so items matched by either source keep working.
 */

import { IdPrefix } from '../clients/AnimeDataSource';
import { MatchService, MatchRequest, MatchServiceOptions } from './MatchService';
import { MetadataService } from './MetadataService';
import { extractTaggedIds } from './IdMapping';
import { MetadataResponse } from '../models/Metadata';
import { ANIME_PROVIDER_IDENTIFIER } from '../constants';
import logger from '../utils/logger';

export interface SourceServices {
  match: MatchService;
  metadata: MetadataService;
}

export class SourceRouter {
  constructor(
    private readonly services: Partial<Record<IdPrefix, SourceServices>>,
    private readonly defaultPrefix: IdPrefix
  ) {
    if (!services[defaultPrefix]) throw new Error(`Default source "${defaultPrefix}" is not configured`);
  }

  /** Order in which sources are tried for a match request */
  matchOrder(request: MatchRequest): IdPrefix[] {
    const tags = extractTaggedIds(request.filename, request.title, request.parentTitle, request.grandparentTitle);
    const order: IdPrefix[] = [];
    for (const p of ['anidb', 'mal'] as IdPrefix[]) {
      if (tags.some((t) => t.provider === p) && this.services[p] && !order.includes(p)) order.push(p);
    }
    if (!order.includes(this.defaultPrefix)) order.push(this.defaultPrefix);
    return order;
  }

  async match(request: MatchRequest, options: MatchServiceOptions = {}): Promise<MetadataResponse> {
    const order = this.matchOrder(request);
    let last: MetadataResponse | null = null;
    for (const prefix of order) {
      try {
        const res = await this.services[prefix]!.match.match(request, options);
        if (res.MediaContainer.size > 0) {
          if (order.length > 1) logger.info(`Matched via ${prefix} (order: ${order.join(' → ')})`);
          return res;
        }
        last = res;
      } catch (e) {
        // try the next source; rethrow only if it was the last one
        if (prefix === order[order.length - 1]) throw e;
        logger.warn(`Match via ${prefix} failed (${(e as Error).message}); trying ${order[order.indexOf(prefix) + 1]}`);
      }
    }
    return (
      last || {
        MediaContainer: { offset: 0, totalSize: 0, identifier: ANIME_PROVIDER_IDENTIFIER, size: 0, Metadata: [] },
      }
    );
  }

  /** Metadata service responsible for a ratingKey ("anidb-show-1" → AniDB, "mal-…" → MAL) */
  metadataFor(ratingKey: string): MetadataService {
    const prefix = ratingKey.match(/^(mal|anidb)-/)?.[1] as IdPrefix | undefined;
    if (!prefix) return this.services[this.defaultPrefix]!.metadata;
    const svc = this.services[prefix];
    if (!svc) {
      throw new Error(
        `ratingKey "${ratingKey}" needs the ${prefix} source, which is not configured` +
          (prefix === 'anidb' ? ' (set ANIDB_CLIENT in .env)' : '')
      );
    }
    return svc.metadata;
  }
}
