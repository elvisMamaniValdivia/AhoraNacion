import { Appointment, Channel, NotificationType, Prisma } from '@prisma/client';
import { prisma, Tx } from '../db';
import { config } from '../config';
import { Settings } from './settings';
import { MIN, formatLima } from '../utils/time';

const HOUR = 60 * MIN;
export const MAX_ATTEMPTS = 5;

/* ------------------------------------------------------------------ canales */

export interface OutboundMessage {
  to: string;
  subject: string;
  body: string;
}

/** Cada canal (correo, WhatsApp Business...) implementa esta interfaz. */
export interface ChannelProvider {
  channel: Channel;
  send(msg: OutboundMessage): Promise<void>;
}

class ConsoleEmail implements ChannelProvider {
  channel: Channel = 'EMAIL';
  sent: OutboundMessage[] = [];
  async send(msg: OutboundMessage) {
    this.sent.push(msg);
    if (!config.isTest) console.log(`[correo simulado] a=${msg.to} asunto="${msg.subject}"`);
  }
}

class ResendEmail implements ChannelProvider {
  channel: Channel = 'EMAIL';
  async send(msg: OutboundMessage) {
    const { Resend } = await import('resend');
    const client = new Resend(config.resendApiKey);
    const { error } = await client.emails.send({
      from: config.emailFrom,
      to: msg.to,
      subject: msg.subject,
      text: msg.body,
    });
    if (error) throw new Error(`Proveedor de correo: ${error.message}`);
  }
}

const providers = new Map<Channel, ChannelProvider>();
providers.set('EMAIL', config.emailProvider === 'resend' ? new ResendEmail() : new ConsoleEmail());
// WhatsApp Business: registrar aquí un ChannelProvider cuando se integre la API oficial:
// providers.set('WHATSAPP', new WhatsAppBusinessProvider(...));

export function registerProvider(p: ChannelProvider) {
  providers.set(p.channel, p);
}
export function getProvider(c: Channel) {
  return providers.get(c);
}

/* ------------------------------------------------------------ encolado */

const TYPE_LABEL: Record<NotificationType, string> = {
  CITA_CREADA: 'Nueva cita registrada',
  CITA_MODIFICADA: 'Cita modificada',
  CITA_CANCELADA: 'Cita cancelada',
  CITA_REPROGRAMADA: 'Cita reprogramada',
  RECORDATORIO: 'Recordatorio de cita',
};

function describe(a: Pick<Appointment, 'title' | 'startsAt' | 'endsAt' | 'place' | 'status' | 'modality'>) {
  return [
    `Compromiso: ${a.title}`,
    `Inicio: ${formatLima(a.startsAt)} (hora de Lima)`,
    `Fin: ${formatLima(a.endsAt)}`,
    `Lugar: ${a.place}`,
    `Modalidad: ${a.modality}`,
    `Estado: ${a.status}`,
  ].join('\n');
}

/** Usuarios activos que desean recibir este tipo por este canal (por defecto, todos). */
async function recipientsFor(db: Tx, type: NotificationType, channel: Channel) {
  const users = await db.user.findMany({
    where: { active: true },
    select: { id: true, email: true, name: true },
  });
  const prefs = await db.notificationPreference.findMany({ where: { type, channel } });
  const off = new Set(prefs.filter((p) => !p.enabled).map((p) => p.userId));
  return users.filter((u) => !off.has(u.id));
}

/** Avisos de creación / modificación / cancelación / reprogramación. El autor no se avisa a sí mismo. */
export async function enqueueEventNotifications(
  db: Tx,
  type: Exclude<NotificationType, 'RECORDATORIO'>,
  appt: Appointment,
  actor: { id: string; name: string },
  changes?: Record<string, unknown>,
  reason?: string,
): Promise<void> {
  const channel: Channel = 'EMAIL';
  const to = (await recipientsFor(db, type, channel)).filter((u) => u.id !== actor.id);
  const lines = [`${TYPE_LABEL[type]} por ${actor.name}.`, '', describe(appt)];
  if (reason) lines.push('', `Motivo: ${reason}`);
  if (changes && Object.keys(changes).length) {
    lines.push('', `Campos modificados: ${Object.keys(changes).join(', ')}`);
  }
  const version = appt.updatedAt.getTime();
  await db.notification.createMany({
    data: to.map((u) => ({
      appointmentId: appt.id,
      recipientId: u.id,
      type,
      channel,
      scheduledFor: new Date(),
      subject: `${TYPE_LABEL[type]}: ${appt.title}`,
      body: lines.join('\n'),
      // La clave única impide duplicar el mismo aviso aunque se reintente la operación.
      dedupeKey: `${type}:${appt.id}:${version}:${u.id}:${channel}`,
    })),
    skipDuplicates: true,
  });
}

