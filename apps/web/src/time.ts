/**
 * Todas las horas se muestran y se ingresan en hora de Lima (UTC-5, sin horario de verano),
 * sin importar la zona horaria del navegador. El servidor guarda instantes UTC.
 */
const OFFSET = 5 * 3600_000;
const TZ = 'America/Lima';

/** Hora "de pared" de Lima como cadena sin zona (para FullCalendar con timeZone='UTC'). */
export const toLimaWall = (iso: string | Date) =>
  new Date(new Date(iso).getTime() - OFFSET).toISOString().slice(0, 19);

/** Valor para <input type="datetime-local"> (hora de Lima). */
export const toInput = (iso: string | Date) => toLimaWall(iso).slice(0, 16);

/** Convierte lo escrito en datetime-local (hora de Lima) a instante ISO UTC. */
export const fromInput = (v: string) => new Date(`${v}:00-05:00`).toISOString();

/** Fecha de FullCalendar (UTC con hora de pared de Lima) a instante real. */
export const fromWallDate = (d: Date) => new Date(d.getTime() + OFFSET);
export const nowWall = () => new Date(Date.now() - OFFSET);

export const limaToday = () => toLimaWall(new Date()).slice(0, 10);

export const addMinutes = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60000).toISOString();

const dFmt = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short' });
const tFmt = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fullFmt = new Intl.DateTimeFormat('es-PE', {
  timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

export const fmtDate = (iso: string | Date) => dFmt.format(new Date(iso));
export const fmtTime = (iso: string | Date) => tFmt.format(new Date(iso));
export const fmtFull = (iso: string | Date) => fullFmt.format(new Date(iso));
export const fmtRange = (a: string, b: string) => `${fmtDate(a)} · ${fmtTime(a)} – ${fmtTime(b)}`;
export const fmtDateTime = (iso: string | Date) => `${fmtDate(iso)} ${fmtTime(iso)}`;
