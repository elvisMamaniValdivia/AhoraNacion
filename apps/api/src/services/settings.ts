import { prisma, Tx } from '../db';

export interface Settings {
  /** Margen entre compromisos (minutos) */
  marginMinutes: number;
  minDurationMinutes: number;
  /** Horario de atención en hora de Lima */
  workingHours: { start: string; end: string; days: number[] };
  /** Horas antes de la cita para enviar recordatorios */
  reminderHours: number[];
  /** Tipos de notificación activos globalmente */
  notifyAdminsOnChanges: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  marginMinutes: 15,
  minDurationMinutes: 15,
  workingHours: { start: '06:00', end: '23:00', days: [0, 1, 2, 3, 4, 5, 6] },
  reminderHours: [24, 1],
  notifyAdminsOnChanges: true,
};

export async function getSettings(db: Tx = prisma): Promise<Settings> {
  const rows = await db.systemSetting.findMany();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as Settings;
}

export async function saveSettings(
  db: Tx,
  patch: Partial<Settings>,
  actorId: string,
): Promise<void> {
  for (const [key, value] of Object.entries(patch)) {
    await db.systemSetting.upsert({
      where: { key },
      create: { key, value: value as never, updatedById: actorId },
      update: { value: value as never, updatedById: actorId },
    });
  }
}
