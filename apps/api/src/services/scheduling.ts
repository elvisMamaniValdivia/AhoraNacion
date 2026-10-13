import { prisma, Tx } from '../db';
import { HttpError, unprocessable } from '../errors';
import { Settings } from './settings';
import { MIN, fromLima, hhmm, limaParts, formatLima } from '../utils/time';

const GRID = 15 * MIN;

export interface Interval {
  start: Date;
  end: Date;
}

export type OwnerRef = { appointmentId?: string; blockId?: string };

/** Fin "protegido" de una cita: incluye el margen entre compromisos. Los bloqueos no llevan margen. */
export function protectedEnd(end: Date, marginMinutes: number, isBlock: boolean): Date {
  return new Date(end.getTime() + (isBlock ? 0 : marginMinutes) * MIN);
}

/** ¿El intervalo cae dentro del horario de atención (hora de Lima) y en un mismo día? */
export function withinWorkingHours(i: Interval, wh: Settings['workingHours']): boolean {
  const s = limaParts(i.start);
  const e = limaParts(i.end);
  let endMin = e.hour * 60 + e.minute;
  if (e.dateKey !== s.dateKey) {
    // Se admite terminar exactamente a medianoche (24:00) del mismo día.
    const midnight = fromLima(s.dateKey, 24 * 60);
    if (i.end.getTime() !== midnight.getTime()) return false;
    endMin = 24 * 60;
  }
  return (
    wh.days.includes(s.weekday) &&
    s.hour * 60 + s.minute >= hhmm(wh.start) &&
    endMin <= hhmm(wh.end)
  );
}

/** Validación de negocio de un intervalo. Lanza 422 con mensaje en español. */
export function validateInterval(
  i: Interval,
  settings: Settings,
  opts: { isBlock: boolean },
): void {
  if (Number.isNaN(i.start.getTime()) || Number.isNaN(i.end.getTime())) {
    throw unprocessable('Las fechas indicadas no son válidas.');
  }
  if (i.end.getTime() <= i.start.getTime()) {
    throw unprocessable('La hora de finalización debe ser posterior a la hora de inicio.');
  }
  if (opts.isBlock) return;
  const minutes = (i.end.getTime() - i.start.getTime()) / MIN;
  if (minutes < settings.minDurationMinutes) {
    throw unprocessable(
      `La duración mínima de una cita es de ${settings.minDurationMinutes} minutos.`,
    );
  }
  if (!withinWorkingHours(i, settings.workingHours)) {
    throw unprocessable(
      `La cita debe estar dentro del horario de atención (${settings.workingHours.start} a ${settings.workingHours.end}, hora de Lima) y terminar el mismo día.`,
    );
  }
}

export interface ConflictInfo {
  kind: 'APPOINTMENT' | 'BLOCK';
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

/** Busca ocupaciones que se solapan con [start, pEnd). Excluye la propia cita/bloqueo al editar. */
export async function findConflicts(
  db: Tx,
  start: Date,
  pEnd: Date,
  exclude?: OwnerRef,
): Promise<ConflictInfo[]> {
  const rows = await db.occupancy.findMany({
    where: {
      startsAt: { lt: pEnd },
      endsAt: { gt: start },
      ...(exclude?.appointmentId ? { NOT: { appointmentId: exclude.appointmentId } } : {}),
      ...(exclude?.blockId ? { NOT: { blockId: exclude.blockId } } : {}),
    },
    include: {
      appointment: { select: { id: true, title: true, startsAt: true, endsAt: true } },
      block: { select: { id: true, title: true, startsAt: true, endsAt: true } },
    },
    orderBy: { startsAt: 'asc' },
  });
  return rows.map((r) => {
    const o = r.appointment ?? r.block!;
    return {
      kind: r.kind,
      id: o.id,
      title: o.title,
      startsAt: o.startsAt.toISOString(),
      endsAt: o.endsAt.toISOString(),
    };
  });
}

/** Distingue la violación de la restricción EXCLUDE (carrera entre dos solicitudes). */
export function isOverlapViolation(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? '');
  const meta = JSON.stringify((e as { meta?: unknown })?.meta ?? '');
  return (
    msg.includes('occupancy_no_overlap') ||
    msg.includes('23P01') ||
    meta.includes('23P01') ||
    msg.includes('exclusion constraint')
  );
}

export class ConflictSignal extends Error {
  constructor(public conflicts: ConflictInfo[]) {
    super('conflict');
  }
}

