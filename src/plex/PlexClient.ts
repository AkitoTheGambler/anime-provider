/**
 * Minimal Plex Media Server API client for collection tagging.
 * Plex ignores provider-supplied collections in TV libraries, so collections
 * are set on the items directly — the same API Plex Web and Kometa use.
 */

import axios, { AxiosInstance } from 'axios';

export interface PlexShow {
  ratingKey: string; // Plex's own item key
  guid: string; // provider guid, e.g. tv.plex.agents.custom.anime://show/anidb-show-15910
  title: string;
  collections: string[];
}

export interface PlexCollection {
  ratingKey: string;
  title: string;
  thumb?: string;
  summary?: string;
  /** undefined when Plex didn't report it — never treated as empty */
  childCount?: number;
}

export class PlexClient {
  private http: AxiosInstance;

  constructor(baseURL: string, token: string) {
    this.http = axios.create({
      baseURL: baseURL.replace(/\/$/, ''),
      timeout: 30000,
      headers: { Accept: 'application/json', 'X-Plex-Token': token },
    });
  }

  /** Library section key by title (case-insensitive) */
  async findSection(title: string): Promise<{ key: string; type: string } | null> {
    const res = await this.http.get('/library/sections');
    const dirs: any[] = res.data?.MediaContainer?.Directory || [];
    const d = dirs.find((x) => String(x.title).toLowerCase() === title.toLowerCase());
    return d ? { key: String(d.key), type: String(d.type) } : null;
  }

  async listSectionTitles(): Promise<string[]> {
    const res = await this.http.get('/library/sections');
    return (res.data?.MediaContainer?.Directory || []).map((x: any) => String(x.title));
  }

  /** All shows of a section with guid and (possibly truncated) collection tags */
  async listShows(sectionKey: string): Promise<PlexShow[]> {
    const res = await this.http.get(`/library/sections/${sectionKey}/all`, { params: { type: 2 } });
    const items: any[] = res.data?.MediaContainer?.Metadata || [];
    return items.map((m) => ({
      ratingKey: String(m.ratingKey),
      guid: String(m.guid || ''),
      title: String(m.title || ''),
      collections: (m.Collection || []).map((c: any) => String(c.tag)),
    }));
  }

  /** Full collection list of one item (the section listing may truncate tags) */
  async getItemCollections(ratingKey: string): Promise<string[]> {
    const res = await this.http.get(`/library/metadata/${ratingKey}`);
    const m = res.data?.MediaContainer?.Metadata?.[0];
    return (m?.Collection || []).map((c: any) => String(c.tag));
  }

  /**
   * Sets the item's complete collection list (Plex replaces the list, so the
   * caller passes existing + new). Locks the field so agent refreshes keep it.
   */
  async setItemCollections(sectionKey: string, ratingKey: string, collections: string[]): Promise<void> {
    const params: Record<string, string | number> = { type: 2, id: ratingKey, 'collection.locked': 1 };
    collections.forEach((c, i) => {
      params[`collection[${i}].tag.tag`] = c;
    });
    await this.http.put(`/library/sections/${sectionKey}/all`, null, { params });
  }

  async listCollections(sectionKey: string): Promise<PlexCollection[]> {
    const res = await this.http.get(`/library/sections/${sectionKey}/collections`);
    return (res.data?.MediaContainer?.Metadata || []).map((c: any) => ({
      ratingKey: String(c.ratingKey),
      title: String(c.title),
      thumb: c.thumb,
      summary: c.summary,
      childCount: c.childCount === undefined || c.childCount === null ? undefined : Number(c.childCount),
    }));
  }

  async deleteCollection(collectionKey: string): Promise<void> {
    await this.http.delete(`/library/collections/${collectionKey}`);
  }

  async setCollectionPoster(collectionKey: string, url: string): Promise<void> {
    await this.http.post(`/library/metadata/${collectionKey}/posters`, null, { params: { url } });
  }

  async setCollectionSummary(sectionKey: string, collectionKey: string, summary: string): Promise<void> {
    await this.http.put(`/library/sections/${sectionKey}/all`, null, {
      params: { type: 18, id: collectionKey, 'summary.value': summary, 'summary.locked': 1 },
    });
  }
}
