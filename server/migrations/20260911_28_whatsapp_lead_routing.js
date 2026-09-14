export const version = "20260911_28_whatsapp_lead_routing";
export const description = "Destino de funil/etapa para leads criados pelo WhatsApp e suporte a reconciliacao LID";

export async function up({ addColumnIfMissing }) {
  await addColumnIfMissing("whatsapp_accounts", "lead_pipeline_id", "VARCHAR(64) NOT NULL DEFAULT '' AFTER display_name");
  await addColumnIfMissing("whatsapp_accounts", "lead_pipeline_stage_id", "VARCHAR(64) NOT NULL DEFAULT '' AFTER lead_pipeline_id");
}
