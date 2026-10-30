/**
 * LISTS_DOWNLOAD=false: the lists in cache/collections are read, nothing is downloaded
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { FranchiseList } from '../src/services/FranchiseCollections';
import { IdMapping } from '../src/services/IdMapping';

describe('lists without downloading', () => {
  let dir: string;
  const write = (name: string, content: any) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, JSON.stringify(content));
    // a different mtime even on coarse filesystems
    const t = new Date(Date.now() + Math.floor(Math.random() * 100000));
    fs.utimesSync(f, t, t);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lists-'));
    jest.spyOn(axios, 'get').mockRejectedValue(new Error('must not download'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads the franchise list from the cache folder and again when it changes', async () => {
    write('mal_collection.json', [{ name: 'Pokémon', ids: [527, 20, 209] }]);
    const list = new FranchiseList({ idType: 'mal', cacheDir: dir, download: false });
    expect((await list.find(209))?.name).toBe('Pokémon');

    write('mal_collection.json', [{ name: 'Pokémon (new)', ids: [20, 209] }]);
    expect((await list.find(209))?.name).toBe('Pokémon (new)');
    expect(await list.find(527)).toBeUndefined();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('a list older than a day is still used, not downloaded', async () => {
    write('anidb_collection.json', [{ name: 'Code Geass', ids: [4521, 5373] }]);
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    fs.utimesSync(path.join(dir, 'anidb_collection.json'), old, old);
    const list = new FranchiseList({ idType: 'anidb', cacheDir: dir, download: false });
    expect((await list.find(5373))?.name).toBe('Code Geass');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('without the file there are no collections and nothing is downloaded', async () => {
    const list = new FranchiseList({ idType: 'mal', cacheDir: dir, download: false });
    expect(await list.find(1)).toBeUndefined();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('reads the ID mapping list from the cache folder', async () => {
    write('anime-list-full.json', [{ mal_id: 5114, anidb_id: 6107 }]);
    const m = new IdMapping({ cacheDir: dir, download: false });
    expect(await m.convert('anidb', 6107, 'mal')).toBe(5114);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
