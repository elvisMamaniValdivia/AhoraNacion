/** Datos ficticios de demostración. NO use datos reales de personas. */
import bcrypt from 'bcryptjs';
import 'dotenv/config';
import { prisma } from '../src/db';
import { createAppointment } from '../src/services/appointments';
import { fromLima, limaParts, MIN } from '../src/utils/time';

async function main() {
  const adminPwd = process.env.SEED_ADMIN_PASSWORD;
  const asstPwd = process.env.SEED_ASSISTANT_PASSWORD;
  if (!adminPwd || !asstPwd) throw new Error('Defina SEED_ADMIN_PASSWORD y SEED_ASSISTANT_PASSWORD en .env');
  const cost = Number(process.env.BCRYPT_COST ?? 12);

  const mk = async (name: string, email: string, role: 'ADMIN' | 'ASSISTANT', pwd: string) =>
    prisma.user.upsert({
      where: { email },
      update: {},
      create: { name, email, role, passwordHash: await bcrypt.hash(pwd, cost) },
    });
  const admin = await mk('Administrador Demo', 'admin@demo.test', 'ADMIN', adminPwd);
  const a1 = await mk('Asistente Uno', 'asistente1@demo.test', 'ASSISTANT', asstPwd);
  const a2 = await mk('Asistente Dos', 'asistente2@demo.test', 'ASSISTANT', asstPwd);
  await mk('Asistente Tres', 'asistente3@demo.test', 'ASSISTANT', asstPwd);

  if ((await prisma.appointment.count()) === 0) {
    const tomorrow = limaParts(new Date(Date.now() + 24 * 60 * MIN)).dateKey;
    const slot = (h: number, m: number, dur: number) => ({
      startsAt: new Date(fromLima(tomorrow, h * 60 + m)).toISOString(),
      endsAt: new Date(fromLima(tomorrow, h * 60 + m + dur)).toISOString(),
    });
    const base = { modality: 'PRESENCIAL' as const, priority: 'MEDIA' as const, activityType: 'REUNION' as const };
    await createAppointment(a1, { ...base, title: 'Reunión con gremio demo', requesterName: 'Gremio de Ejemplo S.A.', requesterEmail: 'contacto@ejemplo.test', place: 'Local de campaña, Av. Ejemplo 123', ...slot(9, 0, 45), status: 'CONFIRMADA' });
    await createAppointment(a2, { ...base, title: 'Entrevista radial demo', requesterName: 'Radio Ejemplo', place: 'Estudio Radio Ejemplo', activityType: 'ENTREVISTA', priority: 'ALTA', ...slot(11, 0, 60) });
    await createAppointment(admin, { ...base, title: 'Llamada con aliados demo', requesterName: 'Comité de Ejemplo', modality: 'TELEFONICA', place: 'Teléfono', activityType: 'LLAMADA', ...slot(15, 0, 30) });
    await prisma.scheduleBlock.create({
      data: { type: 'ALMUERZO', title: 'Almuerzo', createdById: admin.id, ...{ startsAt: new Date(slot(13, 0, 60).startsAt), endsAt: new Date(slot(13, 0, 60).endsAt) } },
    }).then((b) => prisma.occupancy.create({ data: { kind: 'BLOCK', blockId: b.id, startsAt: b.startsAt, endsAt: b.endsAt } }));
  }
  console.log('Seed completado (datos ficticios).');
}

main().finally(() => prisma.$disconnect());
