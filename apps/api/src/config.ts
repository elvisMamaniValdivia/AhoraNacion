import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: req('DATABASE_URL'),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  cookieSameSite: (process.env.COOKIE_SAMESITE ?? 'lax') as 'lax' | 'strict' | 'none',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  bcryptCost: Number(process.env.BCRYPT_COST ?? 12),
  emailProvider: (process.env.EMAIL_PROVIDER ?? 'console') as 'console' | 'resend',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailFrom: process.env.EMAIL_FROM ?? 'Agenda <agenda@localhost>',
  reminderCron: process.env.REMINDER_CRON ?? '* * * * *',
  enableWorker: (process.env.ENABLE_WORKER ?? 'true') === 'true',
  workerSecret: process.env.WORKER_SECRET ?? '',
  timezone: 'America/Lima',
};

if (config.isProd && config.emailProvider === 'resend' && !config.resendApiKey) {
  throw new Error('EMAIL_PROVIDER=resend requiere RESEND_API_KEY');
}
if (config.isProd && config.cookieSameSite === 'none' && config.corsOrigins.includes('*')) {
  throw new Error('CORS_ORIGINS no puede ser * con cookies');
}
