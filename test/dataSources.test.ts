/**
 * Offline tests for the switchable metadata backends (MAL v2 + AniDB normalisation)
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { AniDbClient, normaliseTitle } from '../src/clients/AniDbClient';
import { MalApiClient } from '../src/clients/MalApiClient';
import { JikanMapper } from '../src/mappers/JikanMapper';
import { MetadataService } from '../src/services/MetadataService';
import { normaliseDate } from '../src/clients/AnimeDataSource';
import { ANIME_PROVIDER_IDENTIFIER } from '../src/constants';

const ANIDB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<anime id="1" restricted="false">
  <type>TV Series</type>
  <episodecount>13</episodecount>
  <startdate>1999-01-03</startdate>
  <enddate>1999-03-28</enddate>
  <titles>
    <title xml:lang="x-jat" type="main">Seikai no Monshou</title>
    <title xml:lang="en" type="official">Crest of the Stars</title>
    <title xml:lang="ja" type="official">星界の紋章</title>
    <title xml:lang="de" type="official">Crest of the Stars DE</title>
    <title xml:lang="en" type="synonym">CotS</title>
  </titles>
  <relatedanime>
    <anime id="4" type="Sequel">Seikai no Senki</anime>
    <anime id="6" type="Side Story">Seikai no Danshou</anime>
  </relatedanime>
  <creators>
    <name id="4303" type="Music">Hattori Katsuhisa</name>
    <name id="4234" type="Direction">Nagaoka Yasuchika</name>
    <name id="4234" type="Series Composition">Nagaoka Yasuchika</name>
    <name id="17" type="Animation Work">Sunrise</name>
  </creators>
  <description>Lafiel is a princess of the http://anidb.net/ch28 [Abh] empire.</description>
  <ratings><permanent count="4303">8.17</permanent></ratings>
  <picture>440.jpg</picture>
  <resources>
    <resource type="2"><externalentity><identifier>290</identifier></externalentity></resource>
    <resource type="43"><externalentity><identifier>tt0291421</identifier></externalentity></resource>
  </resources>
  <tags>
    <tag id="36" weight="600" localspoiler="false" globalspoiler="false"><name>space opera</name></tag>
    <tag id="37" weight="0" localspoiler="false" globalspoiler="false"><name>maintenance tag</name></tag>
    <tag id="38" weight="500" localspoiler="true" globalspoiler="false"><name>spoiler tag</name></tag>
  </tags>
  <characters>
    <character id="28" type="main character in"><name>Lafiel</name><picture>14304.jpg</picture><seiyuu id="12" picture="184301.jpg">Kawasumi Ayako</seiyuu></character>
    <character id="29" type="appears in"><name>Extra</name></character>
  </characters>
  <similaranime>
    <anime id="50" approval="10" total="40">Low Ratio</anime>
    <anime id="51" approval="30" total="40">High Ratio</anime>
  </similaranime>
  <episodes>
    <episode id="2"><epno type="1">2</epno><length>25</length><airdate>1999-01-10</airdate><rating votes="20">7.50</rating>
      <title xml:lang="en">Ambush</title><title xml:lang="x-jat">Machibuse</title></episode>
    <episode id="1"><epno type="1">1</epno><length>25</length><airdate>1999-01-03</airdate>
      <title xml:lang="en">Invasion</title><title xml:lang="ja">侵略</title><title xml:lang="x-jat">Shinryaku</title>
      <summary>See http://anidb.net/ch28 [Lafiel].</summary></episode>
    <episode id="99"><epno type="2">S1</epno><length>5</length><title xml:lang="en">Special One</title></episode>
    <episode id="98"><epno type="3">C1</epno><title xml:lang="en">Opening</title></episode>
  </episodes>
</anime>`;

describe('normaliseDate', () => {
  it('pads partial dates', () => {
    expect(normaliseDate('2006')).toBe('2006-01-01');
    expect(normaliseDate('2006-10')).toBe('2006-10-01');
    expect(normaliseDate('2006-10-04')).toBe('2006-10-04');
    expect(normaliseDate(null)).toBeNull();
  });
});

describe('AniDbClient', () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anidb-test-'));
  const client = new AniDbClient({ client: 'testclient', clientVersion: '1', cacheDir });
  const parsed = (client as any).parseAnime(1, ANIDB_XML);

  it('requires a client name', () => {
    expect(() => new AniDbClient({ client: '', clientVersion: '1', cacheDir })).toThrow(/ANIDB_CLIENT/);
  });

  it('maps titles into Jikan title types', () => {
    const a = parsed.anime;
    expect(a.mal_id).toBe(1);
    expect(a.title).toBe('Seikai no Monshou');
    expect(a.title_english).toBe('Crest of the Stars');
    expect(a.title_japanese).toBe('星界の紋章');
    expect(a.titles).toEqual(expect.arrayContaining([{ type: 'German', title: 'Crest of the Stars DE' }]));
  });

  it('maps core fields', () => {
    const a = parsed.anime;
    expect(a.type).toBe('TV');
    expect(a.year).toBe(1999);
    expect(a.season).toBe('winter');
    expect(a.status).toBe('Finished Airing');
    expect(a.score).toBe(8.17);
    expect(a.duration).toBe('25 min per ep');
    expect(a.images.jpg.large_image_url).toBe('https://cdn-eu.anidb.net/images/main/440.jpg');
    expect(a.synopsis).toBe('Lafiel is a princess of the Abh empire.');
    expect(a.studios.map((s: any) => s.name)).toEqual(['Sunrise']);
  });

  it('keeps only heavy, non-spoiler tags as genres', () => {
    expect(parsed.anime.genres.map((g: any) => g.name)).toEqual(['Space Opera']);
  });

  it('maps relations with Jikan casing', () => {
    const rel = parsed.anime.relations.map((r: any) => r.relation);
    expect(rel).toEqual(['Sequel', 'Side story']);
  });

  it('exposes MAL and IMDb ids as external links', () => {
    const names = parsed.anime.external.map((e: any) => e.url);
    expect(names).toEqual(['https://myanimelist.net/anime/290', 'https://www.imdb.com/title/tt0291421/']);
  });

  it('splits regular episodes and specials, sorted, ignoring credits', () => {
    expect(parsed.episodes.map((e: any) => e.mal_id)).toEqual([1, 2]);
    expect(parsed.episodes[0].title).toBe('Invasion');
    expect(parsed.episodes[0].duration).toBe(1500);
    expect(parsed.episodes[0].synopsis).toBe('See Lafiel.');
    expect(parsed.specials.map((e: any) => e.mal_id)).toEqual([1]);
    expect(parsed.specials[0].title).toBe('Special One');
  });

  it('maps main/secondary characters with seiyuu', () => {
    expect(parsed.characters).toHaveLength(1);
    expect(parsed.characters[0].role).toBe('Main');
    expect(parsed.characters[0].voice_actors[0].person.name).toBe('Kawasumi Ayako');
  });

  it('maps staff positions so the mapper finds directors/writers', () => {
    const nagaoka = parsed.staff.find((s: any) => s.person.name === 'Nagaoka Yasuchika');
    expect(nagaoka.positions).toEqual(['Director', 'Series Composition (Script)']);
    const crew = (new JikanMapper() as any).mapStaff(parsed.staff);
    expect(crew.Director[0].tag).toBe('Nagaoka Yasuchika');
    expect(crew.Writer[0].tag).toBe('Nagaoka Yasuchika');
  });

  it('builds anidb-prefixed ratingKeys and guids', () => {
    const mapper = new JikanMapper({ idPrefix: 'anidb', titleLanguage: 'english' });
    const show = mapper.mapAnimeToShow(parsed.anime);
    expect(show.ratingKey).toBe('anidb-show-1');
    expect(show.title).toBe('Crest of the Stars');
    const ids = show.Guid!.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(['anidb://1', 'mal://290', 'imdb://tt0291421']));
  });

  it('serves everything from the disk cache without network', async () => {
    fs.writeFileSync(path.join(cacheDir, 'anime-1.xml'), ANIDB_XML);
    const eps = await client.getAllAnimeEpisodes(1);
    expect(eps.data).toHaveLength(2);
    const specials = await client.getSpecials(1);
    expect(specials[0].globalIndex).toBe(1);
  });

  it('scores titles sensibly', () => {
    const s = (q: string, t: string) => {
      const nq = normaliseTitle(q);
      const nt = normaliseTitle(t);
      return AniDbClient.scoreTitle(nq, new Set(nq.split(' ')), nt, new Set(nt.split(' ')));
    };
    expect(s('Cowboy Bebop', 'Cowboy Bebop')).toBe(100);
    expect(s('Cowboy Bebop', 'Cowboy Bebop: Tengoku no Tobira')).toBeGreaterThan(s('Cowboy Bebop', 'Bebop Cowboy Fan'));
    expect(normaliseTitle('Pokémon: Sun & Moon')).toBe('pokemon sun and moon');
  });

  it('searches the local title dump', async () => {
    const dump = `<?xml version="1.0"?><animetitles>
      <anime aid="23"><title type="main" xml:lang="x-jat">Cowboy Bebop</title></anime>
      <anime aid="5"><title type="main" xml:lang="x-jat">Cowboy Bebop: Tengoku no Tobira</title>
        <title type="official" xml:lang="en">Cowboy Bebop: The Movie</title></anime>
      <anime aid="9"><title type="main" xml:lang="x-jat">Something Else</title></anime>
    </animetitles>`;
    const zlib = require('zlib');
    fs.writeFileSync(path.join(cacheDir, 'anime-titles.xml.gz'), zlib.gzipSync(dump));
    const res = await client.searchAnime('Cowboy Bebop', { limit: 5 });
    expect(res.data.map((d) => d.mal_id)).toEqual([23, 5]);
  });
});

describe('MalApiClient', () => {
  const client = new MalApiClient({ clientId: 'x' });

  it('requires a client id', () => {
    expect(() => new MalApiClient({ clientId: '' })).toThrow(/MAL_CLIENT_ID/);
  });

  it('normalises MAL v2 anime to the Jikan shape', () => {
    const a = (client as any).toJikan({
      id: 1535,
      title: 'Death Note',
      main_picture: { medium: 'm.jpg', large: 'l.jpg' },
      alternative_titles: { en: 'Death Note', ja: 'デスノート', synonyms: ['DN'] },
      start_date: '2006-10-04',
      end_date: '2007-06-27',
      mean: 8.62,
      num_scoring_users: 100,
      media_type: 'tv',
      status: 'finished_airing',
      num_episodes: 37,
      start_season: { year: 2006, season: 'fall' },
      average_episode_duration: 1380,
      rating: 'r',
      genres: [{ id: 37, name: 'Supernatural' }],
      studios: [{ id: 11, name: 'Madhouse' }],
      related_anime: [
        { node: { id: 2994, title: 'Death Note: Rewrite' }, relation_type: 'summary', relation_type_formatted: 'Summary' },
      ],
    });
    expect(a.mal_id).toBe(1535);
    expect(a.type).toBe('TV');
    expect(a.rating).toBe('R - 17+ (violence & profanity)');
    expect(a.duration).toBe('23 min per ep');
    expect(a.aired.from).toBe('2006-10-04');
    expect(a.images.jpg.large_image_url).toBe('l.jpg');
    expect(a.relations).toEqual([
      { relation: 'Summary', entry: [expect.objectContaining({ mal_id: 2994, type: 'anime' })] },
    ]);
    expect(a.titles).toEqual(expect.arrayContaining([{ type: 'English', title: 'Death Note' }]));
    expect(a.status).toBe('Finished Airing');
  });

  it('is pure MAL: synthesised episodes, no cast/crew', async () => {
    (client as any).getRaw = async () => ({ id: 1, title: 'X', num_episodes: 3, average_episode_duration: 1440 });
    const eps = await client.getAllAnimeEpisodes(1);
    expect(eps.data.map((e) => e.title)).toEqual(['Episode 1', 'Episode 2', 'Episode 3']);
    expect((await client.getAnimeCharacters(1)).data).toEqual([]);
  });

  it('returns no results for queries under 3 characters', async () => {
    const res = await client.searchAnime('K');
    expect(res.data).toEqual([]);
  });
});

describe('MetadataService ratingKey prefixes', () => {
  it('rejects keys from another source with a clear message', async () => {
    const fake: any = { kind: 'anidb', idPrefix: 'anidb', getAnimeById: jest.fn() };
    const svc = new MetadataService(fake);
    await expect(svc.getMetadata('mal-show-1')).rejects.toThrow(/Unmatch/);
  });

  it('parses anidb keys', () => {
    const fake: any = { kind: 'anidb', idPrefix: 'anidb' };
    const svc = new MetadataService(fake) as any;
    expect(svc.parseRatingKey('anidb-episode-23-0-2')).toEqual({
      type: 'episode', malId: 23, seasonNumber: 0, episodeNumber: 2,
    });
    expect(svc.parseRatingKey('anidb-season-23-1')).toEqual({ type: 'season', malId: 23, seasonNumber: 1 });
  });

  it('still defaults to Jikan/mal keys', () => {
    const svc = new MetadataService() as any;
    expect(svc.parseRatingKey('mal-show-5114')).toEqual({ type: 'show', malId: 5114 });
  });
});

describe('richer Plex metadata', () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anidb-test2-'));
  const client = new AniDbClient({ client: 'testclient', clientVersion: '1', cacheDir });
  fs.writeFileSync(path.join(cacheDir, 'anime-1.xml'), ANIDB_XML);

  it('always includes cast, crew and similar on plain show metadata requests', async () => {
    const svc = new MetadataService(client, { titleLanguage: 'english' });
    const res = await svc.getMetadata('anidb-show-1');
    const show: any = res.MediaContainer.Metadata[0];
    expect(show.Role[0]).toMatchObject({ tag: 'Kawasumi Ayako', role: 'Lafiel' });
    expect(show.Director[0].tag).toBe('Nagaoka Yasuchika');
    expect(show.Writer[0].tag).toBe('Nagaoka Yasuchika');
    expect(show.Similar.map((s: any) => s.tag)).toEqual(['High Ratio', 'Low Ratio']);
    expect(show.Similar[0].guid).toBe(`${ANIME_PROVIDER_IDENTIFIER}://show/anidb-show-51`);
  });

  it('gives seasons and episodes the series cast and crew', async () => {
    const svc = new MetadataService(client);
    const season: any = (await svc.getMetadata('anidb-season-1-1', { includeChildren: true })).MediaContainer.Metadata[0];
    expect(season.Role[0]).toMatchObject({ tag: 'Kawasumi Ayako', role: 'Lafiel' });
    expect(season.Director[0].tag).toBe('Nagaoka Yasuchika');
    expect(season.Writer[0].tag).toBe('Nagaoka Yasuchika');
    expect(season.Children.Metadata[0].Director[0].tag).toBe('Nagaoka Yasuchika');
    expect(season.Children.Metadata[0].Role[0].tag).toBe('Kawasumi Ayako');

    const episode: any = (await svc.getMetadata('anidb-episode-1-1-2')).MediaContainer.Metadata[0];
    expect(episode.Role[0]).toMatchObject({ tag: 'Kawasumi Ayako', role: 'Lafiel' });
    expect(episode.Director[0].tag).toBe('Nagaoka Yasuchika');
    expect(episode.Writer[0].tag).toBe('Nagaoka Yasuchika');

    const show: any = (await svc.getMetadata('anidb-show-1', { includeChildren: true })).MediaContainer.Metadata[0];
    expect(show.Children.Metadata[0].Director[0].tag).toBe('Nagaoka Yasuchika');
  });

  it('maps episode ratings to Plex 0-10 scale', async () => {
    const svc = new MetadataService(client);
    const res = await svc.getMetadata('anidb-episode-1-1-2');
    expect((res.MediaContainer.Metadata[0] as any).Rating[0].value).toBe(7.5);
  });

  it('keeps only real directors, prefers Japanese VA', () => {
    const m = new JikanMapper() as any;
    const crew = m.mapStaff([
      { person: { name: 'A', images: { jpg: { image_url: '' } } }, positions: ['Director', 'Episode Director'] },
      { person: { name: 'B', images: { jpg: { image_url: '' } } }, positions: ['Sound Director'] },
      { person: { name: 'C', images: { jpg: { image_url: '' } } }, positions: ['Original Creator'] },
    ]);
    expect(crew.Director.map((p: any) => p.tag)).toEqual(['A']);
    expect(crew.Writer.map((p: any) => p.tag)).toEqual(['C']);
    const roles = m.mapCharacters([
      { character: { name: 'L', images: { jpg: { image_url: 'c.jpg' } } }, role: 'Main',
        voice_actors: [{ language: 'English', person: { name: 'EN' } }, { language: 'Japanese', person: { name: 'JP', images: { jpg: { image_url: 'jp.jpg' } } } }] },
    ]);
    expect(roles[0]).toMatchObject({ tag: 'JP', role: 'L', thumb: 'jp.jpg' });
  });

  it('drops adult entries unless Plex asks for them', async () => {
    const adult = ANIDB_XML.replace('restricted="false"', 'restricted="true"');
    fs.writeFileSync(path.join(cacheDir, 'anime-1.xml'), adult);
    (client as any).memory.clear();
    (client as any).searchAnime = async () => ({ data: [{ mal_id: 1 }] });
    const { MatchService } = require('../src/services/MatchService');
    const svc = new MatchService(client);
    expect((await svc.match({ type: 2, title: 'x' })).MediaContainer.size).toBe(0);
    expect((await svc.match({ type: 2, title: 'x', includeAdult: 1 })).MediaContainer.size).toBe(1);
  });
});

describe('MatchService uses scoring in the match flow', () => {
  const mk = (id: number, title: string, year: number, score: number, extra: any = {}) => ({
    mal_id: id, title, title_english: null, title_japanese: null, title_synonyms: [], titles: [],
    year, score, aired: { from: `${year}-01-01`, to: null }, ...extra,
  });
  const detail = (id: number, title: string) => ({
    mal_id: id, title, titles: [{ type: 'Default', title }], images: { jpg: { image_url: '' } },
    aired: { from: null, to: null }, genres: [], rating: '', relations: [], external: [],
  });

  function fakeSource(results: any[]) {
    return {
      kind: 'jikan', idPrefix: 'mal',
      searchAnime: jest.fn(async () => ({ data: results })),
      getAnimeById: jest.fn(async (id: number) => detail(id, results.find((r) => r.mal_id === id).title)),
      getAnimeCharacters: async () => ({ data: [] }),
      getAnimeStaff: async () => ({ data: [] }),
      getAnimePictures: async () => ({ data: [] }),
      clearCache: () => undefined,
    } as any;
  }

  it('picks the exact title over the API\'s first (more popular) hit', async () => {
    const { MatchService } = require('../src/services/MatchService');
    const src = fakeSource([mk(20, 'Naruto Shippuden', 2007, 8.3), mk(1, 'Naruto', 2002, 8.0)]);
    const res = await new MatchService(src).match({ type: 2, title: 'Naruto' });
    expect(res.MediaContainer.Metadata[0].ratingKey).toBe('mal-show-1');
    expect(src.searchAnime.mock.calls[0][1].limit).toBe(20);
  });

  it('uses the year to pick between remakes', async () => {
    const { MatchService } = require('../src/services/MatchService');
    const src = fakeSource([mk(120, 'Fruits Basket', 2001, 7.7), mk(38680, 'Fruits Basket', 2019, 8.2)]);
    const r2001 = await new MatchService(src).match({ type: 2, title: 'Fruits Basket', year: 2001 });
    expect(r2001.MediaContainer.Metadata[0].ratingKey).toBe('mal-show-120');
  });

  it('returns the top 5 ranked for a manual Fix Match', async () => {
    const { MatchService } = require('../src/services/MatchService');
    const src = fakeSource([1, 2, 3, 4, 5, 6, 7].map((i) => mk(i, `Show ${i}`, 2000, i)));
    const res = await new MatchService(src).match({ type: 2, title: 'Show 3', manual: 1 });
    expect(res.MediaContainer.size).toBe(5);
    expect(res.MediaContainer.Metadata[0].ratingKey).toBe('mal-show-3');
  });
});

describe('MATCH_SCORING=false (example-provider matching)', () => {
  const mk = (id: number, title: string) => ({
    mal_id: id, title, title_english: null, title_japanese: null, title_synonyms: [], titles: [],
    year: 2000, score: 8, aired: { from: null, to: null },
  });
  const src = (results: any[]) => ({
    kind: 'jikan', idPrefix: 'mal',
    searchAnime: jest.fn(async (_q: string, o: any) => ({ data: results.slice(0, o.limit) })),
    getAnimeById: async (id: number) => ({
      mal_id: id, title: `t${id}`, titles: [], images: { jpg: { image_url: '' } },
      aired: { from: null, to: null }, genres: [], rating: '', relations: [], external: [],
    }),
    getAnimeCharacters: async () => ({ data: [] }),
    getAnimeStaff: async () => ({ data: [] }),
    getAnimePictures: async () => ({ data: [] }),
    clearCache: () => undefined,
  }) as any;

  it('takes the API top result in API order, asking for 1 (auto) / 5 (manual)', async () => {
    const { MatchService } = require('../src/services/MatchService');
    const s = src([mk(20, 'Naruto Shippuden'), mk(1, 'Naruto')]);
    const svc = new MatchService(s, {}, { scoring: false });

    const auto = await svc.match({ type: 2, title: 'Naruto' });
    expect(auto.MediaContainer.Metadata[0].ratingKey).toBe('mal-show-20'); // no re-ranking
    expect(auto.MediaContainer.size).toBe(1);
    expect(s.searchAnime.mock.calls[0][1].limit).toBe(20); // one page of 20, like TMDB

    const manual = await svc.match({ type: 2, title: 'Naruto', manual: 1 });
    expect(manual.MediaContainer.size).toBe(2); // up to 5
  });

  it('filters by first-air year like TMDB first_air_date_year (both modes)', async () => {
    const { MatchService } = require('../src/services/MatchService');
    const results = [
      { ...mk(38680, 'Fruits Basket'), year: 2019 },
      { ...mk(120, 'Fruits Basket'), year: 2001 },
    ];
    for (const scoring of [false, true]) {
      const svc = new MatchService(src(results), {}, { scoring });
      const r = await svc.match({ type: 2, title: 'Fruits Basket', year: 2001 });
      expect(r.MediaContainer.Metadata.map((m: any) => m.ratingKey)).toEqual(['mal-show-120']);
      const none = await svc.match({ type: 2, title: 'Fruits Basket', year: 1990 });
      expect(none.MediaContainer.size).toBe(0); // like TMDB: no show from that year → no match
    }
  });

  it('defaults to scoring on', () => {
    const { MatchService } = require('../src/services/MatchService');
    expect((new MatchService() as any).scoring).toBe(true);
  });
});

describe('yearMatches', () => {
  const { yearMatches } = require('../src/clients/AnimeDataSource');
  it('first-air year must equal the year', () => {
    expect(yearMatches(2019, '2019-04-06')).toBe(true);
    expect(yearMatches(2020, '2019-04-06')).toBe(false);
    expect(yearMatches(2000, null)).toBe(false);
  });
});

describe('episode / season lookups use the show-folder year', () => {
  const results = [
    { mal_id: 38680, title: 'Fruits Basket', titles: [], title_synonyms: [], score: 8.2, aired: { from: '2019-04-06', to: '2019-09-21' } },
    { mal_id: 120, title: 'Fruits Basket', titles: [], title_synonyms: [], score: 7.7, aired: { from: '2001-07-05', to: '2001-12-27' } },
  ];
  const source: any = {
    kind: 'jikan', idPrefix: 'mal',
    searchAnime: async () => ({ data: results }),
    getAnimeById: async (id: number) => ({ mal_id: id, title: 'Fruits Basket', titles: [], images: { jpg: { image_url: '' } }, aired: { from: null, to: null }, genres: [], rating: '', relations: [], external: [] }),
    getAllAnimeEpisodes: async () => ({ data: [{ mal_id: 3, title: 'Ep 3', aired: null }] }),
    getAnimeCharacters: async () => ({ data: [] }), getAnimeStaff: async () => ({ data: [] }), getAnimePictures: async () => ({ data: [] }),
    clearCache: () => undefined,
  };
  it('Fruits Basket (2001) folder → 2001 entry, (2019) folder → 2019 entry', async () => {
    const { MatchService } = require('../src/services/MatchService');
    for (const scoring of [true, false]) {
      const svc = new MatchService(source, {}, { scoring });
      const a = await svc.match({ type: 4, grandparentTitle: 'Fruits Basket', index: 3, parentIndex: 1, year: 2001 });
      expect(a.MediaContainer.Metadata[0].ratingKey).toBe('mal-episode-120-1-3');
      const b = await svc.match({ type: 4, grandparentTitle: 'Fruits Basket', index: 3, parentIndex: 1, year: 2019 });
      expect(b.MediaContainer.Metadata[0].ratingKey).toBe('mal-episode-38680-1-3');
      const c = await svc.match({ type: 3, parentTitle: 'Fruits Basket', index: 1, year: 2019 });
      expect(c.MediaContainer.Metadata[0].ratingKey).toBe('mal-season-38680-1');
    }
  });
});

describe('Jikan server-side start_date', () => {
  const { JikanClient } = require('../src/clients/JikanClient');
  const calls: any[] = [];
  const c = new JikanClient();
  (c as any).client.get = async (_u: string, cfg: any) => { calls.push(cfg.params); return { data: { data: [], pagination: {} } }; };

  it('sends start_date=YYYY-01-01 whenever a year is given', async () => {
    await c.searchAnime('Fruits Basket', { limit: 20 }, { year: 2001 });
    await c.searchAnime('Naruto', { limit: 20 });
    expect(calls[0]).toMatchObject({ q: 'Fruits Basket', limit: 20, start_date: '2001-01-01' });
    expect(calls[1].start_date).toBeUndefined();
  });
});

describe('Fribb franchise collections', () => {
  const { FranchiseList } = require('../src/services/FranchiseCollections');

  // Attack on Titan franchise incl. spin-off (31374 Junior High) + a 2-part show missing from the list
  const fribb = [
    { name: 'Shingeki no Kyojin', ids: [16498, 25777, 31374] },
    { name: 'Seikai no Monshou', ids: [290, 396] },
  ];
  const db: Record<number, any> = {
    16498: { t: 'Shingeki no Kyojin', en: 'Attack on Titan', rel: [{ relation: 'Sequel', entry: [{ mal_id: 25777, type: 'anime', name: '', url: '' }] }] },
    25777: { t: 'Shingeki no Kyojin Season 2', en: 'Attack on Titan Season 2', rel: [{ relation: 'Prequel', entry: [{ mal_id: 16498, type: 'anime', name: '', url: '' }] }] },
    31374: { t: 'Shingeki! Kyojin Chuugakkou', en: 'Attack on Titan: Junior High', rel: [{ relation: 'Spin-off', entry: [{ mal_id: 16498, type: 'anime', name: '', url: '' }] }] },
    500: { t: 'Unlisted', en: 'Unlisted', rel: [{ relation: 'Sequel', entry: [{ mal_id: 501, type: 'anime', name: '', url: '' }] }] },
    501: { t: 'Unlisted 2', en: 'Unlisted 2', rel: [{ relation: 'Prequel', entry: [{ mal_id: 500, type: 'anime', name: '', url: '' }] }] },
    900: { t: 'Alone', en: 'Alone', rel: [] },
  };
  const source: any = {
    kind: 'jikan', idPrefix: 'mal',
    getAnimeById: async (id: number) => ({
      mal_id: id, title: db[id].t, title_english: db[id].en,
      titles: [{ type: 'Default', title: db[id].t }, { type: 'English', title: db[id].en }],
      images: { jpg: { image_url: '', large_image_url: `p${id}.jpg` } }, aired: { from: null, to: null },
      genres: [], rating: '', relations: db[id].rel, external: [],
    }),
    getAnimeCharacters: async () => ({ data: [] }), getAnimeStaff: async () => ({ data: [] }),
    getAnimePictures: async () => ({ data: [] }), clearCache: () => undefined,
  };

  function listWithCache(content: any) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fribb-'));
    if (content !== undefined) fs.writeFileSync(path.join(dir, 'mal_collection.json'), JSON.stringify(content));
    // unreachable URL: forces cache use (fresh) or the failure path
    return new FranchiseList({ idType: 'mal', cacheDir: dir, baseURL: 'http://127.0.0.1:9/none' });
  }
  const col = async (svc: any, id: number) =>
    ((await svc.getMetadata(`mal-show-${id}`)).MediaContainer.Metadata[0] as any).Collection;

  it('groups seasons AND spin-offs into one collection with Fribb\'s group name', async () => {
    const svc = new MetadataService(source, { titleLanguage: 'english' }, { franchiseList: listWithCache(fribb) });
    const cols = [await col(svc, 16498), await col(svc, 25777), await col(svc, 31374)];
    expect(new Set(cols.map((c) => c[0].guid))).toEqual(new Set(['mal-collection://16498']));
    expect(new Set(cols.map((c) => c[0].tag))).toEqual(new Set(['Shingeki no Kyojin'])); // Fribb's group name
  });

  it('entries missing from the list get no collection (no relation fallback)', async () => {
    const svc = new MetadataService(source, {}, { franchiseList: listWithCache(fribb) });
    expect(await col(svc, 501)).toBeUndefined();
    expect(await col(svc, 900)).toBeUndefined();
  });

  it('Pokémon case: group without the hub entry keeps Fribb\'s name and lowest ID', async () => {
    const svc = new MetadataService(source, {}, { franchiseList: listWithCache([{ name: 'Pokemon Movie 06: Nanayo no Negaiboshi Jirachi', ids: [16498, 25777] }]) });
    const c = (await col(svc, 25777))[0];
    expect(c.guid).toBe('mal-collection://16498');
    expect(c.tag).toBe('Pokemon Movie 06: Nanayo no Negaiboshi Jirachi');
  });

  it('without a list there are no collections', async () => {
    const svc = new MetadataService(source, {});
    expect(await col(svc, 25777)).toBeUndefined();
  });

  it('COLLECTIONS=false → no collections', async () => {
    const svc = new MetadataService(source, {}, { enabled: false, franchiseList: listWithCache(fribb) });
    expect(await col(svc, 25777)).toBeUndefined();
  });

  it('list unavailable (download fails, no cache) → no collections, no errors', async () => {
    const svc = new MetadataService(source, {}, { franchiseList: listWithCache(undefined) });
    expect(await col(svc, 25777)).toBeUndefined();
  }, 40000);
});

describe('folder-tagged IDs', () => {
  const { extractTaggedIds, IdMapping } = require('../src/services/IdMapping');

  it('parses Plex {..} and Hama [..] style tags', () => {
    expect(extractTaggedIds('Code Geass Fukkatsu no Lelouch (2019) {anidb-12566}\\Season 01\\x.mp4'))
      .toEqual([{ provider: 'anidb', id: 12566 }]);
    expect(extractTaggedIds('Show [anidb2-77]', 'X {mal-34437}', 'Y [myanimelist=5]', 'Z {anilist-97880}'))
      .toEqual([
        { provider: 'anidb', id: 77 }, { provider: 'mal', id: 34437 },
        { provider: 'mal', id: 5 }, { provider: 'anilist', id: 97880 },
      ]);
    expect(extractTaggedIds('No tags (2019)', undefined)).toEqual([]);
  });

  function mappingWith(entries: any[]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idmap-'));
    fs.writeFileSync(path.join(dir, 'anime-list-full.json'), JSON.stringify(entries));
    return new IdMapping({ cacheDir: dir, url: 'http://127.0.0.1:9/none' });
  }
  const mapping = () => mappingWith([
    { anidb_id: 12566, mal_id: 34437, anilist_id: 97880 },
    { anidb_id: 15910, mal_id: 56835, anilist_id: 126830 },
  ]);

  function fakeSource(prefix: 'mal' | 'anidb') {
    return {
      kind: prefix === 'mal' ? 'jikan' : 'anidb', idPrefix: prefix,
      searchAnime: jest.fn(async () => ({ data: [] })),
      getAnimeById: jest.fn(async (id: number) => ({
        mal_id: id, title: `t${id}`, titles: [], images: { jpg: { image_url: '' } },
        aired: { from: '2019-01-01', to: null }, genres: [], rating: '', relations: [], external: [],
      })),
      getAnimeCharacters: async () => ({ data: [] }), getAnimeStaff: async () => ({ data: [] }),
      getAnimePictures: async () => ({ data: [] }), clearCache: () => undefined,
    } as any;
  }

  it('season request with {anidb-12566} in Jikan mode → MAL 34437, no title search', async () => {
    const { MatchService } = require('../src/services/MatchService');
    const src = fakeSource('mal');
    const svc = new MatchService(src, {}, { idMapping: mapping() });
    const r = await svc.match({
      type: 3, parentTitle: 'Code Geass Fukkatsu No Lelouch', parentYear: 2019, index: 1,
      filename: 'Code Geass Fukkatsu no Lelouch (2019) {anidb-12566}\\Season 01\\x.mp4',
    });
    expect(r.MediaContainer.Metadata[0].ratingKey).toBe('mal-season-34437-1');
    expect(src.searchAnime).not.toHaveBeenCalled();
  });

  it('AniDB mode uses the anidb tag directly (no mapping needed)', async () => {
    const { MatchService } = require('../src/services/MatchService');
    const src = fakeSource('anidb');
    const r = await new MatchService(src).match({ type: 2, title: 'x', filename: 'x {anidb-15910}\\e.mp4' });
    expect(r.MediaContainer.Metadata[0].ratingKey).toBe('anidb-show-15910');
    expect(src.searchAnime).not.toHaveBeenCalled();
  });

  it('unknown mapping falls back to the title search', async () => {
    const { MatchService } = require('../src/services/MatchService');
    const src = fakeSource('mal');
    await new MatchService(src, {}, { idMapping: mapping() }).match({ type: 2, title: 'x', filename: 'x {anidb-1}\\e.mp4' });
    expect(src.searchAnime).toHaveBeenCalled();
  });

  it('season lookups use parentYear for the year filter', async () => {
    const { MatchService } = require('../src/services/MatchService');
    const src = fakeSource('mal');
    src.searchAnime = jest.fn(async () => ({ data: [
      { mal_id: 1, title: 'Code Geass', titles: [], title_synonyms: [], score: 8, aired: { from: '2006-10-06', to: null } },
      { mal_id: 34437, title: 'Code Geass', titles: [], title_synonyms: [], score: 7, aired: { from: '2019-02-09', to: null } },
    ] }));
    const r = await new MatchService(src).match({ type: 3, parentTitle: 'Code Geass', parentYear: 2019, index: 1 });
    expect(r.MediaContainer.Metadata[0].ratingKey).toBe('mal-season-34437-1');
    expect(src.searchAnime.mock.calls[0][2]).toEqual({ year: 2019 });
  });
});

describe('Jikan resilience', () => {
  const { JikanClient } = require('../src/clients/JikanClient');

  it('retries timeouts and succeeds', async () => {
    const c = new JikanClient('http://x', { retries: 2, perSecond: 100 });
    let n = 0;
    (c as any).client.get = async () => {
      if (n++ < 2) { const e: any = new Error('timeout of 20000ms exceeded'); e.code = 'ECONNABORTED'; throw e; }
      return { data: { data: { mal_id: 1, title: 'ok' } } };
    };
    const a = await c.getAnimeById(1);
    expect(a.title).toBe('ok');
    expect(n).toBe(3);
  }, 15000);

  it('gives up with a short error, no retry on 404', async () => {
    const c = new JikanClient('http://x', { retries: 3, perSecond: 100 });
    let n = 0;
    (c as any).client.get = async () => { n++; const e: any = new Error('nf'); e.response = { status: 404 }; throw e; };
    await expect(c.getAnimeById(2)).rejects.toThrow('Jikan API request failed (404): anime:2');
    expect(n).toBe(1);
  });

  it('identical concurrent requests share one API call', async () => {
    const c = new JikanClient('http://x', { perSecond: 100 });
    let n = 0;
    (c as any).client.get = async () => { n++; return { data: { data: { mal_id: 3 } } }; };
    await Promise.all([c.getAnimeById(3), c.getAnimeById(3), c.getAnimeById(3)]);
    expect(n).toBe(1);
  });
});

describe('Jikan start_date fallback', () => {
  it('retries without start_date when the server rejects it', async () => {
    const { JikanClient } = require('../src/clients/JikanClient');
    const c = new JikanClient('http://x', { perSecond: 100 });
    const seen: any[] = [];
    (c as any).client.get = async (_u: string, cfg: any) => {
      seen.push({ ...cfg.params });
      if (cfg.params.start_date) { const e: any = new Error('bad'); e.response = { status: 400 }; throw e; }
      return { data: { data: [{ mal_id: 1 }], pagination: {} } };
    };
    const r = await c.searchAnime('X', { limit: 20 }, { year: 2019 });
    expect(r.data[0].mal_id).toBe(1);
    expect(seen.map((p) => p.start_date)).toEqual(['2019-01-01', undefined]);
  });
});
