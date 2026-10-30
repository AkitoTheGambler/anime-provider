# Anime Metadata Provider for Plex

A Plex metadata provider for anime using MyAnimeList data (Jikan API v4 or the official MAL API v2) or AniDB.
In Plex it shows up as **Anime**.

## Docker

```bash
docker run -d --name anime-provider -p 3000:3000 \
  --env-file .env -v ./cache:/app/cache \
  akitothegambler/anime-provider:latest
```

or `docker compose up -d` with the included `docker-compose.yml`.

- Settings come from the environment (`--env-file .env`), the image contains no `.env`.
- `localhost` inside the container is the container itself: set `PLEX_URL` (and a
  self-hosted `JIKAN_BASE_URL`) to `http://host.docker.internal:…` or the machine's IP.
- `/app/cache` holds the AniDB cache and Fribb's lists; keep it on a volume so
  AniDB data isn't downloaded again after an update.
- With `PLEX_TOKEN` set, the provider registers itself in Plex on start (Settings →
  Metadata Agents). Set `PROVIDER_URL` to the address Plex reaches it under, e.g.
  `http://192.168.1.10:3000`; the default `http://localhost:3000` only works when
  Plex runs on the same machine outside Docker.
- Collection sync on demand: `docker exec anime-provider node dist/tools/syncCollections.js`

Build it yourself: `docker build -t anime-provider .`

## Features

- ✅ **Comprehensive Anime Metadata**: Titles, synopses, genres, studios, ratings, and more
- ✅ **Multi-Language Support**: English, Romaji, and Japanese title variants
- ✅ **Smart Title Matching**: Fuzzy search with scoring across all title variants
- ✅ **Rich Cast & Crew**: Voice actors, directors, producers, and staff information
- ✅ **Episode Details**: Complete episode listings with air dates and descriptions
- ✅ **Image Assets**: Posters, backgrounds, and promotional images
- ✅ **External ID Mapping**: MAL, AniList, AniDB, IMDB cross-references
- ✅ **Rate Limiting & Caching**: Respects Jikan API limits with aggressive caching
- ✅ **No API Key Required**: Uses free Jikan API (no authentication needed)

## Architecture

### Anime → Plex Structure Mapping

Unlike Western TV shows, anime follows a different structure:

```
MAL Anime Entry (e.g., "Attack on Titan Season 1")
  → Plex Show
    → Season 1 (always single season)
      → Episode 1, 2, 3... (all episodes for this MAL entry)
```

**Why single season?**
- Each MAL entry is a distinct entity
- Sequels/prequels are separate MAL entries
- Simplifies matching and avoids confusion

### Project Structure

```
anime-provider/
├── src/
│   ├── clients/
│   │   └── JikanClient.ts          # Jikan API wrapper with rate limiting
│   ├── config/
│   │   └── env.ts                  # Environment configuration
│   ├── mappers/
│   │   └── JikanMapper.ts          # Jikan → Plex metadata transformation
│   ├── models/
│   │   ├── MediaProvider.ts        # Plex provider models
│   │   └── Metadata.ts             # Plex metadata models
│   ├── providers/
│   │   └── AnimeProvider.ts        # MediaProvider definition
│   ├── routes/
│   │   └── animeRoutes.ts          # Express route handlers
│   ├── services/
│   │   ├── MetadataService.ts      # Metadata retrieval service
│   │   └── MatchService.ts         # Search/matching service
│   ├── types/
│   │   └── jikan.ts                # Jikan API TypeScript types
│   ├── utils/
│   │   ├── guid.ts                 # GUID construction utilities
│   │   └── logger.ts               # Winston logger
│   ├── constants.ts                # Shared constants
│   ├── app.ts                      # Express app setup
│   └── server.ts                   # Server entry point
├── test/                           # Jest tests
├── .env                            # Environment variables
├── package.json
├── tsconfig.json
└── README.md
```

## Installation

### Prerequisites

- Node.js 18+ and npm
- Plex Media Server

### Setup

1. **Clone and navigate to the project:**
   ```bash
   cd anime-provider
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   - The `.env` file is already created with default values
   - No API key required (Jikan is public)
   - Adjust settings if needed (port, caching, logging)

4. **Build the project:**
   ```bash
   npm run build
   ```

5. **Start the server:**
   ```bash
   npm start
   ```

   The server will start on `http://localhost:3000`

## Usage

### Testing the Provider

1. **Check Health:**
   ```bash
   curl http://localhost:3000/health
   ```

2. **Get Provider Definition:**
   ```bash
   curl http://localhost:3000/
   ```

3. **Search for Anime:**
   ```bash
   curl -X POST http://localhost:3000/library/metadata/matches \
     -H "Content-Type: application/json" \
     -d '{
       "type": 2,
       "title": "Death Note",
       "manual": 1
     }'
   ```

4. **Get Anime Metadata:**
   ```bash
   # Death Note (MAL ID: 1535)
   curl http://localhost:3000/library/metadata/mal-show-1535
   ```

5. **Get Episodes:**
   ```bash
   curl http://localhost:3000/library/metadata/mal-season-1535-1/children
   ```

