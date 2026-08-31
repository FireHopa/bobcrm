import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  downloadIntegrationEventsCsv,
  fetchIntegrationDashboardFromServer,
  fetchIntegrationEventDetailFromServer,
  retryIntegrationEventsOnServer,
  updateIntegrationIncidentOnServer,
  type IntegrationDashboardEvent,
  type IntegrationDashboardFilters,
  type IntegrationDashboardOverview,
  type IntegrationEventDetail,
  type IntegrationIncident,
} from "../utils/api";
import { WhatsappAccountConversionPanel } from "./WhatsappAccountConversionPanel";
import { useConfirmationDialog } from "./ConfirmationDialog";
import { ModalDialog } from "./ModalDialog";

type IntegrationDashboardProps = { onViewLead: (leadId: string) => void };

const emptyFilters: IntegrationDashboardFilters = { period: "24h", status: "", tenantId: "", eventType: "", search: "", limit: 50, offset: 0 };
const numberFormat = new Intl.NumberFormat("pt-BR");

function formatNumber(value: number | undefined): string { return numberFormat.format(Number(value || 0)); }
function formatPercent(value: number | undefined): string { return `${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }
function formatDuration(ms: number | undefined): string { const value = Number(ms || 0); if (!value) return "0 s"; if (value < 1000) return `${Math.round(value)} ms`; if (value < 60_000) return `${(value / 1000).toFixed(1)} s`; return `${(value / 60_000).toFixed(1)} min`; }
function formatDateTime(value: string | undefined): string { if (!value) return "Sem registro"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" }); }
function relativeTime(value: string | undefined): string { if (!value) return "Sem registro"; const timestamp = Date.parse(value); if (!Number.isFinite(timestamp)) return formatDateTime(value); const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000)); if (seconds < 60) return `há ${seconds}s`; if (seconds < 3600) return `há ${Math.round(seconds / 60)} min`; if (seconds < 86400) return `há ${Math.round(seconds / 3600)} h`; return `há ${Math.round(seconds / 86400)} dia(s)`; }
function statusLabel(status: string): string { if (["delivered", "completed"].includes(status)) return "Entregue"; if (status === "pending") return "Pendente"; if (["sending", "processing"].includes(status)) return "Processando"; if (["failed_permanent", "failed"].includes(status)) return "Falha"; return status || "Desconhecido"; }
function eventTypeLabel(type: string): string { if (type === "whatsapp.inbound.first_contact") return "Primeiro contato"; if (type === "whatsapp.inbound.reactivated") return "Reativação"; if (type === "zape.message.received") return "Mensagem recebida"; if (type === "zape.message.sent") return "Mensagem enviada"; if (type === "zape.conversation.opened") return "Conversa visualizada"; if (type === "zape.conversation.closed") return "Conversa encerrada"; if (type === "zape.conversation.transferred") return "Conversa transferida"; if (type === "lead.created") return "Lead criado"; return type || "Evento"; }
function actionLabel(action: string): string { if (action === "created") return "Criado"; if (action === "updated") return "Atualizado"; if (action === "reactivated") return "Reativado"; if (action === "message_received") return "Mensagem registrada"; if (action === "message_sent") return "Resposta registrada"; return action || "Aguardando"; }
function statusClass(status: string): string { if (["delivered", "completed"].includes(status)) return "integrationStatusSuccess"; if (["failed_permanent", "failed"].includes(status)) return "integrationStatusCritical"; if (["pending", "sending", "processing"].includes(status)) return "integrationStatusAttention"; return "integrationStatusNeutral"; }
function jsonText(value: unknown): string { try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ""); } }
function chartLabel(value: unknown, fallback: string): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return fallback;
}

function LineChart({ title, description, rows, valueKey }: { title: string; description: string; rows: Array<Record<string, unknown>>; valueKey: string }) {
  const values = rows.map((row) => Number(row[valueKey] || 0));
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${rows.length <= 1 ? 50 : (index / (rows.length - 1)) * 100},${90 - (value / max) * 75}`).join(" ");
  return (
    <article className="integrationChartCard">
      <div><h4>{title}</h4><p>{description}</p></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={title}>
        <line x1="0" y1="90" x2="100" y2="90" className="chartAxis" />
        <polyline points={points || "0,90 100,90"} fill="none" className="chartLine" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="integrationChartFooter">
        <span>{chartLabel(rows[0]?.date ?? rows[0]?.bucket, "Início")}</span>
        <strong>{formatNumber(values.length ? values[values.length - 1] : 0)}</strong>
        <span>{chartLabel(rows[rows.length - 1]?.date ?? rows[rows.length - 1]?.bucket, "Agora")}</span>
      </div>
    </article>
  );
}

