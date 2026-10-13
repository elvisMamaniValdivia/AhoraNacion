export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const forbidden = (msg = 'No tiene permiso para realizar esta acción.') =>
  new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'No se encontró el recurso solicitado.') =>
  new HttpError(404, 'NOT_FOUND', msg);
export const badRequest = (msg: string, details?: unknown) =>
  new HttpError(400, 'BAD_REQUEST', msg, details);
export const unprocessable = (msg: string, details?: unknown) =>
  new HttpError(422, 'INVALID_INTERVAL', msg, details);
