import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { fromLima, limaParts, formatLima } from '../src/utils/time';
import { appt, loginAs, makeUser, resetDb, Client } from './helpers';

let ana: Client;
beforeEach(async () => {
  await resetDb();
  await makeUser('Ana');
  ana = await loginAs('ana@prueba.test');
});
afterAll(() => prisma.$disconnect());

describe('12. Zona horaria America/Lima', () => {
  it('convierte entre hora de Lima y UTC (UTC-5, sin horario de verano)', () => {
    expect(fromLima('2027-03-10', 10 * 60).toISOString()).toBe('2027-03-10T15:00:00.000Z');
    expect(fromLima('2027-07-10', 10 * 60).toISOString()).toBe('2027-07-10T15:00:00.000Z');
    const p = limaParts(new Date('2027-03-11T03:30:00Z')); // 22:30 del día anterior en Lima
    expect(p.dateKey).toBe('2027-03-10');
    expect(p.hour).toBe(22);
    expect(formatLima(new Date('2027-03-10T15:00:00Z'))).toBe('10/03/2027 10:00');
  });

  it('guarda el mismo instante venga con offset -05:00 o en UTC', async () => {
    const a = await ana.post('/api/appointments', appt('2027-03-10T10:00:00-05:00', '2027-03-10T11:00:00-05:00')).expect(201);
    expect(a.body.startsAt).toBe('2027-03-10T15:00:00.000Z');
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(row.startsAt.toISOString()).toBe('2027-03-10T15:00:00.000Z');
    // la misma hora expresada en UTC choca: es el mismo instante
    const dup = await ana.post('/api/appointments', appt('2027-03-10T15:00:00Z', '2027-03-10T16:00:00Z'));
    expect(dup.status).toBe(409);
  });

  it('una cita nocturna de Lima cuyo UTC cae al día siguiente aparece en el día correcto', async () => {
    await ana.post('/api/appointments', appt('2027-03-10T21:30:00-05:00', '2027-03-10T22:30:00-05:00')).expect(201);
    const dia = await ana.get('/api/availability/day?date=2027-03-10&duration=30');
    expect(dia.body.busy).toHaveLength(1);
    const siguiente = await ana.get('/api/availability/day?date=2027-03-11&duration=30');
    expect(siguiente.body.busy).toHaveLength(0);
    const csv = await ana.get('/api/reports/export.csv');
    expect(csv.text).toContain('10/03/2027 21:30');
  });

  it('rechaza citas fuera del horario de atención de Lima y las que cruzan de día', async () => {
    const temprano = await ana.post('/api/appointments', appt('2027-03-10T04:00:00-05:00', '2027-03-10T05:00:00-05:00'));
    expect(temprano.status).toBe(422);
    const cruza = await ana.post('/api/appointments', appt('2027-03-10T22:30:00-05:00', '2027-03-11T00:30:00-05:00'));
    expect(cruza.status).toBe(422);
  });

  it('rechaza fechas sin zona horaria explícita', async () => {
    const r = await ana.post('/api/appointments', appt('2027-03-10T10:00:00', '2027-03-10T11:00:00'));
    expect(r.status).toBe(400);
  });
});
