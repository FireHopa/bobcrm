import { listIntegrationIncidents, listIntegrationSnapshots } from "./integrationObservability.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_CRM_EVENTS = 20_000;

function nowIso() { return new Date().toISOString(); }
function safeInteger(value, fallback, min, max) { const parsed = Number.parseInt(String(value ?? ""), 10); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback; }
function parseJson(value, fallback = {}) { if (!value) return fallback; if (typeof value === "object") return value; try { return JSON.parse(value); } catch { return fallback; } }
function maskPhone(value) { const digits = String(value || "").replace(/\D/g, ""); if (!digits) return ""; if (digits.length <= 6) return `${digits.slice(0, 2)}***${digits.slice(-2)}`; return `${digits.slice(0, Math.min(4, digits.length - 4))}${"*".repeat(Math.max(3, digits.length - 8))}${digits.slice(-4)}`; }
function normalizeZapeBaseUrl(value) { return String(value || "").trim().replace(/\/+$/, ""); }

function resolvePeriod(periodValue) {
  const period = ["24h", "7d", "30d", "90d"].includes(String(periodValue || "")) ? String(periodValue) : "24h";
  const days = period === "90d" ? 90 : period === "30d" ? 30 : period === "7d" ? 7 : 1;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60_000);
  return { period, from: from.toISOString(), to: to.toISOString(), days };
}

async function requestZape({ baseUrl, key, path, method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!baseUrl || !key) throw Object.assign(new Error("Configure ZAPE_MONITOR_URL e ZAPE_MONITOR_KEY no BobCRM."), { code: "ZAPE_MONITOR_NOT_CONFIGURED", statusCode: 503 });
  if (typeof fetch !== "function") throw Object.assign(new Error("O monitoramento requer Node.js 18 ou superior."), { code: "FETCH_UNAVAILABLE", statusCode: 503 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 1000) }; }
    if (!response.ok) throw Object.assign(new Error(data?.error || data?.message || `Zape respondeu HTTP ${response.status}.`), { statusCode: response.status, code: data?.code || "ZAPE_MONITOR_HTTP_ERROR", response: data });
    return { data, latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("O Zape excedeu o tempo limite de monitoramento."), { code: "ZAPE_MONITOR_TIMEOUT", statusCode: 504 });
    throw error;
  } finally { clearTimeout(timer); }
}

function responseAction(response) { const action = String(response?.action || "").trim(); return ["created", "updated", "reactivated"].includes(action) ? action : action || "other"; }

