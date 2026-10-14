import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from './api';
import { Alternative, Conflict } from './types';
import { addMinutes, fmtRange, fmtTime, fromInput, toInput } from './time';
import { btn, input, Field } from './ui';

interface Check { available: boolean; conflicts: Conflict[]; alternatives: Alternative[]; marginMinutes: number }

/**
 * Selector de fecha/hora con comprobación inmediata de disponibilidad.
 * Es solo una ayuda: la garantía definitiva la da el servidor al guardar.
 */
export function TimeRangePicker({
  start, end, onChange, excludeId, errors,
}: {
  start: string; end: string; excludeId?: string;
  onChange: (start: string, end: string) => void;
  errors?: { startsAt?: string; endsAt?: string };
}) {
  const startIso = start ? fromInput(start) : '';
  const endIso = end ? fromInput(end) : '';
  const valid = !!start && !!end && endIso > startIso;
  const [debounced, setDebounced] = useState({ s: startIso, e: endIso });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ s: startIso, e: endIso }), 350);
    return () => clearTimeout(t);
  }, [startIso, endIso]);

  const check = useQuery({
    queryKey: ['check', debounced, excludeId],
    enabled: valid && debounced.e > debounced.s,
    queryFn: () => api<Check>(`/api/availability/check${qs({ startsAt: debounced.s, endsAt: debounced.e, excludeId })}`),
    retry: false,
  });

  const dur = valid ? Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000) : 0;
  const setDuration = (m: number) => { if (start) onChange(start, toInput(addMinutes(fromInput(start), m))); };

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Inicio (hora de Lima)" error={errors?.startsAt}>
          {(id, d) => <input id={id} aria-describedby={d} type="datetime-local" className={input} value={start}
            onChange={(e) => {
              const v = e.target.value;
              const keep = valid ? dur : 30;
              onChange(v, v ? toInput(addMinutes(fromInput(v), keep)) : end);
            }} />}
        </Field>
        <Field label="Fin (hora de Lima)" error={errors?.endsAt}>
          {(id, d) => <input id={id} aria-describedby={d} type="datetime-local" className={input} value={end} onChange={(e) => onChange(start, e.target.value)} />}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-700 font-medium">Duración:</span>
        {[30, 45, 60, 90, 120].map((m) => (
          <button type="button" key={m} onClick={() => setDuration(m)} aria-pressed={dur === m}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${dur === m ? 'border-red-600 bg-red-600 text-white shadow-sm' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}>
            {m} min
          </button>
        ))}
        {valid && <span className="text-xs text-slate-600 font-semibold">({dur} min)</span>}
      </div>

      <div aria-live="polite" className="min-h-[1.5rem]">
        {start && end && !valid && <p className="text-sm font-medium text-red-700">⚠ La hora de fin debe ser posterior a la de inicio.</p>}
        {valid && check.isFetching && <p className="text-sm text-slate-600">Comprobando disponibilidad…</p>}
        {valid && check.data?.available && !check.isFetching && (
          <p className="rounded-md border border-emerald-600 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
            ✔ Horario disponible (margen entre citas: {check.data.marginMinutes} min).
          </p>
        )}
        {valid && check.error && !check.isFetching && (
          <p className="rounded-md border border-amber-600 bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠ {(check.error as Error).message}</p>
        )}
        {valid && check.data && !check.data.available && !check.isFetching && (
          <div className="rounded-md border border-red-600 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-semibold">✕ Horario ocupado. Se cruza con:</p>
            <ul className="ml-4 list-disc">
              {check.data.conflicts.map((c) => <li key={c.id}>{c.kind === 'BLOCK' ? 'Bloqueo: ' : ''}{c.title} ({fmtRange(c.startsAt, c.endsAt)})</li>)}
            </ul>
            <Alternatives alts={check.data.alternatives} onPick={(a) => onChange(toInput(a.startsAt), toInput(a.endsAt))} />
          </div>
        )}
      </div>
    </div>
  );
}

export function Alternatives({ alts, onPick }: { alts: Alternative[]; onPick: (a: Alternative) => void }) {
  if (!alts.length) return <p className="mt-2">No hay horarios cercanos libres con esa duración.</p>;
  return (
    <div className="mt-2">
      <p className="font-medium">Alternativas cercanas disponibles:</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {alts.map((a) => (
          <button type="button" key={a.startsAt} onClick={() => onPick(a)} className={btn.secondary}>
            {fmtRange(a.startsAt, a.endsAt)}
          </button>
        ))}
      </div>
    </div>
  );
}

export const shortRange = (a: string, b: string) => `${fmtTime(a)} – ${fmtTime(b)}`;
