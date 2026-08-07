import { randomUUID } from "node:crypto";

function parseJson(value, fallback = {}) { if (!value) return fallback; if (typeof value === "object") return value; try { return JSON.parse(value); } catch { return fallback; } }
function dateValue(value) { const date = new Date(value || Date.now()); return Number.isNaN(date.getTime()) ? new Date() : date; }
function roundRate(value) { return Math.round(Number(value || 0) * 100) / 100; }
function money(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function numericBudget(value) { const text=String(value||"").replace(/[^0-9,.-]/g,"").replace(/\.(?=.*\.)/g,"").replace(",", "."); const n=Number(text); return Number.isFinite(n)?Math.max(0,n):0; }
function semanticFromRow(row) {
  const key=String(row.semantic_key||"").trim(); if(key)return key;
  if(row.stage_type==='won')return 'won'; if(row.stage_type==='lost')return 'lost';
  const name=String(`${row.stage_name||''} ${row.lead_status||''}`).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/proposta|orcamento/.test(name))return 'proposal'; if(/reuniao|diagnostico|agend/.test(name))return 'meeting'; if(/qualific/.test(name))return 'qualified'; if(/contato|resposta|atendimento/.test(name))return 'contacted'; if(/negocia/.test(name))return 'negotiation'; return 'new';
}

export async function recordWhatsappActivity({ execute, queryRows, eventKey, leadId, tenantId, direction, channel = "WhatsApp", messageId = "", conversationId = "", preview = "", occurredAt }) {
  const at=dateValue(occurredAt); const dir=direction==='outbound'?'outbound':'inbound';
  const insertResult = await execute(`INSERT IGNORE INTO lead_whatsapp_activity
    (id,event_key,lead_id,tenant_id,direction,channel,message_id,conversation_id,message_preview,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,NOW(3))`, [randomUUID(),eventKey,leadId,tenantId,dir,channel,messageId,conversationId,String(preview||'').slice(0,500),at]);
  if (!Number(insertResult?.affectedRows || 0)) return;
  await execute(`INSERT INTO lead_whatsapp_attributions
    (id,lead_id,tenant_id,channel,first_seen_at,last_seen_at,first_inbound_at,first_outbound_at,last_inbound_at,last_outbound_at,interaction_count,inbound_count,outbound_count,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(3),NOW(3))
    ON DUPLICATE KEY UPDATE
      channel=VALUES(channel),first_seen_at=LEAST(first_seen_at,VALUES(first_seen_at)),last_seen_at=GREATEST(last_seen_at,VALUES(last_seen_at)),
      first_inbound_at=CASE WHEN VALUES(first_inbound_at) IS NULL THEN first_inbound_at WHEN first_inbound_at IS NULL THEN VALUES(first_inbound_at) ELSE LEAST(first_inbound_at,VALUES(first_inbound_at)) END,
      first_outbound_at=CASE WHEN VALUES(first_outbound_at) IS NULL THEN first_outbound_at WHEN first_outbound_at IS NULL THEN VALUES(first_outbound_at) ELSE LEAST(first_outbound_at,VALUES(first_outbound_at)) END,
      last_inbound_at=CASE WHEN VALUES(last_inbound_at) IS NULL THEN last_inbound_at WHEN last_inbound_at IS NULL THEN VALUES(last_inbound_at) ELSE GREATEST(last_inbound_at,VALUES(last_inbound_at)) END,
      last_outbound_at=CASE WHEN VALUES(last_outbound_at) IS NULL THEN last_outbound_at WHEN last_outbound_at IS NULL THEN VALUES(last_outbound_at) ELSE GREATEST(last_outbound_at,VALUES(last_outbound_at)) END,
      interaction_count=interaction_count+1,inbound_count=inbound_count+VALUES(inbound_count),outbound_count=outbound_count+VALUES(outbound_count),updated_at=NOW(3)`,
    [randomUUID(),leadId,tenantId,channel,at,at,dir==='inbound'?at:null,dir==='outbound'?at:null,dir==='inbound'?at:null,dir==='outbound'?at:null,1,dir==='inbound'?1:0,dir==='outbound'?1:0]);
  await execute(`UPDATE lead_whatsapp_attributions SET first_response_ms=TIMESTAMPDIFF(MICROSECOND,first_inbound_at,first_outbound_at) DIV 1000
    WHERE lead_id=? AND tenant_id=? AND first_inbound_at IS NOT NULL AND first_outbound_at IS NOT NULL AND first_outbound_at>=first_inbound_at`,[leadId,tenantId]);
  await execute("UPDATE lead_whatsapp_attributions SET is_first_touch=0,is_last_touch=0 WHERE lead_id=?",[leadId]);
  await execute(`UPDATE lead_whatsapp_attributions a JOIN (SELECT id FROM lead_whatsapp_attributions WHERE lead_id=? ORDER BY first_seen_at ASC,id ASC LIMIT 1) x ON x.id=a.id SET a.is_first_touch=1`,[leadId]);
  await execute(`UPDATE lead_whatsapp_attributions a JOIN (SELECT id FROM lead_whatsapp_attributions WHERE lead_id=? ORDER BY last_seen_at DESC,id DESC LIMIT 1) x ON x.id=a.id SET a.is_last_touch=1`,[leadId]);
}

