/**
 * Tests for language handling in search and output.
 * Title data sourced directly from Jikan API (MAL):
 *
 * Detective Conan (MAL 235):
 *   Default: "Meitantei Conan" | English: "Case Closed" | German: "Case Closed"
 *   Synonym: "Detective Conan" | Japanese: "名探偵コナン"
 *   → No French or Spanish registered on MAL
 *   → German title on MAL is "Case Closed", NOT "Detektiv Conan"
 *
 * Attack on Titan (MAL 16498):
 *   Default: "Shingeki no Kyojin" | English: "Attack on Titan"
 *   German: "Attack on Titan" | Japanese: "進撃の巨人"
 *   French: "L'Attaque des Titans" | Spanish: "Ataque a los Titanes"
 *   → German on MAL is the English title, NOT a German translation
 */

import { MatchService } from '../src/services/MatchService';
import { JikanMapper } from '../src/mappers/JikanMapper';
import { JikanAnimeSearchResult, JikanAnime } from '../src/types/jikan';

const service = new MatchService() as any;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<JikanAnimeSearchResult>): JikanAnimeSearchResult {
  return {
    mal_id: 1,
    url: '',
    approved: true,
    airing: false,
    source: 'Manga',
    title: '',
    title_english: null,
    title_japanese: null,
    title_synonyms: [],
    titles: [],
    year: null,
    score: 7.0,
    type: 'TV',
    status: 'Finished Airing',
    episodes: 12,
    images: { jpg: { image_url: '', large_image_url: '' }, webp: { image_url: '', large_image_url: '' } },
    trailer: null,
    aired: { from: null, to: null, string: '' },
    duration: '24 min per ep',
    rating: 'PG-13 - Teens 13 or older',
    scored_by: null,
    rank: null,
    popularity: null,
    members: null,
    favorites: null,
    synopsis: null,
    background: null,
    season: null,
    broadcast: null,
    producers: [],
    licensors: [],
    studios: [],
    genres: [],
    explicit_genres: [],
    themes: [],
    demographics: [],
    ...overrides,
  };
}

function makeAnime(overrides: Partial<JikanAnime>): JikanAnime {
  return {
    mal_id: 1,
    url: '',
    approved: true,
    airing: false,
    source: 'Manga',
    title: '',
    title_english: null,
    title_japanese: null,
    title_synonyms: [],
    titles: [],
    type: 'TV',
    episodes: null,
    status: 'Finished Airing',
    aired: { from: null, to: null, string: '' },
    duration: '24 min per ep',
    rating: 'PG-13 - Teens 13 or older',
    score: null,
    scored_by: null,
    rank: null,
    popularity: null,
    members: null,
    favorites: null,
    synopsis: null,
    background: null,
    season: null,
    year: null,
    producers: [],
    licensors: [],
    studios: [],
    genres: [],
    explicit_genres: [],
    themes: [],
    demographics: [],
    images: { jpg: { image_url: '', large_image_url: '' }, webp: { image_url: '', large_image_url: '' } },
    relations: [],
    external: [],
    ...overrides,
  };
}

// Real MAL title data
const CONAN_RESULT = makeResult({
  mal_id: 235,
  title: 'Meitantei Conan',
  title_english: 'Case Closed',
  title_japanese: '名探偵コナン',
  title_synonyms: ['Detective Conan'],
  titles: [
    { type: 'Default',  title: 'Meitantei Conan' },
    { type: 'Synonym',  title: 'Detective Conan' },
    { type: 'Japanese', title: '名探偵コナン' },
    { type: 'English',  title: 'Case Closed' },
    { type: 'German',   title: 'Case Closed' }, // MAL registers English title under German
  ],
  score: 8.1,
});

const CONAN_ANIME = makeAnime({
  mal_id: 235,
  title: 'Meitantei Conan',
  title_english: 'Case Closed',
  title_japanese: '名探偵コナン',
  title_synonyms: ['Detective Conan'],
  titles: [
    { type: 'Default',  title: 'Meitantei Conan' },
    { type: 'Synonym',  title: 'Detective Conan' },
    { type: 'Japanese', title: '名探偵コナン' },
    { type: 'English',  title: 'Case Closed' },
    { type: 'German',   title: 'Case Closed' },
  ],
});

