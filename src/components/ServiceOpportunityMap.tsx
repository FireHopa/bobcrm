import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  getClientIntelligence,
  getLeadWithSyncedAdvertisingFromServices,
  getServiceInterestsFromStatusMap,
  getServiceStatusBadgeClass,
  normalizeServiceStatusMap,
  serviceOptions,
  serviceProviderStatusOptions,
} from "../constants/services";
import type { Lead, ServiceInterest, ServiceProviderStatus } from "../types/Lead";
import { getLeadScores } from "../utils/commercial";
import type { FetchLeadsParams, LeadPagination, OpportunitySummary } from "../utils/api";
import { LeadContactMenu, LeadOverflowMenu } from "./LeadActionMenus";

type ServiceOpportunityMapProps = {
  leads: Lead[];
  totalLeadsCount?: number;
  loadedLeadsCount?: number;
  externalSearch?: string;
  pagination?: LeadPagination;
  opportunitySummary?: OpportunitySummary;
  filteredOpportunitySummary?: OpportunitySummary;
  isLoading?: boolean;
  refreshVersion?: number;
  quickFilter: OpportunityQuickFilter;
  onQuickFilterChange: (filter: OpportunityQuickFilter) => void;
  onQueryChange?: (params: FetchLeadsParams, options?: { append?: boolean }) => Promise<void> | void;
  onUpdateLead: (lead: Lead) => void;
  canUpdateCommercialMap?: boolean;
  onViewLead: (leadId: string) => void;
  onEditLead: (leadId: string) => void;
};

type ViewMode = "commercial" | "matrix" | "operation";
export type OpportunityQuickFilter = "all" | "expansion" | "migration" | "mapping" | "priority" | "agency" | "diagnosis" | "mapping-critical";
type SortMode = "score" | "unknown" | "agency" | "name";

type ServiceSummary = Record<ServiceProviderStatus, number>;

const servicePriority: ServiceInterest[] = [
  "Gerenciamento Google",
  "Gerenciamento Meta",
  "Mentorias AEO",
  "Criação de Website",
  "Projeto Copy - LinkedIn, Perfil de Empresa e Blog no site",
  "Social Media",
  "Mentorias em Google Ads",
  "Mentorias em Meta Ads",
  "Gerenciamento LinkedIn Ads",
  "Mentorias em LinkedIn Ads",
  "Mentorias em Canva",
  "Mentorias em CapCut",
];

const serviceShortName: Record<ServiceInterest, string> = {
  "Criação de Website": "Site",
  "Mentorias em Google Ads": "Google Ads",
  "Mentorias em Meta Ads": "Meta Ads",
  "Mentorias em LinkedIn Ads": "LinkedIn",
  "Mentorias em Canva": "Canva",
  "Mentorias em CapCut": "CapCut",
  "Mentorias AEO": "AEO/IA",
  "Gerenciamento Google": "Gestão Google",
  "Gerenciamento Meta": "Gestão Meta",
  "Gerenciamento LinkedIn Ads": "LinkedIn Ads",
  "Social Media": "Social Media",
  "Projeto Copy - LinkedIn, Perfil de Empresa e Blog no site": "Copy/Perfil",
};

const statusShortLabel: Record<ServiceProviderStatus, string> = {
  "Casa do Ads": "Casa",
  "Outra agência": "Outra agência",
  "Não é feito": "Não faz",
  "Não sabemos": "Desconhecido",
};

function getServiceCounts(lead: Lead, services: ServiceInterest[] = serviceOptions): ServiceSummary {
  const normalizedMap = normalizeServiceStatusMap(lead.serviceStatusMap, lead.serviceInterests || []);
  const counts: ServiceSummary = {
    "Casa do Ads": 0,
    "Outra agência": 0,
    "Não é feito": 0,
    "Não sabemos": 0,
  };

  services.forEach((service) => {
    const status = normalizedMap[service] || "Não sabemos";
    counts[status] += 1;
  });

  return counts;
}

