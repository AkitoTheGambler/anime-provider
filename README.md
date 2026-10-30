# Anime Metadata Provider for Plex

A Plex custom metadata provider for anime. Shows up in Plex as **Anime**.

| `METADATA_SOURCE` | Data from | Needs |
|---|---|---|
| `jikan` | MyAnimeList via [Jikan](https://jikan.moe) | nothing |
| `mal` | official MyAnimeList API v2 (no episode titles, no cast) | `MAL_CLIENT_ID` |
| `anidb` | AniDB HTTP API (specials, tags, localised titles) | a [registered client](https://anidb.net/software/add) in `ANIDB_CLIENT` |

## Setup

```bash
npm install
cp .env.example .env    # then fill in the settings
npm run build
npm start
```

Or with Docker:

```bash
docker run -d --name anime-provider -p 3000:3000 \
  --env-file .env -v ./cache:/app/cache \
  akitothegambler/anime-provider:latest
```

or `docker compose up -d`. Inside the container `localhost` is the container itself, so set
`PLEX_URL` (and a self-hosted `JIKAN_BASE_URL`) to the host's address.

## Plex

1. With `PLEX_TOKEN` set, the provider registers itself in Plex on start. `PROVIDER_URL` is
   the address Plex reaches it under (default `http://localhost:3000`, `PORT` is added when
   the URL has no port).
2. In Plex: **Settings → Metadata Agents → Add Agent**, choose **Anime** as the primary provider.
3. In the library: **Edit → Advanced → Agent**, choose that agent, then refresh the metadata.

## Matching

IDs in folder or file names are used directly, without a title search:

```
Code Geass (2019) {anidb-12566}
Show [anidb-12566]
Show {mal-34437}
Show {anilist-97880}
```

`{anidb-…}` folders use AniDB (if `ANIDB_CLIENT` is set), `{mal-…}` folders Jikan / MAL,
untagged folders `METADATA_SOURCE`. IDs of other sites are translated with Fribb's
`anime-list-full.json`. `MATCH_SCORING=true` re-ranks the search results by title and year
instead of keeping the API's order.

## Collections

Shows of one franchise (seasons, movies, OVAs, spin-offs) get one collection, from
[Fribb/anime-lists](https://github.com/Fribb/anime-lists) (`mal_collection.json` /
`anidb_collection.json`). Plex ignores provider collections in TV libraries, so the provider
writes them into Plex itself (needs `PLEX_TOKEN`): 2 minutes after start and every
`COLLECTION_SYNC_HOURS`.

The lists are downloaded into `cache/collections/` once a day. With `LISTS_DOWNLOAD=false`
nothing is downloaded and your own lists there are used, e.g. from
[anime-lists-generator](https://github.com/AkitoTheGambler/anime-lists-generator).

```bash
npm run sync-collections        # sync now (provider must be running)
npm run franchise -- mal 40881  # which collection a show is in
```

## AniDB

AniDB bans clients that ask too often. The provider sends at most one request every
`ANIDB_REQUEST_INTERVAL_MS` (min. 2000) and requests each anime at most once per
`ANIDB_CACHE_HOURS`. **Don't delete `cache/anidb/`**, it is what keeps it within those limits.

## Development

```bash
npm test
npm run dev
```

All settings with their possible values are in `.env.example`.

## License

MIT, see [LICENSE](LICENSE). Based on the TMDB Example Provider template (ISC), whose notice is included there.
