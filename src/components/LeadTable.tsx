import { lazy, memo, Suspense, useEffect, useMemo, useState } from "react";
import { getClientIntelligence } from "../constants/services";
import type { Lead, LeadStatus, LeadTemperature } from "../types/Lead";
import type { FetchLeadsParams, LeadPagination, LeadSummary } from "../utils/api";
import { getLeadScores, getRecommendedCommercialPlan, isActiveLead } from "../utils/commercial";
import { formatDate, formatPhone, isPastDate, isToday } from "../utils/formatters";
import { createLeadMenuIcon, LeadOverflowMenu } from "./LeadActionMenus";

const KanbanBoard = lazy(() => import("./KanbanBoard").then((module) => ({ default: module.KanbanBoard })));

type LeadTableProps = {
  leads: Lead[];
  externalSearch?: string;
  pagination?: LeadPagination;
  summary?: LeadSummary;
  ownerOptions?: { name: string; total: number }[];
  isLoading?: boolean;
  onQueryChange?: (params: FetchLeadsParams, options?: { append?: boolean }) => Promise<void> | void;
  onViewLead: (leadId: string) => void;
  onEditLead: (leadId: string) => void;
  onDeleteLead: (leadId: string) => void;
  onHandoffLead?: (lead: Lead) => void;
  canEditLeads?: boolean;
  canDeleteLeads?: boolean;
  canHandoffLeads?: boolean;
  canMoveKanbanCards?: boolean;
  canAddKanbanCards?: boolean;
  canManageKanban?: boolean;
  onKanbanLeadUpdated?: (lead: Lead) => void;
  kanbanRefreshVersion?: number;
  requestedQuickFilter?: QuickFilter;
  requestedQuickFilterKey?: number;
  onRequestedQuickFilterApplied?: () => void;
};

type QuickFilter = "all" | "owner" | "next" | "priority" | "agency" | "mapping" | "expansion";
type ViewMode = "compact" | "complete" | "kanban";

const MAX_RENDERED_LEADS = 150;

const statusOptions: LeadStatus[] = [
  "Novo lead",
  "Contato feito",
  "Sem resposta",
  "Reunião marcada",
  "Diagnóstico realizado",
  "Proposta enviada",
  "Em negociação",
  "Fechado",
  "Perdido",
];

function getStatusBadgeClass(status: LeadStatus) {
  if (status === "Perdido") return "badgeRed";
  if (status === "Fechado") return "badgeGreen";
  if (status === "Proposta enviada" || status === "Em negociação") return "badgeYellow";
  if (status === "Sem resposta") return "badgeGray";
  return "badgeBlue";
}

function getTemperatureBadgeClass(temperature: LeadTemperature) {
  if (temperature === "Quente") return "badgeRed";
  if (temperature === "Morno") return "badgeYellow";
  if (temperature === "Frio") return "badgeBlue";
  return "badgeGray";
}

function getNextStepBadgeClass(date: string) {
  if (!date) return "badgeGray";
  if (isPastDate(date)) return "badgeRed";
  if (isToday(date)) return "badgeYellow";
  return "badgeBlue";
}

function getPriorityClass(value: number) {
  if (value >= 70) return "badgeRed";
  if (value >= 45) return "badgeYellow";
  return "badgeBlue";
}

function getQuickFilterLabel(filter: QuickFilter) {
  if (filter === "owner") return "Sem responsável";
  if (filter === "next") return "Sem próximo passo";
  if (filter === "priority") return "Alta prioridade";
  if (filter === "agency") return "Outra agência";
  if (filter === "mapping") return "Precisa mapear";
  if (filter === "expansion") return "Expansão Casa";
  return "Todos";
}

function getServerQuickFilter(filter: QuickFilter): string {
  if (filter === "priority") return "lead-priority";
  if (filter === "mapping") return "lead-mapping";
  if (filter === "expansion") return "lead-expansion";
  return filter;
}

function getMissingFields(lead: Lead): string[] {
  const missing: string[] = [];
  if (!lead.responsible.trim()) missing.push("responsável");
  if (!lead.temperature.trim()) missing.push("temperatura");
  if (!lead.source.trim()) missing.push("origem");
  if (!lead.pain.trim()) missing.push("dor");
  if (!lead.nextContactAt.trim()) missing.push("próximo passo");
  return missing;
}

