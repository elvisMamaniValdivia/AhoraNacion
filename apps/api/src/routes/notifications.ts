import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { notFound } from '../errors';
import { requireRole } from '../auth/middleware';
import { audit } from '../services/audit';
import { processDueNotifications, MAX_ATTEMPTS } from '../services/notifications';

export const notificationsRouter = Router();

/** Avisos del usuario actual (bandeja interna). */
notificationsRouter.get('/mine', async (req, res) => {
  res.json(
    await prisma.notification.findMany({
      where: { recipientId: req.user!.id },
      select: { id: true, type: true, subject: true, status: true, scheduledFor: true, sentAt: true, appointmentId: true },
      orderBy: { scheduledFor: 'desc' },
      take: 30,
    }),
  );
});

/** Administración: estado de envíos. */
notificationsRouter.get('/', requireRole('ADMIN'), async (req, res) => {
  const status = z.enum(['PENDING', 'SENT', 'FAILED']).optional().parse(req.query.status);
  res.json(
    await prisma.notification.findMany({
      where: status ? { status } : {},
      include: { recipient: { select: { name: true, email: true } } },
      orderBy: { scheduledFor: 'desc' },
      take: 200,
    }),
  );
});

/** Reintento manual controlado: reutiliza la misma fila, por lo que no puede duplicarse. */
notificationsRouter.post('/:id/retry', requireRole('ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n) throw notFound('La notificación no existe.');
  if (n.status === 'SENT') return void res.status(409).json({ code: 'ALREADY_SENT', message: 'Ya fue enviada.' });
  await prisma.notification.update({
    where: { id },
    data: { status: 'PENDING', attempts: Math.min(n.attempts, MAX_ATTEMPTS - 1), lastAttemptAt: null, scheduledFor: new Date() },
  });
  await audit(prisma, { actorId: req.user!.id, action: 'notification.retry', entity: 'Notification', entityId: id });
  await processDueNotifications();
  res.json(await prisma.notification.findUnique({ where: { id } }));
});

/** Preferencias: qué usuarios reciben cada tipo de aviso. */
const prefInput = z.object({
  userId: z.string(),
  type: z.enum(['CITA_CREADA', 'CITA_MODIFICADA', 'CITA_CANCELADA', 'CITA_REPROGRAMADA', 'RECORDATORIO']),
  channel: z.enum(['EMAIL', 'WHATSAPP']).default('EMAIL'),
  enabled: z.boolean(),
});

notificationsRouter.get('/preferences', requireRole('ADMIN'), async (_req, res) => {
  res.json(await prisma.notificationPreference.findMany());
});

notificationsRouter.put('/preferences', requireRole('ADMIN'), async (req, res) => {
  const p = prefInput.parse(req.body);
  const row = await prisma.notificationPreference.upsert({
    where: { userId_type_channel: { userId: p.userId, type: p.type, channel: p.channel } },
    create: p,
    update: { enabled: p.enabled },
  });
  await audit(prisma, { actorId: req.user!.id, action: 'notification.preference', entity: 'User', entityId: p.userId, changes: p });
  res.json(row);
});
