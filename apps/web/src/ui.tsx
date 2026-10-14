import { ReactNode, useEffect, useId, useRef } from 'react';
import { ApiError } from './api';
import { Status, STATUS_LABEL, Priority, PRIORITY_LABEL } from './types';

/** Estados: color + símbolo + texto (nunca solo color). Contrastes AA sobre fondo claro. */
export const STATUS_STYLE: Record<Status, { icon: string; cls: string; bg: string; border: string; text: string }> = {
  PENDIENTE: { icon: '◔', cls: 'bg-amber-100 text-amber-900 border-amber-600', bg: '#fef3c7', border: '#d97706', text: '#92400e' },
  CONFIRMADA: { icon: '✔', cls: 'bg-blue-100 text-blue-900 border-blue-600', bg: '#dbeafe', border: '#2563eb', text: '#1e40af' },
  REALIZADA: { icon: '●', cls: 'bg-red-100 text-red-900 border-red-600', bg: '#fee2e2', border: '#dc2626', text: '#991b1b' },
  CANCELADA: { icon: '✕', cls: 'bg-slate-100 text-slate-700 border-slate-400', bg: '#f1f5f9', border: '#94a3b8', text: '#475569' },
  REPROGRAMADA: { icon: '↻', cls: 'bg-orange-100 text-orange-900 border-orange-600', bg: '#ffedd5', border: '#ea580c', text: '#9a3412' },
};

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: Priority }) {
  const cls = priority === 'URGENTE' ? 'bg-red-700 text-white' : priority === 'ALTA' ? 'bg-orange-100 text-orange-900' : 'bg-slate-100 text-slate-700';
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{priority === 'URGENTE' ? '‼ ' : priority === 'ALTA' ? '▲ ' : ''}{PRIORITY_LABEL[priority]}</span>;
}

export const btn = {
  primary: 'inline-flex items-center justify-center gap-1 rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm',
  secondary: 'inline-flex items-center justify-center gap-1 rounded-md border border-slate-400 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50',
  danger: 'inline-flex items-center justify-center gap-1 rounded-md bg-red-800 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50',
  link: 'text-sm font-medium text-red-700 underline underline-offset-2 hover:text-red-800',
};
export const input = 'w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-base sm:text-sm placeholder:text-slate-500 disabled:bg-slate-100';

export function Field({ label, error, children, hint, className = '' }: { label: string; error?: string; hint?: string; children: (id: string, describedBy?: string) => ReactNode; className?: string }) {
  const id = useId();
  const msgId = `${id}-m`;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">{label}</label>
      {children(id, error || hint ? msgId : undefined)}
      {error ? <p id={msgId} role="alert" className="mt-1 text-xs font-medium text-red-700">{error}</p> : hint ? <p id={msgId} className="mt-1 text-xs text-slate-600">{hint}</p> : null}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-2 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-2 w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg font-bold text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition"
          >
            ✕
          </button>
        </div>
        <div className="p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : 'Ocurrió un error inesperado.';
  return <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{msg}</div>;
}

export function Card({ title, children, action, className = '' }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="py-3 text-sm text-slate-600">{children}</p>;
export const Loading = () => <p role="status" className="py-3 text-sm text-slate-600">Cargando…</p>;
