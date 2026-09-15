import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCommercialAuditFromServer,
  type CommercialAuditDashboard,
  type CommercialAuditQuery,
} from "../utils/api";

type CommercialAuditDashboardProps = {
  onViewLead: (leadId: string) => void;
};

type AuditView = "analytics" | "activities" | "collaborators";

type AuditFilters = {
  dateFrom: string;
  dateTo: string;
  eventType: string;
  actorId: string;
  responsibleUserId: string;
  source: string;
  pipelineId: string;
  stageId: string;
  search: string;
};

const PAGE_SIZE = 120;

const EMPTY_DASHBOARD: CommercialAuditDashboard = {
  generatedAt: "",
  summary: { leadCreated: 0, tasksCreated: 0, tasksCompleted: 0, movements: 0, contractsClosed: 0, noInterest: 0 },
  analytics: { byStage: [], transitions: [], byPipeline: [], daily: [] },
  activities: [],
  collaborators: [],
  pagination: { total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false, sourceTruncated: false },
  filters: { eventTypes: [], users: [], sources: [], pipelines: [] },
};

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultDateRange(): Pick<AuditFilters, "dateFrom" | "dateTo"> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { dateFrom: dateInputValue(start), dateTo: dateInputValue(end) };
}

function emptyFilters(): AuditFilters {
  return {
    ...defaultDateRange(),
    eventType: "",
    actorId: "",
    responsibleUserId: "",
    source: "",
    pipelineId: "",
    stageId: "",
    search: "",
  };
}

