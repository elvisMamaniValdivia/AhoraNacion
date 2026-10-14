import { Prisma, Appointment, AppointmentParticipant, User } from '@prisma/client';
import { prisma, Tx } from '../db';
import { HttpError, forbidden, notFound, unprocessable } from '../errors';
import { audit, diff } from './audit';
import { getSettings } from './settings';
import {
  ConflictSignal,
  bookTransaction,
  findConflicts,
  protectedEnd,
  validateInterval,
} from './scheduling';
import { enqueueEventNotifications, syncReminders } from './notifications';
import { AppointmentInput, AppointmentPatch } from '../schemas';

export type Actor = Pick<User, 'id' | 'role' | 'name' | 'email'>;
type Full = Appointment & { participants: AppointmentParticipant[] };

const TRACKED = [
  'title', 'requesterName', 'requesterPhone', 'requesterEmail', 'description', 'startsAt',
  'endsAt', 'place', 'modality', 'meetingUrl', 'status', 'priority', 'activityType', 'notes',
];

export const ACTIVE_STATUSES = ['PENDIENTE', 'CONFIRMADA'] as const;
const EDITABLE = new Set<string>(ACTIVE_STATUSES);

export const canModify = (u: Actor, a: Pick<Appointment, 'createdById'>) =>
  u.role === 'ADMIN' || a.createdById === u.id;

/** Oculta datos de contacto a quien no administra la cita (mínimo privilegio). */
export function present(a: Full & { createdBy?: { id: string; name: string } }, u: Actor) {
  const seeContact = canModify(u, a);
  return {
    ...a,
    requesterPhone: seeContact ? a.requesterPhone : null,
    requesterEmail: seeContact ? a.requesterEmail : null,
    participants: a.participants.map((p) => ({ ...p, email: seeContact ? p.email : null })),
    canEdit: canModify(u, a) && EDITABLE.has(a.status),
    contactHidden: !seeContact,
  };
}

async function lock(tx: Tx, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Appointment" WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) throw notFound('La cita no existe.');
}

const include = { participants: true, createdBy: { select: { id: true, name: true } } };

export async function createAppointment(actor: Actor, input: AppointmentInput) {
  const settings = await getSettings();
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  validateInterval({ start, end }, settings, { isBlock: false });
  const pEnd = protectedEnd(end, settings.marginMinutes, false);

  const created = await bookTransaction(
    async (tx) => {
      const conflicts = await findConflicts(tx, start, pEnd);
      if (conflicts.length) throw new ConflictSignal(conflicts);
      const appt = await tx.appointment.create({
        data: {
          title: input.title,
          requesterName: input.requesterName,
          requesterPhone: input.requesterPhone ?? null,
          requesterEmail: input.requesterEmail ?? null,
          description: input.description ?? null,
          startsAt: start,
          endsAt: end,
          place: input.place?.trim() || 'Por coordinar',
          modality: input.modality ?? 'PRESENCIAL',
          meetingUrl: input.meetingUrl ?? null,
          status: input.status ?? 'PENDIENTE',
          priority: input.priority ?? 'MEDIA',
          activityType: input.activityType,
          notes: input.notes ?? null,
          createdById: actor.id,
          participants: { create: (input.participants ?? []).map((p) => ({ name: p.name, email: p.email ?? null })) },
        },
        include: { participants: true },
      });
      await tx.occupancy.create({
        data: { kind: 'APPOINTMENT', appointmentId: appt.id, startsAt: start, endsAt: pEnd },
      });
      await audit(tx, {
        actorId: actor.id,
        action: 'appointment.create',
        entity: 'Appointment',
        entityId: appt.id,
        changes: { title: appt.title, startsAt: appt.startsAt, endsAt: appt.endsAt, status: appt.status },
      });
      await enqueueEventNotifications(tx, 'CITA_CREADA', appt, actor);
      await syncReminders(tx, appt, settings);
      return appt;
    },
    { start, end, settings },
  );
  return created;
}