async function loadCrmIntegrationData({ queryRows, from, to }) {
  const rows = await queryRows(`SELECT ie.event_key, ie.provider, ie.tenant_id, ie.external_lead_id, ie.lead_id,
      ie.status, ie.response_json, ie.created_at, ie.updated_at,
      l.name AS lead_name, l.phone AS lead_phone, l.responsible, l.responsible_user_id,
      l.pipeline_id, l.pipeline_stage_id, l.deleted_at, l.status AS lead_status, l.is_lost,
      l.contact_made_at, l.estimated_budget, ks.name AS stage_name, ks.stage_type
    FROM integration_events ie
    LEFT JOIN leads l ON l.id = ie.lead_id
    LEFT JOIN kanban_stages ks ON ks.id = l.pipeline_stage_id
    WHERE ie.provider='zape' AND ie.created_at>=? AND ie.created_at<=?
    ORDER BY ie.created_at DESC LIMIT ${MAX_CRM_EVENTS}`, [from, to]);

  const actions = { created: 0, updated: 0, reactivated: 0, other: 0 };
  const statuses = { total: rows.length, completed: 0, processing: 0, failed: 0 };
  const tenantMap = new Map();
  const ownerMap = new Map();
  const eventTypeCounts = {};
  const leadIds = new Set();
  const leadsWithoutOwner = new Set();
  const cohortByLead = new Map();

  const events = rows.map((row) => {
    const response = parseJson(row.response_json, {});
    const action = responseAction(response);
    const eventType = String(response.eventType || "");
    if (Object.prototype.hasOwnProperty.call(actions, action)) actions[action] += 1; else actions.other += 1;
    if (row.status === "completed") statuses.completed += 1; else if (row.status === "failed") statuses.failed += 1; else statuses.processing += 1;
    if (eventType) eventTypeCounts[eventType] = Number(eventTypeCounts[eventType] || 0) + 1;
    const leadId = String(row.lead_id || response.leadId || "");
    if (leadId) {
      leadIds.add(leadId);
      if (!String(row.responsible_user_id || "").trim() && !String(row.responsible || "").trim()) leadsWithoutOwner.add(leadId);
      if (!cohortByLead.has(leadId)) cohortByLead.set(leadId, row);
    }
    const tenantId = String(row.tenant_id || "unknown");
    const tenant = tenantMap.get(tenantId) || { tenantId, receivedByCrm: 0, completedByCrm: 0, created: 0, updated: 0, reactivated: 0, withoutOwner: 0, lastReceivedAt: "", _withoutOwnerIds: new Set(), _leadIds: new Set() };
    tenant.receivedByCrm += 1; if (row.status === "completed") tenant.completedByCrm += 1; if (["created","updated","reactivated"].includes(action)) tenant[action] += 1;
    if (leadId) tenant._leadIds.add(leadId); if (leadId && leadsWithoutOwner.has(leadId)) tenant._withoutOwnerIds.add(leadId);
    tenant.withoutOwner = tenant._withoutOwnerIds.size; if (!tenant.lastReceivedAt || String(row.created_at) > tenant.lastReceivedAt) tenant.lastReceivedAt = String(row.created_at || "");
    tenantMap.set(tenantId, tenant);
    const ownerKey = String(row.responsible_user_id || row.responsible || "unassigned");
    const owner = ownerMap.get(ownerKey) || { responsibleUserId: String(row.responsible_user_id || ""), responsible: String(row.responsible || "Sem responsável"), leads: new Set() };
    if (leadId) owner.leads.add(leadId); ownerMap.set(ownerKey, owner);
    return {
      eventKey: String(row.event_key || ""), tenantId, externalLeadId: String(row.external_lead_id || ""), crmLeadId: leadId,
      crmStatus: String(row.status || ""), crmAction: action, eventType, leadName: String(row.lead_name || ""), phoneMasked: maskPhone(row.lead_phone),
      responsible: String(row.responsible || response.responsible || ""), responsibleUserId: String(row.responsible_user_id || response.responsibleUserId || ""),
      pipelineId: String(row.pipeline_id || response.pipelineId || ""), stageId: String(row.pipeline_stage_id || response.stageId || ""), stageName: String(row.stage_name || ""),
      stageType: String(row.stage_type || ""), leadStatus: String(row.lead_status || ""), assignmentMode: String(response.assignmentMode || ""),
      duplicateMatched: Boolean(response.duplicateMatched), integrationProfile: String(response.integrationProfile || ""), commercialTreatment: String(response.commercialTreatment || ""),
      inactivityDays: Number(response.inactivityDays || 0), createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""),
    };
  });

  const cohortIds = Array.from(cohortByLead.keys());
  const commercial = { integratedLeads: cohortIds.length, contacted: 0, meetings: 0, proposals: 0, won: 0, lost: 0, open: 0, conversionRate: 0, meetingRate: 0, proposalRate: 0, byTenant: [], byOwner: [] };
  const stageByLead = new Map();
  for (const [leadId, row] of cohortByLead) {
    const stageType = String(row.stage_type || "");
    const leadStatus = String(row.lead_status || "").toLowerCase();
    const won = stageType === "won" || leadStatus === "fechado";
    const lost = stageType === "lost" || Number(row.is_lost) === 1 || leadStatus === "perdido";
    const contacted = Boolean(String(row.contact_made_at || "").trim());
    if (won) commercial.won += 1; else if (lost) commercial.lost += 1; else commercial.open += 1;
    if (contacted) commercial.contacted += 1;
    stageByLead.set(leadId, { won, lost, contacted, proposal: /proposta/i.test(`${row.stage_name || ""} ${row.lead_status || ""}`), meeting: false });
  }
  if (cohortIds.length) {
    const placeholders = cohortIds.map(() => "?").join(",");
    const meetingRows = await queryRows(`SELECT DISTINCT lead_id FROM tasks WHERE lead_id IN (${placeholders}) AND type='reuniao'`, cohortIds);
    for (const row of meetingRows) if (stageByLead.has(String(row.lead_id))) stageByLead.get(String(row.lead_id)).meeting = true;
    const proposalRows = await queryRows(`SELECT DISTINCT al.entity_id AS lead_id FROM audit_log al
      INNER JOIN kanban_stages ks ON ks.id=JSON_UNQUOTE(JSON_EXTRACT(al.changes_json,'$.toStageId'))
      WHERE al.entity_type='lead' AND al.action='kanban_card_moved' AND al.entity_id IN (${placeholders})
      AND (LOWER(ks.name) LIKE '%proposta%' OR LOWER(ks.status_key) LIKE '%proposta%')`, cohortIds).catch(() => []);
    for (const row of proposalRows) if (stageByLead.has(String(row.lead_id))) stageByLead.get(String(row.lead_id)).proposal = true;
  }
  commercial.meetings = Array.from(stageByLead.values()).filter((item) => item.meeting).length;
  commercial.proposals = Array.from(stageByLead.values()).filter((item) => item.proposal || item.won).length;
  commercial.conversionRate = commercial.integratedLeads ? Math.round((commercial.won / commercial.integratedLeads) * 10000) / 100 : 0;
  commercial.meetingRate = commercial.integratedLeads ? Math.round((commercial.meetings / commercial.integratedLeads) * 10000) / 100 : 0;
  commercial.proposalRate = commercial.integratedLeads ? Math.round((commercial.proposals / commercial.integratedLeads) * 10000) / 100 : 0;

  function aggregateConversion(entries, keyBuilder) {
    return entries.map((entry) => {
      const ids = Array.from(entry._leadIds || entry.leads || []);
      const states = ids.map((id) => stageByLead.get(id)).filter(Boolean);
      const won = states.filter((state) => state.won).length;
      return { ...keyBuilder(entry), leads: ids.length, meetings: states.filter((state) => state.meeting).length, proposals: states.filter((state) => state.proposal || state.won).length, won, lost: states.filter((state) => state.lost).length, conversionRate: ids.length ? Math.round((won / ids.length) * 10000) / 100 : 0 };
    });
  }
  commercial.byTenant = aggregateConversion(Array.from(tenantMap.values()), (entry) => ({ tenantId: entry.tenantId }));
  commercial.byOwner = aggregateConversion(Array.from(ownerMap.values()), (entry) => ({ responsibleUserId: entry.responsibleUserId, responsible: entry.responsible }));

  return {
    statuses, actions, uniqueLeads: leadIds.size, leadsWithoutOwner: leadsWithoutOwner.size, commercial,
    tenants: Array.from(tenantMap.values()).map(({ _withoutOwnerIds, _leadIds, ...tenant }) => tenant).sort((a,b) => b.receivedByCrm-a.receivedByCrm),
    eventTypeCounts, events,
  };
}


