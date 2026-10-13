import cron from 'node-cron';
import { createApp } from './app';
import { config } from './config';
import { prisma } from './db';
import { processDueNotifications } from './services/notifications';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`API escuchando en el puerto ${config.port}`);
});

let running = false;
if (config.enableWorker) {
  cron.schedule(config.reminderCron, async () => {
    if (running) return; // evita solapar ejecuciones
    running = true;
    try {
      const r = await processDueNotifications();
      if (r.sent || r.failed || r.skipped) console.log('[worker]', r);
      // Limpieza de sesiones vencidas
      await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    } catch (e) {
      console.error('[worker] error:', (e as Error).message);
    } finally {
      running = false;
    }
  });
  console.log(`Worker de recordatorios activo (${config.reminderCron})`);
}

const shutdown = () => {
  server.close(() => void prisma.$disconnect().then(() => process.exit(0)));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
