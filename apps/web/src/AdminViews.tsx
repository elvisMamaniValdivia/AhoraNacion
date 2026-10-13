import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { Settings, User } from './types';
import { fmtDateTime } from './time';
import { btn, Card, Empty, ErrorBox, Field, input, Loading, Modal } from './ui';

interface AuditLogItem {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  at: string;
  reason: string | null;
  changes: Record<string, unknown> | null;
  actor: { id: string; name: string } | null;
}

interface NotificationItem {
  id: string;
  type: string;
  channel: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  scheduledFor: string;
  sentAt: string | null;
  error: string | null;
  subject: string;
  recipient: { name: string; email: string };
}

export function AdminViews() {
  const [tab, setTab] = useState<'users' | 'settings' | 'audit' | 'notifications'>('users');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setTab('users')}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
            tab === 'users' ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 border border-slate-300'
          }`}
        >
          👥 Gestión de Asistentes
        </button>
        <button
          onClick={() => setTab('settings')}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
            tab === 'settings' ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 border border-slate-300'
          }`}
        >
          ⚙️ Parámetros de Agenda
        </button>
        <button
          onClick={() => setTab('audit')}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
            tab === 'audit' ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 border border-slate-300'
          }`}
        >
          📜 Historial de Auditoría
        </button>
        <button
          onClick={() => setTab('notifications')}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
            tab === 'notifications'
              ? 'bg-blue-900 text-white'
              : 'bg-white text-slate-700 border border-slate-300'
          }`}
        >
          🔔 Monitor de Notificaciones
        </button>
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'notifications' && <NotificationsTab />}
    </div>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/api/users') });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/api/users/${id}`, { method: 'PATCH', body: { active } }),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-800">Cuentas de Asistentes y Administradores</h2>
        <button onClick={() => setShowCreate(true)} className={btn.primary}>
          ＋ Crear Asistente
        </button>
      </div>

      <Card title="Lista de Usuarios Autorizados">
        {usersQuery.isLoading ? (
          <Loading />
        ) : usersQuery.isError ? (
          <ErrorBox error={usersQuery.error} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 uppercase font-semibold border-b">
                <tr>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Correo</th>
                  <th className="px-3 py-2">Rol</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usersQuery.data?.map((u) => (
                  <tr key={u.id}>
                    <td className="px-3 py-2.5 font-bold text-slate-900">{u.name}</td>
                    <td className="px-3 py-2.5 text-slate-700">{u.email}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded px-2 py-0.5 font-semibold text-[11px] ${
                          u.role === 'ADMIN' ? 'bg-purple-100 text-purple-900' : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {u.role === 'ADMIN' ? 'Administrador' : 'Asistente'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 font-semibold text-[11px] ${
                          u.active ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'
                        }`}
                      >
                        {u.active ? 'Activo' : 'Desactivado'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => toggleActive.mutate({ id: u.id, active: !u.active })}
                        disabled={toggleActive.isPending}
                        className={u.active ? btn.danger : btn.secondary}
                      >
                        {u.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ASSISTANT' | 'ADMIN'>('ASSISTANT');

  const create = useMutation({
    mutationFn: () =>
      api('/api/users', {
        method: 'POST',
        body: { name, email, password, role },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });

  return (
    <Modal title="Crear Nuevo Usuario / Asistente" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Nombre completo *">
          {(id) => <input id={id} required className={input} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Correo electrónico *">
          {(id) => (
            <input
              id={id}
              type="email"
              required
              className={input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Contraseña inicial *"
          hint="Mínimo 10 caracteres, incluyendo mayúscula, minúscula y número."
        >
          {(id) => (
            <input
              id={id}
              type="password"
              required
              className={input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Field label="Rol del usuario">
          {(id) => (
            <select
              id={id}
              className={input}
              value={role}
              onChange={(e) => setRole(e.target.value as 'ASSISTANT' | 'ADMIN')}
            >
              <option value="ASSISTANT">Asistente</option>
              <option value="ADMIN">Administrador</option>
            </select>
          )}
        </Field>

        <ErrorBox error={create.error} />

        <div className="flex justify-end gap-2 border-t pt-3">
          <button type="button" className={btn.secondary} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className={btn.primary} disabled={create.isPending}>
            {create.isPending ? 'Guardando…' : 'Crear usuario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SettingsTab() {
  const qc = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/api/settings') });

  const [margin, setMargin] = useState<number>(15);
  const [minDur, setMinDur] = useState<number>(15);
  const [startHour, setStartHour] = useState('06:00');
  const [endHour, setEndHour] = useState('23:00');
  const [reminders, setReminders] = useState('24, 1');
  const [initialized, setInitialized] = useState(false);

  if (settingsQuery.data && !initialized) {
    setMargin(settingsQuery.data.marginMinutes);
    setMinDur(settingsQuery.data.minDurationMinutes);
    setStartHour(settingsQuery.data.workingHours.start);
    setEndHour(settingsQuery.data.workingHours.end);
    setReminders(settingsQuery.data.reminderHours.join(', '));
    setInitialized(true);
  }

  const save = useMutation({
    mutationFn: () =>
      api('/api/settings', {
        method: 'PUT',
        body: {
          marginMinutes: Number(margin),
          minDurationMinutes: Number(minDur),
          workingHours: {
            start: startHour,
            end: endHour,
            days: [0, 1, 2, 3, 4, 5, 6],
          },
          reminderHours: reminders
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => !Number.isNaN(n) && n > 0),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      alert('Configuración guardada correctamente.');
    },
  });

  return (
    <Card title="Configuración de Parámetros de Agenda">
      {settingsQuery.isLoading ? (
        <Loading />
      ) : settingsQuery.isError ? (
        <ErrorBox error={settingsQuery.error} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4 max-w-xl"
        >
          <Field
            label="Margen de seguridad entre citas (minutos)"
            hint="Tiempo reservado automáticamente para traslados y descansos entre compromisos contiguos."
          >
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                max={120}
                className={input}
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
              />
            )}
          </Field>

          <Field label="Duración mínima de una cita (minutos)">
            {(id) => (
              <input
                id={id}
                type="number"
                min={5}
                max={240}
                className={input}
                value={minDur}
                onChange={(e) => setMinDur(Number(e.target.value))}
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Hora inicio atención (Lima)">
              {(id) => (
                <input
                  id={id}
                  type="time"
                  className={input}
                  value={startHour}
                  onChange={(e) => setStartHour(e.target.value)}
                />
              )}
            </Field>
            <Field label="Hora fin atención (Lima)">
              {(id) => (
                <input
                  id={id}
                  type="time"
                  className={input}
                  value={endHour}
                  onChange={(e) => setEndHour(e.target.value)}
                />
              )}
            </Field>
          </div>

          <Field
            label="Horas previas de recordatorios automáticos"
            hint="Valores en horas separados por comas. Ej: 24, 1 (avisa 24 horas y 1 hora antes de la cita)."
          >
            {(id) => (
              <input
                id={id}
                type="text"
                className={input}
                value={reminders}
                onChange={(e) => setReminders(e.target.value)}
              />
            )}
          </Field>

          <ErrorBox error={save.error} />

          <button type="submit" className={btn.primary} disabled={save.isPending}>
            {save.isPending ? 'Guardando…' : 'Guardar parámetros'}
          </button>
        </form>
      )}
    </Card>
  );
}

function AuditTab() {
  const auditQuery = useQuery({
    queryKey: ['audit'],
    queryFn: () => api<AuditLogItem[]>('/api/audit?limit=150'),
  });

  return (
    <Card title="Historial Verificable de Auditoría (Solo Inserción)">
      <p className="text-xs text-slate-600 mb-3">
        Registro inmutable protegido por base de datos: nadie puede modificar ni borrar estos eventos.
      </p>

      {auditQuery.isLoading ? (
        <Loading />
      ) : auditQuery.isError ? (
        <ErrorBox error={auditQuery.error} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-700 uppercase font-semibold border-b">
              <tr>
                <th className="px-3 py-2">Fecha y Hora</th>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Operación</th>
                <th className="px-3 py-2">Entidad</th>
                <th className="px-3 py-2">Motivo / Detalles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {auditQuery.data?.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap text-slate-900">
                    {fmtDateTime(l.at)}
                  </td>
                  <td className="px-3 py-2 font-bold text-slate-800">
                    {l.actor?.name ?? 'Sistema'}
                  </td>
                  <td className="px-3 py-2 font-bold text-blue-900">{l.action}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {l.entity}:{l.entityId.slice(0, 8)}...
                  </td>
                  <td className="px-3 py-2 font-sans text-slate-700">
                    {l.reason && <span className="italic">«{l.reason}» </span>}
                    {l.changes && (
                      <span className="text-[11px] text-slate-500 font-mono">
                        {JSON.stringify(l.changes)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function NotificationsTab() {
  const qc = useQueryClient();
  const notifQuery = useQuery({
    queryKey: ['notifications-admin'],
    queryFn: () => api<NotificationItem[]>('/api/notifications'),
    refetchInterval: 15000,
  });

  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/retry`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <Card title="Monitor de Notificaciones y Recordatorios del Servidor">
      <p className="text-xs text-slate-600 mb-3">
        Los recordatorios se procesan de forma autónoma en el servidor cada minuto. No se duplican envíos.
      </p>

      {notifQuery.isLoading ? (
        <Loading />
      ) : notifQuery.isError ? (
        <ErrorBox error={notifQuery.error} />
      ) : notifQuery.data?.length === 0 ? (
        <Empty>No hay notificaciones registradas.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-700 uppercase font-semibold border-b">
              <tr>
                <th className="px-3 py-2">Programada</th>
                <th className="px-3 py-2">Destinatario</th>
                <th className="px-3 py-2">Asunto</th>
                <th className="px-3 py-2">Canal</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Intentos</th>
                <th className="px-3 py-2 text-right">Reintento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {notifQuery.data?.map((n) => (
                <tr key={n.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-800">
                    {fmtDateTime(n.scheduledFor)}
                  </td>
                  <td className="px-3 py-2 text-slate-900 font-semibold">{n.recipient.name}</td>
                  <td className="px-3 py-2 text-slate-800">
                    <div>{n.subject}</div>
                    {n.error && <div className="text-[11px] text-red-700 font-medium">{n.error}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold">
                      {n.channel}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        n.status === 'SENT'
                          ? 'bg-emerald-100 text-emerald-900'
                          : n.status === 'FAILED'
                          ? 'bg-red-100 text-red-900'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {n.status === 'SENT' ? 'Enviado' : n.status === 'FAILED' ? 'Falló' : 'Pendiente'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{n.attempts}</td>
                  <td className="px-3 py-2 text-right">
                    {n.status !== 'SENT' && (
                      <button
                        onClick={() => retry.mutate(n.id)}
                        disabled={retry.isPending}
                        className={btn.secondary}
                      >
                        Reintentar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