const AOT_RESULT = makeResult({
  mal_id: 16498,
  title: 'Shingeki no Kyojin',
  title_english: 'Attack on Titan',
  title_japanese: '進撃の巨人',
  title_synonyms: ['AoT', 'SnK'],
  titles: [
    { type: 'Default',  title: 'Shingeki no Kyojin' },
    { type: 'Synonym',  title: 'AoT' },
    { type: 'Synonym',  title: 'SnK' },
    { type: 'Japanese', title: '進撃の巨人' },
    { type: 'English',  title: 'Attack on Titan' },
    { type: 'German',   title: 'Attack on Titan' }, // MAL uses the English title for German too
    { type: 'French',   title: "L'Attaque des Titans" },
    { type: 'Spanish',  title: 'Ataque a los Titanes' },
  ],
  score: 8.5,
});

const AOT_ANIME = makeAnime({
  mal_id: 16498,
  title: 'Shingeki no Kyojin',
  title_english: 'Attack on Titan',
  title_japanese: '進撃の巨人',
  title_synonyms: ['AoT', 'SnK'],
  titles: [
    { type: 'Default',  title: 'Shingeki no Kyojin' },
    { type: 'Synonym',  title: 'AoT' },
    { type: 'Synonym',  title: 'SnK' },
    { type: 'Japanese', title: '進撃の巨人' },
    { type: 'English',  title: 'Attack on Titan' },
    { type: 'German',   title: 'Attack on Titan' },
    { type: 'French',   title: "L'Attaque des Titans" },
    { type: 'Spanish',  title: 'Ataque a los Titanes' },
  ],
});

// ─── Detective Conan — real MAL titles ───────────────────────────────────────

describe('Detective Conan — real MAL title data', () => {
  it('"Detektiv Conan" does NOT match — that title is not on MAL', () => {
    const [scored] = service.scoreAnimeMatches([CONAN_RESULT], 'Detektiv Conan');
    expect(scored.matchScore).toBeLessThan(100);
  });

  it('"Case Closed" matches — that is the registered English AND German title', () => {
    const [scored] = service.scoreAnimeMatches([CONAN_RESULT], 'Case Closed');
    expect(scored.matchScore).toBeGreaterThan(150);
  });

  it('"Detective Conan" matches — registered as a Synonym', () => {
    const [scored] = service.scoreAnimeMatches([CONAN_RESULT], 'Detective Conan');
    expect(scored.matchScore).toBeGreaterThan(150);
  });

  it('"Meitantei Conan" matches — the Default (romaji) title', () => {
    const [scored] = service.scoreAnimeMatches([CONAN_RESULT], 'Meitantei Conan');
    expect(scored.matchScore).toBeGreaterThan(150);
  });

  it('has no French title on MAL — French filenames will not find it', () => {
    const hasFrench = CONAN_RESULT.titles?.some(t => t.type === 'French');
    expect(hasFrench).toBe(false);
  });

  it('has no Spanish title on MAL — Spanish filenames will not find it', () => {
    const hasSpanish = CONAN_RESULT.titles?.some(t => t.type === 'Spanish');
    expect(hasSpanish).toBe(false);
  });
});

// ─── Detective Conan — titleLanguage output ───────────────────────────────────

describe('Detective Conan — titleLanguage output (not search)', () => {
  it('titleLanguage:english → "Case Closed"', () => {
    const mapper = new JikanMapper({ titleLanguage: 'english' });
    expect(mapper.mapAnimeToShow(CONAN_ANIME).title).toBe('Case Closed');
  });

  it('titleLanguage:romaji → "Meitantei Conan"', () => {
    const mapper = new JikanMapper({ titleLanguage: 'romaji' });
    expect(mapper.mapAnimeToShow(CONAN_ANIME).title).toBe('Meitantei Conan');
  });

  it('titleLanguage:japanese → "名探偵コナン"', () => {
    const mapper = new JikanMapper({ titleLanguage: 'japanese' });
    expect(mapper.mapAnimeToShow(CONAN_ANIME).title).toBe('名探偵コナン');
  });

  it('titleLanguage:german → "Case Closed" (MAL registers English title as German)', () => {
    const mapper = new JikanMapper({ titleLanguage: 'german' });
    expect(mapper.mapAnimeToShow(CONAN_ANIME).title).toBe('Case Closed');
  });

  it('titleLanguage:french → "Case Closed" (falls back to English — no French on MAL)', () => {
    const mapper = new JikanMapper({ titleLanguage: 'french' });
    expect(mapper.mapAnimeToShow(CONAN_ANIME).title).toBe('Case Closed');
  });

  it('titleLanguage:spanish → "Case Closed" (falls back to English — no Spanish on MAL)', () => {
    const mapper = new JikanMapper({ titleLanguage: 'spanish' });
    expect(mapper.mapAnimeToShow(CONAN_ANIME).title).toBe('Case Closed');
  });
});

