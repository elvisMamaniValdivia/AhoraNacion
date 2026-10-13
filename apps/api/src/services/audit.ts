import { Tx } from '../db';

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  changes?: unknown;
  reason?: string | null;
}

export async function audit(db: Tx, a: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: a.actorId ?? null,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      changes: (a.changes ?? undefined) as never,
      reason: a.reason ?? null,
    },
  });
}

/** Devuelve solo los campos que cambiaron: { campo: { de, a } } */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): Record<string, { de: unknown; a: unknown }> {
  const out: Record<string, { de: unknown; a: unknown }> = {};
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
  for (const f of fields) {
    const b = norm(before[f]);
    const a = norm(after[f]);
    if (JSON.stringify(b) !== JSON.stringify(a)) out[f] = { de: b, a };
  }
  return out;
}
