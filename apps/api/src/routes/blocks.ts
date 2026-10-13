import { Router } from 'express';
import { prisma } from '../db';
import { notFound } from '../errors';
import { requireRole } from '../auth/middleware';
import { blockInput, blockPatch } from '../schemas';
import { audit, diff } from '../services/audit';
import { getSettings } from '../services/settings';
import {
  ConflictSignal, bookTransaction, findConflicts, validateInterval,
} from '../services/scheduling';

export const blocksRouter = Router();

blocksRouter.get('/', async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  res.json(
    await prisma.scheduleBlock.findMany({
      where: {
        active: true,
        ...(from ? { endsAt: { gt: from } } : {}),
        ...(to ? { startsAt: { lt: to } } : {}),
      },
      orderBy: { startsAt: 'asc' },
    }),
  );
});

blocksRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const input = blockInput.parse(req.body);
  const settings = await getSettings();
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  validateInterval({ start, end }, settings, { isBlock: true });
  const block = await bookTransaction(
    async (tx) => {
      // Un bloqueo no puede solaparse con citas ni con otros bloqueos
      const conflicts = await findConflicts(tx, start, end);
      if (conflicts.length) throw new ConflictSignal(conflicts);
      const b = await tx.scheduleBlock.create({
        data: { type: input.type, title: input.title, startsAt: start, endsAt: end, createdById: req.user!.id },
      });
      await tx.occupancy.create({ data: { kind: 'BLOCK', blockId: b.id, startsAt: start, endsAt: end } });
      await audit(tx, { actorId: req.user!.id, action: 'block.create', entity: 'ScheduleBlock', entityId: b.id,
        changes: { type: b.type, title: b.title, startsAt: b.startsAt, endsAt: b.endsAt } });
      return b;
    },
    { start, end, settings, isBlock: true },
  );
  res.status(201).json(block);
});

blocksRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const patch = blockPatch.parse(req.body);
  const settings = await getSettings();
  const before = await prisma.scheduleBlock.findUnique({ where: { id } });
  if (!before) throw notFound('El bloqueo no existe.');
  const start = patch.startsAt ? new Date(patch.startsAt) : before.startsAt;
  const end = patch.endsAt ? new Date(patch.endsAt) : before.endsAt;
  const active = patch.active ?? before.active;
  validateInterval({ start, end }, settings, { isBlock: true });
  const after = await bookTransaction(
    async (tx) => {
      await tx.occupancy.deleteMany({ where: { blockId: id } });
      if (active) {
        const conflicts = await findConflicts(tx, start, end);
        if (conflicts.length) throw new ConflictSignal(conflicts);
      }
      const b = await tx.scheduleBlock.update({
        where: { id },
        data: { type: patch.type, title: patch.title, startsAt: start, endsAt: end, active },
      });
      if (active) await tx.occupancy.create({ data: { kind: 'BLOCK', blockId: id, startsAt: start, endsAt: end } });
      await audit(tx, { actorId: req.user!.id, action: 'block.update', entity: 'ScheduleBlock', entityId: id,
        changes: diff(before as never, b as never, ['type', 'title', 'startsAt', 'endsAt', 'active']) });
      return b;
    },
    { start, end, settings, isBlock: true },
  );
  res.json(after);
});

/** "Eliminar" = desactivar: se conserva la trazabilidad. */
blocksRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const before = await prisma.scheduleBlock.findUnique({ where: { id } });
  if (!before) throw notFound('El bloqueo no existe.');
  await prisma.$transaction(async (tx) => {
    await tx.occupancy.deleteMany({ where: { blockId: id } });
    await tx.scheduleBlock.update({ where: { id }, data: { active: false } });
    await audit(tx, { actorId: req.user!.id, action: 'block.deactivate', entity: 'ScheduleBlock', entityId: id });
  });
  res.json({ ok: true });
});