async function loadReverseSyncData(queryRows) {
  try {
    const rows = await queryRows(`SELECT COUNT(*) total,
      SUM(status='pending') pending,SUM(status='sending') sending,SUM(status='delivered') delivered,
      SUM(status IN ('failed','failed_permanent')) failed,
      MAX(delivered_at) last_delivered_at,MAX(updated_at) last_updated_at
      FROM zape_reverse_sync_outbox`);
    const row=rows[0]||{};
    return { enabled: String(process.env.ZAPE_REVERSE_SYNC_ENABLED||'0')==='1', total:Number(row.total||0), pending:Number(row.pending||0), sending:Number(row.sending||0), delivered:Number(row.delivered||0), failed:Number(row.failed||0), lastDeliveredAt:row.last_delivered_at?new Date(row.last_delivered_at).toISOString():'', lastUpdatedAt:row.last_updated_at?new Date(row.last_updated_at).toISOString():'' };
  } catch { return { enabled:false,total:0,pending:0,sending:0,delivered:0,failed:0,lastDeliveredAt:'',lastUpdatedAt:'' }; }
}

function mergeTenantData(zapeTenants = [], crmTenants = []) { const map = new Map(); for (const tenant of zapeTenants) map.set(String(tenant.tenantId), { ...tenant }); for (const tenant of crmTenants) { const key = String(tenant.tenantId); map.set(key, { ...(map.get(key) || { tenantId: key }), ...tenant }); } return Array.from(map.values()).sort((a,b) => Number(b.total || b.receivedByCrm || 0)-Number(a.total || a.receivedByCrm || 0)); }
function mergeEventData(zapeEvents = [], crmEvents = []) { const crmMap = new Map(crmEvents.map((event) => [event.eventKey,event])); const merged = zapeEvents.map((event) => ({ ...event, ...(crmMap.get(event.eventKey) || {}) })); return zapeEvents.length ? merged : crmEvents; }
function consolidatedHealth(zapeResult, zapeError, crmData) { if (zapeError) return { status:"critical", label:"Crítico", reasons:[zapeError.message || "O BobCRM não conseguiu consultar o Zape."] }; const zapeHealth=zapeResult?.data?.health || {status:"attention",reasons:[]}; const reasons=Array.isArray(zapeHealth.reasons)?[...zapeHealth.reasons]:[]; if(crmData.statuses.processing>0) reasons.push(`${crmData.statuses.processing} evento(s) ainda em processamento no BobCRM.`); const status=zapeHealth.status==="critical"?"critical":zapeHealth.status==="attention"||crmData.statuses.processing>0?"attention":"healthy"; return {status,label:status==="healthy"?"Saudável":status==="attention"?"Atenção":"Crítico",reasons}; }

