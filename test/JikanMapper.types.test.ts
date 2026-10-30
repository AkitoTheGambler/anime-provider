/**
 * Tests for JikanMapper across all anime types (TV, Movie, OVA, ONA, Special, Music)
 * and relation/collection behaviour
 */

import { JikanMapper } from '../src/mappers/JikanMapper';
import { JikanAnime } from '../src/types/jikan';

const mapper = new JikanMapper({ titleLanguage: 'english' });

function makeAnime(overrides: Partial<JikanAnime>): JikanAnime {
  return {
    mal_id: 1,
    url: 'https://myanimelist.net/anime/1',
    approved: true,
    airing: false,
    titles: [
      { type: 'Default', title: 'Test Anime' },
      { type: 'English', title: 'Test Anime' },
    ],
    title: 'Test Anime',
    title_english: 'Test Anime',
    title_japanese: 'テストアニメ',
    title_synonyms: [],
    type: 'TV',
    source: 'Manga',
    episodes: 12,
    status: 'Finished Airing',
    aired: { from: '2020-01-01', to: '2020-03-25', string: 'Jan 2020 to Mar 2020' },
    duration: '24 min per ep',
    rating: 'PG-13 - Teens 13 or older',
    score: 7.5,
    scored_by: 10000,
    rank: 500,
    popularity: 200,
    members: 50000,
    favorites: 1000,
    synopsis: 'A test anime synopsis.',
    background: null,
    season: 'winter',
    year: 2020,
    producers: [],
    licensors: [],
    studios: [{ mal_id: 1, type: 'anime', name: 'Test Studio', url: '' }],
    genres: [{ mal_id: 1, type: 'anime', name: 'Action', url: '' }],
    explicit_genres: [],
    themes: [],
    demographics: [],
    images: {
      jpg: { image_url: 'https://cdn.mal.net/small.jpg', large_image_url: 'https://cdn.mal.net/large.jpg' },
      webp: { image_url: 'https://cdn.mal.net/small.webp', large_image_url: 'https://cdn.mal.net/large.webp' },
    },
    relations: [],
    external: [],
    ...overrides,
  };
}

// ─── Type handling ────────────────────────────────────────────────────────────

describe('JikanMapper - Anime Type Handling', () => {
  describe('TV show', () => {
    const anime = makeAnime({ type: 'TV', episodes: 26, season: 'spring', year: 2020 });
    const result = mapper.mapAnimeToShow(anime);

    it('maps to Plex show type', () => {
      expect(result.type).toBe('show');
    });

    it('uses mal-show ratingKey', () => {
      expect(result.ratingKey).toBe('mal-show-1');
    });

    it('includes type in tagline', () => {
      expect(result.tagline).toContain('TV');
    });

    it('includes episode count in tagline', () => {
      expect(result.tagline).toContain('26 Episodes');
    });

    it('includes season and year in tagline', () => {
      expect(result.tagline).toContain('Spring 2020');
    });
  });

  describe('Movie', () => {
    const anime = makeAnime({
      type: 'Movie',
      episodes: 1,
      duration: '1 hr 55 min',
      season: null,
      year: 2021,
    });
    const result = mapper.mapAnimeToShow(anime);

    it('maps to Plex show type (no movie type in provider)', () => {
      // MAL movies are shown as shows — this is a known limitation
      expect(result.type).toBe('show');
    });

    it('uses mal-show ratingKey', () => {
      expect(result.ratingKey).toBe('mal-show-1');
    });

    it('includes Movie in tagline', () => {
      expect(result.tagline).toContain('Movie');
    });

    it('parses movie duration correctly (1h 55min = 6900000ms)', () => {
      expect(result.duration).toBe(6900000);
    });

    it('tagline shows only year when no season', () => {
      expect(result.tagline).toContain('2021');
      expect(result.tagline).not.toMatch(/Spring|Summer|Fall|Winter/);
    });
  });

  describe('OVA', () => {
    const anime = makeAnime({
      type: 'OVA',
      episodes: 4,
      duration: '30 min per ep',
      season: null,
      year: 2019,
    });
    const result = mapper.mapAnimeToShow(anime);

    it('maps to Plex show type', () => {
      expect(result.type).toBe('show');
    });

    it('includes OVA in tagline', () => {
      expect(result.tagline).toContain('OVA');
    });

    it('parses OVA episode duration correctly (30min = 1800000ms)', () => {
      expect(result.duration).toBe(1800000);
    });
  });

  describe('ONA', () => {
    const anime = makeAnime({
      type: 'ONA',
      episodes: 8,
      duration: '7 min per ep',
      season: 'fall',
      year: 2022,
    });
    const result = mapper.mapAnimeToShow(anime);

    it('maps to Plex show type', () => {
      expect(result.type).toBe('show');
    });

    it('includes ONA in tagline', () => {
      expect(result.tagline).toContain('ONA');
    });

    it('parses short episode duration correctly (7min = 420000ms)', () => {
      expect(result.duration).toBe(420000);
    });
  });

  describe('Special', () => {
    const anime = makeAnime({
      type: 'Special',
      episodes: 1,
      duration: '24 min',
      season: null,
      year: 2020,
    });
    const result = mapper.mapAnimeToShow(anime);

    it('maps to Plex show type', () => {
      expect(result.type).toBe('show');
    });

    it('includes Special in tagline', () => {
      expect(result.tagline).toContain('Special');
    });

    it('creates a single Season 1 child', () => {
      const withChildren = mapper.mapAnimeToShow(anime, { includeChildren: true });
      expect(withChildren.Children?.Metadata).toHaveLength(1);
      expect(withChildren.Children?.Metadata[0].type).toBe('season');
    });
  });

  describe('Music', () => {
    const anime = makeAnime({
      type: 'Music',
      episodes: 1,
      duration: '5 min',
      season: null,
      year: 2018,
    });
    const result = mapper.mapAnimeToShow(anime);

    it('maps to Plex show type', () => {
      expect(result.type).toBe('show');
    });

    it('includes Music in tagline', () => {
      expect(result.tagline).toContain('Music');
    });
  });
});