type LeadActionProps = {
  lead: Lead;
  onViewLead: (leadId: string) => void;
  onEditLead: (leadId: string) => void;
  onDeleteLead: (leadId: string) => void;
  onHandoffLead?: (lead: Lead) => void;
  canEditLeads?: boolean;
  canDeleteLeads?: boolean;
  canHandoffLeads?: boolean;
};

function LeadActions({
  lead,
  onViewLead,
  onEditLead,
  onDeleteLead,
  onHandoffLead,
  canEditLeads = false,
  canDeleteLeads = false,
  canHandoffLeads = false,
}: LeadActionProps) {
  const canHandoff = canHandoffLeads && Boolean(onHandoffLead);
  const isUnassigned = !lead.responsibleUserId && !lead.responsible.trim();
  const handoffLabel = isUnassigned ? "Encaminhar para consultor" : "Trocar consultor ou funil";

  return (
    <div className="tableActions tableActionsV32 rowActionsV33 rowActionsV39">
      {canHandoff && isUnassigned ? (
        <button
          className="tableActionButton primaryTableAction handoffTableActionV44"
          type="button"
          data-handoff-lead-id={lead.id}
          onClick={() => onHandoffLead?.(lead)}
        >
          Encaminhar
        </button>
      ) : (
        <button className="tableActionButton primaryTableAction" type="button" onClick={() => onViewLead(lead.id)}>
          Abrir lead
        </button>
      )}
      <LeadOverflowMenu
        lead={lead}
        onViewLead={onViewLead}
        onEditLead={canEditLeads ? onEditLead : undefined}
        onDeleteLead={canDeleteLeads ? onDeleteLead : undefined}
        includeOpen={canHandoff && isUnassigned}
        includeContactChannels
        extraItems={canHandoff ? [{
          id: "handoff",
          label: handoffLabel,
          description: isUnassigned
            ? "Definir consultor, funil, etapa e primeira tarefa"
            : "Transferir a carteira e reorganizar o próximo passo",
          icon: createLeadMenuIcon("handoff"),
          separatorBefore: true,
          onSelect: () => onHandoffLead?.(lead),
        }] : []}
      />
    </div>
  );
}

function LeadIdentity({ lead, onViewLead }: { lead: Lead; onViewLead: (leadId: string) => void }) {
  return (
    <button className="leadIdentityButton" type="button" onClick={() => onViewLead(lead.id)}>
      <strong className="leadName">{lead.name || lead.phone || "Lead sem nome"}</strong>
      <span className="leadSub">{lead.company || lead.email || lead.phone || "Empresa pendente"}</span>
    </button>
  );
}


type LeadTableRowProps = {
  lead: Lead;
  viewMode: Exclude<ViewMode, "kanban">;
  onViewLead: (leadId: string) => void;
  onEditLead: (leadId: string) => void;
  onDeleteLead: (leadId: string) => void;
  onHandoffLead?: (lead: Lead) => void;
  canEditLeads: boolean;
  canDeleteLeads: boolean;
  canHandoffLeads: boolean;
};

