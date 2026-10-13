import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { HttpError, forbidden } from '../errors';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      csrfToken?: string;
    }
  }
}

export const COOKIE = 'sid';
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  await prisma.session.create({ data: { id: sha256(token), userId, csrfToken, expiresAt } });
  return { token, csrfToken, expiresAt };
}

export function cookieOptions(expiresAt?: Date) {
  return {
    httpOnly: true,
    secure: config.isProd || config.cookieSameSite === 'none',
    sameSite: config.cookieSameSite,
    path: '/',
    ...(expiresAt ? { expires: expiresAt } : {}),
  } as const;
}

/** Carga la sesión del cookie. No exige autenticación: ver requireAuth. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (token) {
      const s = await prisma.session.findUnique({
        where: { id: sha256(String(token)) },
        include: { user: true },
      });
      if (s && s.expiresAt > new Date() && s.user.active) {
        req.user = { id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role };
        req.csrfToken = s.csrfToken;
      }
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED', 'Debe iniciar sesión.'));
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED', 'Debe iniciar sesión.'));
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/**
 * Protección CSRF: toda petición que modifica datos y viene con sesión debe enviar
 * el encabezado X-CSRF-Token igual al de la sesión (un sitio ajeno no puede leerlo).
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.user) return next(); // sin sesión no hay nada que proteger (login tiene su propio límite)
  const sent = req.get('x-csrf-token');
  const a = Buffer.from(sent ?? '');
  const b = Buffer.from(req.csrfToken ?? '');
  if (a.length === 0 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(new HttpError(403, 'CSRF', 'Solicitud rechazada por seguridad. Recargue la página.'));
  }
  next();
}
