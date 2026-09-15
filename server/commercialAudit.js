const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 300;
const MAX_SOURCE_ROWS = 20000;

export const COMMERCIAL_AUDIT_EVENT_TYPES = Object.freeze([
  "lead_created",
  "task_created",
  "task_completed",
  "movement",
  "contract_closed",
  "no_interest",
  "handoff",
  "task_updated",
  "task_canceled",
  "reopened",
]);

export const COMMERCIAL_AUDIT_EVENT_LABELS = Object.freeze({
  lead_created: "Lead novo",
  task_created: "Tarefa criada",
  task_completed: "Tarefa concluída",
  movement: "Movimentação de funil",
  contract_closed: "Contrato fechado",
  no_interest: "Sem interesse",
  handoff: "Encaminhamento",
  task_updated: "Tarefa reagendada/alterada",
  task_canceled: "Tarefa cancelada",
  reopened: "Lead reaberto",
});

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function stringValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "to")) return String(value.to ?? "");
  return String(value);
}

function fromValue(value) {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "from")) return String(value.from ?? "");
  return "";
}

function toValue(value) {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "to")) return String(value.to ?? "");
  return stringValue(value);
}

function normalizeText(value) {
  return String(value || "").trim().toLocaleLowerCase("pt-BR");
}

function currentName(map, id, fallback = "") {
  return String(map.get(String(id || "")) || fallback || "");
}

function eventBase(row, suffix, eventType, context) {
  const changes = parseJson(row.changes_json, {});
  const task = context.tasks.get(String(row.entity_id || "")) || null;
  const leadId = row.entity_type === "lead"
    ? String(row.entity_id || "")
    : String(changes.leadId || task?.lead_id || "");
  const lead = context.leads.get(leadId) || null;
  const taskId = row.entity_type === "task" ? String(row.entity_id || "") : String(changes.taskId || "");
  const resolvedTask = taskId ? context.tasks.get(taskId) || task : task;

  const responsibleUserId = String(
    changes.responsibleUserId?.to
      || changes.responsibleUserId
      || resolvedTask?.responsible_user_id
      || lead?.responsible_user_id
      || "",
  );
  const responsibleName = currentName(
    context.users,
    responsibleUserId,
    String(changes.responsibleName || resolvedTask?.responsible_name || lead?.responsible || ""),
  );

  const pipelineId = String(
    changes.toPipelineId
      || toValue(changes.pipelineId)
      || lead?.pipeline_id
      || "",
  );
  const stageId = String(
    changes.toStageId
      || toValue(changes.pipelineStageId)
      || lead?.pipeline_stage_id
      || "",
  );

  return {
    id: `${row.id}${suffix ? `:${suffix}` : ""}`,
    sourceAuditId: row.id,
    eventType,
    eventLabel: COMMERCIAL_AUDIT_EVENT_LABELS[eventType] || eventType,
    occurredAt: row.created_at || "",
    actorId: row.actor_id || "",
    actorName: row.actor_name || "Sistema",
    leadId,
    leadName: String(lead?.name || changes.leadName || ""),
    leadCompany: String(lead?.company || changes.leadCompany || ""),
    source: String(changes.source || lead?.source || ""),
    responsibleUserId,
    responsibleName,
    taskId: resolvedTask?.id || taskId || "",
    taskTitle: String(resolvedTask?.title || changes.taskTitle || ""),
    taskSource: String(resolvedTask?.source || changes.taskSource || ""),
    result: String(resolvedTask?.result || changes.result || ""),
    pipelineId,
    pipelineName: currentName(context.pipelines, pipelineId, changes.toPipelineName || changes.pipelineName || ""),
    stageId,
    stageName: currentName(context.stages, stageId, changes.toStageName || changes.stageName || ""),
    fromPipelineId: String(changes.fromPipelineId || fromValue(changes.pipelineId) || ""),
    fromPipelineName: "",
    fromStageId: String(changes.fromStageId || fromValue(changes.pipelineStageId) || ""),
    fromStageName: "",
    toPipelineId: String(changes.toPipelineId || toValue(changes.pipelineId) || pipelineId || ""),
    toPipelineName: "",
    toStageId: String(changes.toStageId || toValue(changes.pipelineStageId) || stageId || ""),
    toStageName: "",
    outcomeReason: String(changes.outcomeReason || changes.lostReason?.to || lead?.lost_reason || ""),
    summary: String(row.summary || ""),
    details: "",
    changes,
  };
}

