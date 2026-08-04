export async function resolveImportKanbanTarget(input = {}, dependencies = {}) {
  const pipelineId = String(input.pipelineId || input.targetPipelineId || "").trim();
  const stageId = String(input.stageId || input.targetStageId || "").trim();
  if (!pipelineId && !stageId) return null;
  if (!pipelineId || !stageId) {
    const error = new Error("Informe o funil e a etapa de destino da importação.");
    error.statusCode = 400;
    throw error;
  }

  const pipeline = await dependencies.getPipelineById(pipelineId, dependencies.client);
  const stage = await dependencies.getStageById(stageId, dependencies.client);
  if (!pipeline || !stage || stage.pipeline_id !== pipeline.id) {
    const error = new Error("O funil ou a etapa selecionada para a importação não está mais disponível.");
    error.statusCode = 400;
    throw error;
  }

  return {
    pipelineId: pipeline.id,
    pipelineName: pipeline.name || "",
    stageId: stage.id,
    stageName: stage.name || "",
    stageType: stage.stage_type || "open",
    statusKey: stage.status_key || "",
  };
}

export function updateImportDedupeHash(hash, leads = [], target = null) {
  hash.update(target?.pipelineId || "automatic").update("\n");
  hash.update(target?.stageId || "automatic").update("\n");
  for (const lead of leads) hash.update(JSON.stringify(lead)).update("\n");
  return hash;
}

export function buildImportJobPayload(leads = [], target = null) {
  return {
    leads,
    targetPipelineId: target?.pipelineId || "",
    targetStageId: target?.stageId || "",
  };
}

export function buildImportAudit(report, target = null) {
  const destination = target ? ` Destino: ${target.pipelineName} / ${target.stageName}.` : "";
  return {
    summary: `Importou ${report.received} lead(s). Criados: ${report.created}. Mesclados: ${report.merged}. Ignorados: ${report.ignoredInsideFile}.${destination}`,
    changes: target ? { ...report, importDestination: target } : report,
  };
}
