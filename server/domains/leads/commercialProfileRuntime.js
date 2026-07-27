import {
  COMMERCIAL_PROFILE_DB_FIELDS,
  COMMERCIAL_PROFILE_SOURCE_FIELDS,
  COMMERCIAL_PROFILE_VERSION,
  calculateLeadCommercialProfile,
  commercialProfileToDbParams,
  rowToCommercialProfileLead,
} from "./leadCommercialProfile.js";

export function createCommercialProfileRuntime({ queryFirst, execute, nowIso, logger = console }) {
  let ready = false;

  return {
    isReady() {
      return ready;
    },

    async refreshReadiness({ logTransition = false, client } = {}) {
      const staleLead = await queryFirst(
        "SELECT id FROM leads WHERE commercial_profile_version <> ? LIMIT 1",
        [COMMERCIAL_PROFILE_VERSION],
        client,
      );
      const nextReady = !staleLead;
      if (logTransition && nextReady !== ready) {
        logger.log(nextReady
          ? "Inteligência comercial materializada: ATIVA. Resumos e filtros usarão colunas persistidas."
          : "Inteligência comercial materializada: EM BACKFILL. Consultas comerciais permanecem no modo legado até concluir 100% dos leads.");
      }
      ready = nextReady;
      return ready;
    },

    async refreshLead(leadId, client) {
      const normalizedLeadId = String(leadId || "").trim();
      if (!normalizedLeadId) return null;
      const row = await queryFirst(
        `SELECT ${COMMERCIAL_PROFILE_SOURCE_FIELDS.join(", ")} FROM leads WHERE id = ? LIMIT 1`,
        [normalizedLeadId],
        client,
      );
      if (!row) return null;

      const profile = calculateLeadCommercialProfile(rowToCommercialProfileLead(row));
      const assignments = COMMERCIAL_PROFILE_DB_FIELDS.map((field) => `${field} = ?`).join(", ");
      await execute(
        `UPDATE leads SET ${assignments} WHERE id = ?`,
        [...commercialProfileToDbParams(profile, nowIso()), normalizedLeadId],
        client,
      );
      return profile;
    },
  };
}
