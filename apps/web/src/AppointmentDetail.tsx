import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { Alternative, Appointment, MODALITY_LABEL, ACTIVITY_LABEL, Conflict } from './types';
import { fmtDateTime, fmtFull, fmtRange, fromInput, toInput } from './time';
import { AppointmentForm } from './AppointmentForm';
import { Alternatives, TimeRangePicker } from './TimeRangePicker';
import { btn, ErrorBox, Field, input, Modal, PriorityTag, StatusBadge, Loading } from './ui';

const ACTION_LABEL: Record<string, string> = {
  'appointment.create': 'Creó la cita', 'appointment.update': 'Modificó la cita',
  'appointment.cancel': 'Canceló la cita', 'appointment.reschedule': 'Reprogramó la cita',
};
const FIELD_LABEL: Record<string, string> = {
  title: 'Título', requesterName: 'Solicitante', requesterPhone: 'Teléfono', requesterEmail: 'Correo',
  description: 'Descripción', startsAt: 'Inicio', endsAt: 'Fin', place: 'Lugar', modality: 'Modalidad',
  meetingUrl: 'Enlace', status: 'Estado', priority: 'Prioridad', activityType: 'Actividad', notes: 'Observaciones',
  participants: 'Participantes',
};

type Mode = 'view' | 'edit' | 'cancel' | 'reschedule' | 'history';