const LeadTableRow = memo(function LeadTableRow({
  lead,
  viewMode,
  onViewLead,
  onEditLead,
  onDeleteLead,
  onHandoffLead,
  canEditLeads,
  canDeleteLeads,
  canHandoffLeads,
}: LeadTableRowProps) {
  const status = lead.status || (lead.isLost ? "Perdido" : "Novo lead");
  const scores = getLeadScores(lead);
  const plan = getRecommendedCommercialPlan(lead);
  const missingFields = getMissingFields(lead);
  const isLost = lead.isLost || status === "Perdido";

  return (
    <tr className={isLost ? "lostLeadRow" : undefined}>
      <td className="leadCellV32">
        <LeadIdentity lead={lead} onViewLead={onViewLead} />
        {viewMode === "complete" ? (
          <div className="leadMiniMeta">
            <span>{formatPhone(lead.phone) || "Telefone pendente"}</span>
            <span>{lead.email || "E-mail pendente"}</span>
          </div>
        ) : null}
      </td>

      <td>{lead.company || "Empresa pendente"}</td>

      <td>
        <div className="badgeGroup">
          <span className={`badge ${getStatusBadgeClass(status)}`}>{status}</span>
          <span className={`badge ${getTemperatureBadgeClass(lead.temperature)}`}>{lead.temperature || "Temperatura pendente"}</span>
        </div>
      </td>

      <td>
        <span className={`badge ${getPriorityClass(scores.priority)}`} title={scores.reasons.length ? scores.reasons.join(", ") : "Score por potencial, urgência e lacunas."}>
          {scores.priority}
        </span>
      </td>

      <td className="nextActionCellV32 nextActionCellV33">
        <strong className={getNextStepBadgeClass(lead.nextContactAt)}>
          {lead.nextContactAt ? formatDate(lead.nextContactAt) : "Sem próximo passo definido"}
        </strong>
        <p title={plan.nextAction}>{plan.offer || plan.nextAction}</p>
      </td>

      <td>{lead.responsible || "Pendente"}</td>

      {viewMode === "complete" ? (
        <td>
          <span className={`badge ${missingFields.length >= 4 ? "badgeRed" : missingFields.length >= 2 ? "badgeYellow" : "badgeGreen"}`}>
            {missingFields.length ? `Faltam ${missingFields.length}` : "Boa"}
          </span>
          <p className="microText">{missingFields.length ? missingFields.join(", ") : "Cadastro operacional"}</p>
        </td>
      ) : null}

      <td>{formatDate(lead.lastContactAt || lead.contactMadeAt || lead.updatedAt || lead.createdAt)}</td>

      <td>
        <LeadActions
          lead={lead}
          onViewLead={onViewLead}
          onEditLead={onEditLead}
          onDeleteLead={onDeleteLead}
          onHandoffLead={onHandoffLead}
          canEditLeads={canEditLeads}
          canDeleteLeads={canDeleteLeads}
          canHandoffLeads={canHandoffLeads}
        />
      </td>
    </tr>
  );
});

