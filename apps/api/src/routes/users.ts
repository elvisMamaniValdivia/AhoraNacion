import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { config } from '../config';
import { HttpError, notFound } from '../errors';
import { audit, diff } from '../services/audit';
import { userCreate, userPatch } from '../schemas';
import { requireRole } from '../auth/middleware';

export const usersRouter = Router();
usersRouter.use(requireRole('ADMIN'));

const safe = { id: true, name: true, email: true, role: true, active: true, createdAt: true };

usersRouter.get('/', async (_req, res) => {
  res.json(await prisma.user.findMany({ select: safe, orderBy: { createdAt: 'asc' } }));
});

usersRouter.post('/', async (req, res) => {
  const input = userCreate.parse(req.body);
  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw new HttpError(409, 'EMAIL_TAKEN', 'Ya existe un usuario con ese correo.');
  }
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      role: input.role,
      passwordHash: await bcrypt.hash(input.password, config.bcryptCost),
    },
    select: safe,
  });
  await audit(prisma, {
    actorId: req.user!.id, action: 'user.create', entity: 'User', entityId: user.id,
    changes: { email: user.email, role: user.role },
  });
  res.status(201).json(user);
});

usersRouter.patch('/:id', async (req, res) => {
  const id = String(req.params.id);
  const patch = userPatch.parse(req.body);
  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) throw notFound('El usuario no existe.');
  if (id === req.user!.id && (patch.active === false || (patch.role && patch.role !== 'ADMIN'))) {
    throw new HttpError(400, 'SELF_LOCKOUT', 'No puede desactivarse ni quitarse el rol de administrador a sí mismo.');
  }
  const { password: pwd, ...rest } = patch;
  const after = await prisma.user.update({
    where: { id },
    data: { ...rest, ...(pwd ? { passwordHash: await bcrypt.hash(pwd, config.bcryptCost) } : {}) },
    select: safe,
  });
  if (patch.active === false || pwd || (patch.role && patch.role !== before.role)) {
    await prisma.session.deleteMany({ where: { userId: id } }); // cierra sesiones activas
  }
  const changes = diff(before as never, after as never, ['name', 'active', 'role']);
  if (pwd) (changes as Record<string, unknown>).password = 'restablecida';
  await audit(prisma, { actorId: req.user!.id, action: 'user.update', entity: 'User', entityId: id, changes });
  res.json(after);
});