export async function updateAppointment(actor: Actor, id: string, patch: AppointmentPatch) {
  const settings = await getSettings();
  const current = await prisma.appointment.findUnique({ where: { id }, include: { participants: true } });
  if (!current) throw notFound('La cita no existe.');
  if (!canModify(actor, current)) throw forbidden('Solo puede modificar las citas que usted registró.');

  const newStart = patch.startsAt ? new Date(patch.startsAt) : current.startsAt;
  const newEnd = patch.endsAt ? new Date(patch.endsAt) : current.endsAt;
  const timeChanged =
    newStart.getTime() !== current.startsAt.getTime() || newEnd.getTime() !== current.endsAt.getTime();

  return bookTransaction(
    async (tx) => {
      await lock(tx, id);
      const before = await tx.appointment.findUniqueOrThrow({ where: { id }, include: { participants: true } });

      // Transiciones de estado permitidas
      if (patch.status && patch.status !== before.status) {
        const ok =
          EDITABLE.has(before.status) && ['PENDIENTE', 'CONFIRMADA', 'REALIZADA'].includes(patch.status);
        if (!ok) throw unprocessable(`No se puede cambiar el estado de «${before.status}» a «${patch.status}».`);
      }
      if (!EDITABLE.has(before.status)) {
        throw new HttpError(409, 'NOT_EDITABLE', 'Esta cita ya no admite cambios (cancelada, reprogramada o realizada).');
      }
      if (timeChanged && patch.status === 'REALIZADA') {
        throw unprocessable('No puede cambiar el horario al marcarla como realizada.');
      }

      if (timeChanged) {
        validateInterval({ start: newStart, end: newEnd }, settings, { isBlock: false });
        const pEnd = protectedEnd(newEnd, settings.marginMinutes, false);
        // Se excluye la propia cita para permitir cambios que no generen conflicto
        const conflicts = await findConflicts(tx, newStart, pEnd, { appointmentId: id });
        if (conflicts.length) throw new ConflictSignal(conflicts);
        await tx.occupancy.update({
          where: { appointmentId: id },
          data: { startsAt: newStart, endsAt: pEnd },
        });
      }


      const data: Prisma.AppointmentUpdateInput = {};
      const set = <K extends keyof AppointmentPatch>(k: K) => {
        if (patch[k] !== undefined) (data as Record<string, unknown>)[k] = patch[k] ?? null;
      };
      (['title', 'requesterName', 'requesterPhone', 'requesterEmail', 'description', 'place', 'modality',
        'meetingUrl', 'status', 'priority', 'activityType', 'notes'] as const).forEach(set);
      if (timeChanged) {
        data.startsAt = newStart;
        data.endsAt = newEnd;
      }
      if (patch.participants) {
        await tx.appointmentParticipant.deleteMany({ where: { appointmentId: id } });
        await tx.appointmentParticipant.createMany({
          data: patch.participants.map((p) => ({ appointmentId: id, name: p.name, email: p.email ?? null })),
        });
      }
      const after = await tx.appointment.update({ where: { id }, data, include: { participants: true } });
      const changes = diff(before as never, after as never, TRACKED);
      if (patch.participants) changes.participants = { de: before.participants.length, a: after.participants.length };
      if (Object.keys(changes).length) {
        await audit(tx, { actorId: actor.id, action: 'appointment.update', entity: 'Appointment', entityId: id, changes });
        await enqueueEventNotifications(tx, 'CITA_MODIFICADA', after, actor, changes);
        if (timeChanged) await syncReminders(tx, after, settings);
      }
      return after;
    },
    { start: newStart, end: newEnd, settings, exclude: { appointmentId: id } },
  );
}

