import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { config } from '../config';
import { HttpError } from '../errors';
import { audit } from '../services/audit';
import { loginInput, password } from '../schemas';
import { COOKIE, cookieOptions, createSession, requireAuth, sha256 } from '../auth/middleware';

export const authRouter = Router();

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
// Hash ficticio para igualar tiempos cuando el correo no existe (evita enumerar usuarios).
const DUMMY = bcrypt.hashSync('no-existe', 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.isTest,
  message: { code: 'RATE_LIMIT', message: 'Demasiados intentos. Intente nuevamente más tarde.' },
});

const INVALID = new HttpError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password: pwd } = loginInput.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await bcrypt.compare(pwd, DUMMY);
    throw INVALID;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new HttpError(
      429,
      'LOCKED',
      `Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo en unos minutos.`,
    );
  }
  const ok = await bcrypt.compare(pwd, user.passwordHash);
  if (!ok || !user.active) {
    if (!ok) {
      const fails = user.failedLogins + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: fails >= MAX_FAILS ? 0 : fails,
          lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      await audit(prisma, { actorId: user.id, action: 'auth.login_failed', entity: 'User', entityId: user.id });
    }
    throw INVALID;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  const s = await createSession(user.id);
  await audit(prisma, { actorId: user.id, action: 'auth.login', entity: 'User', entityId: user.id });
  res.cookie(COOKIE, s.token, cookieOptions(s.expiresAt));
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    csrfToken: s.csrfToken,
  });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, csrfToken: req.csrfToken });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (token) await prisma.session.deleteMany({ where: { id: sha256(String(token)) } });
  res.clearCookie(COOKIE, cookieOptions());
  res.json({ ok: true });
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { current, next } = req.body ?? {};
  const newPwd = password.parse(next);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(String(current ?? ''), user.passwordHash))) {
    throw new HttpError(400, 'BAD_PASSWORD', 'La contraseña actual no es correcta.');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPwd, config.bcryptCost) },
  });
  // Cierra las demás sesiones
  const keep = sha256(String(req.cookies?.[COOKIE] ?? ''));
  await prisma.session.deleteMany({ where: { userId: user.id, NOT: { id: keep } } });
  await audit(prisma, { actorId: user.id, action: 'auth.change_password', entity: 'User', entityId: user.id });
  res.json({ ok: true });
});
