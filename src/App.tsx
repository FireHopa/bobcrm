import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import packageMetadata from "../package.json";
import { Header } from "./components/Header";
import { ActionFeedbackHost, notifyAction } from "./components/ActionFeedback";
import { useConfirmationDialog } from "./components/ConfirmationDialog";
import { DailyOperation } from "./components/DailyOperation";
import { LeadTable } from "./components/LeadTable";
import { LoginScreen } from "./components/LoginScreen";
import type { OpportunityQuickFilter } from "./components/ServiceOpportunityMap";
import type { CRMUser, Lead } from "./types/Lead";
import {
  ApiRequestError,
  checkServerHealth,
  clearServerSessionState,
  createLeadOnServer,
  deleteLeadFromServer,
  fetchCurrentUser,
  fetchAssignableUsersFromServer,
  fetchLeadByIdFromServer,
  fetchLeadFilterOptionsFromServer,
  fetchLeadPageFromServer,
  fetchLeadSummaryFromServer,
  emptyOpportunitySummary,
  hasPermission,
  importLeadBatchToServer,
  importLeadsToServer,
  logoutFromServer,
  updateLeadOnServer,
  type FetchLeadsParams,
  type LeadFilterOptions,
  type LeadPagination,
  type LeadSummary,
  type OpportunitySummary,
} from "./utils/api";
import { type ImportDeduplicationReport } from "./utils/commercial";
import { isPastDate, isToday } from "./utils/formatters";
import { clearLegacyStoredLeads, getLegacyStoredLeads } from "./utils/storage";

type ActiveTab = "operation" | "leads" | "opportunity-map" | "new-lead" | "import" | "settings";
type DrawerMode = "view" | "edit";
type ServerStatus = "loading" | "online" | "offline";


const ImportLeads = lazy(() => import("./components/ImportLeads").then((module) => ({ default: module.ImportLeads })));
const LeadDetailsDrawer = lazy(() => import("./components/LeadDetailsDrawer").then((module) => ({ default: module.LeadDetailsDrawer })));
const LeadHandoffDialog = lazy(() => import("./components/LeadHandoffDialog").then((module) => ({ default: module.LeadHandoffDialog })));
const LeadForm = lazy(() => import("./components/LeadForm").then((module) => ({ default: module.LeadForm })));
const ServiceOpportunityMap = lazy(() => import("./components/ServiceOpportunityMap").then((module) => ({ default: module.ServiceOpportunityMap })));
const SettingsCenter = lazy(() => import("./components/SettingsCenter").then((module) => ({ default: module.SettingsCenter })));

function WorkspaceModuleLoading() {
  return (
    <section className="panel loadingPanel" role="status" aria-live="polite">
      <span className="eyebrow">Carregamento sob demanda</span>
      <h2>Abrindo módulo</h2>
      <p>Carregando somente os recursos necessários para esta tela.</p>
    </section>
  );
}

const APP_VERSION = packageMetadata.version;
const LEADS_PAGE_SIZE = 150;

const emptyLeadPagination: LeadPagination = {
  total: 0,
  limit: LEADS_PAGE_SIZE,
  offset: 0,
  hasMore: false,
  nextCursor: "",
  sortBy: "updatedAt",
  sortDirection: "desc",
};

const emptyLeadSummary: LeadSummary = {
  total: 0,
  active: 0,
  dueFollowUps: 0,
  highPriority: 0,
  withoutOwner: 0,
  withoutNextStep: 0,
  hotLeads: 0,
  agencyOpportunities: 0,
  needsMapping: 0,
  expansionOpportunities: 0,
  deleted: 0,
};

