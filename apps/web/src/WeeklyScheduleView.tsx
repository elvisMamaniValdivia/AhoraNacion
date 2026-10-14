import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from './api';
import { Appointment, Block, BLOCK_LABEL } from './types';
import { fmtTime, limaToday, toInput } from './time';
import { btn, Loading } from './ui';
import { AppointmentDetail } from './AppointmentDetail';
import { AppointmentForm } from './AppointmentForm';
import { BlockModal } from './BlockModal';
import { useAuth } from './auth';

const DAYS_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const STANDARD_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Retorna la fecha YYYY-MM-DD del Lunes de la semana que contiene dateStr */
function getMonday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = date.getUTCDay(); // 0 is Sunday, 1 is Monday
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

/** Suma días en formato YYYY-MM-DD */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function WeeklyScheduleView() {
  const { user } = useAuth();
  const [anchorDate, setAnchorDate] = useState<string>(limaToday());
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(() => {
    const today = limaToday();
    const monday = getMonday(today);
    for (let i = 0; i < 7; i++) {
      if (addDays(monday, i) === today) return i;
    }
    return 0;
  });

  const [selectedApptId, setSelectedApptId] = useState<string | null>(null);
  const [creatingRange, setCreatingRange] = useState<{ start: string; end: string } | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [show24h, setShow24h] = useState(false);

  const activeHours = show24h ? ALL_HOURS : STANDARD_HOURS;

  // Calcular los 7 días de la semana (Lunes a Domingo)
  const mondayStr = useMemo(() => getMonday(anchorDate), [anchorDate]);
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const dStr = addDays(mondayStr, i);
      const [, m, d] = dStr.split('-');
      return {
        dateStr: dStr,
        dayName: DAYS_NAMES[i],
        shortDate: `${d}/${m}`,
        dayNumber: d,
        isToday: dStr === limaToday(),
      };
    });
  }, [mondayStr]);

  const sundayStr = weekDays[6].dateStr;
  const selectedDay = weekDays[selectedDayIdx] ?? weekDays[0];

  // Cargar citas
  const apptsQuery = useQuery({
    queryKey: ['appointments-weekly'],
    queryFn: () =>
      api<Appointment[]>(
        `/api/appointments${qs({
          limit: 1000,
        })}`,
      ),
  });

  // Cargar bloqueos
  const blocksQuery = useQuery({
    queryKey: ['blocks-weekly'],
    queryFn: () => api<Block[]>('/api/blocks'),
  });

  const nowMs = Date.now();

  // Filtrar citas activas
  const appointments = useMemo(() => {
    return (apptsQuery.data ?? []).filter((a) => a.status !== 'CANCELADA');
  }, [apptsQuery.data]);

  const blocks = useMemo(() => {
    return blocksQuery.data ?? [];
  }, [blocksQuery.data]);

  // Contadores de la semana
  const weekStats = useMemo(() => {
    let concluded = 0;
    let reschedule = 0;
    let confirmed = 0;
    let total = 0;

    const startWeekIso = `${mondayStr}T00:00:00-05:00`;
    const endWeekIso = `${sundayStr}T23:59:59-05:00`;
    const startWeekMs = new Date(startWeekIso).getTime();
    const endWeekMs = new Date(endWeekIso).getTime();

    appointments.forEach((a) => {
      const aStart = new Date(a.startsAt).getTime();
      if (aStart >= startWeekMs && aStart <= endWeekMs) {
        total++;
        const aEnd = new Date(a.endsAt).getTime();
        const isPast = aEnd < nowMs;
        if (a.status === 'REALIZADA' || (isPast && a.status !== 'PENDIENTE' && a.status !== 'REPROGRAMADA')) {
          concluded++;
        } else if (a.status === 'REPROGRAMADA' || a.status === 'PENDIENTE') {
          reschedule++;
        } else if (a.status === 'CONFIRMADA') {
          confirmed++;
        }
      }
    });

    return { total, concluded, reschedule, confirmed };
  }, [appointments, mondayStr, sundayStr, nowMs]);

  const handleSlotClick = (dateStr: string, hour: number) => {
    const padHour = String(hour).padStart(2, '0');
    const start = `${dateStr}T${padHour}:00`;
    const endHour = String(hour + 1).padStart(2, '0');
    const end = `${dateStr}T${endHour}:00`;
    setCreatingRange({ start, end });
  };

  if (apptsQuery.isLoading || blocksQuery.isLoading) {
    return <Loading />;
  }

  return (
    <div className="space-y-4 max-w-full overflow-hidden">
      {/* Barra superior de controles y navegación semanal */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4 shadow-sm space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <span className="text-[11px] font-black uppercase tracking-wider text-red-600 block">
              Horario Semanal del Candidato
            </span>
            <h2 className="text-lg sm:text-xl font-black text-slate-800">
              {weekDays[0].dayName} {weekDays[0].shortDate} al {weekDays[6].dayName} {weekDays[6].shortDate}
            </h2>
            <p className="text-[11px] text-slate-500">
              Hora oficial: <strong>America/Lima (UTC-5)</strong> · Horarios sin solapamiento
            </p>
          </div>

          {/* Botones de navegación semanal */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => {
                setAnchorDate(addDays(anchorDate, -7));
              }}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition shadow-xs"
            >
              ◀ Ant.
            </button>
            <button
              onClick={() => {
                const today = limaToday();
                setAnchorDate(today);
                const monday = getMonday(today);
                for (let i = 0; i < 7; i++) {
                  if (addDays(monday, i) === today) setSelectedDayIdx(i);
                }
              }}
              className="rounded-lg border border-red-600 bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 transition shadow-xs"
            >
              Esta semana
            </button>
            <button
              onClick={() => {
                setAnchorDate(addDays(anchorDate, 7));
              }}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition shadow-xs"
            >
              Sig. ▶
            </button>

            <button
              onClick={() => setShow24h(!show24h)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition shadow-xs ${
                show24h
                  ? 'border-purple-600 bg-purple-50 text-purple-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {show24h ? '🌙 24H' : '☀️ Horario Normal'}
            </button>

            <button
              onClick={() => {
                const now = new Date(Date.now() + 15 * 60000).toISOString();
                const end = new Date(Date.now() + 60 * 60000).toISOString();
                setCreatingRange({ start: toInput(now), end: toInput(end) });
              }}
              className={btn.primary}
            >
              ＋ Cita
            </button>

            {user?.role === 'ADMIN' && (
              <button onClick={() => setShowBlockModal(true)} className={btn.secondary}>
                🔒 Bloquear
              </button>
            )}
          </div>
        </div>

        {/* Leyenda visual exacta requerida por el usuario */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="font-bold text-slate-800">Colores:</span>
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                🟢 Disponible
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-red-800">
                <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
                🔴 Concluido
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-orange-800">
                <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
                🟠 Reagendar
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-blue-800">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
                🔵 Confirmada
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-purple-800">
                <span className="h-2.5 w-2.5 rounded-full bg-purple-600" />
                🟣 Especial
              </span>
            </div>

            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
              <span>Total: <strong className="text-slate-900">{weekStats.total}</strong></span>
              <span>· Concluidas: <strong className="text-red-700">{weekStats.concluded}</strong></span>
              <span>· Por reagendar: <strong className="text-orange-700">{weekStats.reschedule}</strong></span>
              <span>· Confirmadas: <strong className="text-blue-700">{weekStats.confirmed}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 📱 VISTA MÓVIL (< 768px): Cero desborde, 100% fija        */}
      {/* ========================================================= */}
      <div className="block md:hidden space-y-3">
        {/* Barra superior de 7 días (Grid fijo, no se mueve la pantalla) */}
        <div className="grid grid-cols-7 gap-1 rounded-xl bg-slate-200/90 p-1 shadow-inner">
          {weekDays.map((d, idx) => {
            const isSelected = selectedDayIdx === idx;
            // Contar citas en este día
            const dayApptsCount = appointments.filter((a) => {
              const aStartMs = new Date(a.startsAt).getTime();
              const dStartMs = new Date(`${d.dateStr}T00:00:00-05:00`).getTime();
              const dEndMs = new Date(`${d.dateStr}T23:59:59-05:00`).getTime();
              return aStartMs >= dStartMs && aStartMs <= dEndMs;
            }).length;

            return (
              <button
                key={d.dateStr}
                onClick={() => setSelectedDayIdx(idx)}
                className={`flex flex-col items-center justify-center py-2 px-0.5 rounded-lg transition text-center ${
                  isSelected
                    ? 'bg-red-600 text-white font-black shadow-md ring-2 ring-red-300'
                    : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="text-[9px] uppercase font-bold tracking-tight">
                  {d.dayName.slice(0, 3)}
                </span>
                <span className="text-sm font-black leading-tight mt-0.5">
                  {d.dayNumber}
                </span>
                <div className="h-1.5 flex items-center justify-center mt-0.5">
                  {dayApptsCount > 0 ? (
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-red-600'}`} />
                  ) : (
                    <span className="inline-block h-1 w-1 rounded-full bg-slate-300" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Cabecera del día seleccionado con botones anterior / siguiente */}
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50/70 p-3 shadow-xs">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-red-600 block">
              Día Seleccionado
            </span>
            <h3 className="text-base font-black text-slate-900 leading-tight">
              {selectedDay.dayName} {selectedDay.shortDate} {selectedDay.isToday && '· (Hoy)'}
            </h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedDayIdx(Math.max(0, selectedDayIdx - 1))}
              disabled={selectedDayIdx === 0}
              aria-label="Día anterior"
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 disabled:opacity-30"
            >
              ◀
            </button>
            <button
              onClick={() => setSelectedDayIdx(Math.min(6, selectedDayIdx + 1))}
              disabled={selectedDayIdx === 6}
              aria-label="Día siguiente"
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 disabled:opacity-30"
            >
              ▶
            </button>
          </div>
        </div>

        {/* Lista horaria vertical a ancho completo (100% de la pantalla) */}
        <div className="space-y-2">
          {activeHours.map((hour) => {
            const hourLabel = `${String(hour).padStart(2, '0')}:00`;
            const nextHourLabel = `${String(hour + 1).padStart(2, '0')}:00`;
            const isSpecialHour = hour < 7 || hour >= 21;

            const slotStartIso = `${selectedDay.dateStr}T${String(hour).padStart(2, '0')}:00:00-05:00`;
            const slotEndIso = `${selectedDay.dateStr}T${String(hour + 1).padStart(2, '0')}:00:00-05:00`;
            const slotStartMs = new Date(slotStartIso).getTime();
            const slotEndMs = new Date(slotEndIso).getTime();

            // Citas
            const apptsInSlot = appointments.filter((a) => {
              const aStart = new Date(a.startsAt).getTime();
              const aEnd = new Date(a.endsAt).getTime();
              return aStart < slotEndMs && aEnd > slotStartMs;
            });

            // Bloqueos
            const blocksInSlot = blocks.filter((b) => {
              const bStart = new Date(b.startsAt).getTime();
              const bEnd = new Date(b.endsAt).getTime();
              return bStart < slotEndMs && bEnd > slotStartMs;
            });

            return (
              <div
                key={hour}
                className="flex items-stretch gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs"
              >
                {/* Columna Hora */}
                <div
                  className={`w-16 shrink-0 rounded-lg p-2 text-center flex flex-col items-center justify-center font-mono ${
                    isSpecialHour ? 'bg-purple-100 text-purple-900 border border-purple-300' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  <span className="text-xs font-black">{hourLabel}</span>
                  <span className="text-[9px] text-slate-500">{nextHourLabel}</span>
                  {isSpecialHour && <span className="text-[8px] font-black text-purple-700 uppercase">Especial</span>}
                </div>

                {/* Columna Contenido */}
                <div className="flex-1 min-w-0">
                  {blocksInSlot.length > 0 ? (
                    <div className="rounded-lg border border-slate-300 bg-slate-100 p-2 text-xs text-slate-800">
                      <div className="font-bold flex items-center gap-1 truncate">
                        <span>🔒</span>
                        <span>[{BLOCK_LABEL[blocksInSlot[0].type]}] {blocksInSlot[0].title}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {fmtTime(blocksInSlot[0].startsAt)} - {fmtTime(blocksInSlot[0].endsAt)}
                      </div>
                    </div>
                  ) : apptsInSlot.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {apptsInSlot.map((a) => {
                        const aEndMs = new Date(a.endsAt).getTime();
                        const isPast = aEndMs < nowMs;

                        let cardCls = '';
                        let badgeCls = '';
                        let statusTag = '';

                        if (a.status === 'REALIZADA' || (isPast && a.status !== 'PENDIENTE' && a.status !== 'REPROGRAMADA')) {
                          cardCls = 'border-2 border-red-500 bg-red-50 text-red-950';
                          badgeCls = 'bg-red-600 text-white';
                          statusTag = '🔴 Concluido';
                        } else if (a.status === 'REPROGRAMADA' || a.status === 'PENDIENTE') {
                          cardCls = 'border-2 border-orange-500 bg-orange-50 text-orange-950';
                          badgeCls = 'bg-orange-600 text-white';
                          statusTag = '🟠 Reagendar';
                        } else if (isSpecialHour) {
                          cardCls = 'border-2 border-purple-500 bg-purple-50 text-purple-950';
                          badgeCls = 'bg-purple-700 text-white';
                          statusTag = '🟣 Horario Especial';
                        } else {
                          cardCls = 'border-2 border-blue-500 bg-blue-50 text-blue-950';
                          badgeCls = 'bg-blue-600 text-white';
                          statusTag = '🔵 Confirmada';
                        }

                        return (
                          <button
                            key={a.id}
                            onClick={() => setSelectedApptId(a.id)}
                            className={`w-full text-left rounded-lg p-2.5 transition active:scale-[0.99] ${cardCls}`}
                          >
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${badgeCls}`}>
                                {statusTag}
                              </span>
                              <span className="font-mono text-[10px] font-bold text-slate-700">
                                {fmtTime(a.startsAt)} - {fmtTime(a.endsAt)}
                              </span>
                            </div>
                            <div className="text-xs font-black text-slate-900 leading-snug truncate">
                              {a.title}
                            </div>
                            <div className="text-[11px] text-slate-700 truncate mt-0.5">
                              👤 {a.requesterName}
                            </div>
                            {a.place && (
                              <div className="text-[10px] text-slate-600 truncate mt-0.5">
                                📍 {a.place}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <button
                      onClick={() => handleSlotClick(selectedDay.dateStr, hour)}
                      className="w-full h-full min-h-[46px] flex items-center justify-between rounded-lg border border-dashed border-emerald-400 bg-emerald-50/70 px-3 py-2 text-emerald-800 transition active:bg-emerald-100"
                    >
                      <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
                        <span className="h-2 w-2 rounded-full bg-emerald-600" />
                        Disponible
                      </span>
                      <span className="text-[11px] font-bold text-emerald-700 bg-white rounded-md border border-emerald-300 px-2 py-0.5 shadow-2xs">
                        ＋ Agendar
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ========================================================= */}
      {/* 💻 VISTA ESCRITORIO (>= 768px): Cuadrícula de 7 Días       */}
      {/* ========================================================= */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm max-w-full">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100 text-slate-700">
              <th className="sticky left-0 z-20 w-20 border-r border-slate-200 bg-slate-100 p-3 text-center text-xs font-bold uppercase tracking-wider">
                Hora
              </th>
              {weekDays.map((d) => (
                <th
                  key={d.dateStr}
                  className={`min-w-[155px] border-r border-slate-200 p-3 text-center transition ${
                    d.isToday ? 'bg-red-50/80 border-b-2 border-b-red-600' : ''
                  }`}
                >
                  <div className={`text-sm font-black ${d.isToday ? 'text-red-700' : 'text-slate-800'}`}>
                    {d.dayName}
                  </div>
                  <div className={`text-xs ${d.isToday ? 'font-bold text-red-600' : 'text-slate-500'}`}>
                    {d.shortDate} {d.isToday && '(Hoy)'}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeHours.map((hour) => {
              const hourLabel = `${String(hour).padStart(2, '0')}:00`;
              const nextHourLabel = `${String(hour + 1).padStart(2, '0')}:00`;
              const isSpecialHour = hour < 7 || hour >= 21;

              return (
                <tr key={hour} className="border-b border-slate-200 hover:bg-slate-50/50">
                  {/* Columna de hora fija */}
                  <td className={`sticky left-0 z-10 border-r border-slate-200 p-2 text-center text-xs font-mono font-bold ${
                    isSpecialHour ? 'bg-purple-50 text-purple-900 border-r-purple-200' : 'bg-slate-50 text-slate-600'
                  }`}>
                    <div>{hourLabel}</div>
                    <div className="text-[10px] text-slate-400 font-normal">a {nextHourLabel}</div>
                    {isSpecialHour && (
                      <div className="text-[9px] font-bold text-purple-700 mt-0.5">Especial</div>
                    )}
                  </td>

                  {/* 7 días: Lunes a Domingo */}
                  {weekDays.map((d) => {
                    const slotStartIso = `${d.dateStr}T${String(hour).padStart(2, '0')}:00:00-05:00`;
                    const slotEndIso = `${d.dateStr}T${String(hour + 1).padStart(2, '0')}:00:00-05:00`;
                    const slotStartMs = new Date(slotStartIso).getTime();
                    const slotEndMs = new Date(slotEndIso).getTime();

                    // Citas en esta ranura
                    const apptsInSlot = appointments.filter((a) => {
                      const aStart = new Date(a.startsAt).getTime();
                      const aEnd = new Date(a.endsAt).getTime();
                      return aStart < slotEndMs && aEnd > slotStartMs;
                    });

                    // Bloqueos en esta ranura
                    const blocksInSlot = blocks.filter((b) => {
                      const bStart = new Date(b.startsAt).getTime();
                      const bEnd = new Date(b.endsAt).getTime();
                      return bStart < slotEndMs && bEnd > slotStartMs;
                    });

                    // Caso 1: Bloqueo de agenda
                    if (blocksInSlot.length > 0) {
                      const b = blocksInSlot[0];
                      return (
                        <td key={d.dateStr} className="border-r border-slate-200 p-1.5 align-top">
                          <div className="h-full rounded-lg border-2 border-slate-400 bg-slate-100 p-2 text-xs text-slate-800 shadow-sm">
                            <div className="font-bold flex items-center gap-1">
                              <span>🔒</span>
                              <span className="truncate">[{BLOCK_LABEL[b.type]}] {b.title}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 mt-1">
                              {fmtTime(b.startsAt)} - {fmtTime(b.endsAt)}
                            </div>
                          </div>
                        </td>
                      );
                    }

                    // Caso 2: Citas
                    if (apptsInSlot.length > 0) {
                      return (
                        <td key={d.dateStr} className="border-r border-slate-200 p-1.5 align-top">
                          <div className="flex flex-col gap-1.5">
                            {apptsInSlot.map((a) => {
                              const aEndMs = new Date(a.endsAt).getTime();
                              const isPast = aEndMs < nowMs;

                              let cardCls = '';
                              let badgeCls = '';
                              let statusTag = '';

                              if (a.status === 'REALIZADA' || (isPast && a.status !== 'PENDIENTE' && a.status !== 'REPROGRAMADA')) {
                                cardCls = 'border-2 border-red-500 bg-red-50 text-red-950 hover:bg-red-100 shadow-sm';
                                badgeCls = 'bg-red-600 text-white';
                                statusTag = '🔴 Ya concluido';
                              } else if (a.status === 'REPROGRAMADA' || a.status === 'PENDIENTE') {
                                cardCls = 'border-2 border-orange-500 bg-orange-50 text-orange-950 hover:bg-orange-100 shadow-sm';
                                badgeCls = 'bg-orange-600 text-white';
                                statusTag = '🟠 Reagendar';
                              } else if (isSpecialHour) {
                                cardCls = 'border-2 border-purple-500 bg-purple-50 text-purple-950 hover:bg-purple-100 shadow-sm';
                                badgeCls = 'bg-purple-700 text-white';
                                statusTag = '🟣 Horario Especial';
                              } else {
                                cardCls = 'border-2 border-blue-500 bg-blue-50 text-blue-950 hover:bg-blue-100 shadow-sm';
                                badgeCls = 'bg-blue-600 text-white';
                                statusTag = '🔵 Confirmada';
                              }

                              return (
                                <button
                                  key={a.id}
                                  onClick={() => setSelectedApptId(a.id)}
                                  className={`w-full text-left rounded-lg p-2 text-xs transition cursor-pointer ${cardCls}`}
                                  title="Haga clic para ver detalles o reagendar"
                                >
                                  <div className="flex items-center justify-between gap-1 mb-1">
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badgeCls}`}>
                                      {statusTag}
                                    </span>
                                    <span className="font-mono text-[10px] font-semibold opacity-80">
                                      {fmtTime(a.startsAt)} - {fmtTime(a.endsAt)}
                                    </span>
                                  </div>
                                  <div className="font-bold line-clamp-1 text-slate-900 leading-tight">
                                    {a.title}
                                  </div>
                                  <div className="text-[11px] text-slate-700 truncate mt-0.5">
                                    👤 {a.requesterName}
                                  </div>
                                  {a.place && (
                                    <div className="text-[10px] text-slate-600 truncate mt-0.5">
                                      📍 {a.place}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      );
                    }

                    // Caso 3: Horario disponible (VERDE)
                    return (
                      <td key={d.dateStr} className="border-r border-slate-200 p-1.5 align-top">
                        <button
                          onClick={() => handleSlotClick(d.dateStr, hour)}
                          className="group flex h-16 w-full flex-col items-center justify-center rounded-lg border border-dashed border-emerald-400 bg-emerald-50/70 p-2 text-emerald-800 transition hover:border-emerald-600 hover:bg-emerald-100 hover:shadow-sm"
                          title={`Disponible el ${d.dayName} ${d.shortDate} a las ${hourLabel}. Haga clic para agendar.`}
                        >
                          <span className="flex items-center gap-1 text-xs font-bold text-emerald-800 group-hover:scale-105 transition-transform">
                            🟢 Disponible
                          </span>
                          <span className="text-[11px] text-emerald-700 opacity-80 font-medium group-hover:opacity-100">
                            ＋ Agendar {hourLabel}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modales */}
      {selectedApptId && (
        <AppointmentDetail id={selectedApptId} onClose={() => setSelectedApptId(null)} />
      )}

      {creatingRange && (
        <AppointmentForm
          prefill={creatingRange}
          onClose={() => setCreatingRange(null)}
          onSaved={(newAppt) => {
            setCreatingRange(null);
            setSelectedApptId(newAppt.id);
          }}
        />
      )}

      {showBlockModal && <BlockModal onClose={() => setShowBlockModal(false)} />}
    </div>
  );
}
