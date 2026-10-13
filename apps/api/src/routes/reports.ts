import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireRole, requireAuth } from '../auth/middleware';
import { listQuery } from '../schemas';
import { audit } from '../services/audit';
import { buildWhere } from './appointments';
import { canModify, present } from '../services/appointments';
import { fromLima, limaParts, formatLima } from '../utils/time';

export const auditRouter = Router();
auditRouter.get('/', requireRole('ADMIN'), async (req, res) => {
  const q = z
    .object({
      entity: z.string().optional(),
      entityId: z.string().optional(),
      actorId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    })
    .parse(req.query);
  res.json(
    await prisma.auditLog.findMany({
      where: { entity: q.entity, entityId: q.entityId, actorId: q.actorId },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { at: 'desc' },
      take: q.limit,
    }),
  );
});

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const include = { participants: true, createdBy: { select: { id: true, name: true } } };

/** Pantalla principal: agenda del día, próximas, pendientes, cambios recientes y avisos. */
reportsRouter.get('/dashboard', async (req, res) => {
  const now = new Date();
  const today = limaParts(now).dateKey;
  const dayStart = fromLima(today, 0);
  const dayEnd = fromLima(today, 24 * 60);
  const active = { in: ['PENDIENTE', 'CONFIRMADA', 'REALIZADA'] as never };
  const [todayList, upcoming, pending, recent, notes, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart }, status: active }, include, orderBy: { startsAt: 'asc' } }),
    prisma.appointment.findMany({
      where: { startsAt: { gt: now }, status: { in: ['PENDIENTE', 'CONFIRMADA'] } }, include, orderBy: { startsAt: 'asc' }, take: 8 }),
    prisma.appointment.findMany({
      where: { startsAt: { gt: now }, status: 'PENDIENTE' }, include, orderBy: { startsAt: 'asc' }, take: 10 }),
    prisma.auditLog.findMany({
      where: { entity: 'Appointment' }, include: { actor: { select: { name: true } } }, orderBy: { at: 'desc' }, take: 10 }),
    prisma.notification.findMany({
      where: { recipientId: req.user!.id },
      select: { id: true, type: true, subject: true, status: true, scheduledFor: true, appointmentId: true },
      orderBy: { scheduledFor: 'desc' }, take: 8 }),
    prisma.scheduleBlock.findMany({ where: { active: true, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } }, orderBy: { startsAt: 'asc' } }),
  ]);
  const map = (l: typeof todayList) => l.map((a) => present(a, req.user!));
  res.json({
    now, today,
    todayAgenda: map(todayList),
    upcoming: map(upcoming),
    pendingConfirmation: map(pending),
    todayBlocks: blocks,
    recentChanges: recent,
    notifications: notes,
  });
});

/** Conteos por día/semana/mes en hora de Lima. */
reportsRouter.get('/summary', async (req, res) => {
  const q = z.object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    granularity: z.enum(['day', 'week', 'month']).default('day'),
  }).parse(req.query);
  const rows = await prisma.appointment.findMany({
    where: { startsAt: { gte: new Date(q.from), lt: new Date(q.to) } },
    select: { startsAt: true, status: true },
  });
  const keyOf = (d: Date) => {
    const p = limaParts(d);
    const pad = (n: number) => String(n).padStart(2, '0');
    if (q.granularity === 'month') return `${p.year}-${pad(p.month)}`;
    if (q.granularity === 'week') {
      const mondayShift = (p.weekday + 6) % 7;
      const monday = new Date(fromLima(p.dateKey, 0).getTime() - mondayShift * 86400000);
      return `Semana del ${limaParts(monday).dateKey}`;
    }
    return p.dateKey;
  };
  const buckets: Record<string, Record<string, number>> = {};
  const totals: Record<string, number> = {};
  for (const r of rows) {
    const k = keyOf(r.startsAt);
    buckets[k] ??= {};
    buckets[k][r.status] = (buckets[k][r.status] ?? 0) + 1;
    totals[r.status] = (totals[r.status] ?? 0) + 1;
  }
  res.json({ granularity: q.granularity, total: rows.length, totals, buckets });
});

const esc = (v: unknown) => {
  let s = v == null ? '' : String(v);
  // Evita inyección de fórmulas al abrir el CSV en Excel
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/** Exportación CSV: los datos de contacto solo salen en las citas que el usuario puede gestionar. */
reportsRouter.get('/export.csv', async (req, res) => {
  const q = listQuery.parse({ ...req.query, limit: req.query.limit ?? 1000 });
  const rows = await prisma.appointment.findMany({
    where: buildWhere(q), include, orderBy: { startsAt: 'asc' }, take: 1000,
  });
  const head = ['Título', 'Solicitante', 'Teléfono', 'Correo', 'Inicio (Lima)', 'Fin (Lima)', 'Lugar',
    'Modalidad', 'Estado', 'Prioridad', 'Tipo', 'Responsable', 'Motivo de cancelación', 'Motivo de reprogramación'];
  const lines = [head.map(esc).join(',')];
  for (const a of rows) {
    const see = canModify(req.user!, a);
    lines.push([
      a.title, a.requesterName, see ? a.requesterPhone : '(oculto)', see ? a.requesterEmail : '(oculto)',
      formatLima(a.startsAt), formatLima(a.endsAt), a.place, a.modality, a.status, a.priority,
      a.activityType, a.createdBy.name, a.cancelReason, a.rescheduleReason,
    ].map(esc).join(','));
  }
  await audit(prisma, {
    actorId: req.user!.id, action: 'report.export_csv', entity: 'Report', entityId: 'csv',
    changes: { filas: rows.length, filtros: req.query },
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="citas.csv"');
  res.send('\uFEFF' + lines.join('\r\n'));
});