function EventDetailDrawer({ detail, loading, onClose, onViewLead }: { detail: IntegrationEventDetail | null; loading: boolean; onClose: () => void; onViewLead: (leadId: string) => void }) {
  if (!detail && !loading) return null;
  const zape = detail?.zape || {};
  const attempts = Array.isArray(zape.attemptHistory) ? zape.attemptHistory : [];
  return (
    <div className="integrationDrawerBackdrop" onMouseDown={(event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="integrationDetailDrawer">
        <header><div><small>Detalhes completos</small><h3>{detail?.eventKey || "Carregando evento"}</h3></div><button type="button" className="ghostButton" onClick={onClose}>Fechar</button></header>
        {loading ? <div className="integrationDrawerLoading">Carregando histórico técnico e comercial...</div> : null}
        {detail ? <>
          <section className="integrationDetailGrid">
            <article><span>Status efetivo</span><strong>{statusLabel(String(zape.effectiveStatus || zape.status || ""))}</strong>{zape.reconciled ? <small>Falha técnica reconciliada pelo BobCRM</small> : null}</article>
            <article><span>Status técnico Zape</span><strong>{statusLabel(String(zape.technicalStatus || zape.status || ""))}</strong></article>
            <article><span>Conta</span><strong>{String(zape.tenantId || "-")}</strong></article>
            <article><span>Tentativas</span><strong>{formatNumber(Number(zape.attempts || 0))}</strong></article>
            <article><span>HTTP</span><strong>{String(zape.lastHttpStatus || "-")}</strong></article>
            <article><span>Ação no CRM</span><strong>{actionLabel(detail.crm?.action || String(zape.crmAction || ""))}</strong></article>
            <article><span>Tempo de entrega</span><strong>{formatDuration(Number(zape.deliveryTimeMs || 0))}</strong></article>
          </section>
          {detail.crm ? <section className="integrationDetailSection"><div className="integrationSectionTitle"><div><h4>Lead no BobCRM</h4><p>Resultado comercial e posição atual.</p></div>{detail.crm.leadId ? <button className="primaryButton" type="button" onClick={() => onViewLead(detail.crm!.leadId)}>Abrir lead</button> : null}</div><dl className="integrationDetailList"><div><dt>Nome</dt><dd>{detail.crm.lead.name || "Sem nome"}</dd></div><div><dt>Telefone</dt><dd>{detail.crm.lead.phoneMasked || "-"}</dd></div><div><dt>Empresa</dt><dd>{detail.crm.lead.company || "-"}</dd></div><div><dt>Responsável</dt><dd>{detail.crm.lead.responsible || "Sem responsável"}</dd></div><div><dt>Etapa</dt><dd>{detail.crm.lead.stageName || detail.crm.lead.status || "-"}</dd></div><div><dt>Status</dt><dd>{detail.crm.lead.status || "-"}</dd></div></dl></section> : null}
          <section className="integrationDetailSection"><h4>Linha do tempo de tentativas</h4>{attempts.length ? <div className="integrationAttemptTimeline">{attempts.map((attempt, index) => <article key={`${attempt.attempt}-${index}`}><span className={attempt.outcome === "delivered" ? "success" : "failure"} /><div><strong>Tentativa {attempt.attempt}</strong><p>{formatDateTime(attempt.startedAt)} · {formatDuration(attempt.latencyMs)} · HTTP {attempt.httpStatus || "sem resposta"}</p>{attempt.error ? <small>{attempt.error}</small> : null}</div></article>)}</div> : <p className="integrationEmptyText">Nenhuma tentativa registrada.</p>}</section>
          <section className="integrationDetailSection"><h4>Atividades comerciais</h4><div className="integrationCompactList">{detail.audit.slice(0, 20).map((item, index) => <article key={index}><strong>{String(item.summary || item.action || "Atividade")}</strong><small>{formatDateTime(String(item.created_at || ""))} · {String(item.actor_name || "Sistema")}</small></article>)}{!detail.audit.length ? <p className="integrationEmptyText">Nenhuma atividade comercial registrada.</p> : null}</div></section>
          <section className="integrationDetailSection"><h4>Tarefas relacionadas</h4><div className="integrationCompactList">{detail.tasks.slice(0, 20).map((item, index) => <article key={index}><strong>{String(item.title || item.type || "Tarefa")}</strong><small>{String(item.status || "")} · {formatDateTime(String(item.created_at || ""))}</small></article>)}{!detail.tasks.length ? <p className="integrationEmptyText">Nenhuma tarefa relacionada.</p> : null}</div></section>
          <details className="integrationTechnicalPayload"><summary>Payload técnico tratado</summary><pre>{jsonText({ zape: detail.zape, crmResponse: detail.crm?.response, origins: detail.origins })}</pre></details>
        </> : null}
      </aside>
    </div>
  );
}

export function IntegrationDashboard({ onViewLead }: IntegrationDashboardProps) {
  const [overview, setOverview] = useState<IntegrationDashboardOverview | null>(null);
  const [filters, setFilters] = useState<IntegrationDashboardFilters>(emptyFilters);
  const [searchDraft, setSearchDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionKey, setActionKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<IntegrationEventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resolutionIncident, setResolutionIncident] = useState<IntegrationIncident | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const mountedRef = useRef(true);
  const { confirm, confirmationDialog } = useConfirmationDialog();

  const loadOverview = useCallback(async (nextFilters: IntegrationDashboardFilters = filters, silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    setError("");
    try { const result = await fetchIntegrationDashboardFromServer(nextFilters); if (mountedRef.current) setOverview(result); }
    catch (caught) { if (mountedRef.current) setError(caught instanceof Error ? caught.message : "Não foi possível carregar a integração."); }
    finally { if (mountedRef.current) { setLoading(false); setRefreshing(false); } }
  }, [filters]);

  useEffect(() => { mountedRef.current = true; void loadOverview(filters); const timer = window.setInterval(() => void loadOverview(filters, true), 30_000); return () => { mountedRef.current = false; window.clearInterval(timer); }; }, [filters.period, filters.status, filters.tenantId, filters.eventType, filters.search, filters.offset, loadOverview]);

  const health = overview?.health, summary = overview?.summary, worker = overview?.zape.worker, queue = overview?.zape.queue, commercial = overview?.commercial;
  const eventCountText = useMemo(() => `${formatNumber(overview?.pagination.total)} evento(s) no filtro`, [overview]);
  const openIncidents = overview?.incidents.filter((incident) => incident.status !== "resolved") || [];

  function applyFilter<Key extends keyof IntegrationDashboardFilters>(key: Key, value: IntegrationDashboardFilters[Key]) { setFilters((current) => ({ ...current, [key]: value, offset: 0 })); }
  function handleSearch(event: FormEvent<HTMLFormElement>) { event.preventDefault(); applyFilter("search", searchDraft.trim()); }

  async function handleRetry(event: IntegrationDashboardEvent) {
    if (event.status !== "failed_permanent") return;
    const confirmed = await confirm({
      title: "Reprocessar evento?",
      message: event.eventKey,
      detail: "Use esta ação somente para falhas que continuam não reconciliadas no BobCRM.",
      confirmLabel: "Reprocessar",
      tone: "danger",
    });
    if (!confirmed) return;
    setActionKey(event.eventKey); setError(""); setMessage("");
    try { const result = await retryIntegrationEventsOnServer({ eventKey: event.eventKey }); setMessage(result.retried ? "Evento reenfileirado com sucesso." : "O evento não estava mais elegível."); await loadOverview(filters, true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível reprocessar o evento."); }
    finally { setActionKey(""); }
  }

  async function handleRetryTenant(tenantId: string) {
    const confirmed = await confirm({
      title: "Reprocessar falhas da conta?",
      message: tenantId,
      detail: "Somente eventos ainda elegíveis no Zape serão reenfileirados.",
      confirmLabel: "Reprocessar conta",
      tone: "danger",
    });
    if (!confirmed) return;
    setActionKey(`tenant:${tenantId}`);
    try { const result = await retryIntegrationEventsOnServer({ tenantId }); setMessage(`${formatNumber(result.retried)} evento(s) reenfileirado(s).`); await loadOverview(filters, true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível reprocessar a conta."); }
    finally { setActionKey(""); }
  }

  async function openDetail(eventKey: string) {
    setDetail(null); setDetailLoading(true); setError("");
    try { setDetail(await fetchIntegrationEventDetailFromServer(eventKey)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível carregar o evento."); }
    finally { setDetailLoading(false); }
  }

  async function performIncidentAction(incident: IntegrationIncident, action: "acknowledge" | "resolve" | "reopen", note = "") {
    setActionKey(`incident:${incident.id}`);
    try { await updateIntegrationIncidentOnServer(incident.id, action, note); setMessage("Incidente atualizado."); await loadOverview(filters, true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o incidente."); }
    finally { setActionKey(""); }
  }

  function handleIncident(incident: IntegrationIncident, action: "acknowledge" | "resolve" | "reopen") {
    if (action === "resolve") {
      setResolutionIncident(incident);
      setResolutionNote("");
      return;
    }
    void performIncidentAction(incident, action);
  }

  async function handleResolveIncident() {
    if (!resolutionIncident) return;
    const incident = resolutionIncident;
    await performIncidentAction(incident, "resolve", resolutionNote.trim());
    setResolutionIncident(null);
    setResolutionNote("");
  }

  return (
    <section className="integrationDashboardV1 integrationDashboardV2">
      <div className={`integrationHealthHero ${health?.status || "attention"}`}>
        <div className="integrationHealthIdentity"><span className="integrationHealthPulse" aria-hidden="true" /><div><small>Saúde da integração</small><h3>{health?.label || (loading ? "Carregando" : "Indisponível")}</h3><p>{health?.reasons?.[0] || "Zape e BobCRM estão processando os leads normalmente."}</p></div></div>
        <div className="integrationHealthMeta"><span><strong>Telemetria Zape</strong>{overview?.zape.online ? "Online" : overview?.zape.code === "ZAPE_MONITOR_NOT_CONFIGURED" ? "Não configurada" : "Indisponível"}</span><span><strong>Worker Zape</strong>{worker ? (worker.running ? (worker.processing ? "Processando" : "Ativo") : "Parado") : "Sem telemetria"}</span><span><strong>Fila Zape</strong>{overview?.zape.storage ? (overview.zape.storage.activeMode === "mysql" ? "MySQL" : overview.zape.storage.activeMode || "Fallback") : "Sem telemetria"}</span><span><strong>Última entrega</strong>{relativeTime(worker?.lastDeliveryAt || queue?.lastDeliveredAt)}</span><span><strong>Consulta</strong>{overview?.zape.latencyMs ? `${overview.zape.latencyMs} ms` : "Sem resposta"}</span><span><strong>CRM → Zape</strong>{overview?.reverseSync?.enabled ? `${formatNumber(Number(overview.reverseSync.pending || 0) + Number(overview.reverseSync.sending || 0))} pendente(s)` : "Desativado"}</span></div>
        <button className="secondaryButton integrationRefreshButton" type="button" onClick={() => void loadOverview(filters, true)} disabled={refreshing}>{refreshing ? "Atualizando..." : "Atualizar agora"}</button>
      </div>

      {error ? <div className="systemNotice systemNoticeError"><strong>Erro:</strong><span>{error}</span></div> : null}
      {message ? <div className="systemNotice systemNoticeMigration"><strong>Pronto:</strong><span>{message}</span></div> : null}
      {overview?.zape.storage?.configuredMode === "mysql" && overview.zape.storage.activeMode !== "mysql" ? <div className="systemNotice systemNoticeError"><strong>Fila:</strong><span>O MySQL foi configurado, mas o Zape está operando em fallback. {overview.zape.storage.fallbackReason}</span></div> : null}

      <div className="integrationToolbar"><div className="integrationPeriodControl">{(["24h", "7d", "30d", "90d"] as const).map((period) => <button key={period} type="button" className={filters.period === period ? "active" : ""} onClick={() => applyFilter("period", period)}>{period === "24h" ? "24 horas" : period === "7d" ? "7 dias" : period === "30d" ? "30 dias" : "90 dias"}</button>)}</div><div className="integrationToolbarActions"><button className="secondaryButton" type="button" onClick={() => void downloadIntegrationEventsCsv(filters)}>Exportar CSV</button><span className="integrationUpdatedAt">Atualizado em {formatDateTime(overview?.generatedAt)}</span></div></div>

      <div className="integrationMetricSection"><div className="integrationSectionTitle"><div><h3>Operação técnica</h3><p>Da detecção no WhatsApp até a confirmação do BobCRM.</p></div></div><div className="integrationMetricGrid"><article><span>Eventos detectados</span><strong>{formatNumber(summary?.detected)}</strong><small>No período</small></article><article><span>Entregues ao CRM</span><strong>{formatNumber(summary?.delivered)}</strong><small>{formatPercent(summary?.deliveryRate)} de entrega</small></article><article className={summary?.pending ? "metricAttention" : ""}><span>Pendentes</span><strong>{formatNumber(summary?.pending)}</strong><small>Mais antigo: {queue?.pendingAgeMinutes ? `${queue.pendingAgeMinutes} min` : "sem fila"}</small></article><article className={summary?.failed ? "metricCritical" : ""}><span>Falhas não reconciliadas</span><strong>{formatNumber(summary?.failed)}</strong><small>{summary?.failed ? "Na lista atual" : summary?.failedReported ? `${formatNumber(summary.failedReported)} técnica(s) reportada(s) pelo Zape, sem falha efetiva nesta lista` : "Nenhuma falha"}</small></article><article><span>Tempo médio</span><strong>{formatDuration(summary?.averageDeliveryMs)}</strong><small>Zape até BobCRM</small></article></div></div>

      <div className="integrationChartsGrid"><LineChart title="Entregas ao CRM" description="Eventos entregues ao longo do período." rows={(overview?.trends.queue || []) as Array<Record<string, unknown>>} valueKey="delivered" /><LineChart title="Fila pendente" description="Evolução histórica do backlog." rows={(overview?.trends.health || []) as Array<Record<string, unknown>>} valueKey="pending_max" /><LineChart title="Latência do monitor" description="Tempo médio de resposta do Zape." rows={(overview?.trends.health || []) as Array<Record<string, unknown>>} valueKey="latency_avg" /></div>

      <div className="integrationMetricSection"><div className="integrationSectionTitle"><div><h3>Conversão comercial</h3><p>Avanço dos leads recebidos pela integração no período selecionado.</p></div></div><div className="integrationConversionFunnel"><article><span>Leads integrados</span><strong>{formatNumber(commercial?.integratedLeads)}</strong></article><article><span>Contato realizado</span><strong>{formatNumber(commercial?.contacted)}</strong></article><article><span>Reuniões</span><strong>{formatNumber(commercial?.meetings)}</strong><small>{formatPercent(commercial?.meetingRate)}</small></article><article><span>Propostas</span><strong>{formatNumber(commercial?.proposals)}</strong><small>{formatPercent(commercial?.proposalRate)}</small></article><article className="conversionWon"><span>Ganhos</span><strong>{formatNumber(commercial?.won)}</strong><small>{formatPercent(commercial?.conversionRate)}</small></article><article><span>Perdidos</span><strong>{formatNumber(commercial?.lost)}</strong></article></div></div>

      <WhatsappAccountConversionPanel period={filters.period || "24h"} />

      <section className="panel integrationIncidentPanel"><div className="integrationSectionTitle"><div><h3>Gestão de incidentes</h3><p>Registro permanente de falhas, atrasos, indisponibilidades e normalizações.</p></div><span className={`badge ${openIncidents.length ? "badgeRed" : "badgeGreen"}`}>{formatNumber(openIncidents.length)} aberto(s)</span></div><div className="integrationIncidentList">{overview?.incidents.map((incident) => <article key={incident.id} className={`integrationIncident ${incident.severity} ${incident.status}`}><div><span className="integrationIncidentStatus">{incident.status === "open" ? "Aberto" : incident.status === "acknowledged" ? "Em análise" : "Resolvido"}</span><h4>{incident.title}</h4><p>{incident.description}</p><small>Primeiro: {formatDateTime(incident.firstSeenAt)} · Último: {relativeTime(incident.lastSeenAt)} · {formatNumber(incident.occurrences)} ocorrência(s)</small>{incident.resolutionNote ? <small>Resolução: {incident.resolutionNote}</small> : null}</div><div className="integrationIncidentActions">{incident.status === "open" ? <button className="secondaryButton" type="button" disabled={actionKey === `incident:${incident.id}`} onClick={() => void handleIncident(incident, "acknowledge")}>Assumir</button> : null}{incident.status !== "resolved" ? <button className="primaryButton" type="button" disabled={actionKey === `incident:${incident.id}`} onClick={() => void handleIncident(incident, "resolve")}>Resolver</button> : <button className="secondaryButton" type="button" onClick={() => void handleIncident(incident, "reopen")}>Reabrir</button>}</div></article>)}{!overview?.incidents.length ? <p className="integrationEmptyText">Nenhum incidente registrado.</p> : null}</div></section>

      <section className="panel integrationTenantPanel"><div className="integrationSectionTitle"><div><h3>Contas do WhatsApp</h3><p>Visão técnica e comercial por conta.</p></div><span className="badge badgeBlue">{formatNumber(overview?.tenants.length)} conta(s)</span></div><div className="integrationTableWrap"><table className="integrationTable"><thead><tr><th>Conta</th><th>Detectados</th><th>Entregues</th><th>Pendentes</th><th>Falhas</th><th>Criados</th><th>Reativados</th><th>Sem responsável</th><th>Última entrega</th><th /></tr></thead><tbody>{overview?.tenants.map((tenant) => <tr key={tenant.tenantId}><td><button className="integrationTenantLink" type="button" onClick={() => applyFilter("tenantId", tenant.tenantId)}>{tenant.tenantId}</button></td><td>{formatNumber(tenant.total || tenant.receivedByCrm)}</td><td>{formatNumber(tenant.delivered || tenant.completedByCrm)}</td><td>{formatNumber(Number(tenant.pending || 0) + Number(tenant.sending || 0))}</td><td><span className={tenant.effectiveFailed ? "integrationCriticalText" : ""}>{formatNumber(tenant.effectiveFailed)}</span>{tenant.failedPermanent ? <small title="Falhas técnicas reportadas pelo Zape">Zape: {formatNumber(tenant.failedPermanent)} técnica(s)</small> : null}</td><td>{formatNumber(tenant.created)}</td><td>{formatNumber(tenant.reactivated)}</td><td>{formatNumber(tenant.withoutOwner)}</td><td>{relativeTime(tenant.lastDeliveredAt || tenant.lastReceivedAt)}</td><td>{tenant.effectiveFailed ? <button className="tableActionButton dangerTableAction" type="button" disabled={actionKey === `tenant:${tenant.tenantId}`} onClick={() => void handleRetryTenant(tenant.tenantId)}>Reprocessar</button> : null}</td></tr>)}{!overview?.tenants.length && !loading ? <tr><td colSpan={10} className="integrationEmptyCell">Nenhuma conta com eventos.</td></tr> : null}</tbody></table></div></section>

      <section className="panel integrationHistoryPanel"><div className="integrationSectionTitle"><div><h3>Histórico de eventos</h3><p>{eventCountText}. Clique em detalhes para abrir toda a linha do tempo.</p></div></div><form className="integrationFilters" onSubmit={handleSearch}><select value={filters.tenantId || ""} onChange={(event: ChangeEvent<HTMLSelectElement>) => applyFilter("tenantId", event.target.value)}><option value="">Todas as contas</option>{overview?.filters.tenants.map((tenant) => <option key={tenant} value={tenant}>{tenant}</option>)}</select><select value={filters.status || ""} onChange={(event: ChangeEvent<HTMLSelectElement>) => applyFilter("status", event.target.value)}><option value="">Todos os status</option><option value="delivered">Entregues</option><option value="pending">Pendentes</option><option value="sending">Processando</option><option value="failed_permanent">Falhas</option></select><select value={filters.eventType || ""} onChange={(event: ChangeEvent<HTMLSelectElement>) => applyFilter("eventType", event.target.value)}><option value="">Todos os eventos</option>{overview?.filters.eventTypes.map((type) => <option key={type} value={type}>{eventTypeLabel(type)}</option>)}</select><input value={searchDraft} onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchDraft(event.target.value)} placeholder="Nome, telefone, evento ou lead" /><button className="secondaryButton" type="submit">Buscar</button>{(filters.tenantId || filters.status || filters.eventType || filters.search) ? <button className="ghostButton" type="button" onClick={() => { setSearchDraft(""); setFilters(emptyFilters); }}>Limpar</button> : null}</form><div className="integrationTableWrap"><table className="integrationTable integrationEventTable"><thead><tr><th>Horário</th><th>Conta</th><th>Evento</th><th>Status</th><th>Lead</th><th>Ação no CRM</th><th>Responsável</th><th>Tentativas</th><th>HTTP</th><th /></tr></thead><tbody>{overview?.events.map((event) => <tr key={event.eventKey}><td title={formatDateTime(event.createdAt)}>{relativeTime(event.createdAt)}</td><td>{event.tenantId}</td><td><strong>{eventTypeLabel(event.eventType)}</strong><small>{event.channel || "WhatsApp"}</small></td><td><span className={`integrationStatus ${statusClass(event.status)}`}>{statusLabel(event.status)}</span>{event.reconciled ? <small className="integrationReconciledNote">Falha técnica reconciliada</small> : event.lastError ? <small className="integrationErrorPreview" title={event.lastError}>{event.lastError}</small> : null}</td><td><strong>{event.leadName || "Sem nome"}</strong><small>{event.phoneMasked || event.externalLeadId}</small></td><td><strong>{actionLabel(event.crmAction)}</strong>{event.duplicateMatched ? <small>Duplicidade evitada</small> : null}</td><td>{event.responsible || "Sem responsável"}</td><td>{event.attempts}</td><td>{event.lastHttpStatus || "-"}</td><td className="integrationActionsCell"><button className="tableActionButton" type="button" onClick={() => void openDetail(event.eventKey)}>Detalhes</button>{event.crmLeadId ? <button className="tableActionButton primaryTableAction" type="button" onClick={() => onViewLead(event.crmLeadId)}>Abrir lead</button> : null}{event.status === "failed_permanent" ? <button className="tableActionButton dangerTableAction" type="button" disabled={actionKey === event.eventKey} onClick={() => void handleRetry(event)}>Reprocessar</button> : null}</td></tr>)}{!overview?.events.length && !loading ? <tr><td colSpan={10} className="integrationEmptyCell">Nenhum evento encontrado.</td></tr> : null}</tbody></table></div><div className="integrationPagination"><button className="secondaryButton" type="button" disabled={!Number(filters.offset || 0)} onClick={() => setFilters((current) => ({ ...current, offset: Math.max(0, Number(current.offset || 0) - Number(current.limit || 50)) }))}>Anterior</button><span>{Number(filters.offset || 0) + 1} a {Math.min(Number(filters.offset || 0) + Number(filters.limit || 50), overview?.pagination.total || 0)} de {formatNumber(overview?.pagination.total)}</span><button className="secondaryButton" type="button" disabled={!overview?.pagination.hasMore} onClick={() => setFilters((current) => ({ ...current, offset: Number(current.offset || 0) + Number(current.limit || 50) }))}>Próxima</button></div></section>

      {resolutionIncident ? (
        <ModalDialog
          title="Resolver incidente"
          description={resolutionIncident.title}
          size="small"
          onClose={() => { setResolutionIncident(null); setResolutionNote(""); }}
          closeDisabled={actionKey === `incident:${resolutionIncident.id}`}
          footer={<><button className="secondaryButton" type="button" onClick={() => { setResolutionIncident(null); setResolutionNote(""); }} disabled={actionKey === `incident:${resolutionIncident.id}`}>Cancelar</button><button className="primaryButton" type="button" data-dialog-initial-focus onClick={() => void handleResolveIncident()} disabled={actionKey === `incident:${resolutionIncident.id}`}>Registrar resolução</button></>}
        >
          <label className="integrationResolutionField"><span>Como foi resolvido?</span><textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} rows={4} maxLength={5000} placeholder="Ex.: falha técnica já estava reconciliada no CRM; monitor normalizado." /></label>
        </ModalDialog>
      ) : null}
      {confirmationDialog}
      <EventDetailDrawer detail={detail} loading={detailLoading} onClose={() => { setDetail(null); setDetailLoading(false); }} onViewLead={onViewLead} />
      {loading ? <div className="integrationLoadingOverlay">Carregando dados da integração...</div> : null}
    </section>
  );
}
