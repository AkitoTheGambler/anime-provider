/**
 * Integration tests for Match routes
 * Hits the real Jikan API (no key required).
 * Run with: RUN_INTEGRATION_TESTS=true npx jest matchRoutes
 */

import request from 'supertest';
import { createApp } from '../src/app';
import { ANIME_PROVIDER_IDENTIFIER } from '../src/constants';

const SKIP_TESTS = process.env.RUN_INTEGRATION_TESTS !== 'true';

describe('Match Routes', () => {
  const app = createApp();

  if (SKIP_TESTS) {
    it.skip('skipping integration tests - set RUN_INTEGRATION_TESTS=true to run', () => {});
    return;
  }

  describe('POST /library/metadata/matches', () => {
    it('should return 200 for valid show match request', async () => {
      const response = await request(app)
        .post('/library/metadata/matches')
        .send({ type: 2, title: 'Cowboy Bebop', year: 1998 });

      expect(response.status).toBe(200);
    }, 15000);

    it('should return MediaContainer structure', async () => {
      const response = await request(app)
        .post('/library/metadata/matches')
        .send({ type: 2, title: 'Cowboy Bebop' });

      expect(response.body).toHaveProperty('MediaContainer');
      expect(response.body.MediaContainer).toHaveProperty('offset');
      expect(response.body.MediaContainer).toHaveProperty('totalSize');
      expect(response.body.MediaContainer).toHaveProperty('identifier');
      expect(response.body.MediaContainer).toHaveProperty('size');
      expect(response.body.MediaContainer).toHaveProperty('Metadata');
    }, 15000);

    it('should return show metadata for Cowboy Bebop', async () => {
      const response = await request(app)
        .post('/library/metadata/matches')
        .send({ type: 2, title: 'Cowboy Bebop' });

      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
      const metadata = response.body.MediaContainer.Metadata[0];

      expect(metadata.type).toBe('show');
      expect(metadata.title).toBeDefined();
      expect(metadata.ratingKey).toMatch(/^mal-show-\d+$/);
      expect(metadata.guid).toContain(`${ANIME_PROVIDER_IDENTIFIER}://show/`);
    }, 15000);

    it('should include MAL external Guid', async () => {
      const response = await request(app)
        .post('/library/metadata/matches')
        .send({ type: 2, title: 'Death Note' });

      const metadata = response.body.MediaContainer.Metadata[0];
      expect(metadata.Guid).toBeDefined();
      expect(metadata.Guid.length).toBeGreaterThan(0);

      const hasMal = metadata.Guid.some((g: any) => g.id.startsWith('mal://'));
      expect(hasMal).toBe(true);
    }, 15000);

    it('should match show by MAL external GUID', async () => {
      const response = await request(app)
        .post('/library/metadata/matches')
        .send({ type: 2, guid: 'mal://1' }); // Cowboy Bebop

      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
      const metadata = response.body.MediaContainer.Metadata[0];
      expect(metadata.ratingKey).toBe('mal-show-1');
    }, 15000);

    it('should return multiple matches when manual=1', async () => {
      const response = await request(app)
        .post('/library/metadata/matches')
        .send({ type: 2, title: 'Naruto', manual: 1 });

      expect(response.body.MediaContainer.size).toBeGreaterThanOrEqual(1);
      expect(response.body.MediaContainer.size).toBeLessThanOrEqual(5);
    }, 15000);

    it('should return empty results for non-existent show', async () => {
      const response = await request(app)
        .post('/library/metadata/matches')
        .send({ type: 2, title: 'NonExistentAnimeWithVeryUniqueName99999' });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBe(0);
      expect(response.body.MediaContainer.Metadata).toHaveLength(0);
    }, 15000);

    it('should return 500 for unsupported type', async () => {
      const response = await request(app)
        .post('/library/metadata/matches')
        .send({ type: 1, title: 'Some Movie' }); // movie type - not supported

      expect(response.status).toBe(500);
    }, 15000);

    it('should match season by parent title', async () => {
      const response = await request(app)
        .post('/library/metadata/matches')
        .send({ type: 3, parentTitle: 'Fullmetal Alchemist: Brotherhood', index: 1 });

      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
      const metadata = response.body.MediaContainer.Metadata[0];

      expect(metadata.type).toBe('season');
      expect(metadata.index).toBe(1);
      expect(metadata.parentRatingKey).toBeDefined();
      expect(metadata.parentGuid).toContain(`${ANIME_PROVIDER_IDENTIFIER}://show/`);
    }, 15000);

    it('should match episode by grandparent title and indices', async () => {
      const response = await request(app)
        .post('/library/metadata/matches')
        .send({
          type: 4,
          grandparentTitle: 'Cowboy Bebop',
          parentIndex: 1,
          index: 1,
        });

      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
      const metadata = response.body.MediaContainer.Metadata[0];

      expect(metadata.type).toBe('episode');
      expect(metadata.index).toBe(1);
      expect(metadata.parentIndex).toBe(1);
      expect(metadata.grandparentRatingKey).toBeDefined();
      expect(metadata.grandparentGuid).toContain(`${ANIME_PROVIDER_IDENTIFIER}://show/`);
    }, 20000);

    it('should include proper parent relationships for seasons', async () => {
      const response = await request(app)
        .post('/library/metadata/matches')
        .send({ type: 3, parentTitle: 'Cowboy Bebop', index: 1 });

      const metadata = response.body.MediaContainer.Metadata[0];
      expect(metadata.parentRatingKey).toBeDefined();
      expect(metadata.parentGuid).toBeDefined();
      expect(metadata.parentType).toBe('show');
      expect(metadata.parentTitle).toBeDefined();
    }, 15000);

    it('should include proper parent and grandparent relationships for episodes', async () => {
      const response = await request(app)
        .post('/library/metadata/matches')
        .send({
          type: 4,
          grandparentTitle: 'Death Note',
          parentIndex: 1,
          index: 1,
        });

      const metadata = response.body.MediaContainer.Metadata[0];

      expect(metadata.parentRatingKey).toBeDefined();
      expect(metadata.parentGuid).toBeDefined();
      expect(metadata.parentType).toBe('season');

      expect(metadata.grandparentRatingKey).toBeDefined();
      expect(metadata.grandparentGuid).toBeDefined();
      expect(metadata.grandparentType).toBe('show');
    }, 20000);
  });
});
