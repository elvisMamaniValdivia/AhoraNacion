import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { ACTIVITY_LABEL, Alternative, Appointment, Conflict, MODALITY_LABEL, PRIORITY_LABEL, ActivityType, Modality, Priority } from './types';
import { fromInput, fmtFull, fmtRange, toInput } from './time';
import { Alternatives, TimeRangePicker } from './TimeRangePicker';
import { btn, ErrorBox, Field, input, Modal } from './ui';

interface FormState {
  title: string; requesterName: string; requesterPhone: string; requesterEmail: string;
  description: string; start: string; end: string; place: string; modality: Modality;
  meetingUrl: string; priority: Priority; activityType: ActivityType; notes: string;
  status: 'PENDIENTE' | 'CONFIRMADA'; participants: string;
}

const empty = (start = '', end = ''): FormState => ({
  title: '', requesterName: '', requesterPhone: '', requesterEmail: '', description: '', start, end,
  place: '', modality: 'PRESENCIAL', meetingUrl: '', priority: 'MEDIA', activityType: 'REUNION',
  notes: '', status: 'PENDIENTE', participants: '',
});

export function AppointmentForm({
  initial, prefill, onClose, onSaved,
}: {
  initial?: Appointment;
  prefill?: { start: string; end: string };
  onClose: () => void;
  onSaved: (a: Appointment) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>(() =>
    initial
      ? {
          title: initial.title, requesterName: initial.requesterName, requesterPhone: initial.requesterPhone ?? '',
          requesterEmail: initial.requesterEmail ?? '', description: initial.description ?? '',
          start: toInput(initial.startsAt), end: toInput(initial.endsAt), place: initial.place,
          modality: initial.modality, meetingUrl: initial.meetingUrl ?? '', priority: initial.priority,
          activityType: initial.activityType, notes: initial.notes ?? '',
          status: initial.status === 'CONFIRMADA' ? 'CONFIRMADA' : 'PENDIENTE',
          participants: initial.participants.map((p) => p.name).join(', '),
        }
      : empty(prefill?.start, prefill?.end),
  );
  const [review, setReview] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<{ message: string; conflicts: Conflict[]; alternatives: Alternative[] } | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setF((s) => ({ ...s, [k]: v })); setFields((e) => ({ ...e, [k]: '' })); };

  const body = () => ({
    title: f.title, requesterName: f.requesterName,
    requesterPhone: f.requesterPhone || null, requesterEmail: f.requesterEmail || null,
    description: f.description || null, startsAt: fromInput(f.start), endsAt: fromInput(f.end),
    place: f.place, modality: f.modality, meetingUrl: f.meetingUrl || null,
    priority: f.priority, activityType: f.activityType, notes: f.notes || null,
    status: f.status,
    participants: f.participants.split(',').map((s) => s.trim()).filter(Boolean).map((name) => ({ name })),
  });

  const save = useMutation({
    mutationFn: () => initial
      ? api<Appointment>(`/api/appointments/${initial.id}`, { method: 'PATCH', body: body() })
      : api<Appointment>('/api/appointments', { method: 'POST', body: body() }),
    onSuccess: (a) => { qc.invalidateQueries(); onSaved(a); },
    onError: (e) => {
      setReview(false);
      if (e instanceof ApiError) {
        if (e.status === 400 && e.fields) {
          const m: Record<string, string> = { ...e.fields };
          if (m.startsAt) m.startsAt = m.startsAt; 
          setFields(m);
        }
        if (e.status === 409 && e.code === 'CONFLICT') {
          setConflict({ message: e.message, conflicts: e.details?.conflicts ?? [], alternatives: e.details?.alternatives ?? [] });
        }
      }
    },
  });

  const localErrors = () => {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = 'Este campo es obligatorio.';
    if (!f.requesterName.trim()) e.requesterName = 'Este campo es obligatorio.';
    if (!f.place.trim()) e.place = 'Este campo es obligatorio.';
    if (!f.start) e.startsAt = 'Indique la fecha y hora de inicio.';
    if (!f.end) e.endsAt = 'Indique la hora de fin.';
    if (f.start && f.end && fromInput(f.end) <= fromInput(f.start)) e.endsAt = 'La hora de fin debe ser posterior al inicio.';
    if (f.requesterEmail && !/^\S+@\S+\.\S+$/.test(f.requesterEmail)) e.requesterEmail = 'Correo electrónico no válido.';
    if (f.meetingUrl && !/^https?:\/\//i.test(f.meetingUrl)) e.meetingUrl = 'Use un enlace que comience con https://';
    return e;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setConflict(null);
    const errs = localErrors();
    setFields(errs);
    if (Object.keys(errs).length) return;
    setReview(true);
  };

  if (review) {
    return (
      <Modal title="Confirme la cita" onClose={() => setReview(false)}>
        <dl className="space-y-1 text-sm">
          <div><dt className="inline font-semibold">Compromiso: </dt><dd className="inline">{f.title}</dd></div>
          <div><dt className="inline font-semibold">Solicita: </dt><dd className="inline">{f.requesterName}</dd></div>
          <div><dt className="inline font-semibold">Fecha: </dt><dd className="inline capitalize">{fmtFull(fromInput(f.start))}</dd></div>
          <div><dt className="inline font-semibold">Horario: </dt><dd className="inline">{fmtRange(fromInput(f.start), fromInput(f.end)).split(' · ')[1]} (hora de Lima)</dd></div>
          <div><dt className="inline font-semibold">Lugar: </dt><dd className="inline">{f.place} — {MODALITY_LABEL[f.modality]}</dd></div>
        </dl>
        <p className="mt-3 rounded bg-slate-100 p-2 text-xs text-slate-700">
          El servidor verificará la disponibilidad al guardar. La cita solo queda registrada si el horario sigue libre.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className={btn.secondary} onClick={() => setReview(false)}>Volver a editar</button>
          <button className={btn.primary} disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Guardando…' : initial ? 'Confirmar y guardar cambios' : 'Confirmar y registrar cita'}
          </button>
        </div>
        <div className="mt-3"><ErrorBox error={save.error && !(save.error instanceof ApiError && save.error.status === 409) ? save.error : null} /></div>
      </Modal>
    );
  }

  return (
    <Modal title={initial ? 'Editar cita' : 'Nueva cita'} onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Título del compromiso *" error={fields.title} className="sm:col-span-2">
            {(id, d) => <input id={id} aria-describedby={d} className={input} value={f.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />}
          </Field>
          <Field label="Persona o institución que solicita *" error={fields.requesterName}>
            {(id, d) => <input id={id} aria-describedby={d} className={input} value={f.requesterName} maxLength={200} onChange={(e) => set('requesterName', e.target.value)} />}
          </Field>
          <Field label="Tipo de actividad">
            {(id) => <select id={id} className={input} value={f.activityType} onChange={(e) => set('activityType', e.target.value as ActivityType)}>
              {Object.entries(ACTIVITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
          </Field>
        </div>

        <TimeRangePicker start={f.start} end={f.end} excludeId={initial?.id}
          onChange={(s, e) => { setF((x) => ({ ...x, start: s, end: e })); setFields((x) => ({ ...x, startsAt: '', endsAt: '' })); setConflict(null); }}
          errors={{ startsAt: fields.startsAt, endsAt: fields.endsAt }} />

        {conflict && (
          <div role="alert" className="rounded-md border border-red-600 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-semibold">No se registró la cita.</p>
            <p>{conflict.message}</p>
            <Alternatives alts={conflict.alternatives} onPick={(a) => { setF((x) => ({ ...x, start: toInput(a.startsAt), end: toInput(a.endsAt) })); setConflict(null); }} />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lugar o dirección *" error={fields.place}>
            {(id, d) => <input id={id} aria-describedby={d} className={input} value={f.place} maxLength={300} onChange={(e) => set('place', e.target.value)} />}
          </Field>
          <Field label="Modalidad">
            {(id) => <select id={id} className={input} value={f.modality} onChange={(e) => set('modality', e.target.value as Modality)}>
              {Object.entries(MODALITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
          </Field>
          {f.modality === 'VIRTUAL' && (
            <Field label="Enlace de videoconferencia" error={fields.meetingUrl} className="sm:col-span-2">
              {(id, d) => <input id={id} aria-describedby={d} type="url" placeholder="https://" className={input} value={f.meetingUrl} onChange={(e) => set('meetingUrl', e.target.value)} />}
            </Field>
          )}
          <Field label="Prioridad">
            {(id) => <select id={id} className={input} value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
          </Field>
          <Field label="Estado inicial">
            {(id) => <select id={id} className={input} value={f.status} onChange={(e) => set('status', e.target.value as 'PENDIENTE' | 'CONFIRMADA')}>
              <option value="PENDIENTE">Pendiente de confirmación</option><option value="CONFIRMADA">Confirmada</option></select>}
          </Field>
        </div>

        <details className="rounded-md border border-slate-300 p-3" open={!!initial}>
          <summary className="cursor-pointer text-sm font-semibold">Más datos (opcional)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Teléfono de contacto" error={fields.requesterPhone} hint="Solo si es necesario para coordinar.">
              {(id, d) => <input id={id} aria-describedby={d} type="tel" className={input} value={f.requesterPhone} onChange={(e) => set('requesterPhone', e.target.value)} />}
            </Field>
            <Field label="Correo de contacto" error={fields.requesterEmail}>
              {(id, d) => <input id={id} aria-describedby={d} type="email" className={input} value={f.requesterEmail} onChange={(e) => set('requesterEmail', e.target.value)} />}
            </Field>
            <Field label="Motivo o descripción" className="sm:col-span-2" error={fields.description}>
              {(id, d) => <textarea id={id} aria-describedby={d} rows={2} className={input} value={f.description} onChange={(e) => set('description', e.target.value)} />}
            </Field>
            <Field label="Participantes adicionales" hint="Nombres separados por coma." className="sm:col-span-2">
              {(id, d) => <input id={id} aria-describedby={d} className={input} value={f.participants} onChange={(e) => set('participants', e.target.value)} />}
            </Field>
            <Field label="Observaciones" className="sm:col-span-2">
              {(id) => <textarea id={id} rows={2} className={input} value={f.notes} onChange={(e) => set('notes', e.target.value)} />}
            </Field>
          </div>
        </details>

        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose}>Cancelar</button>
          <button type="submit" className={btn.primary}>Revisar y confirmar</button>
        </div>
      </form>
    </Modal>
  );
}