function localDayStartIso(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function localDayAfterIso(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function formatDateTime(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatChartDate(value: string): string {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}` : value;
}

function leadLabel(activity: CommercialAuditDashboard["activities"][number]): string {
  return activity.leadName || activity.leadCompany || (activity.leadId ? `Lead ${activity.leadId.slice(0, 8)}` : "Lead não identificado");
}

function routeLabel(activity: CommercialAuditDashboard["activities"][number]): string {
  if (activity.eventType === "movement" || activity.eventType === "reopened") {
    const from = [activity.fromPipelineName, activity.fromStageName].filter(Boolean).join(" / ") || "Origem não registrada";
    const to = [activity.toPipelineName, activity.toStageName].filter(Boolean).join(" / ") || "Destino não registrado";
    return `${from} → ${to}`;
  }
  return [activity.pipelineName, activity.stageName].filter(Boolean).join(" / ") || "-";
}

function eventTone(eventType: string): string {
  if (eventType === "contract_closed") return "commercialAuditEventSuccess";
  if (eventType === "no_interest") return "commercialAuditEventDanger";
  if (eventType === "task_completed") return "commercialAuditEventComplete";
  if (eventType === "movement" || eventType === "handoff") return "commercialAuditEventInfo";
  return "commercialAuditEventNeutral";
}

function AnalyticsView({
  dashboard,
  onStageDrillDown,
}: {
  dashboard: CommercialAuditDashboard;
  onStageDrillDown: (pipelineId: string, stageId: string) => void;
}) {
  const maxStageLeads = Math.max(1, ...dashboard.analytics.byStage.map((row) => row.uniqueLeads));
  const maxPipelineLeads = Math.max(1, ...dashboard.analytics.byPipeline.map((row) => row.uniqueLeads));
  const topTransitions = dashboard.analytics.transitions.slice(0, 15);
  const maxTransitionLeads = Math.max(1, ...topTransitions.map((row) => row.uniqueLeads));
  const maxDaily = Math.max(
    1,
    ...dashboard.analytics.daily.flatMap((row) => [row.leadCreated, row.movements, row.contractsClosed, row.noInterest]),
  );

  return (
    <div className="commercialAuditAnalyticsGrid">
      <section className="panel commercialAuditPanel commercialAuditChartCard commercialAuditChartCardWide">
        <div className="sectionTitleRow">
          <div>
            <h4>Leads movidos para cada etapa</h4>
            <p>Leads únicos que chegaram em cada etapa no período. O número secundário mostra todas as movimentações, inclusive retornos do mesmo lead.</p>
          </div>
          <span className="badge badgeBlue">{dashboard.analytics.byStage.length} etapa(s)</span>
        </div>
        <div className="commercialAuditBarList">
          {dashboard.analytics.byStage.map((row) => {
            const percent = (row.uniqueLeads / maxStageLeads) * 100;
            return (
              <button
                className="commercialAuditBarRow commercialAuditBarRowButton"
                key={`${row.pipelineId}:${row.stageId}:${row.stageName}`}
                type="button"
                onClick={() => onStageDrillDown(row.pipelineId, row.stageId)}
                title="Abrir as movimentações desta etapa"
              >
                <span className="commercialAuditBarLabel">
                  <strong>{row.stageName}</strong>
                  <small>{row.pipelineName}</small>
                </span>
                <span className="commercialAuditBarTrack"><span className="commercialAuditBarFill" style={{ width: `${Math.max(percent, row.uniqueLeads ? 2 : 0)}%` }} /></span>
                <span className="commercialAuditBarValue"><strong>{row.uniqueLeads}</strong><small>{row.movements} mov.</small></span>
              </button>
            );
          })}
          {!dashboard.analytics.byStage.length ? <div className="operationEmptyCompact"><strong>Nenhuma movimentação de etapa encontrada no período.</strong></div> : null}
        </div>
      </section>

      <section className="panel commercialAuditPanel commercialAuditChartCard">
        <div className="sectionTitleRow">
          <div><h4>Movimentações por funil</h4><p>Quantidade de leads únicos que chegaram a etapas de cada funil.</p></div>
        </div>
        <div className="commercialAuditBarList commercialAuditBarListCompact">
          {dashboard.analytics.byPipeline.map((row) => {
            const percent = (row.uniqueLeads / maxPipelineLeads) * 100;
            return (
              <div className="commercialAuditBarRow" key={`${row.pipelineId}:${row.pipelineName}`}>
                <span className="commercialAuditBarLabel"><strong>{row.pipelineName}</strong><small>{row.movements} movimentações</small></span>
                <span className="commercialAuditBarTrack"><span className="commercialAuditBarFill commercialAuditBarFillSecondary" style={{ width: `${Math.max(percent, row.uniqueLeads ? 2 : 0)}%` }} /></span>
                <span className="commercialAuditBarValue"><strong>{row.uniqueLeads}</strong><small>leads</small></span>
              </div>
            );
          })}
          {!dashboard.analytics.byPipeline.length ? <div className="operationEmptyCompact"><strong>Nenhum funil movimentado no período.</strong></div> : null}
        </div>
      </section>

      <section className="panel commercialAuditPanel commercialAuditChartCard">
        <div className="sectionTitleRow">
          <div><h4>Principais transições</h4><p>De qual etapa os leads saíram e para qual etapa foram.</p></div>
          {dashboard.analytics.transitions.length > 15 ? <span className="badge">Top 15</span> : null}
        </div>
        <div className="commercialAuditBarList commercialAuditBarListCompact">
          {topTransitions.map((row) => {
            const percent = (row.uniqueLeads / maxTransitionLeads) * 100;
            return (
              <div className="commercialAuditTransitionRow" key={`${row.fromPipelineId}:${row.fromStageId}>${row.toPipelineId}:${row.toStageId}`}>
                <div className="commercialAuditTransitionRoute">
                  <span><strong>{row.fromStageName}</strong><small>{row.fromPipelineName}</small></span>
                  <b aria-hidden="true">→</b>
                  <span><strong>{row.toStageName}</strong><small>{row.toPipelineName}</small></span>
                </div>
                <div className="commercialAuditTransitionMeasure">
                  <span className="commercialAuditBarTrack"><span className="commercialAuditBarFill commercialAuditBarFillTransition" style={{ width: `${Math.max(percent, row.uniqueLeads ? 2 : 0)}%` }} /></span>
                  <span className="commercialAuditBarValue"><strong>{row.uniqueLeads}</strong><small>{row.movements} mov.</small></span>
                </div>
              </div>
            );
          })}
          {!topTransitions.length ? <div className="operationEmptyCompact"><strong>Nenhuma transição registrada no período.</strong></div> : null}
        </div>
      </section>

      <section className="panel commercialAuditPanel commercialAuditChartCard commercialAuditChartCardWide">
        <div className="sectionTitleRow">
          <div><h4>Evolução diária</h4><p>Entradas de leads, movimentações, contratos fechados e registros de sem interesse ao longo do período.</p></div>
        </div>
        <div className="commercialAuditDailyLegend" aria-hidden="true">
          <span className="dailyLegendLead">Leads recebidos</span>
          <span className="dailyLegendMovement">Movimentações</span>
          <span className="dailyLegendWon">Contratos</span>
          <span className="dailyLegendLost">Sem interesse</span>
        </div>
        <div className="commercialAuditDailyScroll">
          <div className="commercialAuditDailyChart" style={{ minWidth: `${Math.max(560, dashboard.analytics.daily.length * 42)}px` }}>
            {dashboard.analytics.daily.map((row) => (
              <div className="commercialAuditDailyColumn" key={row.date}>
                <div className="commercialAuditDailyBars">
                  <span className="dailyBar dailyBarLead" style={{ height: `${row.leadCreated ? Math.max(4, (row.leadCreated / maxDaily) * 100) : 0}%` }} title={`${row.leadCreated} leads recebidos`} />
                  <span className="dailyBar dailyBarMovement" style={{ height: `${row.movements ? Math.max(4, (row.movements / maxDaily) * 100) : 0}%` }} title={`${row.movements} movimentações`} />
                  <span className="dailyBar dailyBarWon" style={{ height: `${row.contractsClosed ? Math.max(4, (row.contractsClosed / maxDaily) * 100) : 0}%` }} title={`${row.contractsClosed} contratos fechados`} />
                  <span className="dailyBar dailyBarLost" style={{ height: `${row.noInterest ? Math.max(4, (row.noInterest / maxDaily) * 100) : 0}%` }} title={`${row.noInterest} sem interesse`} />
                </div>
                <small>{formatChartDate(row.date)}</small>
              </div>
            ))}
          </div>
        </div>
        {!dashboard.analytics.daily.length ? <div className="operationEmptyCompact"><strong>Nenhuma atividade comercial encontrada no período.</strong></div> : null}
      </section>
    </div>
  );
}

export function CommercialAuditDashboard({ onViewLead }: CommercialAuditDashboardProps) {
  const [dashboard, setDashboard] = useState<CommercialAuditDashboard>(EMPTY_DASHBOARD);
  const [filters, setFilters] = useState<AuditFilters>(() => emptyFilters());
  const [searchDraft, setSearchDraft] = useState("");
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<AuditView>("analytics");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const query: CommercialAuditQuery = {
        from: localDayStartIso(filters.dateFrom) || undefined,
        to: localDayAfterIso(filters.dateTo) || undefined,
        eventType: filters.eventType || undefined,
        actorId: filters.actorId || undefined,
        responsibleUserId: filters.responsibleUserId || undefined,
        source: filters.source || undefined,
        pipelineId: filters.pipelineId || undefined,
        stageId: filters.stageId || undefined,
        search: filters.search || undefined,
        limit: PAGE_SIZE,
        offset,
      };
      setDashboard(await fetchCommercialAuditFromServer(query));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível carregar a auditoria comercial.");
    } finally {
      setIsLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const selectedPipeline = useMemo(
    () => dashboard.filters.pipelines.find((pipeline) => pipeline.id === filters.pipelineId) || null,
    [dashboard.filters.pipelines, filters.pipelineId],
  );

  function updateFilter<K extends keyof AuditFilters>(key: K, value: AuditFilters[K]) {
    setOffset(0);
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === "pipelineId" && value !== current.pipelineId) next.stageId = "";
      return next;
    });
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateFilter("search", searchDraft.trim());
  }

  function clearFilters() {
    const next = emptyFilters();
    setSearchDraft("");
    setOffset(0);
    setFilters(next);
  }

  function drillIntoStage(pipelineId: string, stageId: string) {
    setOffset(0);
    setView("activities");
    setFilters((current) => ({ ...current, eventType: "movement", pipelineId, stageId }));
  }

  function filterByMetric(eventType: string) {
    setView("activities");
    updateFilter("eventType", filters.eventType === eventType ? "" : eventType);
  }

  const metrics = [
    { key: "lead_created", label: "Leads recebidos", value: dashboard.summary.leadCreated, hint: "entraram no CRM" },
    { key: "task_created", label: "Tarefas criadas", value: dashboard.summary.tasksCreated, hint: "manuais e automáticas" },
    { key: "task_completed", label: "Tarefas concluídas", value: dashboard.summary.tasksCompleted, hint: "execuções registradas" },
    { key: "movement", label: "Movimentações", value: dashboard.summary.movements, hint: "trocas de etapa/funil" },
    { key: "contract_closed", label: "Contratos fechados", value: dashboard.summary.contractsClosed, hint: "entrada em Fechado/Ganho" },
    { key: "no_interest", label: "Sem interesse", value: dashboard.summary.noInterest, hint: "perdas com este motivo" },
  ];

  const firstVisible = dashboard.pagination.total ? dashboard.pagination.offset + 1 : 0;
  const lastVisible = Math.min(dashboard.pagination.offset + dashboard.activities.length, dashboard.pagination.total);

  return (
    <section className="commercialAuditWorkspace">
      <div className="commercialAuditHeader">
        <div>
          <span className="eyebrow">Auditoria comercial</span>
          <h3>Trajetória e desempenho do funil</h3>
          <p>Veja os gráficos do fluxo comercial e abra a linha do tempo para auditar cada ação. Os nomes exibidos são sempre os nomes atuais cadastrados no CRM.</p>
        </div>
        <div className="commercialAuditViewToggle" role="tablist" aria-label="Visão da auditoria">
          <button type="button" className={view === "analytics" ? "active" : ""} onClick={() => setView("analytics")}>Análise</button>
          <button type="button" className={view === "activities" ? "active" : ""} onClick={() => setView("activities")}>Atividades</button>
          <button type="button" className={view === "collaborators" ? "active" : ""} onClick={() => setView("collaborators")}>Por colaborador</button>
        </div>
      </div>

      <form className="commercialAuditFilters" onSubmit={applySearch}>
        <label><span>De</span><input type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} /></label>
        <label><span>Até</span><input type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} /></label>
        <label><span>Evento</span><select value={filters.eventType} onChange={(event) => updateFilter("eventType", event.target.value)}><option value="">Todos os eventos</option>{dashboard.filters.eventTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span>Quem executou</span><select value={filters.actorId} onChange={(event) => updateFilter("actorId", event.target.value)}><option value="">Todos</option>{dashboard.filters.users.map((user) => <option key={user.id} value={user.id}>{user.name}{user.isActive ? "" : " (inativo)"}</option>)}</select></label>
        <label><span>Responsável</span><select value={filters.responsibleUserId} onChange={(event) => updateFilter("responsibleUserId", event.target.value)}><option value="">Todos</option>{dashboard.filters.users.map((user) => <option key={user.id} value={user.id}>{user.name}{user.isActive ? "" : " (inativo)"}</option>)}</select></label>
        <label><span>Origem</span><select value={filters.source} onChange={(event) => updateFilter("source", event.target.value)}><option value="">Todas</option>{dashboard.filters.sources.map((source) => <option key={source.name} value={source.name}>{source.name}</option>)}</select></label>
        <label><span>Funil</span><select value={filters.pipelineId} onChange={(event) => updateFilter("pipelineId", event.target.value)}><option value="">Todos os funis</option>{dashboard.filters.pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}{pipeline.isArchived ? " (arquivado)" : ""}</option>)}</select></label>
        <label><span>Etapa</span><select value={filters.stageId} disabled={!selectedPipeline} onChange={(event) => updateFilter("stageId", event.target.value)}><option value="">Todas as etapas</option>{selectedPipeline?.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}{stage.isArchived ? " (arquivada)" : ""}</option>)}</select></label>
        <label className="commercialAuditSearch"><span>Lead ou atividade</span><div><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Nome, empresa, tarefa..." /><button className="secondaryButton" type="submit">Buscar</button></div></label>
        <button className="ghostButton commercialAuditClear" type="button" onClick={clearFilters}>Limpar filtros</button>
      </form>

      {error ? <div className="systemNotice systemNoticeError" role="alert"><strong>Não foi possível carregar:</strong><span>{error}</span></div> : null}
      {isLoading ? <div className="syncBar">Carregando auditoria comercial...</div> : null}
      {dashboard.pagination.sourceTruncated ? <div className="systemNotice systemNoticeAttention"><strong>Período muito amplo</strong><span>A consulta atingiu o limite de segurança. Reduza o período para garantir uma apuração completa.</span></div> : null}

      <div className="commercialAuditMetrics">
        {metrics.map((metric) => (
          <button key={metric.key} type="button" className={filters.eventType === metric.key ? "active" : ""} onClick={() => filterByMetric(metric.key)}>
            <span>{metric.label}</span><strong>{metric.value.toLocaleString("pt-BR")}</strong><small>{metric.hint}</small>
          </button>
        ))}
      </div>

      {view === "analytics" ? <AnalyticsView dashboard={dashboard} onStageDrillDown={drillIntoStage} /> : null}

      {view === "activities" ? (
        <section className="panel commercialAuditPanel">
          <div className="sectionTitleRow">
            <div><h4>Linha do tempo</h4><p>Cada linha representa uma ação comercial auditável. Reordenações dentro da mesma etapa não entram como movimentação.</p></div>
            <span className="badge badgeBlue">{dashboard.pagination.total.toLocaleString("pt-BR")} evento(s)</span>
          </div>
          <div className="commercialAuditTableWrap">
            <table className="commercialAuditTable">
              <thead><tr><th>Quando</th><th>Quem executou</th><th>Lead</th><th>Acontecimento</th><th>Detalhes</th><th>Funil / etapa</th><th>Responsável</th><th /></tr></thead>
              <tbody>
                {dashboard.activities.map((activity) => (
                  <tr key={activity.id}>
                    <td className="commercialAuditWhen">{formatDateTime(activity.occurredAt)}</td>
                    <td><strong>{activity.actorName || "Sistema"}</strong></td>
                    <td><strong>{leadLabel(activity)}</strong>{activity.leadCompany && activity.leadCompany !== activity.leadName ? <small>{activity.leadCompany}</small> : null}{activity.source ? <small>Origem: {activity.source}</small> : null}</td>
                    <td><span className={`commercialAuditEvent ${eventTone(activity.eventType)}`}>{activity.eventLabel}</span></td>
                    <td><strong>{activity.taskTitle || activity.summary || activity.eventLabel}</strong>{activity.details ? <small>{activity.details}</small> : null}</td>
                    <td className="commercialAuditRoute">{routeLabel(activity)}</td>
                    <td>{activity.responsibleName || "Sem responsável"}</td>
                    <td>{activity.leadId ? <button className="tableActionButton primaryTableAction" type="button" onClick={() => onViewLead(activity.leadId)}>Abrir lead</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!dashboard.activities.length && !isLoading ? <div className="operationEmptyCompact"><strong>Nenhum evento encontrado para os filtros selecionados.</strong></div> : null}
          </div>
          <div className="commercialAuditPagination">
            <button className="secondaryButton" type="button" disabled={!offset || isLoading} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>Anterior</button>
            <span>{firstVisible.toLocaleString("pt-BR")} a {lastVisible.toLocaleString("pt-BR")} de {dashboard.pagination.total.toLocaleString("pt-BR")}</span>
            <button className="secondaryButton" type="button" disabled={!dashboard.pagination.hasMore || isLoading} onClick={() => setOffset((current) => current + PAGE_SIZE)}>Próxima</button>
          </div>
        </section>
      ) : null}

      {view === "collaborators" ? (
        <section className="panel commercialAuditPanel">
          <div className="sectionTitleRow"><div><h4>Produção por colaborador</h4><p>Quem executou cada ação. O responsável do lead é mantido separadamente na linha do tempo.</p></div><span className="badge badgeBlue">{dashboard.collaborators.length} colaborador(es)</span></div>
          <div className="commercialAuditTableWrap">
            <table className="commercialAuditTable commercialAuditCollaboratorTable">
              <thead><tr><th>Colaborador</th><th>Leads novos</th><th>Tarefas criadas</th><th>Tarefas concluídas</th><th>Movimentações</th><th>Encaminhamentos</th><th>Contratos</th><th>Sem interesse</th><th>Total</th></tr></thead>
              <tbody>
                {dashboard.collaborators.map((row) => (
                  <tr key={`${row.actorId}:${row.actorName}`}>
                    <td><strong>{row.actorName}</strong></td><td>{row.leadCreated}</td><td>{row.tasksCreated}</td><td>{row.tasksCompleted}</td><td>{row.movements}</td><td>{row.handoffs}</td><td><strong>{row.contractsClosed}</strong></td><td>{row.noInterest}</td><td><strong>{row.total}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!dashboard.collaborators.length && !isLoading ? <div className="operationEmptyCompact"><strong>Nenhuma atividade encontrada no período.</strong></div> : null}
          </div>
        </section>
      ) : null}
    </section>
  );
}
