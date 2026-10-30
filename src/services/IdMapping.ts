/**
 * Cross-site anime ID mapping from Fribb/anime-lists (anime-list-full.json,
 * the readable pretty-printed version — open it in an editor to inspect IDs):
 * one entry per anime with mal_id, anidb_id, anilist_id, ... Used to turn an ID
 * tagged in a folder/file name (e.g. "{anidb-12566}") into the active source's ID.
 * Downloaded at most once a day, cached on disk.
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

export type IdProvider = 'mal' | 'anidb' | 'anilist';

export interface TaggedId {
  provider: IdProvider;
  id: number;
}

const HOUR_MS = 60 * 60 * 1000;
const FIELD: Record<IdProvider, string> = { mal: 'mal_id', anidb: 'anidb_id', anilist: 'anilist_id' };

/**
 * Extracts tagged IDs from names like
 *   "Code Geass (2019) {anidb-12566}"   (Plex naming convention)
 *   "Code Geass [anidb-12566]"          (Hama / ASS convention, also anidb2-)
 *   "{mal-34437}", "[myanimelist-34437]", "{anilist-97880}"
 */
export function extractTaggedIds(...texts: (string | undefined | null)[]): TaggedId[] {
  const found: TaggedId[] = [];
  const re = /[{\[]\s*(anidb\d?|mal|myanimelist|anilist)\s*[-=:]\s*(\d+)\s*[}\]]/gi;
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(re)) {
      const key = m[1].toLowerCase();
      const provider: IdProvider = key.startsWith('anidb') ? 'anidb' : key === 'anilist' ? 'anilist' : 'mal';
      const id = parseInt(m[2], 10);
      if (!found.some((f) => f.provider === provider && f.id === id)) found.push({ provider, id });
    }
  }
  return found;
}

export interface IdMappingOptions {
  url?: string;
  cacheDir?: string;
  refreshHours?: number;
}

export class IdMapping {
  private opts: Required<IdMappingOptions>;
  private maps: Record<IdProvider, Map<number, any>> | null = null;
  private loadedAt = 0;
  /** Last download attempt — failed downloads are retried at most every 15 min */
  private lastAttempt = 0;
  private loading: Promise<IdMapping['maps']> | null = null;

  constructor(options: IdMappingOptions = {}) {
    this.opts = {
      url: options.url || 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json',
      cacheDir: path.resolve(options.cacheDir || './cache/collections'),
      refreshHours: options.refreshHours ?? 24,
    };
  }

  private get file(): string {
    return path.join(this.opts.cacheDir, 'anime-list-full.json');
  }

  private buildMaps(list: any[]): Record<IdProvider, Map<number, any>> {
    const maps: Record<IdProvider, Map<number, any>> = { mal: new Map(), anidb: new Map(), anilist: new Map() };
    for (const e of list) {
      (Object.keys(FIELD) as IdProvider[]).forEach((p) => {
        const v = e[FIELD[p]];
        if (typeof v === 'number' && !maps[p].has(v)) maps[p].set(v, e);
      });
    }
    return maps;
  }

  private async load(): Promise<IdMapping['maps']> {
    const maxAge = this.opts.refreshHours * HOUR_MS;
    if (this.maps && Date.now() - this.loadedAt < maxAge) return this.maps;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      let raw: string | null = null;
      let fresh = false;
      try {
        fresh = Date.now() - fs.statSync(this.file).mtimeMs < maxAge;
      } catch {
        /* no cache yet */
      }
      if (!fresh && Date.now() - this.lastAttempt >= 15 * 60 * 1000) {
        this.lastAttempt = Date.now();
        try {
          logger.info(`Downloading ID mapping list: ${this.opts.url}`);
          const res = await axios.get(this.opts.url, { responseType: 'text', timeout: 60000 });
          const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
          JSON.parse(text);
          fs.mkdirSync(this.opts.cacheDir, { recursive: true });
          fs.writeFileSync(this.file, text, 'utf8');
          raw = text;
        } catch (e) {
          logger.warn(`ID mapping download failed (${(e as Error).message}); using cached copy if present`);
        }
      }
      if (raw === null) {
        try {
          raw = fs.readFileSync(this.file, 'utf8');
        } catch {
          logger.warn('No ID mapping list available — only IDs of the active source can be used');
          return this.maps;
        }
      }
      try {
        const list: any[] = JSON.parse(raw);
        this.maps = this.buildMaps(list);
        this.loadedAt = Date.now();
        logger.info(`ID mapping loaded: ${list.length} entries`);
      } catch (e) {
        logger.warn(`ID mapping unreadable (${(e as Error).message})`);
      }
      return this.maps;
    })().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  /** Converts an ID between providers; undefined if unknown */
  async convert(from: IdProvider, id: number, to: IdProvider): Promise<number | undefined> {
    if (from === to) return id;
    const maps = await this.load();
    const v = maps?.[from].get(id)?.[FIELD[to]];
    return typeof v === 'number' ? v : undefined;
  }
}
