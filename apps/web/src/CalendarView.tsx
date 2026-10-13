import { useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import esLocale from '@fullcalendar/core/locales/es';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from './api';
import {
  ActivityType,
  ACTIVITY_LABEL,
  Appointment,
  Block,
  BLOCK_LABEL,
  Status,
  STATUS_LABEL,
} from './types';
import { STATUS_STYLE, btn, input } from './ui';
import { fromWallDate, limaToday, toInput, toLimaWall } from './time';
import { AppointmentDetail } from './AppointmentDetail';
import { AppointmentForm } from './AppointmentForm';
import { BlockModal } from './BlockModal';
import { useAuth } from './auth';

interface DirectoryUser {
  id: string;
  name: string;
}

export function CalendarView() {
  const { user } = useAuth();
  const calendarRef = useRef<FullCalendar>(null);

  // Filters state
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedActivity, setSelectedActivity] = useState<string>('ALL');
  const [selectedUser, setSelectedUser] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [selectedApptId, setSelectedApptId] = useState<string | null>(null);
  const [creatingRange, setCreatingRange] = useState<{ start: string; end: string } | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [viewDate, setViewDate] = useState<string>(limaToday());

  // Directory for user filter
  const dirQuery = useQuery({
    queryKey: ['directory'],
    queryFn: () => api<DirectoryUser[]>('/api/directory'),
  });

  // Query appointments for a generous range (surrounding 6 months)
  const apptsQuery = useQuery({
    queryKey: ['appointments-calendar'],
    queryFn: () =>
      api<Appointment[]>(
        `/api/appointments${qs({
          limit: 1000,
        })}`,
      ),
  });

  // Query schedule blocks
  const blocksQuery = useQuery({
    queryKey: ['blocks-calendar'],
    queryFn: () => api<Block[]>('/api/blocks'),
  });

  // Filtered appointments
  const filteredAppointments = useMemo(() => {
    let list = apptsQuery.data ?? [];
    if (selectedStatus !== 'ALL') {
      list = list.filter((a) => a.status === selectedStatus);
    }
    if (selectedActivity !== 'ALL') {
      list = list.filter((a) => a.activityType === selectedActivity);
    }
    if (selectedUser !== 'ALL') {
      list = list.filter((a) => a.createdById === selectedUser);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.requesterName.toLowerCase().includes(q) ||
          a.place.toLowerCase().includes(q),
      );
    }
    return list;
  }, [apptsQuery.data, selectedStatus, selectedActivity, selectedUser, searchQuery]);

  // FullCalendar event items
  const events = useMemo(() => {
    const apptEvents = filteredAppointments.map((a) => {
      const st = STATUS_STYLE[a.status];
      return {
        id: `appt:${a.id}`,
        title: `${st.icon} ${a.title}`,
        start: toLimaWall(a.startsAt),
        end: toLimaWall(a.endsAt),
        backgroundColor: st.bg,
        borderColor: st.border,
        textColor: st.text,
        classNames: [`st-${a.status}`],
        extendedProps: {
          type: 'appointment',
          appointment: a,
        },
      };
    });

    const blockEvents = (blocksQuery.data ?? []).map((b) => ({
      id: `block:${b.id}`,
      title: `🔒 [${BLOCK_LABEL[b.type]}] ${b.title}`,
      start: toLimaWall(b.startsAt),
      end: toLimaWall(b.endsAt),
      backgroundColor: '#f1f5f9',
      borderColor: '#475569',
      textColor: '#0f172a',
      classNames: ['is-block'],
      extendedProps: {
        type: 'block',
        block: b,
      },
    }));

    return [...apptEvents, ...blockEvents];
  }, [filteredAppointments, blocksQuery.data]);

  const handleDateSelect = (selectInfo: { start: Date; end: Date; allDay: boolean }) => {
    const startIso = fromWallDate(selectInfo.start).toISOString();
    let endIso = fromWallDate(selectInfo.end).toISOString();
    if (selectInfo.allDay) {
      // Si hizo clic en vista mensual/día completo, predeterminar 10:00 a 10:45 hora Lima
      const dayStr = toLimaWall(startIso).slice(0, 10);
      setCreatingRange({
        start: `${dayStr}T10:00`,
        end: `${dayStr}T10:45`,
      });
    } else {
      setCreatingRange({
        start: toInput(startIso),
        end: toInput(endIso),
      });
    }
  };

  const handleEventClick = (clickInfo: { event: { extendedProps: Record<string, unknown> } }) => {
    const ep = clickInfo.event.extendedProps;
    if (ep.type === 'appointment') {
      const a = ep.appointment as Appointment;
      setSelectedApptId(a.id);
    }
  };

  const jumpToDate = (d: string) => {
    if (!d) return;
    setViewDate(d);
    calendarRef.current?.getApi().gotoDate(d);
  };

  return (
    <div className="space-y-4">
      {/* Barra superior de controles y filtros */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                const now = new Date(Date.now() + 30 * 60000).toISOString();
                const end = new Date(Date.now() + 75 * 60000).toISOString();
                setCreatingRange({ start: toInput(now), end: toInput(end) });
              }}
              className={btn.primary}
            >
              ＋ Nueva cita
            </button>
            {user?.role === 'ADMIN' && (
              <button onClick={() => setShowBlockModal(true)} className={btn.secondary}>
                🔒 Bloquear horario
              </button>
            )}
            <div className="h-6 w-px bg-slate-300" />
            <button
              onClick={() => {
                calendarRef.current?.getApi().today();
                setViewDate(limaToday());
              }}
              className={btn.secondary}
            >
              Hoy
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => calendarRef.current?.getApi().prev()}
                aria-label="Anterior"
                className="rounded-md border border-slate-300 px-2.5 py-1 text-sm font-bold hover:bg-slate-100"
              >
                ‹
              </button>
              <button
                onClick={() => calendarRef.current?.getApi().next()}
                aria-label="Siguiente"
                className="rounded-md border border-slate-300 px-2.5 py-1 text-sm font-bold hover:bg-slate-100"
              >
                ›
              </button>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <label htmlFor="jump-date" className="text-xs font-medium text-slate-600">
                Ir a:
              </label>
              <input
                id="jump-date"
                type="date"
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                value={viewDate}
                onChange={(e) => jumpToDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              Agenda compartida · Zona Horaria: <strong>America/Lima (UTC-5)</strong>
            </span>
          </div>
        </div>

        {/* Filtros de calendario */}
        <div className="grid grid-cols-1 gap-2 pt-2 border-t border-slate-100 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-0.5">Búsqueda rápida</label>
            <input
              type="text"
              placeholder="Buscar por título, solicitante, lugar..."
              className={input}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-0.5">Estado</label>
            <select
              className={input}
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="ALL">Todos los estados</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-0.5">Tipo de actividad</label>
            <select
              className={input}
              value={selectedActivity}
              onChange={(e) => setSelectedActivity(e.target.value)}
            >
              <option value="ALL">Todas las actividades</option>
              {Object.entries(ACTIVITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-0.5">Responsable</label>
            <select
              className={input}
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
            >
              <option value="ALL">Todos los responsables</option>
              {(dirQuery.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Leyenda accesible */}
        <div className="flex flex-wrap items-center gap-3 pt-2 text-xs border-t border-slate-100">
          <span className="font-semibold text-slate-700">Leyenda:</span>
          {Object.entries(STATUS_STYLE).map(([stKey, s]) => (
            <span key={stKey} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-3 w-3 rounded-full border"
                style={{ backgroundColor: s.bg, borderColor: s.border }}
              />
              <span className="font-medium text-slate-700">
                {s.icon} {STATUS_LABEL[stKey as Status]}
              </span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border border-slate-500 bg-slate-200" />
            <span className="font-medium text-slate-700">🔒 Bloqueo de agenda</span>
          </span>
        </div>
      </div>

      {/* Calendario principal */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: '',
            center: 'title',
            right: 'timeGridDay,timeGridWeek,dayGridMonth,listWeek',
          }}
          buttonText={{
            timeGridDay: 'Día',
            timeGridWeek: 'Semana',
            dayGridMonth: 'Mes',
            listWeek: 'Agenda cronológica',
          }}
          locale={esLocale}
          firstDay={1} // Lunes
          slotMinTime="06:00:00"
          slotMaxTime="23:30:00"
          slotDuration="00:15:00"
          slotLabelInterval="01:00"
          allDaySlot={false}
          nowIndicator={true}
          selectable={true}
          selectMirror={true}
          weekends={true}
          events={events}
          select={handleDateSelect}
          eventClick={handleEventClick}
          eventContent={(arg) => {
            const ep = arg.event.extendedProps;
            if (ep.type === 'appointment') {
              const a = ep.appointment as Appointment;
              return (
                <div className="overflow-hidden p-0.5 leading-tight text-xs">
                  <div className="font-bold ev-title">{arg.event.title}</div>
                  <div className="text-[10px] text-slate-700 opacity-90 truncate">
                    📍 {a.place} ({a.requesterName})
                  </div>
                </div>
              );
            }
            return (
              <div className="p-0.5 text-xs font-semibold">
                {arg.event.title}
              </div>
            );
          }}
          height="auto"
        />
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
