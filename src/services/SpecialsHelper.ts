/**
 * Aggregates special episodes (OVA/Special/ONA) for a main anime
 * by following its Side story / Other / Summary / Spin-off relations.
 */

import { AnimeDataSource, SpecialEntry } from '../clients/AnimeDataSource';
import { JikanAnime, JikanEpisode } from '../types/jikan';

export type { SpecialEntry };

export const SPECIAL_RELATION_TYPES = ['Side story', 'Other', 'Summary', 'Spin-off'];
export const SPECIAL_ANIME_TYPES = ['OVA', 'Special', 'ONA'];

const MAX_SPECIAL_ENTRIES = 10;


/**
 * Returns all special episodes for a main anime, sorted by air date.
 * Each entry gets a globalIndex that is used as the episode number in Season 0.
 */
export async function getAggregatedSpecials(
  mainMalId: number,
  jikanClient: AnimeDataSource
): Promise<SpecialEntry[]> {
  // Backends with native specials (AniDB "S" episodes) don't need relation crawling
  if (jikanClient.getSpecials) {
    return jikanClient.getSpecials(mainMalId);
  }

  const mainAnime = await jikanClient.getAnimeById(mainMalId);

  if (!mainAnime.relations?.length) return [];

  const specialRelationEntries = mainAnime.relations
    .filter((r) => SPECIAL_RELATION_TYPES.includes(r.relation))
    .flatMap((r) => r.entry.filter((e) => e.type === 'anime'));

  if (!specialRelationEntries.length) return [];

  // Fetch details for each related entry, keep only OVA/Special/ONA types
  const relatedAnimes: JikanAnime[] = [];
  for (const rel of specialRelationEntries.slice(0, MAX_SPECIAL_ENTRIES)) {
    try {
      const anime = await jikanClient.getAnimeById(rel.mal_id);
      if (SPECIAL_ANIME_TYPES.includes(anime.type)) {
        relatedAnimes.push(anime);
      }
    } catch {
      // skip unreachable entries
    }
  }

  if (!relatedAnimes.length) return [];

  const allSpecials: Array<{ anime: JikanAnime; episode: JikanEpisode }> = [];

  for (const anime of relatedAnimes) {
    try {
      const episodesResp = await jikanClient.getAllAnimeEpisodes(anime.mal_id);

      if (episodesResp.data.length > 0) {
        episodesResp.data.forEach((ep) => allSpecials.push({ anime, episode: ep }));
      } else {
        // Single-episode OVA with no episode list — synthesize one episode
        allSpecials.push({
          anime,
          episode: {
            mal_id: 1,
            url: null,
            title: anime.title_english || anime.title,
            title_japanese: anime.title_japanese,
            title_romanji: null,
            duration: null,
            aired: anime.aired?.from || null,
            filler: false,
            recap: false,
            synopsis: anime.synopsis,
            forum_url: null,
          },
        });
      }
    } catch {
      // skip
    }
  }

  allSpecials.sort((a, b) => {
    const dateA = a.episode.aired || a.anime.aired?.from || '';
    const dateB = b.episode.aired || b.anime.aired?.from || '';
    return dateA.localeCompare(dateB);
  });

  return allSpecials.map((s, i) => ({ ...s, globalIndex: i + 1 }));
}
