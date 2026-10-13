/** Utilidades de tiempo. Todo se guarda en UTC (timestamptz); America/Lima (UTC-5, sin horario de verano) se usa para reglas de negocio. */
export const TZ = 'America/Lima';
export const MIN = 60_000;

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

export interface LimaParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = domingo ... 6 = sábado */
  weekday: number;
  /** AAAA-MM-DD en hora de Lima */
  dateKey: string;
}

export function limaParts(d: Date): LimaParts {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: days.indexOf(p.weekday),
    dateKey: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Convierte "HH:mm" a minutos desde medianoche. */
export function hhmm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/** Instante UTC correspondiente a una fecha/hora de Lima. */
export function fromLima(dateKey: string, minutesOfDay: number): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Lima = UTC-5 constante
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + (minutesOfDay + 5 * 60) * MIN);
}

export function formatLima(d: Date): string {
  const p = limaParts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}