// ─── Duration parsing ─────────────────────────────────────────────────────────

describe('JikanMapper - Duration Parsing', () => {
  it('parses "24 min per ep"', () => {
    const result = mapper.mapAnimeToShow(makeAnime({ duration: '24 min per ep' }));
    expect(result.duration).toBe(1440000);
  });

  it('parses "1 hr 45 min"', () => {
    const result = mapper.mapAnimeToShow(makeAnime({ duration: '1 hr 45 min' }));
    expect(result.duration).toBe(6300000);
  });

  it('parses "2 hr"', () => {
    const result = mapper.mapAnimeToShow(makeAnime({ duration: '2 hr' }));
    expect(result.duration).toBe(7200000);
  });

  it('parses "5 min"', () => {
    const result = mapper.mapAnimeToShow(makeAnime({ duration: '5 min' }));
    expect(result.duration).toBe(300000);
  });

  it('returns undefined for null duration', () => {
    const result = mapper.mapAnimeToShow(makeAnime({ duration: null as any }));
    expect(result.duration).toBeUndefined();
  });
});

// ─── Content rating mapping ───────────────────────────────────────────────────

describe('JikanMapper - Content Rating Mapping', () => {
  const cases: [string, string][] = [
    ['G - All Ages', 'TV-G'],
    ['PG - Children', 'TV-PG'],
    ['PG-13 - Teens 13 or older', 'TV-14'],
    ['R - 17+ (violence & profanity)', 'TV-MA'],
    ['R+ - Mild Nudity', 'TV-MA'],
    ['Rx - Hentai', 'XXX'],
  ];

  cases.forEach(([mal, plex]) => {
    it(`maps "${mal}" to "${plex}"`, () => {
      const result = mapper.mapAnimeToShow(makeAnime({ rating: mal }));
      expect(result.contentRating).toBe(plex);
    });
  });

  it('maps unknown rating to "NR"', () => {
    const result = mapper.mapAnimeToShow(makeAnime({ rating: 'Unknown Rating' }));
    expect(result.contentRating).toBe('NR');
  });
});

// ─── Adult content detection ──────────────────────────────────────────────────

describe('JikanMapper - Adult Content Detection', () => {
  it('marks Rx-rated anime as adult', () => {
    const result = mapper.mapAnimeToShow(makeAnime({ rating: 'Rx - Hentai' }));
    expect(result.isAdult).toBe(true);
  });

  it('marks anime with Hentai genre as adult', () => {
    const result = mapper.mapAnimeToShow(makeAnime({
      rating: 'R+ - Mild Nudity',
      genres: [{ mal_id: 12, type: 'anime', name: 'Hentai', url: '' }],
    }));
    expect(result.isAdult).toBe(true);
  });

  it('marks regular TV-14 anime as not adult', () => {
    const result = mapper.mapAnimeToShow(makeAnime({ rating: 'PG-13 - Teens 13 or older' }));
    expect(result.isAdult).toBe(false);
  });

  it('marks R-17+ anime as not adult', () => {
    const result = mapper.mapAnimeToShow(makeAnime({ rating: 'R - 17+ (violence & profanity)' }));
    expect(result.isAdult).toBe(false);
  });
});

