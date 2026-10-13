import { Router } from 'express';
import { prisma } from '../db';
import { HttpError } from '../errors';
import { requireRole } from '../auth/middleware';
import { settingsPatch } from '../schemas';
import { audit, diff } from '../services/audit';
import { getSettings, saveSettings } from '../services/settings';
import { isOverlapViolation } from '../services/scheduling';
import { syncReminders } from '../services/notifications';

export const settingsRouter = Router();

settingsRouter.get('/', async (_req, res) => {
  res.json(await getSettings());
});

settingsRouter.put('/', requireRole('ADMIN'), async (req, res) => {
  const patch = settingsPatch.parse(req.body);
  const before = await getSettings();
  try {
    await prisma.$transaction(async (tx) => {
      await saveSettings(tx, patch, req.user!.id);
      const after = await getSettings(tx);
      if (patch.marginMinutes !== undefined && patch.marginMinutes !== before.marginMinutes) {
        // Recalcula el intervalo protegido de las citas futuras vigentes. Si el nuevo margen
        // genera un solapamiento, la restricción EXCLUDE falla y todo se revierte.
        await tx.$executeRaw`
          UPDATE "Occupancy" o
             SET "endsAt" = a."endsAt" + make_interval(mins => ${patch.marginMinutes}::int)
            FROM "Appointment" a
           WHERE o."appointmentId" = a.id AND a."startsAt" > now()`;
      }
      if (patch.reminderHours) {
        const future = await tx.appointment.findMany({
          where: { startsAt: { gt: new Date() }, status: { in: ['PENDIENTE', 'CONFIRMADA'] } },
        });
        for (const a of future) await syncReminders(tx, a, after);
      }
      await audit(tx, {
        actorId: req.user!.id, action: 'settings.update', entity: 'SystemSetting', entityId: 'global',
        changes: diff(before as never, after as never, Object.keys(patch)),
      });
    });
  } catch (e) {
    if (isOverlapViolation(e)) {
      throw new HttpError(409, 'CONFLICT',
        'El nuevo margen entre citas genera cruces con citas ya programadas. Reprograme esas citas o elija un margen menor.');
    }
    throw e;
  }
  res.json(await getSettings());
});
