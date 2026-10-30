/**
 * Which MAL entry a special (Season 0 episode) comes from — used by the MyAnimeList updater
 */
import { MetadataService } from '../src/services/MetadataService';

function anime(id: number, type: string, aired: string, relations: any[] = []): any {
  return { mal_id: id, title: `Anime ${id}`, type, episodes: type === 'TV' ? 12 : 2, aired: { from: aired }, relations };
}

const db: Record<number, any> = {
  100: anime(100, 'TV', '2020-01-01', [
    { relation: 'Side story', entry: [{ mal_id: 200, type: 'anime' }, { mal_id: 300, type: 'anime' }] },
  ]),
  200: anime(200, 'OVA', '2021-01-01'),
  300: anime(300, 'Special', '2020-06-01'),
};
const episodes: Record<number, any[]> = {
  200: [{ mal_id: 1, aired: '2021-01-01' }, { mal_id: 2, aired: '2021-02-01' }],
  300: [], // no episode list: one synthesized episode
};

const malSource: any = {
  kind: 'jikan',
  idPrefix: 'mal',
  getAnimeById: async (id: number) => db[id],
  getAllAnimeEpisodes: async (id: number) => ({ data: episodes[id] ?? [] }),
};

describe('special source', () => {
  const svc = new MetadataService(malSource, {});

  it('names the MAL entry and its episode for each Season 0 episode', async () => {
    // sorted by air date: S1 = 300 (2020-06), S2 = 200 ep 1, S3 = 200 ep 2
    expect(await svc.getSpecialSource('mal-episode-100-0-1')).toEqual({ mal_id: 300, episode: 1, title: 'Anime 300', episodes: 2 });
    expect(await svc.getSpecialSource('mal-episode-100-0-3')).toEqual({ mal_id: 200, episode: 2, title: 'Anime 200', episodes: 2 });
  });

  it('nothing for unknown specials or regular episodes', async () => {
    expect(await svc.getSpecialSource('mal-episode-100-0-9')).toBeNull();
    expect(await svc.getSpecialSource('mal-episode-100-1-3')).toBeNull();
  });

  it('nothing for sources with native specials (AniDB)', async () => {
    const anidb = new MetadataService({ ...malSource, kind: 'anidb', idPrefix: 'anidb', getSpecials: async () => [] }, {});
    expect(await anidb.getSpecialSource('anidb-episode-100-0-1')).toBeNull();
  });
});