export const LeadTable = memo(function LeadTable({
  leads,
  externalSearch = "",
  pagination,
  summary,
  ownerOptions: serverOwnerOptions = [],
  isLoading = false,
  onQueryChange,
  onViewLead,
  onEditLead,
  onDeleteLead,
  onHandoffLead,
  canEditLeads = false,
  canDeleteLeads = false,
  canHandoffLeads = false,
  canMoveKanbanCards = false,
  canAddKanbanCards = false,
  canManageKanban = false,
  onKanbanLeadUpdated,
  kanbanRefreshVersion = 0,
  requestedQuickFilter,
  requestedQuickFilterKey = 0,
  onRequestedQuickFilterApplied,
}: LeadTableProps) {
  const [search, setSearch] = useState(externalSearch);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "">("");
  const [temperatureFilter, setTemperatureFilter] = useState<LeadTemperature | "">("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(requestedQuickFilter || "all");
  const [sortBy, setSortBy] = useState<NonNullable<FetchLeadsParams["sortBy"]>>("updatedAt");
  const [sortDirection, setSortDirection] = useState<NonNullable<FetchLeadsParams["sortDirection"]>>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem("crmCasaAdsLeadViewMode");
    return stored === "complete" || stored === "kanban" ? stored : "compact";
  });
  const [kanbanFilters, setKanbanFilters] = useState(() => ({
    search: externalSearch,
    status: "" as LeadStatus | "",
    temperature: "" as LeadTemperature | "",
    responsible: "",
    quickFilter: requestedQuickFilter || "all",
  }));

  useEffect(() => {
    setSearch(externalSearch);
  }, [externalSearch]);

  useEffect(() => {
    if (!requestedQuickFilter) return;
    setQuickFilter(requestedQuickFilter);
    setViewMode("compact");
    onRequestedQuickFilterApplied?.();
  }, [onRequestedQuickFilterApplied, requestedQuickFilter, requestedQuickFilterKey]);

  useEffect(() => {
    if (!onQueryChange || viewMode === "kanban") return;

    const timeoutId = window.setTimeout(() => {
      void onQueryChange({
        search,
        status: statusFilter,
        temperature: temperatureFilter,
        responsible: ownerFilter,
        quickFilter: getServerQuickFilter(quickFilter),
        sortBy,
        sortDirection,
        offset: 0,
        cursor: "",
      });
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [onQueryChange, ownerFilter, quickFilter, search, sortBy, sortDirection, statusFilter, temperatureFilter, viewMode]);

  useEffect(() => {
    if (viewMode !== "kanban") return;

    const timeoutId = window.setTimeout(() => {
      setKanbanFilters({
        search,
        status: statusFilter,
        temperature: temperatureFilter,
        responsible: ownerFilter,
        quickFilter,
      });
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [ownerFilter, quickFilter, search, statusFilter, temperatureFilter, viewMode]);

  const ownerOptions = useMemo(() => {
    if (serverOwnerOptions.length) return serverOwnerOptions.map((owner) => owner.name);
    return Array.from(new Set(leads.map((lead) => lead.responsible.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [leads, serverOwnerOptions]);

  const serverMode = Boolean(onQueryChange);
  const quickCounts = useMemo(() => ({
    all: summary?.total ?? pagination?.total ?? leads.length,
    owner: summary?.withoutOwner ?? leads.filter((lead) => isActiveLead(lead) && !lead.responsible.trim() && !lead.responsibleUserId.trim()).length,
    next: summary?.withoutNextStep ?? leads.filter((lead) => isActiveLead(lead) && !lead.nextContactAt.trim()).length,
    priority: summary?.highPriority ?? leads.filter((lead) => isActiveLead(lead) && getLeadScores(lead).priority >= 70).length,
    agency: summary?.agencyOpportunities ?? leads.filter((lead) => getClientIntelligence(lead).externalAgencyServicesCount > 0).length,
    mapping: summary?.needsMapping ?? leads.filter((lead) => getLeadScores(lead).mappingUrgency >= 55).length,
    expansion: summary?.expansionOpportunities ?? leads.filter((lead) => getClientIntelligence(lead).casaServicesCount > 0 && getClientIntelligence(lead).unknownServicesCount + getClientIntelligence(lead).notDoneServicesCount > 0).length,
  }), [leads, pagination?.total, summary, serverMode]);

  const filteredLeads = useMemo(() => {
    if (serverMode) return leads;

    const normalizedSearch = search.trim().toLowerCase();

    return leads
      .filter((lead) => {
        const intelligence = getClientIntelligence(lead);
        const scores = getLeadScores(lead);
        const matchesQuickFilter =
          quickFilter === "all" ||
          (quickFilter === "owner" && isActiveLead(lead) && !lead.responsible.trim() && !lead.responsibleUserId.trim()) ||
          (quickFilter === "next" && isActiveLead(lead) && !lead.nextContactAt.trim()) ||
          (quickFilter === "priority" && isActiveLead(lead) && scores.priority >= 70) ||
          (quickFilter === "agency" && intelligence.externalAgencyServicesCount > 0) ||
          (quickFilter === "mapping" && scores.mappingUrgency >= 55) ||
          (quickFilter === "expansion" && intelligence.casaServicesCount > 0 && intelligence.unknownServicesCount + intelligence.notDoneServicesCount > 0);

        if (!matchesQuickFilter) return false;
        if (statusFilter && lead.status !== statusFilter) return false;
        if (temperatureFilter && lead.temperature !== temperatureFilter) return false;
        if (ownerFilter && lead.responsible !== ownerFilter) return false;

        if (!normalizedSearch) return true;

        const searchableContent = [
          lead.name,
          lead.email,
          lead.phone,
          lead.company,
          lead.website,
          lead.source,
          lead.estimatedBudget,
          lead.status,
          lead.responsible,
          lead.temperature,
          lead.pain,
          lead.lostReason,
          lead.commercialNotes,
          Object.values(lead.customFields || {}).join(" "),
          intelligence.items.map((item) => `${item.label} ${item.value}`).join(" "),
        ].join(" ").toLowerCase();

        return searchableContent.includes(normalizedSearch);
      })
      .sort((a, b) => {
        const priorityDifference = getLeadScores(b).priority - getLeadScores(a).priority;
        if (priorityDifference !== 0) return priorityDifference;
        return (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "");
      });
  }, [leads, ownerFilter, quickFilter, search, serverMode, statusFilter, temperatureFilter]);

  const displayedLeads = useMemo(() => filteredLeads.slice(0, MAX_RENDERED_LEADS), [filteredLeads]);

  const totalAvailable = pagination?.total ?? filteredLeads.length;
  const hasMoreLeads = Boolean(pagination?.hasMore);

  function handleLoadMore() {
    if (!onQueryChange || !pagination) return;

    void onQueryChange({
      search,
      status: statusFilter,
      temperature: temperatureFilter,
      responsible: ownerFilter,
      quickFilter: getServerQuickFilter(quickFilter),
      sortBy,
      sortDirection,
      offset: pagination.nextCursor ? 0 : leads.length,
      cursor: pagination.nextCursor,
      limit: pagination.limit,
    }, { append: true });
  }

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem("crmCasaAdsLeadViewMode", mode);
    if (mode !== "kanban" && onQueryChange) {
      void onQueryChange({
        search,
        status: statusFilter,
        temperature: temperatureFilter,
        responsible: ownerFilter,
        quickFilter: getServerQuickFilter(quickFilter),
        sortBy,
        sortDirection,
        offset: 0,
        cursor: "",
      });
    }
  }

  return (
    <section className="panel tablePanel tablePanelV32 tablePanelV34">
      <div className="tableTop tableTopV32">
        <div>
          <span className="eyebrow">Carteira</span>
          <h2>Leads</h2>
          <p>Filtre a base, encontre pendências e abra o drawer apenas quando precisar de detalhe.</p>
        </div>

        <div className="viewModeSwitch" aria-label="Modo de visualização">
          {(["compact", "complete", "kanban"] as ViewMode[]).map((mode) => (
            <button key={mode} type="button" className={viewMode === mode ? "viewModeActive" : ""} onClick={() => handleViewModeChange(mode)}>
              {mode === "compact" ? "Compacto" : mode === "complete" ? "Completo" : "Kanban"}
            </button>
          ))}
        </div>
      </div>

      <div className="leadInsightV34">
        <strong>{quickCounts.next} leads estão sem próximo passo.</strong>
        <span>Priorize os que têm maior potencial ou outra agência mapeada.</span>
      </div>

      <div className="quickFiltersRow quickFiltersRowV32 quickFiltersRowV34">
        {(["all", "owner", "next", "priority", "agency", "mapping", "expansion"] as QuickFilter[]).map((filter) => {
          const showCount = ["owner", "next", "agency", "expansion"].includes(filter);
          return (
            <button
              key={filter}
              type="button"
              className={`quickFilterChip ${quickFilter === filter ? "quickFilterChipActive" : ""}`}
              onClick={() => setQuickFilter(filter)}
            >
              <span>{getQuickFilterLabel(filter)}</span>
              {showCount ? <strong>{quickCounts[filter]}</strong> : null}
            </button>
          );
        })}
      </div>

      <div className="leadToolbarV32">
        <input
          className="searchInput"
          type="search"
          placeholder="Buscar na carteira autorizada: nome, empresa, telefone, e-mail, dor, observação, origem ou responsável..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <details className="advancedFiltersV32">
          <summary>Filtros avançados</summary>
          <div className="leadToolbarFilters">
            <label className="compactFilter">
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as LeadStatus | "") }>
                <option value="">Todos</option>
                {statusOptions.map((status) => <option value={status} key={status}>{status}</option>)}
              </select>
            </label>

            <label className="compactFilter">
              <span>Temperatura</span>
              <select value={temperatureFilter} onChange={(event) => setTemperatureFilter(event.target.value as LeadTemperature | "") }>
                <option value="">Todas</option>
                <option value="Frio">Frio</option>
                <option value="Morno">Morno</option>
                <option value="Quente">Quente</option>
              </select>
            </label>

            <label className="compactFilter">
              <span>Responsável</span>
              <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                <option value="">Todos</option>
                {ownerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
              </select>
            </label>

            <label className="compactFilter">
              <span>Ordenar por</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as NonNullable<FetchLeadsParams["sortBy"]>)}>
                <option value="updatedAt">Última atualização</option>
                <option value="createdAt">Data de criação</option>
                <option value="nextContactAt">Próximo contato</option>
                <option value="lastContactAt">Último contato</option>
                <option value="name">Nome</option>
                <option value="company">Empresa</option>
                <option value="responsible">Responsável</option>
                <option value="status">Status</option>
                <option value="temperature">Temperatura</option>
              </select>
            </label>

            <label className="compactFilter">
              <span>Direção</span>
              <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as "asc" | "desc")}>
                <option value="desc">Decrescente</option>
                <option value="asc">Crescente</option>
              </select>
            </label>
          </div>
        </details>

        <p className="tableTopSummaryTextV34">{viewMode === "kanban" ? `Busca direta no MySQL · Escopo: ${summary?.scope?.label || "carteira autorizada"} · Filtro: ${getQuickFilterLabel(quickFilter)}` : <>Busca no MySQL · Exibindo {filteredLeads.length.toLocaleString("pt-BR")} de {totalAvailable.toLocaleString("pt-BR")} resultado(s) · Escopo: {summary?.scope?.label || "carteira autorizada"} · Filtro: {getQuickFilterLabel(quickFilter)}</>}</p>
      </div>

      {viewMode === "kanban" ? (
        <Suspense fallback={<div className="kanbanLoadingState" role="status"><strong>Carregando Kanban...</strong><span>O módulo é carregado somente quando necessário.</span></div>}>
          <KanbanBoard
          filters={kanbanFilters}
          canMoveCards={canMoveKanbanCards}
          canAddCards={canAddKanbanCards}
          canEditCards={canEditLeads}
          canDeleteCards={canDeleteLeads}
          canManagePipeline={canManageKanban}
          onViewLead={onViewLead}
          onEditLead={onEditLead}
          onDeleteLead={onDeleteLead}
          onLeadUpdated={onKanbanLeadUpdated}
          externalRefreshVersion={kanbanRefreshVersion}
        />
        </Suspense>
      ) : (
        <div className="tableWrap tableWrapV32 tableWrapV34">
          <table className="leadsTableV32 leadsTableV34">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Empresa</th>
                <th>Status</th>
                <th>Prioridade</th>
                <th>Próxima ação</th>
                <th>Responsável</th>
                {viewMode === "complete" ? <th>Qualidade</th> : null}
                <th>Último contato</th>
                <th>Ações</th>
              </tr>
            </thead>

            <tbody>
              {filteredLeads.length === 0 ? (
                <tr>
                  <td className="emptyState emptyStateV32" colSpan={viewMode === "complete" ? 9 : 8}>
                    Nenhum lead encontrado com os filtros atuais.
                  </td>
                </tr>
              ) : (
                displayedLeads.map((lead) => (
                  <LeadTableRow
                    key={lead.id}
                    lead={lead}
                    viewMode={viewMode}
                    onViewLead={onViewLead}
                    onEditLead={onEditLead}
                    onDeleteLead={onDeleteLead}
                    onHandoffLead={onHandoffLead}
                    canEditLeads={canEditLeads}
                    canDeleteLeads={canDeleteLeads}
                    canHandoffLeads={canHandoffLeads}
                  />
                ))
              )}
            </tbody>
          </table>
          {filteredLeads.length > displayedLeads.length ? (
            <p className="previewFooter">Exibindo os primeiros {displayedLeads.length.toLocaleString("pt-BR")} leads para manter a tela rápida. Use a busca ou filtros para encontrar contatos específicos.</p>
          ) : null}
          {hasMoreLeads ? (
            <div className="previewFooter loadMoreFooterV35">
              <span>A busca consulta a base completa no MySQL. A tela só renderiza uma página por vez para não travar o CRM.</span>
              <button className="secondaryButton" type="button" onClick={handleLoadMore} disabled={isLoading}>
                {isLoading ? "Carregando..." : `Carregar mais ${pagination?.limit || MAX_RENDERED_LEADS}`}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
});
