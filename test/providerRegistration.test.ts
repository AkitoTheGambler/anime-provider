/**
 * Provider registration against a fake Plex Media Server
 */
import http from 'http';
import { AddressInfo } from 'net';
import { PlexClient } from '../src/plex/PlexClient';
import { registerProvider } from '../src/plex/ProviderRegistration';

const ID = 'tv.plex.agents.custom.anime';

function fakePlex(providers: { id: number; identifier: string; title: string; uri: string }[]) {
  const writes: { method: string; path: string; uri: string | null }[] = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    if (req.method === 'GET' && u.pathname === '/media/providers/metadata') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ MediaContainer: { MetadataAgentProvider: providers } }));
    }
    writes.push({ method: req.method!, path: u.pathname, uri: u.searchParams.get('uri') });
    res.writeHead(200);
    res.end();
  });
  return { server, writes };
}

async function run(providers: any[], uri = 'http://localhost:3000') {
  const { server, writes } = fakePlex(providers);
  await new Promise<void>((r) => server.listen(0, () => r()));
  try {
    const plex = new PlexClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'SECRET');
    const result = await registerProvider({ plex, uri, identifier: ID, title: 'Anime' });
    return { result, writes };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe('registering the provider with Plex', () => {
  it('adds the provider when Plex doesn\'t know it', async () => {
    const { result, writes } = await run([{ id: 1, identifier: 'tv.plex.agents.custom.tmdb', title: 'TMDB', uri: 'http://localhost:4000' }]);
    expect(result).toBe('added');
    expect(writes).toEqual([{ method: 'POST', path: '/media/providers/metadata', uri: 'http://localhost:3000' }]);
  });

  it('adds a new entry after the identifier changed and leaves the old one (Plex can\'t change identifiers)', async () => {
    const { result, writes } = await run([{ id: 7, identifier: 'tv.plex.agents.custom.mal', title: 'MyAnimeList Anime Provider', uri: 'http://localhost:3000/' }]);
    expect(result).toBe('added');
    expect(writes).toEqual([{ method: 'POST', path: '/media/providers/metadata', uri: 'http://localhost:3000' }]);
  });

  it('updates the title of its own entry', async () => {
    const { result, writes } = await run([{ id: 4, identifier: ID, title: 'Old name', uri: 'http://localhost:3000' }]);
    expect(result).toBe('updated');
    expect(writes).toEqual([{ method: 'PUT', path: '/media/providers/metadata/4', uri: 'http://localhost:3000' }]);
  });

  it('updates the entry with the same identifier when the URL changed', async () => {
    const { result, writes } = await run([{ id: 3, identifier: ID, title: 'Anime', uri: 'http://old-host:3000' }], 'http://192.168.1.10:3000');
    expect(result).toBe('updated');
    expect(writes).toEqual([{ method: 'PUT', path: '/media/providers/metadata/3', uri: 'http://192.168.1.10:3000' }]);
  });

  it('changes nothing when the entry is up to date', async () => {
    const { result, writes } = await run([{ id: 7, identifier: ID, title: 'Anime', uri: 'http://LOCALHOST:3000' }]);
    expect(result).toBe('unchanged');
    expect(writes).toEqual([]);
  });
});
