import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { DashboardView } from './DashboardView';
import { WeeklyScheduleView } from './WeeklyScheduleView';
import { CalendarView } from './CalendarView';
import { SearchView } from './SearchView';
import { AdminViews } from './AdminViews';
import { LoginView } from './LoginView';
import { AppointmentForm } from './AppointmentForm';
import { AppointmentDetail } from './AppointmentDetail';
import { fmtTime } from './time';
import { btn } from './ui';

export function App() {
  const { user, loading, logout } = useAuth();
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'schedule' | 'calendar' | 'search' | 'admin'>('schedule');
  const [showGlobalCreate, setShowGlobalCreate] = useState(false);
  const [createdApptId, setCreatedApptId] = useState<string | null>(null);
  const [nowLima, setNowLima] = useState(new Date());

  // Reloj en vivo en hora de Lima
  useEffect(() => {
    const timer = setInterval(() => setNowLima(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">
        <p className="animate-pulse font-semibold">Cargando Sistema de Agenda…</p>
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col">
      {/* Barra de Navegación Superior */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          {/* Logo y Titular */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-red-600 shadow ring-2 ring-red-100">
              <img
                src="/logo-ahora-nacion.png"
                alt="Ahora Nación"
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <span className="text-xs font-black uppercase tracking-wider text-red-600 block leading-tight">
                Ahora Nación
              </span>
              <span className="text-sm font-bold text-slate-800 leading-tight">
                Agenda del Candidato
              </span>
            </div>
          </div>

          {/* Navegación Principal */}
          <nav className="flex items-center gap-1">
            <button
              onClick={() => setCurrentTab('schedule')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                currentTab === 'schedule'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-700 hover:bg-red-50 hover:text-red-700'
              }`}
            >
              📅 Horario Semanal (Lun–Dom)
            </button>
            <button
              onClick={() => setCurrentTab('dashboard')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                currentTab === 'dashboard'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-700 hover:bg-red-50 hover:text-red-700'
              }`}
            >
              Panel Principal
            </button>
            <button
              onClick={() => setCurrentTab('calendar')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                currentTab === 'calendar'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-700 hover:bg-red-50 hover:text-red-700'
              }`}
            >
              Calendario General
            </button>
            <button
              onClick={() => setCurrentTab('search')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                currentTab === 'search'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-700 hover:bg-red-50 hover:text-red-700'
              }`}
            >
              Búsqueda y Reportes
            </button>
            {user.role === 'ADMIN' && (
              <button
                onClick={() => setCurrentTab('admin')}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  currentTab === 'admin'
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'text-slate-700 hover:bg-red-50 hover:text-red-700'
                }`}
              >
                Administración
              </button>
            )}
          </nav>

          {/* Zona de usuario y reloj */}
          <div className="flex items-center gap-3">
            {/* Reloj de Lima */}
            <div className="hidden md:flex flex-col text-right">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                Lima (UTC-5)
              </span>
              <span className="text-xs font-bold font-mono text-slate-800">
                {fmtTime(nowLima)}
              </span>
            </div>

            {/* Botón Registrar Cita Rápido */}
            <button
              onClick={() => setShowGlobalCreate(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition"
            >
              ＋ Cita
            </button>

            {/* Perfil y Salir */}
            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
              <div className="text-right">
                <div className="text-xs font-bold text-slate-900 leading-tight">{user.name}</div>
                <div className="text-[10px] text-slate-500 font-medium">
                  {user.role === 'ADMIN' ? 'Administrador' : 'Asistente'}
                </div>
              </div>
              <button
                onClick={logout}
                title="Cerrar sesión"
                className="rounded-lg border border-slate-300 p-1.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Contenido de la Pantalla */}
      <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
        {currentTab === 'schedule' && <WeeklyScheduleView />}
        {currentTab === 'dashboard' && <DashboardView />}
        {currentTab === 'calendar' && <CalendarView />}
        {currentTab === 'search' && <SearchView />}
        {currentTab === 'admin' && user.role === 'ADMIN' && <AdminViews />}
      </main>

      {/* Pie de página institucional */}
      <footer className="border-t border-slate-200 bg-white py-3 text-center text-xs text-slate-500">
        Sistema Web de Gestión de Agenda y Citas · Diseñado para Ahora Nación · Prevención Estricta de Cruces Horarios
      </footer>

      {/* Modal global de nueva cita */}
      {showGlobalCreate && (
        <AppointmentForm
          onClose={() => setShowGlobalCreate(false)}
          onSaved={(newAppt) => {
            setShowGlobalCreate(false);
            setCreatedApptId(newAppt.id);
          }}
        />
      )}

      {/* Detalle tras guardar cita */}
      {createdApptId && (
        <AppointmentDetail
          id={createdApptId}
          onClose={() => setCreatedApptId(null)}
        />
      )}
    </div>
  );
}
