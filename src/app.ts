/**
 * Express application setup
 */

import express, { Application } from 'express';
import animeRoutes from './routes/animeRoutes';
import logger from './utils/logger';
import { config } from './config/env';

/**
 * Creates and configures the Express application
 */
export function createApp(): Application {
  const app = express();

  // Request logging middleware
  app.use((req, _res, next) => {
    logger.info(`Incoming Request: ${req.method} ${req.path}`);
    next();
  });

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Routes - mount at root since this is the anime provider
  app.use('/', animeRoutes);

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', provider: 'Anime Metadata Provider', source: config.source });
  });

  return app;
}
