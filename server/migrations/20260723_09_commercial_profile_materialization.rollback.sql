-- ROLLBACK MANUAL DA FASE 2
-- Execute somente DEPOIS de restaurar o código para uma versão anterior,
-- validar backup recente e confirmar que nenhuma consulta depende destas colunas.

ALTER TABLE leads DROP INDEX idx_leads_commercial_profile_version;
ALTER TABLE leads
  DROP COLUMN has_external_agency,
  DROP COLUMN has_migration_opportunity,
  DROP COLUMN has_expansion_opportunity,
  DROP COLUMN service_unknown_count,
  DROP COLUMN service_missing_count,
  DROP COLUMN service_agency_count,
  DROP COLUMN service_casa_count,
  DROP COLUMN opportunity_score,
  DROP COLUMN lead_priority_score,
  DROP COLUMN mapping_urgency_score,
  DROP COLUMN commercial_potential_score,
  DROP COLUMN commercial_profile_updated_at,
  DROP COLUMN commercial_profile_version;

DELETE FROM schema_migrations WHERE version = '20260723_09_commercial_profile_materialization';
