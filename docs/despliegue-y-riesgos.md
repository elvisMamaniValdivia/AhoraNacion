# Guía de Despliegue en Producción, Seguridad y Gestión de Riesgos

## 1. Arquitectura de Despliegue en la Nube

```
┌─────────────────────────────────┐
│     Frontend (React + Vite)     │  -> Vercel
│     app.candidato.pe (o subdom) │
└────────────────┬────────────────┘
                 │ HTTPS (Cookies HttpOnly + X-CSRF-Token)
┌────────────────▼────────────────┐
│   Backend Node.js (Express+TS)  │  -> Render (Web Service)
│   api.candidato.pe              │     Worker interno con node-cron
└────────────────┬────────────────┘
                 │ SSL (DATABASE_URL con pgbouncer/direct)
┌────────────────▼────────────────┐
│   PostgreSQL Administrado       │  -> Supabase / Neon / AWS RDS
│   Restricción EXCLUDE GiST      │
└─────────────────────────────────┘
```

---

## 2. Base de Datos en Supabase (o PostgreSQL Administrado)

1. Crear un proyecto en [Supabase](https://supabase.com). Seleccionar la región más cercana (ej. `sa-east-1` São Paulo).
2. Obtener las cadenas de conexión en **Project Settings > Database**:
   - `DATABASE_URL`: Cadena con Transaction Pooler (puerto 6543) para el runtime de la aplicación.
   - `DIRECT_URL`: Conexión directa (puerto 5432) necesaria para ejecutar `prisma migrate deploy` (las migraciones requieren DDL y transacciones de nivel de sesión).
3. Ejecutar las migraciones desde tu entorno de CI/CD o consola:
   ```bash
   cd apps/api
   DATABASE_URL="<DIRECT_URL>" npx prisma migrate deploy
   ```
4. Supabase incluye la extensión `btree_gist` y `pg_trgm` de forma nativa en Postgres, permitiendo que la restricción `occupancy_no_overlap` y los índices trigram funcionen sin pasos adicionales.

---

## 3. Backend en Render

1. Crear una nueva cuenta o entrar a [Render](https://render.com).
2. Crear un nuevo **Web Service** conectado al repositorio de GitHub:
   - **Root Directory:** `apps/api`
   - **Environment:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run start`
   - **Instance Type:** Plan *Starter* o superior (para servicios en producción se recomienda no usar el plan gratuito, ya que se suspende tras inactividad y detendría el cron de recordatorios en segundo plano).
3. Variables de Entorno en Render:
   - `NODE_ENV`: `production`
   - `PORT`: `10000` (o la asignada por Render)
   - `DATABASE_URL`: Cadena de conexión de Supabase.
   - `DIRECT_URL`: Cadena de conexión directa de Supabase.
   - `CORS_ORIGINS`: `https://app.sudominio.pe` (o URL de Vercel).
   - `COOKIE_SAMESITE`: `none` (si los dominios de Vercel y Render son distintos) o `lax` (si comparten dominio base ej. `app.candidato.pe` y `api.candidato.pe`).
   - `SESSION_TTL_HOURS`: `12`
   - `EMAIL_PROVIDER`: `resend`
   - `RESEND_API_KEY`: Clave de API obtenida en Resend.
   - `EMAIL_FROM`: `Agenda <agenda@sudominio.pe>` (dominio verificado en Resend).
   - `ENABLE_WORKER`: `true`
   - `WORKER_SECRET`: Token seguro generado aleatoriamente.
4. **Opción Cron Externo (Render Cron Job):**
   Si se utiliza el plan gratuito de Render o se prefiere desacoplar el worker:
   Crear un Cron Job en Render que ejecute cada minuto:
   ```bash
   curl -X POST https://api.sudominio.pe/api/worker/run \
     -H "Authorization: Bearer <WORKER_SECRET>"
   ```

---

## 4. Frontend en Vercel

1. Importar el repositorio en [Vercel](https://vercel.com).
2. En la configuración del proyecto:
   - **Root Directory:** `apps/web`
   - **Framework Preset:** `Vite`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Variables de Entorno en Vercel:
   - `VITE_API_URL`: `https://api.sudominio.pe` (URL pública del backend en Render).
4. El archivo `apps/web/vercel.json` incluido en el repositorio gestiona automáticamente las rutas SPA (`index.html`) y añade cabeceras HTTP de seguridad (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`).

---

## 5. Estrategia de Copias de Seguridad y Recuperación

1. **Backups Automáticos del Proveedor:**
   Supabase realiza respaldos diarios automáticos con Point-in-Time Recovery (PITR) de hasta 7 días en planes Pro.
2. **Respaldo Lógico Manual / Periódico (`pg_dump`):**
   ```bash
   pg_dump -U postgres -h db.xxxx.supabase.co -d postgres -F c -b -v -f backup_agenda_$(date +%Y%m%d).dump
   ```
3. **Restauración:**
   ```bash
   pg_restore -U postgres -h db.xxxx.supabase.co -d postgres -v backup_agenda_20261020.dump
   ```

---

## 6. Procedimiento de Actualización y Reversión (Rollback)

- **Actualizaciones:**
  1. Las migraciones se prueban previamente en la base de datos de staging.
  2. Al desplegar, se ejecuta `prisma migrate deploy`.
  3. Las aplicaciones nuevas se despliegan sin tiempo de inactividad (*zero-downtime rolling deploy*).
- **Reversión (Rollback):**
  1. Revertir el commit en Git y desplegar la versión previa en Vercel y Render.
  2. Si la migración modificó tablas, aplicar el script SQL inverso correspondiente.
  3. Como las citas nunca se borran físicamente (soft-state), la integridad histórica siempre se preserva.

---

## 7. Cumplimiento Normativo (Ley 29733 de Protección de Datos Personales - Perú)

- **Principio de proporcionalidad:** El sistema solo recopila los datos estrictamente necesarios para coordinar la cita (nombre, teléfono o correo). No se solicitan datos sensibles.
- **Principio de seguridad:** Contraseñas protegidas con bcrypt (cost 12), sesiones seguras en cookies HttpOnly y protección contra ataques CSRF, XSS e Inyecciones SQL.
- **Acceso restringido y mínimo privilegio:** Los asistentes únicamente visualizan teléfonos y correos de las citas que ellos mismos coordinan; en citas de terceros, los datos personales se ocultan.
- **Trazabilidad:** Cada acceso a exportación de datos y modificación queda asentado en el historial de auditoría inmutable.
- **Recomendación legal:** Previo al lanzamiento público, formalizar la inscripción del banco de datos personales ante la Autoridad Nacional de Protección de Datos Personales (MINJUSDH) e incluir la cláusula de consentimiento respectiva.

---

## 8. Riesgos y Limitaciones Identificadas

| Riesgo | Impacto | Mitigación Implementada |
|---|---|---|
| Dos asistentes confirman la misma hora simultáneamente | Conflicto grave en agenda del candidato | Restricción física `EXCLUDE GiST` en Postgres + Transacción con reintento y sugerencia de alternativas. |
| Caída del servicio de correos (Resend) | Asistentes no enterados de citas | Encolado en BD con reintentos controlados (backoff exponencial) y registro de estado (`FAILED`). |
| Pérdida de conectividad móvil | Asistente registra datos desactualizados | El frontend valida disponibilidad en vivo antes de guardar y el servidor rechaza cualquier colisión. |
| Inactividad del servidor en planes gratuitos | Cron de recordatorios no corre | Documentada la necesidad de plan activo o webhook externo con `WORKER_SECRET`. |
