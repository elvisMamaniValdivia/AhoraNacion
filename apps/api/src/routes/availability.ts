import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { getSettings } from '../services/settings';
import {
  findConflicts, freeSlotsForDay, protectedEnd, suggestAlternatives, validateInterval,
} from '../services/scheduling';
import { fromLima } from '../utils/time';
import { HttpError } from '../errors';

export const availabilityRouter = Router();

/** Comprobación previa (frontend). La garantía definitiva siempre la da el servidor al guardar. */
availabilityRouter.get('/check', async (req, res) => {
  const q = z
    .object({
      startsAt: z.string().datetime({ offset: true }),
      endsAt: z.string().datetime({ offset: true }),
      excludeId: z.string().optional(),
    })
    .parse(req.query);
  const settings = await getSettings();
  const start = new Date(q.startsAt);
  const end = new Date(q.endsAt);
  validateInterval({ start, end }, settings, { isBlock: false });
  const exclude = q.excludeId ? { appointmentId: q.excludeId } : undefined;
  const conflicts = await findConflicts(prisma, start, protectedEnd(end, settings.marginMinutes, false), exclude);
  const alternatives = conflicts.length
    ? await suggestAlternatives(start, Math.round((end.getTime() - start.getTime()) / 60000), settings, { exclude })
    : [];
  res.json({ available: conflicts.length === 0, conflicts, alternatives, marginMinutes: settings.marginMinutes });
});

/** Horarios ocupados (citas y bloqueos) y libres de un día en hora de Lima. */
availabilityRouter.get('/day', async (req, res) => {
  const q = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      duration: z.coerce.number().int().min(5).max(720).default(30),
    })
    .parse(req.query);
  if (Number.isNaN(fromLima(q.date, 0).getTime())) throw new HttpError(400, 'BAD_DATE', 'Fecha no válida.');
  const settings = await getSettings();
  const dayStart = fromLima(q.date, 0);
  const dayEnd = fromLima(q.date, 24 * 60);
  const occ = await prisma.occupancy.findMany({
    where: { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
    include: {
      appointment: { select: { title: true, startsAt: true, endsAt: true } },
      block: { select: { title: true, startsAt: true, endsAt: true } },
    },
    orderBy: { startsAt: 'asc' },
  });
  res.json({
    date: q.date,
    marginMinutes: settings.marginMinutes,
    busy: occ.map((o) => {
      const src = o.appointment ?? o.block!;
      return { kind: o.kind, title: src.title, startsAt: src.startsAt, endsAt: src.endsAt, blockedUntil: o.endsAt };
    }),
    freeSlots: await freeSlotsForDay(q.date, q.duration, settings),
  });
});
