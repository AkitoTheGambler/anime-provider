import { SourceRouter } from '../src/services/SourceRouter';

const hit = (key: string) => ({ MediaContainer: { offset: 0, totalSize: 1, identifier: 'x', size: 1, Metadata: [{ ratingKey: key }] } }) as any;
const miss = () => ({ MediaContainer: { offset: 0, totalSize: 0, identifier: 'x', size: 0, Metadata: [] } }) as any;

function services(anidbResult: any, malResult: any) {
  const anidb = { match: { match: jest.fn(async () => (anidbResult instanceof Error ? Promise.reject(anidbResult) : anidbResult)) }, metadata: { name: 'anidb-meta' } };
  const mal = { match: { match: jest.fn(async () => malResult) }, metadata: { name: 'mal-meta' } };
  return { anidb, mal } as any;
}
const tagged = { type: 3, parentTitle: 'Code Geass', parentYear: 2024, index: 1, filename: 'Code Geass Dakkan no Roze (2024) {anidb-15910}\\x.mp4' };
const untagged = { type: 2, title: 'Death Note', year: 2006, filename: 'Death Note (2006)\\x.mkv' };

describe('SourceRouter', () => {
  it('{anidb-…} folders go to AniDB, default (jikan) not asked', async () => {
    const s = services(hit('anidb-season-15910-1'), hit('mal-season-56835-1'));
    const r = await new SourceRouter(s, 'mal').match(tagged);
    expect(r.MediaContainer.Metadata[0].ratingKey).toBe('anidb-season-15910-1');
    expect(s.mal.match.match).not.toHaveBeenCalled();
  });

  it('untagged folders use the default source only', async () => {
    const s = services(hit('anidb-show-1'), hit('mal-show-1535'));
    const r = await new SourceRouter(s, 'mal').match(untagged);
    expect(r.MediaContainer.Metadata[0].ratingKey).toBe('mal-show-1535');
    expect(s.anidb.match.match).not.toHaveBeenCalled();
  });

  it('falls back to the default when AniDB finds nothing or fails', async () => {
    let s = services(miss(), hit('mal-season-56835-1'));
    expect((await new SourceRouter(s, 'mal').match(tagged)).MediaContainer.Metadata[0].ratingKey).toBe('mal-season-56835-1');
    s = services(new Error('AniDB banned'), hit('mal-season-56835-1'));
    expect((await new SourceRouter(s, 'mal').match(tagged)).MediaContainer.Metadata[0].ratingKey).toBe('mal-season-56835-1');
  });

  it('without AniDB configured, tagged folders go to the default (which translates the tag)', async () => {
    const s = services(hit('x'), hit('mal-season-56835-1'));
    delete s.anidb;
    const router = new SourceRouter(s, 'mal');
    expect(router.matchOrder(tagged)).toEqual(['mal']);
    expect((await router.match(tagged)).MediaContainer.Metadata[0].ratingKey).toBe('mal-season-56835-1');
  });

  it('{mal-…} folders with default anidb go to MAL first', () => {
    const s = services(hit('x'), hit('y'));
    expect(new SourceRouter(s, 'anidb').matchOrder({ type: 2, title: 'x', filename: 'X {mal-1535}\\a.mkv' })).toEqual(['mal', 'anidb']);
  });

  it('metadata is routed by ratingKey prefix — old mal-… matches keep working', () => {
    const s = services(hit('x'), hit('y'));
    const router = new SourceRouter(s, 'anidb');
    expect((router.metadataFor('mal-show-42916') as any).name).toBe('mal-meta');
    expect((router.metadataFor('anidb-episode-7508-1-2') as any).name).toBe('anidb-meta');
  });

  it('clear error for anidb keys when AniDB is not configured', () => {
    const s = services(hit('x'), hit('y'));
    delete s.anidb;
    expect(() => new SourceRouter(s, 'mal').metadataFor('anidb-show-1')).toThrow(/ANIDB_CLIENT/);
  });
});
