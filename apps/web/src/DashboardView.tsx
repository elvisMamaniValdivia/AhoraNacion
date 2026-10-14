import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { Appointment, Block, BLOCK_LABEL } from './types';
import { fmtDateTime, fmtFull, fmtRange, fmtTime, limaToday, toInput } from './time';
import {
  btn,
  Card,
  Empty,
  ErrorBox,
  Loading,
  PriorityTag,
  StatusBadge,
} from './ui';
import { AppointmentDetail } from './AppointmentDetail';
import { AppointmentForm } from './AppointmentForm';
import { BlockModal } from './BlockModal';
import { useAuth } from './auth';

interface DashboardData {
  today: string;
  now: string;
  todayAgenda: Appointment[];
  upcoming: Appointment[];
  pendingConfirmation: Appointment[];
  todayBlocks: Block[];
  recentChanges: {
    id: string;
    action: string;
    entity: string;
    entityId: string;
    at: string;
    reason: string | null;
    actor: { name: string } | null;
  }[];
  notifications: {
    id: string;
    type: string;
    subject: string;
    status: string;
    scheduledFor: string;
    appointmentId: string | null;
  }[];
}

interface DayAvailability {
  date: string;
  marginMinutes: number;
  busy: { kind: string; title: string; startsAt: string; endsAt: string; blockedUntil: string }[];
  freeSlots: { startsAt: string; endsAt: string }[];
}

