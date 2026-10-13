# Sistema Web de Gestión de Agenda y Citas para Candidato

Sistema profesional, seguro y colaborativo de agenda compartida para un candidato y su equipo de asistentes, diseñado con **prevención estricta de conflictos y cruces de horarios bajo concurrencia**, trazabilidad total mediante auditoría inmutable, soporte para zona horaria **America/Lima** y arquitectura moderna lista para producción.

---

## 1. Características Principales

- **Prevención de conflictos en 3 niveles:**
  1. *Frontend:* Comprobación en vivo mientras se selecciona la fecha/hora y sugerencia de alternativas cercanas.
  2. *Backend:* Validación de reglas de negocio, duración mínima, horario de atención y margen entre citas.
  3. *Base de Datos:* Restricción física `EXCLUDE USING gist (tstzrange(...) WITH &&)` en PostgreSQL. Dos solicitudes simultáneas jamás pueden confirmar horarios solapados.
- **Margen de seguridad configurable:** Margen dinámico entre compromisos (por defecto 15 minutos) para traslados y descansos.
- **Bloqueos de agenda:** Permite al administrador registrar almuerzos, viajes, traslados o actividades que bloquean el calendario para todos los asistentes.
- **Reprogramación y cancelación consistente:** Citas canceladas liberan el horario pero se conservan en la base de datos con su motivo; citas reprogramadas crean un nuevo registro enlazado sin dejar duplicados.
- **Seguridad y Privacidad (Ley 29733 - Perú):**
  - Mínimo privilegio: Los asistentes ven toda la agenda para no solapar citas, pero los datos de contacto (teléfono y correo) de citas ajenas permanecen ocultos.
  - Autenticación con sesiones en cookie `HttpOnly`, protección CSRF con doble token, bloqueo temporal tras 5 intentos fallidos y contraseñas hasheadas con `bcrypt`.
- **Auditoría inmutable:** Tabla de auditoría append-only protegida por triggers de base de datos que prohíben `UPDATE` y `DELETE`.
- **Recordatorios automáticos en el servidor:** Envíos a 24 horas y 1 hora antes de la cita, procesados por un worker continuo con deduplicación y reintentos ante fallas del proveedor.
- **Calendario interactivo y responsive:** Vistas diaria, semanal, mensual y agenda cronológica (FullCalendar), con leyenda accesible para personas con daltonismo.

---

## 2. Tecnologías Empleadas

- **Frontend:** React 18, TypeScript, Tailwind CSS, FullCalendar, TanStack Query.
- **Backend:** Node.js, Express, TypeScript, Zod, bcrypt, node-cron.
- **Base de Datos & ORM:** PostgreSQL 16 con extensiones `btree_gist` y `pg_trgm`, Prisma ORM con migraciones SQL de integridad.
- **Pruebas Automatizadas:** Vitest y Supertest ejecutados contra base de datos PostgreSQL real.

---

## 3. Estructura del Proyecto

```
├── apps/
│   ├── api/                     # Backend Express + TypeScript + Prisma
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # Modelo de datos Prisma
│   │   │   ├── migrations/     # Migraciones con restricción EXCLUDE y triggers
│   │   │   └── seed.ts         # Datos de demostración iniciales
│   │   ├── src/                # Código fuente de la API
│   │   └── tests/              # Pruebas automatizadas (37 tests)
│   └── web/                     # Frontend React + TypeScript + Tailwind
│       ├── src/
│       │   ├── CalendarView.tsx    # Vistas de FullCalendar y filtros
│       │   ├── DashboardView.tsx   # Panel principal y agenda del día
│       │   ├── SearchView.tsx      # Búsqueda y reportes estadísticos
│       │   ├── AdminViews.tsx      # Usuarios, ajustes y auditoría
│       │   ├── AppointmentForm.tsx # Formulario con disponibilidad en vivo
│       │   └── AppointmentDetail.tsx# Detalle, historial y reprogramación
│       └── vercel.json         # Configuración y cabeceras de seguridad
├── docs/
│   ├── api.md                  # Especificación de endpoints REST con ejemplos
│   ├── modelo-datos.md         # Diagrama relacional y entidades
│   └── despliegue-y-riesgos.md # Despliegue en Supabase, Render y Vercel
├── docker-compose.yml          # PostgreSQL 16 local para desarrollo
├── .env.example                # Plantilla de variables de entorno
└── package.json                # Monorepo workspaces
```

---

## 4. Instalación y Ejecución Local

### Prerrequisitos
- Node.js >= 20 y npm >= 10
- Docker Desktop (para la base de datos PostgreSQL local)

### Paso 1: Clonar y configurar variables de entorno
```bash
git clone <url-del-repositorio>
cd "Sistema Ahora Nacion"

# Copiar el archivo de entorno
cp .env.example apps/api/.env
```

### Paso 2: Iniciar la base de datos PostgreSQL local
```bash
docker compose up -d db
```
*Esto iniciará PostgreSQL en el puerto `5433` con el usuario y base de datos de desarrollo.*

### Paso 3: Instalar dependencias y desplegar migraciones
```bash
npm install
npm run migrate:dev -w apps/api
npm run seed -w apps/api
```

### Paso 4: Iniciar el entorno de desarrollo
En terminales separadas (o simultáneamente):
```bash
# Terminal 1: Iniciar API Backend (puerto 4000)
npm run dev:api

# Terminal 2: Iniciar Frontend Web (puerto 5173 con proxy)
npm run dev:web
```

Abra su navegador en [http://localhost:5173](http://localhost:5173).

---

## 5. Cuentas de Acceso de Prueba (Seed)

| Rol | Correo Electrónico | Contraseña Inicial |
|---|---|---|
| **Administrador** | `admin@demo.test` | `Admin-Demo-2026!` |
| **Asistente 1** | `asistente1@demo.test` | `Asistente-Demo-2026!` |
| **Asistente 2** | `asistente2@demo.test` | `Asistente-Demo-2026!` |
| **Asistente 3** | `asistente3@demo.test` | `Asistente-Demo-2026!` |

---

## 6. Pruebas Automatizadas

El proyecto incluye una suite de **37 pruebas automatizadas obligatorias** que validan contra PostgreSQL real:
- Creación en horarios libres.
- Rechazo de citas que comienzan dentro de otra o la contienen completamente.
- Citas contiguas (con margen 0 y con margen configurable).
- Aplicación de margen de traslado (15 min por defecto).
- Liberación de horarios tras cancelación.
- Trazabilidad y no solapamiento en reprogramaciones.
- Edición de citas excluyendo el ID propio.
- Bloqueos de agenda como restricción compartida.
- **Prueba de concurrencia:** 12 solicitudes simultáneas a la misma hora en paralelo (`Promise.all`), confirmando una sola y rechazando el resto con código 409 y sugerencias.
- Control de roles y ocultación de datos de contacto (mínimo privilegio).
- Deduplicación de recordatorios y tolerancia a caídas del proveedor de correo.
- Conversión y manejo consistente de la zona horaria **America/Lima (UTC-5)**.

Para ejecutar los tests:
```bash
npm run test -w apps/api
```

---

## 7. Despliegue en Producción

Consulte la guía detallada en [docs/despliegue-y-riesgos.md](docs/despliegue-y-riesgos.md) para los pasos específicos en:
- **Base de Datos:** [Supabase PostgreSQL](https://supabase.com).
- **Backend:** [Render](https://render.com) (Web Service).
- **Frontend:** [Vercel](https://vercel.com) (Vite SPA).
- **Notificaciones por Correo:** [Resend](https://resend.com) con dominio verificado.
