/**
 * Franchise collections from Fribb/anime-lists
 * https://github.com/Fribb/anime-lists  (collections/{mal,anidb}_collection.json)
 *
 * Each franchise = { name, ids[] } built from anime-offline-database's
 * bidirectional "relatedAnime" links: seasons, parts, movies, OVAs and
 * spin-offs of one franchise share one entry. An ID is usually in one
 * franchise; crossover entries can be in several. The file is downloaded at most once per
 * refresh interval and cached on disk; if it can't be loaded, no collection is set.
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

export interface Franchise {
  name: string;
  ids: number[]; // sorted ascending (as published)
  /**
   * Stable collection key: the lowest ID that belongs to this franchise only
   * (a crossover entry shared with other franchises can't identify it).
   */
  key: number;
}

export interface FranchiseListOptions {
  /** 'mal' for jikan/mal sources, 'anidb' for anidb */
  idType: 'mal' | 'anidb';
  baseURL?: string;
  cacheDir?: string;
  refreshHours?: number;
}

const HOUR_MS = 60 * 60 * 1000;

export class FranchiseList {
  private opts: Required<FranchiseListOptions>;
  private index: Map<number, Franchise[]> | null = null;
  private count = 0;
  private loadedAt = 0;
  /** Last download attempt — failed downloads are retried at most every 15 min */
  private lastAttempt = 0;
  private loading: Promise<Map<number, Franchise[]> | null> | null = null;

  constructor(options: FranchiseListOptions) {
    this.opts = {
      idType: options.idType,
      baseURL: (options.baseURL || 'https://raw.githubusercontent.com/Fribb/anime-lists/master/collections').replace(/\/$/, ''),
      cacheDir: path.resolve(options.cacheDir || './cache/collections'),
      refreshHours: options.refreshHours ?? 24,
    };
  }

  private get file(): string {
    return path.join(this.opts.cacheDir, `${this.opts.idType}_collection.json`);
  }

  private get url(): string {
    return `${this.opts.baseURL}/${this.opts.idType}_collection.json`;
  }

  private setIndex(list: Array<{ name?: string; ids?: number[] }>): void {
    const franchises = list
      .filter((f) => f && Array.isArray(f.ids) && f.ids.length)
      .map((f) => ({ name: String(f.name || ''), ids: [...f.ids!].sort((a, b) => a - b), key: 0 }));
    const idx = new Map<number, Franchise[]>();
    for (const franchise of franchises) {
      franchise.ids.forEach((id) => (idx.get(id) ?? idx.set(id, []).get(id)!).push(franchise));
    }
    for (const franchise of franchises) {
      franchise.key = franchise.ids.find((id) => idx.get(id)!.length === 1) ?? franchise.ids[0];
    }
    this.index = idx;
    this.count = franchises.length;
  }

  /** Loads (and if stale, refreshes) the list. Returns null if unavailable. */
  async load(): Promise<Map<number, Franchise[]> | null> {
    const maxAge = this.opts.refreshHours * HOUR_MS;
    if (this.index && Date.now() - this.loadedAt < maxAge) return this.index;
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
          logger.info(`Downloading franchise list: ${this.url}`);
          const res = await axios.get(this.url, { responseType: 'text', timeout: 30000 });
          const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
          JSON.parse(text); // validate before caching
          fs.mkdirSync(this.opts.cacheDir, { recursive: true });
          fs.writeFileSync(this.file, text, 'utf8');
          raw = text;
        } catch (e) {
          logger.warn(`Franchise list download failed (${(e as Error).message}); using cached copy if present`);
        }
      }

      if (raw === null) {
        try {
          raw = fs.readFileSync(this.file, 'utf8');
        } catch {
          logger.warn('No franchise list available — no collections until it can be loaded');
          return this.index; // keep a previously loaded index if any
        }
      }

      try {
        this.setIndex(JSON.parse(raw));
        this.loadedAt = Date.now();
        logger.info(`Franchise list loaded (${this.opts.idType}): ${this.count} franchises`);
      } catch (e) {
        logger.warn(`Franchise list unreadable (${(e as Error).message})`);
      }
      return this.index;
    })().finally(() => {
      this.loading = null;
    });

    return this.loading;
  }

  /** All franchises containing `id` (several for crossover entries); [] if none */
  async findAll(id: number): Promise<Franchise[]> {
    const idx = await this.load();
    return idx?.get(id) ?? [];
  }

  /** First franchise containing `id`, or undefined (not listed / list unavailable) */
  async find(id: number): Promise<Franchise | undefined> {
    return (await this.findAll(id))[0];
  }
}