function enrichRouteNames(event, context) {
  event.fromPipelineName = currentName(context.pipelines, event.fromPipelineId, event.changes.fromPipelineName || "");
  event.fromStageName = currentName(context.stages, event.fromStageId, event.changes.fromStageName || "");
  event.toPipelineName = currentName(context.pipelines, event.toPipelineId, event.changes.toPipelineName || event.pipelineName || "");
  event.toStageName = currentName(context.stages, event.toStageId, event.changes.toStageName || event.stageName || "");
  if (event.toPipelineId) {
    event.pipelineId = event.toPipelineId;
    event.pipelineName = event.toPipelineName;
  }
  if (event.toStageId) {
    event.stageId = event.toStageId;
    event.stageName = event.toStageName;
  }
  return event;
}

function routeChanged(changes = {}) {
  const fromPipeline = String(changes.fromPipelineId || fromValue(changes.pipelineId) || "");
  const toPipeline = String(changes.toPipelineId || toValue(changes.pipelineId) || "");
  const fromStage = String(changes.fromStageId || fromValue(changes.pipelineStageId) || "");
  const toStage = String(changes.toStageId || toValue(changes.pipelineStageId) || "");
  return Boolean((fromPipeline || fromStage || toPipeline || toStage) && (fromPipeline !== toPipeline || fromStage !== toStage));
}

function isClosedStatus(value) {
  const normalized = normalizeText(value);
  return normalized === "fechado" || normalized === "ganho";
}

function isLostStatus(value) {
  return normalizeText(value) === "perdido";
}

function isNoInterest(value) {
  return normalizeText(value) === "sem interesse";
}

function movementClosesContract(changes = {}, context) {
  const toStageId = String(changes.toStageId || toValue(changes.pipelineStageId) || "");
  const fromStageId = String(changes.fromStageId || fromValue(changes.pipelineStageId) || "");
  const toStageType = normalizeText(changes.toStageType || context.stageTypes.get(toStageId) || "");
  const fromStageType = normalizeText(changes.fromStageType || context.stageTypes.get(fromStageId) || "");
  const statusTo = toValue(changes.status);
  const statusFrom = fromValue(changes.status);
  const reachesWon = toStageType === "won" || isClosedStatus(statusTo);
  const wasWon = fromStageType === "won" || isClosedStatus(statusFrom);
  return reachesWon && !wasWon;
}

function movementReopens(changes = {}, context) {
  const toStageId = String(changes.toStageId || toValue(changes.pipelineStageId) || "");
  const fromStageId = String(changes.fromStageId || fromValue(changes.pipelineStageId) || "");
  const toStageType = normalizeText(changes.toStageType || context.stageTypes.get(toStageId) || "");
  const fromStageType = normalizeText(changes.fromStageType || context.stageTypes.get(fromStageId) || "");
  const statusTo = toValue(changes.status);
  const statusFrom = fromValue(changes.status);
  const wasClosed = fromStageType === "won" || fromStageType === "lost" || isClosedStatus(statusFrom) || isLostStatus(statusFrom);
  const isOpen = toStageType === "open" || (!isClosedStatus(statusTo) && !isLostStatus(statusTo));
  return wasClosed && isOpen;
}

function movementMarksNoInterest(changes = {}, context) {
  const toStageId = String(changes.toStageId || toValue(changes.pipelineStageId) || "");
  const stageName = String(changes.toStageName || context.stages.get(toStageId) || "");
  const reason = String(changes.outcomeReason || toValue(changes.lostReason) || "");
  return isNoInterest(reason) || isNoInterest(stageName);
}

