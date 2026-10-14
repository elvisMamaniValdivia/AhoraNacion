import { useState } from 'react';
import { useAuth } from './auth';
import { ApiError } from './api';
import { btn, ErrorBox, Field, input } from './ui';

export function LoginView() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (em: string, pw: string) => {
    setEmail(em);
    setPassword(pw);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl bg-red-600 shadow-md ring-4 ring-red-100">
            <img
              src="/logo-ahora-nacion.png"
              alt="Ahora Nación"
              className="h-full w-full object-cover"
            />
          </div>
          <span className="inline-block rounded-full bg-red-100 px-3 py-0.5 text-xs font-black uppercase tracking-wider text-red-700">
            Ahora Nación
          </span>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
            Agenda del Candidato
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Sistema Oficial de Gestión de Citas y Coordinación
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Correo electrónico institucional">
            {(id) => (
              <input
                id={id}
                type="email"
                autoComplete="email"
                required
                className={input}
                placeholder="usuario@ahoranacion.pe"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>

          <Field label="Contraseña">
            {(id) => (
              <input
                id={id}
                type="password"
                autoComplete="current-password"
                required
                className={input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>

          <ErrorBox error={error} />

          <button type="submit" disabled={loading} className={`${btn.primary} w-full py-2.5 text-base`}>
            {loading ? 'Iniciando sesión…' : 'Iniciar Sesión'}
          </button>
        </form>

        <div className="mt-6 border-t border-slate-200 pt-4 text-center">
          <p className="text-xs text-slate-500">
            Acceso restringido únicamente a usuarios autorizados por la coordinación general.
          </p>
        </div>

        {/* Cuentas de demostración rápida para pruebas locales */}
        <div className="mt-4 rounded-lg bg-slate-50 p-3 border border-slate-200 text-xs text-slate-600">
          <p className="font-semibold text-slate-800 mb-1.5">Accesos de demostración:</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => fillDemo('admin@demo.test', 'Admin-Demo-2026!')}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
            >
              Administrador
            </button>
            <button
              type="button"
              onClick={() => fillDemo('asistente1@demo.test', 'Asistente-Demo-2026!')}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
            >
              Asistente 1
            </button>
            <button
              type="button"
              onClick={() => fillDemo('asistente2@demo.test', 'Asistente-Demo-2026!')}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
            >
              Asistente 2
            </button>
            <button
              type="button"
              onClick={() => fillDemo('asistente3@demo.test', 'Asistente-Demo-2026!')}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
            >
              Asistente 3
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
