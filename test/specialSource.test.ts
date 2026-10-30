/**
 * Which MAL entry a special (Season 0 episode) comes from — used by the MyAnimeList updater
 */
import { MetadataService } from '../src/services/MetadataService';
import { parseSpecialTag, resolveTaggedSpecial } from '../src/services/SpecialsHelper';

function anime(id: number, type: string, aired: string, relations: any[] = []): any {
  return { mal_id: id, title: `Anime ${id}`, type, episodes: type === 'TV' ? 12 : type === 'OVA' ? 2 : 1, aired: { from: aired }, relations,
    images: { jpg: { image_url: '', large_image_url: '' } } };
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
    expect(await svc.getSpecialSource('mal-episode-100-0-1')).toEqual({ mal_id: 300, episode: 1, title: 'Anime 300', episodes: 1 });
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

describe('specials tagged with a MAL ID in the file name', () => {
  it('reads the tag', () => {
    expect(parseSpecialTag('Attack on Titan - S00E03 {mal-25777}.mkv')).toEqual({ malId: 25777, episode: undefined });
    expect(parseSpecialTag('S00E03 [mal-25777-2].mkv')).toEqual({ malId: 25777, episode: 2 });
    expect(parseSpecialTag('S00E03 {myanimelist=25777}.mkv')).toEqual({ malId: 25777, episode: undefined });
    expect(parseSpecialTag('S00E03 {anidb-1}.mkv', null, undefined)).toBeNull();
  });

  it('a single-episode entry needs no episode number', async () => {
    const s = await resolveTaggedSpecial({ malId: 300 }, 100, 7, malSource);
    expect([s?.anime.mal_id, s?.episode.mal_id, s?.globalIndex]).toEqual([300, 1, 7]);
  });

  it('an episode in the tag wins', async () => {
    const s = await resolveTaggedSpecial({ malId: 200, episode: 2 }, 100, 1, malSource);
    expect([s?.anime.mal_id, s?.episode.mal_id]).toEqual([200, 2]);
  });

  it('a multi-episode entry without episode uses the S00 number only if it lands on that entry', async () => {
    // aggregated: S2 = 200 ep 1, S3 = 200 ep 2
    expect((await resolveTaggedSpecial({ malId: 200 }, 100, 3, malSource))?.episode.mal_id).toBe(2);
    expect(await resolveTaggedSpecial({ malId: 200 }, 100, 1, malSource)).toBeNull();
  });

  it('the tag stays in the ratingKey and is what the updater gets', async () => {
    const svc = new MetadataService(malSource, {});
    const res: any = await svc.getMetadata('mal-episode-100-0-5-200-2');
    expect(res.MediaContainer.Metadata[0].ratingKey).toBe('mal-episode-100-0-5-200-2');
    expect(res.MediaContainer.Metadata[0].index).toBe(5);
    expect(await svc.getSpecialSource('mal-episode-100-0-5-200-2')).toEqual({ mal_id: 200, episode: 2, title: 'Anime 200', episodes: 2 });
  });
});
