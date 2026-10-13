# Especificación de la API REST

Todas las respuestas de error siguen el formato estandarizado:
```json
{
  "code": "CODIGO_ERROR",
  "message": "Mensaje en español comprensible",
  "details": {}
}
```

## 1. Autenticación (`/api/auth`)

### `POST /api/auth/login`
Inicia sesión mediante cookie HTTP-only `sid`.
- **Headers:** `Content-Type: application/json`
- **Request Body:**
```json
{
  "email": "asistente1@demo.test",
  "password": "Asistente-Demo-2026!"
}
```
- **Response 200 OK:**
```json
{
  "user": {
    "id": "cm...",
    "name": "Asistente Uno",
    "email": "asistente1@demo.test",
    "role": "ASSISTANT"
  },
  "csrfToken": "token_base64url_para_cabecera_x_csrf_token"
}
```
- **Response 401 Unauthorized:**
```json
{
  "code": "INVALID_CREDENTIALS",
  "message": "Correo o contraseña incorrectos."
}
```
- **Response 429 Too Many Requests (Bloqueo temporal):**
```json
{
  "code": "LOCKED",
  "message": "Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo en unos minutos."
}
```

### `GET /api/auth/me`
Verifica la sesión activa del usuario y retorna el usuario autenticado y su token CSRF.

### `POST /api/auth/logout`
Destruye la sesión activa y elimina la cookie.

---

## 2. Citas (`/api/appointments`)

### `GET /api/appointments`
Lista citas con filtros opcionales. Oculta datos de contacto a usuarios no autorizados.
- **Parámetros Query:**
  - `q`: Texto libre en título, solicitante o lugar.
  - `from`: Fecha ISO inicio (inclusive).
  - `to`: Fecha ISO fin (inclusive).
  - `status`: Estados separados por coma (`PENDIENTE,CONFIRMADA`).
  - `activityType`: Tipo de actividad.
  - `createdById`: ID del responsable que creó la cita.
  - `limit`, `offset`: Paginación.

### `POST /api/appointments`
Crea una nueva cita con validación estricta de conflictos y margen.
- **Headers:** `X-CSRF-Token: <token>`
- **Request Body:**
```json
{
  "title": "Reunión con dirigencia de transporte",
  "requesterName": "Asociación Nacional de Transportistas",
  "requesterPhone": "+51 987654321",
  "requesterEmail": "contacto@transportistas.pe",
  "description": "Exposición del pliego de reclamos del sector.",
  "startsAt": "2026-10-20T10:00:00-05:00",
  "endsAt": "2026-10-20T10:45:00-05:00",
  "place": "Local Central, Av. Arequipa 1234, Lima",
  "modality": "PRESENCIAL",
  "priority": "ALTA",
  "activityType": "REUNION",
  "notes": "Coordinar pase vehicular",
  "status": "CONFIRMADA",
  "participants": [
    { "name": "Secretario General Juan Pérez" }
  ]
}
```
- **Response 201 Created:** Retorna la cita creada con ID único y confirmación.
- **Response 409 Conflict (Horario ocupado):**
```json
{
  "code": "CONFLICT",
  "message": "El horario no está disponible: se cruza con «Entrevista radial» (20/10/2026 10:30 a 20/10/2026 11:30). Se aplica un margen de 15 minutos entre citas.",
  "details": {
    "conflicts": [
      {
        "kind": "APPOINTMENT",
        "id": "cm...",
        "title": "Entrevista radial",
        "startsAt": "2026-10-20T15:30:00.000Z",
        "endsAt": "2026-10-20T16:30:00.000Z"
      }
    ],
    "alternatives": [
      {
        "startsAt": "2026-10-20T16:45:00.000Z",
        "endsAt": "2026-10-20T17:30:00.000Z"
      }
    ]
  }
}
```

### `PATCH /api/appointments/:id`
Edita una cita existente (permite modificar horario si no causa conflicto con otras citas, excluyendo a la misma).

### `POST /api/appointments/:id/cancel`
Cancela la cita liberando el horario para futuras reservas, conservando el historial y motivo.
- **Request Body:**
```json
{
  "reason": "El solicitante reprogramó para el próximo mes por viaje imprevisto."
}
```

### `POST /api/appointments/:id/reschedule`
Transición coherente: la cita previa pasa a `REPROGRAMADA` (no bloquea) y se crea una nueva cita vinculada.
- **Request Body:**
```json
{
  "startsAt": "2026-10-22T15:00:00-05:00",
  "endsAt": "2026-10-22T16:00:00-05:00",
  "reason": "Ajuste de agenda solicitado por el candidato"
}
```

### `GET /api/appointments/:id/history`
Retorna la trazabilidad de auditoría de los campos modificados y las notificaciones asociadas.

---

## 3. Disponibilidad (`/api/availability`)

### `GET /api/availability/check`
- **Query:** `startsAt`, `endsAt`, `excludeId` (opcional).
- **Response 200:**
```json
{
  "available": true,
  "conflicts": [],
  "alternatives": [],
  "marginMinutes": 15
}
```

### `GET /api/availability/day`
- **Query:** `date=YYYY-MM-DD`, `duration=30`.
- **Response 200:** Retorna compromisos ocupados (`busy`) e intervalos libres (`freeSlots`) del día en hora de Lima.

---

## 4. Bloqueos (`/api/blocks`)
- `GET /api/blocks`: Retorna bloqueos activos.
- `POST /api/blocks` (Admin): Crea bloqueo (almuerzos, viajes, descansos). Participa de las mismas reglas de exclusión.
- `DELETE /api/blocks/:id` (Admin): Desactiva un bloqueo liberando el intervalo.

---

## 5. Reportes y Exportación (`/api/reports`)
- `GET /api/reports/dashboard`: Información agregada de la pantalla principal.
- `GET /api/reports/summary`: Estadísticas por día, semana o mes.
- `GET /api/reports/export.csv`: Descarga directa en CSV protegido (con prevención de inyecciones CSV/Excel y respeto de privacidad de datos de contacto).
