import { useCallback, useEffect, useMemo, useState } from "react";
import type { CRMUser } from "../types/Lead";
import {
  fetchHandoffDashboardFromServer,
  type HandoffDashboard,
  type HandoffEntry,
} from "../utils/api";

type HandoffActivityDashboardProps = {
  mode: "admin" | "sdr";
  currentUser: CRMUser;
  onViewLead: (leadId: string) => void;
};

const EMPTY_DASHBOARD: HandoffDashboard = {
  scope: "own",
  rangeDays: 30,
  summary: { total: 0, uniqueLeads: 0, destinations: 0, averagePerDay: 0 },
  byActor: [],
  byTarget: [],
  daily: [],
  availableActors: [],
  handoffs: [],
  pagination: { total: 0, limit: 80, offset: 0, hasMore: false },
  generatedAt: "",
};

function formatDateTime(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatShortDate(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function leadLabel(entry: HandoffEntry): string {
  return entry.leadName || entry.leadCompany || `Lead ${entry.leadId.slice(0, 8)}`;
}

export function HandoffActivityDashboard({ mode, currentUser, onViewLead }: HandoffActivityDashboardProps) {
  const [dashboard, setDashboard] = useState<HandoffDashboard>(EMPTY_DASHBOARD);
  const [rangeDays, setRangeDays] = useState(30);
  const [actorUserId, setActorUserId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async (append = false) => {
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError("");
    try {
      const result = await fetchHandoffDashboardFromServer({
        rangeDays,
        actorUserId: mode === "admin" ? actorUserId : undefined,
        limit: 80,
        offset: append ? dashboard.handoffs.length : 0,
      });
      setDashboard((current) => append ? {
        ...result,
        handoffs: [...current.handoffs, ...result.handoffs],
      } : result);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível carregar os encaminhamentos.");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [rangeDays, actorUserId, mode, dashboard.handoffs.length]);

  useEffect(() => {
    void loadDashboard(false);
    // O tamanho do histórico não deve provocar nova consulta automática.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeDays, actorUserId, mode]);

  const maxActorTotal = useMemo(() => Math.max(1, ...dashboard.byActor.map((item) => item.total)), [dashboard.byActor]);
  const maxTargetTotal = useMemo(() => Math.max(1, ...dashboard.byTarget.map((item) => item.total)), [dashboard.byTarget]);
  const maxDailyTotal = useMemo(() => Math.max(1, ...dashboard.daily.map((item) => item.total)), [dashboard.daily]);

  return (
    <section className={`handoffAuditWorkspaceV45 ${mode === "admin" ? "handoffAuditAdminV45" : "handoffAuditSdrV45"}`}>
      <div className="handoffAuditToolbarV45">
        <div>
          <span className="eyebrow">{mode === "admin" ? "Auditoria de distribuição" : "Minha distribuição"}</span>
          <h3>{mode === "admin" ? "Encaminhamentos por SDR" : "Meus encaminhamentos"}</h3>
          <p>
            {mode === "admin"
              ? "Acompanhe quem movimentou cada lead, para qual vendedor e em que momento."
              : `Acompanhe os leads que você encaminhou e como sua distribuição está evoluindo, ${currentUser.name || ""}.`}
          </p>
        </div>
        <div className="handoffAuditFiltersV45">
          <label>
            <span>Período</span>
            <select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}>
              <option value={7}>7 dias</option>
              <option value={30}>30 dias</option>
              <option value={90}>90 dias</option>
              <option value={180}>180 dias</option>
              <option value={365}>365 dias</option>
            </select>
          </label>
          {mode === "admin" ? (
            <label>
              <span>Encaminhado por</span>
              <select value={actorUserId} onChange={(event) => setActorUserId(event.target.value)}>
                <option value="">Todos</option>
                {dashboard.availableActors.map((actor) => (
                  <option key={actor.userId || actor.name} value={actor.userId}>{actor.name || "Usuário sem nome"}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button className="secondaryButton" type="button" onClick={() => void loadDashboard(false)} disabled={isLoading}>Atualizar</button>
        </div>
      </div>

      {error ? <div className="systemNotice systemNoticeError" role="alert"><strong>Não foi possível carregar:</strong><span>{error}</span></div> : null}
      {isLoading ? <div className="syncBar">Carregando histórico de encaminhamentos...</div> : null}

      <div className="handoffAuditSummaryV45">
        <article><span>Encaminhamentos</span><strong>{dashboard.summary.total}</strong><small>no período</small></article>
        <article><span>Leads distintos</span><strong>{dashboard.summary.uniqueLeads}</strong><small>movimentados</small></article>
        <article><span>Vendedores destino</span><strong>{dashboard.summary.destinations}</strong><small>receberam leads</small></article>
        <article><span>Média diária</span><strong>{dashboard.summary.averagePerDay}</strong><small>encaminhamentos/dia</small></article>
      </div>

      {mode === "admin" ? (
        <div className="handoffAuditChartsGridV45">
          <section className="panel handoffAuditChartCardV45">
            <div className="sectionTitleRow"><div><h4>Movimentações por SDR</h4><p>Volume individual de encaminhamentos.</p></div></div>
            <div className="handoffMetricBarsV45">
              {dashboard.byActor.length ? dashboard.byActor.map((actor) => (
                <div className="handoffMetricRowV45" key={actor.userId || actor.name}>
                  <div><strong>{actor.name || "Usuário sem nome"}</strong><span>{actor.uniqueLeads} lead(s) • {actor.destinations} destino(s)</span></div>
                  <div className="handoffMetricBarTrackV45"><span style={{ width: `${Math.max(4, (actor.total / maxActorTotal) * 100)}%` }} /></div>
                  <b>{actor.total}</b>
                </div>
              )) : <p className="mutedText">Nenhum encaminhamento no período.</p>}
            </div>
          </section>

          <section className="panel handoffAuditChartCardV45">
            <div className="sectionTitleRow"><div><h4>Destino dos leads</h4><p>Quem está recebendo mais encaminhamentos.</p></div></div>
            <div className="handoffMetricBarsV45">
              {dashboard.byTarget.length ? dashboard.byTarget.slice(0, 12).map((target) => (
                <div className="handoffMetricRowV45" key={target.userId || target.name}>
                  <div><strong>{target.name || "Vendedor sem nome"}</strong><span>{target.uniqueLeads} lead(s) distinto(s)</span></div>
                  <div className="handoffMetricBarTrackV45"><span style={{ width: `${Math.max(4, (target.total / maxTargetTotal) * 100)}%` }} /></div>
                  <b>{target.total}</b>
                </div>
              )) : <p className="mutedText">Nenhum destino registrado.</p>}
            </div>
          </section>
        </div>
      ) : null}

      <section className="panel handoffAuditChartCardV45">
        <div className="sectionTitleRow">
          <div><h4>{mode === "admin" ? "Ritmo de encaminhamentos" : "Meu ritmo de encaminhamentos"}</h4><p>Distribuição diária dentro do período selecionado.</p></div>
        </div>
        <div className="handoffDailyChartV45" aria-label="Gráfico diário de encaminhamentos">
          {dashboard.daily.length ? dashboard.daily.map((day) => (
            <div className="handoffDailyBarV45" key={day.date} title={`${formatShortDate(day.date)}: ${day.total}`}>
              <div><span style={{ height: `${Math.max(8, (day.total / maxDailyTotal) * 100)}%` }} /></div>
              <strong>{day.total}</strong>
              <small>{formatShortDate(day.date)}</small>
            </div>
          )) : <p className="mutedText">Nenhum encaminhamento no período selecionado.</p>}
        </div>
      </section>

      {mode === "sdr" ? (
        <section className="panel handoffAuditChartCardV45">
          <div className="sectionTitleRow"><div><h4>Para quem estou encaminhando</h4><p>Distribuição simples entre os vendedores que receberam seus leads.</p></div></div>
          <div className="handoffMetricBarsV45">
            {dashboard.byTarget.length ? dashboard.byTarget.slice(0, 10).map((target) => (
              <div className="handoffMetricRowV45" key={target.userId || target.name}>
                <div><strong>{target.name || "Vendedor sem nome"}</strong><span>{target.uniqueLeads} lead(s)</span></div>
                <div className="handoffMetricBarTrackV45"><span style={{ width: `${Math.max(4, (target.total / maxTargetTotal) * 100)}%` }} /></div>
                <b>{target.total}</b>
              </div>
            )) : <p className="mutedText">Você ainda não encaminhou leads neste período.</p>}
          </div>
        </section>
      ) : null}

      <section className="panel handoffAuditHistoryV45">
        <div className="sectionTitleRow">
          <div><h4>Histórico de movimentações</h4><p>{mode === "admin" ? "Registro auditável de cada encaminhamento." : "Somente movimentações feitas por você."}</p></div>
          <span className="badge badgeBlue">{dashboard.pagination.total} registro(s)</span>
        </div>
        <div className="handoffAuditTableWrapV45">
          <table className="handoffAuditTableV45">
            <thead><tr><th>Data</th><th>Lead</th>{mode === "admin" ? <th>Encaminhado por</th> : null}<th>Para</th><th>Destino no funil</th><th /></tr></thead>
            <tbody>
              {dashboard.handoffs.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.createdAt)}</td>
                  <td><strong>{leadLabel(entry)}</strong>{entry.leadCompany && entry.leadCompany !== entry.leadName ? <small>{entry.leadCompany}</small> : null}</td>
                  {mode === "admin" ? <td><strong>{entry.actorName || "Usuário"}</strong>{entry.fromUserName ? <small>antes: {entry.fromUserName}</small> : <small>lead sem vendedor anterior</small>}</td> : null}
                  <td><strong>{entry.toUserName || "Vendedor"}</strong></td>
                  <td><strong>{entry.pipelineName || "Funil"}</strong><small>{entry.stageName || "Etapa não registrada"}</small></td>
                  <td><button className="secondaryButton" type="button" onClick={() => onViewLead(entry.leadId)}>Abrir lead</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!dashboard.handoffs.length && !isLoading ? <div className="operationEmptyCompact"><strong>Nenhum encaminhamento encontrado.</strong></div> : null}
        </div>
        {dashboard.pagination.hasMore ? (
          <div className="previewFooter loadMoreFooterV35">
            <span>Exibindo {dashboard.handoffs.length} de {dashboard.pagination.total} movimentações.</span>
            <button className="secondaryButton" type="button" onClick={() => void loadDashboard(true)} disabled={isLoadingMore}>{isLoadingMore ? "Carregando..." : "Carregar mais"}</button>
          </div>
        ) : null}
      </section>
    </section>
  );
}
