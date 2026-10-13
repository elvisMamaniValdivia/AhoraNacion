const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: { conflicts?: import('./types').Conflict[]; alternatives?: import('./types').Alternative[] },
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No se pudo conectar con el servidor. Verifique su conexión.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/me')) {
      window.dispatchEvent(new Event('session-expired'));
    }
    throw new ApiError(res.status, data.code ?? 'ERROR', data.message ?? 'Ocurrió un error.', data.fields, data.details);
  }
  return data as T;
}

export async function download(path: string, filename: string) {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'ERROR', 'No se pudo generar el archivo.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
