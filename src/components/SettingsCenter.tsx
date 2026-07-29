import { FormEvent, useEffect, useState } from "react";
import packageMetadata from "../../package.json";
import type { AuditEntry, BackupEntry, CRMTeam, CRMUser, Lead } from "../types/Lead";
import {
  createBackupOnServer,
  createTeamOnServer,
  createUserOnServer,
  deactivateUserOnServer,
  downloadBackupById,
  downloadDatabaseBackup,
  downloadLeadsCsvExport,
  downloadLeadsXlsxExport,
  fetchAdminLeadOverviewFromServer,
  fetchBackupsFromServer,
  fetchDeletedLeadsFromServer,
  fetchDuplicateGroupsFromServer,
  fetchRecentAuditFromServer,
  fetchTeamsFromServer,
  fetchUsersFromServer,
  hasPermission,
  mergeLeadsOnServer,
  permanentlyDeleteLeadFromServer,
  restoreLeadOnServer,
  updateTeamOnServer,
  updateUserOnServer,
  type AdminLeadOverview,
  type DuplicateGroup,
  type DuplicateGroupsPage,
  type DeletedLeadPagination,
} from "../utils/api";
import { useConfirmationDialog } from "./ConfirmationDialog";

type SettingsCenterProps = {
  currentUser: CRMUser;
  onViewLead: (leadId: string) => void;
  onEditLead: (leadId: string) => void;
  onLeadRestored: (lead: Lead) => void;
  onLeadsMerged: (lead: Lead, mergedIds: string[]) => void;
  onRefreshLeads: () => Promise<void> | void;
  onOpenLeadFilter: (filter: "owner") => void;
  onOpenOpportunityFilter: (filter: "diagnosis" | "mapping-critical") => void;
};

type UserFormState = {
  name: string;
  email: string;
  password: string;
  role: CRMUser["role"];
  teamId: string;
  leadAccessScope: CRMUser["leadAccessScope"];
};

type AdminTab = "summary" | "users" | "backups" | "trash" | "duplicates" | "audit" | "system";


const emptyAdminLeadOverview: AdminLeadOverview = {
  total: 0,
  withOwner: 0,
  withTemperature: 0,
  withPain: 0,
  withNextContact: 0,
  withWebsite: 0,
  withoutOwner: 0,
  withoutConfirmedDiagnosis: 0,
  highMappingUrgency: 0,
  duplicateGroups: 0,
};

const emptyDuplicatePagination: DuplicateGroupsPage["pagination"] = {
  total: 0,
  limit: 20,
  offset: 0,
  hasMore: false,
};

const emptyDeletedPagination: DeletedLeadPagination = {
  total: 0,
  limit: 100,
  offset: 0,
  hasMore: false,
};

const initialUserForm: UserFormState = {
  name: "",
  email: "",
  password: "",
  role: "consultor_vendas",
  teamId: "",
  leadAccessScope: "own",
};

