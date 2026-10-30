/**
 * CollectionSync against a fake Plex Media Server (records every write)
 */
import http from 'http';
import { AddressInfo } from 'net';
import { PlexClient } from '../src/plex/PlexClient';
import { syncCollections } from '../src/plex/CollectionSync';

const ID = 'tv.plex.agents.custom.anime';

function fakePlex() {
  const state = {
    shows: [
      { ratingKey: '101', guid: `${ID}://show/anidb-show-4521`, title: 'Code Geass', Collection: [] as any[] },
      { ratingKey: '102', guid: `${ID}://show/anidb-show-5373`, title: 'Code Geass R2', Collection: [{ tag: 'Favourites' }] },
      { ratingKey: '103', guid: `${ID}://show/anidb-show-15910`, title: 'Roze', Collection: [{ tag: 'Code Geass' }] },
      { ratingKey: '104', guid: `${ID}://show/anidb-show-999`, title: 'Standalone', Collection: [] },
      { ratingKey: '105', guid: 'plex://show/abc', title: 'Other agent', Collection: [] },
      { ratingKey: '106', guid: `${ID}://show/mal-show-42916`, title: 'Old MAL match', Collection: [] },
    ],
    collections: [] as { ratingKey: string; title: string; summary?: string }[],
    writes: [] as { method: string; path: string; params: Record<string, string> }[],
    token: '',
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    state.token = String(req.headers['x-plex-token'] || '');
    const params = Object.fromEntries(u.searchParams.entries());
    const json = (b: any) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (req.method === 'GET' && u.pathname === '/library/sections')
      return json({ MediaContainer: { Directory: [{ key: '7', title: 'Anime', type: 'show' }, { key: '1', title: 'Movies', type: 'movie' }] } });
    if (req.method === 'GET' && u.pathname === '/library/sections/7/all')
      return json({ MediaContainer: { Metadata: state.shows } });
    if (req.method === 'GET' && u.pathname === '/library/sections/7/collections')
      return json({ MediaContainer: { Metadata: state.collections.map((c) => ({
        ...c, childCount: state.shows.filter((s) => s.Collection.some((x: any) => x.tag === c.title)).length })) } });
    const item = u.pathname.match(/^\/library\/metadata\/(\d+)$/);
    if (req.method === 'GET' && item) return json({ MediaContainer: { Metadata: [state.shows.find((s) => s.ratingKey === item[1])] } });
    state.writes.push({ method: req.method!, path: u.pathname, params });
    const del = u.pathname.match(/^\/library\/collections\/(\d+)$/);
    if (req.method === 'DELETE' && del) state.collections = state.collections.filter((c) => c.ratingKey !== del[1]);
    if (req.method === 'PUT' && params.type === '18') {
      const c = state.collections.find((x) => x.ratingKey === params.id);
      if (c) c.summary = params['summary.value'];
    }
    if (req.method === 'PUT' && u.pathname === '/library/sections/7/all' && params.type === '2') {
      const show = state.shows.find((s) => s.ratingKey === params.id)!;
      show.Collection = Object.keys(params).filter((k) => /^collection\[\d+\]\.tag\.tag$/.test(k)).map((k) => ({ tag: params[k] }));
      for (const c of show.Collection) if (!state.collections.some((x) => x.title === c.tag))
        state.collections.push({ ratingKey: String(900 + state.collections.length), title: c.tag });
    }
    res.writeHead(200); res.end();
  });
  return { state, server };
}

