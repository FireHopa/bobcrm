-- Executar somente após reverter o código para uma versão que não use as colunas *_dt.
DROP TRIGGER IF EXISTS trg_tasks_datetime_bridge_bu;
DROP TRIGGER IF EXISTS trg_tasks_datetime_bridge_bi;
DROP TRIGGER IF EXISTS trg_leads_datetime_bridge_bu;
DROP TRIGGER IF EXISTS trg_leads_datetime_bridge_bi;

ALTER TABLE tasks
  DROP INDEX idx_tasks_completed_dt,
  DROP INDEX idx_tasks_status_due_dt,
  DROP INDEX idx_tasks_responsible_due_dt,
  DROP COLUMN updated_at_dt,
  DROP COLUMN created_at_dt,
  DROP COLUMN completed_at_dt,
  DROP COLUMN due_at_dt;

ALTER TABLE leads
  DROP INDEX idx_leads_stalled_dt,
  DROP INDEX idx_leads_expected_close_dt,
  DROP INDEX idx_leads_next_contact_dt,
  DROP COLUMN updated_at_dt,
  DROP COLUMN created_at_dt,
  DROP COLUMN expected_close_at_dt,
  DROP COLUMN next_contact_at_dt;