function getCommercialType(lead: Lead, services: ServiceInterest[] = serviceOptions) {
  const counts = getServiceCounts(lead, services);

  if (counts["Casa do Ads"] > 0 && (counts["Outra agência"] > 0 || counts["Não é feito"] > 0 || counts["Não sabemos"] > 0)) {
    return { label: "Expansão", className: "badgeGreen" };
  }
  if (counts["Outra agência"] > 0) return { label: "Migração", className: "badgeYellow" };
  if (counts["Não é feito"] > 0) return { label: "Venda", className: "badgeRed" };
  if (counts["Não sabemos"] > 0) return { label: "Mapear", className: "badgeGray" };
  return { label: "Retenção", className: "badgeBlue" };
}

function getOpportunityScore(lead: Lead, services: ServiceInterest[] = serviceOptions): number {
  const counts = getServiceCounts(lead, services);
  const leadScore = getLeadScores(lead).priority;
  return Math.min(100, Math.round(leadScore * 0.45 + counts["Outra agência"] * 10 + counts["Não é feito"] * 8 + counts["Não sabemos"] * 4 + counts["Casa do Ads"] * 2));
}

function getScoreBadgeClass(score: number) {
  if (score >= 80) return "badgeGreen";
  if (score >= 50) return "badgeYellow";
  return "badgeGray";
}

function getNextBestOffer(lead: Lead, services: ServiceInterest[] = serviceOptions) {
  const normalizedMap = normalizeServiceStatusMap(lead.serviceStatusMap, lead.serviceInterests || []);
  const prioritizedServices = servicePriority.filter((service) => services.includes(service));
  const hasRelationship = getServiceCounts(lead)["Casa do Ads"] > 0;

  const migration = prioritizedServices.find((service) => normalizedMap[service] === "Outra agência");
  if (migration) {
    return {
      label: `Migrar ${serviceShortName[migration]}`,
      reason: `${serviceShortName[migration]} está em outra agência. Boa abertura para auditoria comparativa.`,
    };
  }

  const directSale = prioritizedServices.find((service) => normalizedMap[service] === "Não é feito");
  if (directSale) {
    return {
      label: `${hasRelationship ? "Upsell" : "Oferecer"} ${serviceShortName[directSale]}`,
      reason: `${serviceShortName[directSale]} ainda não é feito. Entrar com diagnóstico e proposta enxuta.`,
    };
  }

  const discovery = prioritizedServices.find((service) => normalizedMap[service] === "Não sabemos");
  if (discovery) {
    return {
      label: `Mapear ${serviceShortName[discovery]}`,
      reason: `Falta classificar ${serviceShortName[discovery]}. Próxima ação é diagnóstico rápido.`,
    };
  }

  return {
    label: "Retenção ou case",
    reason: "Serviços principais estão mapeados. Foco em renovação, resultado e prova social.",
  };
}

function getNextStatus(currentStatus: ServiceProviderStatus): ServiceProviderStatus {
  const currentIndex = serviceProviderStatusOptions.indexOf(currentStatus);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % serviceProviderStatusOptions.length;
  return serviceProviderStatusOptions[nextIndex];
}

function getQuickFilterLabel(filter: OpportunityQuickFilter) {
  if (filter === "expansion") return "Expansão";
  if (filter === "migration") return "Migração";
  if (filter === "mapping") return "Precisa mapear";
  if (filter === "priority") return "Alta prioridade";
  if (filter === "agency") return "Outra agência";
  if (filter === "diagnosis") return "Sem diagnóstico";
  if (filter === "mapping-critical") return "Mapeamento crítico";
  return "Todos";
}

function getLeadSubtitle(lead: Lead): string {
  return [lead.company, lead.responsible ? `Resp. ${lead.responsible}` : "Responsável pendente"].filter(Boolean).join(" • ");
}