export async function getIntegrationDashboardOverview({ queryRows, monitorUrl, monitorKey, timeoutMs=DEFAULT_TIMEOUT_MS, query={} }) {
  const range=resolvePeriod(query.period); const limit=safeInteger(query.limit,50,1,200); const offset=safeInteger(query.offset,0,0,1_000_000);
  const params=new URLSearchParams({from:range.from,to:range.to,limit:String(limit),offset:String(offset)}); for(const key of ["status","tenantId","eventType","search"]){const value=String(query[key]||"").trim();if(value)params.set(key,value);}
  const [crmData,zapeSettled,snapshots,incidents,reverseSync]=await Promise.all([
    loadCrmIntegrationData({queryRows,from:range.from,to:range.to}),
    requestZape({baseUrl:normalizeZapeBaseUrl(monitorUrl),key:monitorKey,path:`/api/integration-monitor/overview?${params.toString()}`,timeoutMs}).then(value=>({value,error:null})).catch(error=>({value:null,error})),
    listIntegrationSnapshots({queryRows,from:range.from,to:range.to,bucket:range.days>=7?"day":"hour"}).catch(()=>[]),
    listIntegrationIncidents({queryRows,limit:100}).catch(()=>[]),
    loadReverseSyncData(queryRows),
  ]);
  const zapeResult=zapeSettled.value,zapeError=zapeSettled.error,zapeData=zapeResult?.data||null;
  const summary={detected:Number(zapeData?.queue?.counts?.total??crmData.statuses.total),delivered:Number(zapeData?.queue?.counts?.delivered??crmData.statuses.completed),pending:Number(zapeData?.queue?.counts?.pending||0)+Number(zapeData?.queue?.counts?.sending||0),failed:Number(zapeData?.queue?.counts?.failedPermanent||0),deliveryRate:Number(zapeData?.metrics?.deliveryRate??(crmData.statuses.total?(crmData.statuses.completed/crmData.statuses.total)*100:100)),averageDeliveryMs:Number(zapeData?.metrics?.averageDeliveryMs||0),created:crmData.actions.created,updated:crmData.actions.updated,reactivated:crmData.actions.reactivated,duplicatesAvoided:crmData.events.filter(event=>event.duplicateMatched).length,assigned:crmData.events.filter(event=>Boolean(event.responsibleUserId||event.responsible)).length,withoutOwner:crmData.leadsWithoutOwner};
  const events=mergeEventData(zapeData?.events||[],crmData.events); const tenantIds=new Set([...(zapeData?.tenants||[]).map(t=>t.tenantId),...crmData.tenants.map(t=>t.tenantId)]); const eventTypes=new Set([...Object.keys(zapeData?.metrics?.eventTypes||{}),...Object.keys(crmData.eventTypeCounts)]);
  return {ok:true,generatedAt:nowIso(),period:range,health:consolidatedHealth(zapeResult,zapeError,crmData),zape:{online:Boolean(zapeResult),latencyMs:Number(zapeResult?.latencyMs||0),error:zapeError?String(zapeError.message||zapeError):"",code:zapeError?.code||"",configured:Boolean(zapeData?.configured),targetBaseUrl:String(zapeData?.targetBaseUrl||""),worker:zapeData?.worker||null,queue:zapeData?.queue||null,storage:zapeData?.storage||null},crm:crmData,reverseSync,summary,commercial:crmData.commercial,trends:{queue:zapeData?.trends?.daily||[],health:snapshots},incidents,tenants:mergeTenantData(zapeData?.tenants||[],crmData.tenants),events,pagination:zapeData?.pagination||{total:crmData.events.length,limit,offset,hasMore:offset+limit<crmData.events.length},filters:{tenants:Array.from(tenantIds).filter(Boolean).sort(),eventTypes:Array.from(eventTypes).filter(Boolean).sort()}};
}

