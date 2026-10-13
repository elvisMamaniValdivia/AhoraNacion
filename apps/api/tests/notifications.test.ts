import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { processDueNotifications, registerProvider, OutboundMessage, ChannelProvider } from '../src/services/notifications';
import { appt, loginAs, makeUser, resetDb, Client } from './helpers';

class Capture implements ChannelProvider {
  channel = 'EMAIL' as const;
  sent: OutboundMessage[] = [];
  fail = false;
  async send(m: OutboundMessage) {
    if (this.fail) throw new Error('Proveedor caído (simulado)');
    this.sent.push(m);
  }
}
const mail = new Capture();
registerProvider(mail);

let admin: Client, ana: Client;
const HOUR = 3600_000;
const iso = (t: number) => new Date(t).toISOString();
/** Cita 3 días a futuro, siempre dentro del horario de atención (12:00 Lima). */
const startsAt = () => {
  const d = new Date(Date.now() + 3 * 86400000);
  d.setUTCHours(17, 0, 0, 0); // 12:00 Lima
  return d.getTime();
};

beforeEach(async () => {
  await resetDb();
  mail.sent = [];
  mail.fail = false;
  await makeUser('Admin Prueba', 'ADMIN');
  await makeUser('Ana');
  await makeUser('Beto');
  admin = await loginAs('adminprueba@prueba.test');
  ana = await loginAs('ana@prueba.test');
});
afterAll(() => prisma.$disconnect());

describe('Notificaciones y recordatorios', () => {
  it('avisa al crear (a los demás usuarios, no al autor) y registra el resultado', async () => {
    const s = startsAt();
    await ana.post('/api/appointments', appt(iso(s), iso(s + HOUR))).expect(201);
    const r = await processDueNotifications(new Date());
    expect(r.sent).toBe(2); // admin y Beto
    expect(mail.sent.map((m) => m.to).sort()).toEqual(['adminprueba@prueba.test', 'beto@prueba.test']);
    const rows = await prisma.notification.findMany({ where: { type: 'CITA_CREADA' } });
    expect(rows.every((n) => n.status === 'SENT' && n.sentAt)).toBe(true);
  });

  it('11. los recordatorios (24 h y 1 h) no se envían duplicados, ni siquiera con procesos concurrentes', async () => {
    const s = startsAt();
    const c = await ana.post('/api/appointments', appt(iso(s), iso(s + HOUR))).expect(201);
    await processDueNotifications(new Date()); // vacía los avisos de creación
    mail.sent = [];
    const rem = await prisma.notification.findMany({ where: { type: 'RECORDATORIO', appointmentId: c.body.id } });
    expect(rem).toHaveLength(6); // 2 intervalos × 3 usuarios activos

    // Llega la hora del recordatorio de 24 h: dos procesos corren a la vez
    const t24 = new Date(s - 24 * HOUR + 60_000);
    const [a, b] = await Promise.all([processDueNotifications(t24), processDueNotifications(t24)]);
    expect(a.sent + b.sent).toBe(3);
    expect(mail.sent).toHaveLength(3);
    // ejecutar de nuevo no reenvía
    const again = await processDueNotifications(t24);
    expect(again.sent).toBe(0);
    expect(mail.sent).toHaveLength(3);

    // Recordatorio de 1 h
    const t1 = new Date(s - HOUR + 60_000);
    await processDueNotifications(t1);
    expect(mail.sent).toHaveLength(6);
    await processDueNotifications(t1);
    expect(mail.sent).toHaveLength(6);
    expect(await prisma.notification.count({ where: { type: 'RECORDATORIO', status: 'SENT' } })).toBe(6);
  });

  it('si el proveedor falla se registra el error y se reintenta sin duplicar', async () => {
    const s = startsAt();
    await ana.post('/api/appointments', appt(iso(s), iso(s + HOUR))).expect(201);
    mail.fail = true;
    const now = new Date();
    const r1 = await processDueNotifications(now);
    expect(r1.failed).toBe(2);
    const failed = await prisma.notification.findMany({ where: { type: 'CITA_CREADA' } });
    expect(failed.every((n) => n.status === 'FAILED' && n.attempts === 1 && n.error?.includes('caído'))).toBe(true);
    // aún dentro de la espera de reintento: no se vuelve a intentar
    expect((await processDueNotifications(new Date(now.getTime() + 30_000))).failed).toBe(0);
    // el proveedor se recupera y el reintento envía una sola vez
    mail.fail = false;
    const later = new Date(now.getTime() + 5 * 60_000);
    expect((await processDueNotifications(later)).sent).toBe(2);
    expect((await processDueNotifications(new Date(later.getTime() + 600_000))).sent).toBe(0);
    expect(mail.sent).toHaveLength(2);
  });

  it('cancelar elimina los recordatorios pendientes; reprogramar los recalcula', async () => {
    const s = startsAt();
    const c = await ana.post('/api/appointments', appt(iso(s), iso(s + HOUR))).expect(201);
    const r = await ana.post(`/api/appointments/${c.body.id}/reschedule`, {
      startsAt: iso(s + 2 * HOUR), endsAt: iso(s + 3 * HOUR), reason: 'Cambio',
    }).expect(201);
    expect(await prisma.notification.count({ where: { appointmentId: c.body.id, type: 'RECORDATORIO' } })).toBe(0);
    expect(await prisma.notification.count({ where: { appointmentId: r.body.id, type: 'RECORDATORIO' } })).toBe(6);
    await ana.post(`/api/appointments/${r.body.id}/cancel`, { reason: 'Ya no se realizará' }).expect(200);
    expect(await prisma.notification.count({ where: { appointmentId: r.body.id, type: 'RECORDATORIO', status: 'PENDING' } })).toBe(0);
  });

  it('respeta qué usuarios reciben cada tipo de aviso', async () => {
    const users = await admin.get('/api/users');
    const beto = users.body.find((u: { email: string }) => u.email === 'beto@prueba.test');
    await admin.put('/api/notifications/preferences', { userId: beto.id, type: 'CITA_CREADA', enabled: false }).expect(200);
    const s = startsAt();
    await ana.post('/api/appointments', appt(iso(s), iso(s + HOUR))).expect(201);
    await processDueNotifications(new Date());
    expect(mail.sent.map((m) => m.to)).toEqual(['adminprueba@prueba.test']);
  });

  it('el correo no incluye datos de contacto del solicitante', async () => {
    const s = startsAt();
    await ana.post('/api/appointments', appt(iso(s), iso(s + HOUR), { requesterPhone: '999 111 222', requesterEmail: 'x@prueba.test' })).expect(201);
    await processDueNotifications(new Date());
    expect(mail.sent.every((m) => !m.body.includes('999 111 222') && !m.body.includes('x@prueba.test'))).toBe(true);
  });
});