export async function ensureWhatsappAttribution({ execute, leadId, tenantId, channel='WhatsApp', occurredAt }) {
  const at=dateValue(occurredAt);
  await execute(`INSERT INTO lead_whatsapp_attributions
    (id,lead_id,tenant_id,channel,first_seen_at,last_seen_at,interaction_count,inbound_count,outbound_count,created_at,updated_at)
    VALUES (?,?,?,?,?,?,0,0,0,NOW(3),NOW(3))
    ON DUPLICATE KEY UPDATE last_seen_at=GREATEST(last_seen_at,VALUES(last_seen_at)),interaction_count=GREATEST(interaction_count,1),updated_at=NOW(3)`,[randomUUID(),leadId,tenantId,channel,at,at]);
  await execute("UPDATE lead_whatsapp_attributions SET is_first_touch=0,is_last_touch=0 WHERE lead_id=?",[leadId]);
  await execute(`UPDATE lead_whatsapp_attributions a JOIN (SELECT id FROM lead_whatsapp_attributions WHERE lead_id=? ORDER BY first_seen_at ASC,id ASC LIMIT 1) x ON x.id=a.id SET a.is_first_touch=1`,[leadId]);
  await execute(`UPDATE lead_whatsapp_attributions a JOIN (SELECT id FROM lead_whatsapp_attributions WHERE lead_id=? ORDER BY last_seen_at DESC,id DESC LIMIT 1) x ON x.id=a.id SET a.is_last_touch=1`,[leadId]);
}

