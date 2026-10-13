import { z } from 'zod';

/** Mensajes de error comprensibles en español. */
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === 'undefined' ? 'Este campo es obligatorio.' : 'Valor no válido.' };
    case z.ZodIssueCode.too_small:
      return {
        message:
          issue.type === 'string'
            ? issue.minimum === 1
              ? 'Este campo es obligatorio.'
              : `Debe tener al menos ${issue.minimum} caracteres.`
            : 'Valor demasiado pequeño.',
      };
    case z.ZodIssueCode.too_big:
      return { message: issue.type === 'string' ? `No puede superar ${issue.maximum} caracteres.` : 'Valor demasiado grande.' };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Correo electrónico no válido.' };
      if (issue.validation === 'url') return { message: 'Enlace no válido.' };
      if (issue.validation === 'datetime') return { message: 'Fecha y hora no válidas (use formato ISO con zona horaria).' };
      return { message: 'Formato no válido.' };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'Opción no válida.' };
  }
  return { message: ctx.defaultError };
});

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) =>
  z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullish());
const iso = z.string().datetime({ offset: true });
const phone = z.preprocess(
  (v) => (v === '' ? null : v),
  z.string().trim().regex(/^[+\d][\d\s\-()]{5,19}$/, 'Teléfono no válido.').nullish(),
);
const email = z.preprocess((v) => (v === '' ? null : v), z.string().trim().toLowerCase().email().max(200).nullish());
const httpsUrl = z.preprocess(
  (v) => (v === '' ? null : v),
  z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), 'Solo se admiten enlaces http o https.')
    .nullish(),
);

export const Modality = z.enum(['PRESENCIAL', 'VIRTUAL', 'TELEFONICA']);
export const Status = z.enum(['PENDIENTE', 'CONFIRMADA', 'REALIZADA', 'CANCELADA', 'REPROGRAMADA']);
export const Priority = z.enum(['BAJA', 'MEDIA', 'ALTA', 'URGENTE']);
export const ActivityType = z.enum(['REUNION', 'ENTREVISTA', 'EVENTO_PUBLICO', 'VISITA', 'LLAMADA', 'OTRO']);
export const BlockType = z.enum([
  'ALMUERZO', 'TRASLADO', 'VIAJE', 'ACTIVIDAD_PUBLICA', 'DESCANSO', 'PERSONAL', 'DIA_NO_DISPONIBLE',
]);

const participant = z.object({ name: text(200), email });

const appointmentBase = z.object({
  title: text(200),
  requesterName: text(200),
  requesterPhone: phone,
  requesterEmail: email,
  description: optText(2000),
  startsAt: iso,
  endsAt: iso,
  place: text(300),
  modality: Modality.default('PRESENCIAL'),
  meetingUrl: httpsUrl,
  priority: Priority.default('MEDIA'),
  activityType: ActivityType.default('REUNION'),
  notes: optText(2000),
  participants: z.array(participant).max(20).optional(),
});

export const appointmentInput = appointmentBase.extend({
  status: z.enum(['PENDIENTE', 'CONFIRMADA']).optional(),
});
export type AppointmentInput = z.infer<typeof appointmentInput>;

export const appointmentPatch = appointmentBase
  .partial()
  .extend({ status: z.enum(['PENDIENTE', 'CONFIRMADA', 'REALIZADA']).optional() });
export type AppointmentPatch = z.infer<typeof appointmentPatch>;

export const cancelInput = z.object({ reason: text(500) });
export const rescheduleInput = z.object({ startsAt: iso, endsAt: iso, reason: text(500) });

export const blockInput = z.object({
  type: BlockType,
  title: text(200),
  startsAt: iso,
  endsAt: iso,
});
export const blockPatch = blockInput.partial().extend({ active: z.boolean().optional() });

export const password = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres.')
  .max(128)
  .regex(/[a-z]/, 'Incluya al menos una minúscula.')
  .regex(/[A-Z]/, 'Incluya al menos una mayúscula.')
  .regex(/\d/, 'Incluya al menos un número.');

export const loginInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export const userCreate = z.object({
  name: text(120),
  email: z.string().trim().toLowerCase().email().max(200),
  password,
  role: z.enum(['ADMIN', 'ASSISTANT']).default('ASSISTANT'),
});
export const userPatch = z.object({
  name: text(120).optional(),
  active: z.boolean().optional(),
  role: z.enum(['ADMIN', 'ASSISTANT']).optional(),
  password: password.optional(),
});

const hhmmRe = /^([01]\d|2[0-3]):[0-5]\d$/;
export const settingsPatch = z
  .object({
    marginMinutes: z.number().int().min(0).max(240),
    minDurationMinutes: z.number().int().min(5).max(240),
    workingHours: z.object({
      start: z.string().regex(hhmmRe),
      end: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/),
      days: z.array(z.number().int().min(0).max(6)).min(1),
    }),
    reminderHours: z.array(z.number().min(0.25).max(24 * 14)).max(6),
    notifyAdminsOnChanges: z.boolean(),
  })
  .partial();

export const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  from: iso.optional(),
  to: iso.optional(),
  status: z.string().optional(), // lista separada por comas
  activityType: ActivityType.optional(),
  createdById: z.string().optional(),
  place: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
  offset: z.coerce.number().int().min(0).default(0),
});