export function expandCommercialAuditRow(row, context) {
  const action = String(row.action || "");
  const changes = parseJson(row.changes_json, {});
  const events = [];

  const push = (suffix, type, configure) => {
    const event = enrichRouteNames(eventBase(row, suffix, type, context), context);
    if (configure) configure(event);
    events.push(event);
  };

  if (["lead_created", "lead_created_from_whatsapp", "lead_created_by_whatsapp_integration"].includes(action)) {
    push("created", "lead_created", (event) => {
      event.details = event.source ? `Origem: ${event.source}` : "Lead incluído na base";
    });
  }

  if (action === "lead_reactivated_by_whatsapp") {
    push("reopened", "reopened", (event) => {
      event.details = event.stageName
        ? `Lead reativado pelo WhatsApp em ${event.pipelineName || "funil"} / ${event.stageName}`
        : "Lead reativado pelo WhatsApp";
    });
  }

  if (action === "task_created") {
    push("task-created", "task_created", (event) => {
      event.details = [event.taskTitle, event.responsibleName ? `Responsável: ${event.responsibleName}` : ""].filter(Boolean).join(" · ");
    });
  }
  if (action === "task_completed") {
    push("task-completed", "task_completed", (event) => {
      event.details = [event.taskTitle, event.result ? `Resultado: ${event.result}` : ""].filter(Boolean).join(" · ");
    });
  }
  if (action === "task_updated") {
    push("task-updated", "task_updated", (event) => { event.details = event.taskTitle || "Tarefa atualizada"; });
  }
  if (action === "task_canceled") {
    push("task-canceled", "task_canceled", (event) => { event.details = event.taskTitle || "Tarefa cancelada"; });
  }

  if (action === "lead_handed_off") {
    push("handoff", "handoff", (event) => {
      const toUserId = String(changes.responsibleUserId?.to || changes.toUserId || event.responsibleUserId || "");
      event.responsibleUserId = toUserId;
      event.responsibleName = currentName(context.users, toUserId, String(changes.responsible?.to || event.responsibleName || ""));
      event.details = event.responsibleName ? `Encaminhado para ${event.responsibleName}` : "Lead encaminhado";
    });
    if (routeChanged(changes)) {
      push("handoff-movement", "movement", (event) => {
        event.details = `${event.fromPipelineName || "Sem funil"} / ${event.fromStageName || "Sem etapa"} → ${event.toPipelineName || "Sem funil"} / ${event.toStageName || "Sem etapa"}`;
      });
    }
  }

  if (action === "kanban_card_moved" && routeChanged(changes)) {
    push("movement", "movement", (event) => {
      event.details = `${event.fromPipelineName || "Sem funil"} / ${event.fromStageName || "Sem etapa"} → ${event.toPipelineName || "Sem funil"} / ${event.toStageName || "Sem etapa"}`;
    });
    if (movementClosesContract(changes, context)) {
      push("closed", "contract_closed", (event) => {
        event.details = `Contrato fechado em ${event.toPipelineName || event.pipelineName || "funil"} / ${event.toStageName || event.stageName || "etapa"}`;
      });
    }
    if (movementMarksNoInterest(changes, context)) {
      push("no-interest", "no_interest", (event) => {
        event.outcomeReason = "Sem interesse";
        event.details = `Sem interesse em ${event.toPipelineName || event.pipelineName || "funil"} / ${event.toStageName || event.stageName || "etapa"}`;
      });
    }
    if (movementReopens(changes, context)) {
      push("reopened", "reopened", (event) => {
        event.details = `Reaberto para ${event.toPipelineName || event.pipelineName || "funil"} / ${event.toStageName || event.stageName || "etapa"}`;
      });
    }
  }

  if (action === "lead_updated") {
    const statusFrom = fromValue(changes.status);
    const statusTo = toValue(changes.status);
    const lostReasonTo = toValue(changes.lostReason);
    if ((isClosedStatus(statusTo) && !isClosedStatus(statusFrom))) {
      push("closed", "contract_closed", (event) => {
        event.details = event.stageName ? `Contrato fechado em ${event.pipelineName || "funil"} / ${event.stageName}` : "Lead marcado como Fechado";
      });
    }
    if (isNoInterest(lostReasonTo) && !isNoInterest(fromValue(changes.lostReason))) {
      push("no-interest", "no_interest", (event) => {
        event.outcomeReason = "Sem interesse";
        event.details = "Motivo da perda: Sem interesse";
      });
    }
    if ((isClosedStatus(statusFrom) || isLostStatus(statusFrom)) && !isClosedStatus(statusTo) && !isLostStatus(statusTo) && statusTo) {
      push("reopened", "reopened", (event) => { event.details = `Reaberto com status ${statusTo}`; });
    }
    if (routeChanged(changes)) {
      push("movement", "movement", (event) => {
        event.details = `${event.fromPipelineName || "Sem funil"} / ${event.fromStageName || "Sem etapa"} → ${event.toPipelineName || "Sem funil"} / ${event.toStageName || "Sem etapa"}`;
      });
    }
  }

  return events;
}

function buildMaps(rows, key, value) {
  return new Map(rows.map((row) => [String(row[key] || ""), String(row[value] || "")]));
}

