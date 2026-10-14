# Arquitectura del Sistema - Agenda Ahora Nación

Este documento describe en detalle la arquitectura técnica, modelo de datos, mecanismos de concurrencia y seguridad del **Sistema Web de Gestión de Agenda y Citas para el Candidato (Ahora Nación)**.

---

## 1. Diagrama de Arquitectura General (C4 - Nivel Contenedor)

```mermaid
graph TD
    subgraph Dispositivos["📱 Clientes de Usuario"]
        M1["📱 iPhone / Android<br/>(PWA Instalable - Safari/Chrome)"]
        M2["💻 Laptop / PC Asistentes<br/>(Navegador Web)"]
    end

    subgraph FrontendApp["🎨 Capa Frontend (apps/web)"]
        Vite["Vite + React 18 + TypeScript"]
        Tailwind["Tailwind CSS (Paleta Ahora Nación)"]
        Query["TanStack Query (Caché e invalidación)"]
        FC["FullCalendar + Vista Semanal 24h"]
    end

    subgraph BackendApp["⚙️ Capa Backend (apps/api)"]
        Express["Node.js + Express + TypeScript"]
        Auth["Middleware Auth + CSRF Guard + Cookies HttpOnly"]
        Zod["Validadores Zod (Anti-inyección y tipos)"]
        Scheduler["Worker node-cron (Recordatorios automáticos)"]
        Prisma["Prisma ORM Client"]
    end

    subgraph Database["🗄️ Capa Persistencia (PostgreSQL 16)"]
        PG["PostgreSQL con btree_gist y pg_trgm"]
        GiST["Restricción Física GiST EXCLUDE<br/>(Cero solapamientos en concurrencia)"]
        AuditTrigger["Triggers SQL Inmutables<br/>(Prohibición de UPDATE/DELETE en AuditLog)"]
    end

    subgraph Externos["✉️ Servicios Externos"]
        Mail["Proveedor SMTP / Resend<br/>(Correos de alerta y recordatorios)"]
    end

    Dispositivos -->|HTTPS / WSS| Vite
    Vite --> Tailwind
    Vite --> Query
    Vite --> FC
    Query -->|REST JSON + CSRF Token| Express
    Express --> Auth
    Auth --> Zod
    Zod --> Prisma
    Scheduler -->|Procesa cola due| Prisma
    Scheduler -->|Envío de alertas| Mail
    Prisma --> PG
    PG --> GiST
    PG --> AuditTrigger
```

---

## 2. Modelo de Datos y Esquema Relacional

El sistema está modelado bajo principios de normalización, estricto control de tipos y trazabilidad inmutable.

```mermaid
erDiagram
    User ||--o{ Session : "inicia"
    User ||--o{ Appointment : "registra como creador"
    User ||--o{ ScheduleBlock : "crea bloqueo"
    User ||--o{ Notification : "recibe"
    User ||--o{ NotificationPreference : "configura canales"
    User ||--o{ AuditLog : "genera acción auditable"

    Appointment ||--o{ AppointmentParticipant : "tiene participantes"
    Appointment ||--o| Occupancy : "genera bloqueo de rango"
    Appointment ||--o{ Notification : "dispara alertas"
    Appointment ||--o| Appointment : "reprogramada desde"

    ScheduleBlock ||--o| Occupancy : "genera bloqueo de rango"

    User {
        string id PK
        string name
        string email UK
        string passwordHash
        Role role "ADMIN | ASSISTANT"
        boolean active
        int failedLogins
        datetime lockedUntil
    }

    Appointment {
        string id PK
        string title
        string requesterName
        string requesterPhone "Dato privado"
        string requesterEmail "Dato privado"
        datetime startsAt
        datetime endsAt
        string place "Opcional"
        Modality modality "PRESENCIAL | VIRTUAL | TELEFONICA"
        AppointmentStatus status "PENDIENTE | CONFIRMADA | REALIZADA | CANCELADA | REPROGRAMADA"
        Priority priority
        ActivityType activityType "REUNION | ENTREVISTA | EVENTO_PUBLICO | VISITA | LLAMADA | OTRO"
        string cancelReason
        string rescheduleReason
        string createdById FK
        string rescheduledFromId FK
    }

    Occupancy {
        string id PK
        OccupancyKind kind "APPOINTMENT | BLOCK"
        string appointmentId UK_FK
        string blockId UK_FK
        datetime startsAt
        datetime endsAt "Incluye margen de 15 min"
    }

    ScheduleBlock {
        string id PK
        BlockType type "ALMUERZO | TRASLADO | VIAJE | DESCANSO | OTRO"
        string title
        datetime startsAt
        datetime endsAt
        boolean active
    }

    AuditLog {
        string id PK
        string actorId FK
        string action
        string entity
        string entityId
        jsonb changes
        string reason
        datetime at
    }

    Notification {
        string id PK
        string appointmentId FK
        string recipientId FK
        NotificationType type
        NotificationStatus status
        string dedupeKey UK
        datetime scheduledFor
    }
```

---

## 3. Prevención de Conflictos y Concurrencia (3 Capas)