### Registering with Plex

**Option 1: Using Plex API**
```bash
curl -X POST "http://YOUR_PLEX_SERVER:32400/media/providers/metadata?uri=http://localhost:3000" \
  -H "X-Plex-Token: YOUR_PLEX_TOKEN"
```

**Option 2: Via Plex Web UI**
1. Open Plex Settings → Agents
2. Add custom metadata agent
3. Enter provider URI: `http://localhost:3000`

### Creating an Anime Library

1. In Plex, create a new TV Shows library
2. In Advanced settings, select "Anime" as the agent
3. Add your anime folders
4. Plex will use the provider to match and fetch metadata

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Provider definition (MediaProvider) |
| `/health` | GET | Health check |
| `/library/metadata/{ratingKey}` | GET | Get metadata for item |
| `/library/metadata/{ratingKey}/children` | GET | Get children (seasons/episodes) |
| `/library/metadata/{ratingKey}/images` | GET | Get all images for item |
| `/library/metadata/matches` | POST | Search/match anime |

## Rating Key Format

```
Show:    mal-show-{mal_id}
Season:  mal-season-{mal_id}-1
Episode: mal-episode-{mal_id}-1-{episode_number}

Examples:
- mal-show-1535                  (Death Note)
- mal-season-1535-1              (Death Note Season 1)
- mal-episode-1535-1-5           (Death Note Episode 5)
```

## Configuration

### Environment Variables

See [`.env.example`](.env.example) for all available options.

**Key Settings:**
- `PORT`: Server port (default: 3000)
- `JIKAN_BASE_URL`: Jikan API base URL
- `JIKAN_RATE_LIMIT_PER_SECOND`: Request rate limit (default: 3)
- `CACHE_ANIME_DETAILS_HOURS`: Anime metadata cache duration (default: 24 hours)
- `LOG_LEVEL`: Logging level (debug, info, warn, error)

### Metadata Source (`METADATA_SOURCE`)

Switch the backend in `.env` and restart the provider:

| Value   | API                     | Needs                          | IDs / ratingKeys    | Notes |
|---------|-------------------------|--------------------------------|---------------------|-------|
| `jikan` | Jikan v4 (default)      | nothing                        | MAL → `mal-show-N`  | Full episodes, cast, staff |
| `mal`   | Official MAL API v2     | `MAL_CLIENT_ID`                | MAL → `mal-show-N`  | Pure MAL. API v2 has no episode/cast/staff endpoints → episodes are "Episode 1..N", no cast/crew, titles en/ja only |
| `anidb` | AniDB HTTP API          | `ANIDB_CLIENT` (+ version)     | AniDB → `anidb-show-N` | Native specials (S1, S2… → Season 0), localised titles (de/fr/es), tags as genres. Search runs locally on the daily titles dump. |