function matchesFilter(event, filters) {
  if (filters.eventType && event.eventType !== filters.eventType) return false;
  if (filters.actorId && event.actorId !== filters.actorId) return false;
  if (filters.responsibleUserId && event.responsibleUserId !== filters.responsibleUserId) return false;
  if (filters.source && normalizeText(event.source) !== normalizeText(filters.source)) return false;
  if (filters.pipelineId && ![event.pipelineId, event.fromPipelineId, event.toPipelineId].includes(filters.pipelineId)) return false;
  if (filters.stageId && ![event.stageId, event.fromStageId, event.toStageId].includes(filters.stageId)) return false;
  if (filters.search) {
    const haystack = normalizeText([event.leadName, event.leadCompany, event.actorName, event.responsibleName, event.taskTitle, event.summary, event.details].join(" "));
    if (!haystack.includes(normalizeText(filters.search))) return false;
  }
  return true;
}

function eventMetricKey(eventType) {
  if (eventType === "lead_created") return "leadCreated";
  if (eventType === "task_created") return "tasksCreated";
  if (eventType === "task_completed") return "tasksCompleted";
  if (eventType === "movement") return "movements";
  if (eventType === "contract_closed") return "contractsClosed";
  if (eventType === "no_interest") return "noInterest";
  return "";
}

function summarize(events) {
  const summary = { leadCreated: 0, tasksCreated: 0, tasksCompleted: 0, movements: 0, contractsClosed: 0, noInterest: 0 };
  for (const event of events) {
    const key = eventMetricKey(event.eventType);
    if (key) summary[key] += 1;
  }
  return summary;
}

function summarizeByCollaborator(events) {
  const map = new Map();
  for (const event of events) {
    const actorId = event.actorId || "system";
    const key = `${actorId}:${event.actorName || "Sistema"}`;
    if (!map.has(key)) {
      map.set(key, {
        actorId,
        actorName: event.actorName || "Sistema",
        leadCreated: 0,
        tasksCreated: 0,
        tasksCompleted: 0,
        movements: 0,
        contractsClosed: 0,
        noInterest: 0,
        handoffs: 0,
        total: 0,
      });
    }
    const row = map.get(key);
    row.total += 1;
    const metric = eventMetricKey(event.eventType);
    if (metric) row[metric] += 1;
    if (event.eventType === "handoff") row.handoffs += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total || a.actorName.localeCompare(b.actorName, "pt-BR"));
}

function addLeadToBucket(bucket, leadId) {
  if (!bucket._leadIds) bucket._leadIds = new Set();
  if (leadId) bucket._leadIds.add(String(leadId));
}

function serializeLeadBucket(bucket) {
  const { _leadIds, ...rest } = bucket;
  return { ...rest, uniqueLeads: _leadIds ? _leadIds.size : 0 };
}