export async function getIntegrationEventDetail({ queryRows, monitorUrl, monitorKey, timeoutMs=DEFAULT_TIMEOUT_MS, eventKey }) {
  const encoded=encodeURIComponent(String(eventKey||"").trim());
  const [zape,rows]=await Promise.all([
    requestZape({baseUrl:normalizeZapeBaseUrl(monitorUrl),key:monitorKey,path:`/api/integration-monitor/events/${encoded}`,timeoutMs}).then(result=>result.data.event).catch(error=>({monitorError:error.message||String(error)})),
    queryRows(`SELECT ie.*,l.name AS lead_name,l.phone AS lead_phone,l.email AS lead_email,l.company,l.status AS lead_status,l.responsible,l.responsible_user_id,l.pipeline_id,l.pipeline_stage_id,ks.name AS stage_name,ks.stage_type
      FROM integration_events ie LEFT JOIN leads l ON l.id=ie.lead_id LEFT JOIN kanban_stages ks ON ks.id=l.pipeline_stage_id WHERE ie.event_key=? LIMIT 1`,[eventKey]),
  ]);
  const row=rows[0]||null; const response=parseJson(row?.response_json,{}); const leadId=String(row?.lead_id||response.leadId||zape?.crmLeadId||"");
  const [origins,audit,tasks]=leadId?await Promise.all([
    queryRows("SELECT * FROM lead_external_origins WHERE lead_id=? ORDER BY last_seen_at DESC LIMIT 50",[leadId]),
    queryRows("SELECT action,actor_name,summary,changes_json,created_at FROM audit_log WHERE entity_type='lead' AND entity_id=? ORDER BY created_at DESC LIMIT 100",[leadId]),
    queryRows("SELECT id,type,title,status,due_at,completed_at,responsible_name,created_at FROM tasks WHERE lead_id=? ORDER BY created_at DESC LIMIT 100",[leadId]),
  ]):[[],[],[]];
  return {ok:true,eventKey,zape,crm:row?{status:row.status,action:responseAction(response),leadId,lead:{name:row.lead_name||"",phoneMasked:maskPhone(row.lead_phone),email:row.lead_email||"",company:row.company||"",status:row.lead_status||"",responsible:row.responsible||"",responsibleUserId:row.responsible_user_id||"",pipelineId:row.pipeline_id||"",stageId:row.pipeline_stage_id||"",stageName:row.stage_name||"",stageType:row.stage_type||""},response,createdAt:row.created_at,updatedAt:row.updated_at}:null,origins:origins.map(origin=>({...origin,metadata:parseJson(origin.metadata_json,{})})),audit:audit.map(item=>({...item,changes:parseJson(item.changes_json,{})})),tasks};
}