/**
 * Mantiene los recordatorios programados de una cita. Borra los pendientes obsoletos
 * (cita cancelada / horario cambiado) y crea los nuevos. Idempotente.
 */
export async function syncReminders(
  db: Tx,
  appt: Pick<Appointment, 'id' | 'title' | 'startsAt' | 'endsAt' | 'place' | 'status' | 'modality'>,
  settings: Settings,
): Promise<void> {
  const channel: Channel = 'EMAIL';
  const active = appt.status === 'PENDIENTE' || appt.status === 'CONFIRMADA';
  const validPrefix = `RECORDATORIO:${appt.id}:${appt.startsAt.getTime()}:`;
  // Pendientes que ya no corresponden
  await db.notification.deleteMany({
    where: {
      appointmentId: appt.id,
      type: 'RECORDATORIO',
      status: 'PENDING',
      attempts: 0,
      ...(active ? { NOT: { dedupeKey: { startsWith: validPrefix } } } : {}),
    },
  });
  if (!active) return;
  const recipients = await recipientsFor(db, 'RECORDATORIO', channel);
  const now = Date.now();
  const rows: Prisma.NotificationCreateManyInput[] = [];
  for (const h of settings.reminderHours) {
    const when = new Date(appt.startsAt.getTime() - h * HOUR);
    if (when.getTime() <= now) continue;
    for (const u of recipients) {
      rows.push({
        appointmentId: appt.id,
        recipientId: u.id,
        type: 'RECORDATORIO',
        channel,
        scheduledFor: when,
        subject: `Recordatorio (${h} h antes): ${appt.title}`,
        body: `Recordatorio: su compromiso comienza en ${h} hora(s).\n\n${describe(appt)}`,
        dedupeKey: `${validPrefix}${h}:${u.id}:${channel}`,
      });
    }
  }
  if (rows.length) await db.notification.createMany({ data: rows, skipDuplicates: true });
}

/* --------------------------------------------------------------- envío */

interface Claimed {
  id: string;
  recipientId: string;
  appointmentId: string | null;
  type: NotificationType;
  channel: Channel;
  subject: string;
  body: string;
}

/**
 * Reclama notificaciones vencidas de forma segura ante varios procesos (FOR UPDATE SKIP LOCKED).
 * Aumenta `attempts` y marca `lastAttemptAt` como "arrendamiento": si otro worker corre a la vez,
 * no las tomará de nuevo hasta que pase la espera de reintento (2 min × intentos).
 */
async function claimDue(now: Date, limit: number): Promise<Claimed[]> {
  return prisma.$queryRaw<Claimed[]>`
    UPDATE "Notification" n
       SET "attempts" = n."attempts" + 1, "lastAttemptAt" = ${now}
     WHERE n.id IN (
       SELECT id FROM "Notification"
        WHERE "status" IN ('PENDING','FAILED')
          AND "scheduledFor" <= ${now}
          AND "attempts" < ${MAX_ATTEMPTS}
          AND ("lastAttemptAt" IS NULL
               OR "lastAttemptAt" < ${now} - ("attempts" * interval '2 minutes'))
        ORDER BY "scheduledFor"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
 RETURNING n.id, n."recipientId", n."appointmentId", n."type", n."channel", n."subject", n."body"`;
}

export interface ProcessResult {
  sent: number;
  failed: number;
  skipped: number;
}

export async function processDueNotifications(now = new Date(), limit = 25): Promise<ProcessResult> {
  const res: ProcessResult = { sent: 0, failed: 0, skipped: 0 };
  const batch = await claimDue(now, limit);
  for (const n of batch) {
    try {
      if (n.type === 'RECORDATORIO' && n.appointmentId) {
        const a = await prisma.appointment.findUnique({ where: { id: n.appointmentId } });
        if (!a || !['PENDIENTE', 'CONFIRMADA'].includes(a.status) || a.startsAt <= now) {
          await prisma.notification.update({
            where: { id: n.id },
            data: { status: 'FAILED', attempts: MAX_ATTEMPTS, error: 'Omitida: la cita ya no está vigente.' },
          });
          res.skipped++;
          continue;
        }
      }
      const user = await prisma.user.findUnique({ where: { id: n.recipientId } });
      if (!user || !user.active) throw new Error('Destinatario inactivo');
      const provider = getProvider(n.channel);
      if (!provider) throw new Error(`Canal ${n.channel} no configurado`);
      await provider.send({ to: user.email, subject: n.subject, body: n.body });
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: 'SENT', sentAt: new Date(), error: null },
      });
      res.sent++;
    } catch (e) {
      // Se registra el error (sin datos sensibles) y se reintentará con espera creciente.
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: 'FAILED', error: String((e as Error).message).slice(0, 300) },
      });
      res.failed++;
    }
  }
  return res;
}
