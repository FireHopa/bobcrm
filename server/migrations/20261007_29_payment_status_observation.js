export const version = "20261007_29_payment_status_observation";
export const description = "Adiciona status de pagamento e observacao aos leads";

export async function up({ addColumnIfMissing, addIndexIfMissing }) {
  await addColumnIfMissing("leads", "payment_status", "VARCHAR(40) NOT NULL DEFAULT '' AFTER commercial_notes");
  await addColumnIfMissing("leads", "observation", "MEDIUMTEXT NULL AFTER payment_status");
  await addIndexIfMissing("leads", "idx_leads_payment_status", "INDEX idx_leads_payment_status (deleted_at, payment_status, updated_at, id)");

  await addColumnIfMissing("leads_archive", "payment_status", "VARCHAR(40) NOT NULL DEFAULT '' AFTER commercial_notes");
  await addColumnIfMissing("leads_archive", "observation", "MEDIUMTEXT NULL AFTER payment_status");
  await addIndexIfMissing("leads_archive", "idx_leads_payment_status", "INDEX idx_leads_payment_status (payment_status, archived_at, id)");
}
