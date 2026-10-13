-- Restricciones de integridad que Prisma no puede expresar.

-- 1) Intervalos válidos: el fin debe ser posterior al inicio.
ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_valid_interval CHECK ("endsAt" > "startsAt");
ALTER TABLE "ScheduleBlock"
  ADD CONSTRAINT block_valid_interval CHECK ("endsAt" > "startsAt");
ALTER TABLE "Occupancy"
  ADD CONSTRAINT occupancy_valid_interval CHECK ("endsAt" > "startsAt");

-- 2) Una ocupación pertenece exactamente a una cita o a un bloqueo.
ALTER TABLE "Occupancy"
  ADD CONSTRAINT occupancy_one_owner CHECK (
    ("kind" = 'APPOINTMENT' AND "appointmentId" IS NOT NULL AND "blockId" IS NULL)
    OR ("kind" = 'BLOCK' AND "blockId" IS NOT NULL AND "appointmentId" IS NULL)
  );

-- 3) NUNCA pueden existir dos ocupaciones que se solapen (citas y bloqueos comparten esta tabla).
--    Los rangos son semiabiertos [inicio, fin): terminar justo cuando otro empieza NO es solapamiento.
--    Es la garantía definitiva bajo concurrencia: la segunda transacción falla con SQLSTATE 23P01.
ALTER TABLE "Occupancy"
  ADD CONSTRAINT occupancy_no_overlap
  EXCLUDE USING gist (tstzrange("startsAt", "endsAt", '[)') WITH &&);

-- 4) Auditoría inmutable: se prohíbe UPDATE y DELETE.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog es de solo inserción (%)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- 5) Las citas no se eliminan definitivamente.
CREATE OR REPLACE FUNCTION appointment_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Las citas no se eliminan; cámbiele el estado' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appointment_no_delete
  BEFORE DELETE ON "Appointment"
  FOR EACH ROW EXECUTE FUNCTION appointment_no_delete();

-- 6) Búsqueda rápida por texto.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX appointment_title_trgm ON "Appointment" USING gin ("title" gin_trgm_ops);
CREATE INDEX appointment_requester_trgm ON "Appointment" USING gin ("requesterName" gin_trgm_ops);
CREATE INDEX appointment_place_trgm ON "Appointment" USING gin ("place" gin_trgm_ops);