function auditDay(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

export function buildCommercialAuditAnalytics(events) {
  const stageMap = new Map();
  const transitionMap = new Map();
  const pipelineMap = new Map();
  const dailyMap = new Map();

  for (const event of events) {
    const day = auditDay(event.occurredAt);
    if (day) {
      if (!dailyMap.has(day)) {
        dailyMap.set(day, { date: day, leadCreated: 0, movements: 0, contractsClosed: 0, noInterest: 0 });
      }
      const daily = dailyMap.get(day);
      const metric = eventMetricKey(event.eventType);
      if (metric === "leadCreated") daily.leadCreated += 1;
      if (metric === "movements") daily.movements += 1;
      if (metric === "contractsClosed") daily.contractsClosed += 1;
      if (metric === "noInterest") daily.noInterest += 1;
    }

    if (event.eventType !== "movement") continue;

    const toStageId = String(event.toStageId || event.stageId || "");
    const toStageName = String(event.toStageName || event.stageName || "Etapa não identificada");
    const toPipelineId = String(event.toPipelineId || event.pipelineId || "");
    const toPipelineName = String(event.toPipelineName || event.pipelineName || "Funil não identificado");
    const stageKey = `${toPipelineId}:${toStageId || toStageName}`;
    if (!stageMap.has(stageKey)) {
      stageMap.set(stageKey, {
        pipelineId: toPipelineId,
        pipelineName: toPipelineName,
        stageId: toStageId,
        stageName: toStageName,
        movements: 0,
        _leadIds: new Set(),
      });
    }
    const stageBucket = stageMap.get(stageKey);
    stageBucket.movements += 1;
    addLeadToBucket(stageBucket, event.leadId);

    const pipelineKey = toPipelineId || toPipelineName;
    if (!pipelineMap.has(pipelineKey)) {
      pipelineMap.set(pipelineKey, {
        pipelineId: toPipelineId,
        pipelineName: toPipelineName,
        movements: 0,
        _leadIds: new Set(),
      });
    }
    const pipelineBucket = pipelineMap.get(pipelineKey);
    pipelineBucket.movements += 1;
    addLeadToBucket(pipelineBucket, event.leadId);

    const fromPipelineId = String(event.fromPipelineId || "");
    const fromPipelineName = String(event.fromPipelineName || "Funil não identificado");
    const fromStageId = String(event.fromStageId || "");
    const fromStageName = String(event.fromStageName || "Etapa não identificada");
    const transitionKey = `${fromPipelineId}:${fromStageId || fromStageName}>${toPipelineId}:${toStageId || toStageName}`;
    if (!transitionMap.has(transitionKey)) {
      transitionMap.set(transitionKey, {
        fromPipelineId,
        fromPipelineName,
        fromStageId,
        fromStageName,
        toPipelineId,
        toPipelineName,
        toStageId,
        toStageName,
        movements: 0,
        _leadIds: new Set(),
      });
    }
    const transitionBucket = transitionMap.get(transitionKey);
    transitionBucket.movements += 1;
    addLeadToBucket(transitionBucket, event.leadId);
  }

  const byStage = Array.from(stageMap.values())
    .map(serializeLeadBucket)
    .sort((a, b) => b.uniqueLeads - a.uniqueLeads || b.movements - a.movements || a.stageName.localeCompare(b.stageName, "pt-BR"));
  const transitions = Array.from(transitionMap.values())
    .map(serializeLeadBucket)
    .sort((a, b) => b.uniqueLeads - a.uniqueLeads || b.movements - a.movements || a.toStageName.localeCompare(b.toStageName, "pt-BR"));
  const byPipeline = Array.from(pipelineMap.values())
    .map(serializeLeadBucket)
    .sort((a, b) => b.uniqueLeads - a.uniqueLeads || b.movements - a.movements || a.pipelineName.localeCompare(b.pipelineName, "pt-BR"));
  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return { byStage, transitions, byPipeline, daily };
}

export async function getCommercialAuditDashboard({ queryRows, requestUrl }) {
  const from = String(requestUrl.searchParams.get("from") || "").trim();
  const to = String(requestUrl.searchParams.get("to") || "").trim();
  const filters = {
    eventType: String(requestUrl.searchParams.get("eventType") || "").trim(),
    actorId: String(requestUrl.searchParams.get("actorId") || "").trim(),
    responsibleUserId: String(requestUrl.searchParams.get("responsibleUserId") || "").trim(),
    source: String(requestUrl.searchParams.get("source") || "").trim(),
    pipelineId: String(requestUrl.searchParams.get("pipelineId") || "").trim(),
    stageId: String(requestUrl.searchParams.get("stageId") || "").trim(),
    search: String(requestUrl.searchParams.get("search") || "").trim().slice(0, 120),
  };
  const limit = boundedInteger(requestUrl.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = boundedInteger(requestUrl.searchParams.get("offset"), 0, 0, 100000);

  const clauses = [
    `(
      (entity_type = 'lead' AND action IN (
        'lead_created', 'lead_created_from_whatsapp', 'lead_created_by_whatsapp_integration',
        'lead_reactivated_by_whatsapp', 'lead_updated', 'lead_handed_off', 'kanban_card_moved'
      ))
      OR (entity_type = 'task' AND action IN ('task_created', 'task_completed', 'task_updated', 'task_canceled'))
    )`,
  ];
  const params = [];
  if (from) { clauses.push("created_at >= ?"); params.push(from); }
  if (to) { clauses.push("created_at < ?"); params.push(to); }
  if (filters.actorId) { clauses.push("actor_id = ?"); params.push(filters.actorId); }

  const auditRows = await queryRows(
    `SELECT id, entity_type, entity_id, action, actor_id, actor_name, changes_json, summary, created_at
     FROM audit_log
     WHERE ${clauses.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT ?`,
    [...params, MAX_SOURCE_ROWS],
  );

  const taskIds = new Set();
  const leadIds = new Set();
  const pipelineIds = new Set();
  const stageIds = new Set();
  for (const row of auditRows) {
    const changes = parseJson(row.changes_json, {});
    if (row.entity_type === "task") taskIds.add(String(row.entity_id || ""));
    if (row.entity_type === "lead") leadIds.add(String(row.entity_id || ""));
    if (changes.taskId) taskIds.add(String(changes.taskId));
    if (changes.leadId) leadIds.add(String(changes.leadId));
    [changes.fromPipelineId, changes.toPipelineId, fromValue(changes.pipelineId), toValue(changes.pipelineId)].forEach((id) => { if (id) pipelineIds.add(String(id)); });
    [changes.fromStageId, changes.toStageId, fromValue(changes.pipelineStageId), toValue(changes.pipelineStageId)].forEach((id) => { if (id) stageIds.add(String(id)); });
  }

  const taskRows = taskIds.size ? await queryRows(
    `SELECT id, lead_id, title, responsible_user_id, responsible_name, result, source FROM tasks WHERE id IN (${Array.from(taskIds).map(() => "?").join(", ")})`,
    Array.from(taskIds),
  ) : [];
  for (const task of taskRows) if (task.lead_id) leadIds.add(String(task.lead_id));

  const leadRows = leadIds.size ? await queryRows(
    `SELECT id, name, company, source, responsible_user_id, responsible, pipeline_id, pipeline_stage_id, lost_reason FROM leads WHERE id IN (${Array.from(leadIds).map(() => "?").join(", ")})`,
    Array.from(leadIds),
  ) : [];
  for (const lead of leadRows) {
    if (lead.pipeline_id) pipelineIds.add(String(lead.pipeline_id));
    if (lead.pipeline_stage_id) stageIds.add(String(lead.pipeline_stage_id));
  }

  const [pipelineRows, stageRows, userRows, sourceRows] = await Promise.all([
    queryRows("SELECT id, name, is_archived FROM kanban_pipelines ORDER BY is_archived ASC, position ASC, name ASC"),
    queryRows("SELECT id, pipeline_id, name, stage_type, is_archived, position FROM kanban_stages ORDER BY is_archived ASC, pipeline_id ASC, position ASC"),
    queryRows("SELECT id, name, email, role, is_active FROM users ORDER BY is_active DESC, name ASC, email ASC"),
    queryRows("SELECT source, COUNT(*) AS total FROM leads WHERE deleted_at = '' AND TRIM(COALESCE(source, '')) != '' GROUP BY source ORDER BY total DESC, source ASC"),
  ]);

  const context = {
    tasks: new Map(taskRows.map((row) => [String(row.id), row])),
    leads: new Map(leadRows.map((row) => [String(row.id), row])),
    pipelines: buildMaps(pipelineRows, "id", "name"),
    stages: buildMaps(stageRows, "id", "name"),
    stageTypes: buildMaps(stageRows, "id", "stage_type"),
    users: new Map(userRows.map((row) => [String(row.id), String(row.name || row.email || row.id)])),
  };

  const expanded = auditRows.flatMap((row) => expandCommercialAuditRow(row, context));
  const baseFilters = { ...filters, eventType: "" };
  const baseFiltered = expanded.filter((event) => matchesFilter(event, baseFilters));
  const filtered = filters.eventType ? baseFiltered.filter((event) => event.eventType === filters.eventType) : baseFiltered;
  const summary = summarize(baseFiltered);
  const collaboratorSummary = summarizeByCollaborator(baseFiltered);
  const analytics = buildCommercialAuditAnalytics(baseFiltered);
  const activities = filtered.slice(offset, offset + limit).map(({ changes, ...event }) => event);

  return {
    generatedAt: new Date().toISOString(),
    summary,
    analytics,
    activities,
    collaborators: collaboratorSummary,
    pagination: { total: filtered.length, limit, offset, hasMore: offset + limit < filtered.length, sourceTruncated: auditRows.length >= MAX_SOURCE_ROWS },
    filters: {
      eventTypes: COMMERCIAL_AUDIT_EVENT_TYPES.map((id) => ({ id, label: COMMERCIAL_AUDIT_EVENT_LABELS[id] })),
      users: userRows.map((row) => ({ id: String(row.id), name: String(row.name || row.email || row.id), role: String(row.role || ""), isActive: Boolean(row.is_active) })),
      sources: sourceRows.map((row) => ({ name: String(row.source || ""), total: Number(row.total || 0) })),
      pipelines: pipelineRows.map((pipeline) => ({
        id: String(pipeline.id),
        name: String(pipeline.name || "Funil"),
        isArchived: Boolean(pipeline.is_archived),
        stages: stageRows.filter((stage) => String(stage.pipeline_id) === String(pipeline.id)).map((stage) => ({ id: String(stage.id), name: String(stage.name || "Etapa"), stageType: String(stage.stage_type || "open"), isArchived: Boolean(stage.is_archived) })),
      })),
    },
  };
}
