import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db';
import { app, appt, at, loginAs, makeUser, resetDb, PASSWORD, Client } from './helpers';

let admin: Client, ana: Client, beto: Client;
let apptId: string;

beforeEach(async () => {
  await resetDb();
  await makeUser('Admin Prueba', 'ADMIN');
  await makeUser('Ana');
  await makeUser('Beto');
  admin = await loginAs('adminprueba@prueba.test');
  ana = await loginAs('ana@prueba.test');
  beto = await loginAs('beto@prueba.test');
  const r = await ana.post('/api/appointments', appt(at(10), at(11), {
    requesterPhone: '999 888 777', requesterEmail: 'contacto@prueba.test',
  }));
  apptId = r.body.id;
});
afterAll(() => prisma.$disconnect());

describe('10. Autorización y seguridad', () => {
  it('sin sesión no se accede a nada y no hay registro público', async () => {
    expect((await request(app).get('/api/appointments')).status).toBe(401);
    expect((await request(app).post('/api/users').send({ name: 'x', email: 'x@x.test', password: 'Abcdefghi1' })).status).toBe(401);
  });

  it('un asistente no puede modificar, cancelar ni reprogramar citas ajenas', async () => {
    expect((await beto.patch(`/api/appointments/${apptId}`, { title: 'Hackeo' })).status).toBe(403);
    expect((await beto.post(`/api/appointments/${apptId}/cancel`, { reason: 'x' })).status).toBe(403);
    expect((await beto.post(`/api/appointments/${apptId}/reschedule`, { startsAt: at(15), endsAt: at(16), reason: 'x' })).status).toBe(403);
    expect((await beto.get(`/api/appointments/${apptId}/history`)).status).toBe(403);
    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: apptId } });
    expect(a.title).toBe('Reunión de prueba');
    expect(a.status).toBe('PENDIENTE');
  });

  it('el administrador sí puede gestionar cualquier cita', async () => {
    expect((await admin.patch(`/api/appointments/${apptId}`, { status: 'CONFIRMADA' })).status).toBe(200);
  });

  it('un asistente no puede administrar usuarios, ajustes ni auditoría', async () => {
    expect((await ana.get('/api/users')).status).toBe(403);
    expect((await ana.post('/api/users', { name: 'Nuevo', email: 'n@n.test', password: 'Abcdefghi1' })).status).toBe(403);
    expect((await ana.put('/api/settings', { marginMinutes: 0 })).status).toBe(403);
    expect((await ana.get('/api/audit')).status).toBe(403);
    expect((await ana.get('/api/notifications')).status).toBe(403);
  });

  it('los datos de contacto se ocultan a quien no gestiona la cita (lista, detalle y CSV)', async () => {
    const own = await ana.get(`/api/appointments/${apptId}`);
    expect(own.body.requesterPhone).toBe('999 888 777');
    const other = await beto.get(`/api/appointments/${apptId}`);
    expect(other.body.requesterPhone).toBeNull();
    expect(other.body.requesterEmail).toBeNull();
    const list = await beto.get('/api/appointments');
    expect(JSON.stringify(list.body)).not.toContain('999 888 777');
    const csv = await beto.get('/api/reports/export.csv');
    expect(csv.text).not.toContain('999 888 777');
    expect(csv.text).toContain('(oculto)');
    const csvOwner = await ana.get('/api/reports/export.csv');
    expect(csvOwner.text).toContain('999 888 777');
  });

  it('exige el token CSRF en operaciones que modifican datos', async () => {
    const r = await ana.agent.post('/api/appointments').send(appt(at(14), at(15)));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF');
  });

  it('el historial de auditoría no puede modificarse ni borrarse (trigger en la BD)', async () => {
    const log = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: 'x' } })).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow();
    await expect(prisma.appointment.delete({ where: { id: apptId } })).rejects.toThrow();
  });

  it('bloquea la cuenta tras intentos de acceso fallidos y no revela si el correo existe', async () => {
    const noExiste = await request(app).post('/api/auth/login').send({ email: 'nadie@prueba.test', password: 'x' });
    const malaClave = await request(app).post('/api/auth/login').send({ email: 'beto@prueba.test', password: 'incorrecta' });
    expect(noExiste.status).toBe(401);
    expect(noExiste.body.message).toBe(malaClave.body.message);
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: 'beto@prueba.test', password: 'mala' });
    const bloqueado = await request(app).post('/api/auth/login').send({ email: 'beto@prueba.test', password: PASSWORD });
    expect(bloqueado.status).toBe(429);
  });

  it('un usuario desactivado pierde el acceso inmediatamente', async () => {
    const users = await admin.get('/api/users');
    const beto2 = users.body.find((u: { email: string }) => u.email === 'beto@prueba.test');
    await admin.patch(`/api/users/${beto2.id}`, { active: false }).expect(200);
    expect((await beto.get('/api/appointments')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'beto@prueba.test', password: PASSWORD })).status).toBe(401);
  });

  it('valida entradas y devuelve errores en español; el servidor no guarda contraseñas en claro', async () => {
    const r = await ana.post('/api/appointments', { title: '', startsAt: 'mañana' });
    expect(r.status).toBe(400);
    expect(r.body.fields.title).toBe('Este campo es obligatorio.');
    expect(r.body.fields.place).toBeDefined();
    const weak = await admin.post('/api/users', { name: 'Débil', email: 'd@prueba.test', password: 'abc' });
    expect(weak.status).toBe(400);
    const u = await prisma.user.findFirstOrThrow({ where: { email: 'ana@prueba.test' } });
    expect(u.passwordHash).toMatch(/^\$2[aby]\$/);
    const inj = await ana.get(`/api/appointments?q=${encodeURIComponent("'; DROP TABLE \"User\"; --")}`);
    expect(inj.status).toBe(200);
    expect(await prisma.user.count()).toBe(3);
  });
});
