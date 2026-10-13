import { execSync } from 'node:child_process';

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://agenda:agenda@localhost:5433/agenda_test';
  // Aplica las migraciones reales (incluida la restricción EXCLUDE) a la BD de pruebas.
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}