function getCompletionPercentage(filled: number, total: number): number {
  if (!total) return 0;
  return Math.round((filled / total) * 100);
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDateTime(value: string): string {
  if (!value) return "Não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function getDuplicateReasonLabel(reason: string): string {
  if (reason === "email") return "E-mail";
  if (reason === "phone") return "Telefone";
  return "Nome + empresa";
}

function getBackupStatusLabel(backup: BackupEntry): string {
  if (backup.status === "verified") return "Verificado";
  if (backup.status === "expired") return "Expirado pela retenção";
  if (backup.status === "legacy_unverified") return "Legado não verificado";
  return backup.status || "Status desconhecido";
}

export function SettingsCenter({
  currentUser,
  onViewLead,
  onEditLead,
  onLeadRestored,
  onLeadsMerged,
  onRefreshLeads,
  onOpenLeadFilter,
  onOpenOpportunityFilter,
}: SettingsCenterProps) {
  const [users, setUsers] = useState<CRMUser[]>([]);
  const [teams, setTeams] = useState<CRMTeam[]>([]);
  const [teamName, setTeamName] = useState("");
  const [deletedLeads, setDeletedLeads] = useState<Lead[]>([]);
  const [deletedPagination, setDeletedPagination] = useState<DeletedLeadPagination>(emptyDeletedPagination);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [adminOverview, setAdminOverview] = useState<AdminLeadOverview>(emptyAdminLeadOverview);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [duplicatePagination, setDuplicatePagination] = useState<DuplicateGroupsPage["pagination"]>(emptyDuplicatePagination);
  const [duplicatesLoaded, setDuplicatesLoaded] = useState(false);
  const [userForm, setUserForm] = useState<UserFormState>(initialUserForm);
  const [panelMessage, setPanelMessage] = useState("");
  const [panelError, setPanelError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>("summary");
  const { confirm, confirmationDialog } = useConfirmationDialog();

  const {
    total,
    withOwner,
    withTemperature,
    withPain,
    withNextContact,
    withWebsite,
    withoutOwner,
    withoutConfirmedDiagnosis,
    highMappingUrgency,
  } = adminOverview;
  const lastBackup = backups[0];
  const lastAudit = auditEntries[0];

  const canManageUsers = hasPermission(currentUser, "manage_users");
  const canBackup = hasPermission(currentUser, "backup_database");
  const canExport = hasPermission(currentUser, "export_leads");
  const canRestore = hasPermission(currentUser, "restore_leads");
  const canPermanentDelete = hasPermission(currentUser, "permanent_delete_leads");
  const canMerge = hasPermission(currentUser, "merge_leads");
  const canAudit = hasPermission(currentUser, "read_audit");

  useEffect(() => {
    loadProductionData();
  }, []);

  useEffect(() => {
    if (activeAdminTab !== "duplicates" || duplicatesLoaded) return;
    void loadDuplicatePage(0).catch((error) => {
      setPanelError(error instanceof Error ? error.message : "Não foi possível carregar os duplicados.");
    });
  }, [activeAdminTab, duplicatesLoaded]);

  async function runPanelAction(action: () => Promise<void>, successMessage?: string) {
    setPanelError("");
    setPanelMessage("");
    setIsBusy(true);

    try {
      await action();
      if (successMessage) setPanelMessage(successMessage);
    } catch (caughtError) {
      setPanelError(caughtError instanceof Error ? caughtError.message : "Não foi possível executar a ação.");
    } finally {
      setIsBusy(false);
    }
  }

  async function loadProductionData() {
    setPanelError("");
    const tasks: Promise<unknown>[] = [];

    if (canManageUsers) {
      tasks.push(fetchUsersFromServer().then(setUsers));
      tasks.push(fetchTeamsFromServer().then(setTeams));
      tasks.push(fetchAdminLeadOverviewFromServer({ includeDuplicates: false }).then((overview) => {
        setAdminOverview((current) => ({ ...overview, duplicateGroups: current.duplicateGroups }));
      }));
    }
    if (canRestore) tasks.push(fetchDeletedLeadsFromServer({ limit: emptyDeletedPagination.limit, offset: 0 }).then((result) => {
      setDeletedLeads(result.leads);
      setDeletedPagination(result.pagination);
    }));
    if (canBackup) tasks.push(fetchBackupsFromServer().then(setBackups));
    if (canAudit) tasks.push(fetchRecentAuditFromServer().then(setAuditEntries));

    await Promise.all(tasks).catch((error) => setPanelError(error instanceof Error ? error.message : "Não foi possível carregar dados de produção."));
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageUsers) return;

    await runPanelAction(async () => {
      const createdUser = await createUserOnServer(userForm);
      setUsers((currentUsers) => [...currentUsers, createdUser]);
      setUserForm(initialUserForm);
    }, "Usuário criado com sucesso.");
  }

  async function handleCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = teamName.trim();
    if (!name) return;

    await runPanelAction(async () => {
      const createdTeam = await createTeamOnServer({ name });
      setTeams((currentTeams) => [...currentTeams, createdTeam].sort((a, b) => a.name.localeCompare(b.name)));
      setTeamName("");
    }, "Equipe criada com sucesso.");
  }

  async function handleUpdateTeam(team: CRMTeam, payload: Partial<CRMTeam>) {
    await runPanelAction(async () => {
      const updated = await updateTeamOnServer(team.id, payload);
      setTeams((currentTeams) => currentTeams.map((currentTeam) => currentTeam.id === updated.id ? updated : currentTeam));
    }, "Equipe atualizada.");
  }

  async function handleUpdateUser(user: CRMUser, payload: Partial<CRMUser> & { password?: string }) {
    await runPanelAction(async () => {
      const updated = await updateUserOnServer(user.id, payload);
      setUsers((currentUsers) => currentUsers.map((currentUserItem) => (currentUserItem.id === updated.id ? updated : currentUserItem)));
    }, "Usuário atualizado.");
  }

  async function handleDeactivateUser(user: CRMUser) {
    const confirmed = await confirm({
      title: "Desativar usuário?",
      message: user.name,
      detail: "O acesso será bloqueado imediatamente. Os leads e registros históricos serão preservados.",
      confirmLabel: "Desativar usuário",
      tone: "danger",
    });
    if (!confirmed) return;

    await runPanelAction(async () => {
      await deactivateUserOnServer(user.id);
      setUsers((currentUsers) => currentUsers.map((currentUserItem) => currentUserItem.id === user.id ? { ...currentUserItem, isActive: false } : currentUserItem));
    }, "Usuário desativado.");
  }

  async function handleCreateBackup() {
    await runPanelAction(async () => {
      const backup = await createBackupOnServer();
      setBackups((currentBackups) => [backup, ...currentBackups]);
    }, "Backup manual criado.");
  }

  async function handleCreateAndDownloadBackup() {
    await runPanelAction(async () => {
      const backup = await downloadDatabaseBackup();
      setBackups((currentBackups) => [backup, ...currentBackups]);
    }, "Backup completo criado, verificado e baixado.");
  }

  async function handleRestoreLead(lead: Lead) {
    await runPanelAction(async () => {
      const restored = await restoreLeadOnServer(lead.id);
      setDeletedLeads((currentDeleted) => currentDeleted.filter((currentLead) => currentLead.id !== lead.id));
      setDeletedPagination((current) => ({ ...current, total: Math.max(0, current.total - 1) }));
      onLeadRestored(restored);
      await Promise.all([refreshAdminOverview(), loadDuplicatePage(0)]);
    }, "Lead restaurado.");
  }

  async function handlePermanentDelete(lead: Lead) {
    const confirmed = await confirm({
      title: "Apagar lead definitivamente?",
      message: lead.name || lead.company || "Este lead",
      detail: "Essa ação não pode ser desfeita e remove o registro da lixeira.",
      confirmLabel: "Apagar definitivamente",
      tone: "danger",
    });
    if (!confirmed) return;

    await runPanelAction(async () => {
      await permanentlyDeleteLeadFromServer(lead.id);
      setDeletedLeads((currentDeleted) => currentDeleted.filter((currentLead) => currentLead.id !== lead.id));
      setDeletedPagination((current) => ({ ...current, total: Math.max(0, current.total - 1) }));
    }, "Lead apagado definitivamente.");
  }

  async function loadDeletedPage(offset: number, append = false) {
    const result = await fetchDeletedLeadsFromServer({ limit: deletedPagination.limit, offset });
    setDeletedLeads((currentLeads) => append ? [...currentLeads, ...result.leads] : result.leads);
    setDeletedPagination(result.pagination);
  }

  async function loadDuplicatePage(offset: number, append = false) {
    const result = await fetchDuplicateGroupsFromServer({ limit: duplicatePagination.limit, offset });
    setDuplicates((currentGroups) => append ? [...currentGroups, ...result.groups] : result.groups);
    setDuplicatePagination(result.pagination);
    setDuplicatesLoaded(true);
    if (!append && offset === 0) {
      setAdminOverview((current) => ({ ...current, duplicateGroups: result.pagination.total }));
    }
    return result;
  }

  async function refreshAdminOverview() {
    const overview = await fetchAdminLeadOverviewFromServer({ includeDuplicates: false });
    setAdminOverview((current) => ({ ...overview, duplicateGroups: current.duplicateGroups }));
  }

  async function handleMergeGroup(group: DuplicateGroup) {
    if (group.isTruncated) {
      setPanelError("Este grupo é maior que o limite seguro de visualização. Revise a origem dos dados antes de mesclar.");
      return;
    }

    const primaryLead = group.leads[0];
    const duplicateLeadIds = group.leads.slice(1).map((lead) => lead.id);
    if (!primaryLead || !duplicateLeadIds.length) return;

    const confirmed = await confirm({
      title: "Mesclar leads duplicados?",
      message: `${group.leads.length} cadastros serão consolidados em ${primaryLead.name || primaryLead.company || "um lead principal"}.`,
      detail: "O lead principal será mantido. Os demais serão enviados para a lixeira e poderão ser restaurados.",
      confirmLabel: "Mesclar duplicados",
      tone: "danger",
    });
    if (!confirmed) return;

    await runPanelAction(async () => {
      const mergedLead = await mergeLeadsOnServer(primaryLead.id, duplicateLeadIds);
      onLeadsMerged(mergedLead, duplicateLeadIds);
      await Promise.resolve(onRefreshLeads());
      await Promise.all([refreshAdminOverview(), loadDuplicatePage(0)]);
    }, "Duplicados mesclados.");
  }

  const adminTabs = [
    { id: "summary" as AdminTab, label: "Resumo", count: 0 },
    ...(canManageUsers ? [{ id: "users" as AdminTab, label: "Usuários", count: users.length }] : []),
    ...(canBackup ? [{ id: "backups" as AdminTab, label: "Backups", count: backups.length }] : []),
    ...(canRestore ? [{ id: "trash" as AdminTab, label: "Lixeira", count: deletedPagination.total }] : []),
    { id: "duplicates" as AdminTab, label: "Duplicados", count: adminOverview.duplicateGroups },
    ...(canAudit ? [{ id: "audit" as AdminTab, label: "Auditoria", count: auditEntries.length }] : []),
    { id: "system" as AdminTab, label: "Sistema", count: 0 },
  ];

  return (
    <section className="settingsWorkspace settingsWorkspaceV32 settingsWorkspaceV34">
      <div className="adminTabsV32" role="tablist" aria-label="Administração do CRM">
        {adminTabs.map((tab) => (
          <button key={tab.id} type="button" className={activeAdminTab === tab.id ? "adminTabActiveV32" : ""} onClick={() => setActiveAdminTab(tab.id)}>
            <span>{tab.label}</span>
            {tab.count ? <strong>{tab.count}</strong> : null}
          </button>
        ))}
      </div>

      {panelError ? <div className="systemNotice systemNoticeError"><strong>Erro:</strong><span>{panelError}</span></div> : null}
      {panelMessage ? <div className="systemNotice systemNoticeMigration"><strong>Pronto:</strong><span>{panelMessage}</span></div> : null}
      {isBusy ? <div className="syncBar">Processando ação administrativa...</div> : null}

      {activeAdminTab === "summary" ? (
        <>
          <div className="settingsInsightV34">
            <strong>A maior trava da base hoje é responsável indefinido.</strong>
            <span>{withoutOwner} leads precisam de distribuição antes da rotina comercial escalar.</span>
          </div>

          <div className="adminSummaryGroupTitleV34">Ações críticas</div>
          <div className="adminSummaryGridV32 adminSummaryGridV34 criticalSummaryGridV34">
            <article className="panel adminSummaryCardV32">
              <span>Usuários ativos</span>
              <strong>{users.filter((user) => user.isActive).length || (canManageUsers ? 0 : "-")}</strong>
              <button className="secondaryButton" type="button" onClick={() => setActiveAdminTab("users")} disabled={!canManageUsers}>Gerenciar usuários</button>
            </article>
            <article className="panel adminSummaryCardV32">
              <span>Leads sem responsável</span>
              <strong>{withoutOwner}</strong>
              <button className="secondaryButton" type="button" onClick={() => onOpenLeadFilter("owner")}>Corrigir responsáveis</button>
            </article>
            <article className="panel adminSummaryCardV32">
              <span>Possíveis duplicados</span>
              <strong>{adminOverview.duplicateGroups}</strong>
              <button className="primaryButton" type="button" onClick={() => setActiveAdminTab("duplicates")}>Resolver duplicados</button>
            </article>
          </div>

          <div className="adminSummaryGroupTitleV34">Administração</div>
          <div className="adminSummaryGridV32 adminSummaryGridV34 adminSupportGridV34">
            <article className="panel adminSummaryCardV32">
              <span>Leads na lixeira</span>
              <strong>{canRestore ? deletedPagination.total : "-"}</strong>
              <button className="secondaryButton" type="button" onClick={() => setActiveAdminTab("trash")} disabled={!canRestore}>Abrir lixeira</button>
            </article>
            <article className="panel adminSummaryCardV32">
              <span>Último backup</span>
              <strong>{lastBackup ? formatDateTime(lastBackup.createdAt) : "Pendente"}</strong>
              <button className="primaryButton" type="button" onClick={handleCreateBackup} disabled={!canBackup}>Criar backup</button>
            </article>
            <article className="panel adminSummaryCardV32">
              <span>Última auditoria</span>
              <strong>{lastAudit ? formatDateTime(lastAudit.createdAt) : "Sem evento"}</strong>
              <button className="secondaryButton" type="button" onClick={() => setActiveAdminTab("audit")} disabled={!canAudit}>Ver auditoria</button>
            </article>
          </div>

          <div className="settingsGrid settingsGridV32 settingsGridV34">
            <section className="panel settingsCard">
              <h3>Qualidade do cadastro</h3>
              <p>A base está com baixa maturidade comercial quando falta responsável, temperatura, dor e próximo passo.</p>

              <div className="healthList healthListV33 healthListV34">
                {[
                  ["Responsável", getCompletionPercentage(withOwner, total)],
                  ["Temperatura", getCompletionPercentage(withTemperature, total)],
                  ["Dor", getCompletionPercentage(withPain, total)],
                  ["Próximo passo", getCompletionPercentage(withNextContact, total)],
                  ["Website", getCompletionPercentage(withWebsite, total)],
                ].map(([label, percentage]) => (
                  <div key={label as string}>
                    <span>{label}</span>
                    <strong>{percentage}%</strong>
                    <i style={{ width: `${percentage}%` }} />
                  </div>
                ))}
              </div>

              <div className="settingsActions settingsActionsV32">
                <button className="secondaryButton" type="button" onClick={() => onOpenLeadFilter("owner")}>Corrigir responsáveis</button>
                <button className="secondaryButton" type="button" onClick={() => onOpenOpportunityFilter("diagnosis")}>Completar diagnóstico</button>
              </div>
            </section>

            <section className="panel settingsCard">
              <h3>Alertas comerciais</h3>
              <p>O que precisa ser corrigido antes de escalar a operação.</p>

              <div className="alertStatsGrid alertStatsGridV33 alertStatsGridV34">
                <article><span>Sem diagnóstico</span><strong>{withoutConfirmedDiagnosis}</strong><button className="secondaryButton" type="button" onClick={() => onOpenOpportunityFilter("diagnosis")}>Ver leads</button></article>
                <article><span>Mapeamento crítico</span><strong>{highMappingUrgency}</strong><button className="secondaryButton" type="button" onClick={() => onOpenOpportunityFilter("mapping-critical")}>Mapear agora</button></article>
                <article><span>Duplicados</span><strong>{adminOverview.duplicateGroups}</strong><button className="primaryButton" type="button" onClick={() => setActiveAdminTab("duplicates")}>Resolver</button></article>
              </div>
            </section>
          </div>
        </>
      ) : null}

      {activeAdminTab === "users" && canManageUsers ? (
        <section className="panel productionPanel productionPanelV32">
          <div className="sectionTitleRow">
            <div>
              <h3>Usuários</h3>
              <p>Crie usuários e controle papéis da equipe.</p>
            </div>
            <span className="badge badgeBlue">{users.length} usuário(s)</span>
          </div>

          <div className="teamManagementBlock">
            <div className="sectionTitleRow">
              <div>
                <strong>Equipes comerciais</strong>
                <p>Use equipes para organizar pré-venda e consultores. O acesso aos leads é definido automaticamente pelo papel.</p>
              </div>
            </div>
            <form className="teamCreateForm" onSubmit={handleCreateTeam}>
              <input placeholder="Nome da equipe" value={teamName} onChange={(event) => setTeamName(event.target.value)} required />
              <button className="secondaryButton" type="submit">Criar equipe</button>
            </form>
            <div className="teamChips">
              {teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className={`quickFilterChip ${team.isActive ? "quickFilterChipActive" : ""}`}
                  onClick={() => handleUpdateTeam(team, { isActive: !team.isActive })}
                  title={team.isActive ? "Clique para inativar" : "Clique para reativar"}
                >
                  {team.name} · {team.isActive ? "Ativa" : "Inativa"}
                </button>
              ))}
            </div>
          </div>

          <form className="userCreateForm" onSubmit={handleCreateUser}>
            <input placeholder="Nome" value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} required />
            <input placeholder="E-mail" type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} required />
            <input placeholder="Senha inicial" type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} required />
            <select value={userForm.role} onChange={(event) => {
              const role = event.target.value as CRMUser["role"];
              setUserForm({ ...userForm, role, leadAccessScope: role === "consultor_vendas" ? "own" : "all" });
            }}>
              <option value="admin">Administrador</option>
              <option value="pre_venda">Pré-venda / SDR</option>
              <option value="consultor_vendas">Consultor de vendas</option>
            </select>
            <span className="mutedText">
              Escopo automático: {userForm.role === "consultor_vendas" ? "somente a própria carteira" : "base completa"}.
            </span>
            <select value={userForm.teamId} onChange={(event) => setUserForm({ ...userForm, teamId: event.target.value })}>
              <option value="">Sem equipe</option>
              {teams.filter((team) => team.isActive).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
            <button className="primaryButton" type="submit">Criar usuário</button>
          </form>

          <div className="productionRows productionRowsV32">
            {users.map((user) => (
              <article className="productionRow" key={user.id}>
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.email} • {user.roleLabel} • {user.isActive ? "Ativo" : "Inativo"}</span>
                  <small>Escopo: {user.leadAccessScope === "all" ? "Base completa" : user.leadAccessScope === "team" ? "Equipe" : user.leadAccessScope === "own" ? "Própria carteira" : "Sem acesso"} • Equipe: {user.teamName || "Não definida"}</small>
                  <small>Último login: {formatDateTime(user.lastLoginAt)}</small>
                </div>
                <div className="tableActions tableActionsV32">
                  <select value={user.role} onChange={(event) => handleUpdateUser(user, { role: event.target.value as CRMUser["role"] })}>
                    <option value="admin">Administrador</option>
                    <option value="pre_venda">Pré-venda / SDR</option>
                    <option value="consultor_vendas">Consultor de vendas</option>
                  </select>
                  <span className="mutedText" title="O escopo é fixado pelo papel e validado no backend.">
                    {user.role === "consultor_vendas" ? "Carteira própria" : "Base completa"}
                  </span>
                  <select value={user.teamId} onChange={(event) => handleUpdateUser(user, { teamId: event.target.value })}>
                    <option value="">Sem equipe</option>
                    {teams.filter((team) => team.isActive || team.id === user.teamId).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                  <button className="tableActionButton" type="button" onClick={() => handleUpdateUser(user, { isActive: !user.isActive })}>
                    {user.isActive ? "Inativar" : "Ativar"}
                  </button>
                  <button className="tableActionButton dangerTableAction" type="button" onClick={() => handleDeactivateUser(user)} disabled={user.id === currentUser.id}>
                    Desativar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeAdminTab === "backups" && canBackup ? (
        <section className="panel productionPanel productionPanelV32">
          <div className="sectionTitleRow">
            <div>
              <h3>Backups</h3>
              <p>Dump completo do MySQL, compactado, criptografado, verificado e armazenado fora do projeto.</p>
            </div>
            <div className="settingsActions">
              <button className="primaryButton" type="button" onClick={handleCreateBackup} disabled={isBusy}>Criar backup</button>
              <button className="secondaryButton" type="button" onClick={handleCreateAndDownloadBackup} disabled={isBusy}>Criar e baixar</button>
            </div>
          </div>

          <div className="productionRows productionRowsV32">
            {backups.length ? backups.map((backup) => (
              <article className="productionRow" key={backup.id}>
                <div>
                  <strong>{backup.fileName}</strong>
                  <span>{getBackupStatusLabel(backup)} • {formatBytes(backup.sizeBytes)} • criado em {formatDateTime(backup.createdAt)}</span>
                  {backup.status === "verified" ? <span>AES-256-GCM • SHA-256 registrado • retenção até {formatDateTime(backup.retentionExpiresAt)}</span> : null}
                </div>
                <button
                  className="tableActionButton primaryTableAction"
                  type="button"
                  onClick={() => downloadBackupById(backup.id)}
                  disabled={backup.status === "expired"}
                >
                  {backup.status === "expired" ? "Expirado" : "Baixar"}
                </button>
              </article>
            )) : <div className="operationEmptyCompact"><strong>Nenhum backup listado ainda.</strong></div>}
          </div>
        </section>
      ) : null}

      {activeAdminTab === "trash" && canRestore ? (
        <section className="panel productionPanel productionPanelV32">
          <div className="sectionTitleRow">
            <div>
              <h3>Lixeira</h3>
              <p>Restaure leads excluídos ou apague definitivamente com confirmação.</p>
            </div>
            <span className="badge badgeYellow">{deletedPagination.total} excluído(s)</span>
          </div>

          <div className="productionRows productionRowsV32">
            {deletedLeads.length ? deletedLeads.map((lead) => (
              <article className="productionRow" key={lead.id}>
                <div>
                  <strong>{lead.name || lead.phone || "Lead sem nome"}</strong>
                  <span>{lead.company || lead.email || lead.phone || "Sem dados"}</span>
                  <small>Excluído em: {formatDateTime(lead.deletedAt || "")}</small>
                </div>
                <div className="tableActions tableActionsV32">
                  <button className="tableActionButton successTableAction" type="button" onClick={() => handleRestoreLead(lead)}>Restaurar</button>
                  {canPermanentDelete ? (
                    <button className="tableActionButton dangerTableAction" type="button" onClick={() => handlePermanentDelete(lead)}>Apagar definitivo</button>
                  ) : null}
                </div>
              </article>
            )) : <div className="operationEmptyCompact"><strong>Nenhum lead na lixeira.</strong></div>}
          </div>

          {deletedPagination.hasMore ? (
            <div className="paginationFooter">
              <span>Exibindo {deletedLeads.length} de {deletedPagination.total} lead(s) excluído(s).</span>
              <button
                className="secondaryButton"
                type="button"
                onClick={() => void loadDeletedPage(deletedLeads.length, true)}
                disabled={isBusy}
              >
                Carregar mais
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeAdminTab === "duplicates" ? (
        <section className="panel duplicatePanel duplicatePanelV32">
          <div className="sectionTitleRow">
            <div>
              <h3>Duplicados</h3>
              <p>Grupos detectados por e-mail, telefone ou nome + empresa.</p>
            </div>
            <span className="badge badgeYellow">{duplicatePagination.total} grupo(s)</span>
          </div>

          <div className="duplicateList duplicateListV32">
            {duplicates.length ? duplicates.map((group) => {
              const primaryLead = group.leads[0];

              return (
                <article className="duplicateGroup" key={group.key}>
                  <header>
                    <div>
                      <strong>{group.label}</strong>
                      <span>Motivo: {getDuplicateReasonLabel(group.reason)}</span>
                    </div>
                    <span className="badge badgeGray">{group.total} leads</span>
                  </header>

                  <div className="duplicateLeadRows">
                    {group.leads.map((lead, index) => (
                      <div className="duplicateLeadRow" key={`${group.key}-${lead.id}`}>
                        <div>
                          <strong>{lead.name || lead.phone || "Lead sem nome"}</strong>
                          <span>{index === 0 ? "Principal sugerido" : "Duplicado sugerido"} • {lead.company || lead.email || lead.phone || "Sem dados"}</span>
                        </div>
                        <div className="tableActions tableActionsV32">
                          <button className="tableActionButton primaryTableAction" type="button" onClick={() => onViewLead(lead.id)}>Ver</button>
                          <button className="tableActionButton" type="button" onClick={() => onEditLead(lead.id)}>Editar</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {group.isTruncated ? (
                    <div className="systemNotice systemNoticeError" role="alert">
                      <span>Grupo incompleto na tela. A mesclagem foi bloqueada para evitar perda de dados.</span>
                    </div>
                  ) : canMerge && primaryLead && group.leads.length > 1 ? (
                    <button className="primaryButton duplicateMergeButton" type="button" onClick={() => handleMergeGroup(group)}>
                      Mesclar mantendo principal
                    </button>
                  ) : null}
                </article>
              );
            }) : <div className="operationEmptyCompact"><strong>Nenhum duplicado encontrado.</strong></div>}
          </div>

          {duplicatePagination.hasMore ? (
            <div className="previewFooter loadMoreFooterV35">
              <span>Exibindo {duplicates.length} de {duplicatePagination.total} grupo(s) detectado(s) na base autorizada.</span>
              <button
                className="secondaryButton"
                type="button"
                onClick={() => runPanelAction(async () => {
                  await loadDuplicatePage(duplicatePagination.offset + duplicatePagination.limit, true);
                })}
                disabled={isBusy}
              >
                Carregar mais
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeAdminTab === "audit" && canAudit ? (
        <section className="panel productionPanel productionPanelV32">
          <div className="sectionTitleRow">
            <div>
              <h3>Auditoria</h3>
              <p>Eventos recentes do sistema, usuários e alterações críticas.</p>
            </div>
            <span className="badge badgeBlue">{auditEntries.length} evento(s)</span>
          </div>

          <div className="auditList auditListV32">
            {auditEntries.length ? auditEntries.slice(0, 80).map((entry) => (
              <article className="auditItem" key={entry.id}>
                <strong>{entry.summary || entry.action}</strong>
                <span>{entry.actorName} • {formatDateTime(entry.createdAt)}</span>
              </article>
            )) : <div className="operationEmptyCompact"><strong>Nenhum histórico registrado ainda.</strong></div>}
          </div>
        </section>
      ) : null}

      {activeAdminTab === "system" ? (
        <section className="panel productionPanel productionPanelV32">
          <div className="sectionTitleRow">
            <div>
              <h3>Sistema</h3>
              <p>Informações técnicas fora da operação diária.</p>
            </div>
            <span className="badge badgeBlue">Versão atual: v{packageMetadata.version}</span>
          </div>

          <div className="systemGridV32">
            <article><span>Status MySQL</span><strong>Protegido pelo servidor</strong></article>
            <article><span>Último backup</span><strong>{lastBackup ? formatDateTime(lastBackup.createdAt) : "Pendente"}</strong></article>
            <article><span>Auditoria</span><strong>{auditEntries.length} eventos recentes</strong></article>
            <article><span>Exportações</span><strong>CSV e XLSX</strong></article>
            <article><span>Usuário atual</span><strong>{currentUser.name} • {currentUser.roleLabel}</strong></article>
            <article><span>Base ativa</span><strong>{total} leads</strong></article>
          </div>

          {canExport ? (
            <div className="settingsActions settingsActionsV32">
              <button className="primaryButton" type="button" onClick={downloadLeadsXlsxExport}>Exportar XLSX</button>
              <button className="secondaryButton" type="button" onClick={downloadLeadsCsvExport}>Exportar CSV</button>
            </div>
          ) : null}
        </section>
      ) : null}

      {confirmationDialog}
    </section>
  );
}