function csvCell(value){const text=String(value??"");return /[";,\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
export async function buildIntegrationEventsCsv(options){
  const query=options.query||{};
  const range=resolvePeriod(query.period);
  const crmData=await loadCrmIntegrationData({queryRows:options.queryRows,from:range.from,to:range.to});
  const crmMap=new Map(crmData.events.map((event)=>[event.eventKey,event]));
  const maxRows=safeInteger(process.env.ZAPE_INTEGRATION_EXPORT_MAX_ROWS,20000,500,100000);
  const pageSize=500;
  const exported=[];
  let offset=0;
  let zapeAvailable=true;
  while(offset<maxRows){
    const params=new URLSearchParams({from:range.from,to:range.to,limit:String(Math.min(pageSize,maxRows-offset)),offset:String(offset)});
    for(const key of ["status","tenantId","eventType","search"]){const value=String(query[key]||"").trim();if(value)params.set(key,value);}
    let page;
    try{page=(await requestZape({baseUrl:normalizeZapeBaseUrl(options.monitorUrl),key:options.monitorKey,path:`/api/integration-monitor/overview?${params.toString()}`,timeoutMs:options.timeoutMs||DEFAULT_TIMEOUT_MS})).data;}catch{zapeAvailable=false;break;}
    const rows=(page.events||[]).map((event)=>({...event,...(crmMap.get(event.eventKey)||{})}));
    exported.push(...rows);
    offset+=rows.length;
    if(!page.pagination?.hasMore||!rows.length)break;
  }
  if(!zapeAvailable){
    const status=String(query.status||"").trim();
    const tenantId=String(query.tenantId||"").trim().toLowerCase();
    const eventType=String(query.eventType||"").trim();
    const search=String(query.search||"").trim().toLowerCase();
    exported.push(...crmData.events.filter((event)=>{
      if(status&&event.crmStatus!==status&&event.status!==status)return false;
      if(tenantId&&String(event.tenantId||"").toLowerCase()!==tenantId)return false;
      if(eventType&&event.eventType!==eventType)return false;
      if(search&&!([event.eventKey,event.externalLeadId,event.leadName,event.phoneMasked,event.crmLeadId,event.responsible].join(" ").toLowerCase().includes(search)))return false;
      return true;
    }).slice(0,maxRows));
  }
  const unique=Array.from(new Map(exported.map((event)=>[event.eventKey,event])).values()).slice(0,maxRows);
  const headers=["Data","Conta","Canal","Evento","Status técnico","Lead","Telefone mascarado","ID do lead","Ação CRM","Funil/etapa","Responsável","Tentativas","HTTP","Erro","Chave do evento"];
  const rows=unique.map((event)=>[event.createdAt,event.tenantId,event.channel,event.eventType,event.status||event.crmStatus,event.leadName,event.phoneMasked,event.crmLeadId,event.crmAction,event.stageName||event.stageId,event.responsible,event.attempts,event.lastHttpStatus,event.lastError,event.eventKey]);
  return [headers,...rows].map((row)=>row.map(csvCell).join(';')).join('\r\n');
}

export async function retryIntegrationEvents({monitorUrl,monitorKey,timeoutMs=DEFAULT_TIMEOUT_MS,eventKey="",tenantId=""}){return requestZape({baseUrl:normalizeZapeBaseUrl(monitorUrl),key:monitorKey,path:"/api/integration-monitor/retry",method:"POST",body:{eventKey:String(eventKey||"").trim(),tenantId:String(tenantId||"").trim()},timeoutMs}).then(result=>result.data);}

export const integrationDashboardInternals={resolvePeriod,maskPhone,mergeTenantData,mergeEventData,consolidatedHealth};
