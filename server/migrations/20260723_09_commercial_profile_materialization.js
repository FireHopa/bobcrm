export const version = "20260723_09_commercial_profile_materialization";
export const description = "Materializa scores e contagens da inteligência comercial dos leads";

export async function up({ addColumnIfMissing, addIndexIfMissing }) {
  await addColumnIfMissing("leads", "commercial_profile_version", "SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER pipeline_entered_at");
  await addColumnIfMissing("leads", "commercial_profile_updated_at", "VARCHAR(40) NOT NULL DEFAULT '' AFTER commercial_profile_version");
  await addColumnIfMissing("leads", "commercial_potential_score", "TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER commercial_profile_updated_at");
  await addColumnIfMissing("leads", "mapping_urgency_score", "TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER commercial_potential_score");
  await addColumnIfMissing("leads", "lead_priority_score", "TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER mapping_urgency_score");
  await addColumnIfMissing("leads", "opportunity_score", "TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER lead_priority_score");
  await addColumnIfMissing("leads", "service_casa_count", "TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER opportunity_score");
  await addColumnIfMissing("leads", "service_agency_count", "TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER service_casa_count");
  await addColumnIfMissing("leads", "service_missing_count", "TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER service_agency_count");
  await addColumnIfMissing("leads", "service_unknown_count", "TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER service_missing_count");
  await addColumnIfMissing("leads", "has_expansion_opportunity", "TINYINT(1) NOT NULL DEFAULT 0 AFTER service_unknown_count");
  await addColumnIfMissing("leads", "has_migration_opportunity", "TINYINT(1) NOT NULL DEFAULT 0 AFTER has_expansion_opportunity");
  await addColumnIfMissing("leads", "has_external_agency", "TINYINT(1) NOT NULL DEFAULT 0 AFTER has_migration_opportunity");
  await addIndexIfMissing(
    "leads",
    "idx_leads_commercial_profile_version",
    "INDEX idx_leads_commercial_profile_version (commercial_profile_version, id)",
  );
}

// Rollback intencionalmente não é chamado pelo boot do CRM.
// Execute apenas após voltar o código para uma versão anterior e confirmar backup válido.
export async function down({ execute }) {
  await execute("ALTER TABLE leads DROP INDEX idx_leads_commercial_profile_version").catch(() => undefined);
  for (const column of [
    "has_external_agency",
    "has_migration_opportunity",
    "has_expansion_opportunity",
    "service_unknown_count",
    "service_missing_count",
    "service_agency_count",
    "service_casa_count",
    "opportunity_score",
    "lead_priority_score",
    "mapping_urgency_score",
    "commercial_potential_score",
    "commercial_profile_updated_at",
    "commercial_profile_version",
  ]) {
    await execute(`ALTER TABLE leads DROP COLUMN \`${column}\``).catch(() => undefined);
  }
}