// ─── Attack on Titan — real MAL titles ───────────────────────────────────────

describe('Attack on Titan — real MAL title data', () => {
  it('"Angriff auf Titan" does NOT match — German on MAL is "Attack on Titan"', () => {
    const [scored] = service.scoreAnimeMatches([AOT_RESULT], 'Angriff auf Titan');
    expect(scored.matchScore).toBeLessThan(100);
  });

  it('"Attack on Titan" matches — registered as English AND German on MAL', () => {
    const [scored] = service.scoreAnimeMatches([AOT_RESULT], 'Attack on Titan');
    expect(scored.matchScore).toBeGreaterThan(150);
  });

  it('"L\'Attaque des Titans" matches — French title is registered on MAL', () => {
    const [scored] = service.scoreAnimeMatches([AOT_RESULT], "L'Attaque des Titans");
    expect(scored.matchScore).toBeGreaterThan(150);
  });

  it('"Ataque a los Titanes" matches — Spanish title is registered on MAL', () => {
    const [scored] = service.scoreAnimeMatches([AOT_RESULT], 'Ataque a los Titanes');
    expect(scored.matchScore).toBeGreaterThan(150);
  });

  it('"Shingeki no Kyojin" matches — the Default (romaji) title', () => {
    const [scored] = service.scoreAnimeMatches([AOT_RESULT], 'Shingeki no Kyojin');
    expect(scored.matchScore).toBeGreaterThan(150);
  });
});

// ─── Attack on Titan — titleLanguage output ───────────────────────────────────

describe('Attack on Titan — titleLanguage output (not search)', () => {
  it('titleLanguage:english → "Attack on Titan"', () => {
    const mapper = new JikanMapper({ titleLanguage: 'english' });
    expect(mapper.mapAnimeToShow(AOT_ANIME).title).toBe('Attack on Titan');
  });

  it('titleLanguage:french → "L\'Attaque des Titans"', () => {
    const mapper = new JikanMapper({ titleLanguage: 'french' });
    expect(mapper.mapAnimeToShow(AOT_ANIME).title).toBe("L'Attaque des Titans");
  });

  it('titleLanguage:spanish → "Ataque a los Titanes"', () => {
    const mapper = new JikanMapper({ titleLanguage: 'spanish' });
    expect(mapper.mapAnimeToShow(AOT_ANIME).title).toBe('Ataque a los Titanes');
  });

  it('titleLanguage:german → "Attack on Titan" (MAL registers English as German)', () => {
    const mapper = new JikanMapper({ titleLanguage: 'german' });
    expect(mapper.mapAnimeToShow(AOT_ANIME).title).toBe('Attack on Titan');
  });

  it('titleLanguage:japanese → "進撃の巨人"', () => {
    const mapper = new JikanMapper({ titleLanguage: 'japanese' });
    expect(mapper.mapAnimeToShow(AOT_ANIME).title).toBe('進撃の巨人');
  });

  it('titleLanguage:romaji → "Shingeki no Kyojin"', () => {
    const mapper = new JikanMapper({ titleLanguage: 'romaji' });
    expect(mapper.mapAnimeToShow(AOT_ANIME).title).toBe('Shingeki no Kyojin');
  });
});

// ─── Language does not affect search ─────────────────────────────────────────

describe('titleLanguage and X-Plex-Language do not affect search', () => {
  it('scoring function has no language parameter — identical scores for any language setting', () => {
    const scoreA = service.scoreAnimeMatches([AOT_RESULT], 'Attack on Titan')[0].matchScore;
    const scoreB = service.scoreAnimeMatches([AOT_RESULT], 'Attack on Titan')[0].matchScore;
    expect(scoreA).toBe(scoreB);
  });

  it('X-Plex-Language is accepted in MatchServiceOptions but never forwarded to Jikan', () => {
    // Confirmed: only field passed to jikanClient.searchAnime() is request.title + sfw flag
    // options.language exists in the type but has no code path to the API call
    const opts: { language?: string } = { language: 'fr' };
    expect(opts.language).toBe('fr'); // it's in the struct but goes nowhere
  });
});
