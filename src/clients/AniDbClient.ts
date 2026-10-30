/**
 * AniDB HTTP API client
 * Docs: https://wiki.anidb.net/HTTP_API_Definition
 *
 * AniDB rules this client follows (breaking them gets your IP banned):
 *  - a registered client name + version is required (https://anidb.net/software/add)
 *  - at most one request every 2 seconds  → ANIDB_REQUEST_INTERVAL_MS (default 2500)
 *  - don't request the same anime more than once a day → on-disk cache (ANIDB_CACHE_HOURS)
 *  - there is no search endpoint; search runs locally against the daily
 *    anime-titles dump, which is downloaded at most once per ANIDB_TITLES_REFRESH_HOURS
 *
 * IDs are AniDB anime IDs (aid). They are stored in the normalised `mal_id`
 * field; the real MAL ID (if AniDB knows it) is exposed as an external link.
 * Specials come natively from AniDB's "S" episodes (S1, S2, ...).
 */

import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import logger from '../utils/logger';
import {
  AnimeDataSource,
  IntervalQueue,
  Recommendation,
  SearchHints,
  SpecialEntry,
  normaliseDate,
  yearMatches,
  toEpisodesResponse,
} from './AnimeDataSource';
import {
  JikanAnime,
  JikanEpisode,
  JikanEpisodesResponse,
  JikanCharacter,
  JikanCharactersResponse,
  JikanStaffResponse,
  JikanPicturesResponse,
  JikanSearchResponse,
  JikanSearchOptions,
  JikanRelation,
  JikanTitle,
} from '../types/jikan';

type TitleLanguage = 'english' | 'romaji' | 'japanese' | 'german' | 'french' | 'spanish';

export interface AniDbClientOptions {
  client: string;
  clientVersion: string;
  apiURL?: string;
  titlesURL?: string;
  imageBaseURL?: string;
  cacheDir?: string;
  cacheHours?: number;
  titlesRefreshHours?: number;
  requestIntervalMs?: number;
  minTagWeight?: number;
  titleLanguage?: TitleLanguage;
}

interface ParsedAnime {
  anime: JikanAnime;
  episodes: JikanEpisode[];
  specials: JikanEpisode[];
  characters: JikanCharacter[];
  staff: JikanStaffResponse['data'];
  similar: Recommendation[];
}

interface TitleIndexEntry {
  aid: number;
  titles: { norm: string; tokens: Set<string>; type: string }[];
}

const HOUR_MS = 60 * 60 * 1000;

const TYPE_MAP: Record<string, JikanAnime['type']> = {
  'TV Series': 'TV',
  OVA: 'OVA',
  Movie: 'Movie',
  Web: 'ONA',
  'TV Special': 'Special',
  'Music Video': 'Music',
  Other: 'Special',
};

/** AniDB resource type ids */
const RESOURCE_MAL = '2';
const RESOURCE_IMDB = '43';

const TITLE_TYPE_BONUS: Record<string, number> = { main: 5, official: 4, syn: 0, synonym: 0, short: -5 };

const EPISODE_LANG_ORDER: Record<TitleLanguage, string[]> = {
  english: ['en', 'x-jat', 'ja'],
  romaji: ['x-jat', 'en', 'ja'],
  japanese: ['ja', 'x-jat', 'en'],
  german: ['de', 'en', 'x-jat', 'ja'],
  french: ['fr', 'en', 'x-jat', 'ja'],
  spanish: ['es', 'en', 'x-jat', 'ja'],
};

// ---------- small XML helpers (no isArray config: normalise at read time) ----------

function arr<T = any>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: any): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return String(v['#text'] ?? '');
  return String(v);
}

function attr(v: any, name: string): string {
  return v && typeof v === 'object' ? String(v[`@_${name}`] ?? '') : '';
}

/** "http://anidb.net/ch28 [Lafiel]" → "Lafiel"; drop the "Source:" footnote markup */
function cleanDescription(s: string): string {
  return s
    .replace(/https?:\/\/anidb\.net\/\S+\s*\[([^\]]+)\]/g, '$1')
    .replace(/\r\n/g, '\n')
    .trim();
}