type WorkspaceMeta = {
  title: string;
  description: string;
  stats: { label: string; value: string | number }[];
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<CRMUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadPagination, setLeadPagination] = useState<LeadPagination>(emptyLeadPagination);
  const [leadSummary, setLeadSummary] = useState<LeadSummary>(emptyLeadSummary);
  const [opportunitySummary, setOpportunitySummary] = useState<OpportunitySummary>(emptyOpportunitySummary);
  const [filteredOpportunitySummary, setFilteredOpportunitySummary] = useState<OpportunitySummary>(emptyOpportunitySummary);
  const [opportunityQuickFilter, setOpportunityQuickFilter] = useState<OpportunityQuickFilter>("all");
  const [requestedLeadQuickFilter, setRequestedLeadQuickFilter] = useState<"owner" | undefined>();
  const [requestedLeadQuickFilterKey, setRequestedLeadQuickFilterKey] = useState(0);
  const [leadFilterOptions, setLeadFilterOptions] = useState<LeadFilterOptions>({ owners: [] });
  const [assignableUsers, setAssignableUsers] = useState<CRMUser[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("operation");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [handoffLead, setHandoffLead] = useState<Lead | null>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("view");
  const [isLoading, setIsLoading] = useState(true);
  const [isLeadsRefreshing, setIsLeadsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [apiError, setApiError] = useState("");
  const [serverStatus, setServerStatus] = useState<ServerStatus>("loading");
  const [storageEngine, setStorageEngine] = useState<"mysql" | "sqlite">("mysql");
  const [legacyLocalLeads, setLegacyLocalLeads] = useState<Lead[]>([]);
  const [importReport, setImportReport] = useState<ImportDeduplicationReport | null>(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [kanbanRefreshVersion, setKanbanRefreshVersion] = useState(0);
  const [opportunityRefreshVersion, setOpportunityRefreshVersion] = useState(0);
  const { confirm, confirmationDialog } = useConfirmationDialog();

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) || null,
    [leads, selectedLeadId],
  );

  useEffect(() => {
    bootstrap();
    const legacyCheckId = window.setTimeout(() => {
      setLegacyLocalLeads(getLegacyStoredLeads());
    }, 500);

    return () => window.clearTimeout(legacyCheckId);
  }, []);

  async function bootstrap() {
    setIsAuthLoading(true);
    setIsLoading(false);
    setApiError("");

    try {
      const health = await checkServerHealth({ timeoutMs: 8000 });
      setStorageEngine(health.storage || "mysql");
      setServerStatus("online");

      let user: CRMUser;
      try {
        user = await fetchCurrentUser();
      } catch (caughtError) {
        if (caughtError instanceof ApiRequestError && caughtError.status === 401) {
          clearServerSessionState();
          setCurrentUser(null);
          return;
        }
        throw caughtError;
      }

      setCurrentUser(user);
      setIsAuthLoading(false);

      void loadLeadsFromServer({ includeSummary: false }, { keepScreen: true });
      void refreshLeadSummary();
      void refreshLeadFilterOptions();
      if (hasPermission(user, "assign_leads")) void refreshAssignableUsers();
    } catch (caughtError) {
      setServerStatus("offline");
      clearServerSessionState();
      setCurrentUser(null);
      setApiError(caughtError instanceof Error ? caughtError.message : "Não foi possível conectar ao CRM.");
      setIsLoading(false);
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function handleLogin(user: CRMUser) {
    setCurrentUser(user);
    setIsLoading(false);
    await loadLeadsFromServer({ includeSummary: false }, { keepScreen: true });
    void refreshLeadSummary();
    void refreshLeadFilterOptions();
    if (hasPermission(user, "assign_leads")) void refreshAssignableUsers();
  }

  async function handleLogout() {
    await logoutFromServer().catch(() => undefined);
    setCurrentUser(null);
    setLeads([]);
    setLeadFilterOptions({ owners: [] });
    setAssignableUsers([]);
    setSelectedLeadId(null);
    setHandoffLead(null);
    setActiveTab("operation");
  }

  const loadLeadsFromServer = useCallback(async (params: FetchLeadsParams = {}, options: { append?: boolean; keepScreen?: boolean } = {}) => {
    if (options.keepScreen) setIsLeadsRefreshing(true);
    else setIsLoading(true);
    setApiError("");

    try {
      const normalizedParams = { limit: LEADS_PAGE_SIZE, offset: 0, includeSummary: false, ...params };
      const result = await fetchLeadPageFromServer(normalizedParams);
      setLeads((currentLeads) => {
        if (!options.append) return result.leads;

        const currentIds = new Set(currentLeads.map((lead) => lead.id));
        const newLeads = result.leads.filter((lead) => !currentIds.has(lead.id));
        return [...currentLeads, ...newLeads];
      });
      setLeadPagination(result.pagination);
      if (result.hasSummary) setLeadSummary(result.summary);
      if (result.hasOpportunitySummary) {
        setOpportunitySummary(result.opportunitySummary);
        setFilteredOpportunitySummary(result.filteredOpportunitySummary);
      }
      setServerStatus("online");
    } catch (caughtError) {
      setServerStatus("offline");
      setApiError(
        caughtError instanceof Error
          ? caughtError.message
          : "Não foi possível carregar os leads do servidor.",
      );
    } finally {
      if (options.keepScreen) setIsLeadsRefreshing(false);
      else setIsLoading(false);
      setIsAuthLoading(false);
    }
  }, []);

  function replaceLeadInState(updatedLead: Lead) {
    setLeads((currentLeads) =>
      currentLeads.map((lead) => (lead.id === updatedLead.id ? updatedLead : lead)),
    );
  }

  async function createLead(lead: Lead) {
    if (!hasPermission(currentUser, "create_leads")) return;
    setIsSaving(true);
    setApiError("");

    try {
      const savedLead = await createLeadOnServer(lead);
      setLeads((currentLeads) => [savedLead, ...currentLeads.filter((currentLead) => currentLead.id !== savedLead.id)]);
      setActiveTab("leads");
      setSelectedLeadId(savedLead.id);
      setDrawerMode("view");
      setServerStatus("online");
      setKanbanRefreshVersion((version) => version + 1);
      setOpportunityRefreshVersion((version) => version + 1);
      void refreshLeadSummary();
    } catch (caughtError) {
      setServerStatus("offline");
      setApiError(caughtError instanceof Error ? caughtError.message : "Não foi possível salvar o lead no servidor.");
    } finally {
      setIsSaving(false);
    }
  }

  function mergeSavedLeadsIntoState(currentLeads: Lead[], savedLeads: Lead[]) {
    const savedIds = new Set(savedLeads.map((lead) => lead.id));
    return [...savedLeads, ...currentLeads.filter((lead) => !savedIds.has(lead.id))];
  }

  const refreshLeadSummary = useCallback(async () => {
    try {
      const summary = await fetchLeadSummaryFromServer();
      setLeadSummary(summary);
      setLeadPagination((currentPagination) => ({
        ...currentPagination,
        hasMore: currentPagination.offset + leads.length < currentPagination.total,
      }));
      setServerStatus("online");
    } catch {
      // O resumo é complementar. Se demorar ou falhar, a navegação continua funcionando.
    }
  }, [leads.length]);

  const refreshLeadFilterOptions = useCallback(async () => {
    try {
      setLeadFilterOptions(await fetchLeadFilterOptionsFromServer());
    } catch {
      // Opções auxiliares não bloqueiam a operação; a tabela mantém as opções da página carregada.
    }
  }, []);

  const refreshAssignableUsers = useCallback(async () => {
    try {
      setAssignableUsers(await fetchAssignableUsersFromServer());
    } catch {
      setAssignableUsers([]);
    }
  }, []);

  async function importLeads(importedLeads: Lead[], options: { chunked?: boolean } = {}): Promise<ImportDeduplicationReport | void> {
    if (!hasPermission(currentUser, "import_leads")) return;
    setIsSaving(true);
    setApiError("");

    try {
      if (options.chunked) {
        const result = await importLeadBatchToServer(importedLeads);
        setServerStatus("online");
        return {
          received: result.report.received,
          created: result.report.created,
          merged: result.report.merged,
          ignoredInsideFile: result.report.ignoredInsideFile,
        };
      }

      const result = await importLeadBatchToServer(importedLeads);
      const finalReport: ImportDeduplicationReport = {
        received: result.report.received,
        created: result.report.created,
        merged: result.report.merged,
        ignoredInsideFile: result.report.ignoredInsideFile,
      };

      await loadLeadsFromServer({ includeSummary: false }, { keepScreen: true });
      void refreshLeadSummary();
      setImportReport(finalReport);
      setActiveTab("operation");
      setServerStatus("online");
      setKanbanRefreshVersion((version) => version + 1);
      setOpportunityRefreshVersion((version) => version + 1);
      return finalReport;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Não foi possível importar os leads para o servidor.";
      setServerStatus("offline");
      setApiError(message);
      throw new Error(message);
    } finally {
      setIsSaving(false);
    }
  }

  function handleImportFinished(report: ImportDeduplicationReport) {
    setImportReport(report);
    setActiveTab("operation");
    void loadLeadsFromServer({ includeSummary: false }, { keepScreen: true });
    void refreshLeadSummary();
    setKanbanRefreshVersion((version) => version + 1);
    setOpportunityRefreshVersion((version) => version + 1);
  }

  async function updateLead(updatedLead: Lead) {
    if (!hasPermission(currentUser, "edit_leads_full") && !hasPermission(currentUser, "edit_lead_sales_fields")) return;
    setIsSaving(true);
    setApiError("");
    replaceLeadInState(updatedLead);

    try {
      const savedLead = await updateLeadOnServer(updatedLead);
      replaceLeadInState(savedLead);
      setSelectedLeadId(savedLead.id);
      setDrawerMode("view");
      setServerStatus("online");
      setKanbanRefreshVersion((version) => version + 1);
      setOpportunityRefreshVersion((version) => version + 1);
      void refreshLeadSummary();
    } catch (caughtError) {
      setServerStatus("offline");
      setApiError(caughtError instanceof Error ? caughtError.message : "Não foi possível atualizar o lead no servidor.");
      await loadLeadsFromServer();
    } finally {
      setIsSaving(false);
    }
  }

  async function updateLeadSilently(updatedLead: Lead) {
    if (!hasPermission(currentUser, "edit_leads_full")) return;
    setApiError("");
    replaceLeadInState(updatedLead);

    try {
      const savedLead = await updateLeadOnServer(updatedLead);
      replaceLeadInState(savedLead);
      setServerStatus("online");
      setKanbanRefreshVersion((version) => version + 1);
      setOpportunityRefreshVersion((version) => version + 1);
      void refreshLeadSummary();
    } catch (caughtError) {
      setServerStatus("offline");
      setApiError(caughtError instanceof Error ? caughtError.message : "Não foi possível salvar a alteração no mapa.");
      await loadLeadsFromServer();
    }
  }

  async function deleteLead(leadId: string) {
    if (!hasPermission(currentUser, "delete_leads")) {
      notifyAction("Seu usuário não tem permissão para excluir leads.", "error");
      return;
    }

    const leadToDelete = leads.find((lead) => lead.id === leadId);
    const confirmed = await confirm({
      title: "Mover lead para a lixeira?",
      message: leadToDelete?.name || leadToDelete?.company || "Este lead",
      detail: "O lead sairá das filas comerciais, mas poderá ser restaurado em Administração.",
      confirmLabel: "Mover para a lixeira",
      tone: "danger",
    });

    if (!confirmed) return;

    const previousLeads = leads;
    setLeads((currentLeads) => currentLeads.filter((lead) => lead.id !== leadId));

    if (selectedLeadId === leadId) {
      setSelectedLeadId(null);
    }

    setIsSaving(true);
    setApiError("");

    try {
      await deleteLeadFromServer(leadId);
      setServerStatus("online");
      setKanbanRefreshVersion((version) => version + 1);
      setOpportunityRefreshVersion((version) => version + 1);
      void refreshLeadSummary();
    } catch (caughtError) {
      setServerStatus("offline");
      setLeads(previousLeads);
      setApiError(caughtError instanceof Error ? caughtError.message : "Não foi possível excluir o lead no servidor.");
    } finally {
      setIsSaving(false);
    }
  }

  async function migrateLegacyLocalBase() {
    if (!legacyLocalLeads.length || !hasPermission(currentUser, "import_leads")) return;

    setIsSaving(true);
    setApiError("");

    try {
      await importLeadsToServer(legacyLocalLeads);
      await loadLeadsFromServer({ includeSummary: false }, { keepScreen: true });
      clearLegacyStoredLeads();
      setLegacyLocalLeads([]);
      setServerStatus("online");
      setKanbanRefreshVersion((version) => version + 1);
      setOpportunityRefreshVersion((version) => version + 1);
      void refreshLeadSummary();
    } catch (caughtError) {
      setServerStatus("offline");
      setApiError(caughtError instanceof Error ? caughtError.message : "Não foi possível migrar a base local para o servidor.");
    } finally {
      setIsSaving(false);
    }
  }

  async function openLead(leadId: string, mode: DrawerMode) {
    let lead = leads.find((currentLead) => currentLead.id === leadId);

    if (!lead) {
      try {
        lead = await fetchLeadByIdFromServer(leadId);
        setLeads((currentLeads) => [lead!, ...currentLeads.filter((currentLead) => currentLead.id !== leadId)]);
      } catch (caughtError) {
        setApiError(caughtError instanceof Error ? caughtError.message : "Não foi possível abrir o lead.");
        return;
      }
    }

    setSelectedLeadId(leadId);
    setDrawerMode(mode);
  }

  function closeDrawer() {
    setSelectedLeadId(null);
    setDrawerMode("view");
  }

  function openLeadHandoff(lead: Lead) {
    setHandoffLead(lead);
  }

  function closeLeadHandoff() {
    setHandoffLead(null);
  }

  function handleLeadHandoffCompleted(updatedLead: Lead) {
    replaceLeadInState(updatedLead);
    setHandoffLead(null);
    setDrawerMode("view");
    setKanbanRefreshVersion((version) => version + 1);
    setOpportunityRefreshVersion((version) => version + 1);
    void refreshLeadSummary();
    void refreshLeadFilterOptions();
  }

  function handleLeadRestored(restoredLead: Lead) {
    setLeads((currentLeads) => [restoredLead, ...currentLeads.filter((lead) => lead.id !== restoredLead.id)]);
    setKanbanRefreshVersion((version) => version + 1);
    setOpportunityRefreshVersion((version) => version + 1);
    void refreshLeadSummary();
  }

  function handleLeadsMerged(mergedLead: Lead, mergedIds: string[]) {
    setLeads((currentLeads) => [
      mergedLead,
      ...currentLeads.filter((lead) => lead.id !== mergedLead.id && !mergedIds.includes(lead.id)),
    ]);
    setKanbanRefreshVersion((version) => version + 1);
    setOpportunityRefreshVersion((version) => version + 1);
    void refreshLeadSummary();
  }

  function handleGlobalSearchChange(value: string) {
    setGlobalSearch(value);
    if (value.trim() && activeTab !== "leads") setActiveTab("leads");
  }

  async function handleGlobalSearchSubmit(value: string) {
    const searchValue = value.trim();
    setGlobalSearch(searchValue);
    setActiveTab("leads");
    await loadLeadsFromServer({ search: searchValue, offset: 0, limit: LEADS_PAGE_SIZE, includeSummary: false }, { keepScreen: true });
  }

  const handleLeadQueryChange = useCallback(
    async (params: FetchLeadsParams, options: { append?: boolean } = {}) => {
      await loadLeadsFromServer({ ...params, limit: LEADS_PAGE_SIZE }, { ...options, keepScreen: true });
    },
    [loadLeadsFromServer],
  );

  const openLeadFilterFromAdmin = useCallback((filter: "owner") => {
    setGlobalSearch("");
    setRequestedLeadQuickFilter(filter);
    setRequestedLeadQuickFilterKey((currentKey) => currentKey + 1);
    setActiveTab("leads");
  }, []);

  const clearRequestedLeadQuickFilter = useCallback(() => {
    setRequestedLeadQuickFilter(undefined);
  }, []);

  const openOpportunityFilterFromAdmin = useCallback((filter: "diagnosis" | "mapping-critical") => {
    setGlobalSearch("");
    setOpportunityQuickFilter(filter);
    setActiveTab("opportunity-map");
  }, []);

  const storageName = storageEngine === "mysql" ? "MySQL" : "SQLite";
  const storageLabel =
    serverStatus === "online"
      ? `${storageName} online`
      : serverStatus === "loading"
        ? `Conectando ao ${storageName}`
        : `${storageName} offline`;

  const storageTone = serverStatus === "online" ? "green" : serverStatus === "loading" ? "yellow" : "red";

  const totalLeadsCount = leadSummary.total || leadPagination.total || leads.length;
  const activeLeadsCount = leadSummary.active;
  const dueFollowUpsCount = leadSummary.dueFollowUps;
  const highPriorityCount = leadSummary.highPriority;
  const withoutOwnerCount = leadSummary.withoutOwner;
  const withoutNextStepCount = leadSummary.withoutNextStep;
  const hotLeadsCount = leadSummary.hotLeads;

  const visibleTabs = [
    { id: "operation" as ActiveTab, label: "Hoje" },
    { id: "leads" as ActiveTab, label: "Leads" },
    { id: "opportunity-map" as ActiveTab, label: "Oportunidades" },
    ...(hasPermission(currentUser, "create_leads") ? [{ id: "new-lead" as ActiveTab, label: "Novo lead" }] : []),
    ...(hasPermission(currentUser, "import_leads") ? [{ id: "import" as ActiveTab, label: "Importar" }] : []),
    ...(hasPermission(currentUser, "manage_users") ? [{ id: "settings" as ActiveTab, label: "Administração" }] : []),
  ];

  const workspaceMeta: Record<ActiveTab, WorkspaceMeta> = {
    operation: {
      title: "Painel do dia",
      description: "Priorize contatos, complete diagnósticos e avance oportunidades.",
      stats: [
        { label: "Ações abertas", value: dueFollowUpsCount },
        { label: "Prioridades", value: highPriorityCount },
        { label: "Sem próximo passo", value: withoutNextStepCount },
        { label: "Sem responsável", value: withoutOwnerCount },
        { label: "Leads quentes", value: hotLeadsCount },
      ],
    },
    leads: {
      title: "Leads",
      description: "Encontre, filtre e avance contatos da carteira.",
      stats: [
        { label: "Total", value: totalLeadsCount },
        { label: "Sem responsável", value: withoutOwnerCount },
        { label: "Sem próximo passo", value: withoutNextStepCount },
        { label: "Follow-ups vencidos", value: dueFollowUpsCount },
      ],
    },
    "opportunity-map": {
      title: "Oportunidades",
      description: "Encontre lacunas da carteira, serviços não vendidos e próximas melhores ofertas.",
      stats: [
        { label: "Alta prioridade", value: highPriorityCount },
        { label: "Ativos", value: activeLeadsCount },
        { label: "Sem responsável", value: withoutOwnerCount },
      ],
    },
    "new-lead": {
      title: "Novo lead",
      description: "Cadastre o contato e registre o contexto comercial inicial.",
      stats: [
        { label: "Total", value: totalLeadsCount },
        { label: "Sem próximo passo", value: withoutNextStepCount },
        { label: "Sem responsável", value: withoutOwnerCount },
      ],
    },
    import: {
      title: "Importar leads",
      description: "Envie a planilha, confirme o mapeamento e importe com segurança.",
      stats: [
        { label: "Total atual", value: totalLeadsCount },
        { label: "Sem responsável", value: withoutOwnerCount },
        { label: "Follow-ups vencidos", value: dueFollowUpsCount },
      ],
    },
    settings: {
      title: "Equipe e administração",
      description: "Usuários, backups, lixeira, duplicados, auditoria e saúde da base.",
      stats: [
        { label: "Papel", value: currentUser ? currentUser.roleLabel : "-" },
        { label: "Possíveis duplicados", value: "Ver aba" },
        { label: "Total", value: totalLeadsCount },
      ],
    },
  };

  if (isAuthLoading) {
    return (
      <main className="appShell appShellV32 appShellV33 appShellV34 appShellV37">
        <section className="panel loadingPanel">
          <span className="eyebrow">CRM Casa do Ads v{APP_VERSION}</span>
          <h2>Verificando sessão</h2>
          <p>Validando acesso da equipe e conexão com o servidor.</p>
        </section>
      </main>
    );
  }

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} serverStatus={serverStatus} />;
  }

  const currentMeta = workspaceMeta[activeTab];

  return (
    <main className="appShell appShellV32 appShellV33 appShellV34 appShellV37">
      <Header
        storageLabel={storageLabel}
        storageTone={storageTone}
        currentUser={currentUser}
        globalSearch={globalSearch}
        onGlobalSearchChange={handleGlobalSearchChange}
        onGlobalSearchSubmit={handleGlobalSearchSubmit}
        onLogout={handleLogout}
        totalLeadsCount={totalLeadsCount}
      />

      <nav className="crmTabs cockpitTabs cockpitTabsV37" aria-label="Navegação principal do CRM">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            className={`crmTab cockpitTab ${activeTab === tab.id ? "crmTabActive" : ""}`}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            
          </button>
        ))}
      </nav>

      {apiError ? (
        <div className="systemNotice systemNoticeError" role="alert">
          <div>
            <strong>Atenção operacional.</strong>
            <span>{apiError}</span>
          </div>
          <button className="secondaryButton" type="button" onClick={() => loadLeadsFromServer()}>
            Tentar novamente
          </button>
        </div>
      ) : null}

      {legacyLocalLeads.length > 0 && hasPermission(currentUser, "import_leads") ? (
        <div className="systemNotice systemNoticeMigration" role="status">
          <div>
            <strong>Base local encontrada.</strong>
            <span>{legacyLocalLeads.length} leads salvos neste navegador podem ser migrados para o servidor.</span>
          </div>
          <div className="systemNoticeActions">
            <button className="secondaryButton" type="button" onClick={() => setLegacyLocalLeads([])}>
              Ignorar
            </button>
            <button className="primaryButton" type="button" onClick={migrateLegacyLocalBase} disabled={isSaving}>
              Migrar para servidor
            </button>
          </div>
        </div>
      ) : null}

      {importReport ? (
        <div className="systemNotice systemNoticeMigration" role="status">
          <div>
            <strong>Importação concluída.</strong>
            <span>
              Recebidos: {importReport.received}. Criados: {importReport.created}. Mesclados: {importReport.merged}. Ignorados: {importReport.ignoredInsideFile}.
            </span>
          </div>
          <button className="secondaryButton" type="button" onClick={() => setImportReport(null)}>
            Fechar
          </button>
        </div>
      ) : null}

      {isSaving ? <div className="syncBar">Salvando no servidor...</div> : null}

      {!isLoading ? (
        <section className="workspaceHeaderV32 workspaceHeaderV37" aria-label="Resumo da tela atual">
          <div>
            <h1>{currentMeta.title}</h1>
            <p>{currentMeta.description}</p>
            <span className="badge badgeBlue">Escopo dos indicadores: {leadSummary.scope?.label || "carteira autorizada"}</span>
          </div>
          {activeTab !== "operation" ? (
            <div className="workspaceStatsV32">
              {currentMeta.stats.map((item) => (
                <article key={`${activeTab}-${item.label}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {isLoading ? (
        <section className="panel loadingPanel">
          <span className="eyebrow">Servidor</span>
          <h2>Carregando base do CRM</h2>
          <p>Buscando leads paginados no servidor.</p>
        </section>
      ) : null}

      <Suspense fallback={<WorkspaceModuleLoading />}>
      {!isLoading && activeTab === "operation" ? (
          <DailyOperation
            leads={leads}
            currentUser={currentUser}
            assignableUsers={assignableUsers}
            onViewLead={(leadId) => openLead(leadId, "view")}
            onDataChanged={() => {
              void loadLeadsFromServer({ includeSummary: false }, { keepScreen: true });
              void refreshLeadSummary();
            }}
          />
        ) : null}
  
        {!isLoading && activeTab === "leads" ? (
          <section className="leadsWorkspace">
            <LeadTable
              leads={leads}
              externalSearch={globalSearch}
              pagination={leadPagination}
              summary={leadSummary}
              ownerOptions={leadFilterOptions.owners}
              isLoading={isLeadsRefreshing}
              onQueryChange={handleLeadQueryChange}
              onViewLead={(leadId) => { void openLead(leadId, "view"); }}
              onEditLead={(leadId) => { void openLead(leadId, "edit"); }}
              onDeleteLead={deleteLead}
              onHandoffLead={openLeadHandoff}
              canEditLeads={hasPermission(currentUser, "edit_leads_full") || hasPermission(currentUser, "edit_lead_sales_fields")}
              canDeleteLeads={hasPermission(currentUser, "delete_leads")}
              canHandoffLeads={hasPermission(currentUser, "assign_leads") && hasPermission(currentUser, "move_lead_pipeline") && hasPermission(currentUser, "assign_tasks")}
              canMoveKanbanCards={hasPermission(currentUser, "move_lead_stage")}
              canAddKanbanCards={hasPermission(currentUser, "bulk_move_leads")}
              canManageKanban={hasPermission(currentUser, "manage_pipelines")}
              onKanbanLeadUpdated={replaceLeadInState}
              kanbanRefreshVersion={kanbanRefreshVersion}
              requestedQuickFilter={requestedLeadQuickFilter}
              requestedQuickFilterKey={requestedLeadQuickFilterKey}
              onRequestedQuickFilterApplied={clearRequestedLeadQuickFilter}
            />
          </section>
        ) : null}
  
        {!isLoading && activeTab === "opportunity-map" ? (
          <section className="opportunityWorkspace">
            <ServiceOpportunityMap
              leads={leads}
              totalLeadsCount={totalLeadsCount}
              loadedLeadsCount={leads.length}
              externalSearch={globalSearch}
              pagination={leadPagination}
              opportunitySummary={opportunitySummary}
              filteredOpportunitySummary={filteredOpportunitySummary}
              isLoading={isLeadsRefreshing}
              refreshVersion={opportunityRefreshVersion}
              quickFilter={opportunityQuickFilter}
              onQuickFilterChange={setOpportunityQuickFilter}
              onQueryChange={handleLeadQueryChange}
              onUpdateLead={updateLeadSilently}
              canUpdateCommercialMap={hasPermission(currentUser, "edit_leads_full")}
              onViewLead={(leadId) => openLead(leadId, "view")}
              onEditLead={(leadId) => openLead(leadId, "edit")}
            />
          </section>
        ) : null}
  
        {!isLoading && activeTab === "new-lead" && hasPermission(currentUser, "create_leads") ? (
          <section className="formWorkspace">
            <LeadForm onCreateLead={createLead} />
          </section>
        ) : null}
  
        {!isLoading && activeTab === "import" && hasPermission(currentUser, "import_leads") ? (
          <section className="importWorkspace">
            <ImportLeads onImportLeads={importLeads} onImportFinished={handleImportFinished} />
          </section>
        ) : null}
  
        {!isLoading && activeTab === "settings" ? (
          <SettingsCenter
            currentUser={currentUser}
            onViewLead={(leadId) => openLead(leadId, "view")}
            onEditLead={(leadId) => openLead(leadId, "edit")}
            onLeadRestored={handleLeadRestored}
            onLeadsMerged={handleLeadsMerged}
            onRefreshLeads={() => loadLeadsFromServer({ includeSummary: false }, { keepScreen: true })}
            onOpenLeadFilter={openLeadFilterFromAdmin}
            onOpenOpportunityFilter={openOpportunityFilterFromAdmin}
          />
        ) : null}
  
        {!handoffLead ? (
          <LeadDetailsDrawer
            lead={selectedLead}
            mode={drawerMode}
            currentUser={currentUser}
            assignableUsers={assignableUsers}
            onClose={closeDrawer}
            onChangeMode={setDrawerMode}
            onSaveLead={updateLead}
            onDeleteLead={deleteLead}
            onRequestHandoff={openLeadHandoff}
            onTaskChanged={() => {
              void loadLeadsFromServer({ includeSummary: false }, { keepScreen: true });
              void refreshLeadSummary();
            }}
          />
        ) : null}
  
        {handoffLead ? (
          <LeadHandoffDialog
            lead={handoffLead}
            assignableUsers={assignableUsers}
            onClose={closeLeadHandoff}
            onCompleted={(result) => handleLeadHandoffCompleted(result.lead)}
          />
        ) : null}
  
        </Suspense>

      {confirmationDialog}
      <ActionFeedbackHost />

      <p className="footerNote footerNoteV37">CRM Casa do Ads v{APP_VERSION}</p>
    </main>
  );
}