export async function getWhatsappAccountConversionReport({ queryRows, from, to, attribution='first_touch', view='acquisition' }) {
  const touchClause=attribution==='last_touch'?'a.is_last_touch=1':attribution==='assisted'?'1=1':'a.is_first_touch=1';
  const dateClause=view==='production' ? "((l.won_at BETWEEN ? AND ?) OR (l.lost_at BETWEEN ? AND ?) OR (a.last_seen_at BETWEEN ? AND ?))" : "a.first_seen_at BETWEEN ? AND ?";
  const params=view==='production'?[from,to,from,to,from,to]:[from,to];
  const rows=await queryRows(`SELECT a.*,l.name AS lead_name,l.responsible,l.responsible_user_id,l.status AS lead_status,l.is_lost,l.contact_made_at,
      l.estimated_budget,l.expected_value,l.closed_value,l.won_at,l.lost_at,l.pipeline_stage_id,ks.name AS stage_name,ks.stage_type,ks.semantic_key
    FROM lead_whatsapp_attributions a JOIN leads l ON l.id=a.lead_id AND l.deleted_at=''
    LEFT JOIN kanban_stages ks ON ks.id=l.pipeline_stage_id
    WHERE ${touchClause} AND ${dateClause}`,params);
  const leadIds=[...new Set(rows.map(r=>String(r.lead_id)))];
  const meetingSet=new Set(),proposalSet=new Set();
  if(leadIds.length){const placeholders=leadIds.map(()=>'?').join(',');
    const meetings=await queryRows(`SELECT DISTINCT lead_id FROM tasks WHERE lead_id IN (${placeholders}) AND type='reuniao'`,leadIds); meetings.forEach(r=>meetingSet.add(String(r.lead_id)));
    const proposals=await queryRows(`SELECT DISTINCT al.entity_id AS lead_id FROM audit_log al LEFT JOIN kanban_stages ks ON ks.id=JSON_UNQUOTE(JSON_EXTRACT(al.changes_json,'$.toStageId')) WHERE al.entity_type='lead' AND al.entity_id IN (${placeholders}) AND (ks.semantic_key='proposal' OR LOWER(ks.name) LIKE '%proposta%')`,leadIds).catch(()=>[]); proposals.forEach(r=>proposalSet.add(String(r.lead_id)));
  }
  const map=new Map(),owners=new Map(); const trend=new Map();
  for(const row of rows){const leadId=String(row.lead_id); const semantic=semanticFromRow(row); const won=semantic==='won'||Boolean(row.won_at); const lost=semantic==='lost'||Number(row.is_lost)===1||Boolean(row.lost_at); const meeting=meetingSet.has(leadId)||['meeting','proposal','negotiation','won'].includes(semantic); const proposal=proposalSet.has(leadId)||['proposal','negotiation','won'].includes(semantic); const qualified=['qualified','meeting','proposal','negotiation','won'].includes(semantic); const contacted=Boolean(String(row.contact_made_at||'').trim())||Number(row.outbound_count||0)>0; const revenue=won?(money(row.closed_value)||money(row.expected_value)||numericBudget(row.estimated_budget)):0;
    const key=String(row.tenant_id||'unknown'); const metric=map.get(key)||{tenantId:key,leads:new Set(),inboundMessages:0,outboundMessages:0,contacted:0,qualified:0,meetings:0,proposals:0,won:0,lost:0,revenue:0,responseTimes:[],within5:0,within15:0};
    if(!metric.leads.has(leadId)){metric.leads.add(leadId);metric.contacted+=contacted?1:0;metric.qualified+=qualified?1:0;metric.meetings+=meeting?1:0;metric.proposals+=proposal?1:0;metric.won+=won?1:0;metric.lost+=lost?1:0;metric.revenue+=revenue; if(row.first_response_ms!=null){const ms=Number(row.first_response_ms);metric.responseTimes.push(ms);if(ms<=300000)metric.within5++;if(ms<=900000)metric.within15++;}}
    metric.inboundMessages+=Number(row.inbound_count||0);metric.outboundMessages+=Number(row.outbound_count||0);map.set(key,metric);
    const ownerKey=String(row.responsible_user_id||row.responsible||'unassigned'); const ownerComposite=`${key}:${ownerKey}`; const owner=owners.get(ownerComposite)||{responsibleUserId:String(row.responsible_user_id||''),responsible:String(row.responsible||'Sem responsável'),tenantId:key,leads:new Set(),won:0,revenue:0}; if(!owner.leads.has(leadId)){owner.leads.add(leadId);owner.won+=won?1:0;owner.revenue+=revenue;} owners.set(ownerComposite,owner);
    const date=String((view==='production'?(row.won_at||row.lost_at||row.last_seen_at):row.first_seen_at)||'').slice(0,10); const point=trend.get(date)||{date,leads:0,won:0,revenue:0}; point.leads++;point.won+=won?1:0;point.revenue+=revenue;trend.set(date,point);
  }
  const byTenant=[...map.values()].map(m=>{const leads=m.leads.size;const avg=m.responseTimes.length?Math.round(m.responseTimes.reduce((a,b)=>a+b,0)/m.responseTimes.length):0;return {tenantId:m.tenantId,leads,inboundMessages:m.inboundMessages,outboundMessages:m.outboundMessages,contacted:m.contacted,qualified:m.qualified,meetings:m.meetings,proposals:m.proposals,won:m.won,lost:m.lost,revenue:roundRate(m.revenue),conversionRate:leads?roundRate(m.won/leads*100):0,qualificationRate:leads?roundRate(m.qualified/leads*100):0,meetingRate:leads?roundRate(m.meetings/leads*100):0,averageFirstResponseMs:avg,within5Rate:m.responseTimes.length?roundRate(m.within5/m.responseTimes.length*100):0,within15Rate:m.responseTimes.length?roundRate(m.within15/m.responseTimes.length*100):0};}).sort((a,b)=>b.leads-a.leads);
  const totals=byTenant.reduce((acc,m)=>{for(const key of ['leads','inboundMessages','outboundMessages','contacted','qualified','meetings','proposals','won','lost','revenue'])acc[key]+=Number(m[key]||0);return acc;},{leads:0,inboundMessages:0,outboundMessages:0,contacted:0,qualified:0,meetings:0,proposals:0,won:0,lost:0,revenue:0});
  return {attribution,view,totals:{...totals,conversionRate:totals.leads?roundRate(totals.won/totals.leads*100):0,ticketAverage:totals.won?roundRate(totals.revenue/totals.won):0},byTenant,byOwner:[...owners.values()].map(o=>({tenantId:o.tenantId,responsibleUserId:o.responsibleUserId,responsible:o.responsible,leads:o.leads.size,won:o.won,revenue:roundRate(o.revenue),conversionRate:o.leads.size?roundRate(o.won/o.leads.size*100):0})).sort((a,b)=>b.leads-a.leads),trend:[...trend.values()].sort((a,b)=>a.date.localeCompare(b.date))};
}

export function whatsappConversionCsv(report){const esc=v=>{const s=String(v??'');return /[;"\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};const headers=['Conta','Leads','Mensagens recebidas','Mensagens enviadas','Contatados','Qualificados','Reuniões','Propostas','Vendas','Perdidos','Conversão (%)','Receita','Tempo médio 1ª resposta (ms)','Respondidos até 5 min (%)','Respondidos até 15 min (%)'];const rows=report.byTenant.map(r=>[r.tenantId,r.leads,r.inboundMessages,r.outboundMessages,r.contacted,r.qualified,r.meetings,r.proposals,r.won,r.lost,r.conversionRate,r.revenue,r.averageFirstResponseMs,r.within5Rate,r.within15Rate]);return '\uFEFF'+[headers,...rows].map(row=>row.map(esc).join(';')).join('\r\n');}

export function resolveWhatsappReportRange(periodValue){const period=['24h','7d','30d','90d'].includes(String(periodValue||''))?String(periodValue):'30d';const days=period==='90d'?90:period==='30d'?30:period==='7d'?7:1;const to=new Date();const from=new Date(to.getTime()-days*86400000);return {period,from:from.toISOString(),to:to.toISOString()};}