export function normaliseTitle(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function capitalise(s: string): string {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function seasonFromDate(date: string | null): JikanAnime['season'] {
  if (!date) return null;
  const m = parseInt(date.slice(5, 7), 10);
  if (m <= 3) return 'winter';
  if (m <= 6) return 'spring';
  if (m <= 9) return 'summer';
  return 'fall';
}

export class AniDbClient implements AnimeDataSource {
  readonly kind = 'anidb' as const;
  readonly idPrefix = 'anidb' as const;

  private http: AxiosInstance;
  private opts: Required<AniDbClientOptions>;
  private parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });
  private queue: IntervalQueue;
  private memory = new Map<number, { data: ParsedAnime; expiresAt: number }>();
  private inflight = new Map<number, Promise<ParsedAnime>>();
  private titleIndex: TitleIndexEntry[] | null = null;
  private titleIndexLoadedAt = 0;
  private titleIndexLoading: Promise<TitleIndexEntry[]> | null = null;
  private bannedUntil = 0;

  constructor(options: AniDbClientOptions) {
    if (!options.client) {
      throw new Error('ANIDB_CLIENT is required for METADATA_SOURCE=anidb (register at https://anidb.net/software/add)');
    }
    this.opts = {
      client: options.client,
      clientVersion: options.clientVersion || '1',
      apiURL: options.apiURL || 'http://api.anidb.net:9001/httpapi',
      titlesURL: options.titlesURL || 'https://anidb.net/api/anime-titles.xml.gz',
      imageBaseURL: (options.imageBaseURL || 'https://cdn-eu.anidb.net/images/main').replace(/\/$/, ''),
      cacheDir: path.resolve(options.cacheDir || './cache/anidb'),
      cacheHours: options.cacheHours ?? 24,
      titlesRefreshHours: options.titlesRefreshHours ?? 24,
      requestIntervalMs: Math.max(2000, options.requestIntervalMs ?? 2500),
      minTagWeight: options.minTagWeight ?? 300,
      titleLanguage: options.titleLanguage || 'english',
    };
    this.queue = new IntervalQueue(this.opts.requestIntervalMs);
    this.http = axios.create({
      timeout: 20000,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': `${this.opts.client}/${this.opts.clientVersion}` },
    });
    fs.mkdirSync(this.opts.cacheDir, { recursive: true });
  }

  // ---------------------------------------------------------------- caching

  private animeCachePath(aid: number): string {
    return path.join(this.opts.cacheDir, `anime-${aid}.xml`);
  }

  private readDiskCache(file: string, maxAgeMs: number | null): string | null {
    try {
      const st = fs.statSync(file);
      if (maxAgeMs !== null && Date.now() - st.mtimeMs > maxAgeMs) return null;
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }

  private static decode(buf: ArrayBuffer | Buffer): string {
    const b = Buffer.from(buf as ArrayBuffer);
    const raw = b.length > 2 && b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b) : b;
    return raw.toString('utf8');
  }

  private async fetchAnimeXml(aid: number): Promise<string> {
    const file = this.animeCachePath(aid);
    const fresh = this.readDiskCache(file, this.opts.cacheHours * HOUR_MS);
    if (fresh) return fresh;

    const stale = () => this.readDiskCache(file, null);

    if (Date.now() < this.bannedUntil) {
      const s = stale();
      if (s) return s;
      throw new Error('AniDB client is temporarily banned; not sending requests');
    }

    try {
      const xml = await this.queue.schedule(async () => {
        logger.info(`AniDB API Request: anime aid=${aid}`);
        const res = await this.http.get(this.opts.apiURL, {
          params: {
            request: 'anime',
            client: this.opts.client,
            clientver: this.opts.clientVersion,
            protover: 1,
            aid,
          },
        });
        return AniDbClient.decode(res.data);
      });

      const err = xml.match(/<error[^>]*>([^<]*)<\/error>/i);
      if (err) {
        if (/banned/i.test(err[1])) {
          this.bannedUntil = Date.now() + 30 * 60 * 1000;
          logger.error('AniDB reports this client/IP as BANNED — pausing AniDB requests for 30 min');
        } else {
          logger.error(`AniDB API error for aid ${aid}: ${err[1]}`);
        }
        throw new Error(`AniDB error: ${err[1]}`);
      }

      fs.writeFileSync(file, xml, 'utf8');
      return xml;
    } catch (e: any) {
      const s = stale();
      if (s) {
        logger.warn(`AniDB fetch failed for aid ${aid}, serving stale cache`);
        return s;
      }
      // Plain Error: keeps client name/params out of logs
      throw new Error(`AniDB request failed for aid ${aid}: ${e?.response?.status ?? e?.code ?? e?.message}`);
    }
  }

  private async getParsed(aid: number): Promise<ParsedAnime> {
    const hit = this.memory.get(aid);
    if (hit && Date.now() < hit.expiresAt) return hit.data;

    const pending = this.inflight.get(aid);
    if (pending) return pending;

    const p = this.fetchAnimeXml(aid)
      .then((xml) => {
        const data = this.parseAnime(aid, xml);
        this.memory.set(aid, { data, expiresAt: Date.now() + this.opts.cacheHours * HOUR_MS });
        return data;
      })
      .finally(() => this.inflight.delete(aid));
    this.inflight.set(aid, p);
    return p;
  }

  // ---------------------------------------------------------------- parsing

  private img(file: string | undefined | null): string {
    return file ? `${this.opts.imageBaseURL}/${file}` : '';
  }

  private pickEpisodeTitle(titles: any[]): { title: string; ja: string | null; romaji: string | null } {
    const byLang = new Map<string, string>();
    titles.forEach((t) => {
      const lang = attr(t, 'xml:lang');
      if (lang && !byLang.has(lang)) byLang.set(lang, text(t));
    });
    const order = EPISODE_LANG_ORDER[this.opts.titleLanguage] || EPISODE_LANG_ORDER.english;
    const title = order.map((l) => byLang.get(l)).find(Boolean) || byLang.values().next().value || '';
    return { title, ja: byLang.get('ja') || null, romaji: byLang.get('x-jat') || null };
  }

  private parseAnime(aid: number, xml: string): ParsedAnime {
    const doc = this.parser.parse(xml);
    const a = Array.isArray(doc.anime) ? doc.anime[0] : doc.anime;
    if (!a) throw new Error(`AniDB returned no anime for aid ${aid}`);

    // --- titles
    const rawTitles = arr(a.titles?.title);
    const titleOf = (type: string, lang?: string) =>
      rawTitles.find((t) => attr(t, 'type') === type && (!lang || attr(t, 'xml:lang') === lang));
    const main = text(titleOf('main')) || text(rawTitles[0]) || `AniDB-${aid}`;
    const official = (lang: string) => text(titleOf('official', lang)) || null;

    const titles: JikanTitle[] = [{ type: 'Default', title: main }];
    const langTypes: [string, string][] = [
      ['en', 'English'], ['ja', 'Japanese'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'],
    ];
    langTypes.forEach(([lang, type]) => {
      const t = official(lang);
      if (t) titles.push({ type, title: t });
    });
    const synonyms = rawTitles.filter((t) => attr(t, 'type') === 'synonym').map(text);
    synonyms.forEach((s) => titles.push({ type: 'Synonym', title: s }));

    // --- dates / status
    const from = normaliseDate(text(a.startdate));
    const to = normaliseDate(text(a.enddate));
    const today = new Date().toISOString().slice(0, 10);
    const status: JikanAnime['status'] =
      from && from > today ? 'Not yet aired' : to && to <= today ? 'Finished Airing' : from ? 'Currently Airing' : 'Not yet aired';

    // --- episodes
    const rawEpisodes = arr(a.episodes?.episode);
    const toEpisode = (e: any, num: number): JikanEpisode => {
      const t = this.pickEpisodeTitle(arr(e.title));
      const lengthMin = parseInt(text(e.length), 10);
      const epRating = parseFloat(text(e.rating));
      return {
        mal_id: num,
        url: `https://anidb.net/episode/${attr(e, 'id')}`,
        title: t.title,
        title_japanese: t.ja,
        title_romanji: t.romaji,
        duration: isNaN(lengthMin) ? null : lengthMin * 60,
        aired: normaliseDate(text(e.airdate)),
        filler: false,
        recap: false,
        synopsis: text(e.summary) ? cleanDescription(text(e.summary)) : null,
        forum_url: null,
        score: isNaN(epRating) ? null : Math.round((epRating / 2) * 100) / 100, // 0-10 → 0-5
      };
    };
    const episodes: JikanEpisode[] = [];
    const specials: JikanEpisode[] = [];
    rawEpisodes.forEach((e) => {
      const epType = attr(e.epno, 'type');
      const epno = text(e.epno);
      if (epType === '1') {
        const n = parseInt(epno, 10);
        if (!isNaN(n)) episodes.push(toEpisode(e, n));
      } else if (epType === '2') {
        const n = parseInt(epno.replace(/^\D+/, ''), 10);
        if (!isNaN(n)) specials.push(toEpisode(e, n));
      }
    });
    episodes.sort((x, y) => x.mal_id - y.mal_id);
    specials.sort((x, y) => x.mal_id - y.mal_id);

    const lengths = episodes.map((e) => e.duration).filter((d): d is number => !!d);
    const avgMin = lengths.length ? Math.round(lengths.reduce((s, d) => s + d, 0) / lengths.length / 60) : 0;

    // --- creators → studios + staff
    const creators = arr(a.creators?.name);
    const studios = creators
      .filter((c) => attr(c, 'type') === 'Animation Work')
      .map((c) => ({ mal_id: parseInt(attr(c, 'id'), 10) || 0, type: 'anime', name: text(c), url: `https://anidb.net/creator/${attr(c, 'id')}` }));
    const positionMap: Record<string, string> = {
      Direction: 'Director',
      'Chief Direction': 'Chief Director',
      'Series Composition': 'Series Composition (Script)',
      'Original Work': 'Original Work (Writer)',
    };
    const staffByPerson = new Map<string, JikanStaffResponse['data'][number]>();
    creators
      .filter((c) => attr(c, 'type') !== 'Animation Work' && attr(c, 'type') !== 'Work')
      .forEach((c) => {
        const id = attr(c, 'id') || text(c);
        const position = positionMap[attr(c, 'type')] || attr(c, 'type');
        if (!staffByPerson.has(id)) {
          staffByPerson.set(id, {
            person: {
              mal_id: parseInt(attr(c, 'id'), 10) || 0,
              url: `https://anidb.net/creator/${attr(c, 'id')}`,
              images: { jpg: { image_url: '' } },
              name: text(c),
            },
            positions: [],
          });
        }
        staffByPerson.get(id)!.positions.push(position);
      });

    // --- characters
    const characters: JikanCharacter[] = arr(a.characters?.character)
      .map((c): JikanCharacter | null => {
        const t = attr(c, 'type');
        const role = t === 'main character in' ? 'Main' : t === 'secondary cast in' ? 'Supporting' : null;
        if (!role) return null;
        return {
          character: {
            mal_id: parseInt(attr(c, 'id'), 10) || 0,
            url: `https://anidb.net/character/${attr(c, 'id')}`,
            images: { jpg: { image_url: this.img(text(c.picture)) } },
            name: text(c.name),
          },
          role,
          favorites: 0,
          voice_actors: arr(c.seiyuu).map((s) => ({
            person: {
              mal_id: parseInt(attr(s, 'id'), 10) || 0,
              url: `https://anidb.net/creator/${attr(s, 'id')}`,
              images: { jpg: { image_url: this.img(attr(s, 'picture')) } },
              name: text(s),
            },
            language: 'Japanese',
          })),
        };
      })
      .filter((c): c is JikanCharacter => c !== null)
      .sort((x, y) => (x.role === y.role ? 0 : x.role === 'Main' ? -1 : 1));

    // --- tags → genres
    const genres = arr(a.tags?.tag)
      .filter(
        (t) =>
          parseInt(attr(t, 'weight'), 10) >= this.opts.minTagWeight &&
          attr(t, 'localspoiler') !== 'true' &&
          attr(t, 'globalspoiler') !== 'true'
      )
      .sort((x, y) => parseInt(attr(y, 'weight'), 10) - parseInt(attr(x, 'weight'), 10))
      .slice(0, 15)
      .map((t) => ({ mal_id: parseInt(attr(t, 'id'), 10) || 0, type: 'anime', name: capitalise(text(t.name)), url: `https://anidb.net/tag/${attr(t, 'id')}` }));

    // --- relations
    const relMap = new Map<string, JikanRelation>();
    arr(a.relatedanime?.anime).forEach((r) => {
      const raw = attr(r, 'type');
      const name = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase(); // "Side Story" → "Side story"
      if (!relMap.has(name)) relMap.set(name, { relation: name, entry: [] });
      relMap.get(name)!.entry.push({
        mal_id: parseInt(attr(r, 'id'), 10),
        type: 'anime',
        name: text(r),
        url: `https://anidb.net/anime/${attr(r, 'id')}`,
      });
    });

    // --- external ids
    const external: { name: string; url: string }[] = [];
    arr(a.resources?.resource).forEach((res) => {
      const type = attr(res, 'type');
      arr(res.externalentity).forEach((ent) => {
        const id = text(arr(ent.identifier)[0]);
        if (!id) return;
        if (type === RESOURCE_MAL) external.push({ name: 'MyAnimeList', url: `https://myanimelist.net/anime/${id}` });
        if (type === RESOURCE_IMDB && /^tt\d+$/.test(id)) external.push({ name: 'IMDb', url: `https://www.imdb.com/title/${id}/` });
      });
    });

    const poster = this.img(text(a.picture));
    const restricted = attr(a, 'restricted') === 'true';
    const permanent = a.ratings?.permanent;
    const score = parseFloat(text(permanent));
    const description = text(a.description);

    const anime: JikanAnime = {
      mal_id: aid,
      url: `https://anidb.net/anime/${aid}`,
      images: { jpg: { image_url: poster, large_image_url: poster } },
      approved: true,
      titles,
      title: main,
      title_english: official('en'),
      title_japanese: official('ja'),
      title_synonyms: synonyms,
      type: TYPE_MAP[text(a.type)] || 'TV',
      source: '',
      episodes: parseInt(text(a.episodecount), 10) || episodes.length || null,
      status,
      airing: status === 'Currently Airing',
      aired: { from, to },
      duration: avgMin ? `${avgMin} min per ep` : '',
      rating: restricted ? 'Rx - Hentai' : '',
      score: isNaN(score) ? null : Math.round(score * 100) / 100,
      scored_by: parseInt(attr(permanent, 'count'), 10) || null,
      rank: null,
      popularity: null,
      members: null,
      favorites: null,
      synopsis: description ? cleanDescription(description) : null,
      background: null,
      season: seasonFromDate(from),
      year: from ? parseInt(from.slice(0, 4), 10) : null,
      producers: [],
      licensors: [],
      studios,
      genres,
      explicit_genres: [],
      themes: [],
      demographics: [],
      relations: Array.from(relMap.values()),
      external,
    };

    // similar anime, highest approval ratio first
    const similar: Recommendation[] = arr(a.similaranime?.anime)
      .map((s) => ({
        id: parseInt(attr(s, 'id'), 10),
        title: text(s),
        ratio: (parseInt(attr(s, 'approval'), 10) || 0) / (parseInt(attr(s, 'total'), 10) || 1),
      }))
      .filter((s) => !isNaN(s.id))
      .sort((x, y) => y.ratio - x.ratio)
      .map(({ id, title }) => ({ id, title }));

    return { anime, episodes, specials, characters, staff: Array.from(staffByPerson.values()), similar };
  }

  // ---------------------------------------------------------------- titles dump / search

  private async loadTitleIndex(): Promise<TitleIndexEntry[]> {
    const maxAge = this.opts.titlesRefreshHours * HOUR_MS;
    if (this.titleIndex && Date.now() - this.titleIndexLoadedAt < maxAge) return this.titleIndex;
    if (this.titleIndexLoading) return this.titleIndexLoading;

    this.titleIndexLoading = (async () => {
      const file = path.join(this.opts.cacheDir, 'anime-titles.xml.gz');
      let buf: Buffer | null = null;

      let isFresh = false;
      try {
        isFresh = Date.now() - fs.statSync(file).mtimeMs < maxAge;
      } catch {
        /* no file yet */
      }

      if (!isFresh) {
        try {
          logger.info(`Downloading AniDB titles dump: ${this.opts.titlesURL}`);
          const res = await this.http.get(this.opts.titlesURL);
          buf = Buffer.from(res.data);
          fs.writeFileSync(file, buf);
        } catch (e) {
          logger.warn(`AniDB titles dump download failed (${(e as Error).message}); using cached copy if present`);
        }
      }
      if (!buf) {
        try {
          buf = fs.readFileSync(file);
        } catch {
          throw new Error('AniDB titles dump unavailable (download failed and no cached copy)');
        }
      }

      const xml = AniDbClient.decode(buf);
      const doc = this.parser.parse(xml);
      const index: TitleIndexEntry[] = arr(doc.animetitles?.anime).map((an: any) => ({
        aid: parseInt(attr(an, 'aid'), 10),
        titles: arr(an.title).map((t: any) => {
          const norm = normaliseTitle(text(t));
          return { norm, tokens: new Set(norm.split(' ').filter(Boolean)), type: attr(t, 'type') };
        }),
      }));
      logger.info(`AniDB title index loaded: ${index.length} anime`);
      this.titleIndex = index;
      this.titleIndexLoadedAt = Date.now();
      return index;
    })().finally(() => {
      this.titleIndexLoading = null;
    });

    return this.titleIndexLoading;
  }

  /** Scores a normalised query against a normalised title (0..100) */
  static scoreTitle(q: string, qTokens: Set<string>, t: string, tTokens: Set<string>): number {
    if (!q || !t) return 0;
    if (q === t) return 100;
    const ratio = Math.min(q.length, t.length) / Math.max(q.length, t.length);
    if (t.startsWith(q) || q.startsWith(t)) return 60 + 30 * ratio;
    if (t.includes(q) || q.includes(t)) return 40 + 30 * ratio;
    let inter = 0;
    qTokens.forEach((tok) => tTokens.has(tok) && inter++);
    const union = qTokens.size + tTokens.size - inter;
    return union ? (inter / union) * 50 : 0;
  }

  async searchAnime(
    query: string,
    options?: JikanSearchOptions,
    hints?: SearchHints
  ): Promise<JikanSearchResponse> {
    const limit = Math.max(options?.limit ?? 10, 1);
    const index = await this.loadTitleIndex();
    const q = normaliseTitle(query);
    const qTokens = new Set(q.split(' ').filter(Boolean));

    const scored: { aid: number; score: number }[] = [];
    for (const entry of index) {
      let best = 0;
      for (const t of entry.titles) {
        const s = AniDbClient.scoreTitle(q, qTokens, t.norm, t.tokens);
        if (s > 0) best = Math.max(best, s + (TITLE_TYPE_BONUS[t.type] ?? 0));
      }
      if (best >= 35) scored.push({ aid: entry.aid, score: best });
    }
    scored.sort((a, b) => b.score - a.score || a.aid - b.aid);

    // Year hint: among near-top candidates, prefer the one that first aired that year.
    // Costs up to 3 (cached) AniDB requests, only when titles are ambiguous —
    // the titles dump has no dates, so a full filter would mean fetching everything.
    if (hints?.year && scored.length > 1) {
      const top = scored[0].score;
      const close = scored.filter((s) => top - s.score <= 15).slice(0, 3);
      if (close.length > 1) {
        const fits = await Promise.all(
          close.map((c) =>
            this.getParsed(c.aid)
              .then((p) => yearMatches(hints.year!, p.anime.aired.from))
              .catch(() => false)
          )
        );
        const yearMatch = fits.findIndex(Boolean);
        if (yearMatch > 0) {
          const [m] = scored.splice(scored.indexOf(close[yearMatch]), 1);
          scored.unshift(m);
        }
      }
    }

    const picked = scored.slice(0, limit);
    logger.info(`AniDB local search "${query}" → ${picked.map((p) => `${p.aid}(${p.score.toFixed(0)})`).join(', ') || 'no match'}`);

    return {
      pagination: {
        last_visible_page: 1,
        has_next_page: false,
        items: { count: picked.length, total: scored.length, per_page: limit },
      },
      // Only mal_id (= aid here) is consumed by MatchService
      data: picked.map((p) => ({ mal_id: p.aid } as any)),
    };
  }

  // ---------------------------------------------------------------- AnimeDataSource

  async getAnimeById(id: number): Promise<JikanAnime> {
    return (await this.getParsed(id)).anime;
  }

  async getAnimeEpisodes(id: number, page: number = 1): Promise<JikanEpisodesResponse> {
    return page === 1 ? this.getAllAnimeEpisodes(id) : toEpisodesResponse([]);
  }

  async getAllAnimeEpisodes(id: number): Promise<JikanEpisodesResponse> {
    return toEpisodesResponse((await this.getParsed(id)).episodes);
  }

  async getAnimeCharacters(id: number): Promise<JikanCharactersResponse> {
    return { data: (await this.getParsed(id)).characters };
  }

  async getAnimeStaff(id: number): Promise<JikanStaffResponse> {
    return { data: (await this.getParsed(id)).staff };
  }

  async getAnimePictures(_id: number): Promise<JikanPicturesResponse> {
    // AniDB has a single main picture, already used as poster/background
    return { data: [] };
  }

  async getRecommendations(id: number): Promise<Recommendation[]> {
    return (await this.getParsed(id)).similar;
  }

  async getSpecials(id: number): Promise<SpecialEntry[]> {
    const p = await this.getParsed(id);
    // Season 0 episode number = AniDB special number (S3 → S00E03), matching AniDB-named files
    return p.specials.map((episode) => ({ anime: p.anime, episode, globalIndex: episode.mal_id }));
  }

  clearCache(): void {
    this.memory.clear();
  }
}