// ─── Relations and collections ────────────────────────────────────────────────

describe('JikanMapper - Relations and Collections', () => {
  it('returns no collection when there are no relations', () => {
    const result = mapper.mapAnimeToShow(makeAnime({ relations: [] }));
    expect(result.Collection).toBeUndefined();
  });

  it('creates no collection from relations alone (collections come from the franchise list)', () => {
    const anime = makeAnime({
      mal_id: 200,
      title: 'Attack on Titan Season 2',
      relations: [{ relation: 'Prequel', entry: [{ mal_id: 100, type: 'anime', name: 'Attack on Titan', url: '' }] }],
    });
    expect(mapper.mapAnimeToShow(anime).Collection).toBeUndefined();
  });

  it('uses the resolved franchise group (key + name)', () => {
    const anime = makeAnime({ mal_id: 200, title: 'Attack on Titan Season 2' });
    const result = mapper.mapAnimeToShow(anime, { collection: { id: 100, root: null, name: 'Shingeki no Kyojin' } });
    expect(result.Collection).toHaveLength(1);
    expect(result.Collection![0].guid).toBe('mal-collection://100');
    expect(result.Collection![0].tag).toBe('Shingeki no Kyojin');
  });

  it('maps several collections for a crossover entry', () => {
    const anime = makeAnime({ mal_id: 5, title: "Kaginado" });
    const result = mapper.mapAnimeToShow(anime, {
      collection: [
        { id: 101, root: null, name: 'Air' },
        { id: 201, root: null, name: 'Kanon' },
      ],
    });
    expect(result.Collection!.map((c: any) => c.tag)).toEqual(['Air', 'Kanon']);
    expect(result.Collection!.map((c: any) => c.guid)).toEqual(['mal-collection://101', 'mal-collection://201']);
  });

  it('does NOT link side stories — they appear as independent shows', () => {
    const anime = makeAnime({
      relations: [
        {
          relation: 'Side story',
          entry: [{ mal_id: 999, type: 'anime', name: 'Related OVA', url: '' }],
        },
      ],
    });
    const result = mapper.mapAnimeToShow(anime);

    // Side stories have no sequel/prequel chain, so no collection is created
    expect(result.Collection).toBeUndefined();
  });

  it('does NOT link specials — they appear as independent shows', () => {
    const anime = makeAnime({
      relations: [
        {
          relation: 'Other',
          entry: [{ mal_id: 888, type: 'anime', name: 'Main Series Special', url: '' }],
        },
      ],
    });
    const result = mapper.mapAnimeToShow(anime);

    expect(result.Collection).toBeUndefined();
  });

  it('does NOT link alternative versions', () => {
    const anime = makeAnime({
      relations: [
        {
          relation: 'Alternative version',
          entry: [{ mal_id: 777, type: 'anime', name: 'Director\'s Cut', url: '' }],
        },
      ],
    });
    const result = mapper.mapAnimeToShow(anime);

    expect(result.Collection).toBeUndefined();
  });

  it('no collection from sequel + prequel relations alone (franchise list decides)', () => {
    const anime = makeAnime({
      mal_id: 200,
      relations: [
        {
          relation: 'Prequel',
          entry: [{ mal_id: 100, type: 'anime', name: 'Series Part 1', url: '' }],
        },
        {
          relation: 'Sequel',
          entry: [{ mal_id: 300, type: 'anime', name: 'Series Part 3', url: '' }],
        },
      ],
    });
    const result = mapper.mapAnimeToShow(anime);

    expect(result.Collection).toBeUndefined();
  });
});

// ─── Series name extraction ───────────────────────────────────────────────────

describe('JikanMapper - extractBaseSeriesName', () => {
  const m = mapper as any;

  it('strips "Season N" suffix', () => {
    expect(m.extractBaseSeriesName('Attack on Titan Season 2')).toBe('Attack on Titan');
  });

  it('strips ": Second Season" suffix', () => {
    expect(m.extractBaseSeriesName('No Game No Life: Second Season')).toBe('No Game No Life');
  });

  it('strips "Part N" suffix', () => {
    expect(m.extractBaseSeriesName('Jujutsu Kaisen Part 2')).toBe('Jujutsu Kaisen');
  });

  it('strips ordinal season suffix', () => {
    expect(m.extractBaseSeriesName('Sword Art Online 3rd Season')).toBe('Sword Art Online');
  });

  it('leaves standalone titles unchanged', () => {
    expect(m.extractBaseSeriesName('Cowboy Bebop')).toBe('Cowboy Bebop');
    expect(m.extractBaseSeriesName('Fullmetal Alchemist: Brotherhood')).toBe('Fullmetal Alchemist: Brotherhood');
  });
});
