import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, download, qs } from './api';
import {
  ActivityType,
  ACTIVITY_LABEL,
  Appointment,
  Status,
  STATUS_LABEL,
} from './types';
import { fmtDateTime, fmtRange, fromInput, toInput } from './time';
import {
  btn,
  Card,
  Empty,
  ErrorBox,
  input,
  Loading,
  PriorityTag,
  StatusBadge,
} from './ui';
import { AppointmentDetail } from './AppointmentDetail';

interface SummaryData {
  granularity: 'day' | 'week' | 'month';
  total: number;
  totals: Record<string, number>;
  buckets: Record<string, Record<string, number>>;
}

export function SearchView() {
  const [activeTab, setActiveTab] = useState<'search' | 'reports'>('search');

  // Search Filter state
  const [queryText, setQueryText] = useState('');
  const [place, setPlace] = useState('');
  const [status, setStatus] = useState<string>('');
  const [activityType, setActivityType] = useState<string>('');
  const [createdById, setCreatedById] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  const [selectedApptId, setSelectedApptId] = useState<string | null>(null);

  // Summary Report state
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [repFrom, setRepFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toInput(d.toISOString()).slice(0, 10);
  });
  const [repTo, setRepTo] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return toInput(d.toISOString()).slice(0, 10);
  });

  // Directory for user filter
  const dirQuery = useQuery({
    queryKey: ['directory'],
    queryFn: () => api<{ id: string; name: string }[]>('/api/directory'),
  });

  // Search Query
  const searchQuery = useQuery({
    queryKey: ['appointments-search', { queryText, place, status, activityType, createdById, fromDate, toDate }],
    queryFn: () =>
      api<Appointment[]>(
        `/api/appointments${qs({
          q: queryText || undefined,
          place: place || undefined,
          status: status || undefined,
          activityType: activityType || undefined,
          createdById: createdById || undefined,
          from: fromDate ? fromInput(`${fromDate}T00:00`) : undefined,
          to: toDate ? fromInput(`${toDate}T23:59`) : undefined,
          limit: 300,
        })}`,
      ),
  });

  // Summary Report Query
  const summaryQuery = useQuery({
    queryKey: ['report-summary', { repFrom, repTo, granularity }],
    queryFn: () =>
      api<SummaryData>(
        `/api/reports/summary${qs({
          from: fromInput(`${repFrom}T00:00`),
          to: fromInput(`${repTo}T23:59`),
          granularity,
        })}`,
      ),
    enabled: activeTab === 'reports' && !!repFrom && !!repTo,
  });

  const exportCsv = () => {
    const path = `/api/reports/export.csv${qs({
      q: queryText || undefined,
      place: place || undefined,
      status: status || undefined,
      activityType: activityType || undefined,
      createdById: createdById || undefined,
      from: fromDate ? fromInput(`${fromDate}T00:00`) : undefined,
      to: toDate ? fromInput(`${toDate}T23:59`) : undefined,
    })}`;
    download(path, `citas-agenda-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="space-y-6">
      {/* Selector de pestañas */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('search')}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              activeTab === 'search'
                ? 'bg-blue-900 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
            }`}
          >
            🔍 Búsqueda de Citas
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              activeTab === 'reports'
                ? 'bg-blue-900 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
            }`}
          >
            📊 Reportes y Estadísticas
          </button>
        </div>

        {activeTab === 'search' && (
          <button onClick={exportCsv} className={btn.secondary}>
            📥 Exportar resultados a CSV
          </button>
        )}
      </div>

      {activeTab === 'search' && (
        <div className="space-y-4">
          {/* Formulario de filtros */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
              Filtros de Búsqueda
            </h2>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Texto (Título o Solicitante)
                </label>
                <input
                  type="text"
                  placeholder="Ej: Ministerio, Gremio..."
                  className={input}
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Lugar</label>
                <input
                  type="text"
                  placeholder="Ej: Local central..."
                  className={input}
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Estado</label>
                <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">Todos los estados</option>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Actividad
                </label>
                <select
                  className={input}
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value)}
                >
                  <option value="">Todas las actividades</option>
                  {Object.entries(ACTIVITY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Desde fecha (Lima)
                </label>
                <input
                  type="date"
                  className={input}
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Hasta fecha (Lima)
                </label>
                <input
                  type="date"
                  className={input}
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Responsable
                </label>
                <select
                  className={input}
                  value={createdById}
                  onChange={(e) => setCreatedById(e.target.value)}
                >
                  <option value="">Todos los responsables</option>
                  {(dirQuery.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setQueryText('');
                    setPlace('');
                    setStatus('');
                    setActivityType('');
                    setCreatedById('');
                    setFromDate('');
                    setToDate('');
                  }}
                  className={`${btn.secondary} w-full`}
                >
                  Limpiar filtros
                </button>
              </div>
            </div>
          </div>

          {/* Tabla de Resultados */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <span className="text-sm font-bold text-slate-800">
                Resultados ({searchQuery.data?.length ?? 0} citas encontradas)
              </span>
              <span className="text-xs text-slate-500">
                Los datos de contacto se muestran según sus permisos de acceso
              </span>
            </div>

            {searchQuery.isLoading ? (
              <div className="p-6">
                <Loading />
              </div>
            ) : searchQuery.isError ? (
              <div className="p-4">
                <ErrorBox error={searchQuery.error} />
              </div>
            ) : (searchQuery.data?.length ?? 0) === 0 ? (
              <div className="p-6 text-center">
                <Empty>No se encontraron citas con los filtros especificados.</Empty>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2.5">Horario (Lima)</th>
                      <th className="px-3 py-2.5">Compromiso</th>
                      <th className="px-3 py-2.5">Solicitante</th>
                      <th className="px-3 py-2.5">Lugar</th>
                      <th className="px-3 py-2.5">Estado</th>
                      <th className="px-3 py-2.5">Prioridad</th>
                      <th className="px-3 py-2.5">Responsable</th>
                      <th className="px-3 py-2.5 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {searchQuery.data?.map((a) => (
                      <tr
                        key={a.id}
                        className="hover:bg-blue-50/40 cursor-pointer transition"
                        onClick={() => setSelectedApptId(a.id)}
                      >
                        <td className="px-3 py-2.5 font-medium text-slate-900 whitespace-nowrap">
                          {fmtRange(a.startsAt, a.endsAt)}
                        </td>
                        <td className="px-3 py-2.5 font-bold text-slate-900">
                          {a.title}
                          {a.rescheduledFromId && (
                            <span className="ml-1 text-[10px] text-violet-700 font-semibold bg-violet-50 px-1 py-0.5 rounded">
                              Reprogramada
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">
                          <div>{a.requesterName}</div>
                          {a.requesterPhone && (
                            <div className="text-[11px] text-slate-500">📞 {a.requesterPhone}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">
                          {a.place} ({a.modality.toLowerCase()})
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <StatusBadge status={a.status} />
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <PriorityTag priority={a.priority} />
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                          {a.createdBy.name}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <button
                            className="font-semibold text-blue-900 hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedApptId(a.id);
                            }}
                          >
                            Ver →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="space-y-6">
          <Card title="Generador de Reportes de Citas">
            <div className="flex flex-wrap items-end gap-3 pb-4 border-b border-slate-100">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Agrupar por
                </label>
                <select
                  className={input}
                  value={granularity}
                  onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')}
                >
                  <option value="day">Día</option>
                  <option value="week">Semana</option>
                  <option value="month">Mes</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Desde fecha
                </label>
                <input
                  type="date"
                  className={input}
                  value={repFrom}
                  onChange={(e) => setRepFrom(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Hasta fecha
                </label>
                <input
                  type="date"
                  className={input}
                  value={repTo}
                  onChange={(e) => setRepTo(e.target.value)}
                />
              </div>
            </div>

            {summaryQuery.isLoading ? (
              <Loading />
            ) : summaryQuery.isError ? (
              <ErrorBox error={summaryQuery.error} />
            ) : summaryQuery.data ? (
              <div className="mt-4 space-y-6">
                {/* Resumen total */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-center">
                  <div className="rounded-lg bg-blue-50 p-3 border border-blue-200">
                    <div className="text-xs font-semibold text-blue-900 uppercase">Total Citas</div>
                    <div className="text-2xl font-black text-blue-900">
                      {summaryQuery.data.total}
                    </div>
                  </div>
                  {Object.entries(STATUS_LABEL).map(([st, label]) => (
                    <div key={st} className="rounded-lg bg-slate-50 p-3 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-700 uppercase">{label}</div>
                      <div className="text-2xl font-bold text-slate-900">
                        {summaryQuery.data?.totals[st] ?? 0}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tabla por intervalos */}
                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-semibold uppercase">
                      <tr>
                        <th className="px-3 py-2">Periodo</th>
                        {Object.entries(STATUS_LABEL).map(([st, label]) => (
                          <th key={st} className="px-3 py-2 text-center">
                            {label}
                          </th>
                        ))}
                        <th className="px-3 py-2 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(summaryQuery.data.buckets).map(([period, counts]) => {
                        const subtotal = Object.values(counts).reduce((a, b) => a + b, 0);
                        return (
                          <tr key={period} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-bold text-slate-900">{period}</td>
                            {Object.keys(STATUS_LABEL).map((st) => (
                              <td key={st} className="px-3 py-2 text-center">
                                {counts[st] ?? 0}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-right font-black text-slate-900">
                              {subtotal}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      )}

      {selectedApptId && (
        <AppointmentDetail id={selectedApptId} onClose={() => setSelectedApptId(null)} />
      )}
    </div>
  );
}
