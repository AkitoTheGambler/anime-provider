/**
 * Shows which franchise group(s) an anime belongs to (= its Plex collections).
 *
 *   npm run franchise -- mal 40881
 *   npm run franchise -- anidb 14993
 *
 * Uses the same lists as the provider: cache/collections/ (Fribb's, downloaded daily, or your own
 * with LISTS_DOWNLOAD=false).
 * No anime API calls.
 */

import fs from 'fs';
import path from 'path';
import { FranchiseList } from '../services/FranchiseCollections';
import { IdMapping } from '../services/IdMapping';
import { config } from '../config/env';

async function main() {
  const [type, idArg] = process.argv.slice(2);
  const id = parseInt(idArg, 10);
  if ((type !== 'mal' && type !== 'anidb') || isNaN(id)) {
    console.log('Usage: npm run franchise -- <mal|anidb> <id>   e.g. npm run franchise -- mal 40881');
    process.exit(1);
  }

  // load (and if needed download) both lists
  const download = config.collections.download;
  await new IdMapping({ download }).convert('mal', 1, 'anidb');
  const franchises = (await new FranchiseList({ idType: type, download }).findAll(id)).filter((f) => f.ids.length >= 2);

  const listFile = path.resolve('./cache/collections/anime-list-full.json');
  const entries: any[] = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : [];
  const field = type === 'mal' ? 'mal_id' : 'anidb_id';
  const byId = new Map<number, any>(entries.filter((e) => typeof e[field] === 'number').map((e) => [e[field], e]));
  const describe = (i: number) => {
    const e = byId.get(i) || {};
    const other = type === 'mal' ? `anidb ${e.anidb_id ?? '-'}` : `mal ${e.mal_id ?? '-'}`;
    return `${String(i).padStart(6)}  ${(e.type || '?').padEnd(8)} ${other.padEnd(12)} ${e['anime-planet_id'] || ''}`;
  };

  console.log(`\n${type} ${id}: ${describe(id).trim()}`);
  if (!franchises.length) {
    console.log('\n→ Not in any franchise group → no collection.');
    console.log('  Typical reasons (generator rules):');
    console.log('   - no mutual "related anime" link to another entry');
    console.log('   - it is a hub with more than 50 mutual links (removed before grouping)');
    console.log('   - its group would have more than 100 entries (dropped)');
    return;
  }
  if (franchises.length > 1) console.log(`\n→ Crossover entry: in ${franchises.length} collections`);
  for (const franchise of franchises) {
    console.log(`\n→ Collection "${franchise.name}"  (key ${type}-collection://${franchise.key}, ${franchise.ids.length} entries)\n`);
    console.log(`  ${'id'.padStart(6)}  ${'type'.padEnd(8)} ${(type === 'mal' ? 'anidb' : 'mal').padEnd(12)} anime-planet`);
    franchise.ids.forEach((i) => console.log(`  ${describe(i)}${i === id ? '   ◀' : ''}`));
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
