export type Role = 'ADMIN' | 'ASSISTANT';
export type Status = 'PENDIENTE' | 'CONFIRMADA' | 'REALIZADA' | 'CANCELADA' | 'REPROGRAMADA';
export type Modality = 'PRESENCIAL' | 'VIRTUAL' | 'TELEFONICA';
export type Priority = 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE';
export type ActivityType = 'REUNION' | 'ENTREVISTA' | 'EVENTO_PUBLICO' | 'VISITA' | 'LLAMADA' | 'OTRO';
export type BlockType =
  | 'ALMUERZO' | 'TRASLADO' | 'VIAJE' | 'ACTIVIDAD_PUBLICA' | 'DESCANSO' | 'PERSONAL' | 'DIA_NO_DISPONIBLE';

export interface User { id: string; name: string; email: string; role: Role; active?: boolean }

export interface Appointment {
  id: string;
  title: string;
  requesterName: string;
  requesterPhone: string | null;
  requesterEmail: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
  place: string;
  modality: Modality;
  meetingUrl: string | null;
  status: Status;
  priority: Priority;
  activityType: ActivityType;
  notes: string | null;
  cancelReason: string | null;
  rescheduleReason: string | null;
  createdById: string;
  createdBy: { id: string; name: string };
  rescheduledFromId: string | null;
  createdAt: string;
  updatedAt: string;
  participants: { id: string; name: string; email: string | null }[];
  canEdit: boolean;
  contactHidden: boolean;
}

export interface Block { id: string; type: BlockType; title: string; startsAt: string; endsAt: string; active: boolean }

export interface Settings {
  marginMinutes: number;
  minDurationMinutes: number;
  workingHours: { start: string; end: string; days: number[] };
  reminderHours: number[];
  notifyAdminsOnChanges: boolean;
}

export interface Alternative { startsAt: string; endsAt: string }
export interface Conflict { kind: 'APPOINTMENT' | 'BLOCK'; id: string; title: string; startsAt: string; endsAt: string }

export const STATUS_LABEL: Record<Status, string> = {
  PENDIENTE: 'Pendiente', CONFIRMADA: 'Confirmada', REALIZADA: 'Realizada',
  CANCELADA: 'Cancelada', REPROGRAMADA: 'Reprogramada',
};
export const MODALITY_LABEL: Record<Modality, string> = { PRESENCIAL: 'Presencial', VIRTUAL: 'Virtual', TELEFONICA: 'Telefónica' };
export const PRIORITY_LABEL: Record<Priority, string> = { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', URGENTE: 'Urgente' };
export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  REUNION: 'Reunión', ENTREVISTA: 'Entrevista', EVENTO_PUBLICO: 'Evento público',
  VISITA: 'Visita', LLAMADA: 'Llamada', OTRO: 'Otro',
};
export const BLOCK_LABEL: Record<BlockType, string> = {
  ALMUERZO: 'Almuerzo', TRASLADO: 'Traslado', VIAJE: 'Viaje', ACTIVIDAD_PUBLICA: 'Actividad pública',
  DESCANSO: 'Descanso', PERSONAL: 'Compromiso personal', DIA_NO_DISPONIBLE: 'Día no disponible',
};
