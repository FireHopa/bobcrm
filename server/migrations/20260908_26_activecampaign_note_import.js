export const version = "20260908_26_activecampaign_note_import";
export const description = "Controle idempotente de notas importadas da ActiveCampaign";

export async function up({ execute }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS integration_note_imports (
      provider VARCHAR(40) NOT NULL,
      external_note_id VARCHAR(120) NOT NULL,
      external_contact_id VARCHAR(120) NOT NULL DEFAULT '',
      note_id VARCHAR(64) NOT NULL,
      lead_id VARCHAR(64) NOT NULL,
      external_updated_at VARCHAR(40) NOT NULL DEFAULT '',
      content_hash VARCHAR(64) NOT NULL DEFAULT '',
      imported_at VARCHAR(40) NOT NULL DEFAULT '',
      PRIMARY KEY (provider, external_note_id),
      INDEX idx_integration_note_imports_lead (lead_id, imported_at),
      INDEX idx_integration_note_imports_note (note_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
