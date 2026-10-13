import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { config } from './config';
import { prisma } from './db';
import { HttpError } from './errors';
import { csrfGuard, loadSession, requireAuth } from './auth/middleware';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { appointmentsRouter } from './routes/appointments';
import { blocksRouter } from './routes/blocks';
import { availabilityRouter } from './routes/availability';
import { settingsRouter } from './routes/settings';
import { notificationsRouter } from './routes/notifications';
import { auditRouter, reportsRouter } from './routes/reports';
import { workerRouter } from './routes/worker';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(loadSession);
  app.use(csrfGuard);

  app.get('/health', (_req, res) => void res.json({ ok: true }));
  app.use('/api/worker', workerRouter); // protegido con secreto propio
  app.use('/api/auth', authRouter);
  app.get('/api/directory', requireAuth, async (_req, res) => {
    res.json(await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }));
  });
  app.use('/api/users', requireAuth, usersRouter);
  app.use('/api/appointments', requireAuth, appointmentsRouter);
  app.use('/api/blocks', requireAuth, blocksRouter);
  app.use('/api/availability', requireAuth, availabilityRouter);
  app.use('/api/settings', requireAuth, settingsRouter);
  app.use('/api/notifications', requireAuth, notificationsRouter);
  app.use('/api/audit', requireAuth, auditRouter);
  app.use('/api/reports', reportsRouter);

  app.use((_req, res) => void res.status(404).json({ code: 'NOT_FOUND', message: 'Ruta no encontrada.' }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const i of err.issues) fields[i.path.join('.') || '_'] ??= i.message;
      return void res.status(400).json({ code: 'VALIDATION', message: 'Revise los datos ingresados.', fields });
    }
    if (err instanceof HttpError) {
      return void res.status(err.status).json({ code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    if ((err as { type?: string })?.type === 'entity.parse.failed') {
      return void res.status(400).json({ code: 'BAD_JSON', message: 'El cuerpo de la solicitud no es JSON válido.' });
    }
    // No se expone información interna al cliente; solo se registra el mensaje.
    if (!config.isTest) console.error(`[error] ${req.method} ${req.path}:`, (err as Error)?.message);
    res.status(500).json({ code: 'INTERNAL', message: 'Ocurrió un error inesperado. Intente nuevamente.' });
  });
  return app;
}