export function AppointmentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['appointment', id], queryFn: () => api<Appointment>(`/api/appointments/${id}`) });
  const [mode, setMode] = useState<Mode>('view');
  const a = q.data;

  const refresh = () => { qc.invalidateQueries(); };
  const patch = useMutation({
    mutationFn: (status: string) => api<Appointment>(`/api/appointments/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: refresh,
  });

  if (!a) return <Modal title="Cita" onClose={onClose}>{q.isLoading ? <Loading /> : <ErrorBox error={q.error} />}</Modal>;

  if (mode === 'edit') return <AppointmentForm initial={a} onClose={() => setMode('view')} onSaved={() => setMode('view')} />;

  return (
    <Modal title={a.title} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={a.status} />
        <PriorityTag priority={a.priority} />
        <span className="text-xs text-slate-600">{ACTIVITY_LABEL[a.activityType]} · {MODALITY_LABEL[a.modality]}</span>
      </div>

      {mode === 'view' && (
        <>
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Item k="Fecha" v={<span className="capitalize">{fmtFull(a.startsAt)}</span>} />
            <Item k="Horario (Lima)" v={fmtRange(a.startsAt, a.endsAt).split(' · ')[1]} />
            <Item k="Lugar" v={a.place} />
            <Item k="Solicita" v={a.requesterName} />
            <Item k="Registrada por" v={a.createdBy.name} />
            <Item k="Última modificación" v={fmtDateTime(a.updatedAt)} />
            {a.meetingUrl && <Item k="Videoconferencia" v={<a className={btn.link} href={a.meetingUrl} target="_blank" rel="noopener noreferrer">Abrir enlace</a>} />}
            {a.contactHidden ? <Item k="Contacto" v={<em className="text-slate-600">Oculto (solo el responsable y el administrador)</em>} />
              : <>
                  {a.requesterPhone && <Item k="Teléfono" v={a.requesterPhone} />}
                  {a.requesterEmail && <Item k="Correo" v={a.requesterEmail} />}
                </>}
            {a.description && <Item k="Motivo" v={a.description} wide />}
            {a.participants.length > 0 && <Item k="Participantes" v={a.participants.map((p) => p.name).join(', ')} wide />}
            {a.notes && <Item k="Observaciones" v={a.notes} wide />}
            {a.cancelReason && <Item k="Motivo de cancelación" v={a.cancelReason} wide />}
            {a.rescheduleReason && <Item k="Motivo de reprogramación" v={a.rescheduleReason} wide />}
          </dl>

          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
            {a.canEdit ? (
              <>
                {a.status === 'PENDIENTE' && <button className={btn.primary} disabled={patch.isPending} onClick={() => patch.mutate('CONFIRMADA')}>✔ Confirmar</button>}
                {a.status === 'CONFIRMADA' && <button className={btn.secondary} disabled={patch.isPending} onClick={() => patch.mutate('REALIZADA')}>Marcar realizada</button>}
                <button className={btn.secondary} onClick={() => setMode('edit')}>Editar</button>
                <button className={btn.secondary} onClick={() => setMode('reschedule')}>↻ Reprogramar</button>
                <button className={btn.danger} onClick={() => setMode('cancel')}>Cancelar cita</button>
              </>
            ) : <p className="text-sm text-slate-600">{a.status === 'PENDIENTE' || a.status === 'CONFIRMADA' ? 'Solo el responsable o el administrador pueden modificar esta cita.' : 'Esta cita ya no admite cambios.'}</p>}
            {!a.contactHidden && <button className={`${btn.link} ml-auto`} onClick={() => setMode('history')}>Ver historial</button>}
          </div>
          <div className="mt-3"><ErrorBox error={patch.error} /></div>
        </>
      )}

      {mode === 'cancel' && <CancelPanel a={a} onBack={() => setMode('view')} onDone={() => { refresh(); setMode('view'); }} />}
      {mode === 'reschedule' && <ReschedulePanel a={a} onBack={() => setMode('view')} onDone={(nid) => { refresh(); onClose(); void nid; }} />}
      {mode === 'history' && <History id={a.id} onBack={() => setMode('view')} />}
    </Modal>
  );
}

const Item = ({ k, v, wide }: { k: string; v: React.ReactNode; wide?: boolean }) => (
  <div className={wide ? 'sm:col-span-2' : ''}><dt className="text-xs font-semibold uppercase text-slate-600">{k}</dt><dd>{v}</dd></div>
);

function CancelPanel({ a, onBack, onDone }: { a: Appointment; onBack: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/api/appointments/${a.id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: onDone,
  });
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm">Se liberará el horario <strong>{fmtRange(a.startsAt, a.endsAt)}</strong>. La cita se conserva en el historial.</p>
      <Field label="Motivo de la cancelación *" error={m.error instanceof ApiError ? m.error.fields?.reason : undefined}>
        {(id, d) => <textarea id={id} aria-describedby={d} rows={3} className={input} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2">
        <button className={btn.secondary} onClick={onBack}>Volver</button>
        <button className={btn.danger} disabled={!reason.trim() || m.isPending} onClick={() => m.mutate()}>Confirmar cancelación</button>
      </div>
      <ErrorBox error={m.error instanceof ApiError && m.error.fields ? null : m.error} />
    </div>
  );
}

function ReschedulePanel({ a, onBack, onDone }: { a: Appointment; onBack: () => void; onDone: (newId: string) => void }) {
  const [start, setStart] = useState(toInput(a.startsAt));
  const [end, setEnd] = useState(toInput(a.endsAt));
  const [reason, setReason] = useState('');
  const [alts, setAlts] = useState<Alternative[] | null>(null);
  const m = useMutation({
    mutationFn: () => api<Appointment>(`/api/appointments/${a.id}/reschedule`, { method: 'POST', body: { startsAt: fromInput(start), endsAt: fromInput(end), reason } }),
    onSuccess: (n) => onDone(n.id),
    onError: (e) => { if (e instanceof ApiError && e.status === 409) setAlts(e.details?.alternatives ?? []); },
  });
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm">La cita actual quedará como <strong>Reprogramada</strong> (no bloquea) y se creará la nueva fecha.</p>
      <TimeRangePicker start={start} end={end} excludeId={a.id} onChange={(s, e) => { setStart(s); setEnd(e); setAlts(null); }} />
      <Field label="Motivo de la reprogramación *">
        {(id) => <textarea id={id} rows={2} className={input} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      {m.error && <ErrorBox error={m.error} />}
      {alts && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm"><Alternatives alts={alts} onPick={(x) => { setStart(toInput(x.startsAt)); setEnd(toInput(x.endsAt)); setAlts(null); }} /></div>}
      <div className="flex justify-end gap-2">
        <button className={btn.secondary} onClick={onBack}>Volver</button>
        <button className={btn.primary} disabled={!reason.trim() || m.isPending} onClick={() => m.mutate()}>Confirmar reprogramación</button>
      </div>
    </div>
  );
}

interface Hist {
  logs: { id: string; action: string; at: string; reason: string | null; changes: Record<string, { de: unknown; a: unknown }> | null; actor: { name: string } | null }[];
  notifications: { id: string; type: string; status: string; sentAt: string | null; error: string | null; recipient: { name: string } }[];
}

function History({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useQuery({ queryKey: ['history', id], queryFn: () => api<Hist>(`/api/appointments/${id}/history`) });
  const val = (k: string, v: unknown) => (v == null ? '—' : (k === 'startsAt' || k === 'endsAt') ? fmtDateTime(String(v)) : String(v));
  return (
    <div className="mt-4">
      <button className={btn.link} onClick={onBack}>← Volver</button>
      {q.isLoading ? <Loading /> : <ErrorBox error={q.error} />}
      {q.data && (
        <>
          <h3 className="mt-3 text-sm font-bold">Cambios</h3>
          <ol className="mt-2 space-y-2 border-l-2 border-slate-300 pl-3 text-sm">
            {q.data.logs.map((l) => (
              <li key={l.id}>
                <p><strong>{ACTION_LABEL[l.action] ?? l.action}</strong> · {l.actor?.name ?? 'Sistema'} · <span className="text-slate-600">{fmtDateTime(l.at)}</span></p>
                {l.reason && <p className="text-slate-700">Motivo: {l.reason}</p>}
                {l.changes && l.action === 'appointment.update' && (
                  <ul className="ml-4 list-disc text-slate-700">
                    {Object.entries(l.changes).map(([k, c]) => <li key={k}>{FIELD_LABEL[k] ?? k}: {val(k, c.de)} → {val(k, c.a)}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          <h3 className="mt-4 text-sm font-bold">Notificaciones</h3>
          {q.data.notifications.length === 0 ? <p className="text-sm text-slate-600">Sin notificaciones.</p> : (
            <ul className="mt-2 space-y-1 text-sm">
              {q.data.notifications.map((n) => (
                <li key={n.id}>{n.recipient.name} · {n.type.replace('_', ' ').toLowerCase()} · <strong>{n.status === 'SENT' ? '✔ enviada' : n.status === 'FAILED' ? '✕ falló' : '◔ pendiente'}</strong>{n.error ? ` (${n.error})` : ''}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export type { Conflict };