export function DashboardView() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedApptId, setSelectedApptId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [newRangePrefill, setNewRangePrefill] = useState<{ start: string; end: string } | null>(null);

  const dashQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/api/reports/dashboard'),
    refetchInterval: 30000,
  });

  const availQuery = useQuery({
    queryKey: ['availability-today', limaToday()],
    queryFn: () => api<DayAvailability>(`/api/availability/day?date=${limaToday()}&duration=30`),
  });

  const quickConfirm = useMutation({
    mutationFn: (id: string) =>
      api(`/api/appointments/${id}`, { method: 'PATCH', body: { status: 'CONFIRMADA' } }),
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });

  if (dashQuery.isLoading) return <Loading />;
  if (dashQuery.isError) return <ErrorBox error={dashQuery.error} />;

  const d = dashQuery.data;
  if (!d) return null;

  return (
    <div className="space-y-6">
      {/* Banner de bienvenida y acceso rápido */}
      <div className="flex flex-col gap-4 rounded-xl border border-red-300 bg-gradient-to-r from-red-600 via-rose-700 to-red-800 p-6 text-white shadow-md sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="inline-block rounded bg-red-800/90 px-2.5 py-0.5 text-xs font-black uppercase tracking-wider text-red-100 shadow-sm">
            Ahora Nación
          </span>
          <h1 className="mt-1.5 text-2xl font-black">Panel de Coordinación del Candidato</h1>
          <p className="text-sm text-red-100">
            Hoy en Lima: <strong className="capitalize text-white">{fmtFull(new Date())}</strong> · {user?.name} ({user?.role === 'ADMIN' ? 'Administrador' : 'Asistente'})
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setNewRangePrefill(null);
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-emerald-600 transition"
          >
            ＋ Registrar Cita
          </button>
          {user?.role === 'ADMIN' && (
            <button
              onClick={() => setShowBlockModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300/40 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur hover:bg-white/20 transition"
            >
              🔒 Bloquear horario
            </button>
          )}
        </div>
      </div>

      {/* Grid principal: Agenda de Hoy & Pendientes */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Columna Izquierda / Central: Agenda de Hoy */}
        <div className="space-y-6 lg:col-span-2">
          {/* Agenda del día */}
          <Card
            title={`Agenda de Hoy (${d.todayAgenda.length} compromisos)`}
            action={
              <span className="text-xs font-medium text-slate-500">
                Horario Lima (UTC-5)
              </span>
            }
          >
            {d.todayAgenda.length === 0 && d.todayBlocks.length === 0 ? (
              <Empty>No hay citas ni bloqueos programados para hoy.</Empty>
            ) : (
              <div className="divide-y divide-slate-100">
                {/* Bloqueos del día */}
                {d.todayBlocks.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between py-3 px-1 bg-slate-50 rounded mb-1 text-sm border-l-4 border-slate-600 pl-3"
                  >
                    <div>
                      <div className="font-semibold text-slate-800">
                        🔒 [{BLOCK_LABEL[b.type]}] {b.title}
                      </div>
                      <div className="text-xs text-slate-500">
                        {fmtRange(b.startsAt, b.endsAt).split(' · ')[1]}
                      </div>
                    </div>
                    <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-medium">
                      Bloqueo
                    </span>
                  </div>
                ))}

                {/* Citas del día */}
                {d.todayAgenda.map((a) => (
                  <div
                    key={a.id}
                    onClick={() => setSelectedApptId(a.id)}
                    className="group flex cursor-pointer items-start justify-between py-3 px-1 transition hover:bg-blue-50/50 rounded"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 group-hover:text-blue-900">
                          {a.title}
                        </span>
                        <StatusBadge status={a.status} />
                        <PriorityTag priority={a.priority} />
                      </div>
                      <div className="text-xs text-slate-600">
                        🕒 <strong>{fmtTime(a.startsAt)} – {fmtTime(a.endsAt)}</strong> · 📍 {a.place} ({a.modality.toLowerCase()})
                      </div>
                      <div className="text-xs text-slate-500">
                        Solicita: <strong>{a.requesterName}</strong> · Resp: {a.createdBy.name}
                      </div>
                    </div>
                    <button className={btn.link} onClick={(e) => { e.stopPropagation(); setSelectedApptId(a.id); }}>
                      Ver detalle →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Horarios libres y ocupados de hoy */}
          <Card title="Disponibilidad y Horarios Libres de Hoy">
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Intervalos libres de 30 minutos disponibles hoy para reservar rápidamente (respetando el margen de seguridad):
              </p>
              {availQuery.isLoading ? (
                <Loading />
              ) : availQuery.data?.freeSlots.length ? (
                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-1">
                  {availQuery.data.freeSlots.slice(0, 14).map((slot) => (
                    <button
                      key={slot.startsAt}
                      type="button"
                      onClick={() => {
                        setNewRangePrefill({
                          start: toInput(slot.startsAt),
                          end: toInput(slot.endsAt),
                        });
                        setShowCreateModal(true);
                      }}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition"
                      title="Clic para registrar cita en este horario"
                    >
                      ＋ {fmtTime(slot.startsAt)} – {fmtTime(slot.endsAt)}
                    </button>
                  ))}
                  {availQuery.data.freeSlots.length > 14 && (
                    <span className="text-xs text-slate-500 self-center">
                      +{availQuery.data.freeSlots.length - 14} horarios más disponibles
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  No hay horarios disponibles restantes para hoy.
                </p>
              )}
            </div>
          </Card>

          {/* Próximas citas */}
          <Card title="Próximas Citas (Días siguientes)">
            {d.upcoming.length === 0 ? (
              <Empty>No hay próximas citas programadas.</Empty>
            ) : (
              <div className="divide-y divide-slate-100">
                {d.upcoming.map((a) => (
                  <div
                    key={a.id}
                    onClick={() => setSelectedApptId(a.id)}
                    className="flex cursor-pointer items-center justify-between py-2.5 hover:bg-slate-50 px-1 rounded transition text-sm"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{a.title}</div>
                      <div className="text-xs text-slate-600">
                        📅 {fmtRange(a.startsAt, a.endsAt)} · 📍 {a.place}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={a.status} />
                      <button className={btn.link}>Ver</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Columna Derecha: Pendientes de confirmación, Cambios recientes y Avisos */}
        <div className="space-y-6">
          {/* Citas pendientes de confirmación */}
          <Card
            title={`Por Confirmar (${d.pendingConfirmation.length})`}
            className="border-amber-200"
          >
            {d.pendingConfirmation.length === 0 ? (
              <Empty>No hay citas pendientes de confirmación.</Empty>
            ) : (
              <div className="space-y-3">
                {d.pendingConfirmation.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-bold text-slate-900">{a.title}</span>
                      <PriorityTag priority={a.priority} />
                    </div>
                    <div className="text-xs text-slate-700">
                      📅 {fmtRange(a.startsAt, a.endsAt)}
                    </div>
                    <div className="text-xs text-slate-600">
                      Solicita: <strong>{a.requesterName}</strong>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-amber-200/60">
                      <button
                        className="text-xs font-semibold text-blue-900 hover:underline"
                        onClick={() => setSelectedApptId(a.id)}
                      >
                        Ver detalle
                      </button>
                      {a.canEdit && (
                        <button
                          disabled={quickConfirm.isPending}
                          onClick={() => quickConfirm.mutate(a.id)}
                          className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-bold text-white hover:bg-emerald-800"
                        >
                          Confirmar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Notificaciones importantes */}
          <Card title="Avisos y Recordatorios Recientes">
            {d.notifications.length === 0 ? (
              <Empty>No tiene avisos recientes.</Empty>
            ) : (
              <ul className="space-y-2 text-xs">
                {d.notifications.map((n) => (
                  <li
                    key={n.id}
                    className="rounded border border-slate-200 bg-slate-50 p-2 text-slate-800"
                  >
                    <div className="font-semibold">{n.subject}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Estado: <strong>{n.status === 'SENT' ? '✔ Enviado' : 'Pendiente'}</strong> · {fmtDateTime(n.scheduledFor)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Cambios recientes (Auditoría en vivo) */}
          <Card title="Últimos Cambios en Agenda">
            {d.recentChanges.length === 0 ? (
              <Empty>No hay cambios registrados.</Empty>
            ) : (
              <ul className="space-y-2 text-xs">
                {d.recentChanges.slice(0, 6).map((c) => (
                  <li key={c.id} className="border-b border-slate-100 pb-1.5 last:border-0">
                    <div className="text-slate-800">
                      <strong>{c.actor?.name ?? 'Sistema'}</strong> realizó{' '}
                      <span className="font-mono text-slate-600">{c.action}</span>
                    </div>
                    {c.reason && <div className="text-slate-600 italic">«{c.reason}»</div>}
                    <div className="text-[10px] text-slate-400">{fmtDateTime(c.at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* Modales */}
      {selectedApptId && (
        <AppointmentDetail id={selectedApptId} onClose={() => setSelectedApptId(null)} />
      )}

      {showCreateModal && (
        <AppointmentForm
          prefill={newRangePrefill ?? undefined}
          onClose={() => {
            setShowCreateModal(false);
            setNewRangePrefill(null);
          }}
          onSaved={(a) => {
            setShowCreateModal(false);
            setNewRangePrefill(null);
            setSelectedApptId(a.id);
          }}
        />
      )}

      {showBlockModal && <BlockModal onClose={() => setShowBlockModal(false)} />}
    </div>
  );
}
