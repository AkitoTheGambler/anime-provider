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

/** A MAL entry named in a special's file name: {mal-25777} or {mal-25777-2} (episode 2 of it) */
export interface SpecialTag {
  malId: number;
  episode?: number;
}

/** Reads {mal-25777} / [mal-25777-2] / {myanimelist-25777} from a file name */
export function parseSpecialTag(...texts: (string | undefined | null)[]): SpecialTag | null {
  const re = /[{\[]\s*(?:mal|myanimelist)\s*[-=:]\s*(\d+)(?:\s*-\s*(\d+))?\s*[}\]]/i;
  for (const text of texts) {
    const m = text?.match(re);
    if (m) return { malId: parseInt(m[1], 10), episode: m[2] ? parseInt(m[2], 10) : undefined };
  }
  return null;
}

/**
 * The special a tagged file stands for. Without an episode in the tag, a single-episode entry is
 * episode 1; for a multi-episode entry the S00 number is used if it lands on that entry in the
 * aggregated numbering. null = can't tell which episode (or the entry doesn't exist).
 */
export async function resolveTaggedSpecial(
  tag: SpecialTag,
  mainMalId: number,
  globalIndex: number,
  jikanClient: AnimeDataSource
): Promise<SpecialEntry | null> {
  let anime: JikanAnime;
  try {
    anime = await jikanClient.getAnimeById(tag.malId);
  } catch {
    return null;
  }
  let episodes: JikanEpisode[] = [];
  try {
    episodes = (await jikanClient.getAllAnimeEpisodes(tag.malId)).data;
  } catch {
    /* treated as a single-episode entry */
  }

  let number = tag.episode;
  if (number === undefined) {
    if (episodes.length <= 1) {
      number = 1;
    } else {
      const aggregated = await getAggregatedSpecials(mainMalId, jikanClient);
      const hit = aggregated.find((s) => s.globalIndex === globalIndex && s.anime.mal_id === tag.malId);
      if (!hit) return null;
      number = hit.episode.mal_id;
    }
  }

  const episode =
    episodes.find((e) => e.mal_id === number) ??
    (episodes.length === 0 && number === 1
      ? {
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
        }
      : undefined);
  return episode ? { anime, episode, globalIndex } : null;
}