describe('collection sync into Plex', () => {
  const { state, server } = fakePlex();
  let base = '';
  beforeAll((done) => { server.listen(0, () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; done(); }); });
  afterAll((done) => { server.close(() => done()); });

  const resolve = async (key: string) =>
    ({ 'anidb-show-4521': { tag: 'Code Geass', summary: 'Code Geass — all seasons, parts and sequels.', thumb: 'https://img/cg.jpg' },
       'anidb-show-5373': { tag: 'Code Geass' }, 'anidb-show-15910': { tag: 'Code Geass' } } as any)[key] ?? null;

  it('tags provider shows, keeps existing collections, sets poster/summary on new ones', async () => {
    const r = await syncCollections({ plex: new PlexClient(base, 'SECRET'), library: 'anime', providerIdentifier: ID, idPrefix: 'anidb', resolve });
    expect(state.token).toBe('SECRET');
    expect(r).toMatchObject({ shows: 6, matchedByProvider: 5, tagged: 2, alreadyTagged: 1, noCollection: 2, outdatedSource: 1, noCounterpart: 1, failed: 0, newCollections: ['Code Geass'] });
    expect(state.shows.find((s) => s.ratingKey === '102')!.Collection.map((c) => c.tag)).toEqual(['Favourites', 'Code Geass']);
    expect(state.shows.find((s) => s.ratingKey === '105')!.Collection).toEqual([]); // other agent untouched
    const tagWrite = state.writes.find((w) => w.params.id === '101')!;
    expect(tagWrite.params['collection.locked']).toBe('1');
    expect(state.writes.some((w) => w.method === 'POST' && w.path === '/library/metadata/900/posters' && w.params.url === 'https://img/cg.jpg')).toBe(true);
    expect(state.writes.some((w) => w.params.type === '18' && w.params['summary.value'] === 'Code Geass — all seasons, parts and sequels.')).toBe(true);
  });

  it('second run changes nothing', async () => {
    const n = state.writes.length;
    const r = await syncCollections({ plex: new PlexClient(base, 'SECRET'), library: 'Anime', providerIdentifier: ID, resolve });
    expect(r.tagged).toBe(0);
    expect(r.alreadyTagged).toBe(3);
    expect(state.writes.length).toBe(n);
  });

  it('unknown library lists the available ones', async () => {
    await expect(syncCollections({ plex: new PlexClient(base, 'x'), library: 'Animes', providerIdentifier: ID, resolve }))
      .rejects.toThrow('Plex library "Animes" not found (available: Anime, Movies)');
  });

  it('replaces an outdated provider collection, keeps user collections, deletes the empty one', async () => {
    // simulate the old wrong naming: show 102 carries a provider-made "Pokemon Movie 06" collection
    state.collections.push({ ratingKey: '950', title: 'Pokemon Movie 06', summary: 'Pokemon Movie 06 — all seasons, parts and sequels.' });
    state.collections.push({ ratingKey: '951', title: 'My Empty Manual', summary: 'mine' });
    state.shows.find((s) => s.ratingKey === '102')!.Collection = [{ tag: 'Favourites' }, { tag: 'Pokemon Movie 06' }];
    const r = await syncCollections({ plex: new PlexClient(base, 'SECRET'), library: 'Anime', providerIdentifier: ID, resolve });
    expect(r.retagged).toBe(1);
    expect(state.shows.find((s) => s.ratingKey === '102')!.Collection.map((c: any) => c.tag)).toEqual(['Favourites', 'Code Geass']);
    expect(r.deletedCollections).toEqual(['Pokemon Movie 06']);
    expect(state.collections.some((c) => c.title === 'My Empty Manual')).toBe(true); // not ours → kept
  });

  it('puts a crossover entry into every collection it belongs to', async () => {
    const multi = async (key: string) =>
      key === 'anidb-show-999'
        ? [{ tag: 'Air', summary: 'Air — all seasons, parts and sequels.' }, { tag: 'Kanon', summary: 'Kanon — all seasons, parts and sequels.' }]
        : resolve(key);
    const r = await syncCollections({ plex: new PlexClient(base, 'SECRET'), library: 'Anime', providerIdentifier: ID, resolve: multi });
    expect(r.tagged).toBe(1);
    expect(state.shows.find((s) => s.ratingKey === '104')!.Collection.map((c: any) => c.tag)).toEqual(['Air', 'Kanon']);
    expect(r.newCollections.sort()).toEqual(['Air', 'Kanon']);

    // second run: nothing to do; dropping one of them later removes only that one
    const again = await syncCollections({ plex: new PlexClient(base, 'SECRET'), library: 'Anime', providerIdentifier: ID, resolve: multi });
    expect(again.tagged + again.retagged).toBe(0);
    const single = async (key: string) => (key === 'anidb-show-999' ? { tag: 'Air' } : resolve(key));
    const r3 = await syncCollections({ plex: new PlexClient(base, 'SECRET'), library: 'Anime', providerIdentifier: ID, resolve: single });
    expect(r3.retagged).toBe(1);
    expect(state.shows.find((s) => s.ratingKey === '104')!.Collection.map((c: any) => c.tag)).toEqual(['Air']);
    expect(r3.deletedCollections).toEqual(['Kanon']);
  });

  it('outdated source: keeps the ID and sets the collection of its counterpart', async () => {
    // show 106 is mal-show-42916, the active source is AniDB; the ID list says MAL 42916 = AniDB 5373
    const n = state.writes.length;
    const translate = async (from: string, id: number, to: string) => (from === 'mal' && id === 42916 && to === 'anidb' ? 5373 : undefined);
    const r = await syncCollections({ plex: new PlexClient(base, 'SECRET'), library: 'Anime', providerIdentifier: ID, idPrefix: 'anidb', resolve, translate });
    expect(r).toMatchObject({ outdatedSource: 1, rematched: 0, noCounterpart: 0 });
    expect(state.shows.find((s) => s.ratingKey === '106')!.Collection.map((c: any) => c.tag)).toEqual(['Code Geass']);
    expect(state.writes.slice(n).some((w) => w.path.endsWith('/match'))).toBe(false);
  });

  it('outdated source with REMATCH_OUTDATED: re-matches, but never onto an ID another show uses', async () => {
    const n = state.writes.length;
    // AniDB 5373 is already show 102 → not re-matched
    const taken = async () => 5373;
    const r1 = await syncCollections({ plex: new PlexClient(base, 'SECRET'), library: 'Anime', providerIdentifier: ID, idPrefix: 'anidb', resolve, translate: taken, rematch: true });
    expect(r1.rematched).toBe(0);
    expect(state.writes.slice(n).some((w) => w.path.endsWith('/match'))).toBe(false);

    const free = async () => 777;
    const r2 = await syncCollections({ plex: new PlexClient(base, 'SECRET'), library: 'Anime', providerIdentifier: ID, idPrefix: 'anidb', resolve, translate: free, rematch: true });
    expect(r2.rematched).toBe(1);
    const match = state.writes.find((w) => w.method === 'PUT' && w.path === '/library/metadata/106/match')!;
    expect(match.params.guid).toBe(`${ID}://show/anidb-show-777`);
    expect(match.params.name).toBe('Old MAL match');
  });
});
