import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config';
import { processDueNotifications } from '../services/notifications';
import { HttpError } from '../errors';

export const workerRouter = Router();

/**
 * Disparador externo (Render Cron Job / cron-job.org) del proceso de recordatorios.
 * Requiere el encabezado `Authorization: Bearer <WORKER_SECRET>`.
 */
workerRouter.post('/run', async (req, res) => {
  const given = Buffer.from((req.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(config.workerSecret);
  if (!config.workerSecret || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new HttpError(401, 'UNAUTHORIZED', 'No autorizado.');
  }
  res.json(await processDueNotifications());
});