`jikan` ↔ `mal` can be switched freely (same IDs). Switching to/from `anidb`
changes every ratingKey, so refresh the library in Plex afterwards ("Refresh
all metadata", or "Fix Match" per show). AniDB responses are cached on disk in
`ANIDB_CACHE_DIR` and requests are spaced ≥ 2 s apart — AniDB bans clients that
flood it, so don't lower those limits.

### Per-item source selection

| Folder | Source |
|---|---|
| `Show (2024) {anidb-15910}` | AniDB (if `ANIDB_CLIENT` is set; otherwise the tag is translated to a MAL ID) |
| `Show {mal-34437}` | Jikan / MAL v2 |
| `Show (2006)` (no tag) | default `METADATA_SOURCE` |

If the tagged source finds nothing (or AniDB is unreachable), the default source
is tried next. Metadata requests are routed by the ratingKey prefix
(`anidb-…` → AniDB, `mal-…` → Jikan/MAL), so items matched earlier keep working
after changing `METADATA_SOURCE`. Collections use the matching franchise list
(AniDB or MAL IDs) and are named after the franchise's first entry.

### IDs in folder names

If a folder or file name contains an ID, the provider matches on it directly
(no title search, no year check):

```
Code Geass Fukkatsu no Lelouch (2019) {anidb-12566}/Season 01/...
Show [anidb-12566]      (Hama style)
Show {mal-34437}
Show {anilist-97880}
```

IDs from a different site than `METADATA_SOURCE` are translated with
[Fribb/anime-lists](https://github.com/Fribb/anime-lists) `anime-list-full.json`
(downloaded once a day, cached in `cache/collections/`), e.g. AniDB 12566 → MAL 34437.
A manual Fix Match lists the ID match first, followed by the title search results.

### Matching (`MATCH_SCORING`)

Same flow as the TMDB example provider:

1. One search request for a page of **20** results.
2. If Plex sends a year (always the show's / season entry's year from the folder,
   never an episode's), keep only entries that **first aired that year** — TMDB's
   `first_air_date_year`, same rule for shows, seasons and episodes.
   No entry from that year → no match, like the example.

   Server-side help where the API has it: Jikan's `start_date` means
   `aired.from >= date`, so searches send `start_date=YYYY-01-01` and the exact
   year is checked afterwards. MAL API v2 search has no date filter, and AniDB
   has no search API at all.
3. Return the best **1** (auto-match) or **5** (manual Fix Match).

`MATCH_SCORING=true` (default) re-ranks step 2's results — exact title on any
registered title (150) or fuzzy similarity (0-100), plus the MAL score as
tiebreaker; the top 5 scores are logged. `MATCH_SCORING=false` keeps the API's
own order, exactly like the example.

AniDB searches its local title dump (no dates in it), so instead of filtering it
fetches up to 3 near-equal candidates and prefers the one that first aired that year.

### Collections (`COLLECTIONS=true|false`)

MAL and AniDB store every season/part as its own entry, so each is its own Plex
show. With `COLLECTIONS=true` (default) shows are grouped using **only**
[Fribb/anime-lists](https://github.com/Fribb/anime-lists) franchise groups
(`collections/mal_collection.json` for `mal-…` shows, `anidb_collection.json`
for `anidb-…` shows; downloaded once a day, cached in `cache/collections/`).
The collection is keyed by the group's lowest ID and uses Fribb's group name.
Shows that are in no group get no collection.

Fribb builds the groups from anime-offline-database "related anime" links
(generator: `CollectionService.java` in Fribb/anime-lists-generator):

- only **mutual** links count (both entries list each other)
- entries with **more than 50** mutual links are removed (hubs like the original
  *Pokémon* TV series) — this can split a franchise into several groups
- groups with **more than 100** entries are dropped
- the group name is the title of the entry with the lowest ID

**Own lists** (`LISTS_DOWNLOAD=false`): the provider doesn't download anything and reads
`mal_collection.json`, `anidb_collection.json` and `anime-list-full.json` from
`cache/collections/`, e.g. copied from the anime-lists-generator output. A newly copied
file is picked up automatically, however old it is.

Check which group (= collection) a show is in, without any API calls:

```
npm run franchise -- mal 40881
npm run franchise -- anidb 14993
```

**Plex TV libraries ignore collections sent by a metadata provider** (Plex docs:
"currently only supported in movie libraries"). The provider therefore writes the
collections into Plex itself via the Plex API: set `PLEX_TOKEN` and `PLEX_LIBRARY`
in `.env`. It runs 2 minutes after start and every `COLLECTION_SYNC_HOURS`
(default 6), or on demand with `npm run sync-collections` (provider must be
running). Each show matched by this provider gets its franchise collection added;
existing collections stay. New collections get the franchise poster and summary.

### Rate Limiting

Jikan API limits:
- **3 requests per second**
- **60 requests per minute**

The provider automatically:
- Queues requests to respect limits
- Retries on 429 errors with exponential backoff
- Caches responses aggressively (24h for anime, 12h for episodes)

## Development

### Running in Development Mode

```bash
npm run dev
```

### Building

```bash
npm run build
```

### Running Tests

```bash
npm test
npm run test:watch
npm run test:coverage
```

### Type Checking

```bash
npx tsc --noEmit
```

## Title Matching

The provider uses sophisticated title matching to handle anime's multi-language nature:

1. **Exact Match** (highest priority): Normalized exact match across all title variants
2. **Starts With**: Title starts with search term
3. **Contains**: Title contains search term
4. **Fuzzy Match**: Levenshtein distance scoring
5. **Year Bonus**: Matches with correct year get priority
6. **Popularity Bonus**: Higher MAL scores get slight boost

**Title Normalization:**
- Removes special characters
- Lowercases
- Removes articles (the, a, an)
- Normalizes unicode (handles romaji variations)

**Example Matches:**
- "Shingeki no Kyojin" → "Attack on Titan" ✅
- "Re:Zero" → "Re Zero" ✅
- "Kimi no Na wa" → "Your Name" ✅

## Anime Type Handling

| MAL Type | Plex Structure | Episodes |
|----------|----------------|----------|
| TV | Show → Season 1 → Episodes | Multiple |
| Movie | Show → Season 1 → Episode 1 | Single (full movie) |
| OVA | Show → Season 1 → Episodes | Multiple |
| ONA | Show → Season 1 → Episodes | Multiple |
| Special | Show → Season 1 → Episodes | Multiple |

## Troubleshooting

### Provider not showing in Plex
- Ensure server is running on accessible port
- Check Plex can reach `http://localhost:3000`
- Verify provider URI is correct
- Check Plex logs for errors

### Rate limit errors
- Provider should handle automatically
- Check cache is working (logs show "Cache hit")
- Increase cache durations in `.env`

### Missing episode metadata
- Not all anime have detailed episode data in MAL
- Provider generates fallback titles ("Episode 1", etc.)
- Episodes without air dates marked as "TBA"

### Title matching not working
- Use manual search mode (`manual: 1`) for multiple results
- Try different title variants (English vs Romaji)
- Include year for disambiguation
- Check logs for match scores

## Credits

- **MyAnimeList**: Anime database
- **Jikan API**: Free MAL REST API by [@irfan](https://github.com/jikan-me/jikan)
- **Plex**: Media server platform

## License

MIT, see [LICENSE](LICENSE). Based on the TMDB Example Provider template (ISC), whose notice is included there.