export const ServiceOpportunityMap = memo(function ServiceOpportunityMap({ leads, totalLeadsCount = leads.length, loadedLeadsCount = leads.length, externalSearch = "", pagination, opportunitySummary, filteredOpportunitySummary, isLoading = false, refreshVersion = 0, quickFilter, onQuickFilterChange, onQueryChange, onUpdateLead, canUpdateCommercialMap = false, onViewLead, onEditLead }: ServiceOpportunityMapProps) {
  const [search, setSearch] = useState("");
  const [selectedService, setSelectedService] = useState<ServiceInterest | "">("");
  const [selectedStatus, setSelectedStatus] = useState<ServiceProviderStatus | "">("");
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const [viewMode, setViewMode] = useState<ViewMode>("commercial");
  const [editedLeadId, setEditedLeadId] = useState("");
  const [rankingRefreshIndex, setRankingRefreshIndex] = useState(0);
  const [lockedRankingIds, setLockedRankingIds] = useState<string[]>([]);
  const rankingSignatureRef = useRef("");

  const visibleServices = useMemo(() => selectedService ? [selectedService] : serviceOptions, [selectedService]);
  const metricsByLeadId = useMemo(() => new Map(leads.map((lead) => [lead.id, {
    normalizedMap: normalizeServiceStatusMap(lead.serviceStatusMap, lead.serviceInterests || []),
    counts: getServiceCounts(lead, visibleServices),
    type: getCommercialType(lead, visibleServices),
    score: getOpportunityScore(lead, visibleServices),
    nextOffer: getNextBestOffer(lead, visibleServices),
    intelligence: getClientIntelligence(lead),
    leadScores: getLeadScores(lead),
  }])), [leads, visibleServices]);

  useEffect(() => {
    if (!externalSearch) return;
    setSearch(externalSearch);
  }, [externalSearch]);

  useEffect(() => {
    if (!onQueryChange) return;

    const timeoutId = window.setTimeout(() => {
      void onQueryChange({
        search,
        quickFilter,
        includeOpportunitySummary: true,
        offset: 0,
      });
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [onQueryChange, quickFilter, refreshVersion, search]);

  const filteredLeads = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const serverMode = Boolean(onQueryChange);

    return leads.filter((lead) => {
      const metrics = metricsByLeadId.get(lead.id);
      if (!metrics) return false;
      const type = metrics.type.label;

      const matchesQuickFilter = serverMode ||
        quickFilter === "all" ||
        (quickFilter === "expansion" && type === "Expansão") ||
        (quickFilter === "migration" && type === "Migração") ||
        (quickFilter === "mapping" && metrics.counts["Não sabemos"] > 0) ||
        (quickFilter === "priority" && metrics.score >= 70) ||
        (quickFilter === "agency" && metrics.counts["Outra agência"] > 0) ||
        (quickFilter === "diagnosis" && !metrics.intelligence.hasAnyConfirmedInformation) ||
        (quickFilter === "mapping-critical" && metrics.leadScores.mappingUrgency >= 70);

      if (!matchesQuickFilter) return false;
      if (selectedStatus && !visibleServices.some((service) => metrics.normalizedMap[service] === selectedStatus)) return false;
      if (serverMode || !normalizedSearch) return true;

      const searchableContent = [
        lead.name,
        lead.company,
        lead.email,
        lead.phone,
        lead.responsible,
        lead.status,
        lead.temperature,
        lead.pain,
        type,
        metrics.nextOffer.label,
        metrics.nextOffer.reason,
        metrics.intelligence.items.map((item) => `${item.label} ${item.value}`).join(" "),
      ].join(" ").toLowerCase();

      return searchableContent.includes(normalizedSearch);
    });
  }, [leads, metricsByLeadId, onQueryChange, quickFilter, search, selectedStatus, visibleServices]);

  const sortedFilteredLeads = useMemo(() => [...filteredLeads].sort((firstLead, secondLead) => {
    if (sortMode === "name") return (firstLead.name || firstLead.company || "").localeCompare(secondLead.name || secondLead.company || "", "pt-BR");
    const firstMetrics = metricsByLeadId.get(firstLead.id);
    const secondMetrics = metricsByLeadId.get(secondLead.id);
    if (!firstMetrics || !secondMetrics) return 0;
    if (sortMode === "unknown") return secondMetrics.counts["Não sabemos"] - firstMetrics.counts["Não sabemos"];
    if (sortMode === "agency") return secondMetrics.counts["Outra agência"] - firstMetrics.counts["Outra agência"];
    return secondMetrics.score - firstMetrics.score;
  }), [filteredLeads, metricsByLeadId, sortMode]);

  const rankingSignature = useMemo(
    () => JSON.stringify({
      search: search.trim().toLowerCase(),
      selectedService,
      selectedStatus,
      quickFilter,
      sortMode,
      loadedLeadsCount,
      rankingRefreshIndex,
    }),
    [loadedLeadsCount, quickFilter, rankingRefreshIndex, search, selectedService, selectedStatus, sortMode],
  );

  useEffect(() => {
    if (rankingSignatureRef.current === rankingSignature && lockedRankingIds.length) return;

    rankingSignatureRef.current = rankingSignature;
    setLockedRankingIds(sortedFilteredLeads.map((lead) => lead.id));
  }, [lockedRankingIds.length, rankingSignature, sortedFilteredLeads]);

  const rankedLeads = useMemo(() => {
    if (!lockedRankingIds.length) return sortedFilteredLeads;

    const leadById = new Map(sortedFilteredLeads.map((lead) => [lead.id, lead]));
    const orderedLeads = lockedRankingIds
      .map((leadId) => leadById.get(leadId))
      .filter((lead): lead is Lead => Boolean(lead));
    const orderedIds = new Set(orderedLeads.map((lead) => lead.id));
    const newLeads = sortedFilteredLeads.filter((lead) => !orderedIds.has(lead.id));

    return [...orderedLeads, ...newLeads];
  }, [lockedRankingIds, sortedFilteredLeads]);

  const localSummary = useMemo(() => filteredLeads.reduce<ServiceSummary>((summary, lead) => {
    const counts = metricsByLeadId.get(lead.id)?.counts;
    if (!counts) return summary;
    serviceProviderStatusOptions.forEach((status) => {
      summary[status] += counts[status];
    });
    return summary;
  }, {
    "Casa do Ads": 0,
    "Outra agência": 0,
    "Não é feito": 0,
    "Não sabemos": 0,
  }), [filteredLeads, metricsByLeadId]);

  const summary = selectedService
    ? localSummary
    : filteredOpportunitySummary?.serviceStatuses || localSummary;
  const localHighPotentialCount = useMemo(
    () => filteredLeads.reduce((total, lead) => total + ((metricsByLeadId.get(lead.id)?.score || 0) >= 70 ? 1 : 0), 0),
    [filteredLeads, metricsByLeadId],
  );
  const highPotentialCount = selectedService
    ? localHighPotentialCount
    : filteredOpportunitySummary?.priority ?? localHighPotentialCount;
  const quickCounts = useMemo(() => ({
    all: opportunitySummary?.total ?? totalLeadsCount ?? leads.length,
    expansion: opportunitySummary?.expansion ?? 0,
    migration: opportunitySummary?.migration ?? 0,
    mapping: opportunitySummary?.mapping ?? 0,
    priority: opportunitySummary?.priority ?? 0,
    agency: opportunitySummary?.agency ?? 0,
    diagnosis: opportunitySummary?.withoutDiagnosis ?? 0,
    "mapping-critical": opportunitySummary?.mappingCritical ?? 0,
  }), [leads.length, opportunitySummary, totalLeadsCount]);

  const bestOpportunity = useMemo(() => {
    const lead = rankedLeads[0];
    if (!lead) return null;
    const metrics = metricsByLeadId.get(lead.id);
    if (!metrics) return null;
    return {
      lead,
      score: metrics.score,
      offer: metrics.nextOffer,
    };
  }, [metricsByLeadId, rankedLeads]);

  const totalAvailable = pagination?.total ?? totalLeadsCount ?? filteredLeads.length;
  const hasMoreLeads = Boolean(pagination?.hasMore);

  function handleLoadMore() {
    if (!onQueryChange || !pagination) return;

    void onQueryChange({
      search,
      quickFilter,
      includeOpportunitySummary: true,
      offset: leads.length,
      limit: pagination.limit,
    }, { append: true });
  }

  function updateLeadServiceStatus(lead: Lead, service: ServiceInterest, status: ServiceProviderStatus) {
    if (!canUpdateCommercialMap) return;
    const normalizedMap = normalizeServiceStatusMap(lead.serviceStatusMap, lead.serviceInterests || []);
    const updatedServiceStatusMap = {
      ...normalizedMap,
      [service]: status,
    };

    setEditedLeadId(lead.id);

    onUpdateLead(
      getLeadWithSyncedAdvertisingFromServices({
        ...lead,
        serviceStatusMap: updatedServiceStatusMap,
        serviceInterests: getServiceInterestsFromStatusMap(updatedServiceStatusMap),
      }),
    );
  }

  return (
    <section className="panel opportunityPanel opportunityPanelV32 opportunityPanelV34">
      <div className="opportunityCommandBar opportunityCommandBarV32">
        <div>
          <span className="eyebrow">Operação de vendas</span>
          <h2>Mapa comercial</h2>
          <p>Encontre lacunas da carteira, serviços não vendidos e próximas melhores ofertas.</p>
        </div>

        <div className="viewModeSwitch" aria-label="Visualização de oportunidades">
          <button type="button" className={viewMode === "commercial" ? "viewModeActive" : ""} onClick={() => setViewMode("commercial")}>Comercial</button>
          <button type="button" className={viewMode === "matrix" ? "viewModeActive" : ""} onClick={() => setViewMode("matrix")}>Matriz</button>
          <button type="button" className={viewMode === "operation" ? "viewModeActive" : ""} onClick={() => setViewMode("operation")}>Operação</button>
        </div>
      </div>

      <div className="opportunityStatsStrip opportunityStatsStripV32" aria-label="Resumo de oportunidades">
        <span><strong>{filteredLeads.length.toLocaleString("pt-BR")}</strong> exibidos</span>
        <span><strong>{totalAvailable.toLocaleString("pt-BR")}</strong> encontrados no MySQL</span>
        <span className="statPotential"><strong>{highPotentialCount}</strong> alto potencial</span>
        <span className="statAgency"><strong>{summary["Outra agência"]}</strong> outra agência</span>
        <span className="statNotDone"><strong>{summary["Não é feito"]}</strong> serviços não feitos</span>
        <span className="statUnknown"><strong>{summary["Não sabemos"].toLocaleString("pt-BR")}</strong> lacunas de mapeamento</span>
      </div>

      {totalLeadsCount > loadedLeadsCount ? (
        <p className="paginationHint">MySQL ativo: a busca consulta a base completa no servidor. A tela renderiza apenas os resultados carregados para manter o CRM rápido.</p>
      ) : null}

      {bestOpportunity ? (
        <div className="opportunityInsightV34">
          <div>
            <strong>Melhor oportunidade agora:</strong>
            <span>{bestOpportunity.lead.name || bestOpportunity.lead.company || bestOpportunity.lead.phone || "Lead sem nome"} · Potencial {bestOpportunity.score} · {bestOpportunity.offer.label}</span>
          </div>
          <div className="tableActions tableActionsV32 rowActionsV39">
            <LeadContactMenu lead={bestOpportunity.lead} onEditLead={onEditLead} />
            <LeadOverflowMenu lead={bestOpportunity.lead} onViewLead={onViewLead} onEditLead={onEditLead} includeContactChannels={false} />
          </div>
        </div>
      ) : null}

      <div className="opportunityRankLockNoticeV38" role="status">
        <strong>Ranking travado durante o mapeamento.</strong>
        <span>Editar status de serviço atualiza o lead, mas não muda a posição dele na lista. Use Atualizar ranking quando quiser recalcular a ordem.</span>
      </div>

      <div className="quickFiltersRow quickFiltersRowV32 quickFiltersRowV34">
        {(["all", "expansion", "migration", "mapping", "priority", "agency", "diagnosis", "mapping-critical"] as OpportunityQuickFilter[]).map((filter) => (
          <button
            key={filter}
            type="button"
            className={`quickFilterChip ${quickFilter === filter ? "quickFilterChipActive" : ""}`}
            onClick={() => onQuickFilterChange(filter)}
          >
            <span>{getQuickFilterLabel(filter)}</span>
            <strong>{quickCounts[filter]}</strong>
          </button>
        ))}
      </div>

      <div className="opportunityControls opportunityControlsV32 opportunityControlsV33">
        <input
          className="searchInput"
          type="search"
          placeholder="Buscar cliente, empresa, responsável, dor ou próxima oferta..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <details className="advancedFiltersV32 advancedFiltersV33">
          <summary>Filtros avançados</summary>
          <div className="leadToolbarFilters opportunityAdvancedGridV33">
            <label className="compactFilter">
              <span>Serviço</span>
              <select value={selectedService} onChange={(event) => setSelectedService(event.target.value as ServiceInterest | "")}>
                <option value="">Todos os serviços</option>
                {serviceOptions.map((service) => <option key={service} value={service}>{service}</option>)}
              </select>
            </label>

            <label className="compactFilter">
              <span>Status</span>
              <select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as ServiceProviderStatus | "")}>
                <option value="">Todos os status</option>
                {serviceProviderStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>

            <label className="compactFilter">
              <span>Ordenação</span>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="score">Maior potencial</option>
                <option value="unknown">Lacunas primeiro</option>
                <option value="agency">Outra agência primeiro</option>
                <option value="name">Ordem alfabética</option>
              </select>
            </label>
          </div>
        </details>

        <button className="secondaryButton subtleButtonV33" type="button" onClick={() => { setSearch(""); setSelectedService(""); setSelectedStatus(""); onQuickFilterChange("all"); }}>
          Limpar
        </button>

        <button className="secondaryButton subtleButtonV33 rankingRefreshButtonV38" type="button" onClick={() => setRankingRefreshIndex((currentIndex) => currentIndex + 1)}>
          Atualizar ranking
        </button>
      </div>

      {viewMode === "commercial" ? (
        <div className="tableWrap tableWrapV32 tableWrapV34">
          <table className="opportunityCommercialTableV32 opportunityCommercialTableV34">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Potencial</th>
                <th>Tipo</th>
                <th>Próxima melhor oferta</th>
                <th>Motivo</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {rankedLeads.length ? rankedLeads.map((lead) => {
                const metrics = metricsByLeadId.get(lead.id);
                if (!metrics) return null;
                const { score, type, nextOffer: offer } = metrics;
                return (
                  <tr key={lead.id}>
                    <td>
                      <button className="leadIdentityButton" type="button" onClick={() => onViewLead(lead.id)}>
                        <strong className="leadName">{lead.name || lead.phone || "Lead sem nome"}</strong>
                        <span className="leadSub">{getLeadSubtitle(lead)}</span>
                      </button>
                    </td>
                    <td><span className={`badge ${getScoreBadgeClass(score)}`}>{score}</span></td>
                    <td><span className={`badge ${type.className}`}>{type.label}</span></td>
                    <td><strong>{offer.label}</strong></td>
                    <td><p className="tableParagraph">{offer.reason}</p></td>
                    <td>
                      <div className="tableActions tableActionsV32 rowActionsV33 rowActionsV39">
                        <LeadContactMenu lead={lead} onEditLead={onEditLead} />
                        <LeadOverflowMenu lead={lead} onViewLead={onViewLead} onEditLead={onEditLead} includeContactChannels={false} />
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td className="emptyState emptyStateV32" colSpan={6}>Nenhuma oportunidade encontrada para os filtros selecionados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : viewMode === "matrix" ? (
        <div className="opportunityTableWrap opportunityMatrixWrapV32">
          <table className="opportunityTable opportunityMatrixTableV32" style={{ minWidth: `${320 + visibleServices.length * 112 + 120}px` }}>
            <thead>
              <tr>
                <th className="stickyLeadColumn">Cliente</th>
                <th>Tipo</th>
                <th>Oferta</th>
                {visibleServices.map((service) => <th className="serviceColumnHeader" key={service} title={service}>{serviceShortName[service]}</th>)}
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {rankedLeads.length ? rankedLeads.map((lead) => {
                const metrics = metricsByLeadId.get(lead.id);
                if (!metrics) return null;
                const { normalizedMap, type, nextOffer: offer } = metrics;
                return (
                  <tr key={lead.id} className={editedLeadId === lead.id ? "opportunityRowLastEdited" : undefined}>
                    <td className="stickyLeadColumn leadMapIdentityCell">
                      <button className="leadIdentityButton" type="button" onClick={() => onViewLead(lead.id)}>
                        <strong className="leadName">{lead.name || lead.phone || "Lead sem nome"}</strong>
                        <span className="leadSub">{getLeadSubtitle(lead)}</span>
                      </button>
                    </td>
                    <td><span className={`badge ${type.className}`}>{type.label}</span></td>
                    <td><span className="nextOfferText" title={offer.reason}>{offer.label}</span></td>
                    {visibleServices.map((service) => {
                      const status = normalizedMap[service] || "Não sabemos";
                      const nextStatus = getNextStatus(status);
                      return (
                        <td className="opportunityCell" key={service}>
                          {canUpdateCommercialMap ? (
                            <button
                              className={`serviceStatusChip ${getServiceStatusBadgeClass(status)}`}
                              type="button"
                              title={`${service}: ${status}. Clique para mudar para ${nextStatus}.`}
                              onClick={() => updateLeadServiceStatus(lead, service, nextStatus)}
                            >
                              {statusShortLabel[status]}
                            </button>
                          ) : (
                            <span
                              className={`serviceStatusChip ${getServiceStatusBadgeClass(status)}`}
                              title={`${service}: ${status}. Somente pré-venda e administração podem alterar o mapa comercial.`}
                            >
                              {statusShortLabel[status]}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td>
                      <div className="tableActions tableActionsV32 rowActionsV39">
                        <button className="tableActionButton primaryTableAction" type="button" onClick={() => onViewLead(lead.id)}>Abrir lead</button>
                        <LeadOverflowMenu lead={lead} onViewLead={onViewLead} onEditLead={onEditLead} includeOpen={false} includeContactChannels />
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td className="emptyState emptyStateV32" colSpan={visibleServices.length + 4}>Nenhum cliente encontrado para os filtros selecionados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="opportunityOperationBoardV38">
          {rankedLeads.length ? rankedLeads.slice(0, 24).map((lead, index) => {
            const metrics = metricsByLeadId.get(lead.id);
            if (!metrics) return null;
            const { score, type, nextOffer: offer, counts } = metrics;

            return (
              <article className={editedLeadId === lead.id ? "opportunityOperationCardV38 opportunityOperationCardEditedV38" : "opportunityOperationCardV38"} key={lead.id}>
                <div className="opportunityOperationRankV38">{index + 1}</div>
                <div className="opportunityOperationMainV38">
                  <button className="leadIdentityButton" type="button" onClick={() => onViewLead(lead.id)}>
                    <strong className="leadName">{lead.name || lead.phone || "Lead sem nome"}</strong>
                    <span className="leadSub">{getLeadSubtitle(lead)}</span>
                  </button>
                  <div className="opportunityOperationMetaV38">
                    <span className={`badge ${getScoreBadgeClass(score)}`}>Potencial {score}</span>
                    <span className={`badge ${type.className}`}>{type.label}</span>
                    <span className="badge badgeGray">Casa {counts["Casa do Ads"]}</span>
                    <span className="badge badgeYellow">Outra {counts["Outra agência"]}</span>
                    <span className="badge badgeBlue">Lacunas {counts["Não sabemos"]}</span>
                  </div>
                </div>
                <div className="opportunityOperationOfferV38">
                  <strong>{offer.label}</strong>
                  <p>{offer.reason}</p>
                </div>
                <div className="tableActions tableActionsV32 opportunityOperationActionsV38 rowActionsV39">
                  <LeadContactMenu lead={lead} onEditLead={onEditLead} />
                  <LeadOverflowMenu lead={lead} onViewLead={onViewLead} onEditLead={onEditLead} includeContactChannels={false} />
                </div>
              </article>
            );
          }) : (
            <div className="emptyState emptyStateV32">Nenhuma oportunidade encontrada para os filtros selecionados.</div>
          )}
        </div>
      )}

      <div className="previewFooter loadMoreFooterV35">
        <span>Busca no MySQL: exibindo {filteredLeads.length.toLocaleString("pt-BR")} resultado(s) carregado(s) de {totalAvailable.toLocaleString("pt-BR")} encontrado(s) na base completa.</span>
        {hasMoreLeads ? (
          <button className="secondaryButton" type="button" onClick={handleLoadMore} disabled={isLoading}>
            {isLoading ? "Carregando..." : `Carregar mais ${pagination?.limit || 150}`}
          </button>
        ) : null}
      </div>
    </section>
  );
});
