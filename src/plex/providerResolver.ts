/**
 * Resolves a show's franchise collection through the provider's own metadata
 * endpoint, so the sync uses exactly the same logic and caches as Plex sees.
 */

import axios from 'axios';
import { CollectionResolver } from './CollectionSync';

export function makeProviderResolver(providerBaseURL: string): CollectionResolver {
  const base = providerBaseURL.replace(/\/$/, '');
  return async (ratingKey) => {
    const res = await axios.get(`${base}/library/metadata/${ratingKey}`, { timeout: 120000 });
    const cols: any[] = res.data?.MediaContainer?.Metadata?.[0]?.Collection ?? [];
    const list = cols.filter((c) => c?.tag).map((c) => ({ tag: String(c.tag), summary: c.summary, thumb: c.thumb }));
    return list.length ? list : null;
  };
}