/** Propone horarios libres cercanos (rejilla de 15 min) con la misma duración. */
export async function suggestAlternatives(
  desiredStart: Date,
  durationMinutes: number,
  settings: Settings,
  opts: { exclude?: OwnerRef; isBlock?: boolean; count?: number } = {},
): Promise<{ startsAt: string; endsAt: string }[]> {
  const count = opts.count ?? 3;
  const span = 3 * 24 * 60 * MIN;
  const lo = new Date(desiredStart.getTime() - span);
  const hi = new Date(desiredStart.getTime() + span + durationMinutes * MIN);
  const occ = await prisma.occupancy.findMany({
    where: {
      startsAt: { lt: hi },
      endsAt: { gt: lo },
      ...(opts.exclude?.appointmentId ? { NOT: { appointmentId: opts.exclude.appointmentId } } : {}),
      ...(opts.exclude?.blockId ? { NOT: { blockId: opts.exclude.blockId } } : {}),
    },
    select: { startsAt: true, endsAt: true },
  });
  const base = Math.round(desiredStart.getTime() / GRID) * GRID;
  const now = Date.now();
  const found: { startsAt: string; endsAt: string; dist: number }[] = [];
  const steps = span / GRID;
  for (let k = 1; k <= steps && found.length < count; k++) {
    for (const sign of [1, -1]) {
      if (found.length >= count) break;
      const s = new Date(base + sign * k * GRID);
      if (s.getTime() <= now) continue;
      const e = new Date(s.getTime() + durationMinutes * MIN);
      if (!withinWorkingHours({ start: s, end: e }, settings.workingHours)) continue;
      const pe = protectedEnd(e, settings.marginMinutes, !!opts.isBlock);
      if (occ.some((o) => o.startsAt < pe && o.endsAt > s)) continue;
      found.push({ startsAt: s.toISOString(), endsAt: e.toISOString(), dist: k });
    }
  }
  return found.map(({ startsAt, endsAt }) => ({ startsAt, endsAt }));
}

/** Construye la respuesta 409 con mensaje claro y alternativas. */
export async function conflictError(
  conflicts: ConflictInfo[],
  start: Date,
  end: Date,
  settings: Settings,
  opts: { exclude?: OwnerRef; isBlock?: boolean } = {},
): Promise<HttpError> {
  const dur = Math.round((end.getTime() - start.getTime()) / MIN);
  const alternatives = opts.isBlock
    ? []
    : await suggestAlternatives(start, dur, settings, { exclude: opts.exclude });
  const first = conflicts[0];
  const msg = first
    ? `El horario no está disponible: se cruza con «${first.title}» (${formatLima(new Date(first.startsAt))} a ${formatLima(new Date(first.endsAt))}). Se aplica un margen de ${settings.marginMinutes} minutos entre citas.`
    : 'El horario acaba de ser ocupado por otra solicitud. Elija otro horario.';
  return new HttpError(409, 'CONFLICT', msg, { conflicts, alternatives });
}

/**
 * Ejecuta una operación de reserva en una transacción. Si hay solapamiento (detectado por la
 * comprobación previa o por la restricción EXCLUDE ante una carrera), se revierte todo y se
 * responde 409 con alternativas. Nunca se confirma sin garantía de la base de datos.
 */
export async function bookTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  ctx: { start: Date; end: Date; settings: Settings; exclude?: OwnerRef; isBlock?: boolean },
): Promise<T> {
  try {
    return await prisma.$transaction(fn, { timeout: 15000 });
  } catch (e) {
    if (e instanceof ConflictSignal) {
      throw await conflictError(e.conflicts, ctx.start, ctx.end, ctx.settings, ctx);
    }
    if (isOverlapViolation(e)) {
      const pEnd = protectedEnd(ctx.end, ctx.settings.marginMinutes, !!ctx.isBlock);
      const conflicts = await findConflicts(prisma, ctx.start, pEnd, ctx.exclude);
      throw await conflictError(conflicts, ctx.start, ctx.end, ctx.settings, ctx);
    }
    throw e;
  }
}

/** Horas libres de un día (hora de Lima) para una duración dada. */
export async function freeSlotsForDay(
  dateKey: string,
  durationMinutes: number,
  settings: Settings,
  exclude?: OwnerRef,
): Promise<{ startsAt: string; endsAt: string }[]> {
  const dayStart = fromLima(dateKey, 0);
  const dayEnd = fromLima(dateKey, 24 * 60);
  const occ = await prisma.occupancy.findMany({
    where: {
      startsAt: { lt: dayEnd },
      endsAt: { gt: dayStart },
      ...(exclude?.appointmentId ? { NOT: { appointmentId: exclude.appointmentId } } : {}),
    },
    select: { startsAt: true, endsAt: true },
  });
  const out: { startsAt: string; endsAt: string }[] = [];
  const now = Date.now();
  for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += GRID) {
    const s = new Date(t);
    const e = new Date(t + durationMinutes * MIN);
    if (s.getTime() <= now) continue;
    if (!withinWorkingHours({ start: s, end: e }, settings.workingHours)) continue;
    const pe = protectedEnd(e, settings.marginMinutes, false);
    if (occ.some((o) => o.startsAt < pe && o.endsAt > s)) continue;
    out.push({ startsAt: s.toISOString(), endsAt: e.toISOString() });
  }
  return out;
}
