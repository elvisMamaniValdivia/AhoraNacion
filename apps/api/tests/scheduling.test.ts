import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { DAY, appt, at, loginAs, makeUser, resetDb, setMargin, Client } from './helpers';

let admin: Client, ana: Client, beto: Client;

beforeEach(async () => {
  await resetDb();
  await makeUser('Admin Prueba', 'ADMIN');
  await makeUser('Ana');
  await makeUser('Beto');
  admin = await loginAs('adminprueba@prueba.test');
  ana = await loginAs('ana@prueba.test');
  beto = await loginAs('beto@prueba.test');
});
afterAll(() => prisma.$disconnect());

describe('Prevención de conflictos horarios', () => {
  it('1. crea una cita en un horario libre', async () => {
    const r = await ana.post('/api/appointments', appt(at(10), at(10, 45)));
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('PENDIENTE');
    expect(r.body.createdById).toBe(ana.user.id);
  });

  it('2. rechaza una cita que comienza dentro de otra (10:00-10:45 vs 10:30-11:00) y propone alternativas', async () => {
    await ana.post('/api/appointments', appt(at(10), at(10, 45))).expect(201);
    const r = await beto.post('/api/appointments', appt(at(10, 30), at(11)));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CONFLICT');
    expect(r.body.message).toContain('no está disponible');
    expect(r.body.details.conflicts).toHaveLength(1);
    const alts = r.body.details.alternatives as { startsAt: string; endsAt: string }[];
    expect(alts.length).toBeGreaterThan(0);
    // la primera alternativa realmente se puede reservar
    const ok = await beto.post('/api/appointments', appt(alts[0].startsAt, alts[0].endsAt));
    expect(ok.status).toBe(201);
  });

  it('3. rechaza una cita que contiene completamente a otra', async () => {
    await ana.post('/api/appointments', appt(at(10), at(10, 30))).expect(201);
    const r = await beto.post('/api/appointments', appt(at(9, 30), at(11)));
    expect(r.status).toBe(409);
  });

  it('rechaza intervalos inválidos (fin anterior o igual al inicio)', async () => {
    const igual = await ana.post('/api/appointments', appt(at(10), at(10)));
    expect(igual.status).toBe(422);
    expect(igual.body.message).toContain('posterior');
    const antes = await ana.post('/api/appointments', appt(at(11), at(10)));
    expect(antes.status).toBe(422);
  });

  it('4. con margen 0, una cita que termina exactamente cuando comienza la siguiente se admite', async () => {
    await setMargin(admin, 0);
    await ana.post('/api/appointments', appt(at(10), at(10, 45))).expect(201);
    const r = await beto.post('/api/appointments', appt(at(10, 45), at(11, 30)));
    expect(r.status).toBe(201);
  });

  it('5. aplica el margen configurable (15 min por defecto) antes y después', async () => {
    await ana.post('/api/appointments', appt(at(10), at(10, 45))).expect(201);
    // 10 min después: rechazada
    expect((await beto.post('/api/appointments', appt(at(10, 55), at(11, 30)))).status).toBe(409);
    // exactamente 15 min después: admitida
    expect((await beto.post('/api/appointments', appt(at(11), at(11, 30)))).status).toBe(201);
    // antes: termina 10 min antes -> rechazada; 15 min antes -> admitida
    expect((await beto.post('/api/appointments', appt(at(9), at(9, 50)))).status).toBe(409);
    expect((await beto.post('/api/appointments', appt(at(9), at(9, 45)))).status).toBe(201);
  });

  it('5b. el administrador puede cambiar el margen y se aplica a nuevas citas', async () => {
    await setMargin(admin, 30);
    await ana.post('/api/appointments', appt(at(10), at(11))).expect(201);
    expect((await beto.post('/api/appointments', appt(at(11, 15), at(12)))).status).toBe(409);
    expect((await beto.post('/api/appointments', appt(at(11, 30), at(12)))).status).toBe(201);
  });

  it('6. las citas canceladas dejan de bloquear el horario', async () => {
    const a = await ana.post('/api/appointments', appt(at(10), at(11))).expect(201);
    expect((await beto.post('/api/appointments', appt(at(10), at(11)))).status).toBe(409);
    const c = await ana.post(`/api/appointments/${a.body.id}/cancel`, { reason: 'El solicitante canceló' });
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('CANCELADA');
    expect(c.body.cancelReason).toBe('El solicitante canceló');
    expect((await beto.post('/api/appointments', appt(at(10), at(11)))).status).toBe(201);
    // la cancelación exige motivo
    const b = await beto.post('/api/appointments', appt(at(14), at(15))).expect(201);
    expect((await beto.post(`/api/appointments/${b.body.id}/cancel`, {})).status).toBe(400);
    // y la cita sigue existiendo (no se borra)
    expect(await prisma.appointment.count({ where: { id: a.body.id } })).toBe(1);
  });

  it('reprogramar libera el horario original y deja una sola cita vigente', async () => {
    const a = await ana.post('/api/appointments', appt(at(10), at(11))).expect(201);
    const r = await ana.post(`/api/appointments/${a.body.id}/reschedule`, {
      startsAt: at(10, 30), endsAt: at(11, 30), reason: 'Cambio de agenda',
    });
    expect(r.status).toBe(201); // se solapa con su propio horario anterior: permitido
    expect(r.body.rescheduledFromId).toBe(a.body.id);
    const old = await prisma.appointment.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(old.status).toBe('REPROGRAMADA');
    expect(await prisma.occupancy.count()).toBe(1);
    // si el nuevo horario está ocupado, nada cambia
    await beto.post('/api/appointments', appt(at(15), at(16))).expect(201);
    const bad = await ana.post(`/api/appointments/${r.body.id}/reschedule`, {
      startsAt: at(15, 30), endsAt: at(16, 30), reason: 'x',
    });
    expect(bad.status).toBe(409);
    const still = await prisma.appointment.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(still.status).toBe('PENDIENTE');
    expect(await prisma.occupancy.count()).toBe(2);
  });

  it('7. editar una cita sin generar conflictos funciona; excluye a la propia cita', async () => {
    const a = await ana.post('/api/appointments', appt(at(10), at(11))).expect(201);
    // corrimiento que se solapa solo consigo misma
    const ok = await ana.patch(`/api/appointments/${a.body.id}`, { startsAt: at(10, 30), endsAt: at(11, 30), title: 'Nuevo título' });
    expect(ok.status).toBe(200);
    expect(ok.body.title).toBe('Nuevo título');
    // mover sobre otra cita: rechazado y sin cambios
    await beto.post('/api/appointments', appt(at(14), at(15))).expect(201);
    const bad = await ana.patch(`/api/appointments/${a.body.id}`, { startsAt: at(14, 30), endsAt: at(15, 30) });
    expect(bad.status).toBe(409);
    const unchanged = await prisma.appointment.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(unchanged.startsAt.toISOString()).toBe(at(10, 30));
    // el historial registra los campos modificados
    const h = await ana.get(`/api/appointments/${a.body.id}/history`);
    const upd = h.body.logs.find((l: { action: string }) => l.action === 'appointment.update');
    expect(Object.keys(upd.changes)).toEqual(expect.arrayContaining(['title', 'startsAt', 'endsAt']));
    expect(upd.actor.id).toBe(ana.user.id);
  });

  it('8. los bloqueos impiden reservar el periodo y participan de las mismas reglas', async () => {
    const b = await admin.post('/api/blocks', { type: 'ALMUERZO', title: 'Almuerzo', startsAt: at(13), endsAt: at(14) });
    expect(b.status).toBe(201);
    const r = await ana.post('/api/appointments', appt(at(13, 30), at(14, 15)));
    expect(r.status).toBe(409);
    expect(r.body.details.conflicts[0].kind).toBe('BLOCK');
    // un asistente no puede crear bloqueos
    expect((await ana.post('/api/blocks', { type: 'PERSONAL', title: 'x', startsAt: at(16), endsAt: at(17) })).status).toBe(403);
    // un bloqueo no puede crearse encima de una cita existente
    await ana.post('/api/appointments', appt(at(16), at(17))).expect(201);
    expect((await admin.post('/api/blocks', { type: 'VIAJE', title: 'Viaje', startsAt: at(16, 30), endsAt: at(18) })).status).toBe(409);
    // desactivar el bloqueo libera el horario
    await admin.del(`/api/blocks/${b.body.id}`).expect(200);
    expect((await ana.post('/api/appointments', appt(at(13, 30), at(14, 15)))).status).toBe(201);
  });

  it('9. dos usuarios que reservan simultáneamente el mismo horario no pueden confirmar ambas', async () => {
    const N = 12;
    const reqs = Array.from({ length: N }, (_, i) =>
      (i % 2 ? ana : beto).post('/api/appointments', appt(at(10), at(11), { title: `Simultánea ${i}` })),
    );
    const res = await Promise.all(reqs);
    const ok = res.filter((r) => r.status === 201).length;
    const conflict = res.filter((r) => r.status === 409).length;
    expect(ok).toBe(1);
    expect(conflict).toBe(N - 1);
    expect(await prisma.appointment.count()).toBe(1);
    expect(await prisma.occupancy.count()).toBe(1);
  });

  it('9b. horarios parcialmente solapados en paralelo: solo se confirman citas compatibles', async () => {
    // 6 solicitudes de 60 min que arrancan cada 20 min: como máximo caben pocas con margen de 15
    const starts = [0, 20, 40, 60, 80, 100].map((m) => [at(9, m), at(10, m)] as const);
    const res = await Promise.all(starts.map(([s, e], i) => (i % 2 ? ana : beto).post('/api/appointments', appt(s, e))));
    const confirmed = await prisma.appointment.findMany({ orderBy: { startsAt: 'asc' } });
    expect(res.filter((r) => r.status === 201).length).toBe(confirmed.length);
    for (let i = 1; i < confirmed.length; i++) {
      const gap = confirmed[i].startsAt.getTime() - confirmed[i - 1].endsAt.getTime();
      expect(gap).toBeGreaterThanOrEqual(15 * 60000); // nunca hay solapamiento ni margen violado
    }
    expect(confirmed.length).toBeGreaterThanOrEqual(1);
  });

  it('9c. la base de datos rechaza solapamientos aunque se salte la capa de la aplicación', async () => {
    const a = await ana.post('/api/appointments', appt(at(10), at(11))).expect(201);
    const other = await prisma.appointment.create({
      data: { title: 'directa', requesterName: 'x', place: 'x', startsAt: new Date(at(10, 30)), endsAt: new Date(at(11, 30)), createdById: ana.user.id },
    });
    await expect(
      prisma.occupancy.create({ data: { kind: 'APPOINTMENT', appointmentId: other.id, startsAt: new Date(at(10, 30)), endsAt: new Date(at(11, 30)) } }),
    ).rejects.toThrow();
    expect(await prisma.occupancy.count({ where: { appointmentId: a.body.id } })).toBe(1);
    // también un intervalo inválido
    await expect(
      prisma.$executeRawUnsafe(`INSERT INTO "Occupancy"(id,kind,"blockId","startsAt","endsAt") VALUES ('x','BLOCK','y',now(),now())`),
    ).rejects.toThrow();
  });

  it('cambiar el margen que generaría cruces se rechaza', async () => {
    await setMargin(admin, 0);
    await ana.post('/api/appointments', appt(at(10), at(11))).expect(201);
    await ana.post('/api/appointments', appt(at(11), at(12))).expect(201);
    const r = await admin.put('/api/settings', { marginMinutes: 15 });
    expect(r.status).toBe(409);
    const s = await admin.get('/api/settings');
    expect(s.body.marginMinutes).toBe(0);
  });
});

describe('Disponibilidad', () => {
  it('check devuelve conflictos y el día muestra ocupados/libres', async () => {
    await ana.post('/api/appointments', appt(at(10), at(11))).expect(201);
    const c = await beto.get(`/api/availability/check?startsAt=${encodeURIComponent(at(10, 30))}&endsAt=${encodeURIComponent(at(11, 30))}`);
    expect(c.body.available).toBe(false);
    expect(c.body.alternatives.length).toBeGreaterThan(0);
    const d = await beto.get(`/api/availability/day?date=${DAY}&duration=60`);
    expect(d.body.busy).toHaveLength(1);
    expect(d.body.freeSlots.some((s: { startsAt: string }) => s.startsAt === at(10))).toBe(false);
    expect(d.body.freeSlots.some((s: { startsAt: string }) => s.startsAt === at(12))).toBe(true);
  });
});