Uno de los mayores retos de una agenda política es evitar que múltiples asistentes registren o reprogramen compromisos a la misma hora simultáneamente.

```mermaid
sequenceDiagram
    autonumber
    actor AsistenteA as Asistente 1
    actor AsistenteB as Asistente 2
    participant Web as Frontend Web (React)
    participant API as Backend (Express + Zod)
    participant DB as PostgreSQL (Motor Físico)

    Note over AsistenteA, AsistenteB: Intentan registrar una cita para las 15:00 simultáneamente
    AsistenteA->>Web: Selecciona 15:00 - 16:00
    AsistenteB->>Web: Selecciona 15:00 - 16:00

    par Petición Concurrente
        AsistenteA->>API: POST /api/appointments (15:00 - 16:00)
        AsistenteB->>API: POST /api/appointments (15:00 - 16:00)
    end

    Note over API: Capa 2: Zod valida formato, duración y rango válido (startsAt < endsAt)

    alt Llega primero Asistente 1 (milisegundos antes)
        API->>DB: Inicia Transacción Serializable
        DB-->>API: Inserta Cita y crea registro en Occupancy [15:00, 16:15)
        API->>DB: Commit exitoso
        API-->>AsistenteA: 201 Created (Cita confirmada)
    else Asistente 2 procesado en paralelo
        API->>DB: Intenta insertar Occupancy [15:00, 16:15)
        Note over DB: Capa 3: Restricción física EXCLUDE USING gist detecta solapamiento
        DB-->>API: Error 23P01 (exclusion_violation)
        API->>DB: Rollback automático
        API-->>AsistenteB: 409 Conflict + Sugerencias de horarios libres cercanos
        Web-->>AsistenteB: Alerta clara: "El horario acaba de ser ocupado. Próximo disponible: 16:15"
    end
```

---

## 4. Estrategia de Seguridad y Privacidad

1. **Ley de Protección de Datos Personales (Ley 29733 - Perú):**
   - El equipo de campaña necesita coordinar sin chocarse en horas, pero no todos los asistentes deben tener acceso irrestricto a teléfonos o datos personales de fuentes reservadas o dignatarios.
   - **Regla de negocio en API:** Si un asistente consulta una cita que fue creada por otro usuario, los campos `requesterPhone` y `requesterEmail` son ofuscados (`[Privado]`). Solo el creador de la cita y el Administrador pueden ver los datos completos.
2. **Inmutabilidad de Auditoría:**
   - La tabla `AuditLog` tiene un trigger PostgreSQL que bloquea y rechaza de forma tajante cualquier intento de `UPDATE` o `DELETE`. Nadie puede borrar su rastro ni alterar el historial de cambios.
3. **Autenticación Resistente:**
   - Sesiones gestionadas vía cookies `HttpOnly`, `SameSite=Lax`, `Secure`.
   - Protección contra CSRF mediante token criptográfico en cabecera `X-CSRF-Token`.
   - Bloqueo de cuenta automático tras 5 intentos fallidos sucesivos durante 15 minutos.

---

## 5. Distribución de Componentes del Monorepo

```
Sistema Ahora Nacion/
├── apps/
│   ├── api/                     # Backend API REST
│   │   ├── prisma/
│   │   │   ├── schema.prisma    # Esquema declarativo Prisma
│   │   │   ├── migrations/      # Migraciones SQL con restricciones GiST y triggers
│   │   │   └── seed.ts          # Cuentas demo e inicialización
│   │   ├── src/
│   │   │   ├── auth/            # Middleware de sesión, CSRF, login, logout
│   │   │   ├── routes/          # Endpoints (/appointments, /blocks, /users, etc.)
│   │   │   ├── services/        # Lógica de negocio (notificaciones, solapamientos)
│   │   │   └── app.ts / server.ts
│   │   └── tests/               # 37 pruebas unitarias y de integración
│   └── web/                     # Frontend SPA & PWA
│       ├── public/
│       │   ├── icon.png         # Logo oficial Ahora Nación para iPhone / Android
│       │   ├── manifest.json    # Configuración PWA (instalación sin App Store)
│       │   └── logo-ahora-nacion.png
│       └── src/
│           ├── AppointmentForm.tsx    # Modal optimizado para móviles (sin cierre de teclado)
│           ├── WeeklyScheduleView.tsx # Horario semanal visual (verde libre, rojo cita, 24h)
│           ├── CalendarView.tsx       # FullCalendar interactivo
│           ├── DashboardView.tsx      # Panel principal resumen
│           └── LoginView.tsx          # Pantalla de acceso con identidad del partido
├── docs/
│   ├── arquitectura.md          # Esta especificación técnica
│   ├── modelo-datos.md          # Detalle entidad por entidad
│   ├── api.md                  # Especificación de endpoints REST
│   └── despliegue-y-riesgos.md # Guía para Supabase, Render y Vercel
├── docker-compose.yml          # PostgreSQL 16 para desarrollo local
├── package.json                # Workspaces de npm
└── README.md                   # Resumen del proyecto e instrucciones
```
