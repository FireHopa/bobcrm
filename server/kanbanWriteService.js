import { randomUUID } from "node:crypto";
import { buildLeadAccessSql } from "./accessControl.js";
import { rowToLead } from "./domains/leads/leadMapper.js";
import { COMMERCIAL_PROFILE_VERSION } from "./domains/leads/leadCommercialProfile.js";

export function createKanbanWriteService({
  queryRows,
  execute,
  scalar,
  getLeadAccessContext,
  getKanbanStageById,
  getStageStatusUpdate,
  recordAudit,
  nowIso,
}) {
  async function rebalanceStagePositions(stageId, client) {
    const rows = await queryRows(
      "SELECT id FROM leads WHERE pipeline_stage_id = ? AND deleted_at = '' ORDER BY kanban_position ASC, updated_at DESC, created_at DESC",
      [stageId],
      client,
    );
    const batchSize = 500;
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const cases = batch.map(() => "WHEN ? THEN ?").join(" ");
      const placeholders = batch.map(() => "?").join(", ");
      const caseParams = batch.flatMap((row, index) => [row.id, (start + index + 1) * 1000]);
      await execute(
        `UPDATE leads SET kanban_position = CASE id ${cases} ELSE kanban_position END WHERE id IN (${placeholders})`,
        [...caseParams, ...batch.map((row) => row.id)],
        client,
      );
    }
  }

  async function cancelPendingTasksForLeadIds(leadIds, reason, actor, client) {
    const ids = Array.from(new Set((leadIds || []).map((value) => String(value || "").trim()).filter(Boolean)));
    if (!ids.length) return 0;
    const placeholders = ids.map(() => "?").join(", ");
    const normalizedReason = String(reason || "Tarefa cancelada automaticamente pela regra de integridade operacional.").slice(0, 1000);
    const at = nowIso();
    const counts = await queryRows(
      `SELECT lead_id, COUNT(*) AS total FROM tasks WHERE lead_id IN (${placeholders}) AND status = 'pending' GROUP BY lead_id`,
      ids,
      client,
    );
    const result = await execute(
      `UPDATE tasks
       SET status = 'canceled', source_key = NULL,
           result = CASE WHEN TRIM(COALESCE(result, '')) = '' THEN ? ELSE CONCAT(result, '\n', ?) END,
           updated_at = ?
       WHERE lead_id IN (${placeholders}) AND status = 'pending'`,
      [normalizedReason, normalizedReason, at, ...ids],
      client,
    );

    const nextMappingUrgencySql = "LEAST(100, mapping_urgency_score + CASE WHEN TRIM(COALESCE(next_contact_at, '')) != '' THEN 15 ELSE 0 END)";
    const nextLeadPrioritySql = `LEAST(100, GREATEST(0, ROUND(commercial_potential_score * 0.65 + (${nextMappingUrgencySql}) * 0.35)))`;
    const nextOpportunityScoreSql = `LEAST(100, ROUND((${nextLeadPrioritySql}) * 0.45 + service_agency_count * 10 + service_missing_count * 8 + service_unknown_count * 4 + service_casa_count * 2))`;
    await execute(
      `UPDATE leads SET
         mapping_urgency_score = CASE WHEN commercial_profile_version = ? THEN ${nextMappingUrgencySql} ELSE mapping_urgency_score END,
         lead_priority_score = CASE WHEN commercial_profile_version = ? THEN ${nextLeadPrioritySql} ELSE lead_priority_score END,
         opportunity_score = CASE WHEN commercial_profile_version = ? THEN ${nextOpportunityScoreSql} ELSE opportunity_score END,
         commercial_profile_updated_at = CASE WHEN commercial_profile_version = ? THEN ? ELSE commercial_profile_updated_at END,
         next_contact_at = '', updated_at = ?
       WHERE deleted_at = '' AND id IN (${placeholders})`,
      [COMMERCIAL_PROFILE_VERSION, COMMERCIAL_PROFILE_VERSION, COMMERCIAL_PROFILE_VERSION, COMMERCIAL_PROFILE_VERSION, at, at, ...ids],
      client,
    );

    if (counts.length) {
      const values = counts.map(() => "(?, 'lead', ?, 'lead_tasks_canceled', ?, ?, ?, ?, ?)").join(", ");
      const auditParams = counts.flatMap((row) => [
        randomUUID(), String(row.lead_id || ""), actor?.id || "system", actor?.name || "Sistema",
        JSON.stringify({ reason: normalizedReason, affectedRows: Number(row.total || 0) }),
        `Cancelou automaticamente ${Number(row.total || 0)} tarefa(s) pendente(s)`, at,
      ]);
      await execute(
        `INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, actor_name, changes_json, summary, created_at) VALUES ${values}`,
        auditParams,
        client,
      );
    }
    return Number(result?.affectedRows || 0);
  }

  async function assignCardsInBulk({ currentUser, leadIds, pipelineId, stageId }, client) {
    const stage = await getKanbanStageById(stageId, client, { forUpdate: true });
    if (!stage || stage.pipeline_id !== pipelineId) {
      const error = new Error("Etapa de destino inválida.");
      error.statusCode = 400;
      throw error;
    }

    const accessContext = await getLeadAccessContext(currentUser, client);
    const scopedAccess = buildLeadAccessSql(accessContext.user, accessContext.teamMembers, "l");
    const idPlaceholders = leadIds.map(() => "?").join(", ");
    const sourceRows = await queryRows(
      `SELECT l.* FROM leads l WHERE l.id IN (${idPlaceholders}) AND l.deleted_at = '' AND ${scopedAccess.clause} FOR UPDATE`,
      [...leadIds, ...scopedAccess.params],
      client,
    );
    const sourceById = new Map(sourceRows.map((row) => [String(row.id), rowToLead(row)]));
    if (leadIds.some((leadId) => !sourceById.has(leadId))) {
      const error = new Error("Um ou mais leads não existem ou estão fora da carteira autorizada.");
      error.statusCode = 404;
      throw error;
    }

    const firstPosition = Number(await scalar(
      "SELECT COALESCE(MAX(kanban_position), 0) AS max_position FROM leads WHERE pipeline_stage_id = ? AND deleted_at = ''",
      [stageId],
      client,
    ) || 0) + 1000;
    const at = nowIso();
    const updates = leadIds.map((leadId, index) => {
      const statusUpdate = getStageStatusUpdate(stage, sourceById.get(leadId)?.status);
      return { id: leadId, position: firstPosition + index * 1000, status: statusUpdate.status, isLost: Number(statusUpdate.isLost || 0) };
    });
    const positionCases = updates.map(() => "WHEN ? THEN ?").join(" ");
    const statusCases = updates.map(() => "WHEN ? THEN ?").join(" ");
    const lostCases = updates.map(() => "WHEN ? THEN ?").join(" ");
    await execute(
      `UPDATE leads SET pipeline_id = ?, pipeline_stage_id = ?, pipeline_entered_at = ?, updated_at = ?,
         kanban_position = CASE id ${positionCases} ELSE kanban_position END,
         status = CASE id ${statusCases} ELSE status END,
         is_lost = CASE id ${lostCases} ELSE is_lost END
       WHERE deleted_at = '' AND id IN (${idPlaceholders})`,
      [pipelineId, stageId, at, at,
        ...updates.flatMap((item) => [item.id, item.position]),
        ...updates.flatMap((item) => [item.id, item.status]),
        ...updates.flatMap((item) => [item.id, item.isLost]), ...leadIds],
      client,
    );

    const closedLeadIds = updates.filter((item) => item.isLost || item.status === "Fechado" || item.status === "Perdido").map((item) => item.id);
    if (closedLeadIds.length) {
      await cancelPendingTasksForLeadIds(closedLeadIds, `Tarefa cancelada porque o lead foi movido em lote para ${stage.name}.`, currentUser, client);
    }

    const savedRows = await queryRows(`SELECT * FROM leads WHERE id IN (${idPlaceholders}) AND deleted_at = ''`, leadIds, client);
    const savedById = new Map(savedRows.map((row) => [String(row.id), rowToLead(row)]));
    const results = leadIds.map((leadId) => savedById.get(leadId)).filter(Boolean);

    const sourceStageIds = Array.from(new Set(
      leadIds
        .map((leadId) => String(sourceById.get(leadId)?.pipelineStageId || ""))
        .filter(Boolean),
    ));
    const sourceStages = new Map();
    for (const sourceStageId of sourceStageIds) {
      const sourceStage = await getKanbanStageById(sourceStageId, client, { includeArchived: true });
      if (sourceStage) sourceStages.set(sourceStageId, sourceStage);
    }

    for (const item of updates) {
      const sourceLead = sourceById.get(item.id);
      const savedLead = savedById.get(item.id);
      if (!sourceLead || !savedLead) continue;
      const sourcePipelineId = String(sourceLead.pipelineId || "");
      const sourceStageId = String(sourceLead.pipelineStageId || "");
      if (sourcePipelineId === String(pipelineId) && sourceStageId === String(stageId)) continue;

      const sourceStage = sourceStages.get(sourceStageId) || null;
      await recordAudit({
        entityType: "lead",
        entityId: item.id,
        action: "kanban_card_moved",
        actor: currentUser,
        summary: `Moveu ${sourceLead.name || sourceLead.company || "lead"} para ${stage.name}`,
        changes: {
          fromPipelineId: sourcePipelineId,
          fromPipelineName: String(sourceStage?.pipeline_name || ""),
          fromStageId: sourceStageId,
          fromStageName: String(sourceStage?.name || ""),
          fromStageType: String(sourceStage?.stage_type || ""),
          toPipelineId: String(pipelineId),
          toPipelineName: String(stage.pipeline_name || ""),
          toStageId: String(stageId),
          toStageName: String(stage.name || ""),
          toStageType: String(stage.stage_type || ""),
          status: { from: sourceLead.status || "", to: savedLead.status || "" },
          responsibleUserId: savedLead.responsibleUserId || sourceLead.responsibleUserId || "",
          responsibleName: savedLead.responsible || sourceLead.responsible || "",
          source: savedLead.source || sourceLead.source || "",
          bulk: true,
        },
      }, client);
    }

    await recordAudit({
      entityType: "pipeline", entityId: pipelineId, action: "kanban_cards_bulk_assigned", actor: currentUser,
      summary: `Moveu ${results.length} card(s) para ${stage.name}`,
      changes: { leadIds: results.map((lead) => lead.id), stageId },
    }, client);
    return results;
  }

  return { assignCardsInBulk, rebalanceStagePositions };
}
