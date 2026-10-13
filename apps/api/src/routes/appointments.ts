import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { forbidden, notFound } from '../errors';
import {
  appointmentInput, appointmentPatch, cancelInput, listQuery, rescheduleInput,
} from '../schemas';
import {
  canModify, cancelAppointment, createAppointment, present, rescheduleAppointment,
  updateAppointment,
} from '../services/appointments';

export const appointmentsRouter = Router();

const include = { participants: true, createdBy: { select: { id: true, name: true } } };

export function buildWhere(q: ReturnType<typeof listQuery.parse>): Prisma.AppointmentWhereInput {
  const and: Prisma.AppointmentWhereInput[] = [];
  if (q.q) {
    and.push({
      OR: [
        { title: { contains: q.q, mode: 'insensitive' } },
        { requesterName: { contains: q.q, mode: 'insensitive' } },
        { place: { contains: q.q, mode: 'insensitive' } },
      ],
    });
  }
  if (q.from) and.push({ endsAt: { gt: new Date(q.from) } });
  if (q.to) and.push({ startsAt: { lt: new Date(q.to) } });
  if (q.status) {
    const list = q.status.split(',').filter((s) =>
      ['PENDIENTE', 'CONFIRMADA', 'REALIZADA', 'CANCELADA', 'REPROGRAMADA'].includes(s));
    if (list.length) and.push({ status: { in: list as never } });
  }
  if (q.activityType) and.push({ activityType: q.activityType });
  if (q.createdById) and.push({ createdById: q.createdById });
  if (q.place) and.push({ place: { contains: q.place, mode: 'insensitive' } });
  return { AND: and };
}

appointmentsRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  const rows = await prisma.appointment.findMany({
    where: buildWhere(q),
    include,
    orderBy: { startsAt: 'asc' },
    take: q.limit,
    skip: q.offset,
  });
  res.json(rows.map((r) => present(r, req.user!)));
});

appointmentsRouter.post('/', async (req, res) => {
  const input = appointmentInput.parse(req.body);
  const created = await createAppointment(req.user!, input);
  const full = await prisma.appointment.findUniqueOrThrow({ where: { id: created.id }, include });
  res.status(201).json(present(full, req.user!));
});

appointmentsRouter.get('/:id', async (req, res) => {
  const a = await prisma.appointment.findUnique({ where: { id: String(req.params.id) }, include });
  if (!a) throw notFound('La cita no existe.');
  res.json(present(a, req.user!));
});

appointmentsRouter.patch('/:id', async (req, res) => {
  const patch = appointmentPatch.parse(req.body);
  await updateAppointment(req.user!, String(req.params.id), patch);
  const full = await prisma.appointment.findUniqueOrThrow({ where: { id: String(req.params.id) }, include });
  res.json(present(full, req.user!));
});

appointmentsRouter.post('/:id/cancel', async (req, res) => {
  const { reason } = cancelInput.parse(req.body);
  await cancelAppointment(req.user!, String(req.params.id), reason);
  const full = await prisma.appointment.findUniqueOrThrow({ where: { id: String(req.params.id) }, include });
  res.json(present(full, req.user!));
});

appointmentsRouter.post('/:id/reschedule', async (req, res) => {
  const input = rescheduleInput.parse(req.body);
  const next = await rescheduleAppointment(req.user!, String(req.params.id), input);
  const full = await prisma.appointment.findUniqueOrThrow({ where: { id: next.id }, include });
  res.status(201).json(present(full, req.user!));
});

/** Historial: solo de las citas que el usuario puede gestionar (o todas si es administrador). */
appointmentsRouter.get('/:id/history', async (req, res) => {
  const id = String(req.params.id);
  const a = await prisma.appointment.findUnique({ where: { id } });
  if (!a) throw notFound('La cita no existe.');
  if (!canModify(req.user!, a)) throw forbidden('Solo puede ver el historial de sus propias citas.');
  const [logs, notifications] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entity: 'Appointment', entityId: id },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { at: 'asc' },
    }),
    prisma.notification.findMany({
      where: { appointmentId: id },
      select: { id: true, type: true, channel: true, status: true, attempts: true, sentAt: true, error: true, scheduledFor: true, recipient: { select: { name: true } } },
      orderBy: { scheduledFor: 'asc' },
    }),
  ]);
  res.json({ logs, notifications });
});
