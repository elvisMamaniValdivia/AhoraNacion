import bcrypt from 'bcryptjs';
import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma } from '../src/db';
import { createApp } from '../src/app';
import { fromLima, limaParts } from '../src/utils/time';

export const app = createApp();
export const PASSWORD = 'Prueba-Segura-1';

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Notification","NotificationPreference","AuditLog","Occupancy","AppointmentParticipant","Appointment","ScheduleBlock","Session","SystemSetting","User" CASCADE`,
  );
}

export async function makeUser(name: string, role: Role = 'ASSISTANT') {
  return prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase().replace(/\s+/g, '')}@prueba.test`,
      role,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
    },
  });
}

export async function loginAs(email: string) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  const csrf = r.body.csrfToken as string;
  return {
    agent,
    csrf,
    user: r.body.user as { id: string; role: Role; name: string },
    get: (u: string) => agent.get(u),
    post: (u: string, b?: object) => agent.post(u).set('x-csrf-token', csrf).send(b ?? {}),
    patch: (u: string, b?: object) => agent.patch(u).set('x-csrf-token', csrf).send(b ?? {}),
    put: (u: string, b?: object) => agent.put(u).set('x-csrf-token', csrf).send(b ?? {}),
    del: (u: string) => agent.delete(u).set('x-csrf-token', csrf),
  };
}
export type Client = Awaited<ReturnType<typeof loginAs>>;

/** Día de pruebas: 10 días a futuro, en hora de Lima. */
export const DAY = limaParts(new Date(Date.now() + 10 * 86400000)).dateKey;
/** ISO (UTC) de una hora de Lima del día de pruebas. */
export const at = (h: number, m = 0, day = DAY) => fromLima(day, h * 60 + m).toISOString();

export const appt = (startsAt: string, endsAt: string, over: Record<string, unknown> = {}) => ({
  title: 'Reunión de prueba',
  requesterName: 'Organización de Prueba',
  place: 'Oficina de prueba',
  startsAt,
  endsAt,
  ...over,
});

export async function setMargin(admin: Client, marginMinutes: number) {
  await admin.put('/api/settings', { marginMinutes }).expect(200);
}
