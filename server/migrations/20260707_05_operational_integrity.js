export const version = "20260707_05_operational_integrity";
export const description = "Integridade de mesclagem e rastreio do lead principal";

export async function up({ addColumnIfMissing, addIndexIfMissing }) {
  await addColumnIfMissing("leads", "merged_into_lead_id", "VARCHAR(64) NOT NULL DEFAULT '' AFTER restored_by");
  await addIndexIfMissing("leads", "idx_leads_merged_into", "INDEX idx_leads_merged_into (merged_into_lead_id, deleted_at)");
}