export async function cancelAppointment(actor: Actor, id: string, reason: string) {
  const current = await prisma.appointment.findUnique({ where: { id } });
  if (!current) throw notFound('La cita no existe.');
  if (!canModify(actor, current)) throw forbidden('Solo puede cancelar las citas que usted registró.');
  return prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const before = await tx.appointment.findUniqueOrThrow({ where: { id } });
    if (!EDITABLE.has(before.status)) {
      throw new HttpError(409, 'NOT_EDITABLE', 'Solo pueden cancelarse citas pendientes o confirmadas.');
    }
    await tx.occupancy.deleteMany({ where: { appointmentId: id } }); // libera el horario
    const after = await tx.appointment.update({
      where: { id },
      data: { status: 'CANCELADA', cancelReason: reason },
      include: { participants: true },
    });
    await audit(tx, {
      actorId: actor.id,
      action: 'appointment.cancel',
      entity: 'Appointment',
      entityId: id,
      changes: { status: { de: before.status, a: 'CANCELADA' } },
      reason,
    });
    await enqueueEventNotifications(tx, 'CITA_CANCELADA', after, actor, undefined, reason);
    await syncReminders(tx, after, await getSettings(tx));
    return after;
  });
}

export async function rescheduleAppointment(
  actor: Actor,
  id: string,
  input: { startsAt: string; endsAt: string; reason: string },
) {
  const settings = await getSettings();
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  validateInterval({ start, end }, settings, { isBlock: false });
  const pEnd = protectedEnd(end, settings.marginMinutes, false);
  const current = await prisma.appointment.findUnique({ where: { id } });
  if (!current) throw notFound('La cita no existe.');
  if (!canModify(actor, current)) throw forbidden('Solo puede reprogramar las citas que usted registró.');

  return bookTransaction(
    async (tx) => {
      await lock(tx, id);
      const old = await tx.appointment.findUniqueOrThrow({ where: { id }, include: { participants: true } });
      if (!EDITABLE.has(old.status)) {
        throw new HttpError(409, 'NOT_EDITABLE', 'Solo pueden reprogramarse citas pendientes o confirmadas.');
      }
      // 1) libera el horario original (todo se revierte si el nuevo horario no está disponible)
      await tx.occupancy.deleteMany({ where: { appointmentId: id } });
      const conflicts = await findConflicts(tx, start, pEnd);
      if (conflicts.length) throw new ConflictSignal(conflicts);
      // 2) la original queda como REPROGRAMADA y no bloquea
      await tx.appointment.update({
        where: { id },
        data: { status: 'REPROGRAMADA', rescheduleReason: input.reason },
      });
      // 3) se crea la nueva cita vinculada
      const next = await tx.appointment.create({
        data: {
          title: old.title,
          requesterName: old.requesterName,
          requesterPhone: old.requesterPhone,
          requesterEmail: old.requesterEmail,
          description: old.description,
          startsAt: start,
          endsAt: end,
          place: old.place,
          modality: old.modality,
          meetingUrl: old.meetingUrl,
          status: old.status,
          priority: old.priority,
          activityType: old.activityType,
          notes: old.notes,
          createdById: old.createdById,
          rescheduledFromId: old.id,
          participants: { create: old.participants.map((p) => ({ name: p.name, email: p.email })) },
        },
        include: { participants: true },
      });
      await tx.occupancy.create({
        data: { kind: 'APPOINTMENT', appointmentId: next.id, startsAt: start, endsAt: pEnd },
      });
      await audit(tx, {
        actorId: actor.id,
        action: 'appointment.reschedule',
        entity: 'Appointment',
        entityId: id,
        changes: {
          startsAt: { de: old.startsAt, a: start },
          endsAt: { de: old.endsAt, a: end },
          nuevaCitaId: next.id,
        },
        reason: input.reason,
      });
      await audit(tx, {
        actorId: actor.id,
        action: 'appointment.create',
        entity: 'Appointment',
        entityId: next.id,
        changes: { reprogramadaDesde: id },
        reason: input.reason,
      });
      await enqueueEventNotifications(tx, 'CITA_REPROGRAMADA', next, actor, undefined, input.reason);
      await syncReminders(tx, { ...old, status: 'REPROGRAMADA' }, settings);
      await syncReminders(tx, next, settings);
      return next;
    },
    { start, end, settings },
  );
}
